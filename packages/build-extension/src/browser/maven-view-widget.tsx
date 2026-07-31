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
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';

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
  { id: 'clean', label: 'Clean', description: 'Delete target/ directory', phase: 'clean' },
  { id: 'validate', label: 'Validate', description: 'Validate project structure', phase: 'validate' },
  { id: 'compile', label: 'Compile', description: 'Compile Java sources', phase: 'compile' },
  { id: 'test', label: 'Test', description: 'Run unit tests', phase: 'test' },
  { id: 'package', label: 'Package', description: 'Package into JAR/WAR', phase: 'package' },
  { id: 'verify', label: 'Verify', description: 'Run integration tests', phase: 'verify' },
  { id: 'install', label: 'Install', description: 'Install to local repository', phase: 'install' },
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

const MavenView: React.FC = () => {
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

  /** Simulate detecting a Maven project by fetching pom.xml metadata. */
  React.useEffect(() => {
    const detectProject = async () => {
      try {
        const response = await fetch('/api/v1/maven/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rootPath: '.' }),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.found) {
            setState(prev => ({
              ...prev,
              project: data.project || null,
              dependencies: data.dependencies || [],
              tree: data.tree || [],
              conflicts: detectConflicts(data.dependencies || []),
              loading: false,
              showConflictWarning: (detectConflicts(data.dependencies || [])).length > 0,
            }));
            return;
          }
        }
      } catch {
        // Agent not available
      }
      setState(prev => ({ ...prev, loading: false }));
    };
    detectProject();
  }, []);

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
      const response = await fetch('/api/v1/maven/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootPath: '.', task: goalId, offline: false }),
      });
      const data: MavenBuildResult = await response.json();
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

    return (
      <div key={key + depth}>
        <div
          className="kairo-maven-dep-item"
          style={{ '--kairo-maven-dep-depth': depth } as React.CSSProperties}
          onClick={() => hasChildren && toggleDep(key)}
          role={hasChildren ? 'button' : undefined}
          tabIndex={hasChildren ? 0 : undefined}
          onKeyDown={e => { if (hasChildren && (e.key === 'Enter' || e.key === ' ')) toggleDep(key); }}
        >
          {hasChildren && (
            <span className="kairo-maven-dep-toggle">{isExpanded ? '\u25BC' : '\u25B6'}</span>
          )}
          <span className="kairo-maven-dep-coord">{formatCoord(node.groupId, node.artifactId, node.version)}</span>
          <span className={`kairo-maven-dep-scope kairo-maven-scope-${node.scope}`}>{node.scope}</span>
          {node.optional && <span className="kairo-maven-dep-optional">optional</span>}
        </div>
        {hasChildren && isExpanded && node.children!.map(child => renderTreeNode(child, depth + 1))}
      </div>
    );
  };

  if (state.loading) {
    return (
      <div className="kairo-widget">
        <div className="kairo-widget-header">
          <span className="kairo-widget-title">Maven</span>
        </div>
        <p className="kairo-empty">Detecting Maven project...</p>
      </div>
    );
  }

  if (!state.project) {
    return (
      <div className="kairo-widget">
        <div className="kairo-widget-header">
          <span className="kairo-widget-title">Maven</span>
        </div>
        <p className="kairo-empty">No pom.xml found in workspace. Open a Maven project to use this view.</p>
      </div>
    );
  }

  return (
    <div className="kairo-widget">
      {/* Project Info */}
      <div className="kairo-widget-header">
        <span className="kairo-widget-title">Maven</span>
        <span className="kairo-maven-project-name">
          {state.project.name || `${state.project.groupId}:${state.project.artifactId}`}
        </span>
      </div>

      <div className="kairo-maven-project-info">
        <div className="kairo-maven-info-row">
          <span className="kairo-maven-info-label">Group:</span>
          <span>{state.project.groupId}</span>
        </div>
        <div className="kairo-maven-info-row">
          <span className="kairo-maven-info-label">Artifact:</span>
          <span>{state.project.artifactId}</span>
        </div>
        <div className="kairo-maven-info-row">
          <span className="kairo-maven-info-label">Version:</span>
          <span>{state.project.version}</span>
        </div>
        <div className="kairo-maven-info-row">
          <span className="kairo-maven-info-label">Packaging:</span>
          <span>{state.project.packaging}</span>
        </div>
        {state.project.description && (
          <div className="kairo-maven-info-row">
            <span className="kairo-maven-info-label">Description:</span>
            <span>{state.project.description}</span>
          </div>
        )}
      </div>

      {/* Lifecycle Goals */}
      <div className="kairo-widget-section">
        <div className="kairo-section-title">Lifecycle Goals</div>
        <div className="kairo-maven-goals">
          {state.goals.map(goal => (
            <button
              key={goal.id}
              className="theia-button kairo-maven-goal-button"
              onClick={() => runGoal(goal.id)}
              disabled={state.running}
              title={goal.description}
            >
              {state.running && state.currentTask === goal.id ? (
                <span className="kairo-maven-spinner">\u25D0 </span>
              ) : null}
              {goal.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dependency Conflicts */}
      {state.showConflictWarning && state.conflicts.length > 0 && (
        <div className="kairo-widget-section">
          <div className="kairo-section-title kairo-section-title-warning">
            \u26A0 Dependency Conflicts ({state.conflicts.length})
          </div>
          <div className="kairo-maven-conflicts">
            {state.conflicts.map(conflict => (
              <div key={`${conflict.groupId}:${conflict.artifactId}`} className="kairo-maven-conflict-item">
                <span className="kairo-maven-conflict-coord">
                  {conflict.groupId}:{conflict.artifactId}
                </span>
                <span className="kairo-maven-conflict-versions">
                  Versions: {conflict.versions.join(', ')}
                </span>
                <span className="kairo-maven-conflict-resolved">
                  Resolved: {conflict.resolvedVersion}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dependency Tree */}
      <div className="kairo-widget-section">
        <div className="kairo-section-title">
          Dependencies ({state.dependencies.length})
        </div>
        {state.tree.length > 0 ? (
          <div className="kairo-maven-dep-tree">
            {state.tree.map(node => renderTreeNode(node))}
          </div>
        ) : (
          <div className="kairo-maven-dep-list">
            {state.dependencies.map(dep => (
              <div key={`${dep.groupId}:${dep.artifactId}:${dep.version}`} className="kairo-maven-dep-item">
                <span className="kairo-maven-dep-coord">{formatCoord(dep.groupId, dep.artifactId, dep.version)}</span>
                <span className={`kairo-maven-dep-scope kairo-maven-scope-${dep.scope}`}>{dep.scope}</span>
                {dep.optional && <span className="kairo-maven-dep-optional">optional</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Build Output */}
      {state.output && (
        <div className="kairo-widget-section">
          <div className="kairo-section-title">
            Build Output: {state.currentTask || state.error ? 'Failed' : 'Success'}
          </div>
          <pre className="kairo-maven-output">{state.output}</pre>
        </div>
      )}

      {state.error && (
        <div className="kairo-widget-section">
          <div className="kairo-section-title kairo-section-title-error">
            Error
          </div>
          <pre className="kairo-maven-error">{state.error}</pre>
        </div>
      )}
    </div>
  );
};

@injectable()
export class MavenViewWidget extends ReactWidget {
  static readonly ID = 'kairo-maven-view';

  @postConstruct()
  protected init(): void {
    this.id = MavenViewWidget.ID;
    this.title.label = 'Maven';
    this.title.caption = 'Kairo Maven Project Management';
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.update();
  }

  protected render(): React.ReactNode {
    return <MavenView />;
  }
}