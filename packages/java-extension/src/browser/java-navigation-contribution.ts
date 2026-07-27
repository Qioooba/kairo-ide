/**
 * Java Navigation Contribution — IDEA-style code navigation commands,
 * context menu, and keybindings.
 *
 * Provides:
 *   - Go to Type Definition (Ctrl+Shift+B / ⌘⇧B)
 *   - Go to Super Method/Class (Ctrl+U / ⌘U)
 *   - Find Usages (Alt+F7 / ⌥F7)
 *   - Editor context menu "Go To" submenu
 *   - Keybindings for Call/Type Hierarchy
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
} from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser/editor-menu';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import * as monaco from '@theia/monaco-editor-core';
import { isOSX } from '@theia/core/lib/common/os';
import { JavaLanguageClient } from './java-language-client';
import { JavaHierarchyCommands } from './java-hierarchy-contribution';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { JavaHierarchyWidget } from './java-hierarchy-widget';
import { JavaReferencesWidget } from './java-references-widget';
import { LSPLocation, LSPLocationLink } from '../common/lsp-protocol';

export namespace JavaNavigationCommands {
  export const GO_TO_TYPE_DEFINITION: Command = {
    id: 'kairo.java.goToTypeDefinition',
    label: 'Go to Type Declaration',
    category: 'Java',
  };

  export const GO_TO_SUPER_METHOD: Command = {
    id: 'kairo.java.goToSuperMethod',
    label: 'Go to Super Method',
    category: 'Java',
  };

  export const FIND_USAGES: Command = {
    id: 'kairo.java.findUsages',
    label: 'Find Usages...',
    category: 'Java',
  };

  export const GO_TO_DECLARATION: Command = {
    id: 'editor.action.revealDefinition',
    label: 'Declaration',
  };

  export const GO_TO_IMPLEMENTATION: Command = {
    id: 'editor.action.goToImplementation',
    label: 'Implementation(s)',
  };

  export const PEEK_DEFINITION: Command = {
    id: 'editor.action.peekDefinition',
    label: 'Quick Definition',
  };

  export const QUICK_IMPLEMENTATION: Command = {
    id: 'editor.action.peekImplementation',
    label: 'Quick Implementation',
  };

  export const SHOW_CALL_HIERARCHY: Command = {
    id: 'kairo.java.callHierarchy.showIncoming',
    label: 'Call Hierarchy',
  };

  export const SHOW_TYPE_HIERARCHY: Command = {
    id: 'kairo.java.typeHierarchy.showSupertypes',
    label: 'Type Hierarchy',
  };

  export const FILE_STRUCTURE: Command = {
    id: 'kairo.navigation.fileStructure',
    label: 'File Structure...',
    category: 'Java',
  };
}

export namespace JavaNavigationMenus {
  export const GO_TO_SUBMENU = [...EDITOR_CONTEXT_MENU, '1_navigation', '1_goTo'];
}

@injectable()
export class JavaNavigationContribution implements CommandContribution, MenuContribution, KeybindingContribution {
  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  @inject(JavaLanguageClient)
  protected readonly client!: JavaLanguageClient;

  @inject(WidgetManager)
  protected readonly widgetManager!: WidgetManager;

  @inject(ApplicationShell)
  protected readonly shell!: ApplicationShell;

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(JavaNavigationCommands.GO_TO_TYPE_DEFINITION, {
      execute: () => this.executeGoToTypeDefinition(),
      isVisible: () => this.isJavaEditorActive(),
      isEnabled: () => this.isJavaEditorActive(),
    });

    registry.registerCommand(JavaNavigationCommands.GO_TO_SUPER_METHOD, {
      execute: () => this.executeGoToSuperMethod(),
      isVisible: () => this.isJavaEditorActive(),
      isEnabled: () => this.isJavaEditorActive(),
    });

    registry.registerCommand(JavaNavigationCommands.FIND_USAGES, {
      execute: () => this.executeFindUsages(),
      isVisible: () => this.isJavaEditorActive(),
      isEnabled: () => this.isJavaEditorActive(),
    });

    registry.registerCommand(JavaNavigationCommands.FILE_STRUCTURE, {
      execute: () => this.executeFileStructure(),
      isVisible: () => this.isJavaEditorActive(),
      isEnabled: () => this.isJavaEditorActive(),
    });
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerSubmenu(JavaNavigationMenus.GO_TO_SUBMENU, 'Go To');

    menus.registerMenuAction(JavaNavigationMenus.GO_TO_SUBMENU, {
      commandId: JavaNavigationCommands.GO_TO_DECLARATION.id,
      label: 'Declaration',
      order: '1',
    });

    menus.registerMenuAction(JavaNavigationMenus.GO_TO_SUBMENU, {
      commandId: JavaNavigationCommands.GO_TO_IMPLEMENTATION.id,
      label: 'Implementation(s)',
      order: '2',
    });

    menus.registerMenuAction(JavaNavigationMenus.GO_TO_SUBMENU, {
      commandId: JavaNavigationCommands.GO_TO_TYPE_DEFINITION.id,
      label: 'Type Declaration',
      order: '3',
    });

    menus.registerMenuAction(JavaNavigationMenus.GO_TO_SUBMENU, {
      commandId: JavaNavigationCommands.GO_TO_SUPER_METHOD.id,
      label: 'Super Method',
      order: '4',
    });

    menus.registerMenuAction(JavaNavigationMenus.GO_TO_SUBMENU, {
      commandId: JavaNavigationCommands.FIND_USAGES.id,
      label: 'Find Usages...',
      order: '6',
    });

    menus.registerMenuAction(JavaNavigationMenus.GO_TO_SUBMENU, {
      commandId: JavaNavigationCommands.PEEK_DEFINITION.id,
      label: 'Quick Definition',
      order: '7',
    });

    menus.registerMenuAction([...EDITOR_CONTEXT_MENU, '1_navigation'], {
      commandId: JavaNavigationCommands.FILE_STRUCTURE.id,
      label: 'File Structure...',
      order: '1',
    });

    menus.registerMenuAction([...EDITOR_CONTEXT_MENU, '1_navigation'], {
      commandId: JavaNavigationCommands.SHOW_CALL_HIERARCHY.id,
      label: 'Call Hierarchy',
      order: '2',
    });

    menus.registerMenuAction([...EDITOR_CONTEXT_MENU, '1_navigation'], {
      commandId: JavaNavigationCommands.SHOW_TYPE_HIERARCHY.id,
      label: 'Type Hierarchy',
      order: '3',
    });
  }

  registerKeybindings(registry: KeybindingRegistry): void {
    registry.registerKeybinding({
      command: JavaNavigationCommands.GO_TO_TYPE_DEFINITION.id,
      keybinding: isOSX ? 'meta+shift+b' : 'ctrl+shift+b',
      when: 'editorTextFocus && editorLangId == java',
    });

    registry.registerKeybinding({
      command: JavaNavigationCommands.GO_TO_SUPER_METHOD.id,
      keybinding: isOSX ? 'meta+u' : 'ctrl+u',
      when: 'editorTextFocus && editorLangId == java',
    });

    registry.registerKeybinding({
      command: JavaNavigationCommands.FIND_USAGES.id,
      keybinding: isOSX ? 'alt+f7' : 'alt+f7',
      when: 'editorTextFocus && editorLangId == java',
    });

    registry.registerKeybinding({
      command: JavaNavigationCommands.PEEK_DEFINITION.id,
      keybinding: isOSX ? 'meta+shift+i' : 'ctrl+shift+i',
      when: 'editorTextFocus && editorLangId == java',
    });

    registry.registerKeybinding({
      command: JavaHierarchyCommands.SHOW_CALL_HIERARCHY_INCOMING.id,
      keybinding: isOSX ? 'ctrl+alt+h' : 'ctrl+alt+h',
      when: 'editorTextFocus && editorLangId == java',
    });

    registry.registerKeybinding({
      command: JavaHierarchyCommands.SHOW_TYPE_HIERARCHY_SUPERTYPES.id,
      keybinding: isOSX ? 'ctrl+h' : 'ctrl+h',
      when: 'editorTextFocus && editorLangId == java',
    });

    registry.registerKeybinding({
      command: JavaNavigationCommands.FILE_STRUCTURE.id,
      keybinding: isOSX ? 'meta+f12' : 'ctrl+f12',
      when: 'editorTextFocus && editorLangId == java',
    });
  }

  protected isJavaEditorActive(): boolean {
    const currentEditor = this.editorManager.currentEditor;
    if (!currentEditor) return false;
    const editor = currentEditor.editor;
    const uri = editor.document.uri.toString();
    return uri.endsWith('.java') || uri.startsWith('jdt://');
  }

  protected async executeGoToTypeDefinition(): Promise<void> {
    const editor = this.getCurrentMonacoEditor();
    if (!editor) return;

    const model = editor.getModel();
    const position = editor.getPosition();
    if (!model || !position) return;

    const uri = model.uri.toString();
    const line = position.lineNumber - 1;
    const character = position.column - 1;

    try {
      const results = await this.client.typeDefinition({ uri, line, character });
      if (!results) return;

      const locations = Array.isArray(results) ? results : [results];
      if (locations.length === 0) return;

      await this.openLocations(locations);
    } catch (err) {
      console.warn('[kairo-java] Go to Type Definition failed:', err);
    }
  }

  protected async executeGoToSuperMethod(): Promise<void> {
    const editor = this.getCurrentMonacoEditor();
    if (!editor) return;

    const model = editor.getModel();
    const position = editor.getPosition();
    if (!model || !position) return;

    const uri = model.uri.toString();
    const line = position.lineNumber - 1;
    const character = position.column - 1;

    try {
      const typeItems = await this.client.prepareTypeHierarchy({ uri, line, character });
      if (!typeItems || typeItems.length === 0) return;

      const item = typeItems[0];
      const supertypes = await this.client.supertypes(item);
      if (!supertypes || supertypes.length === 0) return;

      const locations: LSPLocation[] = supertypes.map(st => ({
        uri: st.uri,
        range: st.selectionRange,
      }));

      if (locations.length === 1) {
        await this.openLocations(locations);
      } else {
        await this.openLocations(locations);
      }
    } catch (err) {
      console.warn('[kairo-java] Go to Super Method failed:', err);
    }
  }

  protected async executeFindUsages(): Promise<void> {
    const editor = this.getCurrentMonacoEditor();
    if (!editor) return;

    const model = editor.getModel();
    const position = editor.getPosition();
    if (!model || !position) return;

    const uri = model.uri.toString();
    const line = position.lineNumber - 1;
    const character = position.column - 1;

    let symbolName: string | undefined;
    try {
      const word = model.getWordAtPosition(position);
      symbolName = word?.word;
    } catch {
      // ignore
    }

    try {
      const widget = await this.widgetManager.getOrCreateWidget(JavaReferencesWidget.ID) as JavaReferencesWidget;
      try {
        this.shell.addWidget(widget, { area: 'bottom' });
      } catch (_e) {
        // Already attached
      }
      this.shell.activateWidget(widget.id);
      await widget.findUsages(uri, line, character, symbolName);
    } catch (err) {
      console.warn('[kairo-java] Find Usages failed:', err);
    }
  }

  protected executeFileStructure(): void {
    const editor = this.getCurrentMonacoEditor();
    if (!editor) return;
    editor.trigger('kairo-java', 'editor.action.gotoSymbol', null);
  }

  protected getCurrentMonacoEditor(): monaco.editor.IStandaloneCodeEditor | undefined {
    const currentEditor = this.editorManager.currentEditor;
    if (!currentEditor) return undefined;
    const monacoEditor = MonacoEditor.get(currentEditor);
    return monacoEditor?.getControl() as monaco.editor.IStandaloneCodeEditor | undefined;
  }

  protected async openLocations(locations: (LSPLocation | LSPLocationLink)[]): Promise<void> {
    const editor = this.getCurrentMonacoEditor();
    if (!editor) return;

    const monacoLocations = locations.map(loc => {
      if ('targetUri' in loc) {
        return {
          uri: monaco.Uri.parse(loc.targetUri),
          range: new monaco.Range(
            loc.targetSelectionRange.start.line + 1,
            loc.targetSelectionRange.start.character + 1,
            loc.targetSelectionRange.end.line + 1,
            loc.targetSelectionRange.end.character + 1,
          ),
        };
      }
      return {
        uri: monaco.Uri.parse(loc.uri),
        range: new monaco.Range(
          loc.range.start.line + 1,
          loc.range.start.character + 1,
          loc.range.end.line + 1,
          loc.range.end.character + 1,
        ),
      };
    });

    if (monacoLocations.length === 1) {
      const loc = monacoLocations[0];
      await this.editorManager.open(new URI(loc.uri.toString()), {
        mode: 'activate',
        selection: {
          start: { line: loc.range.startLineNumber, character: loc.range.startColumn },
          end: { line: loc.range.endLineNumber, character: loc.range.endColumn },
        },
      });
    } else {
      const originalService = (editor as any)._codeEditorService;
      if (originalService?.openEditorPane) {
        originalService.openEditorPane(editor, {
          startLineNumber: monacoLocations[0].range.startLineNumber,
          startColumn: monacoLocations[0].range.startColumn,
          endLineNumber: monacoLocations[0].range.endLineNumber,
          endColumn: monacoLocations[0].range.endColumn,
        }, monacoLocations.map(l => ({
          uri: l.uri,
          range: l.range,
        })));
      }
    }
  }
}
