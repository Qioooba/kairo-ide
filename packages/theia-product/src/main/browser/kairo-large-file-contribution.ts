import { inject, injectable } from '@theia/core/shared/inversify';
import {
  Command,
  CommandContribution,
  CommandRegistry,
  DisposableCollection,
  MessageService,
} from '@theia/core/lib/common';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import {
  FrontendApplication,
  FrontendApplicationContribution,
  StatusBar,
  StatusBarAlignment,
} from '@theia/core/lib/browser';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import * as monaco from '@theia/monaco-editor-core';
import type { IEditorOptions } from '@theia/monaco-editor-core/esm/vs/editor/common/config/editorOptions';
import {
  classifyLargeFile,
  DEFAULT_LARGE_FILE_THRESHOLDS,
  editorOptionsForLargeFile,
  LargeFileThresholds,
  LargeFileTier,
} from './large-file-policy';

/** Code languages that must never be downgraded to plaintext. */
const SYNTAX_LANGUAGE_IDS = new Set([
  'java', 'jsp', 'xml', 'json', 'jsonc', 'properties',
  'html', 'css', 'scss', 'less', 'javascript', 'typescript',
  'javascriptreact', 'typescriptreact', 'sql', 'yaml', 'yml',
  'markdown', 'shellscript', 'bat', 'powershell', 'python', 'go',
]);

export const KairoLargeFileCommands = {
  TOGGLE_FULL_FEATURES: {
    id: 'kairo.largeFile.toggleFullFeatures',
    label: 'Large File: Toggle Full Editor Features',
  } satisfies Command,
};

interface ManagedEditorState {
  tier: LargeFileTier;
  forcedFullFeatures: boolean;
  originalLanguage: string;
  originalOptions: IEditorOptions;
  recheckTimer?: ReturnType<typeof setTimeout>;
}

@injectable()
export class KairoLargeFileContribution
implements FrontendApplicationContribution, CommandContribution {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(StatusBar) protected readonly statusBar!: StatusBar;
  @inject(PreferenceService) protected readonly preferences!: PreferenceService;
  @inject(MessageService) protected readonly messages!: MessageService;

  protected readonly toDispose = new DisposableCollection();
  protected readonly states = new WeakMap<MonacoEditor, ManagedEditorState>();

  onStart(_app: FrontendApplication): void {
    this.toDispose.push(this.editorManager.onCreated(widget => this.manage(widget)));
    this.toDispose.push(this.editorManager.onCurrentEditorChanged(() => this.renderStatus()));
    for (const widget of this.editorManager.all) {
      this.manage(widget);
    }
    this.renderStatus();
  }

  onStop(): void {
    this.toDispose.dispose();
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(KairoLargeFileCommands.TOGGLE_FULL_FEATURES, {
      isEnabled: () => this.currentManagedEditor() !== undefined,
      isVisible: () => this.currentManagedEditor() !== undefined,
      execute: () => this.toggleCurrentEditor(),
    });
  }

  protected manage(widget: EditorWidget): void {
    const editor = widget.editor;
    if (!(editor instanceof MonacoEditor) || this.states.has(editor)) {
      return;
    }
    const control = editor.getControl();
    const model = control.getModel();
    if (!model) {
      return;
    }

    this.states.set(editor, {
      tier: 'normal',
      forcedFullFeatures: false,
      originalLanguage: model.getLanguageId(),
      originalOptions: control.getRawOptions(),
    });
    this.applyPolicy(editor);

    this.toDispose.push(editor.onDocumentContentChanged(() => {
      const state = this.states.get(editor);
      if (!state) return;
      if (state.recheckTimer) clearTimeout(state.recheckTimer);
      state.recheckTimer = setTimeout(() => this.applyPolicy(editor), 750);
    }));
    widget.disposed.connect(() => {
      const state = this.states.get(editor);
      if (state?.recheckTimer) clearTimeout(state.recheckTimer);
      this.states.delete(editor);
    });
  }

  protected applyPolicy(editor: MonacoEditor): void {
    const state = this.states.get(editor);
    const model = editor.getControl().getModel();
    if (!state || !model) return;

    const enabled = this.preferences.get<boolean>('kairo.largeFiles.enabled', true);
    const detectedTier = enabled ? classifyLargeFile({
      characterCount: model.getValueLength(),
      lineCount: model.getLineCount(),
    }, this.thresholds()) : 'normal';
    const nextTier = state.forcedFullFeatures ? 'normal' : detectedTier;
    if (state.tier === nextTier) {
      this.renderStatus();
      return;
    }

    // Reset first so a huge -> large transition also removes huge-only
    // overrides (hover, quick suggestions, validation decorations, etc.).
    editor.getControl().updateOptions(state.originalOptions);
    if (model.getLanguageId() !== state.originalLanguage) {
      monaco.editor.setModelLanguage(model, state.originalLanguage);
    }
    if (nextTier !== 'normal') {
      editor.getControl().updateOptions(editorOptionsForLargeFile(nextTier));
      // Never strip syntax highlighting from source files — plaintext mode
      // made tens-of-thousands-line JSPs lose all coloring past the threshold.
      if (
        nextTier === 'huge'
        && !SYNTAX_LANGUAGE_IDS.has(state.originalLanguage)
        && model.getLanguageId() !== 'plaintext'
      ) {
        monaco.editor.setModelLanguage(model, 'plaintext');
      }
    }
    state.tier = nextTier;
    this.renderStatus();
  }

  protected thresholds(): LargeFileThresholds {
    return {
      largeCharacterCount: this.preferences.get(
        'kairo.largeFiles.largeCharacterCount',
        DEFAULT_LARGE_FILE_THRESHOLDS.largeCharacterCount,
      ),
      largeLineCount: this.preferences.get(
        'kairo.largeFiles.largeLineCount',
        DEFAULT_LARGE_FILE_THRESHOLDS.largeLineCount,
      ),
      hugeCharacterCount: this.preferences.get(
        'kairo.largeFiles.hugeCharacterCount',
        DEFAULT_LARGE_FILE_THRESHOLDS.hugeCharacterCount,
      ),
      hugeLineCount: this.preferences.get(
        'kairo.largeFiles.hugeLineCount',
        DEFAULT_LARGE_FILE_THRESHOLDS.hugeLineCount,
      ),
    };
  }

  protected currentManagedEditor(): { editor: MonacoEditor; state: ManagedEditorState } | undefined {
    const editor = this.editorManager.currentEditor?.editor;
    if (!(editor instanceof MonacoEditor)) return undefined;
    const state = this.states.get(editor);
    return state ? { editor, state } : undefined;
  }

  protected toggleCurrentEditor(): void {
    const current = this.currentManagedEditor();
    if (!current) return;
    current.state.forcedFullFeatures = !current.state.forcedFullFeatures;
    this.applyPolicy(current.editor);
    this.messages.info(current.state.forcedFullFeatures
      ? 'Full editor features enabled for this file. Editing may be slower.'
      : 'Automatic large-file protection restored.');
  }

  protected renderStatus(): void {
    const current = this.currentManagedEditor();
    if (!current || current.state.tier === 'normal') {
      this.statusBar.removeElement('kairo.largeFile');
      return;
    }
    const huge = current.state.tier === 'huge';
    this.statusBar.setElement('kairo.largeFile', {
      text: huge ? '$(warning) Huge file: lightweight mode' : '$(dashboard) Large file mode',
      tooltip: huge
        ? 'Syntax and language services are disabled. Click to enable full features temporarily.'
        : 'Expensive editor decorations are disabled. Click to enable full features temporarily.',
      alignment: StatusBarAlignment.RIGHT,
      priority: 110,
      command: KairoLargeFileCommands.TOGGLE_FULL_FEATURES.id,
    });
  }
}
