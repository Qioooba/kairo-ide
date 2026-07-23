/**
 * Java preference schema — registers kairo.java.* preferences
 * for format-on-save, organize-imports-on-save, and formatting
 * options.
 */

import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';

export const javaPreferencesSchema: PreferenceSchema = {
  title: 'Kairo Java',
  properties: {
    'kairo.java.formatOnSave': {
      type: 'boolean',
      default: false,
      description: 'Enable/disable automatic formatting of Java files on save.',
    },
    'kairo.java.organizeImportsOnSave': {
      type: 'boolean',
      default: false,
      description: 'Enable/disable automatic organize imports of Java files on save.',
    },
    'kairo.java.tabSize': {
      type: 'number',
      default: 4,
      minimum: 1,
      maximum: 8,
      description: 'The number of spaces for a tab in Java files.',
    },
    'kairo.java.insertSpaces': {
      type: 'boolean',
      default: true,
      description: 'Use spaces instead of tabs for indentation.',
    },
  },
};

export const JavaPreferenceContribution: PreferenceContribution = {
  schema: javaPreferencesSchema,
};