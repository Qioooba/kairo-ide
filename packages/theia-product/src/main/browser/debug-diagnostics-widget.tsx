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
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';
import { KairoJavaDebugService, type KairoJavaDebugStatus } from './kairo-java-debug-service';
import { KAIRO_JAVA_DEBUG_ADAPTER_COMMAND_ENV } from '../common/kairo-java-debug';

export const DEBUG_DIAGNOSTICS_WIDGET_ID = 'kairo-debug-diagnostics';
export const DEBUG_DIAGNOSTICS_LABEL = 'Debug Diagnostics';

type TFunction = (key: KairoI18nKey, params?: Record<string, string | number>) => string;

interface DiagnosticItem {
    status: 'ok' | 'warning' | 'error' | 'unknown';
    label: string;
    detail: string;
    action?: { label: string; handler: () => void };
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface DebugDiagnosticsPanelProps {
    debugService: KairoJavaDebugService;
    messageService: MessageService;
    i18n: KairoI18nService;
}

const DebugDiagnosticsPanel: React.FC<DebugDiagnosticsPanelProps> = ({ debugService, messageService, i18n }) => {
    const t = React.useCallback<TFunction>((key, params) => i18n.t(key, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    const [items, setItems] = React.useState<DiagnosticItem[]>([]);
    const [loading, setLoading] = React.useState(true);

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const status = await debugService.probeAvailability();
            const diagItems = buildDiagnosticItems(status, messageService, t);
            setItems(diagItems);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            setItems([{ status: 'error', label: t('widget.debug.diagnostics.errorTitle'), detail: msg }]);
        } finally {
            setLoading(false);
        }
    }, [debugService, messageService, t]);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    const statusIcon = (status: DiagnosticItem['status']) => {
        switch (status) {
            case 'ok': return <span className={`codicon codicon-pass kairo-diag-icon kairo-diag-${status}`} title={t('widget.debug.diagnostics.status.ok')} />;
            case 'warning': return <span className={`codicon codicon-warning kairo-diag-icon kairo-diag-${status}`} title={t('widget.debug.diagnostics.status.warning')} />;
            case 'error': return <span className={`codicon codicon-error kairo-diag-icon kairo-diag-${status}`} title={t('widget.debug.diagnostics.status.error')} />;
            default: return <span className={`codicon codicon-question kairo-diag-icon kairo-diag-${status}`} title={t('widget.debug.diagnostics.status.unknown')} />;
        }
    };

    return (
        <div className="kairo-debug-diagnostics">
            <div className="kairo-debug-diag-header">
                <h3 className="kairo-debug-diag-title">{t('widget.debug.diagnostics.header')}</h3>
                <button
                    className="theia-button secondary kairo-diag-refresh"
                    disabled={loading}
                    onClick={refresh}
                    title={t('widget.debug.diagnostics.refresh')}
                    aria-label={t('widget.debug.diagnostics.refresh')}
                >
                    <span className={`codicon ${loading ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} aria-hidden="true" />
                    <span>{loading ? t('widget.debug.diagnostics.refreshing') : t('widget.debug.diagnostics.refresh')}</span>
                </button>
            </div>
            {loading && items.length === 0 ? (
                <div className="kairo-loading">
                    <span className="codicon codicon-loading codicon-modifier-spin kairo-loading-icon" aria-hidden="true" />
                    <span>{t('widget.debug.diagnostics.loading')}</span>
                </div>
            ) : (
                <div className="kairo-diag-list" role="list">
                    {items.map((item, index) => (
                        <div key={index} className={`kairo-diag-item kairo-diag-${item.status}`} role="listitem">
                            <div className="kairo-diag-item-header">
                                {statusIcon(item.status)}
                                <span className="kairo-diag-label">{item.label}</span>
                            </div>
                            <div className="kairo-diag-detail">{item.detail}</div>
                            {item.action && (
                                <button
                                    className="theia-button secondary kairo-diag-action"
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
                <h4 className="kairo-diag-footer-title">{t('widget.debug.diagnostics.compatibility.title')}</h4>
                <p className="kairo-diag-footer-intro">{t('widget.debug.diagnostics.compatibility.intro')}</p>
                <ul className="kairo-diag-compatibility-list">
                    <li>{t('widget.debug.diagnostics.compatibility.instanceFilters')}</li>
                    <li>{t('widget.debug.diagnostics.compatibility.lambdaStepping')}</li>
                    <li>{t('widget.debug.diagnostics.compatibility.methodExitBreakpoints')}</li>
                    <li>{t('widget.debug.diagnostics.compatibility.modernJdiDegraded')}</li>
                </ul>
                <p className="kairo-diag-hint">
                    {t('widget.debug.diagnostics.compatibility.hint')}
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
    t: TFunction,
): DiagnosticItem[] {
    const items: DiagnosticItem[] = [];

    // 1. Debug Adapter Status
    const adapterOk = status.state === 'available' || status.state === 'connected' || status.state === 'paused';
    items.push({
        status: adapterOk ? 'ok' : status.state === 'unavailable' ? 'error' : 'warning',
        label: t('widget.debug.diagnostics.items.adapter.label'),
        detail: adapterOk
            ? t('widget.debug.diagnostics.items.adapter.ok')
            : status.message ?? `${t('widget.debug.diagnostics.items.adapter.label')}: ${status.state}`,
        action: !adapterOk ? {
            label: t('widget.debug.diagnostics.items.adapter.action'),
            handler: () => messageService.info(t('widget.debug.diagnostics.messages.checkConfiguration')),
        } : undefined,
    });

    // 2. Host JDK (check via environment)
    const javaHome = typeof process !== 'undefined' ? process.env?.['JAVA_HOME'] : undefined;
    const hasJavaHome = !!javaHome;
    items.push({
        status: hasJavaHome ? 'ok' : 'warning',
        label: t('widget.debug.diagnostics.items.hostJdk.label'),
        detail: hasJavaHome
            ? t('widget.debug.diagnostics.items.hostJdk.ok', { path: javaHome })
            : t('widget.debug.diagnostics.items.hostJdk.missing'),
        action: !hasJavaHome ? {
            label: t('widget.debug.diagnostics.items.hostJdk.action'),
            handler: () => messageService.info(t('widget.debug.diagnostics.messages.setJavaHome')),
        } : undefined,
    });

    // 3. Environment Variable (legacy — show if set)
    const envCmd = typeof process !== 'undefined' ? process.env?.[KAIRO_JAVA_DEBUG_ADAPTER_COMMAND_ENV] : undefined;
    items.push({
        status: envCmd ? 'warning' : 'ok',
        label: t('widget.debug.diagnostics.items.externalAdapter.label'),
        detail: envCmd
            ? t('widget.debug.diagnostics.items.externalAdapter.configured', { cmd: envCmd })
            : t('widget.debug.diagnostics.items.externalAdapter.ok'),
    });

    // 4. Connected Session
    if (status.sessionId && (status.state === 'connected' || status.state === 'paused')) {
        items.push({
            status: 'ok',
            label: t('widget.debug.diagnostics.items.session.label'),
            detail: status.state === 'paused'
                ? t('widget.debug.diagnostics.items.session.paused', { sessionId: status.sessionId })
                : t('widget.debug.diagnostics.items.session.connected', { sessionId: status.sessionId }),
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
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    static readonly ID = DEBUG_DIAGNOSTICS_WIDGET_ID;
    static readonly LABEL = DEBUG_DIAGNOSTICS_LABEL;

    constructor() {
        super();
        this.id = DEBUG_DIAGNOSTICS_WIDGET_ID;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-tools kairo-debug-diagnostics-icon';
    }

    @postConstruct()
    protected init(): void {
        this.title.label = this.i18n.t('widget.debug.diagnostics.title');
        this.title.caption = this.i18n.t('widget.debug.diagnostics.caption');
        this.addClass('kairo-widget');
        this.update();
        // Listen for debug status changes
        this.toDispose.push(this.debugService.onDidChangeStatus(() => {
            this.update();
        }));
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
            this.title.label = this.i18n.t('widget.debug.diagnostics.title');
            this.title.caption = this.i18n.t('widget.debug.diagnostics.caption');
            this.update();
        }));
    }

    protected render(): React.ReactNode {
        return React.createElement(DebugDiagnosticsPanel, {
            debugService: this.debugService,
            messageService: this.messageService,
            i18n: this.i18n,
        });
    }
}