// SPDX-License-Identifier: Apache-2.0
//
// Recent completion boost — remember accepted items and promote
// them on the next suggest (beats IDEA's opaque MRU in practice
// because we also boost exact prefix matches from history).

export interface RecentCompletionEntry {
  label: string;
  kind?: number;
  filterText?: string;
  ts: number;
}

const MAX_RECENT = 50;

export class RecentCompletionStore {
  private items: RecentCompletionEntry[] = [];

  record(label: string, kind?: number, filterText?: string): void {
    const key = label;
    this.items = this.items.filter(i => i.label !== key);
    this.items.unshift({ label, kind, filterText, ts: Date.now() });
    if (this.items.length > MAX_RECENT) {
      this.items.length = MAX_RECENT;
    }
  }

  /** Lower number = higher priority. Returns undefined if not recent. */
  rank(label: string): number | undefined {
    const idx = this.items.findIndex(i => i.label === label);
    return idx >= 0 ? idx : undefined;
  }

  /** Apply sortText boost: recent items get '0rNN' prefix. */
  boostSortText(label: string, sortText: string | undefined): string {
    const idx = this.rank(label);
    if (idx === undefined) {
      return sortText ?? label;
    }
    const pad = String(idx).padStart(2, '0');
    return `0r${pad}${sortText ?? label}`;
  }

  snapshot(): RecentCompletionEntry[] {
    return this.items.slice();
  }

  clear(): void {
    this.items = [];
  }
}

export const globalRecentCompletions = new RecentCompletionStore();
