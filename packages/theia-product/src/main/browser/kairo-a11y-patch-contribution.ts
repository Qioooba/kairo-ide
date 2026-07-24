/**
 * Runtime ARIA patch for stock Theia/Lumino chrome (KAIRO-RC-WEB-019).
 *
 * axe-core flags three violations that originate in Theia/Lumino
 * markup, not in Kairo widgets:
 *
 *   1. aria-prohibited-attr — #status-bar-theia-notification-center
 *      is a plain <div> with aria-label but no role.
 *   2. aria-required-children — ul.lm-TabBar-content has
 *      role="tablist" but its li.lm-TabBar-tab children have no
 *      role, so the tablist has no "tab" children.
 *   3. listitem — those same li elements are orphaned <li> because
 *      the parent ul's role is tablist, not list.
 *
 * Giving each tab li role="tab" (+ aria-selected tracking the
 * lm-mod-current class) fixes 2 and 3 at once; role="button" on
 * the notification center fixes 1. Lumino never manages ARIA
 * itself, so patched attributes are stable; a MutationObserver
 * re-applies them as tabs are created/activated.
 */

import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';

const NOTIFICATION_CENTER_ID = 'status-bar-theia-notification-center';

@injectable()
export class KairoA11yPatchContribution implements FrontendApplicationContribution {
  protected observer: MutationObserver | undefined;

  onStart(): void {
    // Poll for elements that may not exist yet when onStart fires.
    // Theia contributions create status bar entries asynchronously.
    let attempts = 0;
    const maxAttempts = 20;
    const interval = setInterval(() => {
      this.patchAll();
      attempts++;
      if (attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 250);
    this.observer = new MutationObserver(() => this.patchAll());
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  onStop(): void {
    this.observer?.disconnect();
  }

  protected patchAll(): void {
    const notificationCenter = document.getElementById(NOTIFICATION_CENTER_ID);
    if (notificationCenter && !notificationCenter.hasAttribute('role')) {
      notificationCenter.setAttribute('role', 'button');
    }

    // Kairo notification bell: Theia StatusBar renders a plain <div>
    // with aria-label but no role — axe-core flags aria-prohibited-attr.
    // Add role="button" so the aria-label is permitted.
    // Also strip unresolved Codicon variables like $(bell) from aria-label.
    const kairoNotifications = document.getElementById('status-bar-kairo.notifications');
    if (kairoNotifications) {
      if (!kairoNotifications.hasAttribute('role')) {
        kairoNotifications.setAttribute('role', 'button');
      }
      // Fix aria-label: strip unresolved Codicon variables like $(bell)
      const label = kairoNotifications.getAttribute('aria-label');
      if (label && /\$\([^)]+\)/.test(label)) {
        kairoNotifications.setAttribute('aria-label', label.replace(/\$\([^)]+\)\s*/g, ''));
      }
    }

    // Patch status bar elements for screen reader announcements (D4.2)
    this.patchStatusBar();

    for (const tab of Array.from(document.querySelectorAll<HTMLElement>('li.lm-TabBar-tab'))) {
      if (tab.getAttribute('role') !== 'tab') {
        tab.setAttribute('role', 'tab');
      }
      const selected = tab.classList.contains('lm-mod-current') ? 'true' : 'false';
      if (tab.getAttribute('aria-selected') !== selected) {
        tab.setAttribute('aria-selected', selected);
      }
      // Side-bar (activity bar) tabs hide .lm-TabBar-tabLabel via
      // CSS, and axe's accessible-name computation ignores hidden
      // content (aria-tab-name). Always set an explicit aria-label
      // from the label text, tooltip, or id — it merely duplicates
      // the visible label on main-area tabs.
      const label = tab.querySelector('.lm-TabBar-tabLabel');
      const name = (((label && label.textContent) || '').trim())
        || tab.title
        || tab.id.replace(/^shell-tab-/, '').replace(/-/g, ' ');
      if (name && tab.getAttribute('aria-label') !== name) {
        tab.setAttribute('aria-label', name);
      }
    }
  }

  /** Add aria-live regions to status bar entries for dynamic content (D4.2). */
  protected patchStatusBar(): void {
    const statusBar = document.getElementById('theia-statusBar');
    if (!statusBar) return;
    // Mark status bar elements with text content that changes as live regions
    const elements = statusBar.querySelectorAll<HTMLElement>('.element');
    for (const el of elements) {
      if (!el.hasAttribute('aria-live')) {
        el.setAttribute('aria-live', 'polite');
      }
    }
  }
}
