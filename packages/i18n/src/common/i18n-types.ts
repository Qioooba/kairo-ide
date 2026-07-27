import type { KairoLanguageId } from './language-id';
import type { KairoI18nKey as KairoI18nKeyFromMessages } from '../locales/en';

/** All valid dot-separated translation keys for Kairo i18n. */
export type KairoI18nKey = KairoI18nKeyFromMessages;

/** Translation parameter type - key-value pairs for string interpolation. */
export type I18nParams = Record<string, string | number>;

/** Event subscription disposable (matches Theia's Event<T> contract). */
export interface Disposable {
  dispose(): void;
}

/**
 * Interface for the i18n service (browser-side) that components and services depend on.
 * Abstracting this makes testing easier and keeps coupling loose.
 */
export interface I18nService {
  t(key: KairoI18nKey, params?: I18nParams): string;
  getCurrentLanguage(): KairoLanguageId;
  setLanguage(lang: KairoLanguageId): Promise<void>;
  onDidChangeLanguage(listener: (lang: KairoLanguageId) => void): Disposable;
}

/** DI binding symbol for I18nService. */
export const I18nServiceSymbol = Symbol('I18nService');
