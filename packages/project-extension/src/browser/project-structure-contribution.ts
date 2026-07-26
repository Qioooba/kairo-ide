import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog';
import { ActiveProjectService } from './active-project-service';
import { KairoProjectService } from './project-service';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { ProjectStructureDialog } from './project-structure-dialog';

export namespace KairoProjectStructureCommands {
    export const OPEN: Command = {
        id: 'kairo.project.structure',
        label: 'Kairo: Project Structure',
        category: 'Kairo',
    };
}

@injectable()
export class ProjectStructureContribution implements CommandContribution, KeybindingContribution {
    @inject(ActiveProjectService)
    protected readonly activeProject!: ActiveProjectService;

    @inject(KairoProjectService)
    protected readonly projectService!: KairoProjectService;

    @inject(RuntimeConnectionService)
    protected readonly runtime!: RuntimeConnectionService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(FileDialogService)
    protected readonly fileDialogService!: FileDialogService;

    protected dialog: ProjectStructureDialog | null = null;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(KairoProjectStructureCommands.OPEN, {
            execute: () => this.open(),
            isEnabled: () => this.activeProject.project !== undefined,
        });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: KairoProjectStructureCommands.OPEN.id,
            keybinding: 'ctrl+alt+shift+s',
        });
    }

    protected open(): void {
        if (!this.activeProject.project) {
            void this.messageService.warn('No active project. Open or import a project first.');
            return;
        }
        if (this.dialog && this.dialog.isAttached) {
            this.dialog.close();
            this.dialog = null;
            return;
        }
        this.dialog = new ProjectStructureDialog({
            title: 'Project Structure',
            projectService: this.projectService,
            activeProject: this.activeProject,
            runtime: this.runtime,
            messageService: this.messageService,
            fileDialogService: this.fileDialogService,
        });
        this.dialog.open();
    }
}
