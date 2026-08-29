import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { EDITOR_CONTEXT_MENU, EditorManager } from '@theia/editor/lib/browser';
import { JavaRunService } from './java-run-service';
import { JAVA_RUN_COMMANDS } from './java-run-protocol';
import { JAVA_LANGUAGE_ID } from '../common/java-common';

export namespace JavaRunCommands {
  export const RUN_MAIN = {
    id: JAVA_RUN_COMMANDS.RUN_MAIN,
    label: "▶ Run 'main'",
    category: 'Java',
  };
  export const DEBUG_MAIN = {
    id: JAVA_RUN_COMMANDS.DEBUG_MAIN,
    label: "🐞 Debug 'main'",
    category: 'Java',
  };
  export const RUN_TEST = {
    id: JAVA_RUN_COMMANDS.RUN_TEST,
    label: '▶ Run Test',
    category: 'Java',
  };
  export const DEBUG_TEST = {
    id: JAVA_RUN_COMMANDS.DEBUG_TEST,
    label: '🐞 Debug Test',
    category: 'Java',
  };
}

@injectable()
export class JavaRunCommandContribution implements CommandContribution {
  @inject(JavaRunService)
  protected readonly runService!: JavaRunService;

  // BUG-20260826-113: isJavaEditor() used to read the non-existent
  // window.theia.editorManager global and always returned false, so the
  // Run/Debug 'main' menu items never rendered. Use the real service.
  @inject(EditorManager) @optional()
  protected readonly editorManager?: EditorManager;

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(JavaRunCommands.RUN_MAIN, {
      execute: async (arg?: any) => {
        if (arg && arg.uri && arg.line !== undefined) {
          await this.runService.runFromUri(arg.uri, arg.line, false);
        } else {
          await this.runService.runCurrentEditor(false);
        }
      },
      isVisible: () => this.isJavaEditor(),
    });
    registry.registerCommand(JavaRunCommands.DEBUG_MAIN, {
      execute: async (arg?: any) => {
        if (arg && arg.uri && arg.line !== undefined) {
          await this.runService.runFromUri(arg.uri, arg.line, true);
        } else {
          await this.runService.runCurrentEditor(true);
        }
      },
      isVisible: () => this.isJavaEditor(),
    });
    registry.registerCommand(JavaRunCommands.RUN_TEST, {
      execute: async (arg?: any) => {
        if (arg && arg.uri && arg.line !== undefined) {
          await this.runService.runFromUri(arg.uri, arg.line, false);
        } else {
          await this.runService.runCurrentEditor(false);
        }
      },
      isVisible: () => this.isJavaEditor(),
    });
    registry.registerCommand(JavaRunCommands.DEBUG_TEST, {
      execute: async (arg?: any) => {
        if (arg && arg.uri && arg.line !== undefined) {
          await this.runService.runFromUri(arg.uri, arg.line, true);
        } else {
          await this.runService.runCurrentEditor(true);
        }
      },
      isVisible: () => this.isJavaEditor(),
    });
  }

  protected isJavaEditor(): boolean {
    try {
      const editor = this.editorManager?.currentEditor;
      if (!editor) return false;
      return editor.editor?.document?.languageId === JAVA_LANGUAGE_ID;
    } catch {
      return false;
    }
  }
}

@injectable()
export class JavaRunMenuContribution implements MenuContribution {
  registerMenus(registry: MenuModelRegistry): void {
    const subMenuPath = EDITOR_CONTEXT_MENU.concat('9_kairojavarun');
    try {
      registry.registerMenuAction(subMenuPath, {
        commandId: JavaRunCommands.RUN_MAIN.id,
        label: JavaRunCommands.RUN_MAIN.label,
        order: '1',
      });
      registry.registerMenuAction(subMenuPath, {
        commandId: JavaRunCommands.DEBUG_MAIN.id,
        label: JavaRunCommands.DEBUG_MAIN.label,
        order: '2',
      });
      registry.registerMenuAction(subMenuPath, {
        commandId: JavaRunCommands.RUN_TEST.id,
        label: JavaRunCommands.RUN_TEST.label,
        order: '3',
      });
      registry.registerMenuAction(subMenuPath, {
        commandId: JavaRunCommands.DEBUG_TEST.id,
        label: JavaRunCommands.DEBUG_TEST.label,
        order: '4',
      });
    } catch (e) {
      console.warn('[kairo-java-run] menu registration fallback', e);
    }
  }
}
