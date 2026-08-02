import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { KairoProjectService } from './project-service';
import { ActiveProjectService } from './active-project-service';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';
import type { ProjectDetection, ProjectImportConfirmRequest } from '@kairo/protocol';

/** Normalize a user-visible encoding label to the wire encoding id. */
function normalizeEncodingId(encoding: string): string {
    const lower = encoding.trim().toLowerCase();
    switch (lower) {
        case 'utf8': return 'utf-8';
        case 'utf-8-bom': return 'utf-8-bom';
        case 'gb18030': return 'gb18030';
        case 'gbk': return 'gbk';
        case 'iso-8859-1': return 'iso-8859-1';
        case 'us-ascii': return 'us-ascii';
        case 'utf-16le': return 'utf-16le';
        case 'utf-16be': return 'utf-16be';
        default: return lower || 'utf-8';
    }
}

function normalizePathForApi(path: string): string {
    return path.replace(/\\/g, '/');
}

type TFunction = (key: KairoI18nKey, params?: Record<string, string | number>) => string;

@injectable()
export class ImportWizardWidget extends ReactWidget {
    static readonly ID = 'kairo-import-wizard';

    @inject(FileDialogService)
    protected readonly fileDialogService!: FileDialogService;

    @inject(KairoProjectService)
    protected readonly projectService!: KairoProjectService;

    @inject(ActiveProjectService)
    protected readonly activeProject!: ActiveProjectService;

    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    @inject(WorkspaceContextService)
    protected readonly workspaceContext!: WorkspaceContextService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    constructor() {
        super();
        this.id = ImportWizardWidget.ID;
        this.title.label = '';
        this.title.closable = true;
        this.title.caption = '';
        this.addClass('kairo-widget');
    }

    @postConstruct()
    protected init(): void {
        const t: TFunction = (this.i18n?.t.bind(this.i18n)) as TFunction | undefined
            ?? ((key: KairoI18nKey) => String(key));
        this.title.label = t('widget.importWizard.title');
        this.title.caption = t('widget.importWizard.caption');
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        if (this.node.tabIndex < 0) {
            this.node.tabIndex = 0;
        }
        this.node.focus();
        setTimeout(() => {
            const target = this.node.querySelector<HTMLElement>('.kairo-path-input:not([disabled]), input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])');
            target?.focus();
        }, 50);
    }

    protected render(): React.ReactNode {
        const t: TFunction = (this.i18n?.t.bind(this.i18n)) as TFunction | undefined
            ?? ((key: KairoI18nKey) => String(key));
        return React.createElement(ImportWizard, {
            fileDialogService: this.fileDialogService,
            projectService: this.projectService,
            activeProject: this.activeProject,
            runtime: this.runtime,
            workspaceContext: this.workspaceContext,
            workspaceService: this.workspaceService,
            onClose: () => this.close(),
            t,
        });
    }
}

interface ImportWizardProps {
    fileDialogService: FileDialogService;
    projectService: KairoProjectService;
    activeProject: ActiveProjectService;
    runtime: RuntimeConnectionService;
    workspaceContext: WorkspaceContextService;
    workspaceService: WorkspaceService;
    onClose: () => void;
    t: TFunction;
}

const ImportWizard: React.FC<ImportWizardProps> = ({
    fileDialogService, projectService, activeProject, runtime, workspaceContext, workspaceService, onClose, t,
}) => {
    const [step, setStep] = React.useState(1);
    const [workspacePath, setWorkspacePath] = React.useState('');
    const [workspaceId, setWorkspaceId] = React.useState('');
    const [detected, setDetected] = React.useState<ProjectDetection | null>(null);
    const [scanning, setScanning] = React.useState(false);
    const [importing, setImporting] = React.useState(false);
    const [scanError, setScanError] = React.useState('');
    const [importError, setImportError] = React.useState('');
    const [importedSummary, setImportedSummary] = React.useState<{ name: string; root: string; encoding: string; projectId: string } | null>(null);

    // Editable fields for step 2
    const [projectName, setProjectName] = React.useState('');
    const [sourceDirs, setSourceDirs] = React.useState('src');
    const [webRoot, setWebRoot] = React.useState('WebRoot');
    const [libDirs, setLibDirs] = React.useState('lib');
    const [buildScript, setBuildScript] = React.useState('build.xml');
    const [defaultEncoding, setDefaultEncoding] = React.useState('GBK');
    const [jdkVersion, setJdkVersion] = React.useState('1.6');
    const [sourceVersion, setSourceVersion] = React.useState('1.6');
    const [targetVersion, setTargetVersion] = React.useState('1.6');
    const [outputDir, setOutputDir] = React.useState('build/classes');
    const [buildTool, setBuildTool] = React.useState('ant');
    const [contextPath, setContextPath] = React.useState('/');

    const handleSelectDirectory = React.useCallback(async () => {
        try {
            const dialog = await fileDialogService.showOpenDialog({
                title: t('widget.importWizard.selectDirectory'),
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
            });
            if (!dialog) {
                return;
            }
            const path = String(dialog.path);
            setWorkspacePath(path);
            await scanPath(path);
        } catch (error) {
            setScanError(error instanceof Error ? error.message : String(error));
        }
    }, [fileDialogService, projectService, runtime, workspaceContext, t]);

    // KAIRO-RC-WEB-028: extract the scan-and-populate logic from
    // `handleSelectDirectory` so the visible path input on step 1
    // can drive the same flow when the user pastes a path instead
    // of picking one from the file dialog. The file dialog in the
    // Theia browser is known to swallow the typed input; this
    // makes the wizard usable even when the dialog fails.
    const scanPath = React.useCallback(async (path: string) => {
        setScanning(true);
        setScanError('');
        const normalizedPath = normalizePathForApi(path);
        try {
            // KAIRO-RC-WEB-2026-07-25-06: the project being imported lives
            // under a directory that is not necessarily the Theia startup
            // workspace. The agent's import endpoint validates that the
            // project root is inside the request's workspaceId, so we must
            // register the selected project path as its own workspace before
            // importing. This also sets the runtime workspaceId so the
            // subsequent import call targets the right backend context.
            const projectWorkspace = await projectService.openWorkspace(normalizedPath);
            setWorkspaceId(projectWorkspace.id);

            const result = await projectService.detectProject(normalizedPath);
            setDetected(result);

            const base = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'project';
            setProjectName(base);
            setSourceDirs(result.sourceDirs?.join(', ') || 'src');
            setWebRoot(result.webRoot || 'WebRoot');
            setLibDirs(result.libDirs?.join(', ') || 'lib');
            setBuildScript(result.buildScript || 'build.xml');
            setDefaultEncoding(normalizeEncodingId(result.defaultEncoding || 'gbk'));
            setJdkVersion(result.jdkVersion || '1.6');
            setSourceVersion(result.sourceVersion || '1.6');
            setTargetVersion(result.targetVersion || '1.6');
            setOutputDir(result.outputDir || 'build/classes');
            setBuildTool((result.buildSystem === 'ant' || result.buildScript === 'build.xml') ? 'ant' : 'javac');
            setContextPath('/');

            setStep(2);
        } catch (error) {
            setDetected(null);
            setScanError(error instanceof Error ? error.message : String(error));
        } finally {
            setScanning(false);
        }
    }, [projectService, runtime, workspaceContext]);

    const handleScanTypedPath = React.useCallback(async () => {
        const path = workspacePath.trim();
        if (!path) {
            setScanError(t('widget.importWizard.enterPathFirst'));
            return;
        }
        await scanPath(path);
    }, [workspacePath, scanPath, t]);

    const handleImport = React.useCallback(async () => {
        setImporting(true);
        setImportError('');

        try {
            const trimmedName = projectName.trim();
            if (!trimmedName) {
                throw new Error(t('widget.importWizard.nameRequired'));
            }
            if (!workspaceId) {
                throw new Error(t('widget.importWizard.noWorkspace'));
            }

            const normalizedWorkspacePath = normalizePathForApi(workspacePath);
            const params: ProjectImportConfirmRequest = {
                workspaceId,
                rootPath: normalizedWorkspacePath,
                name: trimmedName,
                sourceDirs: sourceDirs.split(',').map(s => s.trim()).filter(s => s.length > 0),
                webRoot: webRoot.trim(),
                libDirs: libDirs.split(',').map(s => s.trim()).filter(s => s.length > 0),
                buildScript: buildScript.trim(),
                defaultEncoding: normalizeEncodingId(defaultEncoding),
                jdkVersion: jdkVersion.trim(),
                sourceVersion: sourceVersion.trim(),
                targetVersion: targetVersion.trim(),
                outputDir: outputDir.trim(),
                buildTool: (buildTool === 'ant' ? 'ant' : 'javac') as 'ant' | 'javac',
                contextPath: contextPath.trim() || '/',
            };

            const saved = await projectService.importProjectNew(params);

            // KAIRO-RC-WEB-2026-07-25-04: temporary debug log to capture
            // the exact import request payload for K4 debugging. Remove
            // once SHARD-02 import path is green.
            console.log('[kairo:import-debug] params:', JSON.stringify(params, null, 2));

            // KAIRO-RC-WEB-2026-07-25-13: synchronise the WorkspaceContext
            // to the new project's workspace. Without this, the
            // ActiveProjectService's onDidChangeContext listener keeps
            // firing with the Theia parent folder's workspaceId; that
            // listener queries /api/v1/projects with the parent
            // workspaceId, sees an empty list, and clears
            // `currentProject` — the imported project lives in the
            // wizard's freshly created workspace, not the parent. The
            // status bar consequently stays on `(no workspace)` even
            // though setProject() fired. Updating WorkspaceContext
            // here re-issues the listener against the new workspace
            // and the project is then discoverable.
            //
            // We do NOT call `runtime.setWorkspace(workspaceId)`
            // directly: WorkspaceContextService.setWorkspace already
            // forwards to the runtime. Calling it twice caused the
            // EventStream to close+reopen, which fired the
            // WorkspaceContextService status listener and re-ran
            // syncFromRoots with the Theia parent folder's roots —
            // which then re-fired onDidChangeContext with the OLD
            // workspaceId and the ActiveProjectService listener
            // cleared the just-selected project.
            const finalRootPath = saved.rootPath ? normalizePathForApi(saved.rootPath) : normalizedWorkspacePath;
            if (workspaceId) {
                try {
                    await workspaceContext.setWorkspace(workspaceId, finalRootPath);
                } catch (ctxErr) {
                    console.warn('[kairo:import-debug] workspaceContext.setWorkspace failed:',
                        ctxErr instanceof Error ? ctxErr.message : String(ctxErr));
                }
            }

            await activeProject.setProject({
                workspaceId,
                projectId: saved.id,
                name: saved.name,
                root: finalRootPath,
                encoding: normalizeEncodingId(defaultEncoding),
            });

            setImportedSummary({
                name: saved.name || trimmedName,
                root: finalRootPath,
                encoding: normalizeEncodingId(defaultEncoding),
                projectId: saved.id,
            });
            setStep(3);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setImportError(msg);
        } finally {
            setImporting(false);
        }
    }, [projectService, activeProject, runtime, workspaceContext, workspaceId, workspacePath, projectName,
        sourceDirs, webRoot, libDirs, buildScript, defaultEncoding,
        jdkVersion, sourceVersion, targetVersion, outputDir, buildTool, contextPath, t]);

    return (
        <div className="kairo-import-wizard" data-testid="import-wizard">
            <header className="kairo-wizard-header">
                <h1 data-testid="wizard-title">{t('widget.importWizard.headerTitle')}</h1>
                <p className="kairo-wizard-subtitle">{t('widget.importWizard.headerSubtitle')}</p>
            </header>

            <div className="kairo-wizard-steps">
                <div className={`kairo-wizard-step ${step >= 1 ? 'active' : ''}`} data-testid="step-1" aria-current={step === 1 ? 'step' : undefined}>
                    <span className="step-number">1</span>
                    <span className="step-label">{t('widget.importWizard.stepLabelSelectDirectory')}</span>
                </div>
                <div className={`kairo-wizard-step ${step >= 2 ? 'active' : ''}`} data-testid="step-2" aria-current={step === 2 ? 'step' : undefined}>
                    <span className="step-number">2</span>
                    <span className="step-label">{t('widget.importWizard.stepLabelConfirmSettings')}</span>
                </div>
                <div className={`kairo-wizard-step ${step >= 3 ? 'active' : ''}`} data-testid="step-3" aria-current={step === 3 ? 'step' : undefined}>
                    <span className="step-number">3</span>
                    <span className="step-label">{t('widget.importWizard.stepLabelComplete')}</span>
                </div>
            </div>

            <div className="kairo-wizard-content">
                {/* Step 1: Select Directory */}
                {step === 1 && (
                    <div className="kairo-wizard-step-content" data-testid="step-content-1">
                        <div className="kairo-wizard-tips" data-testid="welcome-tips">
                            <h3>{t('widget.importWizard.welcomeTitle')}</h3>
                            <p>{t('widget.importWizard.welcomeDesc')}</p>
                            <ul>
                                <li>{t('widget.importWizard.welcomeTip1')}</li>
                                <li>{t('widget.importWizard.welcomeTip2')}</li>
                                <li>{t('widget.importWizard.welcomeTip3')}</li>
                                <li>{t('widget.importWizard.welcomeTip4')}</li>
                            </ul>
                        </div>
                        <p>{t('widget.importWizard.selectRootFolder')}</p>
                        <p className="kairo-hint">
                            {t('widget.importWizard.autoDetectHint')}
                        </p>
                        {/* KAIRO-RC-WEB-028: visible path input as a fallback
                            when the file dialog swallows the typed path. The
                            "Browse" button still uses the native dialog for
                            mouse-driven users; "Scan" works on a typed path. */}
                        <div className="kairo-path-row" data-testid="path-row">
                            <input
                                type="text"
                                className="theia-input kairo-path-input"
                                data-testid="path-input"
                                placeholder={t('widget.importWizard.pathPlaceholder')}
                                value={workspacePath}
                                onChange={e => setWorkspacePath(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleScanTypedPath(); } }}
                                aria-label={t('widget.importWizard.projectPath')}
                            />
                            <button
                                className="theia-button secondary"
                                onClick={handleSelectDirectory}
                                disabled={scanning}
                                data-testid="browse-btn"
                                aria-label={t('widget.importWizard.browseAria')}
                            >
                                {t('common.browse')}
                            </button>
                            <button
                                className="theia-button main"
                                onClick={handleScanTypedPath}
                                disabled={scanning || !workspacePath.trim()}
                                data-testid="scan-btn"
                                aria-label={t('widget.importWizard.scanAria')}
                                title={!workspacePath.trim() ? t('widget.importWizard.pathPlaceholder') : undefined}
                            >
                                {scanning ? t('widget.importWizard.scanning') : t('widget.importWizard.scan')}
                            </button>
                        </div>
                        {workspacePath && (
                            <p className="kairo-selected-path" data-testid="selected-path">
                                {t('widget.importWizard.selectedPath', { path: workspacePath })}
                            </p>
                        )}
                        {scanError && (
                            <p className="kairo-error" role="alert" data-testid="scan-error">
                                {scanError}
                            </p>
                        )}
                    </div>
                )}

                {/* Step 2: Confirm Detected Results */}
                {step === 2 && (
                    <div className="kairo-wizard-step-content" data-testid="step-content-2">
                        <p>{t('widget.importWizard.reviewSettings')}</p>
                        {detected && (
                            <p className="kairo-confidence">
                                {t('widget.importWizard.detectionConfidence', { confidence: Math.round(detected.confidence * 100) })}
                                {detected.warnings.length > 0 && (
                                    <span className="kairo-warning"> ({detected.warnings.length} {t('common.warning').toLowerCase()})</span>
                                )}
                            </p>
                        )}
                        <form className="kairo-config-form" data-testid="project-config-form" onSubmit={e => e.preventDefault()}>
                            <div className="kairo-form-group">
                                <label htmlFor="input-project-name">
                                    {t('widget.importWizard.projectName')}:
                                    <input
                                        id="input-project-name"
                                        type="text"
                                        className="theia-input"
                                        data-testid="input-project-name"
                                        value={projectName}
                                        onChange={e => setProjectName(e.target.value)}
                                        aria-label={t('widget.importWizard.projectNameAria')}
                                    />
                                </label>
                            </div>
                            <div className="kairo-form-group">
                                <label htmlFor="input-source-dirs">
                                    {t('widget.importWizard.sourceDirs')}:
                                    <input
                                        id="input-source-dirs"
                                        type="text"
                                        className="theia-input"
                                        data-testid="input-source-dirs"
                                        value={sourceDirs}
                                        onChange={e => setSourceDirs(e.target.value)}
                                        aria-label={t('widget.importWizard.sourceDirsAria')}
                                    />
                                </label>
                            </div>
                            <div className="kairo-form-group">
                                <label htmlFor="input-web-root">
                                    {t('widget.importWizard.webRoot')}:
                                    <input
                                        id="input-web-root"
                                        type="text"
                                        data-testid="input-web-root"
                                        value={webRoot}
                                        onChange={e => setWebRoot(e.target.value)}
                                        aria-label={t('widget.importWizard.webRootAria')}
                                    />
                                </label>
                            </div>
                            <div className="kairo-form-group">
                                <label htmlFor="input-lib-dirs">
                                    {t('widget.importWizard.libDirs')}:
                                    <input
                                        id="input-lib-dirs"
                                        type="text"
                                        className="theia-input"
                                        data-testid="input-lib-dirs"
                                        value={libDirs}
                                        onChange={e => setLibDirs(e.target.value)}
                                        aria-label={t('widget.importWizard.libDirsAria')}
                                    />
                                </label>
                            </div>
                            <div className="kairo-form-row">
                                <div className="kairo-form-group">
                                    <label htmlFor="select-encoding">
                                        {t('widget.importWizard.defaultEncoding')}:
                                        <select
                                            id="select-encoding"
                                            className="theia-select"
                                            data-testid="select-encoding"
                                            value={defaultEncoding}
                                            onChange={e => setDefaultEncoding(e.target.value)}
                                            aria-label={t('widget.importWizard.encodingAria')}
                                        >
                                            <option value="utf-8">{t('widget.importWizard.encoding.utf8')}</option>
                                            <option value="gbk">{t('widget.importWizard.encoding.gbk')}</option>
                                            <option value="gb18030">{t('widget.importWizard.encoding.gb18030')}</option>
                                            <option value="iso-8859-1">{t('widget.importWizard.encoding.iso8859')}</option>
                                        </select>
                                    </label>
                                </div>
                                <div className="kairo-form-group">
                                    <label htmlFor="input-jdk-version">
                                        {t('widget.importWizard.jdkVersion')}:
                                        <input
                                            id="input-jdk-version"
                                            type="text"
                                            className="theia-input"
                                            data-testid="input-jdk-version"
                                            value={jdkVersion}
                                            onChange={e => setJdkVersion(e.target.value)}
                                            aria-label={t('widget.importWizard.jdkVersionAria')}
                                        />
                                    </label>
                                </div>
                            </div>
                            <div className="kairo-form-row">
                                <div className="kairo-form-group">
                                    <label htmlFor="select-source-version">
                                        {t('widget.importWizard.sourceVersion')}:
                                        <select
                                            id="select-source-version"
                                            className="theia-select"
                                            data-testid="select-source-version"
                                            value={sourceVersion}
                                            onChange={e => setSourceVersion(e.target.value)}
                                            aria-label={t('widget.importWizard.sourceVersionAria')}
                                        >
                                            <option value="1.5">1.5</option>
                                            <option value="1.6">1.6</option>
                                            <option value="1.7">1.7</option>
                                            <option value="1.8">1.8</option>
                                        </select>
                                    </label>
                                </div>
                                <div className="kairo-form-group">
                                    <label htmlFor="select-target-version">
                                        {t('widget.importWizard.targetVersion')}:
                                        <select
                                            id="select-target-version"
                                            className="theia-select"
                                            data-testid="select-target-version"
                                            value={targetVersion}
                                            onChange={e => setTargetVersion(e.target.value)}
                                            aria-label={t('widget.importWizard.targetVersionAria')}
                                        >
                                            <option value="1.5">1.5</option>
                                            <option value="1.6">1.6</option>
                                            <option value="1.7">1.7</option>
                                            <option value="1.8">1.8</option>
                                        </select>
                                    </label>
                                </div>
                            </div>
                            <div className="kairo-form-row">
                                <div className="kairo-form-group">
                                    <label htmlFor="input-output-dir">
                                        {t('widget.importWizard.outputDir')}:
                                        <input
                                            id="input-output-dir"
                                            type="text"
                                            className="theia-input"
                                            data-testid="input-output-dir"
                                            value={outputDir}
                                            onChange={e => setOutputDir(e.target.value)}
                                            aria-label={t('widget.importWizard.outputDirAria')}
                                        />
                                    </label>
                                </div>
                                <div className="kairo-form-group">
                                    <label htmlFor="select-build-tool">
                                        {t('widget.importWizard.buildTool')}:
                                        <select
                                            id="select-build-tool"
                                            className="theia-select"
                                            data-testid="select-build-tool"
                                            value={buildTool}
                                            onChange={e => setBuildTool(e.target.value)}
                                            aria-label={t('widget.importWizard.buildToolAria')}
                                        >
                                            <option value="ant">{t('widget.importWizard.ant')}</option>
                                            <option value="javac">{t('widget.importWizard.javac')}</option>
                                        </select>
                                    </label>
                                </div>
                            </div>
                            <div className="kairo-form-group">
                                <label htmlFor="input-build-script">
                                    {t('widget.importWizard.buildScript')}:
                                    <input
                                        id="input-build-script"
                                        type="text"
                                        className="theia-input"
                                        data-testid="input-build-script"
                                        value={buildScript}
                                        onChange={e => setBuildScript(e.target.value)}
                                        aria-label={t('widget.importWizard.buildScriptAria')}
                                    />
                                </label>
                            </div>
                            <div className="kairo-form-group">
                                <label htmlFor="input-context-path">
                                    {t('widget.importWizard.contextPath')}:
                                    <input
                                        id="input-context-path"
                                        type="text"
                                        data-testid="input-context-path"
                                        value={contextPath}
                                        onChange={e => setContextPath(e.target.value)}
                                        aria-label={t('widget.importWizard.contextPathAria')}
                                    />
                                </label>
                            </div>
                            {detected && detected.warnings && detected.warnings.length > 0 && (
                                <div className="kairo-warnings" data-testid="detection-warnings">
                                    <strong>{t('widget.importWizard.warningsTitle')}</strong>
                                    <ul>
                                        {detected.warnings.map((w, i) => (
                                            <li key={i}>{w}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <div className="kairo-wizard-actions">
                                <button
                                    type="button"
                                    className="theia-button secondary"
                                    onClick={() => setStep(1)}
                                    data-testid="back-to-select"
                                >
                                    {t('common.back')}
                                </button>
                                <button
                                    type="button"
                                    className="theia-button main"
                                    onClick={handleImport}
                                    disabled={importing}
                                    data-testid="import-project-btn"
                                    aria-label={t('widget.importWizard.import')}
                                >
                                    {importing ? t('widget.importWizard.importing') : t('widget.importWizard.import')}
                                </button>
                            </div>
                            {importError && (
                                <p className="kairo-error" data-testid="import-error" role="alert">
                                    {t('widget.importWizard.errorPrefix', { message: importError })}
                                </p>
                            )}
                        </form>
                    </div>
                )}

                {/* Step 3: Import Complete */}
                {step === 3 && importedSummary && (
                    <div className="kairo-wizard-step-content" data-testid="step-content-3">
                        <p className="kairo-wizard-ready" data-testid="import-ready">
                            {t('widget.importWizard.importReady', { name: importedSummary.name })}
                        </p>
                        <dl className="kairo-info-list">
                            <dt>{t('widget.importWizard.location')}</dt>
                            <dd data-testid="ready-root">{importedSummary.root}</dd>
                            <dt>{t('widget.importWizard.importedEncoding')}</dt>
                            <dd data-testid="ready-encoding">{importedSummary.encoding}</dd>
                        </dl>
                        <p className="kairo-hint">
                            {t('widget.importWizard.importHint')}
                        </p>
                        <div className="kairo-wizard-actions">
                            <button
                                type="button"
                                className="theia-button main"
                                data-testid="open-project-btn"
                                onClick={async () => {
                                    if (importedSummary) {
                                        console.log('[kairo] Open Project Folder clicked', { projectId: importedSummary.projectId, root: importedSummary.root });
                                        try {
                                            // Theia open handlers require a file:// URI.
                                            // Bare Windows paths like "G:/foo" have no scheme
                                            // and fail with "Could not find a handler…".
                                            await workspaceService.open(FileUri.create(importedSummary.root));
                                        } catch (err) {
                                            console.error('[kairo] Failed to open workspace:', err);
                                            onClose();
                                        }
                                    }
                                }}
                            >
                                {t('widget.importWizard.openProjectFolder')}
                            </button>
                            <button
                                type="button"
                                className="theia-button secondary"
                                data-testid="ready-close-btn"
                                onClick={() => onClose()}
                            >
                                {t('common.close')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
