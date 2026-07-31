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
      default: 'onFocusChange',
      description: 'Controls auto-save of editors that have unsaved changes.',
    },
    'editor.autoSaveDelay': {
      type: 'number',
      default: 1000,
      minimum: 0,
      description: 'Controls the delay in milliseconds after which an editor with unsaved changes is saved automatically. Only applies when editor.autoSave is set to afterDelay.',
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