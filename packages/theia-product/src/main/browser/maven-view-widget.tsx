/**
 * Maven View Widget — dependency tree and lifecycle tasks.
 *
 * Shows:
 *  - Project metadata (groupId, artifactId, version)
 *  - Dependency tree (collapsible)
 *  - Lifecycle tasks as runnable buttons
 */
import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';
import type {
  MavenDetectResult,
  MavenDependencyTreeNode,
  MavenLifecycleTask,
  MavenRunResult,
} from '@kairo/protocol';

type TFunction = (key: KairoI18nKey, params?: Record<string, string | number>) => string;

// ---- Components ----

interface TreeNodeProps {
  node: MavenDependencyTreeNode;
  depth: number;
  t: TFunction;
}

const TreeNode: React.FC<TreeNodeProps> = ({ node, depth, t }) => {
  const [expanded, setExpanded] = React.useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;

  const toggle = () => { if (hasChildren) setExpanded(!expanded); };

  return (
    <div className="kairo-maven-tree-node">
      <div
        className="kairo-maven-tree-row"
        style={{ paddingLeft: `${depth * 16}px` }}
        onClick={toggle}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        data-testid={`maven-dep-${node.artifactId}`}
      >
        <span className="kairo-maven-tree-toggle">
          {hasChildren ? (expanded ? '▼' : '▶') : '  '}
        </span>
        <span className="kairo-maven-dep-name">{node.groupId}:{node.artifactId}</span>
        <span className="kairo-maven-dep-version">{node.version}</span>
        {node.scope !== 'compile' && (
          <span className="kairo-maven-dep-scope">{node.scope}</span>
        )}
        {node.optional && (
          <span className="kairo-maven-dep-optional">{t('common.optional').toLowerCase()}</span>
        )}
      </div>
      {hasChildren && expanded && (
        <div className="kairo-maven-tree-children" role="group">
          {node.children!.map((child, i) => (
            <TreeNode key={`${child.groupId}:${child.artifactId}:${i}`} node={child} depth={depth + 1} t={t} />
          ))}
        </div>
      )}
    </div>
  );
};

interface MavenViewComponentProps {
  runtime: RuntimeConnectionService;
  messageService: MessageService;
  t: TFunction;
}

const MavenViewComponent: React.FC<MavenViewComponentProps> = ({ runtime, messageService, t }) => {
  const [result, setResult] = React.useState<MavenDetectResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [taskOutput, setTaskOutput] = React.useState('');
  const [runningTask, setRunningTask] = React.useState('');

  const detectProject = React.useCallback(async () => {
    const ws = runtime.workspace();
    if (!ws) {
      setError(t('widget.maven.noWorkspace'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await runtime.request('POST /api/v1/maven/detect', { rootPath: ws });
      const r = data as MavenDetectResult;
      setResult(r);
      if (!r.found) {
        setError(t('widget.maven.noPom'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [runtime, t]);

  const loadDependencies = React.useCallback(async () => {
    const ws = runtime.workspace();
    if (!ws) return;
    setLoading(true);
    setError('');
    try {
      const data = await runtime.request('GET /api/v1/maven/dependencies', undefined, { query: { rootPath: ws, offline: true } });
      const r = data as MavenDetectResult;
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  const runTask = React.useCallback(async (task: MavenLifecycleTask) => {
    const ws = runtime.workspace();
    if (!ws) return;
    setRunningTask(task.id);
    setTaskOutput('');
    setError('');
    try {
      const data = await runtime.request('POST /api/v1/maven/run', {
        rootPath: ws,
        task: task.phase,
        offline: true,
      });
      const r = data as MavenRunResult;
      setTaskOutput(r.output || r.error || '');
      if (r.success) {
        messageService.info(t('widget.maven.taskCompleted', { task: task.label }));
      } else {
        messageService.error(t('widget.maven.taskFailed', { task: task.label, exitCode: r.exitCode ?? -1 }));
      }
    } catch (err) {
      setTaskOutput(err instanceof Error ? err.message : String(err));
      messageService.error(t('widget.maven.taskFailedGeneric', { task: task.label }));
    } finally {
      setRunningTask('');
    }
  }, [runtime, messageService, t]);

  React.useEffect(() => {
    void detectProject();
  }, [detectProject]);

  return (
    <div className="kairo-widget" data-testid="maven-view">
      <div className="kairo-widget-header" data-testid="maven-view-header">
        <span className="kairo-widget-title">{t('widget.maven.title')}</span>
        {result?.project && (
          <span className="kairo-maven-coords" data-testid="maven-coords">
            {result.project.groupId}:{result.project.artifactId}:{result.project.version}
          </span>
        )}
      </div>

      <div className="kairo-widget-toolbar" data-testid="maven-view-toolbar">
        <button
          className="theia-button"
          data-testid="maven-detect-button"
          onClick={detectProject}
          disabled={loading}
        >
          {t('widget.maven.detect')}
        </button>
        <button
          className="theia-button secondary"
          data-testid="maven-deps-button"
          onClick={loadDependencies}
          disabled={loading || !result?.found}
        >
          {t('widget.maven.refreshDependencies')}
        </button>
      </div>

      {loading && <p className="kairo-empty" data-testid="maven-loading">{t('widget.maven.loading')}</p>}
      {error && <div className="theia-error" role="alert" data-testid="maven-error">{error}</div>}

      {result?.project && (
        <>
          {/* Lifecycle Tasks */}
          <div className="kairo-widget-section" data-testid="maven-tasks">
            <div className="kairo-section-title">{t('widget.maven.lifecycleTasks')}</div>
            <div className="kairo-maven-tasks" data-testid="maven-tasks-list">
              {result.tasks.map(task => (
                <button
                  key={task.id}
                  className="theia-button kairo-maven-task-button"
                  data-testid={`maven-task-${task.id}`}
                  onClick={() => runTask(task)}
                  disabled={runningTask !== ''}
                  title={task.description}
                >
                  {runningTask === task.id ? t('widget.maven.running') : task.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dependency Tree */}
          <div className="kairo-widget-section" data-testid="maven-dependencies">
            <div className="kairo-section-title">
              {t('widget.maven.dependencies', { count: result.dependencies.length })}
            </div>
            {result.tree && result.tree.length > 0 ? (
              <div className="kairo-maven-tree" role="tree" data-testid="maven-tree">
                {result.tree.map((node, i) => (
                  <TreeNode key={`${node.groupId}:${node.artifactId}:${i}`} node={node} depth={0} t={t} />
                ))}
              </div>
            ) : (
              <p className="kairo-empty" data-testid="maven-no-deps">{t('widget.maven.noDependencies')}</p>
            )}
          </div>
        </>
      )}

      {/* Task Output */}
      {taskOutput && (
        <div className="kairo-widget-section" data-testid="maven-output">
          <div className="kairo-section-title">{t('widget.maven.output')}</div>
          <pre className="kairo-maven-output" data-testid="maven-output-text">{taskOutput}</pre>
        </div>
      )}
    </div>
  );
};

@injectable()
export class MavenViewWidget extends ReactWidget {
  static readonly ID = 'kairo-maven-view';

  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
  @inject(MessageService) protected readonly messageService!: MessageService;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  constructor() {
    super();
    this.id = MavenViewWidget.ID;
    const t: TFunction = (this.i18n?.t.bind(this.i18n)) as TFunction | undefined
      ?? ((key: KairoI18nKey) => String(key));
    this.title.label = t('widget.maven.title');
    this.title.caption = t('widget.maven.caption');
    this.addClass('kairo-widget');
  }

  protected render(): React.ReactNode {
    const t: TFunction = (this.i18n?.t.bind(this.i18n)) as TFunction | undefined
      ?? ((key: KairoI18nKey) => String(key));
    return React.createElement(MavenViewComponent, {
      runtime: this.runtime,
      messageService: this.messageService,
      t,
    });
  }
}
