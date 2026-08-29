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
      // JDT LS 1.55 has a known bug where `only: ['source.organizeImports']`
      // with a large range throws coveringNode NPE (see theia.log
      // QuickAssistProcessor.getFullyCoveredNodes). Fall back to
      // unfiltered request and pick the organize action manually.
      let result: import('../common/lsp-protocol').LSPCodeActionResult | null = null;
      let needsFallback = false;
      // Use a tiny range (0,0) instead of whole-document 100000 – JDT LS 1.55
      // throws coveringNode NPE for whole-document source.organizeImports
      // when the file has duplicate imports. The import edit is file-wide
      // regardless of range, so a cursor-sized range is sufficient.
      const tinyRange = {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      };
      try {
        result = await this.client.codeActions({
          uri,
          range: tinyRange,
          diagnostics: [],
          only: ['source.organizeImports'],
        });
        // JDT LS bug: filtered request may silently return empty (fallback [])
        // when it should have returned the organize action. Treat empty as failure
        // and retry unfiltered.
        if (!result || result.length === 0) {
          this.logger.warn(`[JavaOrganizeImports] filtered request returned empty, retrying unfiltered`);
          needsFallback = true;
        }
      } catch (e) {
        const msg = String(e);
        if (msg.includes('coveringNode') || msg.includes('Internal error') || msg.includes('-32603')) {
          this.logger.warn(`[JavaOrganizeImports] filtered organizeImports failed, retrying unfiltered: ${msg.slice(0, 200)}`);
          needsFallback = true;
        } else {
          throw e;
        }
      }
      if (needsFallback) {
        result = await this.client.codeActions({
          uri,
          range: tinyRange,
          diagnostics: [],
        });
        // pick only the organize imports action(s)
        if (result) {
          const allTitles = (result as LSPCodeAction[]).map(a => `${a.title}(${a.kind ?? 'no-kind'})`).join(', ');
          this.logger.warn(`[JavaOrganizeImports] unfiltered result len=${result.length} titles=${allTitles.slice(0, 500)}`);
          const filtered = (result as LSPCodeAction[]).filter(
            a => (a as LSPCodeAction).kind === 'source.organizeImports' || (a as LSPCodeAction).title === 'Organize imports',
          );
          this.logger.warn(`[JavaOrganizeImports] filtered len=${filtered.length} titles=${filtered.map(a=>a.title).join(',')}`);
          if (filtered.length > 0) result = filtered as import('../common/lsp-protocol').LSPCodeActionResult;
          else {
            // if still no organize action, keep original empty result
            // so caller gets "No import changes needed"
            if (filtered.length === 0) {
              // check if unfiltered result was also empty – keep as is
            }
          }
        }
      }

      if (!result || result.length === 0) {
        return { success: true, edit: null, message: 'No import changes needed.' };
      }

      // JDT LS returns either a CodeAction with edit/command, or a bare Command.
      // 1.55 returns a bare Command: {"title":"Organize imports","command":"java.apply.workspaceEdit","arguments":[{changes:{...}}]}
      // Older versions return CodeAction with edit or command object.
      const raw = result[0] as any;
      this.logger.warn(`[JavaOrganizeImports] raw action full=${JSON.stringify(raw).slice(0, 800)}`);
      // Case 1: bare Command (command is string)
      if (typeof raw.command === 'string') {
        const cmd = raw.command as string;
        const args = raw.arguments as unknown[] | undefined;
        this.logger.warn(`[JavaOrganizeImports] bare Command cmd=${cmd} hasArgs=${!!args}`);
        if (cmd === 'java.apply.workspaceEdit' && Array.isArray(args) && args[0]) {
          const edit = args[0] as LSPWorkspaceEdit;
          if ((edit as any).changes || (edit as any).documentChanges) {
            return { success: true, edit, message: 'Imports organized.' };
          }
        }
        // Fall through to failure if not applyWorkspaceEdit
        return { success: false, edit: null, message: `Organize imports requires server-side command: ${raw.title}` };
      }
      const action = raw as LSPCodeAction;
      this.logger.warn(`[JavaOrganizeImports] action title=${action.title} kind=${action.kind} hasEdit=${!!action.edit} hasCommand=${!!action.command} cmd=${(action.command as any)?.command}`);
      if (action.edit) {
        return { success: true, edit: action.edit, message: 'Imports organized.' };
      }
      if (action.command) {
        const cmdObj = action.command as any;
        // command may be string (bare) or object
        const cmdName = typeof cmdObj === 'string' ? cmdObj : cmdObj.command;
        const cmdArgs = typeof cmdObj === 'string' ? (raw.arguments as unknown[] | undefined) : cmdObj.arguments;
        if (cmdName === 'java.apply.workspaceEdit' && Array.isArray(cmdArgs) && cmdArgs[0]) {
          const edit = cmdArgs[0] as LSPWorkspaceEdit;
          if ((edit as any).changes || (edit as any).documentChanges) {
            return { success: true, edit, message: 'Imports organized.' };
          }
        }
        this.logger.warn(`[JavaOrganizeImports] organizeImports returned command: ${cmdName} title=${(action.command as any).title ?? action.title} args=${JSON.stringify(cmdArgs).slice(0, 300)}`);
        if (cmdArgs && Array.isArray(cmdArgs) && cmdArgs[0]) {
          const maybeEdit = cmdArgs[0] as LSPWorkspaceEdit;
          if ((maybeEdit as any).changes || (maybeEdit as any).documentChanges) {
            return { success: true, edit: maybeEdit, message: 'Imports organized.' };
          }
        }
        return { success: false, edit: null, message: `Organize imports requires server-side command: ${action.title}` };
      }
      this.logger.warn(`[JavaOrganizeImports] no edit/command in action, returning No changes`);
      return { success: true, edit: null, message: 'No import changes needed.' };
    } catch (err) {
      this.logger.error(`[JavaOrganizeImports] organizeImports failed: ${String(err)}`);
      return { success: false, edit: null, message: `Organize imports failed: ${String(err)}` };
    }
  }
}