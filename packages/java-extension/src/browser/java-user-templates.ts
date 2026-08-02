// SPDX-License-Identifier: Apache-2.0
//
// User-defined Live Templates — persisted via StorageService.
// Merged with built-in templates; user prefixes override built-ins.

import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { StorageService } from '@theia/core/lib/browser';
import { Emitter, Event } from '@theia/core/lib/common/event';

export interface UserLiveTemplate {
  prefix: string;
  label: string;
  insertText: string;
  detail?: string;
  category?: string;
}

const STORAGE_KEY = 'kairo.java.userLiveTemplates';

@injectable()
export class JavaUserLiveTemplatesService {
  @inject(StorageService) @optional()
  protected readonly storage?: StorageService;

  protected templates: UserLiveTemplate[] = [];
  protected loaded = false;

  protected readonly onDidChangeEmitter = new Emitter<UserLiveTemplate[]>();
  readonly onDidChange: Event<UserLiveTemplate[]> = this.onDidChangeEmitter.event;

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.storage) return;
    try {
      const raw = await this.storage.getData<UserLiveTemplate[]>(STORAGE_KEY);
      if (Array.isArray(raw)) {
        this.templates = raw.filter(t => t && typeof t.prefix === 'string' && typeof t.insertText === 'string');
      }
    } catch {
      this.templates = [];
    }
  }

  list(): UserLiveTemplate[] {
    return this.templates.slice();
  }

  async upsert(template: UserLiveTemplate): Promise<void> {
    await this.ensureLoaded();
    const prefix = template.prefix.trim();
    if (!prefix) return;
    const next: UserLiveTemplate = {
      prefix,
      label: template.label?.trim() || prefix,
      insertText: template.insertText,
      detail: template.detail || 'User template',
      category: template.category || 'User',
    };
    const idx = this.templates.findIndex(t => t.prefix === prefix);
    if (idx >= 0) {
      this.templates[idx] = next;
    } else {
      this.templates.push(next);
    }
    await this.persist();
  }

  async remove(prefix: string): Promise<void> {
    await this.ensureLoaded();
    this.templates = this.templates.filter(t => t.prefix !== prefix);
    await this.persist();
  }

  protected async persist(): Promise<void> {
    if (this.storage) {
      await this.storage.setData(STORAGE_KEY, this.templates);
    }
    this.onDidChangeEmitter.fire(this.list());
  }
}
