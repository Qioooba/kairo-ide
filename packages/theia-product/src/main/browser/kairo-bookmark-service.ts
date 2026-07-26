/**
 * Kairo Bookmark Service — manages per-file bookmarks with Monaco editor decorations.
 *
 * Supports:
 *   - F11 toggle unnamed bookmarks at cursor
 *   - Ctrl+0..9 jump to numbered bookmark
 *   - Ctrl+Shift+0..9 set numbered bookmark
 *   - Bookmarks persist in Monaco editor model decorations
 *   - Gutter icons like breakpoints
 *   - Bookmark list navigation
 */

import { injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import * as monaco from '@theia/monaco-editor-core';

export interface Bookmark {
    uri: string;
    line: number;
    number?: number;
}

const BOOKMARK_GLYPH_CLASS = 'kairo-bookmark-glyph';
const BOOKMARK_GLYPH_CLASS_NUMBERED = 'kairo-bookmark-glyph-numbered';
const _BOOKMARK_DECORATION_KEY = 'kairo-bookmarks';

@injectable()
export class BookmarkService {
    protected bookmarks: Map<string, Map<number, number | undefined>> = new Map();
    protected decorationIds: Map<string, string[]> = new Map();

    protected readonly onDidChangeBookmarksEmitter = new Emitter<void>();
    readonly onDidChangeBookmarks: Event<void> = this.onDidChangeBookmarksEmitter.event;

    toggleBookmark(uri: string, line: number, number?: number): void {
        if (!this.bookmarks.has(uri)) {
            this.bookmarks.set(uri, new Map());
        }
        const fileBookmarks = this.bookmarks.get(uri)!;

        if (number !== undefined) {
            for (const [existingLine, existingNum] of fileBookmarks) {
                if (existingNum === number) {
                    fileBookmarks.delete(existingLine);
                    break;
                }
            }
        }

        const existingNumber = fileBookmarks.get(line);
        if (existingNumber === number) {
            fileBookmarks.delete(line);
        } else {
            fileBookmarks.set(line, number);
        }

        this.applyDecorations(uri);
        this.onDidChangeBookmarksEmitter.fire();
    }

    gotoBookmark(number: number): Bookmark | undefined {
        for (const [uri, lines] of this.bookmarks) {
            for (const [line, num] of lines) {
                if (num === number) {
                    return { uri, line, number };
                }
            }
        }
        return undefined;
    }

    clearAllBookmarks(): void {
        for (const uri of this.bookmarks.keys()) {
            this.clearEditorDecorations(uri);
        }
        this.bookmarks.clear();
        this.decorationIds.clear();
        this.onDidChangeBookmarksEmitter.fire();
    }

    removeBookmark(uri: string, line: number): void {
        const fileBookmarks = this.bookmarks.get(uri);
        if (fileBookmarks) {
            fileBookmarks.delete(line);
            if (fileBookmarks.size === 0) {
                this.bookmarks.delete(uri);
            }
            this.applyDecorations(uri);
            this.onDidChangeBookmarksEmitter.fire();
        }
    }

    getBookmarks(): Bookmark[] {
        const result: Bookmark[] = [];
        for (const [uri, lines] of this.bookmarks) {
            for (const [line, number] of lines) {
                result.push({ uri, line, number });
            }
        }
        return result;
    }

    getBookmarksForFile(uri: string): Bookmark[] {
        const result: Bookmark[] = [];
        const fileBookmarks = this.bookmarks.get(uri);
        if (fileBookmarks) {
            for (const [line, number] of fileBookmarks) {
                result.push({ uri, line, number });
            }
        }
        return result.sort((a, b) => a.line - b.line);
    }

    applyDecorations(uri: string): void {
        const model = monaco.editor.getModel(monaco.Uri.parse(uri));
        if (!model) return;

        const editor = this.findEditorForModel(model);
        if (!editor) return;

        const fileBookmarks = this.bookmarks.get(uri);
        const oldIds = this.decorationIds.get(uri) || [];

        if (!fileBookmarks || fileBookmarks.size === 0) {
            editor.deltaDecorations(oldIds, []);
            this.decorationIds.delete(uri);
            return;
        }

        const newDecorations: monaco.editor.IModelDeltaDecoration[] = [];
        for (const [line, number] of fileBookmarks) {
            const isNumbered = number !== undefined;
            const glyphClass = isNumbered ? BOOKMARK_GLYPH_CLASS_NUMBERED : BOOKMARK_GLYPH_CLASS;
            newDecorations.push({
                range: new monaco.Range(line, 1, line, 1),
                options: {
                    isWholeLine: false,
                    glyphMarginClassName: glyphClass,
                    glyphMarginHoverMessage: {
                        value: isNumbered ? `Bookmark ${number}` : 'Bookmark',
                    },
                    overviewRuler: {
                        color: isNumbered ? '#ffc107' : '#4fc3f7',
                        position: monaco.editor.OverviewRulerLane.Left,
                    },
                },
            });
        }

        const newIds = editor.deltaDecorations(oldIds, newDecorations);
        this.decorationIds.set(uri, newIds);
    }

    restoreDecorationsForEditor(editor: monaco.editor.IStandaloneCodeEditor): void {
        const model = editor.getModel();
        if (!model) return;
        const uri = model.uri.toString();
        this.applyDecorations(uri);
    }

    protected clearEditorDecorations(uri: string): void {
        const model = monaco.editor.getModel(monaco.Uri.parse(uri));
        if (!model) return;

        const editor = this.findEditorForModel(model);
        if (editor) {
            const oldIds = this.decorationIds.get(uri) || [];
            editor.deltaDecorations(oldIds, []);
        }
        this.decorationIds.delete(uri);
    }

    protected findEditorForModel(model: monaco.editor.ITextModel): monaco.editor.IStandaloneCodeEditor | undefined {
        for (const editor of monaco.editor.getEditors()) {
            if (editor.getModel() === model) {
                return editor as monaco.editor.IStandaloneCodeEditor;
            }
        }
        return undefined;
    }
}
