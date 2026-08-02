/**
 * Kairo Bookmark Contribution — registers commands, keybindings,
 * and editor gutter decorations for bookmarks.
 *
 * Keybindings:
 *   - F11: toggle unnamed bookmark at cursor
 *   - Ctrl+0..9: jump to numbered bookmark
 *   - Ctrl+Shift+0..9: set numbered bookmark
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { FrontendApplicationContribution, ApplicationShell } from '@theia/core/lib/browser';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { MessageService } from '@theia/core/lib/common/message-service';
import URI from '@theia/core/lib/common/uri';
import * as monaco from '@theia/monaco-editor-core';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { BookmarkService } from './kairo-bookmark-service';
import { KAIRO_BOOKMARKS_FACTORY_ID } from './kairo-bookmark-widget';

export namespace KairoBookmarkCommands {
    export const TOGGLE: Command = {
        id: 'kairo.bookmark.toggle',
        label: 'Kairo: Toggle Bookmark',
    };
    export const LIST: Command = {
        id: 'kairo.bookmark.list',
        label: 'Kairo: Show Bookmarks',
    };
    /** Alias for IDEA keymap Shift+F11 (`kairo.bookmark.show`). */
    export const SHOW: Command = {
        id: 'kairo.bookmark.show',
        label: 'Kairo: Show Bookmarks',
    };
    export const TOGGLE_MNEMONIC: Command = {
        id: 'kairo.bookmark.toggleMnemonic',
        label: 'Kairo: Toggle Mnemonic Bookmark',
    };
    export const CLEAR: Command = {
        id: 'kairo.bookmark.clear',
        label: 'Kairo: Clear All Bookmarks',
    };
    export const GOTO_0: Command = { id: 'kairo.bookmark.goto.0', label: 'Kairo: Go to Bookmark 0' };
    export const GOTO_1: Command = { id: 'kairo.bookmark.goto.1', label: 'Kairo: Go to Bookmark 1' };
    export const GOTO_2: Command = { id: 'kairo.bookmark.goto.2', label: 'Kairo: Go to Bookmark 2' };
    export const GOTO_3: Command = { id: 'kairo.bookmark.goto.3', label: 'Kairo: Go to Bookmark 3' };
    export const GOTO_4: Command = { id: 'kairo.bookmark.goto.4', label: 'Kairo: Go to Bookmark 4' };
    export const GOTO_5: Command = { id: 'kairo.bookmark.goto.5', label: 'Kairo: Go to Bookmark 5' };
    export const GOTO_6: Command = { id: 'kairo.bookmark.goto.6', label: 'Kairo: Go to Bookmark 6' };
    export const GOTO_7: Command = { id: 'kairo.bookmark.goto.7', label: 'Kairo: Go to Bookmark 7' };
    export const GOTO_8: Command = { id: 'kairo.bookmark.goto.8', label: 'Kairo: Go to Bookmark 8' };
    export const GOTO_9: Command = { id: 'kairo.bookmark.goto.9', label: 'Kairo: Go to Bookmark 9' };
    export const SET_0: Command = { id: 'kairo.bookmark.set.0', label: 'Kairo: Set Bookmark 0' };
    export const SET_1: Command = { id: 'kairo.bookmark.set.1', label: 'Kairo: Set Bookmark 1' };
    export const SET_2: Command = { id: 'kairo.bookmark.set.2', label: 'Kairo: Set Bookmark 2' };
    export const SET_3: Command = { id: 'kairo.bookmark.set.3', label: 'Kairo: Set Bookmark 3' };
    export const SET_4: Command = { id: 'kairo.bookmark.set.4', label: 'Kairo: Set Bookmark 4' };
    export const SET_5: Command = { id: 'kairo.bookmark.set.5', label: 'Kairo: Set Bookmark 5' };
    export const SET_6: Command = { id: 'kairo.bookmark.set.6', label: 'Kairo: Set Bookmark 6' };
    export const SET_7: Command = { id: 'kairo.bookmark.set.7', label: 'Kairo: Set Bookmark 7' };
    export const SET_8: Command = { id: 'kairo.bookmark.set.8', label: 'Kairo: Set Bookmark 8' };
    export const SET_9: Command = { id: 'kairo.bookmark.set.9', label: 'Kairo: Set Bookmark 9' };
}

const BOOKMARK_CSS = `
.monaco-editor .kairo-bookmark-glyph {
    width: 14px !important;
    height: 14px !important;
    margin-left: 3px;
    cursor: pointer;
    background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><path d="M3 1v12l4-3 4 3V1H3z" fill="%234fc3f7"/></svg>') center center no-repeat;
}
.monaco-editor .kairo-bookmark-glyph-numbered {
    width: 14px !important;
    height: 14px !important;
    margin-left: 3px;
    cursor: pointer;
    background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><path d="M3 1v12l4-3 4 3V1H3z" fill="%23ffc107"/></svg>') center center no-repeat;
}
`;

@injectable()
export class KairoBookmarkContribution implements FrontendApplicationContribution, CommandContribution, KeybindingContribution {
    @inject(BookmarkService)
    protected readonly bookmarkService!: BookmarkService;

    @inject(EditorManager)
    protected readonly editorManager!: EditorManager;

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    protected readonly toDispose = new DisposableCollection();

    @postConstruct()
    protected init(): void {
        this.injectCss();
    }

    onStart(): void {
        for (const editor of monaco.editor.getEditors()) {
            this.attachEditor(editor as monaco.editor.IStandaloneCodeEditor);
        }
        this.toDispose.push(
            monaco.editor.onDidCreateEditor(editor => {
                this.attachEditor(editor as monaco.editor.IStandaloneCodeEditor);
            }),
        );
        this.toDispose.push(
            this.editorManager.onCurrentEditorChanged(widget => {
                if (widget) {
                    this.restoreForWidget(widget);
                }
            }),
        );
    }

    protected attachEditor(editor: monaco.editor.IStandaloneCodeEditor): void {
        const model = editor.getModel();
        if (model) {
            this.bookmarkService.restoreDecorationsForEditor(editor);
        }
    }

    protected restoreForWidget(widget: EditorWidget): void {
        const editor = widget.editor;
        if (editor instanceof MonacoEditor) {
            const control = editor.getControl();
            if (control) {
                this.bookmarkService.restoreDecorationsForEditor(control);
            }
        }
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(KairoBookmarkCommands.TOGGLE, {
            execute: () => this.toggleBookmark(),
            isEnabled: () => this.hasActiveEditor(),
        });
        registry.registerCommand(KairoBookmarkCommands.LIST, {
            execute: () => this.showBookmarkList(),
        });
        registry.registerCommand(KairoBookmarkCommands.SHOW, {
            execute: () => this.showBookmarkList(),
        });
        registry.registerCommand(KairoBookmarkCommands.TOGGLE_MNEMONIC, {
            execute: async () => {
                // Mnemonic: set numbered bookmark 1 at caret (IDEA Ctrl+F11 approx).
                await this.setNumberedBookmark(1);
            },
            isEnabled: () => this.hasActiveEditor(),
        });
        registry.registerCommand(KairoBookmarkCommands.CLEAR, {
            execute: () => this.bookmarkService.clearAllBookmarks(),
        });

        for (let i = 0; i <= 9; i++) {
            const num = i;
            const gotoCmd = (KairoBookmarkCommands as any)[`GOTO_${i}`];
            const setCmd = (KairoBookmarkCommands as any)[`SET_${i}`];

            registry.registerCommand(gotoCmd, {
                execute: () => this.gotoBookmark(num),
            });
            registry.registerCommand(setCmd, {
                execute: () => this.setNumberedBookmark(num),
                isEnabled: () => this.hasActiveEditor(),
            });
        }
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: KairoBookmarkCommands.TOGGLE.id,
            keybinding: 'f11',
        });

        for (let i = 0; i <= 9; i++) {
            const gotoCmd = (KairoBookmarkCommands as any)[`GOTO_${i}`];
            const setCmd = (KairoBookmarkCommands as any)[`SET_${i}`];

            keybindings.registerKeybinding({
                command: gotoCmd.id,
                keybinding: `ctrl+${i}`,
            });
            keybindings.registerKeybinding({
                command: setCmd.id,
                keybinding: `ctrl+shift+${i}`,
            });
        }
    }

    protected hasActiveEditor(): boolean {
        return this.editorManager.currentEditor !== undefined;
    }

    protected getCurrentEditorAndPosition(): { uri: string; line: number } | undefined {
        const widget = this.editorManager.currentEditor;
        if (!widget) return undefined;
        const editor = widget.editor;
        if (!(editor instanceof MonacoEditor)) return undefined;
        const cursor = editor.cursor;
        if (!cursor) return undefined;
        return {
            uri: editor.uri.toString(),
            line: cursor.line + 1,
        };
    }

    protected toggleBookmark(): void {
        const pos = this.getCurrentEditorAndPosition();
        if (!pos) {
            this.messages.warn('No active editor.');
            return;
        }
        this.bookmarkService.toggleBookmark(pos.uri, pos.line);
    }

    protected setNumberedBookmark(num: number): void {
        const pos = this.getCurrentEditorAndPosition();
        if (!pos) {
            this.messages.warn('No active editor.');
            return;
        }
        this.bookmarkService.toggleBookmark(pos.uri, pos.line, num);
    }

    protected async gotoBookmark(num: number): Promise<void> {
        const bookmark = this.bookmarkService.gotoBookmark(num);
        if (!bookmark) {
            this.messages.info(`No bookmark ${num} set.`);
            return;
        }
        try {
            const uri = new URI(bookmark.uri);
            const widget = await this.editorManager.open(uri, {
                mode: 'activate',
                selection: {
                    start: { line: bookmark.line - 1, character: 0 },
                    end: { line: bookmark.line - 1, character: 0 },
                },
            });
            if (widget instanceof EditorWidget) {
                const editor = widget.editor;
                if (editor instanceof MonacoEditor) {
                    const control = editor.getControl();
                    control.revealLineInCenter(bookmark.line);
                    control.focus();
                }
            }
        } catch {
            this.messages.warn(`Could not navigate to bookmark ${num}.`);
        }
    }

    protected async showBookmarkList(): Promise<void> {
        try {
            const widget = await this.widgetManager.getOrCreateWidget(KAIRO_BOOKMARKS_FACTORY_ID);
            try {
                this.shell.addWidget(widget, { area: 'left' });
            } catch {
                // Already attached
            }
            this.shell.activateWidget(widget.id);
            widget.update();
        } catch {
            // Silently ignore
        }
    }

    protected injectCss(): void {
        const styleId = 'kairo-bookmark-styles';
        if (document.getElementById(styleId)) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = BOOKMARK_CSS;
        document.head.appendChild(style);
    }
}
