/**
 * Kairo encoding tab decorator — shows the file's encoding as a
 * suffix on the editor tab title.
 *
 * The encoding is displayed as a subtle grey suffix like
 * " [GBK]" after the filename, so the user can see at a glance
 * what encoding each open file is in — without having to look
 * at the status bar.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator';
import { WidgetDecoration } from '@theia/core/lib/browser/widget-decoration';
import { Emitter, Event, Disposable } from '@theia/core/lib/common';
import { Title, Widget } from '@theia/core/shared/@lumino/widgets';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { KairoEncodingServiceImpl } from './encoding-service';
import URI from '@theia/core/lib/common/uri';

@injectable()
export class KairoEncodingTabDecorator implements TabBarDecorator {
  readonly id = 'kairo-encoding-tab-decorator';

  @inject(EditorManager) protected editorManager!: EditorManager;
  @inject(KairoEncodingServiceImpl) protected encodingSvc!: KairoEncodingServiceImpl;

  protected readonly onDidChangeDecorationsEmitter = new Emitter<void>();
  readonly onDidChangeDecorations: Event<void> = this.onDidChangeDecorationsEmitter.event;

  protected editorListener: Disposable | undefined;
  protected encodingListener: Disposable | undefined;

  @postConstruct()
  protected init(): void {
    // Refresh when the active editor changes
    this.editorListener = this.editorManager.onCurrentEditorChanged(() => {
      this.onDidChangeDecorationsEmitter.fire();
    });
    // Refresh when the encoding changes for the current file
    this.encodingListener = this.encodingSvc.onDidChangeEncoding(() => {
      this.onDidChangeDecorationsEmitter.fire();
    });
  }

  dispose(): void {
    this.editorListener?.dispose();
    this.encodingListener?.dispose();
    this.onDidChangeDecorationsEmitter.dispose();
  }

  decorate(title: Title<Widget>): WidgetDecoration.Data[] {
    const editor = this.editorManager.currentEditor;
    if (!editor) return [];
    // Only decorate the editor tab that matches the current editor
    if (title.owner !== editor) return [];
    const uri = editor.editor.document.uri;
    if (!uri) return [];
    const enc = this.encodingSvc.getEncodingFor(uri as unknown as URI);
    // Don't show suffix for plain UTF-8 — it's the default and
    // would be visual noise on every file.
    if (enc === 'utf8' || enc === 'utf-8') return [];
    const display = enc === 'utf8bom' ? 'UTF-8-BOM' : enc.toUpperCase();
    return [{
      captionSuffixes: [{
        data: ` [${display}]`,
        fontData: { color: 'var(--theia-descriptionForeground)' },
      }],
      tooltip: `File encoding: ${display}`,
    }];
  }
}