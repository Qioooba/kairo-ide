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
      default: 2_000_000,
      minimum: 100_000,
      description: 'Character count that enables large-file mode.',
    },
    'kairo.largeFiles.largeLineCount': {
      type: 'integer',
      default: 20_000,
      minimum: 1_000,
      description: 'Line count that enables large-file mode.',
    },
    'kairo.largeFiles.hugeCharacterCount': {
      type: 'integer',
      default: 10_000_000,
      minimum: 500_000,
      description: 'Character count that enables lightweight plaintext mode.',
    },
    'kairo.largeFiles.hugeLineCount': {
      type: 'integer',
      default: 80_000,
      minimum: 5_000,
      description: 'Line count that enables lightweight plaintext mode.',
    },
  },
};

export const KairoLargeFilePreferenceContribution: PreferenceContribution = {
  schema: kairoLargeFilePreferenceSchema,
};
