// SPDX-License-Identifier: Apache-2.0
//
// Java diagnostics manager — registers JDT LS diagnostics with
// the Theia MarkerManager so they appear in the Problems panel.
//
// The diagnostics are already rendered as editor markers via
// monaco.editor.setModelMarkers in java-document-sync.ts. This
// manager additionally feeds them into the Theia problem
// infrastructure so the Problems panel shows them, with
// filtering by file and severity.
//
// When JDT LS is not running, a fallback IntelliSense
// diagnostics provider detects basic Java errors (syntax,
// type, unused-variable, missing-import) through text analysis.

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { URI } from '@theia/core/lib/common/uri';
import { Disposable } from '@theia/core/lib/common/disposable';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { MarkerManager } from '@theia/markers/lib/browser/marker-manager';
import { Diagnostic } from '@theia/core/shared/vscode-languageserver-protocol';
import { JavaLanguageClient } from './java-language-client';
import { JavaIntelliSenseProvider } from './java-intellisense-provider';
import type { LSPDiagnostic } from '../common/lsp-protocol';
import * as monaco from '@theia/monaco-editor-core';

/** Owner string used to distinguish Java diagnostics from other sources. */
export const JAVA_DIAGNOSTICS_OWNER = 'kairo-java';
export const JAVA_DIAGNOSTICS_KIND = 'problem';

@injectable()
export class JavaDiagnosticsManager extends MarkerManager<Diagnostic> implements FrontendApplicationContribution {
  @inject(JavaLanguageClient)
  protected readonly client!: JavaLanguageClient;

  @inject(JavaIntelliSenseProvider)
  protected readonly intellisense!: JavaIntelliSenseProvider;

  protected subs: Disposable[] = [];

  /** Track source text for fallback diagnostics. */
  private sourceCache = new Map<string, string>();

  getKind(): string {
    return JAVA_DIAGNOSTICS_KIND;
  }

  @postConstruct()
  protected override init(): void {
    super.init();
    this.subs.push(
      this.client.onDiagnostics(params => {
        const uri = new URI(params.uri);
        const diagnostics = params.diagnostics.map(d => toVscodeDiagnostic(d));
        this.setMarkers(uri, JAVA_DIAGNOSTICS_OWNER, diagnostics);
      }),
    );

    // Listen to Monaco model changes for fallback diagnostics.
    this.subs.push(
      monaco.editor.onDidCreateModel(model => {
        if (model.getLanguageId() === 'java') {
          this.sourceCache.set(model.uri.toString(), model.getValue());
          this.runFallbackDiagnostics(model.uri.toString());
          this.subs.push(model.onDidChangeContent(() => {
            this.sourceCache.set(model.uri.toString(), model.getValue());
            this.runFallbackDiagnostics(model.uri.toString());
          }));
        }
      }),
    );
    this.subs.push(
      monaco.editor.onWillDisposeModel(model => {
        this.sourceCache.delete(model.uri.toString());
      }),
    );
  }

  /** Run fallback diagnostics for a given URI. */
  private async runFallbackDiagnostics(uriStr: string): Promise<void> {
    try {
      if (await this.client.fetchState() === 'ready') {
        // JDT LS is running — it will provide diagnostics.
        return;
      }
    } catch {
      // Can't check state, run fallback anyway.
    }
    const source = this.sourceCache.get(uriStr);
    if (!source) return;
    const diags = this.intellisense.provideDiagnostics(source, uriStr);
    const vscodeDiags: Diagnostic[] = diags.map(d => ({
      range: {
        start: { line: d.line, character: d.startColumn },
        end: { line: d.endLine, character: d.endColumn },
      },
      severity: d.severity,
      code: d.code,
      source: JAVA_DIAGNOSTICS_OWNER,
      message: d.message,
    }));
    this.setMarkers(new URI(uriStr), JAVA_DIAGNOSTICS_OWNER, vscodeDiags);
  }

  onStart(_app: FrontendApplication): void {
    // Initialization is handled in @postConstruct.
  }

  dispose(): void {
    for (const d of this.subs) d.dispose();
    this.subs = [];
  }
}

/** Convert our internal LSPDiagnostic to the vscode Diagnostic type used by Theia's MarkerManager. */
function toVscodeDiagnostic(d: LSPDiagnostic): Diagnostic {
  return {
    range: {
      start: { line: d.range.start.line, character: d.range.start.character },
      end: { line: d.range.end.line, character: d.range.end.character },
    },
    severity: d.severity,
    code: d.code as Diagnostic['code'],
    source: d.source ?? JAVA_DIAGNOSTICS_OWNER,
    message: d.message,
    tags: d.tags as Diagnostic['tags'],
    relatedInformation: d.relatedInformation?.map(ri => ({
      location: {
        uri: ri.location.uri,
        range: {
          start: { line: ri.location.range.start.line, character: ri.location.range.start.character },
          end: { line: ri.location.range.end.line, character: ri.location.range.end.character },
        },
      },
      message: ri.message,
    })),
    data: d.data,
  };
}