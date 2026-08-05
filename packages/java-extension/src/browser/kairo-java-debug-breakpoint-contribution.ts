import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, CommandService, MenuContribution, MenuModelRegistry, MessageService } from '@theia/core/lib/common';
import { SingleTextInputDialog } from '@theia/core/lib/browser/dialogs';
import URI from '@theia/core/lib/common/uri';
import { DebugProtocol } from '@vscode/debugprotocol';
import { DebugContribution } from '@theia/debug/lib/browser/debug-contribution';
import { DebugSessionConnection } from '@theia/debug/lib/browser/debug-session-connection';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import { BreakpointManager } from '@theia/debug/lib/browser/breakpoint/breakpoint-manager';
import { SourceBreakpoint } from '@theia/debug/lib/browser/breakpoint/breakpoint-marker';
import { DebugSourceBreakpoint } from '@theia/debug/lib/browser/model/debug-source-breakpoint';
import { DebugEditorService } from '@theia/debug/lib/browser/editor/debug-editor-service';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';
import * as monaco from '@theia/monaco-editor-core';

/** Private debug type for Kairo Java Debug Adapter, matches the one in @kairo/theia-product. */
const KAIRO_JAVA_DEBUG_TYPE = 'kairo-java';

/** VS Code / IDEA keymap id for Ctrl+Shift+F8 (see kairo-idea-windows-keymap). */
const CONDITIONAL_BREAKPOINT_CMD = 'editor.debug.action.conditionalBreakpoint';

export namespace KairoJavaDebugCommands {
    export const EDIT_BREAKPOINT_CONDITION: Command = {
        id: 'kairo.java.debug.editBreakpointCondition',
        label: 'Edit Breakpoint Condition...',
    };
    export const EDIT_BREAKPOINT_HIT_COUNT: Command = {
        id: 'kairo.java.debug.editBreakpointHitCount',
        label: 'Edit Hit Count...',
    };
    export const EDIT_LOGPOINT_MESSAGE: Command = {
        id: 'kairo.java.debug.editLogpointMessage',
        label: 'Edit Logpoint Message...',
    };
    export const EVALUATE_EXPRESSION: Command = {
        id: 'kairo.java.debug.evaluateExpression',
        label: 'Evaluate Expression',
    };
    export const TOGGLE_LOGPOINT: Command = {
        id: 'kairo.java.debug.toggleLogpoint',
        label: 'Toggle Logpoint',
    };
}

@injectable()
export class KairoJavaDebugContribution implements DebugContribution {
    register(configType: string, _connection: DebugSessionConnection): void {
        if (configType !== KAIRO_JAVA_DEBUG_TYPE) {
            return;
        }
    }
}

@injectable()
export class KairoJavaDebugBreakpointCommandContribution implements CommandContribution, MenuContribution {
    @inject(DebugSessionManager)
    protected readonly sessionManager!: DebugSessionManager;

    @inject(BreakpointManager)
    protected readonly breakpointManager!: BreakpointManager;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    @inject(CommandService) @optional()
    protected readonly commands?: CommandService;

    @inject(DebugEditorService) @optional()
    protected readonly debugEditors?: DebugEditorService;

    protected commandRegistry: CommandRegistry | undefined;

    protected readonly commandI18nKeys: Record<string, KairoI18nKey> = {
        [KairoJavaDebugCommands.EDIT_BREAKPOINT_CONDITION.id]: 'widget.java.debugBreakpoint.editCondition',
        [KairoJavaDebugCommands.EDIT_BREAKPOINT_HIT_COUNT.id]: 'widget.java.debugBreakpoint.editHitCount',
        [KairoJavaDebugCommands.EDIT_LOGPOINT_MESSAGE.id]: 'widget.java.debugBreakpoint.editLogpointMessage',
        [KairoJavaDebugCommands.EVALUATE_EXPRESSION.id]: 'widget.java.debugBreakpoint.evaluateExpression',
        [KairoJavaDebugCommands.TOGGLE_LOGPOINT.id]: 'widget.java.debugBreakpoint.toggleLogpoint',
        [CONDITIONAL_BREAKPOINT_CMD]: 'widget.java.debugBreakpoint.addConditionalBreakpoint',
    };

    protected t(key: KairoI18nKey, params?: Record<string, string | number>): string {
        return this.i18n.t(key, params);
    }

    protected withLabel(cmd: Command): Command {
        const key = this.commandI18nKeys[cmd.id];
        return key ? { ...cmd, label: this.i18n.t(key) } : cmd;
    }

    protected refreshCommandLabels(): void {
        if (!this.commandRegistry) {
            return;
        }
        for (const [id, key] of Object.entries(this.commandI18nKeys)) {
            const cmd = this.commandRegistry.getCommand(id);
            if (cmd) {
                cmd.label = this.i18n.t(key);
            }
        }
    }

    registerCommands(registry: CommandRegistry): void {
        this.commandRegistry = registry;
        this.refreshCommandLabels();
        this.i18n.onDidChangeLanguage(() => this.refreshCommandLabels());

        registry.registerCommand(this.withLabel(KairoJavaDebugCommands.EDIT_BREAKPOINT_CONDITION), {
            execute: (breakpoint?: DebugSourceBreakpoint) => this.editBreakpointCondition(breakpoint),
        });
        registry.registerCommand(this.withLabel(KairoJavaDebugCommands.EDIT_BREAKPOINT_HIT_COUNT), {
            execute: (breakpoint?: DebugSourceBreakpoint) => this.editBreakpointHitCount(breakpoint),
        });
        registry.registerCommand(this.withLabel(KairoJavaDebugCommands.EDIT_LOGPOINT_MESSAGE), {
            execute: (breakpoint?: DebugSourceBreakpoint) => this.editLogpointMessage(breakpoint),
        });
        registry.registerCommand(this.withLabel(KairoJavaDebugCommands.EVALUATE_EXPRESSION), {
            execute: (expression: string) => this.evaluateExpression(expression),
        });
        registry.registerCommand(this.withLabel(KairoJavaDebugCommands.TOGGLE_LOGPOINT), {
            execute: (breakpoint?: DebugSourceBreakpoint) => this.toggleLogpoint(breakpoint),
        });
        // Keymap binds Ctrl+Shift+F8 here; Theia's own id is debug.breakpoint.add.conditional
        // and is disabled when a line breakpoint already exists. Always open the condition UI.
        registry.registerCommand(
            {
                id: CONDITIONAL_BREAKPOINT_CMD,
                label: this.t('widget.java.debugBreakpoint.addConditionalBreakpoint'),
                category: this.t('menu.debug'),
            },
            { execute: () => this.openConditionalBreakpointUi() },
        );
    }

    registerMenus(_registry: MenuModelRegistry): void {
        // Menu entries are contributed via the Theia debug breakpoint widget's
        // built-in editing support. The commands are callable from the command
        // palette with a selected breakpoint context.
    }

    /** Open Theia zone widget (Expression / Hit Count / Log Message) at caret. */
    protected openConditionalBreakpointUi(): void {
        if (this.debugEditors) {
            this.debugEditors.addBreakpoint('condition');
            return;
        }
        // Fallback when DebugEditorService is not yet available: dialog path.
        void this.editBreakpointCondition(this.resolveBreakpoint());
    }

    protected resolveBreakpoint(breakpoint?: DebugSourceBreakpoint): DebugSourceBreakpoint | undefined {
        if (breakpoint) {
            return breakpoint;
        }
        const editor = monaco.editor.getEditors().find(e => e.hasTextFocus()) ?? monaco.editor.getEditors()[0];
        const model = editor?.getModel();
        const position = editor?.getPosition();
        if (!model || !position) {
            return undefined;
        }
        const uri = new URI(model.uri.toString());
        const existing = this.breakpointManager.getLineBreakpoints(uri, position.lineNumber)[0];
        if (existing) {
            return existing;
        }
        try {
            return this.breakpointManager.addBreakpoint(
                SourceBreakpoint.create(uri, { line: position.lineNumber }),
            );
        } catch {
            return undefined;
        }
    }

    protected async editBreakpointCondition(breakpoint?: DebugSourceBreakpoint): Promise<void> {
        const bp = this.resolveBreakpoint(breakpoint);
        if (!bp) {
            this.messageService.warn(this.t('widget.java.debugBreakpoint.positionLineCondition'));
            return;
        }
        // Prefer Theia inline breakpoint editor when available (shows Expression/Hit Count/Log Message).
        if (this.debugEditors && !breakpoint) {
            this.debugEditors.addBreakpoint('condition');
            return;
        }
        const current = bp.condition ?? '';
        const dialog = new SingleTextInputDialog({
            title: this.t('widget.java.debugBreakpoint.editConditionTitle'),
            initialValue: current,
            placeholder: this.t('widget.java.debugBreakpoint.conditionPlaceholder'),
            confirmButtonLabel: this.t('widget.java.debugBreakpoint.setButton'),
        });
        const value = await dialog.open();
        if (value === undefined || value === null) {
            return;
        }
        try {
            const condition = value.trim() || undefined;
            this.breakpointManager.updateBreakpoint(bp, {
                condition,
            } as Partial<DebugProtocol.SourceBreakpoint>);
        } catch (error) {
            this.messageService.error(this.t('widget.java.debugBreakpoint.conditionFailed', {
                msg: toMessage(error),
            }));
        }
    }

    protected async editBreakpointHitCount(breakpoint?: DebugSourceBreakpoint): Promise<void> {
        const bp = this.resolveBreakpoint(breakpoint);
        if (!bp) {
            this.messageService.warn(this.t('widget.java.debugBreakpoint.positionLineHitCount'));
            return;
        }
        const current = bp.hitCondition ?? '';
        const dialog = new SingleTextInputDialog({
            title: this.t('widget.java.debugBreakpoint.editHitCountTitle'),
            initialValue: current,
            placeholder: this.t('widget.java.debugBreakpoint.hitCountPlaceholder'),
            confirmButtonLabel: this.t('widget.java.debugBreakpoint.setButton'),
        });
        const value = await dialog.open();
        if (value === undefined || value === null) {
            return;
        }
        try {
            const hitCondition = value.trim() || undefined;
            // DAP allows a plain hit count like "5" (JV-P2-12).
            if (hitCondition && !/^(?:\d+|(?:[><=!%]+|[><=]=?)\s*\d+)$/.test(hitCondition)) {
                this.messageService.warn(this.t('widget.java.debugBreakpoint.hitCountFormatWarn', {
                    expr: hitCondition,
                }));
            }
            this.breakpointManager.updateBreakpoint(bp, {
                hitCondition,
            } as Partial<DebugProtocol.SourceBreakpoint>);
        } catch (error) {
            this.messageService.error(this.t('widget.java.debugBreakpoint.hitCountFailed', {
                msg: toMessage(error),
            }));
        }
    }

    protected async editLogpointMessage(breakpoint?: DebugSourceBreakpoint): Promise<void> {
        const bp = this.resolveBreakpoint(breakpoint);
        if (!bp) {
            this.messageService.warn(this.t('widget.java.debugBreakpoint.positionLineLogpoint'));
            return;
        }
        const current = bp.logMessage ?? '';
        const dialog = new SingleTextInputDialog({
            title: this.t('widget.java.debugBreakpoint.editLogpointTitle'),
            initialValue: current,
            placeholder: this.t('widget.java.debugBreakpoint.logpointPlaceholder'),
            confirmButtonLabel: this.t('widget.java.debugBreakpoint.setButton'),
        });
        const value = await dialog.open();
        if (value === undefined || value === null) {
            return;
        }
        try {
            const logMessage = value.trim() || undefined;
            this.breakpointManager.updateBreakpoint(bp, {
                logMessage,
            } as Partial<DebugProtocol.SourceBreakpoint>);
        } catch (error) {
            this.messageService.error(this.t('widget.java.debugBreakpoint.logpointFailed', {
                msg: toMessage(error),
            }));
        }
    }

    protected async evaluateExpression(expression: string): Promise<void> {
        const session = this.sessionManager.currentSession;
        if (!session) {
            this.messageService.error(this.t('widget.java.debugBreakpoint.noDebugSession'));
            return;
        }
        if (session.configuration.type !== KAIRO_JAVA_DEBUG_TYPE) {
            this.messageService.error(this.t('widget.java.debugBreakpoint.notJavaSession'));
            return;
        }
        try {
            const result = await session.evaluate(expression);
            const resultStr = result.result;
            if (resultStr) {
                this.messageService.info(this.t('widget.java.debugBreakpoint.evaluateResult', {
                    result: resultStr,
                }));
            }
        } catch (error) {
            this.messageService.error(this.t('widget.java.debugBreakpoint.evaluateFailed', {
                msg: toMessage(error),
            }));
        }
    }

    protected async toggleLogpoint(breakpoint?: DebugSourceBreakpoint): Promise<void> {
        const bp = this.resolveBreakpoint(breakpoint);
        if (!bp) {
            this.messageService.warn(this.t('widget.java.debugBreakpoint.positionLineToggleLogpoint'));
            return;
        }
        try {
            if (bp.logMessage) {
                this.breakpointManager.updateBreakpoint(bp, {
                    logMessage: undefined,
                } as Partial<DebugProtocol.SourceBreakpoint>);
            } else {
                const dialog = new SingleTextInputDialog({
                    title: this.t('widget.java.debugBreakpoint.createLogpointTitle'),
                    initialValue: '',
                    placeholder: this.t('widget.java.debugBreakpoint.logpointPlaceholder'),
                    confirmButtonLabel: this.t('widget.java.debugBreakpoint.createButton'),
                });
                const value = await dialog.open();
                if (value === undefined || value === null) {
                    return;
                }
                const logMessage = value.trim() || undefined;
                if (logMessage) {
                    this.breakpointManager.updateBreakpoint(bp, {
                        logMessage,
                    } as Partial<DebugProtocol.SourceBreakpoint>);
                }
            }
        } catch (error) {
            this.messageService.error(this.t('widget.java.debugBreakpoint.toggleLogpointFailed', {
                msg: toMessage(error),
            }));
        }
    }
}

function toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
