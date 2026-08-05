import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';

export const kairoLargeFilePreferenceSchema: PreferenceSchema = {
  title: 'Kairo Large Files',
  properties: {
    'kairo.largeFiles.enabled': {
      type: 'boolean',
      default: true,
      description: 'Automatically reduce expensive editor features for large source files.',
    },
    'kairo.largeFiles.largeCharacterCount': {
      type: 'integer',
      default: 5_000_000,
      minimum: 100_000,
      description: 'Character count that enables large-file mode.',
    },
    'kairo.largeFiles.largeLineCount': {
      type: 'integer',
      default: 100_000,
      minimum: 1_000,
      description: 'Line count that enables large-file mode.',
    },
    'kairo.largeFiles.hugeCharacterCount': {
      type: 'integer',
      default: 50_000_000,
      minimum: 500_000,
      description: 'Character count that enables lightweight mode for non-code files.',
    },
    'kairo.largeFiles.hugeLineCount': {
      type: 'integer',
      default: 500_000,
      minimum: 5_000,
      description: 'Line count that enables lightweight mode for non-code files.',
    },
  },
};

export const KairoLargeFilePreferenceContribution: PreferenceContribution = {
  schema: kairoLargeFilePreferenceSchema,
};
