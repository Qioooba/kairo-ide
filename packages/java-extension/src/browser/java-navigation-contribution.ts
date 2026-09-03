/**
 * Java Navigation Contribution — IDEA-style code navigation commands,
 * context menu, and keybindings.
 *
 * Provides:
 *   - Go to Type Definition (Ctrl+Shift+B / ⌘⇧B)
 *   - Go to Super Method/Class (Ctrl+U / ⌘U)
 *   - Find Usages (Alt+F7 / ⌥F7) — bottom panel
 *   - Show Usages (Ctrl+Alt+F7 / ⌥⌘F7) — filterable popup with live preview
 *   - Editor context menu "Go To" submenu
 *   - Keybindings for Call/Type Hierarchy
 */

import { injectable, inject, optional } from '@theia/core/shared/inversify';
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
} from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser/editor-menu';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import * as monaco from '@theia/monaco-editor-core';
import { isOSX } from '@theia/core/lib/common/os';
import {
  ApplicationShell,
  QuickInputService,
  QuickPickItem,
  QuickPickSeparator,
  WidgetManager,
} from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';
import { JavaLanguageClient } from './java-language-client';
import { JavaHierarchyCommands } from './java-hierarchy-contribution';
import { JavaReferencesWidget } from './java-references-widget';
import { LSPLocation, LSPLocationLink } from '../common/lsp-protocol';
import {
  buildUsagePickEntries,
  prepareUsages,
  resolveIdentifierOnLine,
  type PreparedUsage,
  type UsagePickItemShape,
} from './java-show-usages';

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

  /** IDEA Ctrl+Alt+F7 — floating picker to jump to a usage. */
  export const SHOW_USAGES: Command = {
    id: 'kairo.java.showUsages',
    label: 'Show Usages',
    category: 'Java',
  };

  export const GO_TO_DECLARATION: Command = {
    id: 'kairo.java.goToDeclaration',
    label: 'Declaration',
    category: 'Java',
  };

  export const GO_TO_IMPLEMENTATION: Command = {
    id: 'kairo.java.goToImplementation',
    label: 'Implementation(s)',
    category: 'Java',
  };

  export const PEEK_DEFINITION: Command = {
    id: 'kairo.java.peekDefinition',
    label: 'Quick Definition',
    category: 'Java',
  };

  export const QUICK_IMPLEMENTATION: Command = {
    id: 'kairo.java.peekImplementation',
    label: 'Quick Implementation',
    category: 'Java',
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

interface UsageQuickPickItem extends QuickPickItem {
  usage: PreparedUsage;
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

  @inject(QuickInputService)
  @optional()
  protected readonly quickInput?: QuickInputService;

  @inject(MessageService)
  @optional()
  protected readonly messages?: MessageService;

  @inject(WorkspaceService)
  @optional()
  protected readonly workspaceService?: WorkspaceService;

  @inject(KairoI18nService)
  @optional()
  protected readonly i18n?: KairoI18nService;

  protected commandRegistry: CommandRegistry | undefined;

  protected readonly commandI18nKeys: Record<string, KairoI18nKey> = {
    [JavaNavigationCommands.GO_TO_TYPE_DEFINITION.id]: 'widget.java.command.goToTypeDefinition',
    [JavaNavigationCommands.GO_TO_SUPER_METHOD.id]: 'widget.java.command.goToSuperMethod',
    [JavaNavigationCommands.FIND_USAGES.id]: 'widget.java.command.findUsages',
    [JavaNavigationCommands.SHOW_USAGES.id]: 'widget.java.command.showUsages',
    [JavaNavigationCommands.FILE_STRUCTURE.id]: 'widget.java.command.fileStructure',
    [JavaNavigationCommands.GO_TO_DECLARATION.id]: 'widget.java.command.declaration',
    [JavaNavigationCommands.GO_TO_IMPLEMENTATION.id]: 'widget.java.command.implementation',
    [JavaNavigationCommands.PEEK_DEFINITION.id]: 'widget.java.command.quickDefinition',
    [JavaNavigationCommands.QUICK_IMPLEMENTATION.id]: 'widget.java.command.quickImplementation',
  };

  protected withLabel(cmd: Command): Command {
    const key = this.commandI18nKeys[cmd.id];
    if (!key || !this.i18n) {
      return cmd;
    }
    const category = cmd.category === 'Java' ? this.i18n.t('widget.java.category') : cmd.category;
    return { ...cmd, label: this.i18n.t(key), category };
  }

  protected refreshCommandLabels(): void {
    if (!this.commandRegistry || !this.i18n || typeof this.commandRegistry.getCommand !== 'function') {
      return;
    }
    const category = this.i18n.t('widget.java.category');
    for (const [id, key] of Object.entries(this.commandI18nKeys)) {
      const cmd = this.commandRegistry.getCommand(id);
      if (cmd) {
        cmd.label = this.i18n.t(key);
        if (cmd.category === 'Java' || cmd.category === category) {
          cmd.category = category;
        }
      }
    }
  }

  registerCommands(registry: CommandRegistry): void {
    this.commandRegistry = registry;
    this.refreshCommandLabels();
    this.i18n?.onDidChangeLanguage(() => this.refreshCommandLabels());

    registry.registerCommand(this.withLabel(JavaNavigationCommands.GO_TO_TYPE_DEFINITION), {
      execute: () => this.executeGoToTypeDefinition(),
      isVisible: () => this.isJavaEditorActive(),
      isEnabled: () => this.isJavaEditorActive(),
    });

    registry.registerCommand(this.withLabel(JavaNavigationCommands.GO_TO_SUPER_METHOD), {
      execute: () => this.executeGoToSuperMethod(),
      isVisible: () => this.isJavaEditorActive(),
      isEnabled: () => this.isJavaEditorActive(),
    });

    registry.registerCommand(this.withLabel(JavaNavigationCommands.FIND_USAGES), {
      execute: () => this.executeFindUsages(),
      isVisible: () => this.isJavaEditorActive(),
      isEnabled: () => this.isJavaEditorActive(),
    });

    registry.registerCommand(this.withLabel(JavaNavigationCommands.SHOW_USAGES), {
      execute: () => this.executeShowUsages(),
      isVisible: () => this.isJavaEditorActive(),
      isEnabled: () => this.isJavaEditorActive(),
    });

    registry.registerCommand(this.withLabel(JavaNavigationCommands.FILE_STRUCTURE), {
      execute: () => this.executeFileStructure(),
      isVisible: () => this.isJavaEditorActive(),
      isEnabled: () => this.isJavaEditorActive(),
    });

    // BUG-20260826-112: Monaco action ids (`editor.action.revealDefinition`
    // etc.) are not Theia commands, so MenuModelRegistry dropped every Go To
    // child that pointed at them. Wrap them as kairo.java.* commands so the
    // submenu actually renders in the browser build.
    registry.registerCommand(this.withLabel(JavaNavigationCommands.GO_TO_DECLARATION), {
      execute: () => this.triggerMonacoAction('editor.action.revealDefinition'),
      isVisible: () => this.isJavaEditorActive(),
      isEnabled: () => this.isJavaEditorActive(),
    });

    registry.registerCommand(this.withLabel(JavaNavigationCommands.GO_TO_IMPLEMENTATION), {
      execute: () => this.triggerMonacoAction('editor.action.goToImplementation'),
      isVisible: () => this.isJavaEditorActive(),
      isEnabled: () => this.isJavaEditorActive(),
    });

    registry.registerCommand(this.withLabel(JavaNavigationCommands.PEEK_DEFINITION), {
      execute: () => this.triggerMonacoAction('editor.action.peekDefinition'),
      isVisible: () => this.isJavaEditorActive(),
      isEnabled: () => this.isJavaEditorActive(),
    });

    registry.registerCommand(this.withLabel(JavaNavigationCommands.QUICK_IMPLEMENTATION), {
      execute: () => this.triggerMonacoAction('editor.action.peekImplementation'),
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
      commandId: JavaNavigationCommands.SHOW_USAGES.id,
      label: 'Show Usages',
      order: '5',
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
      keybinding: 'alt+f7',
      when: 'editorTextFocus && editorLangId == java',
    });

    registry.registerKeybinding({
      command: JavaNavigationCommands.SHOW_USAGES.id,
      keybinding: isOSX ? 'alt+meta+f7' : 'ctrl+alt+f7',
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
    const ctx = this.getUsageContext();
    if (!ctx) return;

    try {
      const widget = await this.widgetManager.getOrCreateWidget(JavaReferencesWidget.ID) as JavaReferencesWidget;
      try {
        this.shell.addWidget(widget, { area: 'bottom' });
      } catch {
        // Already attached
      }
      this.shell.activateWidget(widget.id);
      await widget.findUsages(ctx.uri, ctx.line, ctx.character, ctx.symbolName);
    } catch (err) {
      console.warn('[kairo-java] Find Usages failed:', err);
      this.messages?.error(this.i18n?.t('widget.java.command.findUsagesFailed', { msg: String(err) }) ?? `Find Usages failed: ${String(err)}`);
    }
  }

  /**
   * Show Usages popup (IDEA Ctrl+Alt+F7) — filterable QuickPick with:
   *   - file-grouped separators + usage counts
   *   - declaration tagging
   *   - current-file usages first
   *   - live preview while arrowing through results
   *   - single result jumps immediately
   *   - custom button to open the full Find Usages panel
   */
  protected async executeShowUsages(): Promise<void> {
    const ctx = this.getUsageContext();
    if (!ctx) return;

    try {
      const [references, definitionResult] = await Promise.all([
        this.client.references({
          uri: ctx.uri,
          line: ctx.line,
          character: ctx.character,
          includeDeclaration: true,
        }),
        this.client.definition({ uri: ctx.uri, line: ctx.line, character: ctx.character }).catch(() => undefined),
      ]);

      if (!references || references.length === 0) {
        const name = ctx.symbolName ?? 'symbol';
        this.messages?.info(this.i18n?.t('widget.java.command.noUsagesFound', { name }) ?? `No usages found for '${name}'`);
        // Still open the Find Usages panel so the empty state is visible
        // (toast alone is easy to miss).
        await this.executeFindUsages();
        return;
      }

      const declarations = this.normalizeDefinitionLocations(definitionResult);
      const workspaceRoot = this.getWorkspaceRoot();
      const usages = prepareUsages({
        references,
        declarations,
        currentUri: ctx.uri,
        workspaceRoot,
        getPreview: (uri, line) => this.getLinePreview(uri, line),
      });

      if (usages.length === 1) {
        await this.navigateToUsage(usages[0], 'activate');
        return;
      }

      if (!this.quickInput) {
        // Headless / no QuickInput — fall back to the Find Usages panel.
        await this.executeFindUsages();
        return;
      }

      const symbolLabel = ctx.symbolName ?? 'symbol';
      const entries = buildUsagePickEntries(usages, {
        declaration: 'declaration',
        usage: 'usage',
        fileGroup: (fileName, count) => `${fileName} (${count})`,
      });

      const items: Array<UsageQuickPickItem | QuickPickSeparator> = entries.map(entry => {
        if (entry.type === 'separator') {
          return { type: 'separator', label: entry.label };
        }
        const item = entry as UsagePickItemShape;
        return {
          type: 'item' as const,
          id: item.id,
          label: item.label,
          description: `${item.description} · ${item.usage.relativePath}`,
          detail: item.detail,
          iconClasses: item.iconClasses,
          usage: item.usage,
        };
      });

      let openPanelRequested = false;
      const picked = await this.quickInput.showQuickPick(items, {
        title: `Usages of ${symbolLabel} — ${usages.length}`,
        placeholder: `Filter usages of ${symbolLabel}…`,
        matchOnDescription: true,
        matchOnDetail: true,
        ignoreFocusOut: true,
        runIfSingle: true,
        customButton: true,
        customLabel: 'Find Usages Panel',
        customHover: 'Open the full Find Usages tool window (Alt+F7)',
        onDidCustom: () => {
          openPanelRequested = true;
          this.quickInput?.hide();
        },
        onDidChangeActive: (_qp, activeItems) => {
          const active = activeItems[0] as UsageQuickPickItem | undefined;
          if (active?.usage) {
            void this.navigateToUsage(active.usage, 'reveal');
          }
        },
      });

      if (openPanelRequested) {
        await this.executeFindUsages();
        return;
      }

      if (picked && 'usage' in picked && picked.usage) {
        await this.navigateToUsage(picked.usage, 'activate');
      }
    } catch (err) {
      console.warn('[kairo-java] Show Usages failed:', err);
      this.messages?.error(this.i18n?.t('widget.java.command.showUsagesFailed', { msg: String(err) }) ?? `Show Usages failed: ${String(err)}`);
    }
  }

  protected getUsageContext(): { uri: string; line: number; character: number; symbolName?: string } | undefined {
    const editor = this.getCurrentMonacoEditor();
    if (!editor) return undefined;

    const model = editor.getModel();
    const position = editor.getPosition();
    if (!model || !position) return undefined;

    const snapped = this.resolveSymbolAtPosition(model, position);
    if (!snapped) {
      this.messages?.info(this.i18n?.t('widget.java.command.placeCaretOnSymbol') ?? 'Place the caret on a class, method, or field name');
      return undefined;
    }

    // Keep caret on the identifier so subsequent actions stay consistent.
    try {
      editor.setPosition({ lineNumber: snapped.line + 1, column: snapped.character + 1 });
    } catch {
      // ignore
    }

    return {
      uri: model.uri.toString(),
      line: snapped.line,
      character: snapped.character,
      symbolName: snapped.symbolName,
    };
  }

  /**
   * Resolve the Java identifier under (or immediately left of) the caret.
   * Avoids empty reference results when the caret sits on `{`, `;`, or whitespace.
   */
  protected resolveSymbolAtPosition(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
  ): { line: number; character: number; symbolName: string } | undefined {
    try {
      const word = model.getWordAtPosition(position);
      if (word && /^[A-Za-z_$]/.test(word.word)) {
        return {
          line: position.lineNumber - 1,
          character: word.startColumn - 1,
          symbolName: word.word,
        };
      }
    } catch {
      // fall through to line scan
    }

    try {
      const text = model.getLineContent(position.lineNumber);
      const hit = resolveIdentifierOnLine(text, position.column - 1);
      if (!hit) return undefined;
      return {
        line: position.lineNumber - 1,
        character: hit.character,
        symbolName: hit.symbolName,
      };
    } catch {
      return undefined;
    }
  }

  protected getWorkspaceRoot(): string | undefined {
    const root = this.workspaceService?.tryGetRoots()?.[0] as { resource?: { toString(): string }; uri?: string } | undefined;
    return root?.resource?.toString() ?? root?.uri;
  }

  protected normalizeDefinitionLocations(
    result: LSPLocation | LSPLocation[] | LSPLocationLink | LSPLocationLink[] | null | undefined,
  ): LSPLocation[] {
    if (!result) return [];
    const list = Array.isArray(result) ? result : [result];
    return list.map(loc => {
      if (loc && typeof loc === 'object' && 'targetUri' in loc) {
        return { uri: loc.targetUri, range: loc.targetSelectionRange };
      }
      return loc as LSPLocation;
    });
  }

  protected getLinePreview(uri: string, line: number): string {
    try {
      const model = monaco.editor.getModel(monaco.Uri.parse(uri));
      if (model) {
        return model.getLineContent(line + 1).trim().substring(0, 200);
      }
    } catch {
      // ignore
    }
    return `Line ${line + 1}`;
  }

  protected async navigateToUsage(usage: PreparedUsage, mode: 'activate' | 'reveal'): Promise<void> {
    await this.editorManager.open(new URI(usage.uri), {
      mode,
      selection: {
        start: { line: usage.line + 1, character: usage.character + 1 },
        end: { line: usage.endLine + 1, character: usage.endCharacter + 1 },
      },
      revealOption: 'centerIfOutsideViewport',
    });
  }

  protected executeFileStructure(): void {
    this.triggerMonacoAction('editor.action.gotoSymbol');
  }

  protected triggerMonacoAction(actionId: string): void {
    const editor = this.getCurrentMonacoEditor();
    if (!editor) return;
    editor.trigger('kairo-java', actionId, null);
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
