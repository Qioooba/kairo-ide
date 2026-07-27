import type { KairoLanguageId } from '../common/language-id';
import type { KairoI18nMessages } from './en';

/**
 * Lazy-load a language pack by its language ID.
 * Uses dynamic import so each locale is code-split and loaded on demand.
 */
export async function loadMessages(lang: KairoLanguageId): Promise<KairoI18nMessages> {
  switch (lang) {
    case 'zh-CN':
      return (await import('./zh-CN')).default as KairoI18nMessages;
    case 'en':
    default:
      return (await import('./en')).default as KairoI18nMessages;
  }
}
