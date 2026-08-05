/**
 * Kairo Maven View Widget — Maven project management UI.
 *
 * Features:
 *   - Parse pom.xml to show dependencies tree
 *   - Show Maven goals (clean, compile, test, package, install)
 *   - Execute Maven goals with progress display
 *   - Show Maven output in console
 *   - Dependency conflict detection
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KairoI18nService } from '@kairo/i18n';
import { RuntimeConnectionService, WorkspaceContextService } from '@kairo/runtime-extension';
import './kairo-custom-build-runner.css';

/** A Maven lifecycle goal. */
export interface MavenGoal {
  id: string;
  label: string;
  description: string;
  phase: string;
}

/** A Maven dependency. */
export interface MavenDependency {
  groupId: string;
  artifactId: string;
  version: string;
  scope: string;
  optional: boolean;
  type: string;
}

/** A dependency tree node. */
export interface MavenDependencyTreeNode {
  groupId: string;
  artifactId: string;
  version: string;
  scope: string;
  optional: boolean;
  type: string;
  children?: MavenDependencyTreeNode[];
}

/** Conflict info for a dependency. */
export interface MavenDependencyConflict {
  groupId: string;
  artifactId: string;
  versions: string[];
  resolvedVersion: string;
  depth: number;
}

/** Project info parsed from pom.xml. */
export interface MavenProjectInfo {
  groupId: string;
  artifactId: string;
  version: string;
  packaging: string;
  name: string;
  description: string;
  found: boolean;
}

/** A Maven build execution result. */
export interface MavenBuildResult {
  task: string;
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
}

/** Default Maven lifecycle goals. */
const DEFAULT_GOALS: MavenGoal[] = [
  { id: 'clean', label: '', description: '', phase: 'clean' },
  { id: 'validate', label: '', description: '', phase: 'validate' },
  { id: 'compile', label: '', description: '', phase: 'compile' },
  { id: 'test', label: '', description: '', phase: 'test' },
  { id: 'package', label: '', description: '', phase: 'package' },
  { id: 'verify', label: '', description: '', phase: 'verify' },
  { id: 'install', label: '', description: '', phase: 'install' },
];

/** Detect dependency conflicts by looking for duplicate groupId:artifactId. */
function detectConflicts(deps: MavenDependency[]): MavenDependencyConflict[] {
  const conflicts: MavenDependencyConflict[] = [];
  const seen = new Map<string, { versions: string[]; depth: number }>();

  for (const dep of deps) {
    const key = `${dep.groupId}:${dep.artifactId}`;
    const existing = seen.get(key);
    if (existing) {
      existing.versions.push(dep.version);
    } else {
      seen.set(key, { versions: [dep.version], depth: 0 });
    }
  }

  for (const [key, info] of seen) {
    const uniqueVersions = [...new Set(info.versions)];
    if (uniqueVersions.length > 1) {
      const [groupId, artifactId] = key.split(':');
      conflicts.push({
        groupId,
        artifactId,
        versions: uniqueVersions,
        resolvedVersion: uniqueVersions[0],
        depth: info.depth,
      });
    }
  }

  return conflicts;
}

function formatCoord(g: string, a: string, v: string): string {
  return `${g}:${a}:${v}`;
}

interface MavenViewState {
  project: MavenProjectInfo | null;
  dependencies: MavenDependency[];
  tree: MavenDependencyTreeNode[];
  conflicts: MavenDependencyConflict[];
  goals: MavenGoal[];
  running: boolean;
  currentTask: string;
  output: string;
  error: string;
  loading: boolean;
  expandedDeps: Set<string>;
  showConflictWarning: boolean;
}

const MavenView: React.FC<{
  i18n: KairoI18nService;
  runtime: RuntimeConnectionService;
  workspaceContext: WorkspaceContextService;
}> = ({ i18n, runtime, workspaceContext }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const [state, setState] = React.useState<MavenViewState>({
    project: null,
    dependencies: [],
    tree: [],
    conflicts: [],
    goals: DEFAULT_GOALS,
    running: false,
    currentTask: '',
    output: '',
    error: '',
    loading: true,
    expandedDeps: new Set(),
    showConflictWarning: false,
  });

  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);

  const resolveRootPath = React.useCallback((): string | undefined => {
    return workspaceContext.context?.workspaceRoot;
  }, [workspaceContext]);

  /** Detect a Maven project via the runtime agent (envelope + secret + workspace root). */
  React.useEffect(() => {
    const detectProject = async () => {
      try {
        const rootPath = resolveRootPath();
        if (!rootPath) {
          setState(prev => ({ ...prev, loading: false }));
          return;
        }
        const data = await runtime.request('POST /api/v1/maven/detect', { rootPath }) as {
          found?: boolean;
          project?: MavenProjectInfo;
          dependencies?: MavenDependency[];
          tree?: MavenDependencyTreeNode[];
        };
        if (data?.found) {
          const detectedConflicts = detectConflicts(data.dependencies || []);
          setState(prev => ({
            ...prev,
            project: data.project || null,
            dependencies: data.dependencies || [],
            tree: data.tree || [],
            conflicts: detectedConflicts,
            loading: false,
            showConflictWarning: detectedConflicts.length > 0,
          }));
          return;
        }
      } catch {
        // Agent not available
      }
      setState(prev => ({ ...prev, loading: false }));
    };
    detectProject();
  }, [runtime, resolveRootPath]);

  /** Run a Maven goal. */
  const runGoal = async (goalId: string) => {
    setState(prev => ({
      ...prev,
      running: true,
      currentTask: goalId,
      output: '',
      error: '',
    }));

    try {
      const rootPath = resolveRootPath();
      if (!rootPath) {
        setState(prev => ({
          ...prev,
          running: false,
          currentTask: '',
          error: 'No workspace root',
        }));
        return;
      }
      const data = await runtime.request(
        'POST /api/v1/maven/run',
        { rootPath, task: goalId, offline: false },
      ) as MavenBuildResult;
      setState(prev => ({
        ...prev,
        running: false,
        currentTask: '',
        output: data.output || '',
        error: data.error || '',
      }));
    } catch (err) {
      setState(prev => ({
        ...prev,
        running: false,
        currentTask: '',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  /** Toggle dependency tree node expansion. */
  const toggleDep = (key: string) => {
    setState(prev => {
      const next = new Set(prev.expandedDeps);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { ...prev, expandedDeps: next };
    });
  };

  /** Render a dependency tree node recursively. */
  const renderTreeNode = (node: MavenDependencyTreeNode, depth: number = 0): React.ReactNode => {
    const key = `${node.groupId}:${node.artifactId}:${node.version}`;
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = state.expandedDeps.has(key);
    const depthClass = `kairo-maven-dep-depth-${Math.min(depth, 5)}`;

    return (
      <div key={key + depth}>
        <div
          className={`kairo-maven-dep-item ${depthClass}`}
          onClick={() => hasChildren && toggleDep(key)}
          role={hasChildren ? 'button' : undefined}
          tabIndex={hasChildren ? 0 : undefined}
          onKeyDown={e => { if (hasChildren && (e.key === 'Enter' || e.key === ' ')) toggleDep(key); }}
        >
          {hasChildren && (
            <span className="kairo-maven-dep-toggle">
              <span className={`codicon ${isExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
            </span>
          )}
          <span className="kairo-maven-dep-coord">{formatCoord(node.groupId, node.artifactId, node.version)}</span>
          <span className={`kairo-maven-dep-scope kairo-maven-scope-${node.scope}`}>{node.scope}</span>
          {node.optional && <span className="kairo-maven-dep-optional">{t('common.optional')}</span>}
        </div>
        {hasChildren && isExpanded && node.children!.map(child => renderTreeNode(child, depth + 1))}
      </div>
    );
  };

  if (state.loading) {
    return (
      <div className="kairo-widget" data-testid="maven-view">
        <div className="kairo-widget-header" data-testid="maven-header">
          <span className="kairo-widget-title">{t('widget.build.maven.title')}</span>
        </div>
        <div className="kairo-widget-body">
          <div className="kairo-empty-state" data-testid="maven-loading">
            <span className="kairo-empty-state-glyph codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
            <h3 className="kairo-empty-state-title">{t('widget.build.maven.loading')}</h3>
          </div>
        </div>
      </div>
    );
  }

  if (!state.project) {
    return (
      <div className="kairo-widget" data-testid="maven-view">
        <div className="kairo-widget-header" data-testid="maven-header">
          <span className="kairo-widget-title">{t('widget.build.maven.title')}</span>
        </div>
        <div className="kairo-widget-body">
          <div className="kairo-empty-state" data-testid="maven-empty">
            <span className="kairo-empty-state-glyph codicon codicon-folder" aria-hidden="true" />
            <h3 className="kairo-empty-state-title">{t('widget.build.maven.empty.noProjectTitle')}</h3>
            <p className="kairo-empty-state-reason">{t('widget.build.maven.empty.noProjectReason')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="kairo-widget" data-testid="maven-view">
      {/* Project Info */}
      <div className="kairo-widget-header" data-testid="maven-header">
        <span className="kairo-widget-title">{t('widget.build.maven.title')}</span>
        <span className="kairo-maven-project-name">
          {state.project.name || `${state.project.groupId}:${state.project.artifactId}`}
        </span>
      </div>

      <div className="kairo-maven-project-info" data-testid="maven-project-info">
        <div className="kairo-maven-info-row">
          <span className="kairo-maven-info-label">{t('widget.build.maven.label.group')}</span>
          <span>{state.project.groupId}</span>
        </div>
        <div className="kairo-maven-info-row">
          <span className="kairo-maven-info-label">{t('widget.build.maven.label.artifact')}</span>
          <span>{state.project.artifactId}</span>
        </div>
        <div className="kairo-maven-info-row">
          <span className="kairo-maven-info-label">{t('widget.build.maven.label.version')}</span>
          <span>{state.project.version}</span>
        </div>
        <div className="kairo-maven-info-row">
          <span className="kairo-maven-info-label">{t('widget.build.maven.label.packaging')}</span>
          <span>{state.project.packaging}</span>
        </div>
        {state.project.description && (
          <div className="kairo-maven-info-row">
            <span className="kairo-maven-info-label">{t('widget.build.maven.label.description')}</span>
            <span>{state.project.description}</span>
          </div>
        )}
      </div>

      {/* Lifecycle Goals */}
      <div className="kairo-widget-section">
        <div className="kairo-section-title">{t('widget.build.maven.section.lifecycleGoals')}</div>
        <div className="kairo-maven-goals" data-testid="maven-goals">
          {state.goals.map(goal => (
            <button
              key={goal.id}
              className="theia-button kairo-maven-goal-button"
              onClick={() => runGoal(goal.id)}
              disabled={state.running}
              title={t(`widget.build.maven.goal.${goal.id}.description`)}
              data-testid={`maven-goal-${goal.id}`}
            >
              {state.running && state.currentTask === goal.id ? (
                <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
              ) : null}
              {t(`widget.build.maven.goal.${goal.id}.label`)}
            </button>
          ))}
        </div>
      </div>

      {/* Dependency Conflicts */}
      {state.showConflictWarning && state.conflicts.length > 0 && (
        <div className="kairo-widget-section">
          <div className="kairo-section-title kairo-section-title-warning">
            <span className="codicon codicon-warning" aria-hidden="true" />
            {t('widget.build.maven.section.conflicts', { count: state.conflicts.length })}
          </div>
          <div className="kairo-maven-conflicts" data-testid="maven-conflicts">
            {state.conflicts.map(conflict => (
              <div key={`${conflict.groupId}:${conflict.artifactId}`} className="kairo-maven-conflict-item">
                <span className="kairo-maven-conflict-coord">
                  {conflict.groupId}:{conflict.artifactId}
                </span>
                <span className="kairo-maven-conflict-versions">
                  {t('widget.build.maven.conflict.versions', { versions: conflict.versions.join(', ') })}
                </span>
                <span className="kairo-maven-conflict-resolved">
                  {t('widget.build.maven.conflict.resolved', { version: conflict.resolvedVersion })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dependency Tree */}
      <div className="kairo-widget-section">
        <div className="kairo-section-title">
          {t('widget.build.maven.section.dependencies', { count: state.dependencies.length })}
        </div>
        {state.tree.length > 0 ? (
          <div className="kairo-maven-dep-tree" data-testid="maven-dep-tree">
            {state.tree.map(node => renderTreeNode(node))}
          </div>
        ) : (
          <div className="kairo-maven-dep-list" data-testid="maven-dep-list">
            {state.dependencies.map(dep => (
              <div key={`${dep.groupId}:${dep.artifactId}:${dep.version}`} className="kairo-maven-dep-item">
                <span className="kairo-maven-dep-coord">{formatCoord(dep.groupId, dep.artifactId, dep.version)}</span>
                <span className={`kairo-maven-dep-scope kairo-maven-scope-${dep.scope}`}>{dep.scope}</span>
                {dep.optional && <span className="kairo-maven-dep-optional">{t('common.optional')}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Build Output */}
      {state.output && (
        <div className="kairo-widget-section">
          <div className="kairo-section-title">
            {state.currentTask || state.error
              ? t('widget.build.maven.output.failed')
              : t('widget.build.maven.output.success')}
          </div>
          <pre className="kairo-maven-output" data-testid="maven-output">{state.output}</pre>
        </div>
      )}

      {state.error && (
        <div className="kairo-widget-section">
          <div className="kairo-error-banner" role="alert" data-testid="maven-error">
            <span className="codicon codicon-error" aria-hidden="true" />
            <span>{state.error}</span>
          </div>
        </div>
      )}
    </div>
  );
};

@injectable()
export class MavenViewWidget extends ReactWidget {
  static readonly ID = 'kairo-maven-view';

  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
  @inject(WorkspaceContextService) protected readonly workspaceContext!: WorkspaceContextService;

  constructor() {
    super();
    this.id = MavenViewWidget.ID;
    this.title.label = '';
    this.title.caption = '';
    this.title.closable = true;
    this.addClass('kairo-widget');
  }

  @postConstruct()
  protected init(): void {
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
    this.update();
  }

  protected updateTitle(): void {
    this.title.label = this.i18n.t('widget.build.maven.title' as any);
    this.title.caption = this.i18n.t('widget.build.maven.caption' as any);
  }

  protected render(): React.ReactNode {
    return <MavenView i18n={this.i18n} runtime={this.runtime} workspaceContext={this.workspaceContext} />;
  }
}
