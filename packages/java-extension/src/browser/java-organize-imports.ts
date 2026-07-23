// SPDX-License-Identifier: Apache-2.0
//
// Organize Imports — triggers LSP textDocument/codeAction
// with the source.organizeImports kind, removes unused
// imports, sorts, and merges wildcards.
//
// JDT LS supports advancedOrganizeImportsSupport (set in
// initializationOptions), so the returned workspace edit
// covers the full import cleanup.

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { JavaLanguageClient } from './java-language-client';
import { LSPCodeAction, LSPWorkspaceEdit } from '../common/lsp-protocol';

export interface OrganizeImportsResult {
  /** Whether the operation succeeded. */
  success: boolean;
  /** The workspace edit to apply, or null if no changes needed. */
  edit: LSPWorkspaceEdit | null;
  /** Human-readable message for the user. */
  message: string;
}

@injectable()
export class JavaOrganizeImports {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(JavaLanguageClient)
  protected readonly client!: JavaLanguageClient;

  /**
   * Organize imports for the given file.
   *
   * Calls `textDocument/codeAction` with `only: ['source.organizeImports']`
   * for the full document range. JDT LS returns a single CodeAction whose
   * `edit` field contains the workspace edit to apply.
   *
   * @param uri  The file URI to organize imports in.
   */
  async organizeImports(uri: string): Promise<OrganizeImportsResult> {
    if (await this.client.fetchState() !== 'ready') {
      return { success: false, edit: null, message: 'JDT Language Server is not ready.' };
    }
    try {
      // Request code actions for the full document with the
      // organizeImports kind filter. Using a large range
      // ensures JDT LS considers the entire file.
      const result = await this.client.codeActions({
        uri,
        range: {
          start: { line: 0, character: 0 },
          end: { line: Number.MAX_SAFE_INTEGER, character: Number.MAX_SAFE_INTEGER },
        },
        diagnostics: [],
        only: ['source.organizeImports'],
      });

      if (!result || result.length === 0) {
        return { success: true, edit: null, message: 'No import changes needed.' };
      }

      // JDT LS returns a single CodeAction (not a Command) with
      // the workspace edit.
      const action = result[0] as LSPCodeAction;
      if (action.command) {
        // Some LS versions return a command instead of an edit;
        // we cannot execute LSP commands from the browser.
        this.logger.warn(`[JavaOrganizeImports] organizeImports returned command: ${action.command.command}`);
        return { success: false, edit: null, message: `Organize imports requires server-side command: ${action.command.title}` };
      }
      if (!action.edit) {
        return { success: true, edit: null, message: 'No import changes needed.' };
      }

      return { success: true, edit: action.edit, message: 'Imports organized.' };
    } catch (err) {
      this.logger.error(`[JavaOrganizeImports] organizeImports failed: ${String(err)}`);
      return { success: false, edit: null, message: `Organize imports failed: ${String(err)}` };
    }
  }
}