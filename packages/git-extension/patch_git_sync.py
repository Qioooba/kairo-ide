# -*- coding: utf-8 -*-
filepath = 'G:/spaces/kairo-ide/packages/git-extension/src/browser/git-sync-contribution.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace imports
old = """import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandRegistry } from '@theia/core/lib/common';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import {
  QuickInputService,
} from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager } from '@theia/editor/lib/browser';
import { KairoI18nService } from '@kairo/i18n';
import { GitService } from './git-service';
import { toRepoRelativePath } from '../common/git-path-utils';"""

new = """import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandRegistry } from '@theia/core/lib/common';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import {
  QuickInputService,
  ContextKeyService,
} from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager } from '@theia/editor/lib/browser';
import { KairoI18nService } from '@kairo/i18n';
import { GitService } from './git-service';
import { toRepoRelativePath } from '../common/git-path-utils';
import { NavigatorContextMenu } from '@theia/navigator/lib/browser/navigator-contribution';
import { EditorContextMenu } from '@theia/editor/lib/browser/editor-menu';"""

assert old in content, "Imports not found"
content = content.replace(old, new, 1)

# 2. Add GIT_ACTIVE_CONTEXT_KEY after GIT_SYNC_COMMANDS
old2 = """export const GIT_SYNC_COMMANDS = {
  PULL: 'kairo.git.pull',
  PUSH: 'kairo.git.push',
  FETCH: 'kairo.git.fetch',
  BRANCH_CREATE: 'kairo.git.branch.create',
  BRANCH_SWITCH: 'kairo.git.branch.switch',
  DISCARD: 'kairo.git.discard',
} as const;"""

new2 = """export const GIT_SYNC_COMMANDS = {
  PULL: 'kairo.git.pull',
  PUSH: 'kairo.git.push',
  FETCH: 'kairo.git.fetch',
  BRANCH_CREATE: 'kairo.git.branch.create',
  BRANCH_SWITCH: 'kairo.git.branch.switch',
  DISCARD: 'kairo.git.discard',
} as const;

export const GIT_ACTIVE_CONTEXT_KEY = 'gitActive';"""

assert old2 in content, "GIT_SYNC_COMMANDS not found"
content = content.replace(old2, new2, 1)

# 3. Add ContextKeyService injection
old3 = """@injectable()
export class GitSyncContribution {
  @inject(GitService) protected readonly gitService!: GitService;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(QuickInputService) protected readonly quickInput!: QuickInputService;
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;"""

new3 = """@injectable()
export class GitSyncContribution {
  @inject(GitService) protected readonly gitService!: GitService;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(QuickInputService) protected readonly quickInput!: QuickInputService;
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;
  @inject(ContextKeyService) protected readonly contextKeys!: ContextKeyService;"""

assert old3 in content, "Class properties not found"
content = content.replace(old3, new3, 1)

# 4. Replace registerCommands to add setupContextKey call
old4 = """  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(GIT_PULL_COMMAND, {"""

new4 = """  registerCommands(commands: CommandRegistry): void {
    this.setupContextKey();
    commands.registerCommand(GIT_PULL_COMMAND, {"""

assert old4 in content, "registerCommands not found"
content = content.replace(old4, new4, 1)

# 5. Add setupContextKey method before requireRepo
old5 = """  private async requireRepo(): Promise<boolean> {"""

new5 = """  private setupContextKey(): void {
    const gitActiveKey = this.contextKeys.createKey<boolean>(GIT_ACTIVE_CONTEXT_KEY, false);
    const update = () => {
      gitActiveKey.set(!!this.gitService.getRepoRoot());
    };
    update();
  }

  private async requireRepo(): Promise<boolean> {"""

assert old5 in content, "requireRepo not found"
content = content.replace(old5, new5, 1)

# 6. Replace registerMenus
old6 = """  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(['view', 'git'], {
      commandId: GIT_BRANCH_SWITCH_COMMAND.id,
      label: 'Switch Branch',
      order: 'c0',
    });
  }"""

new6 = """  registerMenus(menus: MenuModelRegistry): void {
    // Keep existing view menu entry
    menus.registerMenuAction(['view', 'git'], {
      commandId: GIT_BRANCH_SWITCH_COMMAND.id,
      label: 'Switch Branch',
      order: 'c0',
    });

    // File tree / directory tree right-click context menu
    const navigatorMenu = [...NavigatorContextMenu.MODIFICATION, 'git'];

    menus.registerMenuAction(navigatorMenu, {
      commandId: GIT_DISCARD_COMMAND.id,
      label: 'Discard Changes',
      order: '1',
    });
    menus.registerMenuAction(navigatorMenu, {
      commandId: GIT_PULL_COMMAND.id,
      label: 'Pull',
      order: '2',
    });
    menus.registerMenuAction(navigatorMenu, {
      commandId: GIT_PUSH_COMMAND.id,
      label: 'Push',
      order: '3',
    });
    menus.registerMenuAction(navigatorMenu, {
      commandId: GIT_FETCH_COMMAND.id,
      label: 'Fetch',
      order: '4',
    });
    menus.registerMenuAction(navigatorMenu, {
      commandId: GIT_BRANCH_CREATE_COMMAND.id,
      label: 'Create Branch...',
      order: '5',
    });
    menus.registerMenuAction(navigatorMenu, {
      commandId: GIT_BRANCH_SWITCH_COMMAND.id,
      label: 'Switch Branch...',
      order: '6',
    });

    // Editor / file content right-click context menu
    const editorMenu = [...EditorContextMenu.MODIFICATION, 'git'];

    menus.registerMenuAction(editorMenu, {
      commandId: GIT_DISCARD_COMMAND.id,
      label: 'Discard Changes',
      order: '1',
    });
    menus.registerMenuAction(editorMenu, {
      commandId: GIT_PULL_COMMAND.id,
      label: 'Pull',
      order: '2',
    });
    menus.registerMenuAction(editorMenu, {
      commandId: GIT_PUSH_COMMAND.id,
      label: 'Push',
      order: '3',
    });
    menus.registerMenuAction(editorMenu, {
      commandId: GIT_FETCH_COMMAND.id,
      label: 'Fetch',
      order: '4',
    });
  }"""

assert old6 in content, "registerMenus not found"
content = content.replace(old6, new6, 1)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('git-sync-contribution.ts patched successfully')
