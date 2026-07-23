/**
 * Breakpoint management: groups, mute-all, and persistence.
 *
 * Wraps Theia's BreakpointManager to provide:
 * - Breakpoint groups (named collections of breakpoints)
 * - Mute/unmute all breakpoints
 * - Persist breakpoint state across IDE sessions
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { BreakpointManager } from '@theia/debug/lib/browser/breakpoint/breakpoint-manager';
import type { DebugBreakpoint as _DebugBreakpoint } from '@theia/debug/lib/browser/model/debug-breakpoint';
import { StorageService } from '@theia/core/lib/browser';

/** A named group of breakpoints. */
export interface BreakpointGroup {
  id: string;
  name: string;
  breakpointIds: Set<string>;
  enabled: boolean;
}

interface BreakpointGroupsData {
  groups: Array<{
    id: string;
    name: string;
    breakpointIds: string[];
    enabled: boolean;
  }>;
}

const STORAGE_KEY = 'kairo.java.breakpointGroups';

@injectable()
export class JavaBreakpointManager {
  @inject(BreakpointManager) protected readonly breakpointManager!: BreakpointManager;
  @inject(StorageService) protected readonly storage!: StorageService;

  protected readonly onDidChangeGroupsEmitter = new Emitter<readonly BreakpointGroup[]>();
  readonly onDidChangeGroups: Event<readonly BreakpointGroup[]> = this.onDidChangeGroupsEmitter.event;

  protected groups: Map<string, BreakpointGroup> = new Map();

  @postConstruct()
  protected init(): void {
    this.loadGroups();
  }

  // ── Mute / Unmute All ──────────────────────────────────────────

  get breakpointsEnabled(): boolean {
    return this.breakpointManager.breakpointsEnabled;
  }

  set breakpointsEnabled(enabled: boolean) {
    this.breakpointManager.breakpointsEnabled = enabled;
  }

  toggleAllBreakpoints(): boolean {
    const next = !this.breakpointManager.breakpointsEnabled;
    this.breakpointManager.breakpointsEnabled = next;
    return next;
  }

  muteAll(): void {
    this.breakpointManager.breakpointsEnabled = false;
  }

  unmuteAll(): void {
    this.breakpointManager.breakpointsEnabled = true;
  }

  // ── Breakpoint Groups ──────────────────────────────────────────

  getGroups(): readonly BreakpointGroup[] {
    return [...this.groups.values()];
  }

  getGroup(id: string): BreakpointGroup | undefined {
    return this.groups.get(id);
  }

  createGroup(name: string): BreakpointGroup {
    const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const group: BreakpointGroup = {
      id,
      name: name.trim() || `Group ${this.groups.size + 1}`,
      breakpointIds: new Set(),
      enabled: true,
    };
    this.groups.set(id, group);
    this.persist();
    this.fireChange();
    return group;
  }

  removeGroup(id: string): boolean {
    const removed = this.groups.delete(id);
    if (removed) {
      this.persist();
      this.fireChange();
    }
    return removed;
  }

  addToGroup(groupId: string, breakpointId: string): void {
    const group = this.groups.get(groupId);
    if (group) {
      group.breakpointIds.add(breakpointId);
      this.persist();
      this.fireChange();
    }
  }

  removeFromGroup(groupId: string, breakpointId: string): void {
    const group = this.groups.get(groupId);
    if (group) {
      group.breakpointIds.delete(breakpointId);
      this.persist();
      this.fireChange();
    }
  }

  toggleGroup(groupId: string): boolean | undefined {
    const group = this.groups.get(groupId);
    if (!group) return undefined;
    group.enabled = !group.enabled;
    for (const bpId of group.breakpointIds) {
      const bp = this.breakpointManager.getBreakpointById(bpId);
      if (bp) {
        this.breakpointManager.enableBreakpoint(bp, group.enabled);
      }
    }
    this.persist();
    this.fireChange();
    return group.enabled;
  }

  enableGroup(groupId: string, enabled: boolean): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    group.enabled = enabled;
    for (const bpId of group.breakpointIds) {
      const bp = this.breakpointManager.getBreakpointById(bpId);
      if (bp) {
        this.breakpointManager.enableBreakpoint(bp, enabled);
      }
    }
    this.persist();
    this.fireChange();
  }

  // ── Persistence ────────────────────────────────────────────────

  async persistAll(): Promise<void> {
    this.breakpointManager.save();
    this.persist();
  }

  async restoreAll(): Promise<void> {
    await this.breakpointManager.load();
    await this.loadGroups();
  }

  protected persist(): void {
    const data: BreakpointGroupsData = {
      groups: [...this.groups.values()].map(g => ({
        id: g.id,
        name: g.name,
        breakpointIds: [...g.breakpointIds],
        enabled: g.enabled,
      })),
    };
    this.storage.setData(STORAGE_KEY, data);
  }

  protected async loadGroups(): Promise<void> {
    try {
      const data = await this.storage.getData<BreakpointGroupsData>(
        STORAGE_KEY,
      );
      if (data?.groups) {
        this.groups.clear();
        for (const g of data.groups) {
          this.groups.set(g.id, {
            id: g.id,
            name: g.name,
            breakpointIds: new Set(g.breakpointIds),
            enabled: g.enabled,
          });
        }
        this.fireChange();
      }
    } catch {
      // Storage not available — start with empty groups.
    }
  }

  protected fireChange(): void {
    this.onDidChangeGroupsEmitter.fire(this.getGroups());
  }
}