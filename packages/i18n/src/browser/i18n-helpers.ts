import type { interfaces } from '@theia/core/shared/inversify';
import { I18nServiceSymbol, type I18nService } from '../common';

/**
 * Helper to get the I18nService from an Inversify container.
 * Use this in factory functions where you can't use @inject directly.
 */
export function getI18nService(container: interfaces.Container): I18nService {
  return container.get<I18nService>(I18nServiceSymbol);
}

/**
 * Format an ISO timestamp for user-facing display in the caller's locale.
 *
 * Agent payloads carry full ISO strings (`2026-09-15T16:48:46.5190851Z`)
 * that are unreadable in narrow side panels — render a compact localized
 * date+time instead. Empty input yields `''`; unparseable input is
 * returned verbatim so raw ids/values never vanish.
 */
export function formatTimestamp(value: string | undefined | null, locale: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
