/**
 * Kairo Custom Build Runner — a React widget for running custom build
 * commands (e.g. ant war, mvn clean package) with real-time output.
 */

import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
import { KairoI18nService } from '@kairo/i18n';
import './kairo-custom-build-runner.css';

export const CUSTOM_BUILD_WIDGET_ID = 'kairo-custom-build';
export const CUSTOM_BUILD_LABEL = 'Custom Build';

interface BuildLogEntry {
    type: 'stdout' | 'stderr' | 'info' | 'error';
    line: string;
    ts: number;
}

interface BuildState {
    running: boolean;
    buildId?: string;
    exitCode?: number;
    logs: BuildLogEntry[];
    command: string;
    projectRoot: string;
    workingDir: string;
}

@injectable()
export class CustomBuildRunnerWidget extends ReactWidget {
    @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    static readonly ID = CUSTOM_BUILD_WIDGET_ID;
    static readonly LABEL = CUSTOM_BUILD_LABEL;

    protected state: BuildState = {
        running: false,
        logs: [],
        command: '',
        projectRoot: '',
        workingDir: '',
    };

    constructor() {
        super();
        this.id = CUSTOM_BUILD_WIDGET_ID;
        this.title.label = CUSTOM_BUILD_LABEL;
        this.title.caption = CUSTOM_BUILD_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-terminal';
        this.addClass('kairo-widget');
    }

    @postConstruct()
    protected init(): void {
        this.updateTitle();
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
    }

    protected updateTitle(): void {
        this.title.label = this.i18n.t('widget.build.customRunner.title' as any);
        this.title.caption = this.i18n.t('widget.build.customRunner.caption' as any);
    }

    setCommand(command: string, projectRoot: string, workingDir?: string): void {
        this.state = {
            ...this.state,
            command,
            projectRoot,
            workingDir: workingDir ?? projectRoot,
            logs: [],
            exitCode: undefined,
        };
        this.update();
    }

    async execute(): Promise<void> {
        if (this.state.running) return;
        if (!this.state.command.trim()) {
            this.messageService.error(this.i18n.t('widget.build.customRunner.error.noCommand' as any));
            return;
        }

        this.state = {
            ...this.state,
            running: true,
            logs: [],
            exitCode: undefined,
        };
        this.update();

        try {
            const result = await this.runtime.request(
                'POST /api/v1/build/custom',
                {
                    command: this.state.command,
                    projectRoot: this.state.projectRoot,
                    workingDir: this.state.workingDir,
                },
                { timeoutMs: 30_000 }
            );

            this.state = {
                ...this.state,
                running: true,
                buildId: result.buildId,
            };
            this.update();

            // Start polling for logs (in production, this would use WebSocket)
            this.pollBuildStatus(result.buildId);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.state = {
                ...this.state,
                running: false,
                logs: [...this.state.logs, {
                    type: 'error',
                    line: this.i18n.t('widget.build.customRunner.error.requestFailed' as any, { message: msg }),
                    ts: Date.now(),
                }],
            };
            this.update();
        }
    }

    cancel(): void {
        if (!this.state.running || !this.state.buildId) return;
        this.runtime.request(
            'POST /api/v1/build/custom/{buildId}/cancel',
            undefined,
            { pathParams: { buildId: this.state.buildId }, timeoutMs: 10_000 }
        ).catch(() => {/* ignore cancel errors */});
    }

    protected async pollBuildStatus(buildId: string): Promise<void> {
        // Simplified polling — in production, use WebSocket events
        this.addLog('info', this.i18n.t('widget.build.customRunner.log.started' as any, { buildId }));
        this.addLog('info', this.i18n.t('widget.build.customRunner.log.running' as any, { command: this.state.command }));
        this.addLog('info', this.i18n.t('widget.build.customRunner.log.waiting' as any));
    }

    protected addLog(type: BuildLogEntry['type'], line: string): void {
        this.state = {
            ...this.state,
            logs: [...this.state.logs, { type, line, ts: Date.now() }],
        };
        this.update();
    }

    protected render(): React.ReactNode {
        return <CustomBuildPanel
            state={this.state}
            i18n={this.i18n}
            onExecute={() => this.execute()}
            onCancel={() => this.cancel()}
            onCommandChange={(cmd) => { this.state.command = cmd; this.update(); }}
        />;
    }
}

const CustomBuildPanel: React.FC<{
    state: BuildState;
    i18n: KairoI18nService;
    onExecute: () => void;
    onCancel: () => void;
    onCommandChange: (cmd: string) => void;
}> = ({ state, i18n, onExecute, onCancel, onCommandChange }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const logsEndRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    React.useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [state.logs]);

    return (
        <div className="kairo-widget kairo-custom-build" data-testid="custom-build-view">
            <div className="kairo-widget-header" data-testid="custom-build-header">
                <span className="kairo-widget-title">{t('widget.build.customRunner.title')}</span>
            </div>
            <div className="kairo-widget-toolbar kairo-custom-build-toolbar" data-testid="custom-build-toolbar">
                <input
                    className="theia-input kairo-custom-build-input"
                    type="text"
                    value={state.command}
                    disabled={state.running}
                    onChange={e => onCommandChange(e.target.value)}
                    placeholder={t('widget.build.customRunner.commandPlaceholder')}
                    onKeyDown={e => { if (e.key === 'Enter') onExecute(); }}
                    data-testid="custom-build-input"
                />
                {state.running ? (
                    <button
                        className="theia-button danger kairo-custom-build-cancel"
                        onClick={onCancel}
                        data-testid="custom-build-cancel"
                    >
                        <span className="codicon codicon-stop" aria-hidden="true" />
                        {t('common.cancel')}
                    </button>
                ) : (
                    <button
                        className="theia-button main kairo-custom-build-run"
                        onClick={onExecute}
                        disabled={!state.command.trim()}
                        data-testid="custom-build-run"
                    >
                        <span className="codicon codicon-play" aria-hidden="true" />
                        {t('common.run')}
                    </button>
                )}
            </div>
            {state.exitCode !== undefined && (
                <div
                    className={`kairo-error-banner kairo-custom-build-result ${state.exitCode === 0 ? 'kairo-custom-build-result-success' : 'kairo-custom-build-result-failed'}`}
                    role="alert"
                    data-testid="custom-build-result"
                >
                    <span className={`codicon ${state.exitCode === 0 ? 'codicon-check' : 'codicon-error'}`} aria-hidden="true" />
                    <span>{state.exitCode === 0
                        ? t('widget.build.customRunner.result.success', { exitCode: state.exitCode })
                        : t('widget.build.customRunner.result.failed', { exitCode: state.exitCode })}</span>
                </div>
            )}
            <div className="kairo-widget-body kairo-custom-build-output" data-testid="custom-build-output">
                {state.logs.map((entry, i) => (
                    <div key={i} className={`kairo-build-log-line ${entry.type}`}>
                        {entry.line}
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
    );
};
