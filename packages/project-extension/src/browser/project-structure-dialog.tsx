import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';
import { MessageService } from '@theia/core/lib/common/message-service';
import { Disposable } from '@theia/core/lib/common/disposable';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';
import { KairoProjectService } from './project-service';
import { ActiveProjectService } from './active-project-service';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import type { ProjectConfig, Toolchain, EncodingId } from '@kairo/protocol';
import './project-structure-dialog.css';

type TabId = 'project' | 'sdk' | 'sources' | 'dependencies';
type SourceLevel = '1.5' | '1.6' | '1.7' | '1.8' | '9' | '11' | '17';
type ClasspathSource = 'ant' | 'yaml' | 'autodetect' | 'manual';

type TFunction = (key: KairoI18nKey, params?: Record<string, string | number>) => string;

interface SourceDirEntry {
    path: string;
    isTest: boolean;
}

interface ClasspathEntry {
    path: string;
    source: ClasspathSource;
}

interface ProjectStructureDialogProps extends DialogProps {
    projectService: KairoProjectService;
    activeProject: ActiveProjectService;
    runtime: RuntimeConnectionService;
    messageService: MessageService;
    fileDialogService: FileDialogService;
    i18n: KairoI18nService;
}

interface DialogState {
    projectName: string;
    projectRoot: string;
    sourceLevel: SourceLevel;
    targetLevel: SourceLevel;
    encoding: EncodingId;
    toolchains: Toolchain[];
    selectedJdkId: string;
    sourceDirs: SourceDirEntry[];
    selectedSourceIdx: number;
    classpath: ClasspathEntry[];
    selectedClasspathIdx: number;
    activeTab: TabId;
    loading: boolean;
    saving: boolean;
    error: string;
}

const SOURCE_LEVELS: SourceLevel[] = ['1.5', '1.6', '1.7', '1.8', '9', '11', '17'];
const ENCODINGS: { id: EncodingId; labelKey: KairoI18nKey }[] = [
    { id: 'utf-8', labelKey: 'widget.projectStructure.encoding.utf8' },
    { id: 'gbk', labelKey: 'widget.projectStructure.encoding.gbk' },
    { id: 'gb18030', labelKey: 'widget.projectStructure.encoding.gb18030' },
    { id: 'iso-8859-1', labelKey: 'widget.projectStructure.encoding.iso8859' },
    { id: 'utf-8-bom', labelKey: 'widget.projectStructure.encoding.utf8Bom' },
];

const TABS: { id: TabId; labelKey: KairoI18nKey; icon: string }[] = [
    { id: 'project', labelKey: 'widget.projectStructure.tabs.project', icon: 'codicon-folder' },
    { id: 'sdk', labelKey: 'widget.projectStructure.tabs.sdk', icon: 'codicon-server-environment' },
    { id: 'sources', labelKey: 'widget.projectStructure.tabs.sources', icon: 'codicon-source-control' },
    { id: 'dependencies', labelKey: 'widget.projectStructure.tabs.dependencies', icon: 'codicon-library' },
];

export class ProjectStructureDialog extends ReactDialog<void> {
    protected readonly projectService: KairoProjectService;
    protected readonly activeProject: ActiveProjectService;
    protected readonly runtime: RuntimeConnectionService;
    protected readonly messageService: MessageService;
    protected readonly fileDialogService: FileDialogService;
    protected readonly i18n: KairoI18nService;
    protected languageChangeDisposable?: Disposable;

    protected state: DialogState;

    constructor(props: ProjectStructureDialogProps) {
        super({
            title: props.i18n.t('widget.projectStructure.title'),
            maxWidth: 900,
        } as DialogProps);
        this.projectService = props.projectService;
        this.activeProject = props.activeProject;
        this.runtime = props.runtime;
        this.messageService = props.messageService;
        this.fileDialogService = props.fileDialogService;
        this.i18n = props.i18n;
        this.state = this.createInitialState();
        this.addClass('kairo-project-structure-dialog');
        this.id = 'kairo-project-structure-dialog';
        this.closeCrossNode.classList.add('codicon', 'codicon-close');
    }

    protected t(key: KairoI18nKey, params?: Record<string, string | number>): string {
        return this.i18n.t(key, params);
    }

    protected createInitialState(): DialogState {
        return {
            projectName: '',
            projectRoot: '',
            sourceLevel: '1.6',
            targetLevel: '1.6',
            encoding: 'utf-8',
            toolchains: [],
            selectedJdkId: '',
            sourceDirs: [],
            selectedSourceIdx: -1,
            classpath: [],
            selectedClasspathIdx: -1,
            activeTab: 'project',
            loading: true,
            saving: false,
            error: '',
        };
    }

    protected override onAfterAttach(msg: import('@theia/core/shared/@lumino/messaging').Message): void {
        super.onAfterAttach(msg);
        this.languageChangeDisposable = this.i18n.onDidChangeLanguage(() => this.update());
        void this.loadData();
    }

    protected override onBeforeDetach(msg: import('@theia/core/shared/@lumino/messaging').Message): void {
        this.languageChangeDisposable?.dispose();
        this.languageChangeDisposable = undefined;
        super.onBeforeDetach(msg);
    }

    get value(): undefined {
        return undefined;
    }

    protected setState(patch: Partial<DialogState>): void {
        this.state = { ...this.state, ...patch };
        this.update();
    }

    protected async loadData(): Promise<void> {
        const project = this.activeProject.project;
        if (!project) {
            this.setState({ loading: false, error: this.t('widget.projectStructure.messages.noActiveProject') });
            return;
        }

        try {
            const next: Partial<DialogState> = {
                projectName: project.name,
                projectRoot: project.root,
            };

            const configs = await this.runtime.request('GET /api/v1/projects', undefined) as ProjectConfig[];
            const config = configs.find(c => c.id === project.projectId);

            if (config) {
                const compiler = config.java?.compiler;
                if (compiler) {
                    if (compiler.sourceLevel) {
                        next.sourceLevel = compiler.sourceLevel as SourceLevel;
                    }
                    if (compiler.targetLevel) {
                        next.targetLevel = compiler.targetLevel as SourceLevel;
                    }
                    next.selectedJdkId = compiler.toolchainId || 'auto';
                }
                if (config.encoding?.default) {
                    next.encoding = config.encoding.default;
                }
                next.sourceDirs = [
                    ...(config.sourceLayout?.src || []).map(p => ({ path: p, isTest: false })),
                    ...(config.sourceLayout?.testSrc || []).map(p => ({ path: p, isTest: true })),
                ];
            }

            const toolchains = await this.projectService.listToolchains();
            next.toolchains = toolchains;

            const wsCtx = this.activeProject.project;
            if (wsCtx) {
                try {
                    const jdtResp = await this.runtime.request(
                        'POST /api/v1/jdtls/project',
                        {
                            workspaceId: wsCtx.workspaceId,
                            rootPath: wsCtx.root,
                            projectId: wsCtx.projectId,
                            autoDetectClasspath: true,
                        },
                        { timeoutMs: 15000 }
                    ) as { classpathEntries?: string[]; classpathSource?: string; sourceRoots?: string[] };

                    const cpSource = (jdtResp.classpathSource || 'autodetect') as ClasspathSource;
                    const existingSrc = new Set((next.sourceDirs || this.state.sourceDirs).map(s => s.path));
                    const mergedSrc = [...(next.sourceDirs || this.state.sourceDirs)];
                    if (jdtResp.sourceRoots) {
                        for (const src of jdtResp.sourceRoots) {
                            if (!existingSrc.has(src)) {
                                mergedSrc.push({ path: src, isTest: false });
                                existingSrc.add(src);
                            }
                        }
                    }
                    next.sourceDirs = mergedSrc;
                    next.classpath = (jdtResp.classpathEntries || []).map(p => ({ path: p, source: cpSource }));
                } catch {
                    // JDT LS may not be available; continue with whatever we have.
                }
            }

            next.loading = false;
            next.error = '';
            this.state = { ...this.state, ...next };
            this.update();
        } catch (err) {
            const raw = err instanceof Error ? err.message : String(err);
            const friendly = /Cannot read prop|undefined|TypeError/i.test(raw)
                ? this.t('widget.projectStructure.messages.loadError')
                : raw;
            this.setState({ loading: false, error: friendly });
        }
    }

    protected render(): React.ReactNode {
        const s = this.state;

        if (s.loading) {
            return (
                <div className="kairo-ps-body">
                    <div className="kairo-ps-content kairo-ps-loading">
                        <div className="kairo-ps-loading-message">
                            <i className="codicon codicon-loading codicon-modifier-spin kairo-ps-loading-icon" />
                            <div>{this.t('widget.projectStructure.loading')}</div>
                        </div>
                    </div>
                    {this.renderFooter()}
                </div>
            );
        }

        return (
            <div className="kairo-ps-body">
                <div className="kairo-ps-tabs" role="tablist">
                    {TABS.map(tab => (
                        <div
                            key={tab.id}
                            className={`kairo-ps-tab ${s.activeTab === tab.id ? 'active' : ''}`}
                            role="tab"
                            aria-selected={s.activeTab === tab.id}
                            onClick={() => this.setState({ activeTab: tab.id })}
                        >
                            <i className={`codicon ${tab.icon} kairo-ps-tab-icon`} />
                            <span>{this.t(tab.labelKey)}</span>
                        </div>
                    ))}
                </div>
                <div className="kairo-ps-content" role="tabpanel">
                    {s.error && <div className="kairo-ps-error" role="alert">{s.error}</div>}
                    {s.activeTab === 'project' && this.renderProjectTab()}
                    {s.activeTab === 'sdk' && this.renderSdkTab()}
                    {s.activeTab === 'sources' && this.renderSourcesTab()}
                    {s.activeTab === 'dependencies' && this.renderDependenciesTab()}
                </div>
                {this.renderFooter()}
            </div>
        );
    }

    protected renderFooter(): React.ReactNode {
        return (
            <div className="kairo-ps-dialog-footer">
                <button
                    className="theia-button secondary"
                    disabled={this.state.saving}
                    onClick={() => this.close()}
                >
                    {this.t('common.cancel')}
                </button>
                <button
                    className="theia-button secondary"
                    disabled={this.state.saving}
                    onClick={() => void this.handleApply()}
                >
                    {this.state.saving ? this.t('widget.projectStructure.buttons.saving') : this.t('common.apply')}
                </button>
                <button
                    className="theia-button main"
                    disabled={this.state.saving}
                    onClick={() => void this.handleOk()}
                >
                    {this.state.saving ? this.t('widget.projectStructure.buttons.saving') : this.t('common.ok')}
                </button>
            </div>
        );
    }

    protected field(label: string, children: React.ReactNode): React.ReactNode {
        return (
            <div className="kairo-ps-field">
                <span className="kairo-ps-field-label">{label}</span>
                {children}
            </div>
        );
    }

    protected renderProjectTab(): React.ReactNode {
        const s = this.state;
        return (
            <div>
                <h3 className="kairo-ps-section-title">{this.t('widget.projectStructure.projectTab.title')}</h3>
                {this.field(this.t('widget.projectStructure.projectTab.name'), (
                    <input className="theia-input" type="text" value={s.projectName} readOnly />
                ))}
                {this.field(this.t('widget.projectStructure.projectTab.root'), (
                    <input className="theia-input" type="text" value={s.projectRoot} readOnly />
                ))}
                <div className="kairo-ps-section-sep" />
                <h4 className="kairo-ps-subtitle">{this.t('widget.projectStructure.projectTab.compiler')}</h4>
                {this.field(this.t('widget.projectStructure.projectTab.sourceLevel'), (
                    <select
                        className="theia-select"
                        value={s.sourceLevel}
                        onChange={e => this.setState({ sourceLevel: e.target.value as SourceLevel })}
                    >
                        {SOURCE_LEVELS.map(lv => <option key={lv} value={lv}>{lv}</option>)}
                    </select>
                ))}
                {this.field(this.t('widget.projectStructure.projectTab.targetLevel'), (
                    <select
                        className="theia-select"
                        value={s.targetLevel}
                        onChange={e => this.setState({ targetLevel: e.target.value as SourceLevel })}
                    >
                        {SOURCE_LEVELS.map(lv => <option key={lv} value={lv}>{lv}</option>)}
                    </select>
                ))}
                {this.field(this.t('widget.projectStructure.projectTab.encoding'), (
                    <select
                        className="theia-select"
                        value={s.encoding}
                        onChange={e => this.setState({ encoding: e.target.value as EncodingId })}
                    >
                        {ENCODINGS.map(enc => <option key={enc.id} value={enc.id}>{this.t(enc.labelKey)}</option>)}
                    </select>
                ))}
            </div>
        );
    }

    protected renderSdkTab(): React.ReactNode {
        const s = this.state;
        return (
            <div>
                <h3 className="kairo-ps-section-title">{this.t('widget.projectStructure.sdkTab.title')}</h3>
                <p className="kairo-ps-hint kairo-ps-hint-flush">
                    {this.t('widget.projectStructure.sdkTab.hint')}
                </p>
                <div
                    className={`kairo-ps-jdk-item ${s.selectedJdkId === 'auto' ? 'selected' : ''}`}
                    onClick={() => this.setState({ selectedJdkId: 'auto' })}
                >
                    <input
                        type="radio"
                        className="kairo-ps-jdk-radio"
                        name="jdk-select"
                        checked={s.selectedJdkId === 'auto'}
                        onChange={() => this.setState({ selectedJdkId: 'auto' })}
                    />
                    <div className="kairo-ps-jdk-info">
                        <div className="kairo-ps-jdk-name">{this.t('widget.projectStructure.sdkTab.autoDetect')}</div>
                        <div className="kairo-ps-jdk-path">{this.t('widget.projectStructure.sdkTab.autoDetectDesc')}</div>
                    </div>
                </div>
                {s.toolchains.map(jdk => (
                    <div
                        key={jdk.id}
                        className={`kairo-ps-jdk-item ${s.selectedJdkId === jdk.id ? 'selected' : ''}`}
                        onClick={() => this.setState({ selectedJdkId: jdk.id })}
                    >
                        <input
                            type="radio"
                            className="kairo-ps-jdk-radio"
                            name="jdk-select"
                            checked={s.selectedJdkId === jdk.id}
                            onChange={() => this.setState({ selectedJdkId: jdk.id })}
                        />
                        <div className="kairo-ps-jdk-info">
                            <div className="kairo-ps-jdk-name">
                                {`${jdk.vendor} JDK ${jdk.version}`}
                                {jdk.version && <span className="kairo-ps-badge">{jdk.version}</span>}
                            </div>
                            <div className="kairo-ps-jdk-path" title={jdk.home}>{jdk.home}</div>
                        </div>
                        <div className="kairo-ps-jdk-version">{jdk.vendor}</div>
                    </div>
                ))}
                <div className="kairo-ps-list-actions">
                    <button
                        className="theia-button"
                        onClick={() => void this.handleAddJdk()}
                    >
                        <i className="codicon codicon-add kairo-ps-btn-icon" />
                        {this.t('widget.projectStructure.sdkTab.addJdk')}
                    </button>
                </div>
            </div>
        );
    }

    protected renderSourcesTab(): React.ReactNode {
        const s = this.state;
        return (
            <div>
                <h3 className="kairo-ps-section-title">{this.t('widget.projectStructure.sourcesTab.title')}</h3>
                {s.sourceDirs.length === 0 ? (
                    <div className="kairo-ps-empty">{this.t('widget.projectStructure.sourcesTab.empty')}</div>
                ) : (
                    <div className="kairo-ps-list">
                        {s.sourceDirs.map((src, idx) => (
                            <div
                                key={`${src.path}-${idx}`}
                                className={`kairo-ps-list-item ${s.selectedSourceIdx === idx ? 'selected' : ''}`}
                                onClick={() => this.setState({ selectedSourceIdx: idx })}
                            >
                                <i className="codicon codicon-folder kairo-ps-list-item-icon" />
                                <span className="kairo-ps-list-item-path">{src.path}</span>
                                {src.isTest && <span className="kairo-ps-badge">{this.t('widget.projectStructure.sourcesTab.testBadge')}</span>}
                                <label className="kairo-ps-checkbox-label" onClick={e => e.stopPropagation()}>
                                    <input
                                        type="checkbox"
                                        checked={src.isTest}
                                        onChange={e => {
                                            const updated = [...this.state.sourceDirs];
                                            updated[idx] = { ...src, isTest: e.target.checked };
                                            this.setState({ sourceDirs: updated });
                                        }}
                                    />
                                    <span>{this.t('widget.projectStructure.sourcesTab.testSource')}</span>
                                </label>
                            </div>
                        ))}
                    </div>
                )}
                <div className="kairo-ps-list-actions">
                    <button
                        className="theia-button"
                        onClick={() => void this.handleAddSourceDir()}
                    >
                        <i className="codicon codicon-add kairo-ps-btn-icon" />
                        {this.t('common.add')}
                    </button>
                    <button
                        className="theia-button secondary"
                        disabled={s.selectedSourceIdx < 0}
                        onClick={() => this.handleRemoveSourceDir()}
                    >
                        <i className="codicon codicon-remove kairo-ps-btn-icon" />
                        {this.t('common.remove')}
                    </button>
                </div>
            </div>
        );
    }

    protected renderDependenciesTab(): React.ReactNode {
        const s = this.state;
        const sourceBadge = (src: ClasspathSource) => {
            const label = src === 'autodetect' ? this.t('widget.projectStructure.dependenciesTab.autoDetected') : src.toUpperCase();
            return <span className={`kairo-ps-badge ${src}`}>{label}</span>;
        };
        return (
            <div>
                <h3 className="kairo-ps-section-title">{this.t('widget.projectStructure.dependenciesTab.title')}</h3>
                {s.classpath.length === 0 ? (
                    <div className="kairo-ps-empty">{this.t('widget.projectStructure.dependenciesTab.empty')}</div>
                ) : (
                    <div className="kairo-ps-list">
                        {s.classpath.map((cp, idx) => (
                            <div
                                key={`${cp.path}-${idx}`}
                                className={`kairo-ps-list-item ${s.selectedClasspathIdx === idx ? 'selected' : ''}`}
                                onClick={() => this.setState({ selectedClasspathIdx: idx })}
                            >
                                <i className={`codicon ${cp.path.endsWith('.jar') ? 'codicon-file-binary' : 'codicon-folder'} kairo-ps-list-item-icon`} />
                                <span className="kairo-ps-list-item-path" title={cp.path}>{cp.path}</span>
                                {sourceBadge(cp.source)}
                            </div>
                        ))}
                    </div>
                )}
                <div className="kairo-ps-list-actions">
                    <button
                        className="theia-button"
                        onClick={() => void this.handleAddJar()}
                    >
                        <i className="codicon codicon-add kairo-ps-btn-icon" />
                        {this.t('widget.projectStructure.dependenciesTab.addJar')}
                    </button>
                    <button
                        className="theia-button"
                        onClick={() => void this.handleAddDirectory()}
                    >
                        <i className="codicon codicon-folder-opened kairo-ps-btn-icon" />
                        {this.t('widget.projectStructure.dependenciesTab.addDirectory')}
                    </button>
                    <button
                        className="theia-button secondary"
                        disabled={s.selectedClasspathIdx < 0 || s.classpath[s.selectedClasspathIdx]?.source !== 'manual'}
                        onClick={() => this.handleRemoveClasspath()}
                    >
                        <i className="codicon codicon-remove kairo-ps-btn-icon" />
                        {this.t('common.remove')}
                    </button>
                </div>
            </div>
        );
    }

    protected async handleApply(): Promise<void> {
        await this.save();
    }

    protected async handleOk(): Promise<void> {
        const ok = await this.save();
        if (ok) {
            this.close();
        }
    }

    protected async save(): Promise<boolean> {
        const project = this.activeProject.project;
        if (!project) {
            this.setState({ error: 'No active project.' });
            return false;
        }

        this.setState({ saving: true, error: '' });

        try {
            const configs = await this.runtime.request('GET /api/v1/projects', undefined) as ProjectConfig[];
            const existing = configs.find(c => c.id === project.projectId);

            const srcDirs = this.state.sourceDirs.filter(d => !d.isTest).map(d => d.path);
            const testDirs = this.state.sourceDirs.filter(d => d.isTest).map(d => d.path);

            const toolchainId = this.state.selectedJdkId;
            const jdkToolchain = this.state.toolchains.find(t => t.id === toolchainId);

            const compilerRef = toolchainId === 'auto'
                ? { toolchainId: 'auto', fingerprint: '' }
                : {
                    toolchainId,
                    fingerprint: jdkToolchain?.fingerprint || '',
                    label: jdkToolchain?.vendor,
                };

            const updated: ProjectConfig = existing ? {
                ...existing,
                encoding: { ...(existing.encoding || { default: this.state.encoding }), default: this.state.encoding },
                java: {
                    ...(existing.java || {}),
                    compiler: {
                        ...(existing.java?.compiler || {}),
                        sourceLevel: this.state.sourceLevel,
                        targetLevel: this.state.targetLevel,
                        toolchainId: compilerRef.toolchainId,
                        fingerprint: compilerRef.fingerprint,
                        label: compilerRef.label,
                    },
                    languageServer: { ...(existing.java?.languageServer || {}), ...compilerRef },
                    runtime: { ...(existing.java?.runtime || {}), ...compilerRef },
                },
                sourceLayout: { ...(existing.sourceLayout || {}), src: srcDirs, testSrc: testDirs },
            } : {
                schemaVersion: 1 as const,
                id: project.projectId,
                name: project.name,
                rootPath: project.root,
                sourceLayout: { src: srcDirs, webRoot: 'WebRoot', config: [], testSrc: testDirs },
                encoding: { default: this.state.encoding },
                java: {
                    languageServer: { ...compilerRef },
                    compiler: { sourceLevel: this.state.sourceLevel, targetLevel: this.state.targetLevel, ...compilerRef },
                    runtime: { ...compilerRef },
                },
                serverRuntime: { type: 'tomcat6', config: {} },
                build: { mode: 'ant' },
                deploy: { mode: 'copy', target: '' },
                hotReload: { mode: 'staticSync' },
            };

            const saved = await this.runtime.request(
                'PUT /api/v1/projects/{projectId}',
                updated,
                { pathParams: { projectId: project.projectId } },
            ) as ProjectConfig;

            await this.runtime.request(
                'POST /api/v1/jdtls/project',
                {
                    workspaceId: project.workspaceId,
                    rootPath: project.root,
                    projectId: project.projectId,
                    // Persist Dependencies-tab edits: when the user has any
                    // classpath entries (esp. manual), stop autodetection and
                    // pass the explicit list (BD-P1-13).
                    autoDetectClasspath: !this.state.classpath.some(e => e.source === 'manual'),
                    libraries: this.state.classpath.map(e => e.path),
                },
                { timeoutMs: 30000 },
            );

            this.setState({ saving: false });
            // Broadcast encoding/project change so encoding-contribution and
            // other listeners apply immediately (BD-P2-7).
            await this.activeProject.setProject({
                ...project,
                name: saved.name || this.state.projectName || project.name,
                encoding: this.state.encoding,
            });
            void this.messageService.info(this.t('widget.projectStructure.messages.saveSuccess', { name: saved.name }));
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.setState({ saving: false, error: msg });
            void this.messageService.error(this.t('widget.projectStructure.messages.saveError', { message: msg }));
            return false;
        }
    }

    protected async handleAddJdk(): Promise<void> {
        try {
            const dialog = await this.fileDialogService.showOpenDialog({
                title: this.t('widget.projectStructure.dialogs.selectJdkHome'),
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
            });
            if (!dialog) return;
            const home = String(dialog.path);
            const imported = await this.runtime.request(
                'POST /api/v1/toolchains/import',
                { path: home },
                { timeoutMs: 30000 },
            ) as Toolchain;
            this.setState({
                toolchains: [...this.state.toolchains, imported],
                selectedJdkId: imported.id,
            });
            void this.messageService.info(this.t('widget.projectStructure.messages.jdkAdded', { version: imported.version }));
        } catch (err) {
            this.setState({ error: err instanceof Error ? err.message : String(err) });
        }
    }

    protected async handleAddSourceDir(): Promise<void> {
        // BD-P2-6: Electron has no window.prompt — use folder picker.
        try {
            const dialog = await this.fileDialogService.showOpenDialog({
                title: this.t('widget.projectStructure.dialogs.enterSourceDir'),
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
            });
            if (!dialog) return;
            const trimmed = String(dialog.path).trim();
            if (!trimmed) return;
            this.setState({
                sourceDirs: [...this.state.sourceDirs, { path: trimmed, isTest: false }],
                selectedSourceIdx: this.state.sourceDirs.length,
            });
        } catch (err) {
            this.setState({ error: err instanceof Error ? err.message : String(err) });
        }
    }

    protected handleRemoveSourceDir(): void {
        const idx = this.state.selectedSourceIdx;
        if (idx < 0) return;
        const updated = this.state.sourceDirs.filter((_, i) => i !== idx);
        this.setState({ sourceDirs: updated, selectedSourceIdx: -1 });
    }

    protected async handleAddJar(): Promise<void> {
        try {
            const dialog = await this.fileDialogService.showOpenDialog({
                title: this.t('widget.projectStructure.dialogs.selectJar'),
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
            });
            if (!dialog) return;
            const path = String(dialog.path);
            this.setState({
                classpath: [...this.state.classpath, { path, source: 'manual' }],
                selectedClasspathIdx: this.state.classpath.length,
            });
        } catch (err) {
            this.setState({ error: err instanceof Error ? err.message : String(err) });
        }
    }

    protected async handleAddDirectory(): Promise<void> {
        try {
            const dialog = await this.fileDialogService.showOpenDialog({
                title: this.t('widget.projectStructure.dialogs.selectClassesDir'),
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
            });
            if (!dialog) return;
            const path = String(dialog.path);
            this.setState({
                classpath: [...this.state.classpath, { path, source: 'manual' }],
                selectedClasspathIdx: this.state.classpath.length,
            });
        } catch (err) {
            this.setState({ error: err instanceof Error ? err.message : String(err) });
        }
    }

    protected handleRemoveClasspath(): void {
        const idx = this.state.selectedClasspathIdx;
        if (idx < 0) return;
        const entry = this.state.classpath[idx];
        if (entry.source !== 'manual') return;
        const updated = this.state.classpath.filter((_, i) => i !== idx);
        this.setState({ classpath: updated, selectedClasspathIdx: -1 });
    }
}
