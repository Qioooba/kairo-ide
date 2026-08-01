import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ActiveProjectService, ProjectInfo } from './active-project-service';
import { RuntimeConnectionService, WorkspaceContextService } from '@kairo/runtime-extension';
import type { ProjectConfig } from '@kairo/protocol';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';

/**
 * Project Selector tab (KAIRO-RC-WEB-010).
 *
 * Previously this was a non-closable main-area tab whose only
 * content was a dropdown showing the CURRENT project — a
 * "selector" that could not select anything. Now it lists every
 * project in the workspace and switches the active project on
 * click (persisted by ActiveProjectService).
 */
type TFunction = (key: KairoI18nKey, params?: Record<string, string | number>) => string;

@injectable()
export class ProjectSelectorWidget extends ReactWidget {
    static readonly ID = 'kairo-project-selector';

    @inject(ActiveProjectService)
    protected readonly activeProject!: ActiveProjectService;

    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    @inject(WorkspaceContextService)
    protected readonly workspaceContext!: WorkspaceContextService;

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    constructor() {
        super();
        this.id = ProjectSelectorWidget.ID;
        this.title.label = '';
        this.title.closable = true;
        this.title.caption = '';
        this.addClass('kairo-widget');
    }

    @postConstruct()
    protected init(): void {
        const t: TFunction = (this.i18n?.t.bind(this.i18n)) as TFunction | undefined
            ?? ((key: KairoI18nKey) => String(key));
        this.title.label = t('widget.projectSelector.title');
        this.title.caption = t('widget.projectSelector.caption');
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
            this.title.label = t('widget.projectSelector.title');
            this.title.caption = t('widget.projectSelector.caption');
            this.update();
        }));
        this.update();
    }

    protected render(): React.ReactNode {
        return React.createElement(ProjectSelector, {
            activeProject: this.activeProject,
            runtime: this.runtime,
            workspaceContext: this.workspaceContext,
            i18n: this.i18n,
        });
    }
}

interface ProjectSelectorProps {
    activeProject: ActiveProjectService;
    runtime: RuntimeConnectionService;
    workspaceContext: WorkspaceContextService;
    i18n: KairoI18nService;
}

const ProjectSelector: React.FC<ProjectSelectorProps> = ({ activeProject, runtime, workspaceContext, i18n }) => {
    const t: TFunction = React.useCallback((key: KairoI18nKey, params?: Record<string, string | number>) => i18n.t(key, params), [i18n]);
    const [project, setProject] = React.useState<ProjectInfo | undefined>(activeProject.project);
    const [projects, setProjects] = React.useState<ProjectConfig[] | undefined>();
    const [error, setError] = React.useState<string | undefined>();

    React.useEffect(() => {
        const sub = activeProject.onDidChangeProject(p => setProject(p));
        return () => sub.dispose();
    }, [activeProject]);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const list = await runtime.request('GET /api/v1/projects', undefined) as ProjectConfig[];
                if (!cancelled) {
                    setProjects(Array.isArray(list) ? list : []);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : String(err));
                }
            }
        })();
        return () => { cancelled = true; };
    }, [runtime]);

    const handleSelect = React.useCallback((p: ProjectConfig) => {
        const ctx = workspaceContext.context;
        if (!ctx) {
            setError('No workspace context');
            return;
        }
        void activeProject.setProject({
            workspaceId: ctx.workspaceId,
            projectId: p.id,
            name: p.name,
            root: p.rootPath,
        });
    }, [activeProject, workspaceContext]);

    if (error) {
        return (
            <div className="kairo-project-selector" data-testid="project-selector">
                <div className="kairo-error-banner" role="alert">
                    <span className="codicon codicon-error" aria-hidden="true" />
                    <span data-testid="project-selector-error">{t('widget.projectSelector.error', { message: error })}</span>
                </div>
            </div>
        );
    }

    if (projects === undefined) {
        return (
            <div className="kairo-project-selector" data-testid="project-selector">
                <div className="kairo-loading" data-testid="project-selector-loading">
                    <span className="kairo-loading-spinner" />
                    {t('widget.projectSelector.loading')}
                </div>
            </div>
        );
    }

    if (projects.length === 0) {
        return (
            <div className="kairo-project-selector" data-testid="project-selector">
                <div className="kairo-empty-state" data-testid="no-project">
                    <span className="codicon codicon-folder" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.projectSelector.emptyTitle')}</h3>
                    <p className="kairo-empty-state-reason">{t('widget.projectSelector.emptyReason')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="kairo-project-selector" data-testid="project-selector">
            <div className="kairo-project-selector-header">
                <h3 className="kairo-project-selector-title">{t('widget.projectSelector.workspaceProjects')}</h3>
                <span className="kairo-project-selector-count">{t('widget.projectSelector.projectCount', { count: projects.length })}</span>
            </div>
            <ul className="kairo-project-list" data-testid="project-list">
                {projects.map(p => {
                    const isActive = project?.projectId === p.id;
                    return (
                        <li key={p.id}>
                            <button
                                type="button"
                                className={`kairo-project-item${isActive ? ' active' : ''}`}
                                data-testid={`project-item-${p.id}`}
                                aria-current={isActive ? 'true' : undefined}
                                onClick={() => handleSelect(p)}
                            >
                                <span className="kairo-project-item-name">{p.name}</span>
                                <span className="kairo-project-item-path">{p.rootPath}</span>
                                {isActive && <span className="kairo-project-item-badge">{t('widget.projectSelector.activeBadge')}</span>}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};
