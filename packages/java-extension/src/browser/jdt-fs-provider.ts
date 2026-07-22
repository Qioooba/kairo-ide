// SPDX-License-Identifier: Apache-2.0
//
// Read-only FileSystemProvider for the `jdt` URI scheme.
//
// JDT LS answers go-to-definition into library jars with jdt://
// URIs (e.g. jdt://contents/<jar>/<pkg>/Foo.class?=<project>).
// Monaco can only open a URI whose scheme has a registered fs
// provider — without one, F12 into javax.servlet.* appeared
// dead (KAIRO-RC-WEB-251 live evidence). Reads are answered by
// the JDT LS `java/classFileContents` extension request via the
// JavaLanguageClient (backend RPC).

import { injectable, inject } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { Event } from '@theia/core/lib/common/event';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import {
  FileSystemProvider,
  FileType,
  FileChange,
  Stat,
  WatchOptions,
} from '@theia/filesystem/lib/common/files';
import { JavaLanguageClient } from './java-language-client';

@injectable()
export class JdtClassFileFsProvider implements FileSystemProvider {
  @inject(JavaLanguageClient)
  protected readonly client!: JavaLanguageClient;

  // FileSystemProviderCapabilities.Readonly (2048) |
  // FileReadWrite (2) — written as literals because the enum is
  // `declare const enum` in Theia and does NOT exist at runtime
  // (referencing it crashed the whole frontend on startup). The
  // FileReadWrite bit is REQUIRED for the buffered readFile
  // path: FileService refuses to read providers without it.
  readonly capabilities = 2048 | 2;
  readonly onDidChangeCapabilities = Event.None;
  readonly onDidChangeFile: Event<readonly FileChange[]> = Event.None;
  readonly onFileWatchError = Event.None;

  watch(_resource: URI, _opts: WatchOptions): Disposable {
    return Disposable.NULL;
  }

  async stat(_resource: URI): Promise<Stat> {
    // Contents are fetched lazily in readFile; size 0 is fine —
    // FileService streams the real bytes on read.
    return { type: FileType.File, ctime: 0, mtime: 0, size: 0 };
  }

  async readFile(resource: URI): Promise<Uint8Array> {
    const text = await this.client.classFileContents(resource.toString());
    return new TextEncoder().encode(text ?? '');
  }

  // Everything below is read-only/unsupported by contract.

  async mkdir(_resource: URI): Promise<void> {
    throw new Error('jdt: read-only');
  }
  async readdir(_resource: URI): Promise<[string, FileType][]> {
    return [];
  }
  async delete(_resource: URI, _opts: { recursive: boolean }): Promise<void> {
    throw new Error('jdt: read-only');
  }
  async rename(_from: URI, _to: URI, _opts: { overwrite: boolean }): Promise<void> {
    throw new Error('jdt: read-only');
  }

  protected readonly toDispose = new DisposableCollection();
  dispose(): void {
    this.toDispose.dispose();
  }
}
