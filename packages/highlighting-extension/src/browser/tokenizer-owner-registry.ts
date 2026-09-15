/**
 * Central Tokenizer Owner Registry for Kairo IDE.
 * Prevents multiple extensions from fighting over tokenization providers.
 */

import { injectable } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/lib/common/disposable';

export interface TokenizerRegistration {
  languageId: string;
  ownerId: string;
  description: string;
  dispose(): void;
}

@injectable()
export class TokenizerOwnerRegistry {
  private owners = new Map<string, TokenizerRegistration>();

  registerOwner(
    languageId: string,
    ownerId: string,
    description: string,
    disposer: () => void = () => {},
  ): Disposable {
    const existing = this.owners.get(languageId);
    if (existing) {
      if (existing.ownerId === ownerId) {
        return existing;
      }
      // Dispose prior owner cleanly before handing over
      try {
        existing.dispose();
      } catch (e) {
        console.warn(`[kairo-highlighting] Error disposing previous owner for ${languageId}:`, e);
      }
    }

    const reg: TokenizerRegistration = {
      languageId,
      ownerId,
      description,
      dispose: () => {
        if (this.owners.get(languageId) === reg) {
          this.owners.delete(languageId);
          disposer();
        }
      },
    };

    this.owners.set(languageId, reg);
    return reg;
  }

  getOwner(languageId: string): TokenizerRegistration | undefined {
    return this.owners.get(languageId);
  }

  hasOwner(languageId: string): boolean {
    return this.owners.has(languageId);
  }

  getAllOwners(): TokenizerRegistration[] {
    return Array.from(this.owners.values());
  }

  clear(): void {
    for (const reg of this.owners.values()) {
      try {
        reg.dispose();
      } catch {
        // ignore
      }
    }
    this.owners.clear();
  }
}

export const defaultTokenizerOwnerRegistry = new TokenizerOwnerRegistry();
