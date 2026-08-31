import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import * as monaco from '@theia/monaco-editor-core';
import { WorkspaceContextService } from '@kairo/runtime-extension';
import { KairoDebugSessionService } from './kairo-debug-session-service';
import { createDebugHoverWidget, type DebugHoverWidgetInstance, type HoverValueResult } from './debug-hover-widget';
import { persistDebugWatch } from './debug-watches-idea';

const IDENTIFIER_RE = /[a-zA-Z_$][a-zA-Z0-9_$.\[\]]*/;

function getMonacoControl(widget: EditorWidget): monaco.editor.ICodeEditor | null {
    const editor = widget.editor;
    if (editor instanceof MonacoEditor) {
        return editor.getControl();
    }
    return null;
}

@injectable()
export class KairoDebugHoverProvider implements FrontendApplicationContribution {
    @inject(EditorManager)
    protected readonly editorManager!: EditorManager;

    @inject(KairoDebugSessionService)
    protected readonly debugSession!: KairoDebugSessionService;

    @inject(WorkspaceContextService)
    protected readonly workspaceContext!: WorkspaceContextService;

    protected currentWidget: DebugHoverWidgetInstance | null = null;
    protected currentWidgetEditor: monaco.editor.ICodeEditor | null = null;
    protected disposables: monaco.IDisposable[] = [];
    protected evaluationPromise: Promise<void> | null = null;

    protected lastHoverWord: string | null = null;
    protected lastHoverPosition: { lineNumber: number; column: number } | null = null;

    initialize(): void {
        this.start();
    }

    start(): void {
        this.disposables.push(
            this.editorManager.onCreated((editorWidget: EditorWidget) => {
                this.attachToEditor(editorWidget);
            }),
        );

        const currentEditors = this.editorManager.all;
        for (const editorWidget of currentEditors) {
            this.attachToEditor(editorWidget);
        }
    }

    protected attachToEditor(editorWidget: EditorWidget): void {
        const editor = getMonacoControl(editorWidget);
        if (!editor) return;

        const mouseMoveDisposable = editor.onMouseMove((e: monaco.editor.IEditorMouseEvent) => this.onMouseMove(editor, e));
        const mouseLeaveDisposable = editor.onMouseLeave(() => this.hideWidget());
        const mouseDownDisposable = editor.onMouseDown(() => this.hideWidget());
        const didChangeModelDisposable = editor.onDidChangeModel(() => this.hideWidget());
        const scrollDisposable = editor.onDidScrollChange(() => this.hideWidget());

        this.disposables.push(mouseMoveDisposable, mouseLeaveDisposable, mouseDownDisposable, didChangeModelDisposable, scrollDisposable);
    }

    protected onMouseMove(editor: monaco.editor.ICodeEditor, e: monaco.editor.IEditorMouseEvent): void {
        if (!this.debugSession.isSuspended) {
            this.hideWidget();
            return;
        }

        if (!e.target.position) return;

        if (e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT &&
            e.target.type !== monaco.editor.MouseTargetType.CONTENT_EMPTY) {
            this.hideWidget();
            return;
        }

        const position = e.target.position;
        const word = this.getWordAtPosition(editor, position);

        if (!word) {
            this.hideWidget();
            return;
        }

        if (this.lastHoverWord === word.word &&
            this.lastHoverPosition?.lineNumber === position.lineNumber &&
            Math.abs(this.lastHoverPosition.column - position.column) <= 1) {
            return;
        }

        this.lastHoverWord = word.word;
        this.lastHoverPosition = { lineNumber: position.lineNumber, column: position.column };

        void this.evaluateAndShow(editor, position, word.word);
    }

    protected getWordAtPosition(editor: monaco.editor.ICodeEditor, position: monaco.Position): { word: string; startColumn: number; endColumn: number } | null {
        const model = editor.getModel();
        if (!model) return null;

        const wordAtPos = model.getWordAtPosition(position);
        if (!wordAtPos) return null;

        const lineContent = model.getLineContent(position.lineNumber);
        let startCol = wordAtPos.startColumn;
        const endCol = wordAtPos.endColumn;

        while (startCol > 1) {
            const prevChar = lineContent.charAt(startCol - 2);
            if (prevChar === '.') {
                startCol--;
                while (startCol > 1 && /[a-zA-Z0-9_$]/.test(lineContent.charAt(startCol - 2))) {
                    startCol--;
                }
            } else if (prevChar === ']') {
                let depth = 1;
                let scan = startCol - 2;
                while (scan >= 0 && depth > 0) {
                    if (lineContent.charAt(scan) === ']') depth++;
                    if (lineContent.charAt(scan) === '[') depth--;
                    scan--;
                }
                if (depth === 0 && scan >= 0 && lineContent.charAt(scan) === '.') {
                    startCol = scan + 1;
                    while (startCol > 1 && /[a-zA-Z0-9_$]/.test(lineContent.charAt(startCol - 2))) {
                        startCol--;
                    }
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        const fullWord = lineContent.substring(startCol - 1, endCol - 1).trim();
        if (!fullWord || !IDENTIFIER_RE.test(fullWord)) return null;

        const javaKeywords = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
            'continue', 'return', 'try', 'catch', 'finally', 'throw', 'throws', 'new', 'class',
            'interface', 'extends', 'implements', 'import', 'package', 'public', 'private',
            'protected', 'static', 'final', 'void', 'boolean', 'int', 'long', 'double', 'float',
            'char', 'byte', 'short', 'true', 'false', 'null', 'this', 'super', 'instanceof']);
        if (javaKeywords.has(fullWord) && !fullWord.includes('.')) return null;

        return { word: fullWord, startColumn: startCol, endColumn: endCol };
    }

    protected async evaluateAndShow(editor: monaco.editor.ICodeEditor, position: monaco.Position, expression: string): Promise<void> {
        if (this.evaluationPromise) return;

        this.evaluationPromise = (async () => {
            try {
                const result = await this.debugSession.evaluate(expression, undefined, 'hover');

                if (this.lastHoverWord !== expression) return;

                const hoverResult: HoverValueResult = {
                    expression,
                    result: result.result,
                    type: result.type,
                    variablesReference: result.variablesReference,
                    error: result.error,
                };

                this.showWidget(editor, position, hoverResult);
            } catch {
                // ignore
            } finally {
                this.evaluationPromise = null;
            }
        })();
    }

    protected showWidget(editor: monaco.editor.ICodeEditor, position: monaco.Position, result: HoverValueResult): void {
        if (!this.currentWidget || this.currentWidgetEditor !== editor) {
            this.currentWidget?.dispose();
            this.currentWidget = createDebugHoverWidget(
                editor,
                this.debugSession,
                (expr: string) => {
                    persistDebugWatch(expr, this.workspaceContext.context?.workspaceId);
                },
            );
            this.currentWidgetEditor = editor;
        }

        this.currentWidget.show(
            { lineNumber: position.lineNumber, column: position.column },
            result,
        );
    }

    protected hideWidget(): void {
        this.lastHoverWord = null;
        this.lastHoverPosition = null;
        if (this.currentWidget) {
            this.currentWidget.hide();
        }
    }

    stop(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        if (this.currentWidget) {
            this.currentWidget.dispose();
            this.currentWidget = null;
            this.currentWidgetEditor = null;
        }
    }
}
