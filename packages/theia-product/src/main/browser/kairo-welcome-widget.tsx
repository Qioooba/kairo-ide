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
import { KairoI18nService, I18nContext } from '@kairo/i18n';
import type { RecentProject } from '@kairo/protocol';

export const KAIRO_WELCOME_FACTORY_ID = 'kairo-welcome';

interface WelcomeAction {
  testId: string;
  labelKey: string;
  command: string;
  failMessageKey: string;
  primary?: boolean;
}

@injectable()
export class KairoWelcomeWidget extends ReactWidget {
  static readonly ID = KAIRO_WELCOME_FACTORY_ID;

  @inject(CommandService) protected readonly commandService!: CommandService;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(KairoProjectService) protected readonly projectService!: KairoProjectService;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  constructor() {
    super();
    this.id = KAIRO_WELCOME_FACTORY_ID;
    this.addClass('kairo-welcome');
    this.updateTitle();
    this.title.iconClass = 'codicon codicon-home';
    this.title.closable = true;
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
  }

  protected updateTitle(): void {
    this.title.label = this.i18n.t('widget.welcome.title');
    this.title.caption = this.i18n.t('widget.welcome.caption');
  }

  protected async run(action: WelcomeAction): Promise<void> {
    try {
      await this.commandService.executeCommand(action.command);
    } catch (err) {
      const msg = this.i18n.t(action.failMessageKey as any);
      this.messages.error(`${msg}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  render(): React.ReactNode {
    return React.createElement(
      I18nContext.Provider,
      { value: this.i18n },
      React.createElement(KairoWelcome, {
        projectService: this.projectService,
        workspaceService: this.workspaceService,
        commandService: this.commandService,
        messages: this.messages,
        i18n: this.i18n,
        run: (a: WelcomeAction) => void this.run(a),
      })
    );
  }
}

interface KairoWelcomeProps {
  projectService: KairoProjectService;
  workspaceService: WorkspaceService;
  commandService: CommandService;
  messages: MessageService;
  i18n: KairoI18nService;
  run: (action: WelcomeAction) => void;
}

const KairoWelcome: React.FC<KairoWelcomeProps> = ({
  projectService, workspaceService, i18n, run,
}) => {
  const t = React.useCallback((key: string) => i18n.t(key as any), [i18n]);

  const [recentProjects, setRecentProjects] = React.useState<RecentProject[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);

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

  const welcomeActions: WelcomeAction[] = [
    {
      testId: 'welcome-import',
      labelKey: 'widget.welcome.newProject',
      command: 'kairo.project.import',
      failMessageKey: 'widget.welcome.importFailed',
      primary: true,
    },
    {
      testId: 'welcome-select',
      labelKey: 'widget.welcome.openProject',
      command: 'kairo.project.select',
      failMessageKey: 'widget.welcome.selectFailed',
    },
    {
      testId: 'welcome-open-workspace',
      labelKey: 'widget.welcome.openWorkspace',
      command: 'workspace:open',
      failMessageKey: 'widget.welcome.openWorkspaceFailed',
    },
  ];

  const quickStartSteps = [
    {
      testId: 'quickstart-import',
      icon: '📂',
      titleKey: 'widget.welcome.step1Title',
      descKey: 'widget.welcome.step1Desc',
      action: welcomeActions[0],
    },
    {
      testId: 'quickstart-config',
      icon: '⚙',
      titleKey: 'widget.welcome.step2Title',
      descKey: 'widget.welcome.step2Desc',
      action: {
        testId: 'welcome-run-config',
        labelKey: 'widget.welcome.openRunConfig',
        command: 'kairo.runConfigurations.manage',
        failMessageKey: 'widget.welcome.runConfigFailed',
      } as WelcomeAction,
    },
    {
      testId: 'quickstart-run',
      icon: '▶',
      titleKey: 'widget.welcome.step3Title',
      descKey: 'widget.welcome.step3Desc',
      action: {
        testId: 'welcome-build',
        labelKey: 'widget.welcome.buildRun',
        command: 'kairo.buildAndDeploy',
        failMessageKey: 'widget.welcome.buildFailed',
      } as WelcomeAction,
    },
  ];

  return (
    <div className="kairo-welcome-body">
      <h1 className="kairo-welcome-title">Kairo IDE</h1>
      <p className="kairo-welcome-tagline">
        {t('widget.welcome.caption')}
      </p>
      <div className="kairo-welcome-actions" role="group" aria-label={t('widget.welcome.quickStart')}>
        <h2 className="kairo-welcome-section-title">{t('widget.welcome.quickStart')}</h2>
        {welcomeActions.map(a => (
          <button
            key={a.testId}
            type="button"
            className={a.primary ? 'theia-button' : 'theia-button secondary'}
            data-testid={a.testId}
            onClick={() => run(a)}
          >
            {t(a.labelKey as any)}
          </button>
        ))}
      </div>
      {!loading && recentProjects.length > 0 && (
        <div className="kairo-welcome-recent" data-testid="welcome-recent">
          <h2 className="kairo-welcome-recent-title">{t('widget.welcome.recentProjects')}</h2>
          <ul className="kairo-welcome-recent-list" role="list" aria-label={t('widget.welcome.recentProjects')}>
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
      {!loading && recentProjects.length === 0 && !error && (
        <p className="kairo-welcome-empty" style={{ textAlign: 'center', color: 'var(--theia-descriptionForeground)', padding: '16px' }}>
          {t('widget.welcome.noRecentProjects')}
        </p>
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
            <span aria-hidden="true">⚠</span> {error}
          </div>
        </div>
      )}
      <div className="kairo-welcome-quickstart" data-testid="welcome-quickstart">
        <h2 className="kairo-welcome-section-title">{t('widget.welcome.quickStart')}</h2>
        <ol className="kairo-quickstart-steps" role="list" aria-label={t('widget.welcome.quickStart')}>
          {quickStartSteps.map(step => (
            <li key={step.testId} className="kairo-quickstart-step" data-testid={step.testId}>
              <span className="kairo-quickstart-icon">{step.icon}</span>
              <div className="kairo-quickstart-content">
                <strong>{t(step.titleKey as any)}</strong>
                <p>{t(step.descKey as any)}</p>
              </div>
              <button
                type="button"
                className="theia-button secondary kairo-quickstart-action"
                data-testid={`${step.testId}-action`}
                onClick={() => run(step.action)}
              >
                {t(step.action.labelKey as any)}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};