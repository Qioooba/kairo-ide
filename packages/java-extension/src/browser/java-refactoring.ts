// SPDX-License-Identifier: Apache-2.0
//
// Refactoring operations — extract method, extract variable,
// extract constant, inline, and other JDT LS refactorings.
//
// These are all driven by textDocument/codeAction with the
// appropriate `only` kind filter. JDT LS returns a CodeAction
// or a series of CodeActions; the first one with an `edit`
// field is applied.

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { JavaLanguageClient } from './java-language-client';
import { LSPCodeAction, LSPRange, LSPWorkspaceEdit } from '../common/lsp-protocol';

export interface RefactoringResult {
  success: boolean;
  /** The workspace edit to apply, or null. */
  edit: LSPWorkspaceEdit | null;
  /** Human-readable message. */
  message: string;
}

/**
 * Map of refactoring kind to its LSP codeAction `only` filter.
 * Reference: https://github.com/eclipse-jdtls/eclipse.jdt.ls/wiki/Refactoring
 */
const REFACTORING_KINDS: Record<string, string> = {
  'extractMethod': 'refactor.extract.method',
  'extractVariable': 'refactor.extract.variable',
  'extractConstant': 'refactor.extract.constant',
  'extractField': 'refactor.extract.field',
  'inline': 'refactor.inline',
  'move': 'refactor.move',
  'changeSignature': 'refactor.change.signature',
};

@injectable()
export class JavaRefactoring {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(JavaLanguageClient)
  protected readonly client!: JavaLanguageClient;

  /**
   * Execute a refactoring for the given kind and range.
   *
   * @param uri    The file URI.
   * @param range  The LSP range of the code to refactor.
   * @param kind   The refactoring kind (e.g. 'extractMethod').
   */
  async refactor(uri: string, range: LSPRange, kind: string): Promise<RefactoringResult> {
    const onlyKind = REFACTORING_KINDS[kind];
    if (!onlyKind) {
      return { success: false, edit: null, message: `Unknown refactoring kind: ${kind}. Supported: ${Object.keys(REFACTORING_KINDS).join(', ')}` };
    }

    if (await this.client.fetchState() !== 'ready') {
      return { success: false, edit: null, message: 'JDT Language Server is not ready.' };
    }

    try {
      const result = await this.client.codeActions({
        uri,
        range,
        diagnostics: [],
        only: [onlyKind],
      });

      if (!result || result.length === 0) {
        return { success: false, edit: null, message: `No ${kind} refactoring available at this location.` };
      }

      // Find the first CodeAction with an edit. JDT LS may
      // return a command-only action (e.g. for interactive
      // rename after extract) — prefer the one with an edit.
      const action = result.find(a => !('command' in a) && (a as LSPCodeAction).edit) as LSPCodeAction | undefined;
      if (!action || !action.edit) {
        return { success: false, edit: null, message: `${kind} refactoring returned no workspace edit.` };
      }

      return { success: true, edit: action.edit, message: `${kind} refactoring ready.` };
    } catch (err) {
      this.logger.error(`[JavaRefactoring] ${kind} failed: ${String(err)}`);
      return { success: false, edit: null, message: `${kind} refactoring failed: ${String(err)}` };
    }
  }

  /**
   * Convenience: extract the selected code into a new method.
   *
   * @param uri    The file URI.
   * @param range  The LSP range of the code to extract.
   * @param newMethodName  Optional: the desired method name
   *   (JDT LS may prompt for it via a command; if so the
   *   caller should handle the rename separately).
   */
  async extractMethod(uri: string, range: LSPRange, newMethodName?: string): Promise<RefactoringResult> {
    const result = await this.refactor(uri, range, 'extractMethod');
    if (!result.success || !result.edit) {
      return result;
    }

    // If a new method name was provided and the edit contains
    // the extracted method placeholder, apply a rename on top.
    if (newMethodName) {
      try {
        const renameEdit = await this.applyRename(uri, result.edit, newMethodName);
        if (renameEdit) {
          return { success: true, edit: renameEdit, message: `Extracted method '${newMethodName}'.` };
        }
      } catch (err) {
        this.logger.warn(`[JavaRefactoring] rename after extract failed: ${String(err)}`);
      }
    }

    return result;
  }

  /**
   * Extract a variable from the selected expression.
   */
  async extractVariable(uri: string, range: LSPRange): Promise<RefactoringResult> {
    return this.refactor(uri, range, 'extractVariable');
  }

  /**
   * Extract a constant from the selected expression.
   */
  async extractConstant(uri: string, range: LSPRange): Promise<RefactoringResult> {
    return this.refactor(uri, range, 'extractConstant');
  }

  /**
   * Inline the selected element.
   */
  async inline(uri: string, range: LSPRange): Promise<RefactoringResult> {
    return this.refactor(uri, range, 'inline');
  }

  /**
   * After extract method, JDT LS may use a placeholder name
   * like "extractedMethod". If the user provided a custom
   * name, rewrite that placeholder in every text edit
   * (declaration + call sites), not only the first match.
   */
  private async applyRename(_uri: string, edit: LSPWorkspaceEdit, newName: string): Promise<LSPWorkspaceEdit | null> {
    const placeholderName = findExtractedMethodPlaceholder(edit);
    if (!placeholderName) {
      return null;
    }
    const re = new RegExp(`\\b${escapeRegExp(placeholderName)}\\b`, 'g');
    let changed = false;

    const renameText = (text: string): string => {
      re.lastIndex = 0;
      const next = text.replace(re, newName);
      if (next !== text) {
        changed = true;
      }
      return next;
    };

    const updated: LSPWorkspaceEdit = {};
    if (edit.changes) {
      const changes: NonNullable<LSPWorkspaceEdit['changes']> = {};
      for (const [changeUri, edits] of Object.entries(edit.changes)) {
        changes[changeUri] = edits.map(me => {
          const newText = renameText(me.newText);
          return newText === me.newText ? me : { ...me, newText };
        });
      }
      updated.changes = changes;
    }
    if (edit.documentChanges) {
      updated.documentChanges = edit.documentChanges.map(dc => {
        if (!('edits' in dc) || !Array.isArray(dc.edits)) {
          return dc;
        }
        return {
          ...dc,
          edits: dc.edits.map(te => {
            const newText = renameText(te.newText);
            return newText === te.newText ? te : { ...te, newText };
          }),
        };
      });
    }
    return changed ? updated : null;
  }
}

/** Escape a literal for use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect the JDT LS extract-method placeholder name from any
 * text edit in the workspace edit (declaration or call site).
 */
function findExtractedMethodPlaceholder(edit: LSPWorkspaceEdit): string | undefined {
  const texts: string[] = [];
  for (const edits of Object.values(edit.changes ?? {})) {
    for (const e of edits) {
      texts.push(e.newText);
    }
  }
  for (const dc of edit.documentChanges ?? []) {
    if ('edits' in dc && Array.isArray(dc.edits)) {
      for (const e of dc.edits) {
        texts.push(e.newText);
      }
    }
  }
  for (const text of texts) {
    // Method declaration: "private ... void extractedMethod("
    const decl = /(?:void|int|String|boolean|long|double|float|char|byte|short)\s+(\w+)\s*\(/.exec(text);
    if (decl) {
      return decl[1];
    }
  }
  for (const text of texts) {
    if (/\bextractedMethod\b/.test(text)) {
      return 'extractedMethod';
    }
  }
  return undefined;
}