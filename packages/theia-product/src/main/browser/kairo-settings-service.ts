/**
 * Kairo project-level settings persistence.
 *
 * Reads and writes settings to `.kairo/settings.json` in the
 * project root, providing a second tier of configuration on
 * top of the user-level Theia settings.
 *
 * The file format is a flat JSON object with preference keys
 * as property names and their values as property values:
 *
 *   {
 *     "kairo.build.autoClean": true,
 *     "kairo.server.defaultHttpPort": 9090
 *   }
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { PreferenceService, PreferenceScope } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser';

export const KAIRO_SETTINGS_FILE = '.kairo/settings.json';

export interface KairoSettingsChange {
  key: string;
  value: unknown;
  scope: 'user' | 'project';
}

@injectable()
export class KairoSettingsService {
  @inject(FileService) protected readonly fileService!: FileService;
  @inject(PreferenceService) protected readonly preferences!: PreferenceService;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;

  protected readonly onDidChangeEmitter = new Emitter<KairoSettingsChange>();
  readonly onDidChange: Event<KairoSettingsChange> = this.onDidChangeEmitter.event;

  protected readonly toDispose = new DisposableCollection();
  protected projectSettings: Record<string, unknown> = {};
  protected projectSettingsUri: URI | undefined;

  @postConstruct()
  protected init(): void {
    this.toDispose.push(this.onDidChangeEmitter);
    this.preferences.ready.then(() => {
      this.loadProjectSettings();
      this.preferences.onPreferenceChanged(e => {
        this.onDidChangeEmitter.fire({
          key: e.preferenceName,
          value: undefined, // PreferenceChange omits newValue for performance
          scope: e.scope === PreferenceScope.Workspace ? 'project' : 'user',
        });
      });
    });
    this.workspaceService.onWorkspaceChanged(() => {
      this.projectSettings = {};
      this.projectSettingsUri = undefined;
      this.loadProjectSettings();
    });
  }

  dispose(): void {
    this.toDispose.dispose();
  }

  /**
   * Get a preference value, checking project settings first,
   * then falling back to user settings via the PreferenceService.
   */
  get<T>(key: string, defaultValue: T): T {
    if (key in this.projectSettings) {
      return this.projectSettings[key] as T;
    }
    return this.preferences.get<T>(key, defaultValue, this.projectSettingsUri?.toString());
  }

  /**
   * Set a project-level preference value and persist it to
   * `.kairo/settings.json`.
   */
  async setProject(key: string, value: unknown): Promise<void> {
    this.projectSettings[key] = value;
    await this.persistProjectSettings();
    this.onDidChangeEmitter.fire({ key, value, scope: 'project' });
  }

  /**
   * Delete a project-level preference key.
   */
  async deleteProject(key: string): Promise<void> {
    delete this.projectSettings[key];
    await this.persistProjectSettings();
    this.onDidChangeEmitter.fire({ key, value: undefined, scope: 'project' });
  }

  /**
   * Set a user-level preference via the standard PreferenceService.
   */
  async setUser(key: string, value: unknown): Promise<void> {
    await this.preferences.set(key, value, PreferenceScope.User);
    this.onDidChangeEmitter.fire({ key, value, scope: 'user' });
  }

  /**
   * Get all project-level settings.
   */
  getProjectSettings(): Record<string, unknown> {
    return { ...this.projectSettings };
  }

  /**
   * Check if a key has a project-level override.
   */
  isProjectOverride(key: string): boolean {
    return key in this.projectSettings;
  }

  protected async loadProjectSettings(): Promise<void> {
    const roots = this.workspaceService.tryGetRoots();
    if (roots.length === 0) return;

    const rootUri = roots[0].resource;
    this.projectSettingsUri = rootUri.resolve(KAIRO_SETTINGS_FILE);

    try {
      const exists = await this.fileService.exists(this.projectSettingsUri);
      if (!exists) return;

      const content = await this.fileService.read(this.projectSettingsUri);
      const text = content.value;
      this.projectSettings = JSON.parse(text) as Record<string, unknown>;
    } catch (err) {
      console.warn('[kairo] Failed to load project settings:', err);
      this.projectSettings = {};
    }
  }

  protected async persistProjectSettings(): Promise<void> {
    if (!this.projectSettingsUri) return;

    try {
      const dirUri = this.projectSettingsUri.parent;
      const dirExists = await this.fileService.exists(dirUri);
      if (!dirExists) {
        await this.fileService.createFolder(dirUri);
      }

      const text = JSON.stringify(this.projectSettings, null, 2) + '\n';
      await this.fileService.write(this.projectSettingsUri, text);
    } catch (err) {
      console.warn('[kairo] Failed to persist project settings:', err);
    }
  }
}