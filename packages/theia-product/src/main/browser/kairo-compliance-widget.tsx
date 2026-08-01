/**
 * Kairo Compliance Widget — Enterprise Compliance Panel
 *
 * Provides RBAC role viewer, audit log viewer, data retention policy
 * status, and SSO configuration status in a single panel.
 * All UI text is localized via KairoI18nService.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ILogger } from '@theia/core/lib/common/logger';
import { KairoI18nService } from '@kairo/i18n';
import { KairoComplianceSuite } from './kairo-compliance';
import { KairoAuditLog, type AuditLogEntry } from './kairo-audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface UserRole {
    name: string;
    permissions: string[];
}

export interface AuditEvent {
    ts: string;
    category: string;
    component: string;
    userId: string;
    action: string;
    target: string;
    result: 'ok' | 'denied' | 'error';
}

export interface RetentionPolicy {
    name: string;
    resourceType: string;
    maxAge: string;
    maxSize: string;
    autoCleanup: boolean;
}

export interface SSOStatus {
    enabled: boolean;
    provider: 'oidc' | 'saml' | 'none';
    issuer: string;
    configured: boolean;
}

export interface ComplianceState {
    roles: UserRole[];
    auditEvents: AuditEvent[];
    retentionPolicies: RetentionPolicy[];
    ssoStatus: SSOStatus;
    loading: boolean;
    error: string | null;
}

export const KAIRO_COMPLIANCE_FACTORY_ID = 'kairo-compliance';

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface CompliancePanelProps {
    complianceSuite: KairoComplianceSuite;
    auditLog: KairoAuditLog;
    logger: ILogger;
    i18n: KairoI18nService;
}

const CompliancePanel: React.FC<CompliancePanelProps> = ({ complianceSuite, auditLog, logger, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const [state, setState] = React.useState<ComplianceState>({
        roles: [],
        auditEvents: [],
        retentionPolicies: [],
        ssoStatus: { enabled: false, provider: 'none', issuer: '', configured: false },
        loading: true,
        error: null,
    });
    const [activeTab, setActiveTab] = React.useState<'roles' | 'audit' | 'retention' | 'sso'>('roles');
    const [auditFilter, setAuditFilter] = React.useState({ action: '', result: '', search: '' });

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    const loadData = React.useCallback(() => {
        setState(prev => ({ ...prev, loading: true, error: null }));
        try {
            // Load RBAC roles
            const roleState = complianceSuite.role;
            const roles: UserRole[] = [
                ...roleState.availableRoles.map(r => ({
                    name: r,
                    permissions: complianceSuite.getAccessControlMatrix()[r] || [],
                })),
            ];

            // Load audit events
            const entries = auditLog.getEntries();
            const auditEvents: AuditEvent[] = entries.map((e: AuditLogEntry) => ({
                ts: e.timestamp,
                category: e.action.split('.')[0] || 'general',
                component: e.action,
                userId: e.user,
                action: e.action,
                target: e.target,
                result: e.result === 'success' ? 'ok' : e.result === 'failure' ? 'error' : 'denied',
            }));

            // Load retention policies
            const auditConfig = auditLog.auditConfig;
            const retentionPolicies: RetentionPolicy[] = [
                {
                    name: 'Audit Log Retention',
                    resourceType: 'Audit Logs',
                    maxAge: `${auditConfig.retentionDays} days`,
                    maxSize: `${auditConfig.maxEntries} entries`,
                    autoCleanup: auditConfig.enabled,
                },
                {
                    name: 'Local Storage Retention',
                    resourceType: 'User Settings',
                    maxAge: 'Unlimited',
                    maxSize: 'N/A',
                    autoCleanup: false,
                },
            ];

            // SSO status
            const ssoStatus: SSOStatus = {
                enabled: false,
                provider: 'none',
                issuer: '',
                configured: false,
            };

            setState({
                roles,
                auditEvents,
                retentionPolicies,
                ssoStatus,
                loading: false,
                error: null,
            });
        } catch (err) {
            logger.error(`[Compliance] Failed to load data: ${String(err)}`);
            setState(prev => ({
                ...prev,
                loading: false,
                error: err instanceof Error ? err.message : String(err),
            }));
        }
    }, [complianceSuite, auditLog, logger]);

    React.useEffect(() => {
        loadData();
    }, [loadData]);

    const filteredAuditEvents = React.useMemo(() => {
        let filtered = state.auditEvents;
        if (auditFilter.action) {
            filtered = filtered.filter(e => e.action.includes(auditFilter.action));
        }
        if (auditFilter.result) {
            filtered = filtered.filter(e => e.result === auditFilter.result);
        }
        if (auditFilter.search) {
            const term = auditFilter.search.toLowerCase();
            filtered = filtered.filter(e =>
                e.action.toLowerCase().includes(term) ||
                e.target.toLowerCase().includes(term) ||
                e.userId.toLowerCase().includes(term),
            );
        }
        return filtered;
    }, [state.auditEvents, auditFilter]);

    const resultBadge = (result: string) => {
        const variant = result === 'ok' ? 'ok' : result === 'denied' ? 'denied' : result === 'error' ? 'error' : 'neutral';
        return (
            <span className={`kairo-compliance-badge kairo-compliance-badge-${variant}`}>
                {result}
            </span>
        );
    };

    // Loading state — skeleton placeholder
    if (state.loading) {
        return (
            <div className="kairo-compliance-widget" role="status" aria-label={t('widget.compliance.loadingAria')}>
                <div className="kairo-compliance-loading">
                    <div className="kairo-compliance-spinner" aria-hidden="true" />
                    <div>{t('widget.compliance.loading')}</div>
                    <div className="kairo-compliance-skeleton">
                        {[0, 1, 2].map(i => (
                            <div key={i} className="kairo-compliance-skeleton-bar" style={{ opacity: 0.5 - i * 0.15, width: `${90 - i * 15}%` }} />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // Error state — categorized by error type
    if (state.error) {
        const isTimeout = state.error.toLowerCase().includes('timeout') || state.error.toLowerCase().includes('timed out');
        const isPermission = state.error.toLowerCase().includes('permission') || state.error.toLowerCase().includes('denied') || state.error.toLowerCase().includes('unauthorized');
        const isConfig = state.error.toLowerCase().includes('config') || state.error.toLowerCase().includes('setting');
        const errorIcon = isTimeout ? 'codicon-warning' : isPermission ? 'codicon-lock' : isConfig ? 'codicon-gear' : 'codicon-error';
        const errorTitle = isTimeout ? t('widget.compliance.error.timeout')
            : isPermission ? t('widget.compliance.error.permission')
            : isConfig ? t('widget.compliance.error.config')
            : t('widget.compliance.error.generic');
        return (
            <div className="kairo-compliance-widget" role="alert" aria-live="assertive">
                <div className="kairo-error-banner">
                    <span className={`codicon ${errorIcon}`} aria-hidden="true" />
                    <div>
                        <strong>{errorTitle}</strong>
                        <div className="kairo-error-banner-detail">{state.error}</div>
                        <button
                            className="theia-button"
                            onClick={loadData}
                            title={t('widget.compliance.retryAria')}
                            aria-label={t('widget.compliance.retryAria')}
                        >
                            {t('widget.compliance.retry')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const tabs = ['roles', 'audit', 'retention', 'sso'] as const;

    const handleTabKeyDown = (e: React.KeyboardEvent, tab: string) => {
        const idx = tabs.indexOf(tab as typeof tabs[number]);
        if (e.key === 'ArrowRight' && idx < tabs.length - 1) {
            e.preventDefault();
            setActiveTab(tabs[idx + 1]);
        } else if (e.key === 'ArrowLeft' && idx > 0) {
            e.preventDefault();
            setActiveTab(tabs[idx - 1]);
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setActiveTab(tab as typeof tabs[number]);
        }
    };

    return (
        <div className="kairo-compliance-widget" role="region" aria-label={t('widget.compliance.caption')}>
            {/* Header */}
            <div className="kairo-widget-header">
                <span className="kairo-widget-title">{t('widget.compliance.title')}</span>
            </div>

            {/* Tabs */}
            <div role="tablist" aria-label="Compliance panel sections" className="kairo-compliance-tabs">
                {tabs.map(tab => (
                    <button
                        key={tab}
                        role="tab"
                        aria-selected={activeTab === tab}
                        aria-controls={`kairo-compliance-tabpanel-${tab}`}
                        id={`kairo-compliance-tab-${tab}`}
                        className={`kairo-compliance-tab${activeTab === tab ? ' kairo-compliance-tab-active' : ''}`}
                        onClick={() => setActiveTab(tab)}
                        onKeyDown={e => handleTabKeyDown(e, tab)}
                        tabIndex={activeTab === tab ? 0 : -1}
                        title={`${t(`widget.compliance.tabs.${tab}`)} (${t(`widget.compliance.tabs.${tab}Hint`)})`}
                    >
                        {t(`widget.compliance.tabs.${tab}`)}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="kairo-compliance-content">
                {activeTab === 'roles' && (
                    <div role="tabpanel" id="kairo-compliance-tabpanel-roles" aria-labelledby="kairo-compliance-tab-roles">
                        <RolesTab roles={state.roles} i18n={i18n} />
                    </div>
                )}
                {activeTab === 'audit' && (
                    <div role="tabpanel" id="kairo-compliance-tabpanel-audit" aria-labelledby="kairo-compliance-tab-audit">
                        <AuditTab
                            events={filteredAuditEvents}
                            filter={auditFilter}
                            onFilterChange={setAuditFilter}
                            resultBadge={resultBadge}
                            onRefresh={loadData}
                            i18n={i18n}
                        />
                    </div>
                )}
                {activeTab === 'retention' && (
                    <div role="tabpanel" id="kairo-compliance-tabpanel-retention" aria-labelledby="kairo-compliance-tab-retention">
                        <RetentionTab policies={state.retentionPolicies} i18n={i18n} />
                    </div>
                )}
                {activeTab === 'sso' && (
                    <div role="tabpanel" id="kairo-compliance-tabpanel-sso" aria-labelledby="kairo-compliance-tab-sso">
                        <SSOTab ssoStatus={state.ssoStatus} i18n={i18n} />
                    </div>
                )}
            </div>
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

interface RolesTabProps {
    roles: UserRole[];
    i18n: KairoI18nService;
}

const RolesTab: React.FC<RolesTabProps> = ({ roles, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    if (roles.length === 0) {
        return (
            <div className="kairo-compliance-empty" role="status" aria-label={t('widget.compliance.roles.empty')}>
                {t('widget.compliance.roles.empty')}
            </div>
        );
    }

    return (
        <div role="list" aria-label="Role list">
            {roles.map(role => (
                <div key={role.name} role="listitem" className="kairo-compliance-card">
                    <div className="kairo-compliance-card-title"
                        title={t('widget.compliance.roles.permissionsCount', { name: role.name, count: role.permissions.length })}>
                        {role.name}
                    </div>
                    <div className="kairo-compliance-perms">
                        {role.permissions.map(perm => (
                            <span key={perm} className="kairo-compliance-perm"
                                title={t('widget.compliance.roles.permission', { name: perm })}
                                aria-label={t('widget.compliance.roles.permission', { name: perm })}
                            >
                                {perm}
                            </span>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

interface AuditTabProps {
    events: AuditEvent[];
    filter: { action: string; result: string; search: string };
    onFilterChange: (f: { action: string; result: string; search: string }) => void;
    resultBadge: (result: string) => React.ReactNode;
    onRefresh: () => void;
    i18n: KairoI18nService;
}

const AuditTab: React.FC<AuditTabProps> = ({ events, filter, onFilterChange, resultBadge, onRefresh, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    return (
        <div role="group" aria-label="Audit log">
            {/* Filter bar */}
            <div className="kairo-compliance-toolbar">
                <input
                    type="text"
                    className="kairo-compliance-field kairo-compliance-search"
                    placeholder={t('widget.compliance.audit.searchPlaceholder')}
                    value={filter.search}
                    onChange={e => onFilterChange({ ...filter, search: e.target.value })}
                    title={t('widget.compliance.audit.searchHint')}
                    aria-label={t('widget.compliance.audit.searchAria')}
                />
                <select
                    className="kairo-compliance-field"
                    value={filter.action}
                    onChange={e => onFilterChange({ ...filter, action: e.target.value })}
                    title={t('widget.compliance.audit.filterAction')}
                    aria-label={t('widget.compliance.audit.filterAction')}
                >
                    <option value="">{t('widget.compliance.audit.allActions')}</option>
                    <option value="file">File</option>
                    <option value="build">Build</option>
                    <option value="debug">Debug</option>
                    <option value="command">Command</option>
                    <option value="git">Git</option>
                    <option value="sql">SQL</option>
                </select>
                <select
                    className="kairo-compliance-field"
                    value={filter.result}
                    onChange={e => onFilterChange({ ...filter, result: e.target.value })}
                    title={t('widget.compliance.audit.filterResult')}
                    aria-label={t('widget.compliance.audit.filterResult')}
                >
                    <option value="">{t('widget.compliance.audit.allResults')}</option>
                    <option value="ok">OK</option>
                    <option value="denied">Denied</option>
                    <option value="error">Error</option>
                </select>
                <button
                    className="theia-button secondary"
                    onClick={onRefresh}
                    title={t('widget.compliance.audit.refreshAria')}
                    aria-label={t('widget.compliance.audit.refreshAria')}
                >
                    {t('widget.compliance.audit.refresh')}
                </button>
            </div>

            {/* Empty state */}
            {events.length === 0 && (
                <div className="kairo-compliance-empty" role="status"
                    aria-label={filter.action || filter.result || filter.search ? t('widget.compliance.audit.emptyFiltered') : t('widget.compliance.audit.empty')}>
                    {filter.action || filter.result || filter.search ? t('widget.compliance.audit.emptyFiltered') : t('widget.compliance.audit.empty')}
                </div>
            )}

            {/* Audit event list */}
            {events.length > 0 && events.map((event, idx) => (
                <div key={`${event.ts}-${idx}`} className="kairo-compliance-event"
                    role="listitem"
                    aria-label={t('widget.compliance.audit.eventAria', { action: event.action, user: event.userId, result: event.result })}
                >
                    {resultBadge(event.result)}
                    <div className="kairo-compliance-event-main">
                        <div className="kairo-compliance-event-action" title={t('widget.compliance.audit.action', { action: event.action })}>
                            {event.action}
                        </div>
                        <div className="kairo-compliance-event-meta"
                            title={t('widget.compliance.audit.target', { target: event.target })}>
                            {event.target}
                        </div>
                        <div className="kairo-compliance-event-meta"
                            title={t('widget.compliance.audit.timestamp', { ts: event.ts, user: event.userId })}>
                            {event.ts} · {event.userId}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

interface RetentionTabProps {
    policies: RetentionPolicy[];
    i18n: KairoI18nService;
}

const RetentionTab: React.FC<RetentionTabProps> = ({ policies, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    if (policies.length === 0) {
        return (
            <div className="kairo-compliance-empty" role="status" aria-label={t('widget.compliance.retention.empty')}>
                {t('widget.compliance.retention.empty')}
            </div>
        );
    }

    return (
        <div role="list" aria-label="Retention policy list">
            {policies.map(policy => (
                <div key={policy.name} role="listitem" className="kairo-compliance-card">
                    <div className="kairo-compliance-card-title"
                        title={t('widget.compliance.retention.policy', { name: policy.name })}>
                        {policy.name}
                    </div>
                    <div>
                        <div className="kairo-compliance-row" title={t('widget.compliance.retention.resourceType', { value: policy.resourceType })}>
                            {t('widget.compliance.retention.resourceType', { value: policy.resourceType })}
                        </div>
                        <div className="kairo-compliance-row" title={t('widget.compliance.retention.maxAge', { value: policy.maxAge })}>
                            {t('widget.compliance.retention.maxAge', { value: policy.maxAge })}
                        </div>
                        <div className="kairo-compliance-row" title={t('widget.compliance.retention.maxSize', { value: policy.maxSize })}>
                            {t('widget.compliance.retention.maxSize', { value: policy.maxSize })}
                        </div>
                        <div className="kairo-compliance-row">
                            <span>{t('widget.compliance.retention.autoCleanup')}</span>
                            <span className={`kairo-compliance-row-value ${policy.autoCleanup ? 'kairo-compliance-row-value-success' : 'kairo-compliance-row-value-neutral'}`}>
                                <span className={`kairo-compliance-status-dot ${policy.autoCleanup ? 'kairo-compliance-status-on' : 'kairo-compliance-status-off'}`}
                                    title={policy.autoCleanup ? t('widget.compliance.retention.cleanupOn') : t('widget.compliance.retention.cleanupOff')}
                                    aria-label={policy.autoCleanup ? t('widget.compliance.retention.cleanupOn') : t('widget.compliance.retention.cleanupOff')}
                                />
                                {policy.autoCleanup ? t('widget.compliance.retention.enabled') : t('widget.compliance.retention.disabled')}
                            </span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

interface SSOTabProps {
    ssoStatus: SSOStatus;
    i18n: KairoI18nService;
}

const SSOTab: React.FC<SSOTabProps> = ({ ssoStatus, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    return (
        <div role="group" aria-label="SSO configuration">
            <div className="kairo-compliance-card">
                <div className="kairo-compliance-card-title">
                    {t('widget.compliance.sso.configTitle')}
                </div>
                <div>
                    <div className="kairo-compliance-row"
                        title={ssoStatus.enabled ? t('widget.compliance.sso.stateOn') : t('widget.compliance.sso.stateOff')}>
                        <span>{t('widget.compliance.sso.status')}</span>
                        <span className={`kairo-compliance-row-value ${ssoStatus.enabled ? 'kairo-compliance-row-value-success' : 'kairo-compliance-row-value-neutral'}`}
                            aria-label={ssoStatus.enabled ? t('widget.compliance.sso.stateOn') : t('widget.compliance.sso.stateOff')}>
                            {ssoStatus.enabled ? t('widget.compliance.sso.enabled') : t('widget.compliance.sso.disabled')}
                        </span>
                    </div>
                    <div className="kairo-compliance-row"
                        title={t('widget.compliance.sso.providerValue', { value: ssoStatus.provider.toUpperCase() })}>
                        <span>{t('widget.compliance.sso.provider')}</span>
                        <span className="kairo-compliance-row-value">{ssoStatus.provider}</span>
                    </div>
                    <div className="kairo-compliance-row"
                        title={t('widget.compliance.sso.issuerValue', { value: ssoStatus.issuer || t('widget.compliance.sso.na') })}>
                        <span>{t('widget.compliance.sso.issuer')}</span>
                        <span>{ssoStatus.issuer || t('widget.compliance.sso.na')}</span>
                    </div>
                    <div className="kairo-compliance-row"
                        title={ssoStatus.configured ? t('widget.compliance.sso.configuredOn') : t('widget.compliance.sso.configuredOff')}>
                        <span>{t('widget.compliance.sso.configured')}</span>
                        <span className={`kairo-compliance-row-value ${ssoStatus.configured ? 'kairo-compliance-row-value-success' : 'kairo-compliance-row-value-danger'}`}
                            aria-label={ssoStatus.configured ? t('widget.compliance.sso.configuredOn') : t('widget.compliance.sso.configuredOff')}>
                            {ssoStatus.configured ? t('widget.compliance.sso.yes') : t('widget.compliance.sso.no')}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

@injectable()
export class KairoComplianceWidget extends ReactWidget {
    static readonly ID = KAIRO_COMPLIANCE_FACTORY_ID;
    static readonly LABEL = 'Enterprise Compliance';

    @inject(KairoComplianceSuite)
    protected readonly complianceSuite!: KairoComplianceSuite;

    @inject(KairoAuditLog)
    protected readonly auditLog!: KairoAuditLog;

    @inject(ILogger)
    protected readonly logger!: ILogger;

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    @postConstruct()
    protected init(): void {
        this.id = KairoComplianceWidget.ID;
        this.title.label = this.i18n.t('widget.compliance.title' as any);
        this.title.caption = this.i18n.t('widget.compliance.caption' as any);
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
            this.title.label = this.i18n.t('widget.compliance.title' as any);
            this.title.caption = this.i18n.t('widget.compliance.caption' as any);
            this.update();
        }));
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();
    }

    protected render(): React.ReactNode {
        return React.createElement(CompliancePanel, {
            complianceSuite: this.complianceSuite,
            auditLog: this.auditLog,
            logger: this.logger,
            i18n: this.i18n,
        });
    }
}
