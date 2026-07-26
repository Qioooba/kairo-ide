/**
 * Kairo Bookmarks Widget — list of all bookmarks grouped by file,
 * with navigation and removal.
 *
 * Provides a consolidated view of all bookmarks with click-to-navigate
 * and per-bookmark delete buttons.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import URI from '@theia/core/lib/common/uri';
import { BookmarkService, Bookmark } from './kairo-bookmark-service';

export const KAIRO_BOOKMARKS_FACTORY_ID = 'kairo-bookmarks';

interface BookmarkGroup {
    uri: string;
    fileName: string;
    bookmarks: Bookmark[];
}

interface BookmarksViewProps {
    groups: BookmarkGroup[];
    openerService: OpenerService;
    onNavigate: (bookmark: Bookmark) => void;
    onRemove: (bookmark: Bookmark) => void;
    onClearAll: () => void;
}

const BookmarksView: React.FC<BookmarksViewProps> = ({
    groups, openerService, onNavigate, onRemove, onClearAll,
}) => {
    const totalCount = groups.reduce((sum, g) => sum + g.bookmarks.length, 0);

    const handleClick = (bookmark: Bookmark) => {
        onNavigate(bookmark);
        try {
            const uri = new URI(bookmark.uri);
            open(openerService, uri, {
                selection: {
                    start: { line: Math.max(0, bookmark.line - 1), character: 0 },
                    end: { line: Math.max(0, bookmark.line - 1), character: 0 },
                },
            });
        } catch {
            // Silently ignore navigation errors
        }
    };

    return (
        <div className="kairo-bookmarks-widget" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="kairo-widget-toolbar" style={{ padding: '4px 8px', borderBottom: '1px solid var(--theia-panel-border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: '12px' }}>Bookmarks</span>
                <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                    {totalCount} items
                </span>
                <div style={{ flex: 1 }} />
                <button
                    className="theia-button secondary"
                    disabled={totalCount === 0}
                    onClick={onClearAll}
                    style={{ padding: '1px 8px', fontSize: '11px' }}
                    title="Clear all bookmarks"
                >
                    Clear All
                </button>
            </div>

            <div style={{ flex: 1, overflow: 'auto' }}>
                {groups.length === 0 && (
                    <div style={{ padding: '12px', color: 'var(--theia-descriptionForeground)', fontSize: '12px', textAlign: 'center' }}>
                        No bookmarks set. Press F11 to toggle a bookmark at the cursor.
                    </div>
                )}
                {groups.map(group => (
                    <div key={group.uri}>
                        <div style={{
                            padding: '4px 8px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: 'var(--theia-sideBarSectionHeader-background)',
                            color: 'var(--theia-sideBarSectionHeader-foreground)',
                            borderBottom: '1px solid var(--theia-panel-border)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }} title={group.uri}>
                            {group.fileName}
                        </div>
                        {group.bookmarks.map((bm, idx) => (
                            <div
                                key={`${group.uri}:${bm.line}-${idx}`}
                                className="kairo-bookmark-row"
                                style={{
                                    padding: '3px 8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: '12px',
                                    lineHeight: '18px',
                                    borderBottom: '1px solid var(--theia-panel-border)',
                                    cursor: 'pointer',
                                }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
                                onClick={() => handleClick(bm)}
                            >
                                <span
                                    className={bm.number !== undefined ? 'codicon codicon-bookmark' : 'codicon codicon-circle-filled'}
                                    style={{
                                        fontSize: bm.number !== undefined ? '12px' : '10px',
                                        color: bm.number !== undefined ? '#ffc107' : '#4fc3f7',
                                        flexShrink: 0,
                                        width: 16,
                                        textAlign: 'center',
                                    }}
                                >
                                    {bm.number !== undefined ? bm.number : ''}
                                </span>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <span style={{ fontFamily: 'monospace' }}>:{bm.line}</span>
                                </div>
                                <button
                                    className="theia-button secondary"
                                    onClick={(e) => { e.stopPropagation(); onRemove(bm); }}
                                    style={{ padding: '0 6px', fontSize: '14px', lineHeight: '18px', flexShrink: 0 }}
                                    title="Remove bookmark"
                                    aria-label={`Remove bookmark at line ${bm.line}`}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

@injectable()
export class KairoBookmarksWidget extends ReactWidget {
    static readonly ID = KAIRO_BOOKMARKS_FACTORY_ID;

    @inject(BookmarkService)
    protected readonly bookmarkService!: BookmarkService;

    @inject(OpenerService)
    protected readonly openerService!: OpenerService;

    @postConstruct()
    protected init(): void {
        this.id = KairoBookmarksWidget.ID;
        this.title.label = 'Bookmarks';
        this.title.caption = 'Kairo Bookmarks';
        this.title.iconClass = 'codicon codicon-bookmark';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();

        this.bookmarkService.onDidChangeBookmarks(() => this.update());
    }

    protected onAfterShow(): void {
        this.update();
    }

    protected render(): React.ReactNode {
        const bookmarks = this.bookmarkService.getBookmarks();
        const groups = this.groupByFile(bookmarks);
        return React.createElement(BookmarksView, {
            groups,
            openerService: this.openerService,
            onNavigate: (_bm: Bookmark) => { /* navigation handled by opener */ },
            onRemove: (bm: Bookmark) => this.bookmarkService.removeBookmark(bm.uri, bm.line),
            onClearAll: () => this.bookmarkService.clearAllBookmarks(),
        });
    }

    protected groupByFile(bookmarks: Bookmark[]): BookmarkGroup[] {
        const groupMap = new Map<string, BookmarkGroup>();
        for (const bm of bookmarks) {
            if (!groupMap.has(bm.uri)) {
                const fileName = bm.uri.split('/').pop()?.split('\\').pop() ?? 'Unknown';
                groupMap.set(bm.uri, { uri: bm.uri, fileName, bookmarks: [] });
            }
            groupMap.get(bm.uri)!.bookmarks.push(bm);
        }
        for (const group of groupMap.values()) {
            group.bookmarks.sort((a, b) => a.line - b.line);
        }
        return Array.from(groupMap.values());
    }
}
