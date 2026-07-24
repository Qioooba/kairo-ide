/**
 * Kairo Navigation Contribution — enhanced code navigation commands.
 *
 * Provides:
 *   - Go to Line (Ctrl+G)
 *   - Go to Symbol in File (Ctrl+Shift+O)
 *   - Quick Outline (Ctrl+F12)
 *   - Navigation History (Back/Forward)
 *   - Recent Files popup
 *   - Go to Type (Ctrl+Shift+T)
 *
 * All commands are registered as CommandContribution and
 * KeybindingContribution for the Kairo IDE.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  ApplicationShell,
  QuickInputService,
  QuickPickItem,
} from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { MessageService } from '@theia/core/lib/common/message-service';
import { isOSX } from '@theia/core/lib/common/os';
import URI from '@theia/core/lib/common/uri';

/** Minimal Monaco editor API surface used by the navigation contribution. */
interface MonacoNamespace {
  CancellationTokenSource: { new(): { token: unknown } };
  languages: {
    /** Internal document symbol providers (not part of the public API). */
    _documentSymbolProviders: MonacoDocumentSymbolProvider[];
    /** Internal workspace symbol providers (not part of the public API). */
    _workspaceSymbolProviders: MonacoWorkspaceSymbolProvider[];
  };
  Selection: { new(line: number, col: number, line2: number, col2: number): unknown };
  Range: { new(line: number, col: number, line2: number, col2: number): unknown };
  editor: {
    getModel(uri: unknown): MonacoTextModel | undefined;
  };
}

interface MonacoTextModel {
  getLineCount(): number;
  getLineMaxColumn(line: number): number;
}

interface MonacoDocumentSymbolProvider {
  provideDocumentSymbols: (model: unknown, token: unknown) => Promise<MonacoSymbol[] | undefined>;
}

interface MonacoWorkspaceSymbolProvider {
  provideWorkspaceSymbols: (query: { query: string }, token: unknown) => Promise<MonacoSymbol[] | undefined>;
}

interface MonacoSymbol {
  name: string;
  kind: number;
  detail?: string;
  containerName?: string;
  range?: { startLineNumber: number; startColumn: number };
  selectionRange?: { startLineNumber: number; startColumn: number };
  location?: { uri: { toString(): string }; range: { startLineNumber: number; startColumn: number } };
  children?: MonacoSymbol[];
}

export namespace KairoNavigationCommands {
  export const GO_TO_LINE: Command = {
    id: 'kairo.navigation.goToLine',
    label: 'Kairo: Go to Line...',
  };
  export const GO_TO_SYMBOL_IN_FILE: Command = {
    id: 'kairo.navigation.goToSymbolInFile',
    label: 'Kairo: Go to Symbol in File...',
  };
  export const QUICK_OUTLINE: Command = {
    id: 'kairo.navigation.quickOutline',
    label: 'Kairo: Quick Outline',
  };
  export const NAVIGATE_BACK: Command = {
    id: 'kairo.navigation.back',
    label: 'Kairo: Navigate Back',
  };
  export const NAVIGATE_FORWARD: Command = {
    id: 'kairo.navigation.forward',
    label: 'Kairo: Navigate Forward',
  };
  export const RECENT_FILES: Command = {
    id: 'kairo.navigation.recentFiles',
    label: 'Kairo: Recent Files',
  };
  export const GO_TO_TYPE: Command = {
    id: 'kairo.navigation.goToType',
    label: 'Kairo: Go to Type',
  };
}

/** Navigation history entry. */
interface NavEntry {
  uri: string;
  line: number;
  column: number;
}

/** Maximum navigation history entries. */
const MAX_HISTORY = 50;

/** Extended QuickPickItem with position info. */
interface SymbolQuickPickItem extends QuickPickItem {
  line: number;
  column: number;
}

@injectable()
export class KairoNavigationContribution implements CommandContribution, KeybindingContribution {
  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  @inject(ApplicationShell)
  protected readonly shell!: ApplicationShell;

  @inject(MessageService)
  protected readonly messages!: MessageService;

  @inject(QuickInputService)
  protected readonly quickInput!: QuickInputService;

  /** Navigation back history stack. */
  protected backStack: NavEntry[] = [];

  /** Navigation forward history stack. */
  protected forwardStack: NavEntry[] = [];

  /** Last recorded position (to avoid duplicate entries). */
  protected lastPosition: NavEntry | undefined;

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(KairoNavigationCommands.GO_TO_LINE, {
      execute: () => this.goToLine(),
    });
    registry.registerCommand(KairoNavigationCommands.GO_TO_SYMBOL_IN_FILE, {
      execute: () => this.goToSymbolInFile(),
    });
    registry.registerCommand(KairoNavigationCommands.QUICK_OUTLINE, {
      execute: () => this.quickOutline(),
    });
    registry.registerCommand(KairoNavigationCommands.NAVIGATE_BACK, {
      execute: () => this.navigateBack(),
      isEnabled: () => this.backStack.length > 0,
    });
    registry.registerCommand(KairoNavigationCommands.NAVIGATE_FORWARD, {
      execute: () => this.navigateForward(),
      isEnabled: () => this.forwardStack.length > 0,
    });
    registry.registerCommand(KairoNavigationCommands.RECENT_FILES, {
      execute: () => this.showRecentFiles(),
    });
    registry.registerCommand(KairoNavigationCommands.GO_TO_TYPE, {
      execute: () => this.goToType(),
    });

    // Record navigation positions on editor changes
    this.recordNavigationPosition();
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybinding({
      command: KairoNavigationCommands.GO_TO_LINE.id,
      keybinding: isOSX ? 'ctrlcmd+g' : 'ctrl+g',
    });
    keybindings.registerKeybinding({
      command: KairoNavigationCommands.GO_TO_SYMBOL_IN_FILE.id,
      keybinding: isOSX ? 'ctrlcmd+shift+o' : 'ctrl+shift+o',
    });
    keybindings.registerKeybinding({
      command: KairoNavigationCommands.QUICK_OUTLINE.id,
      keybinding: isOSX ? 'ctrlcmd+f12' : 'ctrl+f12',
    });
    keybindings.registerKeybinding({
      command: KairoNavigationCommands.NAVIGATE_BACK.id,
      keybinding: isOSX ? 'alt+cmd+left' : 'ctrl+alt+left',
    });
    keybindings.registerKeybinding({
      command: KairoNavigationCommands.NAVIGATE_FORWARD.id,
      keybinding: isOSX ? 'alt+cmd+right' : 'ctrl+alt+right',
    });
    keybindings.registerKeybinding({
      command: KairoNavigationCommands.RECENT_FILES.id,
      keybinding: isOSX ? 'ctrlcmd+e' : 'ctrl+e',
    });
    keybindings.registerKeybinding({
      command: KairoNavigationCommands.GO_TO_TYPE.id,
      keybinding: isOSX ? 'ctrlcmd+shift+t' : 'ctrl+shift+t',
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Go to Line                                                          */
  /* ------------------------------------------------------------------ */

  private async goToLine(): Promise<void> {
    const editor = this.editorManager.currentEditor?.editor;
    if (!(editor instanceof MonacoEditor)) {
      this.messages.warn('No active editor.');
      return;
    }

    const totalLines = editor.document.lineCount;
    const input = await this.quickInput.input({
      prompt: `Go to line (1-${totalLines}):`,
      placeHolder: `${totalLines} lines`,
      validateInput: async (val: string) => {
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 1 || num > totalLines) {
          return { content: `Enter a number between 1 and ${totalLines}`, severity: 1 };
        }
        return undefined;
      },
    });

    if (input === undefined) return;

    const lineNumber = parseInt(input, 10);
    if (isNaN(lineNumber)) return;

    const control = editor.getControl();
    control.revealLineInCenter(lineNumber);
    control.setPosition({ lineNumber, column: 1 });
    control.focus();
  }

  /* ------------------------------------------------------------------ */
  /*  Go to Symbol in File                                                */
  /* ------------------------------------------------------------------ */

  private async goToSymbolInFile(): Promise<void> {
    const editor = this.editorManager.currentEditor?.editor;
    if (!(editor instanceof MonacoEditor)) {
      this.messages.warn('No active editor.');
      return;
    }

    const control = editor.getControl();
    const model = control.getModel();
    if (!model) return;

    try {
      // Use Monaco's document symbol providers via the editor's model
      const monaco = await this.getMonaco();
      if (!monaco) {
        this.messages.info('Symbol navigation not available.');
        return;
      }

      const providers = monaco.languages._documentSymbolProviders;
      if (!providers) {
        this.messages.info('No symbol provider registered for this file type.');
        return;
      }

      const allSymbols: SymbolQuickPickItem[] = await this.getModelSymbols(model, monaco);
      if (allSymbols.length === 0) {
        this.messages.info('No symbols found in this file.');
        return;
      }

      const pick = await this.quickInput.showQuickPick(allSymbols, {
        placeholder: 'Go to symbol in file...',
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (pick) {
        const symPick = pick as SymbolQuickPickItem;
        control.revealLineInCenter(symPick.line);
        control.setPosition({ lineNumber: symPick.line, column: symPick.column });
        control.focus();
      }
    } catch {
      this.messages.info('Could not retrieve symbols for this file.');
    }
  }

  /** Dynamically import Monaco editor core. */
  private async getMonaco(): Promise<MonacoNamespace | undefined> {
    try {
      return await import('@theia/monaco-editor-core') as unknown as MonacoNamespace;
    } catch {
      return undefined;
    }
  }

  /** Get flat symbol list from the editor model. */
  private async getModelSymbols(model: unknown, monaco: MonacoNamespace): Promise<SymbolQuickPickItem[]> {
    const result: SymbolQuickPickItem[] = [];
    try {
      // Access internal document symbol providers
      const providers = monaco.languages._documentSymbolProviders;
      if (!providers) return result;

      const token = new monaco.CancellationTokenSource().token;
      for (const provider of providers) {
        if (!provider.provideDocumentSymbols) continue;
        try {
          const symbols = await provider.provideDocumentSymbols(model, token);
          if (symbols && Array.isArray(symbols)) {
            this.collectFlatSymbols(symbols, '', result);
            if (result.length > 0) break;
          }
        } catch {
          // Skip providers that fail
        }
      }
    } catch {
      // Fallback: no symbols
    }
    return result;
  }

  /** Recursively collect flat symbols. */
  private collectFlatSymbols(
    symbols: MonacoSymbol[],
    prefix: string,
    result: SymbolQuickPickItem[],
  ): void {
    for (const sym of symbols) {
      if (!sym || !sym.name) continue;
      const kindIcon = this.getSymbolKindIcon(sym.kind);
      result.push({
        label: `${kindIcon} ${sym.name}`,
        description: sym.detail || '',
        detail: prefix ? `${prefix} > ${sym.name}` : sym.name,
        line: (sym.range?.startLineNumber || sym.selectionRange?.startLineNumber || 1),
        column: (sym.range?.startColumn || sym.selectionRange?.startColumn || 1),
      });

      if (sym.children && sym.children.length > 0) {
        const childPrefix = prefix ? `${prefix} > ${sym.name}` : sym.name;
        this.collectFlatSymbols(sym.children, childPrefix, result);
      }
    }
  }

  /** Get icon for symbol kind. */
  private getSymbolKindIcon(kind: number): string {
    // SymbolKind enum values from Monaco/vscode
    const icons: Record<number, string> = {
      0: '$(symbol-method)',     // Method
      1: '$(symbol-method)',     // Function
      2: '$(symbol-constructor)',// Constructor
      3: '$(symbol-field)',      // Field
      4: '$(symbol-variable)',   // Variable
      5: '$(symbol-class)',      // Class
      6: '$(symbol-structure)',  // Struct
      7: '$(symbol-interface)',  // Interface
      8: '$(symbol-module)',     // Module
      9: '$(symbol-property)',   // Property
      10: '$(symbol-event)',     // Event
      11: '$(symbol-operator)',  // Operator
      12: '$(symbol-unit)',      // Unit
      13: '$(symbol-value)',     // Value
      14: '$(symbol-constant)',  // Constant
      15: '$(symbol-enum)',      // Enum
      16: '$(symbol-enum-member)',// EnumMember
      17: '$(symbol-keyword)',   // Keyword
      18: '$(symbol-text)',      // Text
      19: '$(symbol-color)',     // Color
      20: '$(symbol-file)',      // File
      21: '$(symbol-reference)', // Reference
      22: '$(symbol-customcolor)',// Customcolor
      23: '$(symbol-folder)',    // Folder
      24: '$(symbol-type-parameter)',// TypeParameter
      25: '$(symbol-user)',      // User
      26: '$(symbol-issue)',     // Issue
    };
    return icons[kind] || '$(symbol-misc)';
  }

  /* ------------------------------------------------------------------ */
  /*  Quick Outline                                                       */
  /* ------------------------------------------------------------------ */

  private async quickOutline(): Promise<void> {
    // Quick Outline is the same as Go to Symbol in File
    await this.goToSymbolInFile();
  }

  /* ------------------------------------------------------------------ */
  /*  Navigation History                                                  */
  /* ------------------------------------------------------------------ */

  /** Record the current editor position into the navigation history. */
  private recordNavigationPosition(): void {
    this.editorManager.onCurrentEditorChanged(() => {
      this.pushCurrentPosition();
    });
  }

  /** Push the current editor position to the back stack. */
  pushCurrentPosition(): void {
    const editor = this.editorManager.currentEditor?.editor;
    if (!(editor instanceof MonacoEditor)) return;

    const cursor = editor.cursor;
    if (!cursor) return;

    const entry: NavEntry = {
      uri: editor.uri.toString(),
      line: cursor.line,
      column: cursor.character,
    };

    // Avoid duplicate consecutive entries
    if (
      this.lastPosition &&
      this.lastPosition.uri === entry.uri &&
      this.lastPosition.line === entry.line &&
      this.lastPosition.column === entry.column
    ) {
      return;
    }

    if (this.lastPosition) {
      this.backStack.push(this.lastPosition);
      if (this.backStack.length > MAX_HISTORY) {
        this.backStack.shift();
      }
    }

    this.lastPosition = entry;
    this.forwardStack = []; // Clear forward stack on new navigation
  }

  /** Navigate back in history. */
  private async navigateBack(): Promise<void> {
    if (this.backStack.length === 0) {
      this.messages.info('No previous location.');
      return;
    }

    // Push current position to forward stack
    if (this.lastPosition) {
      this.forwardStack.push(this.lastPosition);
    }

    const entry = this.backStack.pop()!;
    this.lastPosition = entry;
    await this.openLocation(entry);
  }

  /** Navigate forward in history. */
  private async navigateForward(): Promise<void> {
    if (this.forwardStack.length === 0) {
      this.messages.info('No forward location.');
      return;
    }

    if (this.lastPosition) {
      this.backStack.push(this.lastPosition);
    }

    const entry = this.forwardStack.pop()!;
    this.lastPosition = entry;
    await this.openLocation(entry);
  }

  /** Open a file at a specific location. */
  private async openLocation(entry: NavEntry): Promise<void> {
    const uri = new URI(entry.uri);
    const widget = await this.editorManager.open(uri, {
      mode: 'reveal',
      selection: {
        start: { line: entry.line, character: entry.column },
      },
    });

    if (widget instanceof EditorWidget) {
      const editor = widget.editor;
      if (editor instanceof MonacoEditor) {
        const control = editor.getControl();
        control.revealLineInCenter(entry.line);
        control.focus();
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Recent Files                                                        */
  /* ------------------------------------------------------------------ */

  private async showRecentFiles(): Promise<void> {
    const editors = this.editorManager.all;
    if (editors.length === 0) {
      this.messages.info('No recent files.');
      return;
    }

    const items: QuickPickItem[] = editors.map(widget => {
      const uri = widget.editor.uri;
      const fileName = uri.displayName;
      const dirPath = uri.parent.toString();
      return {
        label: fileName,
        description: dirPath,
        detail: uri.toString(),
      };
    });

    const pick = await this.quickInput.showQuickPick(items, {
      placeholder: 'Recent files...',
      matchOnDescription: true,
    });

    if (pick && pick.detail) {
      const uri = new URI(pick.detail);
      this.editorManager.open(uri, { mode: 'activate' });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Go to Type                                                          */
  /* ------------------------------------------------------------------ */

  private async goToType(): Promise<void> {
    const input = await this.quickInput.input({
      prompt: 'Go to type:',
      placeHolder: 'Type name...',
    });

    if (!input) return;

    // Use Theia's command service to trigger workspace symbol search
    // Fall back to command-based approach
    try {
      const monaco = await this.getMonaco();
      if (!monaco) {
        this.messages.warn('No workspace symbol provider available.');
        return;
      }

      // Access internal workspace symbol providers
      const providers = monaco.languages._workspaceSymbolProviders;
      if (!providers || providers.length === 0) {
        this.messages.warn('No workspace symbol provider available.');
        return;
      }

      const token = new monaco.CancellationTokenSource().token;
      const allResults: MonacoSymbol[] = [];
      for (const provider of providers) {
        if (!provider.provideWorkspaceSymbols) continue;
        try {
          const results = await provider.provideWorkspaceSymbols({ query: input }, token);
          if (results && Array.isArray(results)) {
            allResults.push(...results);
          }
        } catch {
          // Skip failing providers
        }
      }

      if (allResults.length === 0) {
        this.messages.info(`No types found matching "${input}".`);
        return;
      }

      const items: SymbolQuickPickItem[] = allResults
        .slice(0, 20)
        .map(sym => ({
          label: `${this.getSymbolKindIcon(sym.kind)} ${sym.name}`,
          description: sym.containerName || '',
          detail: sym.location?.uri?.toString() || '',
          line: sym.location?.range?.startLineNumber || 1,
          column: sym.location?.range?.startColumn || 1,
        }));

      const pick = await this.quickInput.showQuickPick(items, {
        placeholder: `Matching types for "${input}"...`,
        matchOnDescription: true,
      });

      if (pick) {
        const symPick = pick as SymbolQuickPickItem;
        if (symPick.detail) {
          const uri = new URI(symPick.detail);
          this.editorManager.open(uri, {
            mode: 'activate',
            selection: {
              start: {
                line: symPick.line,
                character: symPick.column,
              },
            },
          });
        }
      }
    } catch {
      this.messages.info(`Could not search for types matching "${input}".`);
    }
  }
}