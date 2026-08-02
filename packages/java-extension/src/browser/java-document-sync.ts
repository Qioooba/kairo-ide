// SPDX-License-Identifier: Apache-2.0
//
// Monaco wiring for JDT LS document sync + diagnostics.
//
// Feeds Monaco model events (create / content change /
// language change / dispose) for language 'java' into the
// monaco-free JavaDocumentSync core, and renders backend
// publishDiagnostics as editor markers via
// monaco.editor.setModelMarkers. Registration mirrors the
// other monaco contributions: monaco is imported as a
// module, never via window.monaco.

import * as monaco from '@theia/monaco-editor-core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Disposable } from '@theia/core/lib/common/disposable';
import { JAVA_LANGUAGE_ID } from '../common/java-common';
import { JavaLanguageClient } from './java-language-client';
import { JavaDocumentSync, lspDiagnosticsToMarkers } from './java-document-sync-core';

@injectable()
export class JavaDocumentSyncContribution implements FrontendApplicationContribution, Disposable {
  @inject(JavaLanguageClient)
  protected readonly client!: JavaLanguageClient;

  @inject(ILogger)
  protected readonly logger!: ILogger;

  protected sync: JavaDocumentSync | undefined;
  protected subs: Disposable[] = [];
  /** uris currently open in the sync core, keyed by model uri string. */
  protected readonly openUris = new Set<string>();

  onStart(): void {
    this.sync = new JavaDocumentSync(this.client, this.logger);

    for (const model of monaco.editor.getModels()) {
      this.attachModel(model);
    }
    this.subs.push(
      monaco.editor.onDidCreateModel(model => this.attachModel(model)),
    );

    // Re-send buffered didOpens when the server becomes ready,
    // mark them unsent when it goes away (restart / crash).
    this.subs.push(
      this.client.onState(state => this.sync?.handleStateChange(state)),
    );

    // Render backend diagnostics as editor markers.
    this.subs.push(
      this.client.onDiagnostics(params => {
        const model = monaco.editor.getModel(monaco.Uri.parse(params.uri));
        if (!model) {
          return;
        }
        monaco.editor.setModelMarkers(model, JAVA_LANGUAGE_ID, lspDiagnosticsToMarkers(params.diagnostics));
      }),
    );
  }

  protected attachModel(model: monaco.editor.ITextModel): void {
    const uri = model.uri.toString();
    const modelSubs: Disposable[] = [];

    const openIfJava = (): void => {
      if (model.getLanguageId() !== JAVA_LANGUAGE_ID || this.openUris.has(uri)) {
        return;
      }
      this.openUris.add(uri);
      this.sync?.openDocument({
        uri,
        languageId: JAVA_LANGUAGE_ID,
        version: model.getVersionId(),
        text: model.getValue(),
      });
    };

    openIfJava();

    modelSubs.push(
      model.onDidChangeLanguage(() => {
        if (model.getLanguageId() === JAVA_LANGUAGE_ID) {
          openIfJava();
        } else if (this.openUris.delete(uri)) {
          this.sync?.closeDocument(uri);
        }
      }),
      model.onDidChangeContent(() => {
        if (model.getLanguageId() === JAVA_LANGUAGE_ID && this.openUris.has(uri)) {
          this.sync?.changeDocument(uri, model.getVersionId(), model.getValue());
        }
      }),
      model.onWillDispose(() => {
        if (this.openUris.delete(uri)) {
          this.sync?.closeDocument(uri);
        }
        for (const d of modelSubs) {
          d.dispose();
        }
      }),
    );
    this.subs.push(...modelSubs);
  }

  /**
   * Flush pending document changes before language features
   * (completion / hover) so JDT LS sees the latest buffer.
   */
  flushPending(uri?: string): void {
    this.sync?.flushPending(uri);
  }

  dispose(): void {
    for (const d of this.subs) {
      d.dispose();
    }
    this.subs = [];
    this.openUris.clear();
    this.sync?.dispose();
    this.sync = undefined;
  }
}
