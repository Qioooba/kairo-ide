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
import { KairoI18nService } from '@kairo/i18n';
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
    i18n: KairoI18nService;
}

const BookmarksView: React.FC<BookmarksViewProps> = ({
    groups, openerService, onNavigate, onRemove, onClearAll, i18n,
}) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const totalCount = groups.reduce((sum, g) => sum + g.bookmarks.length, 0);

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

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
        <div className="kairo-bookmarks-widget">
            <div className="kairo-widget-toolbar kairo-bookmarks-toolbar">
                <span className="kairo-bookmarks-title">{t('widget.bookmarks.title')}</span>
                <span className="kairo-bookmarks-count">
                    {t('widget.bookmarks.count', { count: totalCount })}
                </span>
                <div className="kairo-bookmarks-spacer" />
                <button
                    className="theia-button secondary kairo-bookmark-remove"
                    disabled={totalCount === 0}
                    onClick={onClearAll}
                    title={t('widget.bookmarks.clearAllAria')}
                >
                    {t('widget.bookmarks.clearAll')}
                </button>
            </div>

            <div className="kairo-bookmarks-list">
                {groups.length === 0 && (
                    <div className="kairo-bookmarks-empty">
                        {t('widget.bookmarks.empty')}
                    </div>
                )}
                {groups.map(group => (
                    <div key={group.uri}>
                        <div className="kairo-bookmarks-group" title={group.uri}>
                            {group.fileName}
                        </div>
                        {group.bookmarks.map((bm, idx) => (
                            <div
                                key={`${group.uri}:${bm.line}-${idx}`}
                                className="kairo-bookmark-row"
                                onClick={() => handleClick(bm)}
                            >
                                <span
                                    className={`kairo-bookmark-icon ${bm.number !== undefined ? 'kairo-bookmark-icon-number' : 'kairo-bookmark-icon-simple'} ${bm.number !== undefined ? 'codicon codicon-bookmark' : 'codicon codicon-circle-filled'}`}
                                >
                                    {bm.number !== undefined ? bm.number : ''}
                                </span>
                                <div className="kairo-bookmark-line">
                                    <span>:{bm.line}</span>
                                </div>
                                <button
                                    className="theia-button secondary kairo-bookmark-remove"
                                    onClick={(e) => { e.stopPropagation(); onRemove(bm); }}
                                    title={t('widget.bookmarks.remove')}
                                    aria-label={t('widget.bookmarks.removeAria', { line: bm.line })}
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

    @inject(KairoI18nService)
    protected readonly i18n!: KairoI18nService;

    @postConstruct()
    protected init(): void {
        this.id = KairoBookmarksWidget.ID;
        this.updateTitle();
        this.title.iconClass = 'codicon codicon-bookmark';
        this.title.closable = true;
        this.addClass('kairo-widget');
        this.update();

        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
        this.bookmarkService.onDidChangeBookmarks(() => this.update());
    }

    protected updateTitle(): void {
        this.title.label = this.i18n.t('widget.bookmarks.title');
        this.title.caption = this.i18n.t('widget.bookmarks.caption');
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
            i18n: this.i18n,
            onNavigate: (_bm: Bookmark) => { /* navigation handled by opener */ },
            onRemove: (bm: Bookmark) => this.bookmarkService.removeBookmark(bm.uri, bm.line),
            onClearAll: () => this.bookmarkService.clearAllBookmarks(),
        });
    }

    protected groupByFile(bookmarks: Bookmark[]): BookmarkGroup[] {
        const groupMap = new Map<string, BookmarkGroup>();
        for (const bm of bookmarks) {
            if (!groupMap.has(bm.uri)) {
                const fileName = bm.uri.split('/').pop()?.split('\\').pop() ?? this.i18n.t('widget.bookmarks.unknownFile');
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
