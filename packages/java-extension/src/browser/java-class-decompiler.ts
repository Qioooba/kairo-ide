// SPDX-License-Identifier: Apache-2.0
//
// Decompile .class files on disk (file:// URIs) using JDT LS's
// built-in FernFlower decompiler, and ensure jdt:// library class
// files get Java syntax highlighting and read-only protection.
//
// When a user opens a standalone .class file (e.g. under
// build/classes/ or WEB-INF/classes/), Theia's default file
// provider reads the raw bytecode and Monaco displays it as
// binary garbage with no language. This contribution:
//
//   1. Hooks monaco.editor.onDidCreateModel to intercept .class
//      models immediately after creation.
//   2. For jdt:// URIs (library jars, already decompiled by
//      JdtClassFileFsProvider) it corrects the language to 'java'
//      — jdt:// paths end in .class which does NOT match the
//      .java extension registered in java-monaco-registration.
//   3. For file:// URIs ending in .class it replaces the binary
//      content with decompiled source fetched from
//      JavaLanguageClient.classFileContents(uri), sets the
//      language to 'java', and marks the editor read-only.
//   4. Hooks monaco.editor.onDidCreateEditor (plus onDidChangeModel
//      per editor) to force readOnly on every editor that shows a
//      .class model (both jdt:// and file://) since decompiled
//      output must never be saved back to disk.
//
// Follows the existing Monaco hook pattern used by
// JavaMonacoRegistrationContribution and the JSP diagnostics.

import * as monaco from '@theia/monaco-editor-core';
import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Disposable } from '@theia/core/lib/common/disposable';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ILogger } from '@theia/core/lib/common/logger';
import { KairoI18nService } from '@kairo/i18n';
import { JavaLanguageClient } from './java-language-client';
import { JAVA_LANGUAGE_ID } from '../common/java-common';

const DECOMPILING_PLACEHOLDER_KEY = 'widget.java.decompile.placeholder' as const;
const DECOMPILE_FAILED_MSG_KEY = 'widget.java.decompile.failed' as const;

function isClassUri(uri: monaco.Uri): boolean {
  if (!uri.path.endsWith('.class')) return false;
  return uri.scheme === 'file' || uri.scheme === 'jdt';
}

@injectable()
export class JavaClassDecompilerContribution implements FrontendApplicationContribution, Disposable {
  @inject(JavaLanguageClient)
  protected readonly client!: JavaLanguageClient;

  @inject(MessageService)
  protected readonly messages!: MessageService;

  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  protected readonly subs: Disposable[] = [];

  onStart(): void {
    for (const editor of monaco.editor.getEditors()) {
      this.attachEditor(editor as monaco.editor.IStandaloneCodeEditor);
    }
    for (const model of monaco.editor.getModels()) {
      this.handleModel(model);
    }
    this.subs.push(
      monaco.editor.onDidCreateModel(model => this.handleModel(model)),
      monaco.editor.onDidCreateEditor(editor => {
        this.attachEditor(editor as monaco.editor.IStandaloneCodeEditor);
      }),
    );
  }

  protected attachEditor(editor: monaco.editor.IStandaloneCodeEditor): void {
    const applyReadOnly = () => {
      const model = editor.getModel();
      if (model && isClassUri(model.uri)) {
        editor.updateOptions({ readOnly: true });
      }
    };
    applyReadOnly();
    editor.onDidChangeModel(() => applyReadOnly());
  }

  protected handleModel(model: monaco.editor.ITextModel): void {
    if (!isClassUri(model.uri)) return;

    if (model.getLanguageId() !== JAVA_LANGUAGE_ID) {
      monaco.editor.setModelLanguage(model, JAVA_LANGUAGE_ID);
    }

    if (model.uri.scheme === 'jdt') {
      return;
    }

    this.decompileFileClass(model, model.uri.toString());
  }

  protected decompileFileClass(model: monaco.editor.ITextModel, uriStr: string): void {
    const initialValue = model.getValue();
    const looksLikeJava = /^(package |import |\/\*|\/\/|public |class |interface |enum |abstract |final |@)/.test(initialValue.trim());

    if (looksLikeJava) {
      return;
    }

    model.setValue(this.i18n.t(DECOMPILING_PLACEHOLDER_KEY));

    this.client.classFileContents(uriStr)
      .then(source => {
        if (model.isDisposed()) return;
        if (source && source.trim().length > 0) {
          model.setValue(source);
        } else {
          model.setValue(this.i18n.t(DECOMPILE_FAILED_MSG_KEY));
          this.messages.warn(this.i18n.t('widget.java.decompile.warnEmpty'));
        }
      })
      .catch(err => {
        if (model.isDisposed()) return;
        this.logger.warn('[java-decompile] Decompilation failed:', err);
        model.setValue(this.i18n.t(DECOMPILE_FAILED_MSG_KEY));
        this.messages.warn(this.i18n.t('widget.java.decompile.warnFailed'));
      });
  }

  dispose(): void {
    for (const d of this.subs) d.dispose();
    this.subs.length = 0;
  }
}
