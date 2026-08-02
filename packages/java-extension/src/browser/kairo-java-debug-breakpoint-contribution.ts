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
import * as monaco from '@theia/monaco-editor-core';

/** Private debug type for Kairo Java Debug Adapter, matches the one in @kairo/theia-product. */
const KAIRO_JAVA_DEBUG_TYPE = 'kairo-java';

/** VS Code / IDEA keymap id for Ctrl+Shift+F8 (see kairo-idea-windows-keymap). */
const CONDITIONAL_BREAKPOINT_CMD = 'editor.debug.action.conditionalBreakpoint';

export namespace KairoJavaDebugCommands {
    export const EDIT_BREAKPOINT_CONDITION: Command = {
        id: 'kairo.java.debug.editBreakpointCondition',
        label: '编辑断点条件...',
    };
    export const EDIT_BREAKPOINT_HIT_COUNT: Command = {
        id: 'kairo.java.debug.editBreakpointHitCount',
        label: '编辑命中次数...',
    };
    export const EDIT_LOGPOINT_MESSAGE: Command = {
        id: 'kairo.java.debug.editLogpointMessage',
        label: '编辑日志点消息...',
    };
    export const EVALUATE_EXPRESSION: Command = {
        id: 'kairo.java.debug.evaluateExpression',
        label: '求值表达式',
    };
    export const TOGGLE_LOGPOINT: Command = {
        id: 'kairo.java.debug.toggleLogpoint',
        label: '切换日志点',
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

    @inject(CommandService) @optional()
    protected readonly commands?: CommandService;

    @inject(DebugEditorService) @optional()
    protected readonly debugEditors?: DebugEditorService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(KairoJavaDebugCommands.EDIT_BREAKPOINT_CONDITION, {
            execute: (breakpoint?: DebugSourceBreakpoint) => this.editBreakpointCondition(breakpoint),
        });
        registry.registerCommand(KairoJavaDebugCommands.EDIT_BREAKPOINT_HIT_COUNT, {
            execute: (breakpoint?: DebugSourceBreakpoint) => this.editBreakpointHitCount(breakpoint),
        });
        registry.registerCommand(KairoJavaDebugCommands.EDIT_LOGPOINT_MESSAGE, {
            execute: (breakpoint?: DebugSourceBreakpoint) => this.editLogpointMessage(breakpoint),
        });
        registry.registerCommand(KairoJavaDebugCommands.EVALUATE_EXPRESSION, {
            execute: (expression: string) => this.evaluateExpression(expression),
        });
        registry.registerCommand(KairoJavaDebugCommands.TOGGLE_LOGPOINT, {
            execute: (breakpoint?: DebugSourceBreakpoint) => this.toggleLogpoint(breakpoint),
        });
        // Keymap binds Ctrl+Shift+F8 here; Theia's own id is debug.breakpoint.add.conditional
        // and is disabled when a line breakpoint already exists. Always open the condition UI.
        registry.registerCommand(
            { id: CONDITIONAL_BREAKPOINT_CMD, label: 'Add Conditional Breakpoint...', category: 'Debug' },
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
            this.messageService.warn('请先在编辑器中定位到要设置条件断点的行。');
            return;
        }
        // Prefer Theia inline breakpoint editor when available (shows Expression/Hit Count/Log Message).
        if (this.debugEditors && !breakpoint) {
            this.debugEditors.addBreakpoint('condition');
            return;
        }
        const current = bp.condition ?? '';
        const dialog = new SingleTextInputDialog({
            title: '编辑断点条件',
            initialValue: current,
            placeholder: '例如: x > 0',
            confirmButtonLabel: '设置',
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
            this.messageService.error(`条件断点设置失败: ${toMessage(error)}`);
        }
    }

    protected async editBreakpointHitCount(breakpoint?: DebugSourceBreakpoint): Promise<void> {
        const bp = this.resolveBreakpoint(breakpoint);
        if (!bp) {
            this.messageService.warn('请先在编辑器中定位到要设置命中次数的行。');
            return;
        }
        const current = bp.hitCondition ?? '';
        const dialog = new SingleTextInputDialog({
            title: '编辑命中次数',
            initialValue: current,
            placeholder: '例如: >5',
            confirmButtonLabel: '设置',
        });
        const value = await dialog.open();
        if (value === undefined || value === null) {
            return;
        }
        try {
            const hitCondition = value.trim() || undefined;
            if (hitCondition && !/^(?:[><=!%]+|[><=]=?)\s*\d+$/.test(hitCondition)) {
                this.messageService.warn(`命中次数表达式 "${hitCondition}" 格式可能不被 Debug Adapter 支持，已尝试设置。`);
            }
            this.breakpointManager.updateBreakpoint(bp, {
                hitCondition,
            } as Partial<DebugProtocol.SourceBreakpoint>);
        } catch (error) {
            this.messageService.error(`命中次数断点设置失败: ${toMessage(error)}`);
        }
    }

    protected async editLogpointMessage(breakpoint?: DebugSourceBreakpoint): Promise<void> {
        const bp = this.resolveBreakpoint(breakpoint);
        if (!bp) {
            this.messageService.warn('请先在编辑器中定位到要设置日志点的行。');
            return;
        }
        const current = bp.logMessage ?? '';
        const dialog = new SingleTextInputDialog({
            title: '编辑日志点消息',
            initialValue: current,
            placeholder: '例如: 变量 x = {x}',
            confirmButtonLabel: '设置',
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
            this.messageService.error(`日志点设置失败: ${toMessage(error)}`);
        }
    }

    protected async evaluateExpression(expression: string): Promise<void> {
        const session = this.sessionManager.currentSession;
        if (!session) {
            this.messageService.error('没有活动的 Debug 会话，无法求值表达式。');
            return;
        }
        if (session.configuration.type !== KAIRO_JAVA_DEBUG_TYPE) {
            this.messageService.error('当前 Debug 会话不是 Kairo Java 调试会话。');
            return;
        }
        try {
            const result = await session.evaluate(expression);
            const resultStr = result.result;
            if (resultStr) {
                this.messageService.info(`求值结果: ${resultStr}`);
            }
        } catch (error) {
            this.messageService.error(`表达式求值失败: ${toMessage(error)}`);
        }
    }

    protected async toggleLogpoint(breakpoint?: DebugSourceBreakpoint): Promise<void> {
        const bp = this.resolveBreakpoint(breakpoint);
        if (!bp) {
            this.messageService.warn('请先在编辑器中定位到要切换日志点的行。');
            return;
        }
        try {
            if (bp.logMessage) {
                this.breakpointManager.updateBreakpoint(bp, {
                    logMessage: undefined,
                } as Partial<DebugProtocol.SourceBreakpoint>);
            } else {
                const dialog = new SingleTextInputDialog({
                    title: '创建日志点',
                    initialValue: '',
                    placeholder: '例如: 变量 x = {x}',
                    confirmButtonLabel: '创建',
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
            this.messageService.error(`日志点切换失败: ${toMessage(error)}`);
        }
    }
}

function toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
