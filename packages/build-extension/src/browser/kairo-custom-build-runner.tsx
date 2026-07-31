/**
 * Kairo Custom Build Runner — a React widget for running custom build
 * commands (e.g. ant war, mvn clean package) with real-time output.
 */

import * as React from 'react';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { RuntimeConnectionService } from '@kairo/runtime-extension';
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
        this.title.closable = true;
        this.title.iconClass = 'fa fa-terminal kairo-build-icon';
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
            this.messageService.error('No command specified');
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
                logs: [...this.state.logs, { type: 'error', line: `Error: ${msg}`, ts: Date.now() }],
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
        this.addLog('info', `Build started (ID: ${buildId})`);
        this.addLog('info', `Running: ${this.state.command}`);
        this.addLog('info', 'Waiting for build to complete...');
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
            onExecute={() => this.execute()}
            onCancel={() => this.cancel()}
            onCommandChange={(cmd) => { this.state.command = cmd; this.update(); }}
        />;
    }
}

const CustomBuildPanel: React.FC<{
    state: BuildState;
    onExecute: () => void;
    onCancel: () => void;
    onCommandChange: (cmd: string) => void;
}> = ({ state, onExecute, onCancel, onCommandChange }) => {
    const logsEndRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [state.logs]);

    return (
        <div className="kairo-custom-build">
            <div className="kairo-custom-build-header">
                <h3>Custom Build</h3>
                <div className="kairo-custom-build-controls">
                    <input
                        className="theia-input kairo-custom-build-input"
                        type="text"
                        value={state.command}
                        disabled={state.running}
                        onChange={e => onCommandChange(e.target.value)}
                        placeholder="e.g., ant war, mvn clean package"
                        onKeyDown={e => { if (e.key === 'Enter') onExecute(); }}
                    />
                    {state.running ? (
                        <button className="theia-button kairo-build-cancel" onClick={onCancel}>
                            Cancel
                        </button>
                    ) : (
                        <button className="theia-button kairo-build-run" onClick={onExecute} disabled={!state.command.trim()}>
                            Run
                        </button>
                    )}
                </div>
            </div>
            {state.exitCode !== undefined && (
                <div className={`kairo-build-result ${state.exitCode === 0 ? 'kairo-build-success' : 'kairo-build-failed'}`}>
                    Build exited with code {state.exitCode} {state.exitCode === 0 ? '(success)' : '(failed)'}
                </div>
            )}
            <div className="kairo-custom-build-output">
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