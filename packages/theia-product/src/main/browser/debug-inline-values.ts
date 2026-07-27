import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import * as monaco from '@theia/monaco-editor-core';
import { KairoDebugSessionService } from './kairo-debug-session-service';
import type { DebugProtocol } from '@vscode/debugprotocol';

function getMonacoControl(widget: EditorWidget): monaco.editor.ICodeEditor | null {
    const editor = widget.editor;
    if (editor instanceof MonacoEditor) {
        return editor.getControl();
    }
    return null;
}

@injectable()
export class KairoDebugInlineValuesService implements FrontendApplicationContribution {
    @inject(EditorManager)
    protected readonly editorManager!: EditorManager;

    @inject(KairoDebugSessionService)
    protected readonly debugSession!: KairoDebugSessionService;

    protected decorations: Map<string, string[]> = new Map();
    protected disposables: monaco.IDisposable[] = [];
    protected currentValues: Map<string, InlineValueInfo[]> = new Map();
    protected refreshTimeout: number | null = null;

    initialize(): void {
        this.debugSession.onDidChangeState(state => {
            if (state.isSuspended) {
                this.scheduleRefresh(300);
            } else {
                this.clearAllDecorations();
            }
        });

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

        if (this.debugSession.isSuspended) {
            this.scheduleRefresh(500);
        }
    }

    protected attachToEditor(editorWidget: EditorWidget): void {
        const editor = getMonacoControl(editorWidget);
        if (!editor) return;

        const model = editor.getModel();
        if (model) {
            this.decorations.set(model.id, []);
        }

        const modelChangeDisposable = editor.onDidChangeModel(() => {
            const newModel = editor.getModel();
            if (newModel) {
                this.decorations.set(newModel.id, []);
            }
        });

        const modelContentChangeDisposable = editor.onDidChangeModelContent(() => {
            if (this.debugSession.isSuspended) {
                this.scheduleRefresh(500);
            }
        });

        this.disposables.push(modelChangeDisposable, modelContentChangeDisposable);
    }

    protected scheduleRefresh(delay: number): void {
        if (this.refreshTimeout) {
            window.clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = window.setTimeout(() => {
            void this.refreshInlineValues();
            this.refreshTimeout = null;
        }, delay);
    }

    protected async refreshInlineValues(): Promise<void> {
        if (!this.debugSession.isSuspended) return;

        const currentEditors = this.editorManager.all;
        for (const editorWidget of currentEditors) {
            const editor = getMonacoControl(editorWidget);
            if (!editor) continue;
            const model = editor.getModel();
            if (!model) continue;

            await this.refreshEditor(editor, model);
        }
    }

    protected async refreshEditor(editor: monaco.editor.ICodeEditor, model: monaco.editor.ITextModel): Promise<void> {
        const scopes = await this.debugSession.fetchScopes();
        if (!scopes || scopes.length === 0) return;

        const allVariableRefs = scopes
            .filter(s => s.variablesReference > 0)
            .map(s => s.variablesReference);

        const results = await this.debugSession.batchGetVariables(allVariableRefs);

        const varMap = new Map<string, string>();
        for (const r of results) {
            for (const v of r.variables) {
                varMap.set(v.name, this.formatValue(v));
            }
        }

        const values: InlineValueInfo[] = [];
        const lineCount = model.getLineCount();
        const processed = new Set<string>();

        for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
            const lineContent = model.getLineContent(lineNum).trim();
            if (!lineContent || lineContent.startsWith('//') || lineContent.startsWith('/*') || lineContent.startsWith('*')) continue;

            const declarations = this.extractDeclarations(lineContent);
            for (const decl of declarations) {
                if (processed.has(`${lineNum}:${decl}`)) continue;
                if (varMap.has(decl)) {
                    processed.add(`${lineNum}:${decl}`);
                    values.push({
                        lineNumber: lineNum,
                        expression: decl,
                        value: varMap.get(decl)!,
                    });
                }
            }

            const assignments = this.extractAssignments(lineContent);
            for (const { name } of assignments) {
                if (processed.has(`${lineNum}:${name}`)) continue;
                if (varMap.has(name)) {
                    processed.add(`${lineNum}:${name}`);
                    values.push({
                        lineNumber: lineNum,
                        expression: name,
                        value: varMap.get(name)!,
                    });
                }
            }
        }

        this.currentValues.set(model.id, values);
        this.applyDecorations(editor, model, values);
    }

    protected extractDeclarations(lineContent: string): string[] {
        const declarations: string[] = [];
        const varPattern = /(?:int|long|double|float|boolean|char|byte|short|String|var|final\s+\w+)\s+(\w+)\s*(?:=|;)/g;
        let match: RegExpExecArray | null;
        while ((match = varPattern.exec(lineContent)) !== null) {
            if (match[1]) declarations.push(match[1]);
        }
        return declarations;
    }

    protected extractAssignments(lineContent: string): { name: string }[] {
        const assignments: { name: string }[] = [];
        const assignPattern = /(\w+)\s*=/g;
        let match: RegExpExecArray | null;
        while ((match = assignPattern.exec(lineContent)) !== null) {
            if (match[1] && !['if', 'for', 'while', 'switch', 'return'].includes(match[1])) {
                assignments.push({ name: match[1] });
            }
        }
        return assignments;
    }

    protected formatValue(v: DebugProtocol.Variable): string {
        if (v.type === 'boolean') return v.value;
        if (v.type === 'int' || v.type === 'long' || v.type === 'double' || v.type === 'float' ||
            v.type === 'byte' || v.type === 'short' || v.type === 'char') {
            return v.value;
        }
        if (v.value === 'null') return 'null';
        if (v.variablesReference > 0 && v.value?.startsWith('{')) {
            return v.value.length > 60 ? v.value.substring(0, 57) + '…}' : v.value;
        }
        return v.value ?? '';
    }

    protected applyDecorations(editor: monaco.editor.ICodeEditor, model: monaco.editor.ITextModel, values: InlineValueInfo[]): void {
        const existingIds = this.decorations.get(model.id) ?? [];

        const newDecorations = values.map(v => ({
            range: new monaco.Range(v.lineNumber, 1, v.lineNumber, 1),
            options: {
                isWholeLine: false,
                after: {
                    content: `  ${v.expression}: ${v.value}`,
                    inlineClassName: 'kairo-debug-inline-value',
                },
                showIfCollapsed: false,
                zIndex: 10,
            },
        }));

        const newIds = editor.deltaDecorations(existingIds, newDecorations);
        this.decorations.set(model.id, newIds);
    }

    protected clearAllDecorations(): void {
        for (const [modelId, ids] of this.decorations.entries()) {
            for (const editorWidget of this.editorManager.all) {
                const editor = getMonacoControl(editorWidget);
                if (!editor) continue;
                const model = editor.getModel();
                if (model?.id === modelId) {
                    editor.deltaDecorations(ids, []);
                }
            }
        }
        this.decorations.clear();
        this.currentValues.clear();
    }

    stop(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.clearAllDecorations();
    }
}

interface InlineValueInfo {
    lineNumber: number;
    expression: string;
    value: string;
}
