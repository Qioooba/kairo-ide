import * as React from 'react';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { I18nService, KairoI18nKey, I18nParams } from '../common/i18n-types';
import type { KairoLanguageId } from '../common/language-id';

/**
 * React context that holds the active I18nService instance.
 * Set by I18nFrontendApplicationContribution on startup.
 */
export const I18nContext = createContext<I18nService | null>(null);

/**
 * Hook: returns { t, lang, setLang } for use in React components.
 * Components re-render automatically when the language changes.
 */
export function useI18n(): {
  t: (key: KairoI18nKey, params?: I18nParams) => string;
  lang: KairoLanguageId;
  setLang: (lang: KairoLanguageId) => Promise<void>;
} {
  const service = useContext(I18nContext);
  const [lang, setLangState] = useState<KairoLanguageId>(service?.getCurrentLanguage() ?? 'en');

  useEffect(() => {
    if (!service) return;
    setLangState(service.getCurrentLanguage());
    const disposable = service.onDidChangeLanguage(newLang => setLangState(newLang));
    return () => disposable.dispose();
  }, [service]);

  const t = useCallback(
    (key: KairoI18nKey, params?: I18nParams): string => {
      return service ? service.t(key, params) : key;
    },
    [service, lang]
  );

  const setLang = useCallback(
    async (newLang: KairoLanguageId) => {
      await service?.setLanguage(newLang);
    },
    [service]
  );

  return { t, lang, setLang };
}

/**
 * Props for the <T> translation component.
 * Uses children (string) as the translation key for readability.
 */
export interface TProps {
  k: KairoI18nKey;
  params?: I18nParams;
  /** Optional element type to render, defaults to React.Fragment */
  as?: React.ElementType;
  className?: string;
}

/**
 * Translate component — render <T k="welcome.title" /> to get the translated string.
 * Shortcut for plain text in JSX: {t('welcome.title')}
 */
export function T({ k, params, as, className }: TProps): React.ReactElement {
  const { t } = useI18n();
  const text = t(k, params);
  if (as) {
    const Tag = as;
    return <Tag className={className}>{text}</Tag>;
  }
  return className ? <span className={className}>{text}</span> : <>{text}</>;
}

/** I18n provider wrapper, installed by the frontend contribution. */
export function I18nProvider({ service, children }: { service: I18nService; children: React.ReactNode }): React.ReactElement {
  return <I18nContext.Provider value={service}>{children}</I18nContext.Provider>;
}
