# -*- coding: utf-8 -*-
import re

# --- Patch git-sync-contribution.ts ---
filepath = 'G:/spaces/kairo-ide/packages/git-extension/src/browser/git-sync-contribution.ts'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add imports
old_imports = """import { injectable, inject } from '@theia/core/shared/inversify';
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

new_imports = """import { injectable, inject } from '@theia/core/shared/inversify';
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

content = content.replace(old_imports, new_imports, 1)

# 2. Add GIT_ACTIVE_CONTEXT_KEY constant after commands block
old_key_const = """export const GIT_SYNC_COMMANDS = {
  PULL: 'kairo.git.pull',
  PUSH: 'kairo.git.push',
  FETCH: 'kairo.git.fetch',
  BRANCH_CREATE: 'kairo.git.branch.create',
  BRANCH_SWITCH: 'kairo.git.branch.switch',
  DISCARD: 'kairo.git.discard',
} as const;"""

new_key_const = """export const GIT_SYNC_COMMANDS = {
  PULL: 'kairo.git.pull',
  PUSH: 'kairo.git.push',
  FETCH: 'kairo.git.fetch',
  BRANCH_CREATE: 'kairo.git.branch.create',
  BRANCH_SWITCH: 'kairo.git.branch.switch',
  DISCARD: 'kairo.git.discard',
} as const;

export const GIT_ACTIVE_CONTEXT_KEY = 'gitActive';"""

content = content.replace(old_key_const, new_key_const, 1)

# 3. Add ContextKeyService injection and gitActive context key setup
old_class_props = """@injectable()
export class GitSyncContribution {
  @inject(GitService) protected readonly gitService!: GitService;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(QuickInputService) protected readonly quickInput!: QuickInputService;
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;"""

new_class_props = """@injectable()
export class GitSyncContribution {
  @inject(GitService) protected readonly gitService!: GitService;
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(QuickInputService) protected readonly quickInput!: QuickInputService;
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;
  @inject(ContextKeyService) protected readonly contextKeys!: ContextKeyService;"""

content = content.replace(old_class_props, new_class_props, 1)

# 4. Replace registerMenus to add navigator + editor context menus
old_register_menus = """  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(['view', 'git'], {
      commandId: GIT_BRANCH_SWITCH_COMMAND.id,
      label: 'Switch Branch',
      order: 'c0',
    });
  }"""

new_register_menus = """  registerMenus(menus: MenuModelRegistry): void {
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

content = content.replace(old_register_menus, new_register_menus, 1)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('git-sync-contribution.ts patched')

# --- Patch git-service.ts to emit repo root change events ---
filepath2 = 'G:/spaces/kairo-ide/packages/git-extension/src/browser/git-service.ts'
with open(filepath2, 'r', encoding='utf-8') as f:
    content2 = f.read()

# Add context key update after onDidChange emitter in GitSyncContribution
# We need to make GitSyncContribution also update the context key.
# Actually, we can do this by injecting GitService and subscribing to changes.
# But the simplest is to add a method call in the constructor.

# Find the constructor or add initialization
old_constructor = """  constructor(
    @inject(GitRepositoryTracker) protected readonly repositoryTracker: GitRepositoryTracker,
    @inject(GitBinManager) protected readonly gitBinManager: GitBinManager,
  ) {
    this.updateRefreshTrigger();
  }"""

# We need to check the actual constructor. Let me search for it.
# Actually let's just add the context key setup to GitSyncContribution's onStart.
# Since GitSyncContribution implements FrontendApplicationContribution (via bind),
# Let's check if it does...

print("Checking GitSyncContribution for FrontendApplicationContribution...")
# Actually it doesn't implement FrontendApplicationContribution.
# Let's add a method that sets up context key based on repo root.

# Better approach: add a context key service to GitService and update it there.
# But that requires more changes. For now, let's add a simple approach:
# Add setupContextKeys method to GitSyncContribution called from registerCommands

old_register_commands = """  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(GIT_PULL_COMMAND, {
      execute: () => void this.runSync(() => this.gitService.pull(), 'pull'),
    });"""

new_register_commands = """  registerCommands(commands: CommandRegistry): void {
    this.setupContextKey();
    commands.registerCommand(GIT_PULL_COMMAND, {
      execute: () => void this.runSync(() => this.gitService.pull(), 'pull'),
    });"""

content = content.replace(old_register_commands, new_register_commands, 1)

# Add setupContextKey method before requireRepo
old_require_repo = """  private async requireRepo(): Promise<boolean> {"""

new_require_repo = """  private setupContextKey(): void {
    const gitActiveKey = this.contextKeys.createKey<boolean>(GIT_ACTIVE_CONTEXT_KEY, false);
    const update = () => {
      gitActiveKey.set(!!this.gitService.getRepoRoot());
    };
    update();
    // Update when git status changes
    this.gitService['onDidChangeEmitter']?.event(update);
  }

  private async requireRepo(): Promise<boolean> {"""

content = content.replace(old_require_repo, new_require_repo, 1)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('git-sync-contribution.ts context key setup added')
