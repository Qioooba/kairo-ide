import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import { KAIRO_LANGUAGE_PREFERENCE, KAIRO_DEFAULT_LANGUAGE } from '../common/language-id';

/**
 * Registers the "kairo.language" preference under the Kairo IDE settings category.
 * Appears as a dropdown in the Settings UI.
 */
export const kairoI18nPreferenceSchema: PreferenceSchema = {
  title: 'Kairo IDE',
  properties: {
    [KAIRO_LANGUAGE_PREFERENCE]: {
      type: 'string',
      enum: ['en', 'zh-CN'],
      enumDescriptions: ['English', '简体中文'],
      default: KAIRO_DEFAULT_LANGUAGE,
      description: 'Language used for the Kairo IDE user interface (menus, dialogs, buttons).',
    },
  },
};

export const KairoI18nPreferenceContribution: PreferenceContribution = {
  schema: kairoI18nPreferenceSchema,
};
