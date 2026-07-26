import { injectable } from '@theia/core/shared/inversify';
import { PreferenceSchema, PreferenceContribution } from '@theia/core/lib/common/preferences/preference-schema';

export const SVN_PREFERENCES_SCHEMA: PreferenceSchema = {
  properties: {
    'svn.enabled': {
      type: 'boolean',
      default: true,
      description: 'Enable SVN integration.',
    },
    'svn.path': {
      type: 'string',
      default: '',
      description: 'Custom path to the SVN executable. Leave empty for auto-detection.',
    },
    'svn.defaultCheckoutPath': {
      type: 'string',
      default: '',
      description: 'Default path for checkout operations.',
    },
    'svn.autoRefresh': {
      type: 'boolean',
      default: true,
      description: 'Automatically refresh SVN status when files change.',
    },
    'svn.autoRefreshInterval': {
      type: 'number',
      default: 300,
      minimum: 30,
      description: 'Auto-refresh interval in seconds.',
    },
    'svn.decorations.enabled': {
      type: 'boolean',
      default: true,
      description: 'Show SVN status decorations in the file explorer.',
    },
    'svn.decorations.colors': {
      type: 'boolean',
      default: true,
      description: 'Use color decorations for SVN status in the file explorer.',
    },
    'svn.decorations.badges': {
      type: 'boolean',
      default: true,
      description: 'Use badge decorations for SVN status in the file explorer.',
    },
    'svn.gutter.enabled': {
      type: 'boolean',
      default: true,
      description: 'Show SVN gutter indicators in the editor.',
    },
    'svn.annotate.enabled': {
      type: 'boolean',
      default: true,
      description: 'Enable SVN blame annotations.',
    },
    'svn.commit.useAmend': {
      type: 'boolean',
      default: false,
      description: 'Use --amend for commit (Svn 1.7+).',
    },
    'svn.commit.autoCloseAfterCommit': {
      type: 'boolean',
      default: true,
      description: 'Close the commit view after a successful commit.',
    },
    'svn.update.onOpen': {
      type: 'boolean',
      default: false,
      description: 'Run SVN update when opening a working copy.',
    },
    'svn.ignoreWhitespace': {
      type: 'boolean',
      default: false,
      description: 'Ignore whitespace differences in diffs.',
    },
    'svn.showOutput': {
      type: 'boolean',
      default: false,
      description: 'Show SVN command output in the output panel.',
    },
    'svn.maxHistoryEntries': {
      type: 'number',
      default: 100,
      minimum: 10,
      maximum: 1000,
      description: 'Maximum number of history entries to show in the history view.',
    },
    'svn.trustServerCert': {
      type: 'boolean',
      default: true,
      description: 'Automatically accept unknown SSL server certificates.',
    },
    'svn.auth.cache': {
      type: 'boolean',
      default: true,
      description: 'Cache SVN authentication credentials.',
    },
  },
};

@injectable()
export class SvnPreferenceContribution implements PreferenceContribution {
  readonly schema: PreferenceSchema = SVN_PREFERENCES_SCHEMA;
}