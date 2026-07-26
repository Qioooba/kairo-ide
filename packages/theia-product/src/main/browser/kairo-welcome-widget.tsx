/**
 * Kairo Welcome tab (KAIRO-RC-WEB-018).
 *
 * Previously a cold start with no Kairo project rendered a void
 * main area: the product's primary first task (importing a
 * project) was undiscoverable unless the user already knew the
 * File > Open menu or the command palette. This tab opens on
 * start when no project is active and offers the three real
 * entry points; it closes itself once a project is selected.
 *
 * KAIRO-RC-WEB-RECENT: Now also shows recent projects so users
 * can quickly reopen previously imported projects.
 */

import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { KairoProjectService } from '@kairo/project-extension';
import type { RecentProject } from '@kairo/protocol';

export const KAIRO_WELCOME_FACTORY_ID = 'kairo-welcome';

interface WelcomeAction {
  testId: string;
  label: string;
  command: string;
  failMessage: string;
  primary?: boolean;
}

const WELCOME_ACTIONS: WelcomeAction[] = [
  {
    testId: 'welcome-import',
    label: 'New Project…',
    command: 'kairo.project.import',
    failMessage: 'Open Import Wizard failed',
    primary: true,
  },
  {
    testId: 'welcome-select',
    label: 'Open Project…',
    command: 'kairo.project.select',
    failMessage: 'Open Project Selector failed',
  },
  {
    testId: 'welcome-open-workspace',
    label: 'Open Workspace Folder…',
    command: 'workspace:open',
    failMessage: 'Open Workspace failed',
  },
];

interface QuickStartStep {
  testId: string;
  icon: string;
  title: string;
  description: string;
  action: WelcomeAction;
}

const QUICK_START_STEPS: QuickStartStep[] = [
  {
    testId: 'quickstart-import',
    icon: '📂',
    title: '1. Import Your Project',
    description: 'Select your legacy Java Web project folder. Kairo auto-detects the structure.',
    action: WELCOME_ACTIONS[0],
  },
  {
    testId: 'quickstart-config',
    icon: '⚙',
    title: '2. Configure Run Settings',
    description: 'Set up Tomcat ports, JDK, and build options in the Run Configurations panel.',
    action: {
      testId: 'welcome-run-config',
      label: 'Open Run Configurations',
      command: 'kairo.runConfigurations.manage',
      failMessage: 'Open Run Configurations failed',
    },
  },
  {
    testId: 'quickstart-run',
    icon: '▶',
    title: '3. Build & Run',
    description: 'Use the toolbar to build, deploy, and run your application on Tomcat 6.',
    action: {
      testId: 'welcome-build',
      label: 'Build & Run',
      command: 'kairo.buildAndDeploy',
      failMessage: 'Build and deploy failed',
    },
  },
];

@injectable()
export class KairoWelcomeWidget extends ReactWidget {
  static readonly ID = KAIRO_WELCOME_FACTORY_ID;

  @inject(CommandService) protected readonly commandService!: CommandService;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(KairoProjectService) protected readonly projectService!: KairoProjectService;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;

  constructor() {
    super();
    this.id = KAIRO_WELCOME_FACTORY_ID;
    this.title.label = 'Welcome';
    this.title.caption = 'Kairo IDE Welcome';
    this.title.iconClass = 'codicon codicon-home';
    this.title.closable = true;
    this.addClass('kairo-welcome');
  }

  protected async run(action: WelcomeAction): Promise<void> {
    try {
      await this.commandService.executeCommand(action.command);
    } catch (err) {
      this.messages.error(`${action.failMessage}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  render(): React.ReactNode {
    return React.createElement(KairoWelcome, {
      projectService: this.projectService,
      workspaceService: this.workspaceService,
      commandService: this.commandService,
      messages: this.messages,
      run: (a: WelcomeAction) => void this.run(a),
    });
  }
}

interface KairoWelcomeProps {
  projectService: KairoProjectService;
  workspaceService: WorkspaceService;
  commandService: CommandService;
  messages: MessageService;
  run: (action: WelcomeAction) => void;
}

const KairoWelcome: React.FC<KairoWelcomeProps> = ({
  projectService, workspaceService, run,
}) => {
  const [recentProjects, setRecentProjects] = React.useState<RecentProject[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    projectService.getRecentProjects().then(list => {
      if (!cancelled) {
        setRecentProjects(list);
        setLoading(false);
        setError(null);
      }
    }).catch((err: Error) => {
      if (!cancelled) {
        setRecentProjects([]);
        setLoading(false);
        setError(err.message || 'Failed to load recent projects.');
      }
    });
    return () => { cancelled = true; };
  }, [projectService]);

  const handleOpenRecent = (project: RecentProject) => {
    void workspaceService.open(new URI(project.rootPath));
  };

  return (
    <div className="kairo-welcome-body">
      <h1 className="kairo-welcome-title">Kairo IDE</h1>
      <p className="kairo-welcome-tagline">
        Import, build, deploy and run legacy Java Web projects on Tomcat 6 — entirely offline.
      </p>
      <div className="kairo-welcome-actions" role="group" aria-label="Getting started actions">
        <h2 className="kairo-welcome-section-title">Get Started</h2>
        {WELCOME_ACTIONS.map(a => (
          <button
            key={a.testId}
            type="button"
            className={a.primary ? 'theia-button' : 'theia-button secondary'}
            data-testid={a.testId}
            onClick={() => run(a)}
          >
            {a.label}
          </button>
        ))}
      </div>
      {!loading && recentProjects.length > 0 && (
        <div className="kairo-welcome-recent" data-testid="welcome-recent">
          <h2 className="kairo-welcome-recent-title">Recent Projects</h2>
          <ul className="kairo-welcome-recent-list" role="list" aria-label="Recent projects">
            {recentProjects.map(p => (
              <li key={p.id} className="kairo-welcome-recent-item">
                <button
                  type="button"
                  className="theia-button secondary"
                  data-testid={`recent-${p.id}`}
                  onClick={() => handleOpenRecent(p)}
                  title={p.rootPath}
                >
                  <span className="recent-project-name">{p.name}</span>
                  <span className="recent-project-path">{p.rootPath}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!loading && error && (
        <div className="kairo-welcome-error" role="alert" data-testid="welcome-error" style={{ padding: '12px', margin: '8px 0' }}>
          <div style={{
            padding: '8px 12px',
            backgroundColor: 'rgba(244,67,54,0.1)',
            border: '1px solid rgba(244,67,54,0.3)',
            borderRadius: '4px',
            color: 'var(--theia-errorForeground)',
            fontSize: '13px',
          }}>
            <span aria-hidden="true">⚠</span> Failed to load recent projects: {error}
          </div>
        </div>
      )}
      <div className="kairo-welcome-quickstart" data-testid="welcome-quickstart">
        <h2 className="kairo-welcome-section-title">Quick Start Guide</h2>
        <ol className="kairo-quickstart-steps" role="list" aria-label="Quick start steps">
          {QUICK_START_STEPS.map(step => (
            <li key={step.testId} className="kairo-quickstart-step" data-testid={step.testId}>
              <span className="kairo-quickstart-icon">{step.icon}</span>
              <div className="kairo-quickstart-content">
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </div>
              <button
                type="button"
                className="theia-button secondary kairo-quickstart-action"
                data-testid={`${step.testId}-action`}
                onClick={() => run(step.action)}
              >
                {step.action.label}
              </button>
            </li>
          ))}
        </ol>
      </div>
      <p className="kairo-welcome-hint">
        All actions are also available in the command palette (Cmd+Shift+P, prefix &quot;Kairo:&quot;).
      </p>
    </div>
  );
};