import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ActiveProjectService, ProjectInfo } from './active-project-service';
import { RuntimeConnectionService, WorkspaceContextService } from '@kairo/runtime-extension';
import type { ProjectConfig } from '@kairo/protocol';

/**
 * Project Selector tab (KAIRO-RC-WEB-010).
 *
 * Previously this was a non-closable main-area tab whose only
 * content was a dropdown showing the CURRENT project — a
 * "selector" that could not select anything. Now it lists every
 * project in the workspace and switches the active project on
 * click (persisted by ActiveProjectService).
 */
@injectable()
export class ProjectSelectorWidget extends ReactWidget {
    static readonly ID = 'kairo-project-selector';

    @inject(ActiveProjectService)
    protected readonly activeProject!: ActiveProjectService;

    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    @inject(WorkspaceContextService)
    protected readonly workspaceContext!: WorkspaceContextService;

    constructor() {
        super();
        this.id = ProjectSelectorWidget.ID;
        this.title.label = 'Project';
        this.title.closable = true;
        this.title.caption = 'Select active project';
        this.addClass('kairo-widget');
    }

    protected render(): React.ReactNode {
        return React.createElement(ProjectSelector, {
            activeProject: this.activeProject,
            runtime: this.runtime,
            workspaceContext: this.workspaceContext,
        });
    }
}

interface ProjectSelectorProps {
    activeProject: ActiveProjectService;
    runtime: RuntimeConnectionService;
    workspaceContext: WorkspaceContextService;
}

const ProjectSelector: React.FC<ProjectSelectorProps> = ({ activeProject, runtime, workspaceContext }) => {
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
                <p className="kairo-error" data-testid="project-selector-error" role="alert">
                    Failed to load projects: {error}
                </p>
            </div>
        );
    }

    if (projects === undefined) {
        return (
            <div className="kairo-project-selector" data-testid="project-selector">
                <p className="kairo-empty" data-testid="project-selector-loading">Loading projects…</p>
            </div>
        );
    }

    if (projects.length === 0) {
        return (
            <div className="kairo-project-selector" data-testid="project-selector">
                <div className="kairo-no-project" data-testid="no-project">
                    No projects in this workspace yet. Use <strong>Kairo: Import Project</strong> to import one.
                </div>
            </div>
        );
    }

    return (
        <div className="kairo-project-selector" data-testid="project-selector">
            <h3 className="kairo-project-selector-title">Workspace Projects</h3>
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
                                {isActive && <span className="kairo-project-item-badge">active</span>}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};
