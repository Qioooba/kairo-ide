import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common';
import { KairoI18nService } from '@kairo/i18n';
import { TestStore, TestItem, TestStatus } from './test-store';

function statusIconClass(status: TestStatus): string {
    switch (status) {
        case 'idle': return 'codicon codicon-circle-outline';
        case 'running': return 'codicon codicon-sync codicon-modifier-spin';
        case 'passed': return 'codicon codicon-check';
        case 'failed': return 'codicon codicon-error';
        case 'skipped': return 'codicon codicon-circle-slash';
        case 'error': return 'codicon codicon-warning';
    }
}

function statusColorClass(status: TestStatus): string {
    return `kairo-test-status-${status}`;
}

function kindIconClass(kind: TestItem['kind']): string {
    switch (kind) {
        case 'package': return 'codicon codicon-package';
        case 'class': return 'codicon codicon-symbol-class';
        case 'method': return 'codicon codicon-gear';
    }
}

interface TestTreeProps {
    store: TestStore;
    commandService: CommandService;
    i18n: KairoI18nService;
}

interface TestTreeNodeProps {
    item: TestItem;
    store: TestStore;
    depth: number;
    onRun: (item: TestItem) => void;
    i18n: KairoI18nService;
}

/** Single tree node component. */
const TestTreeNode: React.FC<TestTreeNodeProps> = ({ item, store, depth, onRun, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [expanded, setExpanded] = React.useState(false);
    const children = store.getChildren(item.id);
    const hasChildren = children.length > 0;

    const toggle = () => {
        if (hasChildren) setExpanded(!expanded);
    };

    return (
        <div className="kairo-test-tree-node">
            <div
                className="kairo-test-tree-item"
                style={{ ['--kairo-test-tree-depth' as any]: depth }}
                onClick={toggle}
                data-testid={`test-item-${item.id}`}
                role="treeitem"
                aria-expanded={hasChildren ? expanded : undefined}
            >
                <span className="kairo-test-tree-toggle">
                    {hasChildren ? (
                        <span className={`codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
                    ) : (
                        <span className="kairo-test-tree-toggle-placeholder" aria-hidden="true">&nbsp;</span>
                    )}
                </span>
                <span className={`kairo-test-status ${statusColorClass(item.status)}`} aria-label={t(`widget.test.tree.status.${item.status}` as any)}>
                    <span className={statusIconClass(item.status)} aria-hidden="true" />
                </span>
                <span className="kairo-test-kind-icon"><span className={kindIconClass(item.kind)} aria-hidden="true" /></span>
                <span className="kairo-test-label">{item.label}</span>
                {item.durationMs !== undefined && (
                    <span className="kairo-test-duration">{formatDuration(item.durationMs)}</span>
                )}
                <button
                    className="theia-button secondary kairo-test-run-btn"
                    onClick={e => { e.stopPropagation(); onRun(item); }}
                    data-testid={`run-test-${item.id}`}
                    aria-label={t('widget.test.tree.runAria', { label: item.label })}
                >
                    {t('widget.test.tree.run')}
                </button>
            </div>
            {item.status === 'failed' && item.failureMessage && (
                <div
                    className="kairo-test-failure"
                    style={{ ['--kairo-test-tree-depth' as any]: depth + 1 }}
                    role="alert"
                    data-testid={`test-failure-${item.id}`}
                >
                    <span className="kairo-test-failure-icon"><span className={statusIconClass('failed')} aria-hidden="true" /></span>
                    <span className="kairo-test-failure-msg">{item.failureMessage}</span>
                </div>
            )}
            {expanded && hasChildren && (
                <div className="kairo-test-tree-children">
                    {children.map(child => (
                        <TestTreeNode
                            key={child.id}
                            item={child}
                            store={store}
                            depth={depth + 1}
                            onRun={onRun}
                            i18n={i18n}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const TestTreeComponent: React.FC<TestTreeProps> = ({ store, commandService: _commandService, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [items, setItems] = React.useState<TestItem[]>(store.getRootItems());
    const [connectionState, setConnectionState] = React.useState(store.getConnectionState());
    const [cancelError, setCancelError] = React.useState('');
    const [cancelling, setCancelling] = React.useState(false);

    React.useEffect(() => {
        const sub = store.onDidChange(() => setItems([...store.getRootItems()]));
        return () => sub.dispose();
    }, [store]);

    React.useEffect(() => {
        const sub = store.onConnectionStateChange(s => setConnectionState(s));
        return () => sub.dispose();
    }, [store]);

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    const latestRun = store.getLatestRun();
    const isBusy = latestRun?.state === 'running' || latestRun?.state === 'pending';

    const handleRunAll = () => store.runTests('all', '');
    const handleRunItem = (item: TestItem) => {
        if (item.kind === 'package') store.runTests('package', item.qualifiedName);
        else if (item.kind === 'class') store.runTests('class', item.qualifiedName);
        else if (item.kind === 'method') store.runTests('method', item.qualifiedName);
    };
    const handleCancel = async () => {
        if (!latestRun || cancelling) return;
        setCancelError('');
        setCancelling(true);
        try {
            await store.cancelRun(latestRun.id);
        } finally {
            setCancelling(false);
        }
    };

    const handleDiscover = () => store.discoverTests();

    if (connectionState === 'loading') {
        return (
            <div className="kairo-widget" data-testid="test-view">
                <div className="kairo-widget-header">
                    <span className="kairo-widget-title">{t('widget.test.tree.title')}</span>
                </div>
                <div className="kairo-empty-state" data-testid="test-loading">
                    <span className="kairo-empty-state-glyph codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.test.tree.loading')}</h3>
                </div>
            </div>
        );
    }

    if (connectionState === 'disconnected') {
        return (
            <div className="kairo-widget" data-testid="test-view">
                <div className="kairo-widget-header">
                    <span className="kairo-widget-title">{t('widget.test.tree.title')}</span>
                </div>
                <div className="kairo-empty-state" data-testid="test-disconnected">
                    <span className="kairo-empty-state-glyph codicon codicon-warning" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.test.tree.disconnectedTitle')}</h3>
                    <p className="kairo-empty-state-reason">{t('widget.test.tree.disconnectedReason')}</p>
                </div>
            </div>
        );
    }

    const totalCount = items.reduce((sum, root) => sum + countAll(root, store), 0);

    return (
        <div className="kairo-widget" data-testid="test-view">
            <div className="kairo-widget-header">
                <span className="kairo-widget-title">{t('widget.test.tree.title')}</span>
                {totalCount > 0 && (
                    <span className="kairo-test-count" data-testid="test-count">
                        {totalCount === 1
                            ? t('widget.test.tree.count.one', { count: totalCount })
                            : t('widget.test.tree.count.other', { count: totalCount })}
                    </span>
                )}
            </div>

            <div className="kairo-widget-toolbar" data-testid="test-view-toolbar">
                <button
                    className="theia-button"
                    data-testid="run-all-tests"
                    onClick={handleRunAll}
                    disabled={isBusy}
                    aria-label={t('widget.test.tree.runAllAria')}
                >
                    {t('widget.test.tree.runAll')}
                </button>
                <button
                    className="theia-button secondary"
                    data-testid="discover-tests"
                    onClick={handleDiscover}
                    disabled={isBusy}
                    aria-label={t('widget.test.tree.refreshAria')}
                >
                    {t('widget.test.tree.refresh')}
                </button>
                <button
                    className="theia-button secondary"
                    data-testid="cancel-tests"
                    onClick={handleCancel}
                    disabled={!isBusy || cancelling}
                    aria-label={t('widget.test.tree.cancelAria')}
                >
                    {cancelling ? t('widget.test.tree.cancelling') : t('widget.test.tree.cancel')}
                </button>
            </div>

            {cancelError && (
                <div className="kairo-error-banner" role="alert" data-testid="cancel-test-error">
                    <span className="codicon codicon-warning" aria-hidden="true" />
                    <span>{cancelError}</span>
                </div>
            )}

            {latestRun && (
                <div className="kairo-test-summary" data-testid="test-run-summary">
                    <span className={`kairo-test-summary-item ${statusColorClass(latestRun.state === 'succeeded' ? 'passed' : latestRun.state === 'failed' ? 'failed' : 'running')}`}>
                        <span className={statusIconClass(latestRun.state === 'succeeded' ? 'passed' : latestRun.state === 'failed' ? 'failed' : 'running')} aria-hidden="true" />
                        {' '}
                        {t('widget.test.tree.summary.passed', { passed: latestRun.passedCount, total: latestRun.totalCount })}
                    </span>
                    {latestRun.failedCount > 0 && (
                        <span className={`kairo-test-summary-item ${statusColorClass('failed')}`}>
                            <span className={statusIconClass('failed')} aria-hidden="true" />
                            {' '}
                            {t('widget.test.tree.summary.failed', { count: latestRun.failedCount })}
                        </span>
                    )}
                    {latestRun.skippedCount > 0 && (
                        <span className={`kairo-test-summary-item ${statusColorClass('skipped')}`}>
                            <span className={statusIconClass('skipped')} aria-hidden="true" />
                            {' '}
                            {t('widget.test.tree.summary.skipped', { count: latestRun.skippedCount })}
                        </span>
                    )}
                </div>
            )}

            {items.length === 0 ? (
                <div className="kairo-empty-state" data-testid="test-empty">
                    <span className="kairo-empty-state-glyph codicon codicon-beaker" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.test.tree.emptyStateTitle')}</h3>
                    <p className="kairo-empty-state-reason">
                        {t('widget.test.tree.emptyStateReason', { action: t('widget.test.tree.refresh') })}
                    </p>
                </div>
            ) : (
                <div className="kairo-test-tree" role="tree" aria-label={t('widget.test.tree.treeAria')} data-testid="test-tree">
                    {items.map(item => (
                        <TestTreeNode
                            key={item.id}
                            item={item}
                            store={store}
                            depth={0}
                            onRun={handleRunItem}
                            i18n={i18n}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

function countAll(item: TestItem, store: TestStore): number {
    let count = item.kind === 'method' ? 1 : 0;
    for (const childId of item.children) {
        const child = store.getItem(childId);
        if (child) count += countAll(child, store);
    }
    return count;
}

function formatDuration(ms: number): string {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

@injectable()
export class TestTreeWidget extends ReactWidget {
    static readonly ID = 'kairo-test-tree';

    @inject(TestStore) protected readonly testStore!: TestStore;
    @inject(CommandService) protected readonly commandService!: CommandService;
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    @postConstruct()
    protected init(): void {
        this.id = TestTreeWidget.ID;
        this.title.label = this.i18n.t('widget.test.tree.title' as any);
        this.title.caption = this.i18n.t('widget.test.tree.caption' as any);
        this.addClass('kairo-widget');
        this.update();
    }

    protected render(): React.ReactNode {
        return React.createElement(TestTreeComponent, {
            store: this.testStore,
            commandService: this.commandService,
            i18n: this.i18n,
        });
    }
}
