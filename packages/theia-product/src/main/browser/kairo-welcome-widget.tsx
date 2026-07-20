/**
 * Kairo Welcome tab (KAIRO-RC-WEB-018).
 *
 * Previously a cold start with no Kairo project rendered a void
 * main area: the product's primary first task (importing a
 * project) was undiscoverable unless the user already knew the
 * File > Open menu or the command palette. This tab opens on
 * start when no project is active and offers the three real
 * entry points; it closes itself once a project is selected.
 */

import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';

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
    label: 'Import Kairo Project…',
    command: 'kairo.project.import',
    failMessage: 'Open Import Wizard failed',
    primary: true,
  },
  {
    testId: 'welcome-select',
    label: 'Select Kairo Project…',
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

@injectable()
export class KairoWelcomeWidget extends ReactWidget {
  static readonly ID = KAIRO_WELCOME_FACTORY_ID;

  @inject(CommandService) protected readonly commandService!: CommandService;
  @inject(MessageService) protected readonly messages!: MessageService;

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
    return (
      <div className="kairo-welcome-body">
        <h1 className="kairo-welcome-title">Kairo IDE</h1>
        <p className="kairo-welcome-tagline">
          Import, build, deploy and run legacy Java Web projects on Tomcat 6 — entirely offline.
        </p>
        <div className="kairo-welcome-actions" role="group" aria-label="Getting started actions">
          {WELCOME_ACTIONS.map(a => (
            <button
              key={a.testId}
              type="button"
              className={a.primary ? 'theia-button' : 'theia-button secondary'}
              data-testid={a.testId}
              onClick={() => void this.run(a)}
            >
              {a.label}
            </button>
          ))}
        </div>
        <p className="kairo-welcome-hint">
          All actions are also available in the command palette (Cmd+Shift+P, prefix “Kairo:”).
        </p>
      </div>
    );
  }
}
