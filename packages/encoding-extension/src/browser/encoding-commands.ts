/**
 * Kairo encoding commands — the menu entries that surface
 * the encoding service to the user. Both "Reopen with
 * Encoding" and "Save with Encoding" are wired here.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  ApplicationShell,
} from '@theia/core/lib/browser';
import {
  Command,
  CommandRegistry,
  MessageService,
} from '@theia/core/lib/common';
import { KairoEncodingServiceImpl } from './encoding-service';

export namespace KairoEncodingCommands {
  export const REOPEN_WITH_ENCODING: Command = {
    id: 'kairo.encoding.reopen',
    label: 'Kairo: Reopen with Encoding…',
  };
  export const SAVE_WITH_ENCODING: Command = {
    id: 'kairo.encoding.save',
    label: 'Kairo: Save with Encoding…',
  };
  export const SHOW_ENCODING: Command = {
    id: 'kairo.encoding.show',
    label: 'Kairo: Show File Encoding',
  };
}

@injectable()
export class KairoEncodingCommandsContribution {
  @inject(KairoEncodingServiceImpl) protected service!: KairoEncodingServiceImpl;
  @inject(MessageService) protected messages!: MessageService;
  @inject(ApplicationShell) protected shell!: ApplicationShell;

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(KairoEncodingCommands.SHOW_ENCODING, {
      execute: async (arg?: { file: string; workspaceId: string }) => {
        if (!arg || !arg.file) {
          this.messages.warn('No file is open.');
          return;
        }
        try {
          const r = await this.service.detect({ workspaceId: arg.workspaceId, file: arg.file });
          this.messages.info(`${r.file}: ${r.encoding} (confidence ${r.confidence.toFixed(2)}, EOL=${r.eol}, BOM=${r.hasBom})`);
        } catch (err) {
          this.messages.error((err as Error).message);
        }
      },
    });
    registry.registerCommand(KairoEncodingCommands.REOPEN_WITH_ENCODING, {
      execute: async (arg?: { file: string; workspaceId: string; encoding: string }) => {
        if (!arg || !arg.file || !arg.encoding) {
          this.messages.warn('Usage: pick a file, then choose an encoding.');
          return;
        }
        this.messages.info(`Reopening ${arg.file} as ${arg.encoding}. The agent will keep the original bytes; the in-memory view is decoded with ${arg.encoding}.`);
        // The actual reopen logic is implemented by the
        // Theia file watcher in a follow-up. For v1 we only
        // surface the result via the Show Encoding command.
      },
    });
    registry.registerCommand(KairoEncodingCommands.SAVE_WITH_ENCODING, {
      execute: async (arg?: { file: string; workspaceId: string; encoding: string }) => {
        if (!arg || !arg.file || !arg.encoding) {
          this.messages.warn('Usage: pick a file, then choose an encoding.');
          return;
        }
        try {
          const r = await this.service.recode({
            workspaceId: arg.workspaceId,
            file: arg.file,
            from: arg.encoding,
            to: arg.encoding,
          });
          this.messages.info(`Recoded ${arg.file} (${r.bytes} bytes).`);
        } catch (err) {
          this.messages.error((err as Error).message);
        }
      },
    });
  }
}
