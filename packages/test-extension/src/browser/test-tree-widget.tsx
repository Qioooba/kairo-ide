import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common';
import { TestStore, TestItem, TestStatus, TestRun as _TestRun } from './test-store';

function statusIcon(status: TestStatus): string {
    switch (status) {
        case 'idle': return '\u25CB';     // hollow circle
        case 'running': return '\u25D0';  // half circle
        case 'passed': return '\u2713';   // check mark
        case 'failed': return '\u2717';   // ballot x
        case 'skipped': return '\u29B8';  // circle with horizontal bar
        case 'error': return '\u26A0';    // warning sign
    }
}

function statusClass(status: TestStatus): string {
    switch (status) {
        case 'passed': return 'kairo-test-passed';
        case 'failed': return 'kairo-test-failed';
        case 'skipped': return 'kairo-test-skipped';
        case 'error': return 'kairo-test-error';
        case 'running': return 'kairo-test-running';
        default: return 'kairo-test-idle';
    }
}

function kindIcon(kind: TestItem['kind']): string {
    switch (kind) {
        case 'package': return '\uD83D\uDCE6'; // package
        case 'class': return '\uD83D\uDCDD';   // memo
        case 'method': return '\u2699';         // gear
    }
}

interface TestTreeProps {
    store: TestStore;
    commandService: CommandService;
}

/** Single tree node component. */
const TestTreeNode: React.FC<{
    item: TestItem;
    store: TestStore;
    depth: number;
    onRun: (item: TestItem) => void;
}> = ({ item, store, depth, onRun }) => {
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
                style={{ paddingLeft: `${depth * 16 + 4}px` }}
                onClick={toggle}
                data-testid={`test-item-${item.id}`}
                role="treeitem"
                aria-expanded={hasChildren ? expanded : undefined}
            >
                <span className="kairo-test-tree-toggle">
                    {hasChildren ? (expanded ? '\u25BC' : '\u25B6') : '\u00A0'}
                </span>
                <span className={`kairo-test-status ${statusClass(item.status)}`} aria-label={item.status}>
                    {statusIcon(item.status)}
                </span>
                <span className="kairo-test-kind-icon">{kindIcon(item.kind)}</span>
                <span className="kairo-test-label">{item.label}</span>
                {item.durationMs !== undefined && (
                    <span className="kairo-test-duration">{formatDuration(item.durationMs)}</span>
                )}
                <button
                    className="theia-button secondary kairo-test-run-btn"
                    onClick={e => { e.stopPropagation(); onRun(item); }}
                    data-testid={`run-test-${item.id}`}
                    aria-label={`Run ${item.label}`}
                >
                    Run
                </button>
            </div>
            {item.status === 'failed' && item.failureMessage && (
                <div
                    className="kairo-test-failure"
                    style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}
                    role="alert"
                    data-testid={`test-failure-${item.id}`}
                >
                    <span className="kairo-test-failure-icon">{statusIcon('failed')}</span>
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
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const TestTreeComponent: React.FC<TestTreeProps> = ({ store, commandService: _commandService }) => {
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
                    <span className="kairo-widget-title">Tests</span>
                </div>
                <p className="kairo-empty" data-testid="test-loading">Loading...</p>
            </div>
        );
    }

    if (connectionState === 'disconnected') {
        return (
            <div className="kairo-widget" data-testid="test-view">
                <div className="kairo-widget-header">
                    <span className="kairo-widget-title">Tests</span>
                </div>
                <p className="kairo-empty" data-testid="test-disconnected">
                    Cannot reach the runtime agent. Test commands are unavailable.
                </p>
            </div>
        );
    }

    const totalCount = items.reduce((sum, root) => sum + countAll(root, store), 0);

    return (
        <div className="kairo-widget" data-testid="test-view">
            <div className="kairo-widget-header">
                <span className="kairo-widget-title">Tests</span>
                {totalCount > 0 && (
                    <span className="kairo-test-count" data-testid="test-count">
                        {totalCount} test{totalCount !== 1 ? 's' : ''}
                    </span>
                )}
            </div>

            <div className="kairo-widget-toolbar" data-testid="test-view-toolbar">
                <button
                    className="theia-button"
                    data-testid="run-all-tests"
                    onClick={handleRunAll}
                    disabled={isBusy}
                    aria-label="Run all tests"
                >
                    Run All
                </button>
                <button
                    className="theia-button secondary"
                    data-testid="discover-tests"
                    onClick={handleDiscover}
                    disabled={isBusy}
                    aria-label="Refresh test list"
                >
                    Refresh
                </button>
                <button
                    className="theia-button secondary"
                    data-testid="cancel-tests"
                    onClick={handleCancel}
                    disabled={!isBusy || cancelling}
                    aria-label="Cancel test run"
                >
                    {cancelling ? 'Cancelling...' : 'Cancel'}
                </button>
            </div>

            {cancelError && <div className="theia-error" role="alert" data-testid="cancel-test-error">{cancelError}</div>}

            {latestRun && (
                <div className="kairo-test-summary" data-testid="test-run-summary">
                    <span className={`kairo-test-summary-item ${statusClass(latestRun.state === 'succeeded' ? 'passed' : latestRun.state === 'failed' ? 'failed' : 'running')}`}>
                        {statusIcon(latestRun.state === 'succeeded' ? 'passed' : latestRun.state === 'failed' ? 'failed' : 'running')}{' '}
                        {latestRun.passedCount}/{latestRun.totalCount} passed
                    </span>
                    {latestRun.failedCount > 0 && (
                        <span className="kairo-test-summary-item kairo-test-failed">
                            {statusIcon('failed')} {latestRun.failedCount} failed
                        </span>
                    )}
                    {latestRun.skippedCount > 0 && (
                        <span className="kairo-test-summary-item kairo-test-skipped">
                            {statusIcon('skipped')} {latestRun.skippedCount} skipped
                        </span>
                    )}
                </div>
            )}

            {items.length === 0 ? (
                <p className="kairo-empty" data-testid="test-empty">
                    No tests discovered. Press <strong>Refresh</strong> to scan the project.
                </p>
            ) : (
                <div className="kairo-test-tree" role="tree" aria-label="Test tree" data-testid="test-tree">
                    {items.map(item => (
                        <TestTreeNode
                            key={item.id}
                            item={item}
                            store={store}
                            depth={0}
                            onRun={handleRunItem}
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

    constructor() {
        super();
        this.id = TestTreeWidget.ID;
        this.title.label = 'Kairo Tests';
        this.title.caption = 'Kairo Test Explorer';
        this.addClass('kairo-widget');
    }

    protected render(): React.ReactNode {
        return React.createElement(TestTreeComponent, {
            store: this.testStore,
            commandService: this.commandService,
        });
    }
}