import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger, Emitter, Event } from '@theia/core/lib/common';
import { PreferenceService, PreferenceChange } from '@theia/core/lib/common/preferences';
import { KAIRO_LANGUAGE_PREFERENCE, KAIRO_DEFAULT_LANGUAGE, KairoLanguageId } from '../common/language-id';
import type { I18nService, KairoI18nKey, I18nParams } from '../common/i18n-types';
import type { KairoI18nMessages } from '../locales/en';
import enMessages from '../locales/en';

/**
 * Core i18n service for Kairo IDE.
 *
 * Responsibilities:
 * - English messages are bundled statically (always available synchronously as fallback).
 * - Non-English language packs are lazy-loaded via dynamic import on language switch.
 * - Provides type-safe translation via t().
 * - Fires onDidChangeLanguage so widgets/commands can re-render.
 * - Fallback chain: current language → English → key string.
 */
@injectable()
export class KairoI18nService implements I18nService {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(PreferenceService) protected readonly preferences!: PreferenceService;

  private currentLanguage: KairoLanguageId = KAIRO_DEFAULT_LANGUAGE;
  private messages: KairoI18nMessages = enMessages;
  private readonly fallbackMessages: KairoI18nMessages = enMessages;
  private readonly onDidChangeLanguageEmitter = new Emitter<KairoLanguageId>();
  private initialized = false;

  readonly onDidChangeLanguage: Event<KairoLanguageId> = this.onDidChangeLanguageEmitter.event;

  @postConstruct()
  protected init(): void {
    // English fallback is immediately available synchronously.
    this.messages = enMessages;
  }

  /**
   * Load the configured language pack (async) and wire preference listener.
   * Called from KairoI18nFrontendContribution.onStart().
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const configuredLang = this.preferences.get<KairoLanguageId>(KAIRO_LANGUAGE_PREFERENCE, KAIRO_DEFAULT_LANGUAGE);
    await this.setLanguage(this.sanitizeLang(configuredLang), false);

    this.preferences.onPreferenceChanged((e: PreferenceChange) => {
      if (e.preferenceName === KAIRO_LANGUAGE_PREFERENCE) {
        const newLang = this.preferences.get<KairoLanguageId>(KAIRO_LANGUAGE_PREFERENCE, KAIRO_DEFAULT_LANGUAGE);
        if (newLang !== this.currentLanguage) {
          this.setLanguage(this.sanitizeLang(newLang)).catch(err => {
            this.logger.error('Failed to switch language:', err);
          });
        }
      }
    });
  }

  getCurrentLanguage(): KairoLanguageId {
    return this.currentLanguage;
  }

  t(key: KairoI18nKey, params?: I18nParams): string {
    const translated = this.getNestedTranslation(this.messages, key);
    if (translated !== undefined) {
      return this.interpolate(translated, params);
    }
    const fallback = this.getNestedTranslation(this.fallbackMessages, key);
    if (fallback !== undefined) {
      return this.interpolate(fallback, params);
    }
    return key;
  }

  async setLanguage(lang: KairoLanguageId, fireEvent = true): Promise<void> {
    const sanitized = this.sanitizeLang(lang);
    if (sanitized === KAIRO_DEFAULT_LANGUAGE) {
      this.messages = this.fallbackMessages;
      this.currentLanguage = sanitized;
      if (fireEvent) this.onDidChangeLanguageEmitter.fire(sanitized);
      return;
    }
    try {
      const mod = await this.loadLocale(sanitized);
      this.messages = mod.default as KairoI18nMessages;
      this.currentLanguage = sanitized;
      if (fireEvent) this.onDidChangeLanguageEmitter.fire(sanitized);
    } catch (err) {
      this.logger.error(`Failed to load language pack for ${sanitized}:`, err);
      this.messages = this.fallbackMessages;
      this.currentLanguage = KAIRO_DEFAULT_LANGUAGE;
      if (fireEvent) this.onDidChangeLanguageEmitter.fire(KAIRO_DEFAULT_LANGUAGE);
    }
  }

  /** Dynamic-import the requested locale bundle. */
  private async loadLocale(lang: KairoLanguageId): Promise<{ default: KairoI18nMessages }> {
    switch (lang) {
      case 'zh-CN':
        return import('../locales/zh-CN');
      default:
        return import('../locales/en');
    }
  }

  private getNestedTranslation(obj: unknown, dottedKey: string): string | undefined {
    const parts = dottedKey.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return typeof current === 'string' ? current : undefined;
  }

  private interpolate(template: string, params?: I18nParams): string {
    if (!params || Object.keys(params).length === 0) {
      return template;
    }
    return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
      return params[key] !== undefined ? String(params[key]) : `{${key}}`;
    });
  }

  private sanitizeLang(lang: string | undefined): KairoLanguageId {
    if (lang === 'en' || lang === 'zh-CN') {
      return lang;
    }
    return KAIRO_DEFAULT_LANGUAGE;
  }
}
