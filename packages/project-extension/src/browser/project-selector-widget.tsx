import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ActiveProjectService, ProjectInfo } from './active-project-service';

@injectable()
export class ProjectSelectorWidget extends ReactWidget {
    static readonly ID = 'kairo-project-selector';

    @inject(ActiveProjectService)
    protected readonly activeProject!: ActiveProjectService;

    constructor() {
        super();
        this.id = ProjectSelectorWidget.ID;
        this.title.label = 'Project';
        this.title.closable = false;
        this.title.caption = 'Select active project';
        this.addClass('kairo-widget');
    }

    protected render(): React.ReactNode {
        return React.createElement(ProjectSelector, {
            activeProject: this.activeProject,
        });
    }
}

interface ProjectSelectorProps {
    activeProject: ActiveProjectService;
}

const ProjectSelector: React.FC<ProjectSelectorProps> = ({ activeProject }) => {
    const [project, setProject] = React.useState<ProjectInfo | undefined>();
    const [open, setOpen] = React.useState(false);

    React.useEffect(() => {
        const sub = activeProject.onDidChangeProject(p => setProject(p));
        return () => sub.dispose();
    }, [activeProject]);

    const handleToggle = React.useCallback(() => {
        setOpen(prev => !prev);
    }, []);

    return (
        <div className="kairo-project-selector" data-testid="project-selector">
            <button
                className="kairo-project-selector-btn"
                onClick={handleToggle}
                data-testid="project-selector-btn"
                aria-label="Select active project"
            >
                {project ? project.name : 'No Project'}
                <span className="codicon codicon-chevron-down" />
            </button>
            {open && (
                <div className="kairo-project-dropdown" data-testid="project-dropdown">
                    {project ? (
                        <div className="kairo-project-info">
                            <div data-testid="project-name">{project.name}</div>
                            <div className="kairo-project-path" data-testid="project-root">{project.root}</div>
                        </div>
                    ) : (
                        <div className="kairo-no-project" data-testid="no-project">
                            No project selected. Import a project first.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};