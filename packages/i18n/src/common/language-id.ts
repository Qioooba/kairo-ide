/**
 * Supported language identifiers (BCP 47 language tags).
 * Add new language IDs here when adding locales.
 */
export const KAIRO_LANGUAGE_IDS = ['en', 'zh-CN'] as const;

export type KairoLanguageId = typeof KAIRO_LANGUAGE_IDS[number];

/**
 * Default language (English) - used as fallback when translations are missing.
 */
export const KAIRO_DEFAULT_LANGUAGE: KairoLanguageId = 'en';

/** Preference key for the UI language setting. */
export const KAIRO_LANGUAGE_PREFERENCE = 'kairo.language';

/**
 * Available languages with their display labels (shown in settings).
 */
export const KAIRO_AVAILABLE_LANGUAGES: ReadonlyArray<{ id: KairoLanguageId; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
];
