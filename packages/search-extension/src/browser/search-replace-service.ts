import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import type { SearchMatch } from '@kairo/protocol';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { resolveWorkspaceMatchUri } from './search-path';

export const SEARCH_REPLACE_MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface ReplaceEdit { id: string; line: number; column: number; before: string; after: string; selected: boolean; }
export interface ReplaceFilePlan { file: string; fingerprint: string; encoding: string; mtime: number; etag: string; original: string; preview: string; edits: ReplaceEdit[]; }
export interface ReplacePlan { replacement: string; files: ReplaceFilePlan[]; }
export interface ReplaceApplyResult { file: string; status: 'applied' | 'failed' | 'skipped' | 'rolled-back' | 'rollback-failed' | 'rollback-unknown' | 'undone' | 'undo-rolled-back' | 'undo-rollback-failed'; edits: number; error?: string; }
interface PreparedFile { plan: ReplaceFilePlan; selected: ReplaceEdit[]; uri: ReturnType<typeof resolveWorkspaceMatchUri>; original: string; applied: string; encoding: string; mtime: number; etag: string; }
interface AppliedFile extends PreparedFile { postMtime: number; postEtag: string; }

@injectable()
export class SearchReplaceService {
  @inject(FileService) protected readonly files!: FileService;
  @inject(WorkspaceContextService) protected readonly workspace!: WorkspaceContextService;
  protected lastApply: AppliedFile[] | undefined;

  /**
   * Short-lived read cache for plan creation. Re-generating a plan (e.g.
   * while typing the replacement word) reuses recently read files instead
   * of hitting the filesystem once per keystroke per file.
   */
  protected static readonly READ_CACHE_TTL_MS = 5_000;
  protected static readonly READ_CACHE_MAX_ENTRIES = 64;
  protected readCache = new Map<string, { value: string; encoding: string; mtime: number; etag: string; at: number }>();

  async createPlan(matches: readonly SearchMatch[], replacement: string): Promise<ReplacePlan> {
    const grouped = new Map<string, SearchMatch[]>();
    for (const match of matches) grouped.set(match.file, [...(grouped.get(match.file) ?? []), match]);
    const context = this.workspace.requireContext();
    const plans: ReplaceFilePlan[] = [];
    const now = Date.now();
    if (this.readCache.size > 0) {
      for (const [key, entry] of this.readCache) {
        if (now - entry.at > SearchReplaceService.READ_CACHE_TTL_MS) this.readCache.delete(key);
      }
    }
    for (const [file, fileMatches] of grouped) {
      const uri = resolveWorkspaceMatchUri(context.workspaceRoot, file);
      const cacheKey = uri.toString();
      let read = this.readCache.get(cacheKey);
      if (!read || now - read.at > SearchReplaceService.READ_CACHE_TTL_MS) {
        const fresh = await this.files.read(uri, { acceptTextOnly: true, limits: { size: SEARCH_REPLACE_MAX_FILE_BYTES } });
        read = { value: fresh.value, encoding: fresh.encoding, mtime: fresh.mtime, etag: fresh.etag, at: now };
        if (this.readCache.size >= SearchReplaceService.READ_CACHE_MAX_ENTRIES) {
          const oldest = this.readCache.keys().next().value;
          if (oldest !== undefined) this.readCache.delete(oldest);
        }
        this.readCache.set(cacheKey, read);
      }
      if (new TextEncoder().encode(read.value).byteLength > SEARCH_REPLACE_MAX_FILE_BYTES) throw new Error(`File exceeds replace limit: ${file}`);
      if (read.value.includes('\0')) throw new Error(`Binary file cannot be replaced: ${file}`);
      const edits = locateEdits(read.value, fileMatches, replacement);
      plans.push({ file, fingerprint: fingerprint(read.value), encoding: read.encoding, mtime: read.mtime, etag: read.etag, original: read.value, preview: applyEdits(read.value, edits), edits });
    }
    return { replacement, files: plans };
  }

  async apply(plan: ReplacePlan): Promise<ReplaceApplyResult[]> {
    const context = this.workspace.requireContext();
    const prepared: PreparedFile[] = [];
    const skipped = plan.files.filter(file => !file.edits.some(edit => edit.selected)).map(file => ({ file: file.file, status: 'skipped' as const, edits: 0 }));
    // Phase 1: validate every target and construct every post-image. No writes
    // occur until the entire selected set has passed.
    for (const filePlan of plan.files) {
      const selected = filePlan.edits.filter(edit => edit.selected);
      if (!selected.length) continue;
      try {
        const uri = resolveWorkspaceMatchUri(context.workspaceRoot, filePlan.file);
        const current = await this.files.read(uri, { acceptTextOnly: true, limits: { size: SEARCH_REPLACE_MAX_FILE_BYTES } });
        if (fingerprint(current.value) !== filePlan.fingerprint || current.value !== filePlan.original) throw new Error('File changed after preview; regenerate the replace plan');
        prepared.push({ plan: filePlan, selected, uri, original: current.value, applied: applyEdits(current.value, selected), encoding: filePlan.encoding, mtime: current.mtime, etag: current.etag });
      } catch (error) {
        this.lastApply = undefined;
        return plan.files.map(file => file.file === filePlan.file
          ? { file: file.file, status: 'failed', edits: 0, error: error instanceof Error ? error.message : String(error) }
          : { file: file.file, status: 'skipped', edits: 0, error: 'Transaction cancelled during preflight; zero files written' });
      }
    }
    // Phase 2: write. A failure triggers best-effort compensation in reverse.
    const written: AppliedFile[] = [];
    for (const target of prepared) {
      try {
        const stat = await this.files.write(target.uri, target.applied, { encoding: target.encoding, mtime: target.mtime, etag: target.etag });
        written.push({ ...target, postMtime: stat.mtime, postEtag: stat.etag });
      } catch (error) {
        const writeError = error instanceof Error ? error.message : String(error);
        const rollbackTargets = [...written];
        const results: ReplaceApplyResult[] = [];
        // A provider can persist bytes and still reject (late fsync/transport
        // failure). Re-read the failed target before deciding it was untouched.
        try {
          const uncertain = await this.files.read(target.uri, { acceptTextOnly: true, limits: { size: SEARCH_REPLACE_MAX_FILE_BYTES } });
          if (uncertain.value === target.applied) rollbackTargets.push({ ...target, postMtime: uncertain.mtime, postEtag: uncertain.etag });
          else if (uncertain.value === target.original) results.push({ file: target.plan.file, status: 'failed', edits: 0, error: `Write failed before content changed: ${writeError}` });
          else results.push({ file: target.plan.file, status: 'rollback-unknown', edits: 0, error: `Write failed and target content is neither original nor applied: ${writeError}` });
        } catch (inspectError) {
          results.push({ file: target.plan.file, status: 'rollback-unknown', edits: 0, error: `Write failed and target state cannot be confirmed: ${inspectError instanceof Error ? inspectError.message : String(inspectError)}` });
        }
        for (const applied of [...rollbackTargets].reverse()) {
          try {
            const current = await this.files.read(applied.uri, { acceptTextOnly: true, limits: { size: SEARCH_REPLACE_MAX_FILE_BYTES } });
            if (current.value !== applied.applied || current.mtime !== applied.postMtime || current.etag !== applied.postEtag) throw new Error('Applied file drifted before rollback');
            await this.files.write(applied.uri, applied.original, { encoding: applied.encoding, mtime: current.mtime, etag: current.etag });
            results.push({ file: applied.plan.file, status: 'rolled-back', edits: applied.selected.length });
          } catch (rollbackError) {
            results.push({ file: applied.plan.file, status: 'rollback-failed', edits: applied.selected.length, error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) });
          }
        }
        for (const pending of prepared.slice(written.length + 1)) results.push({ file: pending.plan.file, status: 'skipped', edits: 0, error: 'Transaction stopped after write failure' });
        this.lastApply = undefined;
        return [...results, ...skipped];
      }
    }
    this.lastApply = written;
    return [...written.map(file => ({ file: file.plan.file, status: 'applied' as const, edits: file.selected.length })), ...skipped];
  }

  async undoLastApply(): Promise<ReplaceApplyResult[]> {
    const transaction = this.lastApply;
    if (!transaction?.length) return [{ file: '', status: 'failed', edits: 0, error: 'No replace transaction is available to undo' }];
    // Validate every post-image first. Drift anywhere means zero undo writes.
    const currentStats = [];
    for (const target of transaction) {
      try {
        const current = await this.files.read(target.uri, { acceptTextOnly: true, limits: { size: SEARCH_REPLACE_MAX_FILE_BYTES } });
        if (current.value !== target.applied || current.mtime !== target.postMtime || current.etag !== target.postEtag) throw new Error('File changed after replace; undo refused');
        currentStats.push(current);
      } catch (error) {
        return transaction.map(file => file === target
          ? { file: file.plan.file, status: 'failed', edits: 0, error: error instanceof Error ? error.message : String(error) }
          : { file: file.plan.file, status: 'skipped', edits: 0, error: 'Undo preflight failed; zero files restored' });
      }
    }
    const results: ReplaceApplyResult[] = [];
    const undone: Array<{ target: AppliedFile; undoMtime: number; undoEtag: string }> = [];
    for (let i = 0; i < transaction.length; i++) {
      const target = transaction[i]; const current = currentStats[i];
      try {
        const stat = await this.files.write(target.uri, target.original, { encoding: target.encoding, mtime: current.mtime, etag: current.etag });
        undone.push({ target, undoMtime: stat.mtime, undoEtag: stat.etag });
        results.push({ file: target.plan.file, status: 'undone', edits: target.selected.length });
      } catch (error) {
        const undoError = error instanceof Error ? error.message : String(error);
        try {
          const uncertain = await this.files.read(target.uri, { acceptTextOnly: true, limits: { size: SEARCH_REPLACE_MAX_FILE_BYTES } });
          if (uncertain.value === target.original) undone.push({ target, undoMtime: uncertain.mtime, undoEtag: uncertain.etag });
          else if (uncertain.value === target.applied) results.push({ file: target.plan.file, status: 'failed', edits: 0, error: `Undo failed before content changed: ${undoError}` });
          else results.push({ file: target.plan.file, status: 'rollback-unknown', edits: 0, error: `Undo failed with unknown target content: ${undoError}` });
        } catch (inspectError) {
          results.push({ file: target.plan.file, status: 'rollback-unknown', edits: 0, error: `Undo failed and target state cannot be confirmed: ${inspectError instanceof Error ? inspectError.message : String(inspectError)}` });
        }
        // Restore every successfully undone file to the applied post-image so a
        // failed Undo does not leave a half-undone transaction.
        for (const entry of [...undone].reverse()) {
          try {
            const now = await this.files.read(entry.target.uri, { acceptTextOnly: true, limits: { size: SEARCH_REPLACE_MAX_FILE_BYTES } });
            if (now.value !== entry.target.original || now.mtime !== entry.undoMtime || now.etag !== entry.undoEtag) throw new Error('Undone file drifted before Undo compensation');
            await this.files.write(entry.target.uri, entry.target.applied, { encoding: entry.target.encoding, mtime: now.mtime, etag: now.etag });
            results.push({ file: entry.target.plan.file, status: 'undo-rolled-back', edits: entry.target.selected.length });
          } catch (rollbackError) {
            results.push({ file: entry.target.plan.file, status: 'undo-rollback-failed', edits: entry.target.selected.length, error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) });
          }
        }
        for (const pending of transaction.slice(i + 1)) results.push({ file: pending.plan.file, status: 'skipped', edits: 0, error: 'Undo stopped after write failure' });
        return results;
      }
    }
    this.lastApply = undefined;
    return results;
  }
}

export function locateEdits(content: string, matches: readonly SearchMatch[], replacement: string): ReplaceEdit[] {
  const starts = [0]; for (let i = 0; i < content.length; i++) if (content[i] === '\n') starts.push(i + 1);
  const edits = matches.map((match, index) => {
    const lineStart = starts[match.line - 1]; if (lineStart === undefined) throw new Error(`Stale match line ${match.line}`);
    const lineEnd = content.indexOf('\n', lineStart); const line = content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd);
    const prefix = [...line].slice(0, Math.max(0, match.column - 1)).join(''); const offset = lineStart + prefix.length;
    if (content.slice(offset, offset + match.matchText.length) !== match.matchText) throw new Error(`File content drift at ${match.file}:${match.line}:${match.column}`);
    return { id: `${match.file}:${match.line}:${match.column}:${index}`, line: match.line, column: match.column, before: match.matchText, after: replacement, selected: true, offset };
  }).sort((a, b) => b.offset - a.offset);
  for (let i = 1; i < edits.length; i++) if (edits[i - 1].offset < edits[i].offset + edits[i].before.length) throw new Error('Overlapping replace matches');
  return edits.map(({ offset: _offset, ...edit }) => edit);
}

export function applyEdits(content: string, edits: readonly ReplaceEdit[]): string {
  if (edits.length === 0) return content;
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') starts.push(i + 1);
  // Resolve each edit's offset once (columns are rune-based), verify the
  // anchor text still matches, then assemble the result in a single pass.
  const positioned = edits.map(edit => {
    const lineStart = starts[edit.line - 1];
    if (lineStart === undefined) throw new Error(`Stale edit line ${edit.line}`);
    const lineEnd = content.indexOf('\n', lineStart);
    const line = content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd);
    const prefix = [...line].slice(0, Math.max(0, edit.column - 1)).join('');
    const offset = lineStart + prefix.length;
    if (content.slice(offset, offset + edit.before.length) !== edit.before) {
      throw new Error('File content drift during replace preview');
    }
    return { edit, offset };
  }).sort((a, b) => a.offset - b.offset);
  let out = '';
  let pos = 0;
  for (const { edit, offset } of positioned) {
    if (offset < pos) throw new Error('Overlapping replace matches');
    out += content.slice(pos, offset) + edit.after;
    pos = offset + edit.before.length;
  }
  out += content.slice(pos);
  return out;
}

export function fingerprint(value: string): string {
  let hash = 2166136261; for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}
