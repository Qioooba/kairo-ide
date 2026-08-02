import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandRegistry } from '@theia/core/lib/common/command';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { JavaLanguageClient } from '@kairo/java-extension';
import { fuzzyScore, type SearchEverywhereItem, type SearchEverywhereItemCategory, type SearchEverywhereProvider } from './search-everywhere-model';
import { FileIndexService } from './file-index-service';

@injectable()
export class SearchEverywhereFilesProvider implements SearchEverywhereProvider {
  readonly id = 'files';
  @inject(FileService) protected readonly files!: FileService;
  @inject(WorkspaceContextService) protected readonly workspace!: WorkspaceContextService;
  @inject(FileIndexService) protected readonly fileIndex!: FileIndexService;

  async search(query: string, signal: AbortSignal, limit: number): Promise<SearchEverywhereItem[]> {
    const context = this.workspace.requireContext();
    const root = URI.fromFilePath(context.workspaceRoot);
    try {
      const entries = await this.fileIndex.listFiles({
        workspaceId: context.workspaceId,
        maxFiles: 50_000,
        signal,
      });
      if (signal.aborted) return [];
      const results: SearchEverywhereItem[] = [];
      for (const entry of entries) {
        if (signal.aborted) return [];
        const nameScore = fuzzyScore(query, entry.name);
        const pathScore = fuzzyScore(query, entry.path);
        if (nameScore === undefined && pathScore === undefined) continue;
        const uri = root.resolve(entry.path);
        results.push({
          id: `file:${uri}`,
          category: 'files',
          label: entry.name,
          detail: entry.path,
          uri: uri.toString(),
        });
        if (results.length >= limit) break;
      }
      return results;
    } catch {
      return this.searchViaFileService(query, signal, limit, root);
    }
  }

  protected async searchViaFileService(query: string, signal: AbortSignal, limit: number, root: URI): Promise<SearchEverywhereItem[]> {
    const queue: URI[] = [root];
    const results: SearchEverywhereItem[] = [];
    let visited = 0;
    while (queue.length && results.length < limit && visited < 5000) {
      if (signal.aborted) return [];
      let stat;
      try { stat = await this.files.resolve(queue.shift()!); }
      catch (error) { if (signal.aborted) return []; console.warn('Search Everywhere skipped unreadable directory', error); continue; }
      for (const child of stat.children ?? []) {
        if (signal.aborted) return []; visited++;
        if (child.isDirectory && !['.git', '.svn', 'node_modules', 'target', 'build', 'dist', '.kairo'].includes(child.resource.path.base)) queue.push(child.resource);
        if (child.isFile && fuzzyScore(query, child.resource.path.toString()) !== undefined) {
          results.push({
            id: `file:${child.resource}`,
            category: 'files',
            label: child.resource.path.base,
            detail: root.relative(child.resource)?.toString(),
            uri: child.resource.toString(),
          });
        }
        if (results.length >= limit) break;
      }
    }
    return results;
  }
}

@injectable()
export class SearchEverywhereJavaProvider implements SearchEverywhereProvider {
  readonly id = 'java-symbols';
  @inject(JavaLanguageClient) protected readonly java!: JavaLanguageClient;
  async search(query: string, signal: AbortSignal, limit: number): Promise<SearchEverywhereItem[]> {
    const symbols = await this.java.workspaceSymbols(query); if (signal.aborted) return [];
    return (symbols ?? []).slice(0, limit).map(symbol => {
      const category: SearchEverywhereItemCategory = [5, 10, 11, 23].includes(symbol.kind) ? 'types' : 'symbols';
      const filePath = symbol.location.uri.replace(/^file:\/\/\//, '').replace(/^file:\/\//, '').replace(/.*\//, '');
      const detail = [symbol.containerName, filePath].filter(Boolean).join(' \u2014 ');
      return { id: `${category}:${symbol.location.uri}:${symbol.location.range.start.line}:${symbol.name}`, category, label: symbol.name, detail, uri: symbol.location.uri, line: symbol.location.range.start.line, character: symbol.location.range.start.character, kind: symbol.kind };
    });
  }
}

@injectable()
export class SearchEverywhereActionsProvider implements SearchEverywhereProvider {
  readonly id = 'actions';
  @inject(CommandRegistry) protected readonly commands!: CommandRegistry;
  async search(_query: string, signal: AbortSignal, limit: number): Promise<SearchEverywhereItem[]> {
    if (signal.aborted) return [];
    return [...this.commands.getAllCommands()]
      .filter(command => command.label && this.commands.isVisible(command.id))
      .map(command => ({ command, score: fuzzyScore(_query, `${command.label} ${command.category ?? ''}`) }))
      .filter(entry => entry.score !== undefined)
      .sort((a, b) => b.score! - a.score!)
      .slice(0, limit)
      .map(({ command }) => ({ id: `action:${command.id}`, category: 'actions', label: command.label!, detail: command.category, commandId: command.id }));
  }
}
