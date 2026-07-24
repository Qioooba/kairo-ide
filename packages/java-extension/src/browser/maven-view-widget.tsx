import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject } from '@theia/core/shared/inversify';
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

    constructor() {
        super();
        this.id = MavenViewWidget.ID;
        this.title.label = 'Maven';
        this.title.closable = true;
        this.title.caption = 'Maven Project View';
        this.addClass('kairo-widget');
    }

    protected render(): React.ReactNode {
        return React.createElement(MavenView, {
            mavenService: this.mavenService,
        });
    }
}

interface MavenViewProps {
    mavenService: KairoMavenService;
}

const MavenView: React.FC<MavenViewProps> = ({ mavenService }) => {
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
        <div className="kairo-maven-view" data-testid="maven-view">
            {/* Project Path Input */}
            <div className="kairo-maven-toolbar" data-testid="maven-toolbar">
                <input
                    type="text"
                    className="kairo-maven-path-input"
                    data-testid="maven-path-input"
                    placeholder="Project root path..."
                    value={rootPath}
                    onChange={e => setRootPath(e.target.value)}
                />
                <button
                    className="kairo-maven-detect-btn"
                    data-testid="maven-detect-btn"
                    onClick={handleDetect}
                >
                    Detect
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
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="kairo-maven-content" data-testid="maven-content">
                {!result && (
                    <p className="kairo-maven-empty" data-testid="maven-empty">
                        Enter a project path and click Detect to scan for pom.xml.
                    </p>
                )}
                {result && !result.found && (
                    <p className="kairo-maven-not-found" data-testid="maven-not-found">
                        No pom.xml found at the specified path.
                    </p>
                )}
                {result && result.found && activeTab === 'overview' && (
                    <OverviewTab result={result} />
                )}
                {result && result.found && activeTab === 'dependencies' && (
                    <DependenciesTab result={result} onRefresh={handleRefreshDeps} />
                )}
                {result && result.found && activeTab === 'lifecycle' && (
                    <LifecycleTab result={result} progress={progress} buildOutput={buildOutput} onRunTask={handleRunTask} />
                )}
                {result && result.found && activeTab === 'modules' && (
                    <ModulesTab result={result} />
                )}
            </div>
        </div>
    );
};

// ── Overview Tab ────────────────────────────────────────────────

const OverviewTab: React.FC<{ result: MavenDetectResult }> = ({ result }) => {
    const p = result.project;
    if (!p) return null;

    return (
        <div className="kairo-maven-overview" data-testid="maven-overview">
            <h3 className="kairo-maven-section-title">Project Info</h3>
            <table className="kairo-maven-info-table" data-testid="maven-info-table">
                <tbody>
                    <InfoRow label="Group ID" value={p.groupId} />
                    <InfoRow label="Artifact ID" value={p.artifactId} />
                    <InfoRow label="Version" value={p.version} />
                    <InfoRow label="Packaging" value={p.packaging} />
                    <InfoRow label="Name" value={p.name || '-'} />
                    <InfoRow label="Description" value={p.description || '-'} />
                    <InfoRow label="Build Dir" value={p.buildDir} />
                    <InfoRow label="Output Dir" value={p.outputDir} />
                </tbody>
            </table>

            <h3 className="kairo-maven-section-title">Quick Summary</h3>
            <div className="kairo-maven-summary" data-testid="maven-summary">
                <span className="kairo-maven-summary-item">
                    {result.dependencies.length} dependencies
                </span>
                <span className="kairo-maven-summary-item">
                    {result.conflicts?.length ?? 0} conflicts
                </span>
                <span className="kairo-maven-summary-item">
                    {result.tasks.length} lifecycle tasks
                </span>
            </div>
        </div>
    );
};

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <tr>
        <td className="kairo-maven-info-label">{label}</td>
        <td className="kairo-maven-info-value">{value}</td>
    </tr>
);

// ── Dependencies Tab ─────────────────────────────────────────────

const DependenciesTab: React.FC<{
    result: MavenDetectResult;
    onRefresh: () => void;
}> = ({ result, onRefresh }) => {
    const conflicts = result.conflicts || [];
    const tree = result.tree || [];

    return (
        <div className="kairo-maven-dependencies" data-testid="maven-dependencies">
            <div className="kairo-maven-deps-header">
                <h3 className="kairo-maven-section-title">Dependency Tree</h3>
                <button
                    className="kairo-maven-refresh-btn"
                    data-testid="maven-refresh-deps"
                    onClick={onRefresh}
                >
                    Refresh
                </button>
            </div>

            {/* Conflict Detection */}
            {conflicts.length > 0 && (
                <div className="kairo-maven-conflicts" data-testid="maven-conflicts">
                    <h4 className="kairo-maven-subsection-title">
                        Conflicts ({conflicts.length})
                    </h4>
                    {conflicts.map((c, i) => (
                        <ConflictItem key={i} conflict={c} />
                    ))}
                </div>
            )}

            {/* Dependency Tree */}
            <div className="kairo-maven-tree" data-testid="maven-dep-tree">
                {tree.length === 0 && (
                    <p className="kairo-maven-empty">No dependencies found.</p>
                )}
                {tree.map((node, i) => (
                    <TreeNodeComponent key={i} node={node} depth={0} />
                ))}
            </div>
        </div>
    );
};

const ConflictItem: React.FC<{ conflict: MavenDependencyConflict }> = ({ conflict }) => (
    <div className="kairo-maven-conflict-item" data-testid="maven-conflict-item">
        <span className="kairo-maven-conflict-artifact">
            {conflict.groupId}:{conflict.artifactId}
        </span>
        <span className="kairo-maven-conflict-versions">
            Versions: {conflict.versions.join(', ')}
        </span>
        <span className="kairo-maven-conflict-resolved">
            Resolved: {conflict.resolvedVersion}
        </span>
    </div>
);

const TreeNodeComponent: React.FC<{ node: MavenDependencyTreeNode; depth: number }> = ({ node, depth }) => {
    const [expanded, setExpanded] = React.useState(true);
    const hasChildren = node.children && node.children.length > 0;
    const paddingLeft = depth * 16 + 8;

    const scopeColor = node.scope === 'test' ? 'var(--theia-testing-iconFailed)'
        : node.scope === 'provided' ? 'var(--theia-editorWarning-foreground)'
        : 'var(--theia-foreground)';

    return (
        <div>
            <div
                className="kairo-maven-tree-node"
                style={{ paddingLeft: `${paddingLeft}px`, cursor: 'pointer', display: 'flex', alignItems: 'center', height: '22px' }}
                data-testid={`dep-node-${node.artifactId}`}
            >
                <span
                    style={{ width: '16px', flexShrink: 0, textAlign: 'center', cursor: 'pointer' }}
                    onClick={() => setExpanded(!expanded)}
                >
                    {hasChildren ? (expanded ? '▾' : '▸') : ' '}
                </span>
                <span style={{ color: scopeColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {node.groupId}:{node.artifactId}:{node.version}
                    {node.optional && <span style={{ fontStyle: 'italic', marginLeft: '4px' }}>(optional)</span>}
                </span>
                <span style={{ marginLeft: '8px', fontSize: '11px', opacity: 0.7 }}>
                    [{node.scope}]
                </span>
            </div>
            {expanded && hasChildren && node.children!.map((child, i) => (
                <TreeNodeComponent key={i} node={child} depth={depth + 1} />
            ))}
        </div>
    );
};

// ── Lifecycle Tab ────────────────────────────────────────────────

const LifecycleTab: React.FC<{
    result: MavenDetectResult;
    progress: MavenBuildProgress | null;
    buildOutput: string;
    onRunTask: (task: string) => void;
}> = ({ result, progress, buildOutput, onRunTask }) => {
    const [runningTask, setRunningTask] = React.useState<string | null>(null);

    const handleRun = async (task: MavenLifecycleTask) => {
        setRunningTask(task.id);
        await onRunTask(task.id);
        setRunningTask(null);
    };

    return (
        <div className="kairo-maven-lifecycle" data-testid="maven-lifecycle">
            <h3 className="kairo-maven-section-title">Lifecycle Phases</h3>

            {/* Build Progress */}
            {progress && (
                <div className="kairo-maven-progress" data-testid="maven-build-progress">
                    <div className="kairo-maven-progress-header">
                        <span className={`kairo-maven-progress-status ${progress.status}`}>
                            {progress.status === 'running' ? '⏳' : progress.status === 'success' ? '✅' : '❌'}
                            {' '}{progress.status.toUpperCase()}
                        </span>
                        <span className="kairo-maven-progress-phase">{progress.phase}</span>
                    </div>
                    <div className="kairo-maven-progress-bar-container">
                        <div
                            className={`kairo-maven-progress-bar ${progress.status}`}
                            style={{ width: `${progress.percentComplete}%` }}
                            data-testid="maven-progress-bar"
                        />
                    </div>
                    <p className="kairo-maven-progress-message">{progress.message}</p>
                </div>
            )}

            {/* Build Output */}
            {buildOutput && (
                <div className="kairo-maven-output" data-testid="maven-build-output">
                    <h4 className="kairo-maven-subsection-title">Build Output</h4>
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
                            className="kairo-maven-phase-run-btn"
                            data-testid={`maven-run-${task.id}`}
                            disabled={runningTask === task.id}
                            onClick={() => handleRun(task)}
                        >
                            {runningTask === task.id ? 'Running...' : 'Run'}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ── Modules Tab ──────────────────────────────────────────────────

const ModulesTab: React.FC<{ result: MavenDetectResult }> = ({ result }) => {
    return (
        <div className="kairo-maven-modules" data-testid="maven-modules">
            <h3 className="kairo-maven-section-title">Multi-Module Project Tree</h3>
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
                    />
                )}
            </div>
        </div>
    );
};

const ModuleNodeComponent: React.FC<{
    artifactId: string;
    packaging: string;
    name: string;
    isRoot: boolean;
    depth: number;
}> = ({ artifactId, packaging, name, isRoot, depth }) => {
    const paddingLeft = depth * 16 + 8;
    const icon = packaging === 'pom' ? '📦' : packaging === 'war' ? '🌐' : '📄';

    return (
        <div
            className="kairo-maven-module-node"
            style={{ paddingLeft: `${paddingLeft}px`, height: '24px', display: 'flex', alignItems: 'center' }}
            data-testid={`module-node-${artifactId}`}
        >
            <span>{icon}</span>
            <span style={{ marginLeft: '6px', fontWeight: isRoot ? 'bold' : 'normal' }}>
                {name}
            </span>
            <span style={{ marginLeft: '8px', fontSize: '11px', opacity: 0.7 }}>
                [{packaging}]
            </span>
            {isRoot && <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--theia-badge-background)' }}>(root)</span>}
        </div>
    );
};