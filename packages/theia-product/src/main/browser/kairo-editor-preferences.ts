/**
 * Kairo editor preferences — registers editor.* auto-save preferences
 * and syncs them to the underlying files.* preferences that Theia's
 * SaveableService reads from.
 *
 * Theia's built-in SaveableService already implements auto-save logic
 * for "afterDelay" (throttled save after content changes) and
 * "onFocusChange" (save when editor loses focus). The preferences
 * `files.autoSave` and `files.autoSaveDelay` are wired to the
 * SaveableService by EditorCommandContribution. This contribution
 * provides the `editor.autoSave` and `editor.autoSaveDelay` aliases
 * as the user-facing configuration keys.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  PreferenceContribution,
  PreferenceSchema,
  PreferenceService,
} from '@theia/core/lib/common/preferences';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';

export const kairoEditorPreferenceSchema: PreferenceSchema = {
  title: 'Kairo Editor',
  properties: {
    'editor.autoSave': {
      type: 'string',
      enum: ['off', 'afterDelay', 'onFocusChange'],
      // BUG-20260826-305: was 'onFocusChange', which KairoEditorAutoSaveSync
      // then force-wrote into files.autoSave on every startup — the IDE could
      // never honor the documented/app-configured default ('off').
      default: 'off',
      description: 'Controls auto-save of editors that have unsaved changes.',
    },
    'editor.autoSaveDelay': {
      type: 'number',
      default: 1000,
      minimum: 0,
      description: 'Controls the delay in milliseconds after which an editor with unsaved changes is saved automatically. Only applies when editor.autoSave is set to afterDelay.',
    },
    // Override Theia's default (true). IDEA Darcula does not rainbow-color
    // brackets; matching that keeps Java/JSP highlighting closer to IDEA.
    'editor.bracketPairColorization.enabled': {
      type: 'boolean',
      default: false,
      description: 'Controls whether bracket pair colorization is enabled. Disabled by default to match IntelliJ IDEA Darcula.',
    },
    // Very long JSP/HTML lines and large files: Monaco defaults stop tokenization
    // at 20k chars/line and rendering at 10k lines — too low for legacy JSP.
    'editor.maxTokenizationLineLength': {
      type: 'integer',
      default: 200_000,
      minimum: 1_000,
      maximum: 2_000_000,
      description: 'Lines longer than this are not syntax-highlighted. Raised for large JSP/Java files.',
    },
    'editor.stopRenderingLineAfter': {
      type: 'integer',
      default: -1,
      minimum: -1,
      maximum: 1_000_000,
      description: 'Disable the line after which the editor stops rendering (-1 = unlimited).',
    },
  },
};

export const KairoEditorPreferenceContribution: PreferenceContribution = {
  schema: kairoEditorPreferenceSchema,
};

@injectable()
export class KairoEditorAutoSaveSync implements FrontendApplicationContribution {
  @inject(PreferenceService)
  protected readonly preferences!: PreferenceService;

  onStart(): void {
    this.preferences.ready.then(() => {
      this.syncAll();
    });
    this.preferences.onPreferenceChanged(e => {
      if (e.preferenceName === 'editor.autoSave') {
        const value = this.preferences.get<string>('editor.autoSave', 'off');
        this.preferences.set('files.autoSave', value, PreferenceScope.User);
      } else if (e.preferenceName === 'editor.autoSaveDelay') {
        const value = this.preferences.get<number>('editor.autoSaveDelay', 1000);
        this.preferences.set('files.autoSaveDelay', value, PreferenceScope.User);
      }
    });
  }

  protected syncAll(): void {
    const autoSave = this.preferences.get<string>('editor.autoSave', 'off');
    this.preferences.set('files.autoSave', autoSave, PreferenceScope.User);
    const autoSaveDelay = this.preferences.get<number>('editor.autoSaveDelay', 1000);
    this.preferences.set('files.autoSaveDelay', autoSaveDelay, PreferenceScope.User);
  }
}