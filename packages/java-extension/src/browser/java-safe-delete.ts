// SPDX-License-Identifier: Apache-2.0
//
// Safe Delete — find all references to an element, show a
// preview of affected files, confirm, then apply the
// workspace edit to remove the element and its references.
//
// The flow:
//   1. Find all references to the element at the cursor
//   2. Group references by file
//   3. Return a preview of affected files for the caller
//      to display in a confirmation dialog
//   4. On confirmation, the caller deletes the element
//      declaration and all references

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { JavaLanguageClient } from './java-language-client';
import { LSPLocation as _LSPLocation, LSPWorkspaceEdit, LSPTextEdit } from '../common/lsp-protocol';

export interface SafeDeletePreview {
  /** The file containing the element to delete. */
  uri: string;
  /** The element name. */
  elementName: string;
  /** Files that reference the element (excluding the definition file). */
  affectedFiles: string[];
  /** Total reference count. */
  referenceCount: number;
}

export interface SafeDeleteResult {
  success: boolean;
  /** The workspace edit with all deletions, or null. */
  edit: LSPWorkspaceEdit | null;
  message: string;
}

@injectable()
export class JavaSafeDelete {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(JavaLanguageClient)
  protected readonly client!: JavaLanguageClient;

  /**
   * Preview the safe delete: find all references to the
   * element at the given position and return the affected
   * files.
   *
   * @param uri          The file URI containing the element.
   * @param line         0-based line number.
   * @param character    0-based character offset.
   */
  async previewDelete(uri: string, line: number, character: number): Promise<SafeDeletePreview | null> {
    if (await this.client.fetchState() !== 'ready') {
      this.logger.warn('[JavaSafeDelete] JDT LS not ready');
      return null;
    }
    try {
      const refs = await this.client.references({ uri, line, character, includeDeclaration: true });
      if (refs.length === 0) {
        return null;
      }
      // Collect unique affected files (deduplicate by URI).
      const fileSet = new Set<string>();
      for (const ref of refs) {
        fileSet.add(ref.uri);
      }
      const affectedFiles = Array.from(fileSet).filter(u => u !== uri);
      return {
        uri,
        elementName: `element at ${line}:${character}`,
        affectedFiles,
        referenceCount: refs.length,
      };
    } catch (err) {
      this.logger.error(`[JavaSafeDelete] previewDelete failed: ${String(err)}`);
      return null;
    }
  }

  /**
   * Execute the safe delete. Removes all references to the
   * element by replacing each reference range with an empty
   * string.
   *
   * @param uri          The file URI containing the element.
   * @param line         0-based line number.
   * @param character    0-based character offset.
   */
  async executeDelete(uri: string, line: number, character: number): Promise<SafeDeleteResult> {
    if (await this.client.fetchState() !== 'ready') {
      return { success: false, edit: null, message: 'JDT Language Server is not ready.' };
    }
    try {
      const refs = await this.client.references({ uri, line, character, includeDeclaration: true });
      if (refs.length === 0) {
        return { success: false, edit: null, message: 'No references found to delete.' };
      }

      // Build a workspace edit: for each reference, create a
      // text edit that replaces the reference text with an
      // empty string. Group edits by file URI.
      const changes: Record<string, LSPTextEdit[]> = {};
      for (const ref of refs) {
        const edits = changes[ref.uri] ?? (changes[ref.uri] = []);
        edits.push({ range: ref.range, newText: '' });
      }

      const edit: LSPWorkspaceEdit = { changes };
      return {
        success: true,
        edit,
        message: `Deleted ${refs.length} reference(s) across ${Object.keys(changes).length} file(s).`,
      };
    } catch (err) {
      this.logger.error(`[JavaSafeDelete] executeDelete failed: ${String(err)}`);
      return { success: false, edit: null, message: `Safe delete failed: ${String(err)}` };
    }
  }
}