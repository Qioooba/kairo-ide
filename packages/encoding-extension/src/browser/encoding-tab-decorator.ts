/**
 * Kairo encoding tab decorator — shows the file's encoding as a
 * suffix on the editor tab title.
 *
 * The encoding is displayed as a subtle grey suffix like
 * " [GBK]" after the filename, so the user can see at a glance
 * what encoding each open file is in — without having to look
 * at the status bar.
 */

import { injectable, inject, postConstruct, optional } from '@theia/core/shared/inversify';
import { Navigatable } from '@theia/core/lib/browser';
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator';
import { WidgetDecoration } from '@theia/core/lib/browser/widget-decoration';
import { Emitter, Event, Disposable } from '@theia/core/lib/common';
import { Title, Widget } from '@theia/core/shared/@lumino/widgets';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { KairoEncodingServiceImpl } from './encoding-service';

@injectable()
export class KairoEncodingTabDecorator implements TabBarDecorator {
  readonly id = 'kairo-encoding-tab-decorator';

  @inject(EditorManager) protected editorManager!: EditorManager;
  @inject(KairoEncodingServiceImpl) protected encodingSvc!: KairoEncodingServiceImpl;
  // ActiveProjectService is optional to avoid cycle; used to refresh on project switch
  @inject('ActiveProjectService' as any) @optional() protected activeProject?: { onDidChangeProject: Event<any> };

  protected readonly onDidChangeDecorationsEmitter = new Emitter<void>();
  readonly onDidChangeDecorations: Event<void> = this.onDidChangeDecorationsEmitter.event;

  protected editorListener: Disposable | undefined;
  protected encodingListener: Disposable | undefined;
  protected projectListener: Disposable | undefined;
  protected currentEditorListener: Disposable | undefined;

  @postConstruct()
  protected init(): void {
    this.editorListener = this.editorManager.onCreated(() => {
      this.onDidChangeDecorationsEmitter.fire();
    });
    this.currentEditorListener = this.editorManager.onCurrentEditorChanged(() => {
      this.onDidChangeDecorationsEmitter.fire();
    });
    this.encodingListener = this.encodingSvc.onDidChangeEncoding(() => {
      this.onDidChangeDecorationsEmitter.fire();
    });
    if (this.activeProject?.onDidChangeProject) {
      this.projectListener = this.activeProject.onDidChangeProject(() => {
        this.onDidChangeDecorationsEmitter.fire();
      });
    }
  }

  dispose(): void {
    this.editorListener?.dispose();
    this.currentEditorListener?.dispose();
    this.encodingListener?.dispose();
    this.projectListener?.dispose();
    this.onDidChangeDecorationsEmitter.dispose();
  }

  decorate(title: Title<Widget>): WidgetDecoration.Data[] {
    const owner = title.owner as unknown as { getResourceUri?: () => unknown };
    // Prefer Navigatable but fall back to duck-typing for editor widgets that expose getResourceUri
    const uri: unknown = Navigatable.is(owner as any)
      ? (owner as any).getResourceUri()
      : typeof owner.getResourceUri === 'function'
        ? owner.getResourceUri()
        : undefined;
    if (!uri) {
      return [];
    }
    const enc = this.encodingSvc.getEncodingFor(uri as any);
    // Hide only plain utf-8; utf-8-bom and gbk etc. should show
    if (enc === 'utf8' || enc === 'utf-8') return [];
    const display = enc === 'utf8bom' || enc === 'utf-8-bom' ? 'UTF-8-BOM' : enc.toUpperCase();
    return [{
      captionSuffixes: [{
        data: ` [${display}]`,
        fontData: { color: 'var(--theia-descriptionForeground)' },
      }],
      tooltip: `File encoding: ${display}`,
    }];
  }
}