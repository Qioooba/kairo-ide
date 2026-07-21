/**
 * Appends the product name to the browser window title
 * (KAIRO-RC-WEB-008 follow-up).
 *
 * Theia's WindowTitleService builds the title from the
 * `window.title` preference template (default:
 * "Welcome - workspace") and never mentions the application
 * name unless the template includes ${appName}. Rather than
 * overriding the user's template, this contribution appends
 * " - Kairo IDE" to whatever the template produced, giving the
 * release build a branded title: "Welcome - workspace - Kairo IDE".
 */

import { WindowTitleContribution } from '@theia/core/lib/browser/window/window-title-service';

export class KairoWindowTitleContribution implements WindowTitleContribution {
  enhanceTitle(title: string): string {
    if (!title) {
      return title;
    }
    return title.endsWith('Kairo IDE') ? title : `${title} - Kairo IDE`;
  }
}
