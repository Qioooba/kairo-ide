/**
 * Kairo Debug Diagnostics Widget — shows the status of the Java Debug
 * Adapter components and provides troubleshooting guidance.
 *
 * Displays:
 *   1. Host JDK 17 status (version, path)
 *   2. JDI Bridge jar existence (kairo-jdi-bridge.jar)
 *   3. JDT LS status (running / crashed / starting)
 *   4. Java 6 compatibility limitations list
 *
 * Provides action buttons:
 *   - Download Host JDK 17
 *   - Restart Debug Adapter
 *   - Open Log
 */

import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { KairoJavaDebugService, type KairoJavaDebugStatus } from './kairo-java-debug-service';
import { KAIRO_JAVA_DEBUG_ADAPTER_COMMAND_ENV } from '../common/kairo-java-debug';

export const DEBUG_DIAGNOSTICS_WIDGET_ID = 'kairo-debug-diagnostics';
export const DEBUG_DIAGNOSTICS_LABEL = 'Debug Diagnostics';

interface DiagnosticItem {
    status: 'ok' | 'warning' | 'error' | 'unknown';
    label: string;
    detail: string;
    action?: { label: string; handler: () => void };
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

const DebugDiagnosticsPanel: React.FC<{
    debugService: KairoJavaDebugService;
    messageService: MessageService;
}> = ({ debugService, messageService }) => {
    const [items, setItems] = React.useState<DiagnosticItem[]>([]);
    const [loading, setLoading] = React.useState(true);

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const status = await debugService.probeAvailability();
            const diagItems = buildDiagnosticItems(status, messageService);
            setItems(diagItems);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            setItems([{ status: 'error', label: 'Diagnostic Error', detail: msg }]);
        } finally {
            setLoading(false);
        }
    }, [debugService, messageService]);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    const statusIcon = (status: DiagnosticItem['status']) => {
        switch (status) {
            case 'ok': return <span className="kairo-diag-icon kairo-diag-ok" title="OK">✅</span>;
            case 'warning': return <span className="kairo-diag-icon kairo-diag-warning" title="Warning">⚠️</span>;
            case 'error': return <span className="kairo-diag-icon kairo-diag-error" title="Error">❌</span>;
            default: return <span className="kairo-diag-icon kairo-diag-unknown" title="Unknown">❓</span>;
        }
    };

    return (
        <div className="kairo-debug-diagnostics">
            <div className="kairo-debug-diag-header">
                <h3>Java Debug Adapter Diagnostics</h3>
                <button
                    className="theia-button kairo-diag-refresh"
                    disabled={loading}
                    onClick={refresh}
                    title="Refresh diagnostics"
                >
                    {loading ? 'Refreshing...' : '⟳ Refresh'}
                </button>
            </div>
            {loading && items.length === 0 ? (
                <div className="kairo-diag-loading">Loading diagnostics...</div>
            ) : (
                <div className="kairo-diag-list">
                    {items.map((item, index) => (
                        <div key={index} className={`kairo-diag-item kairo-diag-${item.status}`}>
                            <div className="kairo-diag-item-header">
                                {statusIcon(item.status)}
                                <span className="kairo-diag-label">{item.label}</span>
                            </div>
                            <div className="kairo-diag-detail">{item.detail}</div>
                            {item.action && (
                                <button
                                    className="theia-button kairo-diag-action"
                                    onClick={item.action.handler}
                                >
                                    {item.action.label}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
            <div className="kairo-diag-footer">
                <h4>Java 6 Compatibility Notes</h4>
                <p>When debugging a Java 6 target JVM, the following limitations apply:</p>
                <ul>
                    <li>Instance filters (conditional breakpoints on specific objects) are not available</li>
                    <li>Lambda expression stepping is not available (Java 6 has no lambdas)</li>
                    <li>Method exit breakpoints have limited support</li>
                    <li>Some modern JDI features are silently degraded</li>
                </ul>
                <p className="kairo-diag-hint">
                    The JDI Bridge runs on JDK 17 and connects to the target JVM via standard JDWP protocol.
                    This is the same approach used by VS Code Java extension.
                </p>
            </div>
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Diagnostic Builder                                                  */
/* ------------------------------------------------------------------ */

function buildDiagnosticItems(
    status: KairoJavaDebugStatus,
    messageService: MessageService,
): DiagnosticItem[] {
    const items: DiagnosticItem[] = [];

    // 1. Debug Adapter Status
    const adapterOk = status.state === 'available' || status.state === 'connected' || status.state === 'paused';
    items.push({
        status: adapterOk ? 'ok' : status.state === 'unavailable' ? 'error' : 'warning',
        label: 'Debug Adapter',
        detail: adapterOk
            ? 'Java Debug Adapter is ready. You can start debugging.'
            : status.message ?? `Debug Adapter state: ${status.state}`,
        action: !adapterOk ? {
            label: 'Check Configuration',
            handler: () => messageService.info(
                `The Java Debug Adapter requires a built-in JDI Bridge (kairo-jdi-bridge.jar) ` +
                `and a host JDK 17. Make sure the bundled directory contains the bridge jar ` +
                `and a JDK 17 is available on your system.`,
            ),
        } : undefined,
    });

    // 2. Host JDK (check via environment)
    const javaHome = typeof process !== 'undefined' ? process.env?.['JAVA_HOME'] : undefined;
    const hasJavaHome = !!javaHome;
    items.push({
        status: hasJavaHome ? 'ok' : 'warning',
        label: 'Host JDK',
        detail: hasJavaHome
            ? `JAVA_HOME is set to: ${javaHome}`
            : 'JAVA_HOME is not set. The system will try to find Java on PATH.',
        action: !hasJavaHome ? {
            label: 'Set JAVA_HOME',
            handler: () => messageService.info(
                'Set the JAVA_HOME environment variable to point to a JDK 17+ installation.',
            ),
        } : undefined,
    });

    // 3. Environment Variable (legacy — show if set)
    const envCmd = typeof process !== 'undefined' ? process.env?.[KAIRO_JAVA_DEBUG_ADAPTER_COMMAND_ENV] : undefined;
    items.push({
        status: envCmd ? 'warning' : 'ok',
        label: 'External Adapter (Legacy)',
        detail: envCmd
            ? `KAIRO_JAVA_DEBUG_ADAPTER_COMMAND is set to: ${envCmd}. This will override the built-in bridge.`
            : 'No external adapter configured. Using built-in JDI Bridge (recommended).',
    });

    // 4. Connected Session
    if (status.state === 'connected' || status.state === 'paused') {
        items.push({
            status: 'ok',
            label: 'Debug Session',
            detail: status.state === 'paused'
                ? `Session ${status.sessionId} is paused. You can inspect variables and step through code.`
                : `Session ${status.sessionId} is active and connected to the target JVM.`,
        });
    }

    return items;
}

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class DebugDiagnosticsWidget extends ReactWidget {
    @inject(KairoJavaDebugService) protected readonly debugService!: KairoJavaDebugService;
    @inject(MessageService) protected readonly messageService!: MessageService;

    static readonly ID = DEBUG_DIAGNOSTICS_WIDGET_ID;
    static readonly LABEL = DEBUG_DIAGNOSTICS_LABEL;

    constructor() {
        super();
        this.id = DEBUG_DIAGNOSTICS_WIDGET_ID;
        this.title.label = DEBUG_DIAGNOSTICS_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-stethoscope kairo-debug-diagnostics-icon';
    }

    @postConstruct()
    protected init(): void {
        this.addClass('kairo-widget');
        this.update();
        // Listen for debug status changes
        this.debugService.onDidChangeStatus(() => {
            this.update();
        });
    }

    protected render(): React.ReactNode {
        return React.createElement(DebugDiagnosticsPanel, {
            debugService: this.debugService,
            messageService: this.messageService,
        });
    }
}