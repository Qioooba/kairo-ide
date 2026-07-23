// SPDX-License-Identifier: Apache-2.0
//
// Java index progress management — status bar, pause/resume,
// cache management (clear/reindex).
//
// Listens to $/progress notifications from the JDT LS and
// exposes an observable state that the product-level status
// bar can render.

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { JavaLanguageClient } from './java-language-client';
import type { LSPProgressParams } from '../common/lsp-protocol';

/** Snapshot of the current indexing progress. */
export interface IndexProgress {
  /** The overall progress token (e.g. "Importing Maven projects") */
  token: string;
  /** Human-readable title */
  title: string;
  /** Progress percentage 0-100, or undefined if indeterminate */
  percentage: number | undefined;
  /** Current status message */
  message: string | undefined;
  /** Whether indexing is active */
  active: boolean;
  /** Whether indexing can be paused (always false for JDT LS) */
  paused: boolean;
}

@injectable()
export class JavaIndexProgressService implements Disposable {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(JavaLanguageClient)
  protected readonly client!: JavaLanguageClient;

  protected readonly onProgressEmitter = new Emitter<IndexProgress>();
  readonly onProgress: Event<IndexProgress> = this.onProgressEmitter.event;

  protected readonly onIndexingCompleteEmitter = new Emitter<void>();
  readonly onIndexingComplete: Event<void> = this.onIndexingCompleteEmitter.event;

  /** Current progress state, keyed by progress token. */
  protected readonly progressMap = new Map<string | number, {
    title: string;
    percentage: number | undefined;
    message: string | undefined;
  }>();

  protected subs: Disposable[] = [];
  protected currentProgress: IndexProgress | undefined;

  @postConstruct()
  protected init(): void {
    this.subs.push(
      this.client.onProgress(params => this.handleProgress(params)),
    );
  }

  /** Current index progress snapshot. */
  getProgress(): IndexProgress | undefined {
    return this.currentProgress;
  }

  /** Whether there is any active indexing. */
  isIndexing(): boolean {
    return this.currentProgress?.active ?? false;
  }

  /**
   * Pause / resume indexing. JDT LS does not natively support
   * pause, so we track the state locally and suppress subsequent
   * progress events until resumed.
   */
  togglePause(): void {
    if (!this.currentProgress) return;
    this.currentProgress = {
      ...this.currentProgress,
      paused: !this.currentProgress.paused,
    };
    this.onProgressEmitter.fire(this.currentProgress);
  }

  /**
   * Clear the JDT LS workspace cache and force a full reindex.
   * This sends `java/buildWorkspace` (true) to trigger a rebuild.
   */
  async clearCache(): Promise<void> {
    try {
      this.logger.info('[JavaIndexProgress] clearing workspace cache...');
      this.progressMap.clear();
      this.currentProgress = undefined;
      await this.client.buildWorkspace(true);
      this.logger.info('[JavaIndexProgress] workspace rebuild triggered');
    } catch (err) {
      this.logger.warn(`[JavaIndexProgress] clearCache failed: ${String(err)}`);
    }
  }

  protected handleProgress(params: LSPProgressParams): void {
    const val = params.value;
    const token = String(params.token);

    if (val.kind === 'begin') {
      this.progressMap.set(params.token, {
        title: val.title,
        percentage: val.percentage,
        message: val.message,
      });
      this.currentProgress = {
        token,
        title: val.title,
        percentage: val.percentage,
        message: val.message,
        active: true,
        paused: false,
      };
      this.logger.info(`[JavaIndexProgress] begin: ${val.title} ${val.message ?? ''}`);
      this.onProgressEmitter.fire(this.currentProgress);
    } else if (val.kind === 'report') {
      const existing = this.progressMap.get(params.token) ?? { title: token, percentage: undefined, message: undefined };
      existing.percentage = val.percentage;
      existing.message = val.message;
      this.progressMap.set(params.token, existing);

      // Only update if not paused
      if (this.currentProgress && !this.currentProgress.paused) {
        this.currentProgress = {
          ...this.currentProgress,
          percentage: val.percentage,
          message: val.message,
        };
        this.onProgressEmitter.fire(this.currentProgress);
      }
    } else if (val.kind === 'end') {
      this.progressMap.delete(params.token);
      this.logger.info(`[JavaIndexProgress] end: ${token} ${val.message ?? ''}`);

      // Only fire complete if all progress tokens are done
      if (this.progressMap.size === 0) {
        this.currentProgress = undefined;
        this.onIndexingCompleteEmitter.fire();
      }
    }
  }

  dispose(): void {
    for (const d of this.subs) d.dispose();
    this.subs = [];
    this.onProgressEmitter.dispose();
    this.onIndexingCompleteEmitter.dispose();
  }
}