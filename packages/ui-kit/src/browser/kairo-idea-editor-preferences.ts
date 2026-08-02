/**
 * Editor preference defaults that bring Monaco closer to IDEA Darcula.
 * Registered from ui-kit so the override ships even when theia-product
 * cannot rebuild (java-extension project-reference errors).
 */

import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';

export const kairoIdeaEditorPreferenceSchema: PreferenceSchema = {
  title: 'Kairo IDEA Editor Defaults',
  properties: {
    // Override Theia's default (true). IDEA Darcula does not rainbow-color
    // brackets; matching that keeps Java/JSP highlighting closer to IDEA.
    'editor.bracketPairColorization.enabled': {
      type: 'boolean',
      default: false,
      description:
        'Controls whether bracket pair colorization is enabled. Disabled by default to match IntelliJ IDEA Darcula.',
    },
  },
};

export const KairoIdeaEditorPreferenceContribution: PreferenceContribution = {
  schema: kairoIdeaEditorPreferenceSchema,
};
