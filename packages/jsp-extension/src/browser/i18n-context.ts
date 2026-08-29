/**
 * Module-level translator shared by the JSP language modules.
 *
 * Most JSP language modules are plain functions/classes without DI and are
 * registered via register*() functions that accept an optional I18nService.
 * The service is stored here as a translator closure; before any register*
 * call (or when i18n is unavailable) the translator is the identity function,
 * so callers degrade to raw translation keys instead of crashing.
 */

import type { I18nService, KairoI18nKey } from '@kairo/i18n';

export type KairoTranslateFn = (key: KairoI18nKey, params?: Record<string, string | number>) => string;

let tFn: KairoTranslateFn = key => key;

/** Install a translator backed by the given i18n service (no-op if undefined). */
export function setJspI18n(i18n?: I18nService): void {
  if (i18n) {
    tFn = (key, params) => i18n.t(key, params);
  }
}

/** Translate via the installed translator (identity fallback before setup). */
export function t(key: KairoI18nKey, params?: Record<string, string | number>): string {
  return tFn(key, params);
}
