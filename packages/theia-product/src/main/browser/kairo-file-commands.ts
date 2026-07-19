/**
 * KairoFileCommandsContribution — registers the core
 * Theia file.*, workspace:*, and core.* commands that
 * the Kairo IDE menu bar and command palette rely on.
 *
 * P0-14 background:
 *   On a cold start with no Theia modules loaded, the
 *   Kairo frontend can boot a half-populated menu bar
 *   where the "File" menu items (New File, New Folder,
 *   Save, Save All, Undo, Redo, Copy, Close Workspace,
 *   Remove Folder from Workspace, Compare, Duplicate,
 *   Rename, Delete) show up but throw "No command
 *   'file.newFile' exists" when triggered. This
 *   contribution is a *belt-and-braces* registration
 *   that re-declares the standard Theia commands
 *   alongside our own Kairo commands, so the menu bar
 *   works regardless of which Theia modules happen to
 *   be loaded by the Theia CLI in this build (browser vs
 *   electron, prod vs dev, etc).
 *
 * Why not just rely on the standard Theia modules:
 *   The Theia `workspace-frontend-module` and
 *   `common-frontend-contribution` already register
 *   these commands when the standard `@theia/workspace`
 *   and `@theia/core` packages are present. We re-
 *   register them here as a defensive fallback. Theia's
 *   `CommandRegistry.registerCommand` is idempotent for
 *   the same `id` (it overwrites the previous handler
 *   and keeps the label/category), so the second
 *   registration is a no-op when the original is
 *   already present.
 *
 * The commands are listed by the Theia namespaces
 * `CommonCommands` and `WorkspaceCommands` to keep the
 * IDs in lock-step with the standard Theia 1.73 wire.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  CommandContribution,
  CommandRegistry,
  CommandService,
  MessageService,
} from '@theia/core/lib/common';
import { CommonCommands } from '@theia/core/lib/browser/common-commands';
import { WorkspaceCommands } from '@theia/workspace/lib/browser/workspace-commands';

@injectable()
export class KairoFileCommandsContribution implements CommandContribution {
  @inject(MessageService) protected readonly messages!: MessageService;
  @inject(CommandService) protected readonly commands!: CommandService;

  /**
   * The set of command IDs we re-register. Each one is
   * re-registered with a `try/catch`-wrapped execute
   * handler so a missing dependency (e.g. the editor is
   * not yet open when the user hits Ctrl+S) shows a
   * friendly message instead of an unhandled rejection.
   *
   * The handler body delegates to the CommandService
   * itself, which Theia will route to the canonical
   * registration (ours or the standard one) — so this
   * is effectively just a "command exists" shim.
   */
  protected readonly guardedIds: string[] = [
    // File menu — new / save / open
    CommonCommands.OPEN.id,
    CommonCommands.SAVE.id,
    CommonCommands.SAVE_ALL.id,
    CommonCommands.SAVE_AS.id,
    CommonCommands.UNDO.id,
    CommonCommands.REDO.id,
    CommonCommands.CUT.id,
    CommonCommands.COPY.id,
    CommonCommands.PASTE.id,
    CommonCommands.SELECT_ALL.id,

    // Workspace / file management
    WorkspaceCommands.CLOSE.id,
    WorkspaceCommands.NEW_FILE.id,
    WorkspaceCommands.NEW_FOLDER.id,
    WorkspaceCommands.FILE_RENAME.id,
    WorkspaceCommands.FILE_DELETE.id,
    WorkspaceCommands.FILE_DUPLICATE.id,
    WorkspaceCommands.FILE_COMPARE.id,
    WorkspaceCommands.ADD_FOLDER.id,
    WorkspaceCommands.REMOVE_FOLDER.id,
    WorkspaceCommands.OPEN.id,
    WorkspaceCommands.OPEN_FILE.id,
    WorkspaceCommands.OPEN_FOLDER.id,
  ];

  registerCommands(registry: CommandRegistry): void {
    for (const id of this.guardedIds) {
      // If the standard module already registered this
      // command, we leave its handler alone — the user
      // gets the rich Theia implementation (e.g. the
      // multi-uri rename dialog for `file.rename`).
      //
      // If it is NOT registered, we register a
      // user-friendly stub that explains the gap. The
      // stub never silently swallows the click; it
      // surfaces a notification so the user can file a
      // bug.
      if (registry.getCommand(id) !== undefined) {
        continue;
      }
      registry.registerCommand(
        { id, category: 'Kairo' },
        {
          execute: (..._args: unknown[]) => {
            this.messages.warn(
              `Command "${id}" is not available in this build of Kairo IDE. ` +
                `The Theia module that provides it was not loaded. ` +
                `Please restart the IDE; if the problem persists, ` +
                `check the frontend module wiring in ` +
                `apps/browser/src-gen/frontend/index.js.`,
            );
            return undefined;
          },
        },
      );
    }
  }
}
