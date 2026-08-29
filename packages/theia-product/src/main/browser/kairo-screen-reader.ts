/**
 * Kairo Screen Reader Announcement Service.
 *
 * Provides a centralized mechanism for announcing important UI
 * events to screen readers via ARIA live regions. This improves
 * the accessibility of the Kairo IDE for users relying on
 * assistive technologies.
 *
 * Announcements include:
 *  - Editor actions (file opened, saved, closed)
 *  - Build/task status changes
 *  - Navigation events (go to definition, references found)
 *  - Error/warning notifications
 *  - Debug session state changes
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { KairoI18nService } from '@kairo/i18n';

/** Priority levels for screen reader announcements. */
export enum AriaPriority {
  /** Polite: announced after current speech finishes. */
  POLITE = 'polite',
  /** Assertive: announced immediately, interrupting current speech. */
  ASSERTIVE = 'assertive',
}

/** Configuration for a screen reader announcement. */
export interface AriaAnnouncement {
  message: string;
  priority: AriaPriority;
  /** Optional delay in ms before the announcement. */
  delay?: number;
}

/** Maximum number of announcements kept in the queue. */
const MAX_QUEUE_SIZE = 50;

@injectable()
export class KairoScreenReaderService {
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected politeRegion: HTMLElement | null = null;
  protected assertiveRegion: HTMLElement | null = null;
  protected announcementQueue: AriaAnnouncement[] = [];
  protected isProcessing = false;
  protected processingTimer: ReturnType<typeof setTimeout> | null = null;

  @postConstruct()
  protected init(): void {
    this.createAriaLiveRegions();
  }

  /**
   * Create ARIA live regions for announcements.
   * These are hidden elements that screen readers monitor.
   */
  protected createAriaLiveRegions(): void {
    // Polite region
    this.politeRegion = document.createElement('div');
    this.politeRegion.id = 'kairo-sr-polite';
    this.politeRegion.setAttribute('aria-live', 'polite');
    this.politeRegion.setAttribute('aria-atomic', 'true');
    this.politeRegion.setAttribute('role', 'status');
    this.politeRegion.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
    document.body.appendChild(this.politeRegion);

    // Assertive region
    this.assertiveRegion = document.createElement('div');
    this.assertiveRegion.id = 'kairo-sr-assertive';
    this.assertiveRegion.setAttribute('aria-live', 'assertive');
    this.assertiveRegion.setAttribute('aria-atomic', 'true');
    this.assertiveRegion.setAttribute('role', 'alert');
    this.assertiveRegion.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
    document.body.appendChild(this.assertiveRegion);
  }

  /**
   * Announce a message to screen readers.
   * @param message - The message to announce.
   * @param priority - Announcement priority (polite or assertive).
   */
  announce(message: string, priority: AriaPriority = AriaPriority.POLITE): void {
    this.announcementQueue.push({ message, priority });
    if (this.announcementQueue.length > MAX_QUEUE_SIZE) {
      this.announcementQueue.shift();
    }
    this.processQueue();
  }

  /**
   * Make an assertive (immediate) announcement.
   * Use for critical errors or urgent notifications.
   */
  announceUrgent(message: string): void {
    this.announce(message, AriaPriority.ASSERTIVE);
  }

  /**
   * Announce a delayed message (e.g., after a loading state).
   */
  announceDelayed(message: string, delayMs: number, priority: AriaPriority = AriaPriority.POLITE): void {
    this.announcementQueue.push({ message, priority, delay: delayMs });
    this.processQueue();
  }

  /**
   * Clear all pending announcements.
   */
  clear(): void {
    this.announcementQueue = [];
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }
    this.isProcessing = false;
  }

  /**
   * Process the announcement queue.
   */
  protected processQueue(): void {
    if (this.isProcessing || this.announcementQueue.length === 0) return;

    this.isProcessing = true;
    const next = this.announcementQueue.shift()!;

    const deliver = () => {
      const region = next.priority === AriaPriority.ASSERTIVE
        ? this.assertiveRegion
        : this.politeRegion;

      if (region) {
        // Clear and re-set to trigger screen reader re-read
        region.textContent = '';
        // Use requestAnimationFrame to ensure the clear is processed
        requestAnimationFrame(() => {
          if (region) {
            region.textContent = next.message;
          }
        });
      }

      this.isProcessing = false;
      // Process next announcement after a short delay
      this.processingTimer = setTimeout(() => {
        this.processingTimer = null;
        this.processQueue();
      }, 100);
    };

    if (next.delay) {
      this.processingTimer = setTimeout(() => {
        this.processingTimer = null;
        deliver();
      }, next.delay);
    } else {
      deliver();
    }
  }

  /**
   * Convenience method: announce editor opened.
   */
  announceEditorOpened(fileName: string): void {
    this.announce(this.i18n.t('a11y.screenReader.fileOpened', { name: fileName }));
  }

  /**
   * Convenience method: announce file saved.
   */
  announceFileSaved(fileName: string): void {
    this.announce(this.i18n.t('a11y.screenReader.fileSaved', { name: fileName }));
  }

  /**
   * Convenience method: announce build completed.
   */
  announceBuildCompleted(status: string): void {
    this.announce(this.i18n.t('a11y.screenReader.buildStatus', { status }));
  }

  /**
   * Convenience method: announce search results.
   */
  announceSearchResults(query: string, count: number): void {
    if (count === 0) {
      this.announce(this.i18n.t('a11y.screenReader.noResults', { query }));
    } else {
      this.announce(this.i18n.t('a11y.screenReader.resultsFound', { count, query }));
    }
  }

  /**
   * Convenience method: announce error.
   */
  announceError(message: string): void {
    this.announceUrgent(this.i18n.t('a11y.screenReader.errorPrefix', { message }));
  }

  /**
   * Clean up regions.
   */
  dispose(): void {
    this.clear();
    this.politeRegion?.remove();
    this.assertiveRegion?.remove();
    this.politeRegion = null;
    this.assertiveRegion = null;
  }
}