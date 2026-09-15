/**
 * Unified Highlighting Service for Kairo IDE.
 *
 * Coordinates model life-cycle, viewport tracking, Worker communication,
 * and Monaco token storage updates.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { EditorManager } from '@theia/editor/lib/browser';
import type * as monaco from '@theia/monaco-editor-core';
import { TokenizerOwnerRegistry } from './tokenizer-owner-registry';
import { MonacoTokenizationAdapter, registerMonacoTokenizationAdapter } from './monaco-tokenization-adapter';
import { HighlightingWorkerInstance } from '../worker/highlighting-worker';
import { isJspFamily, detectLanguageAndDialect } from '../common/language-coverage';
import type { WorkerOutboundMessage, TokenBatchMessage } from '../common/highlight-protocol';

@injectable()
export class HighlightingService implements FrontendApplicationContribution {
  @inject(TokenizerOwnerRegistry)
  protected readonly ownerRegistry!: TokenizerOwnerRegistry;

  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  private workerInstance!: HighlightingWorkerInstance;
  private adapters = new Map<string, MonacoTokenizationAdapter>();
  private trackedModels = new Map<string, { model: monaco.editor.ITextModel; sub: DisposableCollection }>();
  private toDispose = new DisposableCollection();

  onStart(): void {
    this.initWorker();
    this.initAdapters();
    this.wireModelLifecycle();
    this.wireViewportTracking();
  }

  onStop(): void {
    this.toDispose.dispose();
    for (const entry of this.trackedModels.values()) {
      entry.sub.dispose();
    }
    this.trackedModels.clear();
  }

  private initWorker(): void {
    this.workerInstance = new HighlightingWorkerInstance((msg: WorkerOutboundMessage) => {
      this.handleWorkerMessage(msg);
    });
  }

  private initAdapters(): void {
    // Register adapters for primary languages: JSP family and Java
    const registerAdapter = (langId: string, dialect: string) => {
      const adapter = new MonacoTokenizationAdapter(langId, dialect, (uri, start, end) => {
        this.workerInstance.handleMessage({
          type: 'viewport',
          modelInstanceId: uri,
          startLine: start,
          endLine: end,
        });
      });

      this.adapters.set(langId, adapter);
      const reg = registerMonacoTokenizationAdapter(langId, adapter);

      this.ownerRegistry.registerOwner(langId, 'kairo-highlighting-service', `Kairo Highlighting Worker (${langId})`, () => {
        reg.dispose();
      });
    };

    registerAdapter('jsp', 'jsp');
    registerAdapter('java', 'java');
  }

  private getMonaco(): typeof monaco | undefined {
    if (typeof window === 'undefined') return undefined;
    try {
      return require('@theia/monaco-editor-core');
    } catch {
      return undefined;
    }
  }

  private wireModelLifecycle(): void {
    const monacoModule = this.getMonaco();
    if (!monacoModule) return;

    // 1. Existing models at startup
    for (const model of monacoModule.editor.getModels()) {
      this.trackModel(model);
    }

    // 2. New models
    this.toDispose.push(
      monacoModule.editor.onDidCreateModel(model => {
        this.trackModel(model);
      }),
    );

    // 3. Disposed models
    this.toDispose.push(
      monacoModule.editor.onWillDisposeModel(model => {
        this.untrackModel(model);
      }),
    );
  }

  private trackModel(model: monaco.editor.ITextModel): void {
    const uri = model.uri.toString();
    if (this.trackedModels.has(uri)) return;

    const langId = model.getLanguageId();
    const dialectInfo = detectLanguageAndDialect(uri);
    if (!isJspFamily(langId, dialectInfo.dialect) && langId !== 'java') {
      // Unmanaged language; let native tokenizer handle it
      return;
    }

    const sub = new DisposableCollection();
    this.trackedModels.set(uri, { model, sub });

    // Initial snapshot sync to Worker
    const eol = model.getEOL() === '\r\n' ? '\r\n' : '\n';
    this.workerInstance.handleMessage({
      type: 'snapshot',
      modelInstanceId: uri,
      uri,
      languageId: langId,
      dialect: dialectInfo.dialect,
      version: model.getVersionId(),
      text: model.getValue(),
      eol,
    });

    // Content change listener: send incremental edits
    let lastVersion = model.getVersionId();
    sub.push(
      model.onDidChangeContent(e => {
        const currentVersion = model.getVersionId();
        const changes = e.changes.map(c => ({
          rangeOffset: c.rangeOffset,
          rangeLength: c.rangeLength,
          text: c.text,
        }));

        this.workerInstance.handleMessage({
          type: 'edit',
          modelInstanceId: uri,
          uri,
          beforeVersion: lastVersion,
          afterVersion: currentVersion,
          changes,
        });
        lastVersion = currentVersion;
      }),
    );

    // Language change listener
    sub.push(
      model.onDidChangeLanguage(e => {
        const newLang = e.newLanguage;
        if (isJspFamily(newLang) || newLang === 'java') {
          this.workerInstance.handleMessage({
            type: 'snapshot',
            modelInstanceId: uri,
            uri,
            languageId: newLang,
            dialect: detectLanguageAndDialect(uri).dialect,
            version: model.getVersionId(),
            text: model.getValue(),
            eol,
          });
        }
      }),
    );
  }

  private untrackModel(model: monaco.editor.ITextModel): void {
    const uri = model.uri.toString();
    const entry = this.trackedModels.get(uri);
    if (entry) {
      entry.sub.dispose();
      this.trackedModels.delete(uri);
      this.workerInstance.handleMessage({
        type: 'dispose',
        modelInstanceId: uri,
      });
      for (const adapter of this.adapters.values()) {
        adapter.disposeSession(uri);
      }
    }
  }

  private wireViewportTracking(): void {
    const updateActiveViewport = () => {
      const editor = this.editorManager.currentEditor?.editor;
      if (editor && typeof (editor as any).getControl === 'function') {
        const control = (editor as any).getControl();
        const model = control?.getModel?.();
        if (model) {
          const uri = model.uri.toString();
          const visibleRanges = control.getVisibleRanges?.() ?? [];
          if (visibleRanges.length > 0) {
            const startLine = visibleRanges[0].startLineNumber;
            const endLine = visibleRanges[visibleRanges.length - 1].endLineNumber;
            this.workerInstance.handleMessage({
              type: 'viewport',
              modelInstanceId: uri,
              startLine,
              endLine,
            });
          }
        }
      }
    };

    this.toDispose.push(this.editorManager.onCurrentEditorChanged(() => updateActiveViewport()));
  }

  private handleWorkerMessage(msg: WorkerOutboundMessage): void {
    if (msg.type === 'tokens') {
      const batch = msg as TokenBatchMessage;
      const uri = batch.modelInstanceId;
      const tracked = this.trackedModels.get(uri);
      if (!tracked) return;

      const langId = tracked.model.getLanguageId();
      const adapter = this.adapters.get(langId);
      if (adapter) {
        adapter.applyTokenBatch(uri, batch);
      }
    } else if (msg.type === 'error') {
      console.warn('[kairo-highlighting] Worker error:', msg.message);
    }
  }

  getAdapter(languageId: string): MonacoTokenizationAdapter | undefined {
    return this.adapters.get(languageId);
  }
}
