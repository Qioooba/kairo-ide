/**
 * Virtual Document Manager — unified ownership and lifecycle for JSP virtual CU files.
 *
 * Prevents concurrent completion and diagnostics from fighting over didOpen / didClose
 * on the same virtual URI (F17 / T38 / T39).
 */

import { parseVirtualUri } from './jsp-virtual-java';

export interface VirtualDocumentLease {
  readonly uri: string;
  readonly version: number;
  readonly generation: number;
  /** Check whether this lease is still valid (not disposed and generation unchanged) */
  isCurrent(): boolean;
  /** Release this lease */
  dispose(): void;
}

export interface ILanguageClientBridge {
  didOpen(params: { uri: string; languageId: string; version: number; text: string }): void | Promise<void>;
  didChange?(params: {
    uri: string;
    version: number;
    changes: Array<{
      range?: { start: { line: number; character: number }; end: { line: number; character: number } };
      rangeLength?: number;
      text: string;
    }>;
  }): void | Promise<void>;
  didClose(uri: string): void | Promise<void>;
}

interface DocumentEntry {
  uri: string;
  jspUri?: string;
  languageId: string;
  version: number;
  generation: number;
  text: string;
  isOpen: boolean;
  activeLeases: number;
}

export class VirtualDocumentManager {
  private docs = new Map<string, DocumentEntry>();
  private client: ILanguageClientBridge | undefined;

  constructor(client?: ILanguageClientBridge) {
    this.client = client;
  }

  setClient(client: ILanguageClientBridge | undefined): void {
    this.client = client;
  }

  getClient(): ILanguageClientBridge | undefined {
    return this.client;
  }

  /**
   * Acquire an ephemeral lease on a virtual document (used by completion).
   * Ensures the document is opened on the language client once.
   * If the document is already open with different text, sends didChange.
   */
  async acquireLease(
    uri: string,
    text: string,
    languageId: string = 'java',
    jspUri?: string,
  ): Promise<VirtualDocumentLease> {
    const entry = await this.ensureOpenedOrUpdated(uri, text, languageId, jspUri);
    entry.activeLeases++;

    const capturedGeneration = entry.generation;
    const capturedVersion = entry.version;
    let disposed = false;

    return {
      uri,
      version: capturedVersion,
      generation: capturedGeneration,
      isCurrent: () => {
        if (disposed) return false;
        const cur = this.docs.get(uri);
        return !!cur && cur.isOpen && cur.generation === capturedGeneration;
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const cur = this.docs.get(uri);
        if (cur && cur.activeLeases > 0) {
          cur.activeLeases--;
        }
      },
    };
  }

  /**
   * Synchronize document content (used by background diagnostics).
   * Does not hold an ephemeral lease, but ensures document is open and up-to-date.
   */
  async syncDocument(
    uri: string,
    text: string,
    languageId: string = 'java',
    jspUri?: string,
  ): Promise<number> {
    const entry = await this.ensureOpenedOrUpdated(uri, text, languageId, jspUri);
    return entry.generation;
  }

  private async ensureOpenedOrUpdated(
    uri: string,
    text: string,
    languageId: string,
    jspUri?: string,
  ): Promise<DocumentEntry> {
    let entry = this.docs.get(uri);
    if (!entry) {
      entry = {
        uri,
        jspUri,
        languageId,
        version: 1,
        generation: 1,
        text,
        isOpen: false,
        activeLeases: 0,
      };
      this.docs.set(uri, entry);
    } else if (jspUri && !entry.jspUri) {
      entry.jspUri = jspUri;
    }

    if (!entry.isOpen) {
      entry.version = 1;
      entry.text = text;
      entry.isOpen = true;
      if (this.client) {
        try {
          await this.client.didOpen({
            uri,
            languageId,
            version: entry.version,
            text,
          });
        } catch {
          // ignore language client transient errors
        }
      }
    } else if (entry.text !== text) {
      entry.version++;
      entry.text = text;
      if (this.client) {
        try {
          if (typeof this.client.didChange === 'function') {
            await this.client.didChange({
              uri,
              version: entry.version,
              changes: [{ text }],
            });
          } else {
            await this.client.didOpen({
              uri,
              languageId,
              version: entry.version,
              text,
            });
          }
        } catch {
          // ignore
        }
      }
    }

    return entry;
  }

  /**
   * Explicitly close a virtual document (e.g. scriptlet block deleted).
   * Invalidates existing leases by advancing generation and sends didClose.
   */
  async closeDocument(uri: string): Promise<void> {
    const entry = this.docs.get(uri);
    if (!entry) return;

    entry.generation++;
    const wasOpen = entry.isOpen;
    entry.isOpen = false;
    entry.activeLeases = 0;
    this.docs.delete(uri);

    if (wasOpen && this.client) {
      try {
        await this.client.didClose(uri);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Close all virtual documents derived from a parent JSP URI.
   */
  async closeAllForJsp(jspUri: string): Promise<void> {
    const targets: string[] = [];
    for (const [uri, entry] of this.docs.entries()) {
      if (entry.jspUri === jspUri || parseVirtualUri(uri)?.jspUri === jspUri) {
        targets.push(uri);
      }
    }
    for (const uri of targets) {
      await this.closeDocument(uri);
    }
  }

  isGenerationCurrent(uri: string, generation: number): boolean {
    const cur = this.docs.get(uri);
    return !!cur && cur.isOpen && cur.generation === generation;
  }

  isDocumentOpen(uri: string): boolean {
    const cur = this.docs.get(uri);
    return !!cur && cur.isOpen;
  }

  getActiveLeaseCount(uri: string): number {
    return this.docs.get(uri)?.activeLeases ?? 0;
  }

  getOpenDocumentCount(): number {
    let count = 0;
    for (const doc of this.docs.values()) {
      if (doc.isOpen) count++;
    }
    return count;
  }

  getGeneration(uri: string): number {
    return this.docs.get(uri)?.generation ?? 0;
  }
}

/** Global default instance for jsp-extension. */
export const defaultVirtualDocumentManager = new VirtualDocumentManager();
