/**
 * Kairo Compliance Widget — Enterprise Compliance Panel
 *
 * Provides RBAC role viewer, audit log viewer, data retention policy
 * status, and SSO configuration status in a single panel.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ILogger } from '@theia/core/lib/common/logger';
import { KairoComplianceSuite } from './kairo-compliance';
import { KairoAuditLog, type AuditLogEntry, type AuditLogFilter } from './kairo-audit-log';

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
}

const CompliancePanel: React.FC<CompliancePanelProps> = ({ complianceSuite, auditLog, logger }) => {
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
        const colors: Record<string, string> = {
            ok: '#4caf50',
            denied: '#ff9800',
            error: '#f44336',
        };
        return (
            <span style={{
                display: 'inline-block',
                padding: '1px 6px',
                borderRadius: '3px',
                fontSize: '10px',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: colors[result] || '#999',
                textTransform: 'uppercase',
            }}>
                {result}
            </span>
        );
    };

    const tabStyle = (tab: string): React.CSSProperties => ({
        padding: '6px 16px',
        cursor: 'pointer',
        borderBottom: activeTab === tab ? '2px solid var(--theia-focusBorder)' : '2px solid transparent',
        color: activeTab === tab ? 'var(--theia-focusBorder)' : 'var(--theia-descriptionForeground)',
        fontWeight: activeTab === tab ? 600 : 400,
        fontSize: '12px',
        background: 'none',
        border: 'none',
    });

    // Loading state — skeleton placeholder
    if (state.loading) {
        return (
            <div className="kairo-compliance-widget" role="status" aria-label="Loading compliance data" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        width: '24px',
                        height: '24px',
                        border: '3px solid var(--theia-dropdown-border)',
                        borderTopColor: 'var(--theia-focusBorder)',
                        borderRadius: '50%',
                        animation: 'kairo-spin 0.8s linear infinite',
                    }} />
                    <p style={{ color: 'var(--theia-descriptionForeground)', fontSize: '13px', margin: 0 }}>
                        Loading compliance data...
                    </p>
                    <div style={{ width: '80%', maxWidth: '300px' }}>
                        {[0, 1, 2].map(i => (
                            <div key={i} style={{
                                height: '12px',
                                backgroundColor: 'var(--theia-dropdown-border)',
                                borderRadius: '3px',
                                marginBottom: '8px',
                                opacity: 0.5 - i * 0.15,
                                width: `${90 - i * 15}%`,
                            }} />
                        ))}
                    </div>
                </div>
                <style>{`@keyframes kairo-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    // Error state — categorized by error type
    if (state.error) {
        const isTimeout = state.error.toLowerCase().includes('timeout') || state.error.toLowerCase().includes('timed out');
        const isPermission = state.error.toLowerCase().includes('permission') || state.error.toLowerCase().includes('denied') || state.error.toLowerCase().includes('unauthorized');
        const isConfig = state.error.toLowerCase().includes('config') || state.error.toLowerCase().includes('setting');
        const errorIcon = isTimeout ? '⏱' : isPermission ? '🔒' : isConfig ? '⚙' : '⚠';
        const errorTitle = isTimeout ? 'Request Timed Out' : isPermission ? 'Permission Denied' : isConfig ? 'Configuration Error' : 'Error loading compliance data';
        return (
            <div className="kairo-compliance-widget" role="alert" aria-live="assertive" style={{ padding: '16px' }}>
                <div style={{
                    padding: '12px',
                    backgroundColor: 'rgba(244,67,54,0.1)',
                    border: '1px solid rgba(244,67,54,0.3)',
                    borderRadius: '4px',
                    color: 'var(--theia-errorForeground)',
                    fontSize: '13px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '18px' }} aria-hidden="true">{errorIcon}</span>
                        <strong>{errorTitle}</strong>
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px' }}>{state.error}</p>
                    <button
                        className="theia-button"
                        onClick={loadData}
                        title="Retry loading compliance data"
                        aria-label="Retry loading compliance data"
                        style={{ marginTop: '8px', fontSize: '11px', padding: '2px 12px' }}
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const tabs = ['roles', 'audit', 'retention', 'sso'] as const;
    const tabLabels: Record<string, string> = {
        roles: 'RBAC Roles',
        audit: 'Audit Log',
        retention: 'Retention',
        sso: 'SSO',
    };

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
        <div className="kairo-compliance-widget" role="region" aria-label="Enterprise Compliance" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div className="kairo-widget-header" style={{ padding: '8px 12px', borderBottom: '1px solid var(--theia-panel-border)' }}>
                <span style={{ fontWeight: 600, fontSize: '13px' }}>Enterprise Compliance</span>
            </div>

            {/* Tabs */}
            <div role="tablist" aria-label="Compliance panel sections" style={{ display: 'flex', borderBottom: '1px solid var(--theia-panel-border)', padding: '0 8px' }}>
                {tabs.map(tab => (
                    <button
                        key={tab}
                        role="tab"
                        aria-selected={activeTab === tab}
                        aria-controls={`kairo-compliance-tabpanel-${tab}`}
                        id={`kairo-compliance-tab-${tab}`}
                        style={tabStyle(tab)}
                        onClick={() => setActiveTab(tab)}
                        onKeyDown={e => handleTabKeyDown(e, tab)}
                        tabIndex={activeTab === tab ? 0 : -1}
                        title={`${tabLabels[tab]} (${tab === 'roles' ? 'View role-based access control' : tab === 'audit' ? 'View audit log entries' : tab === 'retention' ? 'View data retention policies' : 'View SSO configuration'})`}
                    >
                        {tabLabels[tab]}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
                {activeTab === 'roles' && (
                    <div role="tabpanel" id="kairo-compliance-tabpanel-roles" aria-labelledby="kairo-compliance-tab-roles">
                        <RolesTab roles={state.roles} />
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
                        />
                    </div>
                )}
                {activeTab === 'retention' && (
                    <div role="tabpanel" id="kairo-compliance-tabpanel-retention" aria-labelledby="kairo-compliance-tab-retention">
                        <RetentionTab policies={state.retentionPolicies} />
                    </div>
                )}
                {activeTab === 'sso' && (
                    <div role="tabpanel" id="kairo-compliance-tabpanel-sso" aria-labelledby="kairo-compliance-tab-sso">
                        <SSOTab ssoStatus={state.ssoStatus} />
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
}

const RolesTab: React.FC<RolesTabProps> = ({ roles }) => {
    if (roles.length === 0) {
        return (
            <div role="status" aria-label="No roles" style={{ textAlign: 'center', padding: '20px', color: 'var(--theia-descriptionForeground)', fontSize: '13px' }}>
                No roles configured. Configure RBAC roles to manage access control.
            </div>
        );
    }

    return (
        <div role="list" aria-label="Role list">
            {roles.map(role => (
                <div key={role.name} role="listitem" style={{
                    marginBottom: '12px',
                    padding: '10px 12px',
                    backgroundColor: 'var(--theia-editor-background)',
                    borderRadius: '4px',
                    border: '1px solid var(--theia-dropdown-border)',
                }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', textTransform: 'capitalize', marginBottom: '6px' }}
                        title={`Role: ${role.name} — ${role.permissions.length} permissions`}>
                        {role.name}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {role.permissions.map(perm => (
                            <span key={perm} style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '3px',
                                fontSize: '11px',
                                backgroundColor: 'var(--theia-badge-background)',
                                color: 'var(--theia-badge-foreground)',
                            }}
                                title={`Permission: ${perm}`}
                                aria-label={`Permission: ${perm}`}
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
}

const AuditTab: React.FC<AuditTabProps> = ({ events, filter, onFilterChange, resultBadge, onRefresh }) => {
    return (
        <div role="group" aria-label="Audit log">
            {/* Filter bar */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                    type="text"
                    placeholder="Search..."
                    value={filter.search}
                    onChange={e => onFilterChange({ ...filter, search: e.target.value })}
                    title="Search audit events by action, target, or user"
                    aria-label="Search audit events"
                    style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        backgroundColor: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: '2px',
                        flex: '1 1 120px',
                        minWidth: '100px',
                    }}
                />
                <select
                    value={filter.action}
                    onChange={e => onFilterChange({ ...filter, action: e.target.value })}
                    title="Filter by action category"
                    aria-label="Filter by action category"
                    style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        backgroundColor: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: '2px',
                    }}
                >
                    <option value="">All Actions</option>
                    <option value="file">File</option>
                    <option value="build">Build</option>
                    <option value="debug">Debug</option>
                    <option value="command">Command</option>
                    <option value="git">Git</option>
                    <option value="sql">SQL</option>
                </select>
                <select
                    value={filter.result}
                    onChange={e => onFilterChange({ ...filter, result: e.target.value })}
                    title="Filter by result"
                    aria-label="Filter by result"
                    style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        backgroundColor: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: '2px',
                    }}
                >
                    <option value="">All Results</option>
                    <option value="ok">OK</option>
                    <option value="denied">Denied</option>
                    <option value="error">Error</option>
                </select>
                <button
                    className="theia-button secondary"
                    onClick={onRefresh}
                    title="Refresh audit log"
                    aria-label="Refresh audit log"
                    style={{ fontSize: '11px', padding: '3px 10px' }}
                >
                    Refresh
                </button>
            </div>

            {/* Empty state */}
            {events.length === 0 && (
                <div role="status" aria-label="No audit events" style={{ textAlign: 'center', padding: '20px', color: 'var(--theia-descriptionForeground)', fontSize: '13px' }}>
                    No audit events found{filter.action || filter.result || filter.search ? ' matching current filters' : ''}.
                </div>
            )}

            {/* Audit event list */}
            {events.length > 0 && events.map((event, idx) => (
                <div key={`${event.ts}-${idx}`} style={{
                    padding: '6px 10px',
                    borderBottom: '1px solid var(--theia-sideBarSectionHeader-border)',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                }}
                    role="listitem"
                    aria-label={`Audit event: ${event.action} by ${event.userId} — ${event.result}`}
                >
                    <div style={{ flexShrink: 0, marginTop: '1px' }}>
                        {resultBadge(event.result)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }} title={`Action: ${event.action}`}>
                            {event.action}
                        </div>
                        <div style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px', marginTop: '2px' }}
                            title={`Target: ${event.target}`}>
                            {event.target}
                        </div>
                        <div style={{ color: 'var(--theia-descriptionForeground)', fontSize: '10px', marginTop: '1px' }}
                            title={`Timestamp: ${event.ts} · User: ${event.userId}`}>
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
}

const RetentionTab: React.FC<RetentionTabProps> = ({ policies }) => {
    if (policies.length === 0) {
        return (
            <div role="status" aria-label="No policies" style={{ textAlign: 'center', padding: '20px', color: 'var(--theia-descriptionForeground)', fontSize: '13px' }}>
                No retention policies configured. Configure retention policies to manage data lifecycle.
            </div>
        );
    }

    return (
        <div role="list" aria-label="Retention policy list">
            {policies.map(policy => (
                <div key={policy.name} role="listitem" style={{
                    marginBottom: '12px',
                    padding: '10px 12px',
                    backgroundColor: 'var(--theia-editor-background)',
                    borderRadius: '4px',
                    border: '1px solid var(--theia-dropdown-border)',
                }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}
                        title={`Policy: ${policy.name}`}>
                        {policy.name}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--theia-descriptionForeground)' }}>
                        <div title={`Resource type: ${policy.resourceType}`}>Resource Type: {policy.resourceType}</div>
                        <div title={`Max age: ${policy.maxAge}`}>Max Age: {policy.maxAge}</div>
                        <div title={`Max size: ${policy.maxSize}`}>Max Size: {policy.maxSize}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                            Auto Cleanup:
                            <span style={{
                                display: 'inline-block',
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: policy.autoCleanup ? '#4caf50' : '#9e9e9e',
                            }}
                                title={policy.autoCleanup ? 'Auto cleanup enabled' : 'Auto cleanup disabled'}
                                aria-label={policy.autoCleanup ? 'Auto cleanup enabled' : 'Auto cleanup disabled'}
                            />
                            {policy.autoCleanup ? 'Enabled' : 'Disabled'}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

interface SSOTabProps {
    ssoStatus: SSOStatus;
}

const SSOTab: React.FC<SSOTabProps> = ({ ssoStatus }) => {
    return (
        <div role="group" aria-label="SSO configuration">
            <div style={{
                padding: '10px 12px',
                backgroundColor: 'var(--theia-editor-background)',
                borderRadius: '4px',
                border: '1px solid var(--theia-dropdown-border)',
            }}>
                <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
                    SSO Configuration
                </div>
                <div style={{ fontSize: '12px', color: 'var(--theia-descriptionForeground)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}
                        title={`SSO is ${ssoStatus.enabled ? 'enabled' : 'disabled'}`}>
                        <span>Status:</span>
                        <span style={{
                            fontWeight: 600,
                            color: ssoStatus.enabled ? '#4caf50' : '#9e9e9e',
                        }}
                            aria-label={`SSO is ${ssoStatus.enabled ? 'enabled' : 'disabled'}`}
                        >
                            {ssoStatus.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}
                        title={`Provider: ${ssoStatus.provider.toUpperCase()}`}>
                        <span>Provider:</span>
                        <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>
                            {ssoStatus.provider}
                        </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}
                        title={`Issuer: ${ssoStatus.issuer || 'N/A'}`}>
                        <span>Issuer:</span>
                        <span>{ssoStatus.issuer || 'N/A'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}
                        title={`Configured: ${ssoStatus.configured ? 'Yes' : 'No'}`}>
                        <span>Configured:</span>
                        <span style={{
                            fontWeight: 600,
                            color: ssoStatus.configured ? '#4caf50' : '#f44336',
                        }}
                            aria-label={`SSO ${ssoStatus.configured ? 'is' : 'is not'} configured`}
                        >
                            {ssoStatus.configured ? 'Yes' : 'No'}
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

    @postConstruct()
    protected init(): void {
        this.id = KairoComplianceWidget.ID;
        this.title.label = KairoComplianceWidget.LABEL;
        this.title.caption = 'Kairo Enterprise Compliance Panel';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();
    }

    protected render(): React.ReactNode {
        return React.createElement(CompliancePanel, {
            complianceSuite: this.complianceSuite,
            auditLog: this.auditLog,
            logger: this.logger,
        });
    }
}