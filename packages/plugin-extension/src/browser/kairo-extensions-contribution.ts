/**
 * Kairo Extensions Contribution — registers commands, menus, and keybindings
 * for the Extensions view in the Kairo IDE.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
} from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { FrontendApplicationContribution, FrontendApplication, WidgetManager, QuickInputService } from '@theia/core/lib/browser';
import { KairoExtensionService, KairoExtension } from '../common/kairo-extension-protocol';
import { KAIRO_EXTENSIONS_FACTORY_ID } from './kairo-extensions-frontend-module';

export namespace KairoExtensionsCommands {
  export const OPEN_EXTENSIONS: Command = {
    id: 'kairo.extensions.open',
    label: 'Extensions',
    category: 'Kairo',
  };

  export const INSTALL_FROM_VSIX: Command = {
    id: 'kairo.extensions.installFromVsix',
    label: 'Install from VSIX...',
    category: 'Extensions',
  };

  export const ENABLE_EXTENSION: Command = {
    id: 'kairo.extensions.enable',
    label: 'Enable Extension',
    category: 'Extensions',
  };

  export const DISABLE_EXTENSION: Command = {
    id: 'kairo.extensions.disable',
    label: 'Disable Extension',
    category: 'Extensions',
  };

  export const UNINSTALL_EXTENSION: Command = {
    id: 'kairo.extensions.uninstall',
    label: 'Uninstall Extension',
    category: 'Extensions',
  };

  export const RELOAD_EXTENSIONS: Command = {
    id: 'kairo.extensions.reload',
    label: 'Reload Extensions',
    category: 'Extensions',
  };
}

@injectable()
export class KairoExtensionsContribution
  implements CommandContribution, MenuContribution, KeybindingContribution, FrontendApplicationContribution {

  @inject(KairoExtensionService)
  private readonly extensionService!: KairoExtensionService;

  @inject(WidgetManager)
  private readonly widgetManager!: WidgetManager;

  @inject(MessageService)
  private readonly messageService!: MessageService;

  @inject(QuickInputService)
  private readonly quickInputService!: QuickInputService;

  private currentExtensions: KairoExtension[] = [];

  async onStart(_app: FrontendApplication): Promise<void> {
    // Pre-load the extension list on startup
    try {
      this.currentExtensions = await this.extensionService.getInstalledExtensions();
    } catch {
      // Extension service may not be available yet
    }
  }

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(KairoExtensionsCommands.OPEN_EXTENSIONS, {
      execute: async () => {
        try {
          await this.widgetManager.getOrCreateWidget(KAIRO_EXTENSIONS_FACTORY_ID);
        } catch (e: any) {
          this.messageService.error(`Failed to open Extensions view: ${e.message}`);
        }
      },
    });

    registry.registerCommand(KairoExtensionsCommands.INSTALL_FROM_VSIX, {
      execute: async () => {
        // Use a quick input to prompt for the file path
        // In a real Electron app, we'd use dialog.showOpenDialog
        const input = await this.quickInputService?.input({
          placeHolder: 'Enter the path to a .vsix file',
          prompt: 'Install VS Code extension from local .vsix file',
        });
        if (!input) {
          return;
        }
        try {
          const result = await this.extensionService.installFromVsix(input);
          if (result.success) {
            this.messageService.info(
              `Extension "${result.extension.displayName}" installed successfully. ` +
              'Please reload the window to activate it.'
            );
            this.currentExtensions = await this.extensionService.getInstalledExtensions();
          } else {
            this.messageService.error(`Installation failed: ${result.error}`);
          }
        } catch (e: any) {
          this.messageService.error(`Installation failed: ${e.message}`);
        }
      },
    });

    registry.registerCommand(KairoExtensionsCommands.ENABLE_EXTENSION, {
      execute: async () => {
        const ext = await this.pickExtension('Enable');
        if (!ext) return;
        try {
          await this.extensionService.enableExtension(ext.id);
          this.messageService.info(
            `Extension "${ext.displayName}" enabled. Please reload to activate.`
          );
          this.currentExtensions = await this.extensionService.getInstalledExtensions();
        } catch (e: any) {
          this.messageService.error(`Failed to enable extension: ${e.message}`);
        }
      },
    });

    registry.registerCommand(KairoExtensionsCommands.DISABLE_EXTENSION, {
      execute: async () => {
        const ext = await this.pickExtension('Disable');
        if (!ext) return;
        try {
          await this.extensionService.disableExtension(ext.id);
          this.messageService.info(
            `Extension "${ext.displayName}" disabled. Please reload to apply.`
          );
          this.currentExtensions = await this.extensionService.getInstalledExtensions();
        } catch (e: any) {
          this.messageService.error(`Failed to disable extension: ${e.message}`);
        }
      },
    });

    registry.registerCommand(KairoExtensionsCommands.UNINSTALL_EXTENSION, {
      execute: async () => {
        const ext = await this.pickExtension('Uninstall');
        if (!ext) return;
        try {
          await this.extensionService.uninstallExtension(ext.id);
          this.messageService.info(
            `Extension "${ext.displayName}" uninstalled. Please reload to apply.`
          );
          this.currentExtensions = await this.extensionService.getInstalledExtensions();
        } catch (e: any) {
          this.messageService.error(`Failed to uninstall extension: ${e.message}`);
        }
      },
    });

    registry.registerCommand(KairoExtensionsCommands.RELOAD_EXTENSIONS, {
      execute: async () => {
        // In Electron, use app.relaunch(); in browser, use location.reload()
        this.messageService.info('Reloading window to apply extension changes...');
        setTimeout(() => {
          window.location.reload();
        }, 500);
      },
    });
  }

  registerMenus(menus: MenuModelRegistry): void {
    // Add Extensions to the View menu
    menus.registerMenuAction(['view_menu'], {
      commandId: KairoExtensionsCommands.OPEN_EXTENSIONS.id,
      label: 'Extensions',
      order: 'z9',
    });
  }

  registerKeybindings(registry: KeybindingRegistry): void {
    registry.registerKeybinding({
      command: KairoExtensionsCommands.OPEN_EXTENSIONS.id,
      keybinding: 'ctrl+shift+x',
      when: undefined,
    });
  }

  private async pickExtension(action: string): Promise<KairoExtension | undefined> {
    try {
      this.currentExtensions = await this.extensionService.getInstalledExtensions();
    } catch {
      return undefined;
    }

    if (this.currentExtensions.length === 0) {
      this.messageService.warn('No extensions installed. Use "Install from VSIX..." to add one.');
      return undefined;
    }

    const items = this.currentExtensions.map(ext => ({
      label: ext.displayName,
      description: `${ext.id}@${ext.version}`,
      detail: ext.enabled ? 'Enabled' : 'Disabled',
      value: ext,
    }));

    const picked = await this.quickInputService?.showQuickPick(items, {
      placeholder: `Select an extension to ${action.toLowerCase()}`,
    });

    return picked?.value;
  }
}