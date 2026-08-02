import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { KairoI18nService } from '@kairo/i18n';
import { KairoMavenService, MavenDetectResult, MavenDependencyConflict, MavenDependencyTreeNode, MavenLifecycleTask, MavenBuildProgress, MavenViewTab } from './maven-service';

/**
 * Maven View Widget — displays Maven project information including
 * multi-module project tree, dependency conflicts, lifecycle phase
 * visualization, and build progress.
 */
@injectable()
export class MavenViewWidget extends ReactWidget {
    static readonly ID = 'kairo-maven-view';

    @inject(KairoMavenService)
    protected readonly mavenService!: KairoMavenService;

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    constructor() {
        super();
        this.id = MavenViewWidget.ID;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-package';
        this.addClass('kairo-widget');
        this.addClass('kairo-maven-view');
    }

    @postConstruct()
    protected init(): void {
        this.updateTitle();
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
    }

    protected t(key: string, params?: Record<string, string | number>): string {
        return this.i18n.t(key as any, params);
    }

    protected updateTitle(): void {
        this.title.label = this.t('widget.java.maven.title');
        this.title.caption = this.t('widget.java.maven.caption');
    }

    protected render(): React.ReactNode {
        return React.createElement(MavenView, {
            mavenService: this.mavenService,
            i18n: this.i18n,
        });
    }
}

interface MavenViewProps {
    mavenService: KairoMavenService;
    i18n: KairoI18nService;
}

const MavenView: React.FC<MavenViewProps> = ({ mavenService, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [result, setResult] = React.useState<MavenDetectResult | null>(mavenService.getDetectResult());
    const [progress, setProgress] = React.useState<MavenBuildProgress | null>(null);
    const [activeTab, setActiveTab] = React.useState<MavenViewTab>(mavenService.getActiveTab());
    const [rootPath, setRootPath] = React.useState(mavenService.getRootPath());
    const [buildOutput, setBuildOutput] = React.useState<string>('');

    React.useEffect(() => {
        const sub = mavenService.onState(s => setResult(s));
        return () => sub.dispose();
    }, [mavenService]);

    React.useEffect(() => {
        const sub = mavenService.onProgress(p => setProgress(p));
        return () => sub.dispose();
    }, [mavenService]);

    const handleTabChange = (tab: MavenViewTab) => {
        setActiveTab(tab);
        mavenService.setActiveTab(tab);
    };

    const handleDetect = async () => {
        const r = await mavenService.detect(rootPath);
        if (r) setResult(r);
    };

    const handleRunTask = async (task: string) => {
        setBuildOutput('');
        const r = await mavenService.runTask(task);
        if (r) {
            setBuildOutput(r.output || r.error || '');
        }
    };

    const handleRefreshDeps = async () => {
        const r = await mavenService.getDependencies(false);
        if (r) setResult(r);
    };

    return (
        <div className="kairo-widget kairo-maven-view" data-testid="maven-view">
            {/* Project Path Input */}
            <div className="kairo-widget-toolbar kairo-maven-toolbar" data-testid="maven-toolbar">
                <input
                    type="text"
                    className="theia-input kairo-maven-path-input"
                    data-testid="maven-path-input"
                    placeholder={t('widget.java.maven.pathPlaceholder')}
                    value={rootPath}
                    onChange={e => setRootPath(e.target.value)}
                />
                <button
                    className="theia-button kairo-maven-detect-btn"
                    data-testid="maven-detect-btn"
                    onClick={handleDetect}
                >
                    {t('widget.java.maven.detect')}
                </button>
            </div>

            {/* Tab Navigation */}
            <div className="kairo-maven-tabs" data-testid="maven-tabs">
                {(['overview', 'dependencies', 'lifecycle', 'modules'] as MavenViewTab[]).map(tab => (
                    <button
                        key={tab}
                        className={`kairo-maven-tab${activeTab === tab ? ' active' : ''}`}
                        data-testid={`maven-tab-${tab}`}
                        onClick={() => handleTabChange(tab)}
                    >
                        {t(`widget.java.maven.tab.${tab}`)}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="kairo-widget-body kairo-maven-content" data-testid="maven-content">
                {!result && (
                    <p className="kairo-empty kairo-maven-empty" data-testid="maven-empty">
                        {t('widget.java.maven.empty.detectPrompt')}
                    </p>
                )}
                {result && !result.found && (
                    <div className="kairo-error-banner kairo-maven-not-found" role="alert" data-testid="maven-not-found">
                        <span className="codicon codicon-error" aria-hidden="true" />
                        <span>{t('widget.java.maven.empty.notFound')}</span>
                    </div>
                )}
                {result && result.found && activeTab === 'overview' && (
                    <OverviewTab result={result} i18n={i18n} />
                )}
                {result && result.found && activeTab === 'dependencies' && (
                    <DependenciesTab result={result} onRefresh={handleRefreshDeps} i18n={i18n} />
                )}
                {result && result.found && activeTab === 'lifecycle' && (
                    <LifecycleTab result={result} progress={progress} buildOutput={buildOutput} onRunTask={handleRunTask} i18n={i18n} />
                )}
                {result && result.found && activeTab === 'modules' && (
                    <ModulesTab result={result} i18n={i18n} />
                )}
            </div>
        </div>
    );
};

// ── Overview Tab ────────────────────────────────────────────────

interface OverviewTabProps {
    result: MavenDetectResult;
    i18n: KairoI18nService;
}

const OverviewTab: React.FC<OverviewTabProps> = ({ result, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const p = result.project;
    if (!p) return null;

    return (
        <div className="kairo-maven-overview" data-testid="maven-overview">
            <h3 className="kairo-section-title kairo-maven-section-title">{t('widget.java.maven.overview.projectInfo')}</h3>
            <div className="kairo-maven-project-info" data-testid="maven-info-table">
                <InfoRow label={t('widget.java.maven.overview.groupId')} value={p.groupId} i18n={i18n} />
                <InfoRow label={t('widget.java.maven.overview.artifactId')} value={p.artifactId} i18n={i18n} />
                <InfoRow label={t('widget.java.maven.overview.version')} value={p.version} i18n={i18n} />
                <InfoRow label={t('widget.java.maven.overview.packaging')} value={p.packaging} i18n={i18n} />
                <InfoRow label={t('widget.java.maven.overview.name')} value={p.name} i18n={i18n} />
                <InfoRow label={t('widget.java.maven.overview.description')} value={p.description} i18n={i18n} />
                <InfoRow label={t('widget.java.maven.overview.buildDir')} value={p.buildDir} i18n={i18n} />
                <InfoRow label={t('widget.java.maven.overview.outputDir')} value={p.outputDir} i18n={i18n} />
            </div>

            <h3 className="kairo-section-title kairo-maven-section-title">{t('widget.java.maven.overview.summary')}</h3>
            <div className="kairo-maven-summary" data-testid="maven-summary">
                <span className="kairo-maven-summary-item">
                    {t('widget.java.maven.overview.dependencyCount', { count: result.dependencies.length })}
                </span>
                <span className="kairo-maven-summary-item">
                    {t('widget.java.maven.overview.conflictCount', { count: result.conflicts?.length ?? 0 })}
                </span>
                <span className="kairo-maven-summary-item">
                    {t('widget.java.maven.overview.taskCount', { count: result.tasks.length })}
                </span>
            </div>
        </div>
    );
};

interface InfoRowProps {
    label: string;
    value: string | undefined;
    i18n: KairoI18nService;
}

const InfoRow: React.FC<InfoRowProps> = ({ label, value, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const displayValue = value || t('widget.java.maven.emptyValue');
    return (
        <div className="kairo-maven-info-row">
            <span className="kairo-maven-info-label">{label}</span>
            <span className="kairo-maven-info-value">{displayValue}</span>
        </div>
    );
};

// ── Dependencies Tab ─────────────────────────────────────────────

interface DependenciesTabProps {
    result: MavenDetectResult;
    onRefresh: () => void;
    i18n: KairoI18nService;
}

const DependenciesTab: React.FC<DependenciesTabProps> = ({ result, onRefresh, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const conflicts = result.conflicts || [];
    const tree = result.tree || [];

    return (
        <div className="kairo-maven-dependencies" data-testid="maven-dependencies">
            <div className="kairo-maven-deps-header">
                <h3 className="kairo-section-title kairo-maven-section-title">{t('widget.java.maven.dependencies.title')}</h3>
                <button
                    className="theia-button kairo-maven-refresh-btn"
                    data-testid="maven-refresh-deps"
                    onClick={onRefresh}
                >
                    {t('widget.java.maven.dependencies.refresh')}
                </button>
            </div>

            {/* Conflict Detection */}
            {conflicts.length > 0 && (
                <div className="kairo-maven-conflicts" data-testid="maven-conflicts">
                    <h4 className="kairo-section-title kairo-maven-subsection-title">
                        {t('widget.java.maven.dependencies.conflictsTitle', { count: conflicts.length })}
                    </h4>
                    {conflicts.map((c, i) => (
                        <ConflictItem key={i} conflict={c} i18n={i18n} />
                    ))}
                </div>
            )}

            {/* Dependency Tree */}
            <div className="kairo-maven-tree" data-testid="maven-dep-tree">
                {tree.length === 0 && (
                    <p className="kairo-empty kairo-maven-empty">{t('widget.java.maven.dependencies.noDependencies')}</p>
                )}
                {tree.map((node, i) => (
                    <TreeNodeComponent key={i} node={node} depth={0} i18n={i18n} />
                ))}
            </div>
        </div>
    );
};

interface ConflictItemProps {
    conflict: MavenDependencyConflict;
    i18n: KairoI18nService;
}

const ConflictItem: React.FC<ConflictItemProps> = ({ conflict, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    return (
        <div className="kairo-maven-conflict-item" data-testid="maven-conflict-item">
            <span className="kairo-maven-conflict-coord">
                {conflict.groupId}:{conflict.artifactId}
            </span>
            <span className="kairo-maven-conflict-versions">
                {t('widget.java.maven.dependencies.versions', { versions: conflict.versions.join(', ') })}
            </span>
            <span className="kairo-maven-conflict-resolved">
                {t('widget.java.maven.dependencies.resolved', { version: conflict.resolvedVersion })}
            </span>
        </div>
    );
};

interface TreeNodeComponentProps {
    node: MavenDependencyTreeNode;
    depth: number;
    i18n: KairoI18nService;
}

const TreeNodeComponent: React.FC<TreeNodeComponentProps> = ({ node, depth, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [expanded, setExpanded] = React.useState(true);
    const hasChildren = node.children && node.children.length > 0;
    const scopeClass = `kairo-maven-scope-${node.scope}`;

    return (
        <div>
            <div
                className="kairo-maven-dep-item"
                style={{ ['--kairo-maven-dep-depth' as any]: depth }}
                data-testid={`dep-node-${node.artifactId}`}
            >
                <span
                    className="kairo-maven-dep-toggle codicon"
                    onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}
                >
                    {hasChildren ? (expanded ? <span className="codicon codicon-chevron-down" aria-hidden="true" /> : <span className="codicon codicon-chevron-right" aria-hidden="true" />) : null}
                </span>
                <span className={`kairo-maven-dep-coord ${scopeClass}`}>
                    {node.groupId}:{node.artifactId}:{node.version}
                    {node.optional && <span className="kairo-maven-dep-optional">({t('widget.java.maven.dependencies.optional')})</span>}
                </span>
                <span className="kairo-maven-dep-scope">
                    {node.scope}
                </span>
            </div>
            {expanded && hasChildren && node.children!.map((child, i) => (
                <TreeNodeComponent key={i} node={child} depth={depth + 1} i18n={i18n} />
            ))}
        </div>
    );
};

// ── Lifecycle Tab ────────────────────────────────────────────────

interface LifecycleTabProps {
    result: MavenDetectResult;
    progress: MavenBuildProgress | null;
    buildOutput: string;
    onRunTask: (task: string) => void;
    i18n: KairoI18nService;
}

const LifecycleTab: React.FC<LifecycleTabProps> = ({ result, progress, buildOutput, onRunTask, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [runningTask, setRunningTask] = React.useState<string | null>(null);

    const handleRun = async (task: MavenLifecycleTask) => {
        setRunningTask(task.id);
        await onRunTask(task.id);
        setRunningTask(null);
    };

    const progressIcon = (status: MavenBuildProgress['status']): string => {
        switch (status) {
            case 'running': return 'codicon codicon-sync codicon-modifier-spin';
            case 'success': return 'codicon codicon-check';
            case 'failed': return 'codicon codicon-error';
            default: return 'codicon codicon-circle-outline';
        }
    };

    return (
        <div className="kairo-maven-lifecycle" data-testid="maven-lifecycle">
            <h3 className="kairo-section-title kairo-maven-section-title">{t('widget.java.maven.lifecycle.title')}</h3>

            {/* Build Progress */}
            {progress && (
                <div className="kairo-maven-progress" data-testid="maven-build-progress">
                    <div className="kairo-maven-progress-header">
                        <span className={`kairo-maven-progress-status ${progress.status}`}>
                            <span className={progressIcon(progress.status)} aria-hidden="true" />
                            {' '}{t(`widget.java.maven.lifecycle.status.${progress.status}`)}
                        </span>
                        <span className="kairo-maven-progress-phase">{progress.phase}</span>
                    </div>
                    <div className="kairo-maven-progress-bar-container">
                        <div
                            className={`kairo-maven-progress-bar ${progress.status}`}
                            style={{ ['--kairo-maven-progress-width' as any]: `${progress.percentComplete}%` }}
                            data-testid="maven-progress-bar"
                        />
                    </div>
                    <p className="kairo-maven-progress-message">{progress.message}</p>
                </div>
            )}

            {/* Build Output */}
            {buildOutput && (
                <div className="kairo-maven-output" data-testid="maven-build-output">
                    <h4 className="kairo-section-title kairo-maven-subsection-title">{t('widget.java.maven.lifecycle.outputTitle')}</h4>
                    <pre className="kairo-maven-output-text">{buildOutput}</pre>
                </div>
            )}

            {/* Phase List */}
            <div className="kairo-maven-phase-list" data-testid="maven-phase-list">
                {result.tasks.map(task => (
                    <div
                        key={task.id}
                        className="kairo-maven-phase-item"
                        data-testid={`maven-phase-${task.id}`}
                    >
                        <div className="kairo-maven-phase-info">
                            <span className="kairo-maven-phase-label">{task.label}</span>
                            <span className="kairo-maven-phase-desc">{task.description}</span>
                        </div>
                        <button
                            className="theia-button kairo-maven-phase-run-btn"
                            data-testid={`maven-run-${task.id}`}
                            disabled={runningTask === task.id}
                            onClick={() => handleRun(task)}
                        >
                            {runningTask === task.id
                                ? t('widget.java.maven.lifecycle.running')
                                : t('widget.java.maven.lifecycle.run')}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ── Modules Tab ──────────────────────────────────────────────────

interface ModulesTabProps {
    result: MavenDetectResult;
    i18n: KairoI18nService;
}

const ModulesTab: React.FC<ModulesTabProps> = ({ result, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    return (
        <div className="kairo-maven-modules" data-testid="maven-modules">
            <h3 className="kairo-section-title kairo-maven-section-title">{t('widget.java.maven.modules.title')}</h3>
            {result.warnings && result.warnings.length > 0 && (
                <div className="kairo-maven-warnings" data-testid="maven-warnings">
                    {result.warnings.map((w, i) => (
                        <p key={i} className="kairo-maven-warning">{w}</p>
                    ))}
                </div>
            )}
            <div className="kairo-maven-module-tree" data-testid="maven-module-tree">
                {result.project && (
                    <ModuleNodeComponent
                        artifactId={result.project.artifactId}
                        packaging={result.project.packaging}
                        name={result.project.name || result.project.artifactId}
                        isRoot={true}
                        depth={0}
                        i18n={i18n}
                    />
                )}
            </div>
        </div>
    );
};

interface ModuleNodeComponentProps {
    artifactId: string;
    packaging: string;
    name: string;
    isRoot: boolean;
    depth: number;
    i18n: KairoI18nService;
}

const ModuleNodeComponent: React.FC<ModuleNodeComponentProps> = ({ artifactId, packaging, name, isRoot, depth, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const iconClass = packaging === 'pom' ? 'codicon-package' : packaging === 'war' ? 'codicon-globe' : 'codicon-file';

    return (
        <div
            className="kairo-maven-module-node"
            style={{ ['--kairo-maven-module-depth' as any]: depth }}
            data-testid={`module-node-${artifactId}`}
        >
            <span className={`codicon ${iconClass}`} aria-hidden="true" />
            <span className="kairo-maven-module-name">{name}</span>
            <span className="kairo-maven-module-packaging">[{packaging}]</span>
            {isRoot && <span className="kairo-maven-module-root">({t('widget.java.maven.modules.root')})</span>}
        </div>
    );
};
