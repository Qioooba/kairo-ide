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

/** Strip string/char literals so `==` / assignments inside strings are ignored. */
function stripStringLiterals(line: string): string {
    let out = '';
    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    for (const ch of line) {
        if (escaped) { escaped = false; out += ' '; continue; }
        if (ch === '\\' && (inSingle || inDouble)) { escaped = true; out += ' '; continue; }
        if (ch === "'" && !inDouble) { inSingle = !inSingle; out += ' '; continue; }
        if (ch === '"' && !inSingle) { inDouble = !inDouble; out += ' '; continue; }
        out += (inSingle || inDouble) ? ' ' : ch;
    }
    return out;
}

// Module-level regexes: re-creating these per call/loop iteration caused
// avoidable allocation churn in a scroll-driven hot path.
const VAR_DECLARATION_RE = /(?:int|long|double|float|boolean|char|byte|short|String|var|final\s+\w+)\s+(\w+)\s*(?:=|;)/g;
const ASSIGNMENT_PATTERN_RE = /(\w+)\s*=(?!=)/g;
const COMPARISON_BEFORE_RE = /[=!<>]/;

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
    /** Bumped on every debug-state transition; keys the variable cache. */
    protected suspendGeneration = 0;
    protected cachedVarMap: Map<string, string> | undefined;
    protected cachedVarMapGeneration = -1;

    initialize(): void {
        this.debugSession.onDidChangeState(state => {
            // Variables for the current frame cannot change while execution
            // stays suspended — cache scopes/variables per suspension.
            this.suspendGeneration++;
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

        const scrollDisposable = editor.onDidScrollChange(() => {
            if (this.debugSession.isSuspended) {
                this.scheduleRefresh(150);
            }
        });

        this.disposables.push(modelChangeDisposable, modelContentChangeDisposable, scrollDisposable);
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

        // Only the visible editor matters for inline decorations; refreshing
        // every open editor turned each scroll tick into N DAP round-trips.
        const activeWidget = this.editorManager.currentEditor;
        if (!activeWidget) return;
        const editor = getMonacoControl(activeWidget);
        if (!editor) return;
        const model = editor.getModel();
        if (!model) return;

        await this.refreshEditor(editor, model);
    }

    /** Lines to scan: visible viewport (±2) plus current stack frame line when known. */
    protected collectScanLines(editor: monaco.editor.ICodeEditor, model: monaco.editor.ITextModel): number[] {
        const lineCount = model.getLineCount();
        const lines = new Set<number>();
        const visible = editor.getVisibleRanges();
        for (const range of visible) {
            const start = Math.max(1, range.startLineNumber - 2);
            const end = Math.min(lineCount, range.endLineNumber + 2);
            for (let n = start; n <= end; n++) lines.add(n);
        }
        const frameLine = this.debugSession.currentSession?.currentFrame?.raw?.line;
        if (typeof frameLine === 'number' && frameLine >= 1 && frameLine <= lineCount) {
            for (let n = Math.max(1, frameLine - 2); n <= Math.min(lineCount, frameLine + 2); n++) {
                lines.add(n);
            }
        }
        // Fallback: if nothing visible yet, scan a small head window instead of full file
        if (lines.size === 0) {
            const end = Math.min(lineCount, 80);
            for (let n = 1; n <= end; n++) lines.add(n);
        }
        return Array.from(lines).sort((a, b) => a - b);
    }

    protected async refreshEditor(editor: monaco.editor.ICodeEditor, model: monaco.editor.ITextModel): Promise<void> {
        let varMap = this.cachedVarMap;
        if (!varMap || this.cachedVarMapGeneration !== this.suspendGeneration) {
            const scopes = await this.debugSession.fetchScopes();
            if (!scopes || scopes.length === 0) return;

            const allVariableRefs = scopes
                .filter(s => s.variablesReference > 0)
                .map(s => s.variablesReference);

            const results = await this.debugSession.batchGetVariables(allVariableRefs);

            varMap = new Map<string, string>();
            for (const r of results) {
                for (const v of r.variables) {
                    varMap.set(v.name, this.formatValue(v));
                }
            }
            this.cachedVarMap = varMap;
            this.cachedVarMapGeneration = this.suspendGeneration;
        }

        const values: InlineValueInfo[] = [];
        const processed = new Set<string>();
        const scanLines = this.collectScanLines(editor, model);

        for (const lineNum of scanLines) {
            const raw = model.getLineContent(lineNum);
            const lineContent = stripStringLiterals(raw).trim();
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
        VAR_DECLARATION_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = VAR_DECLARATION_RE.exec(lineContent)) !== null) {
            if (match[1]) declarations.push(match[1]);
        }
        return declarations;
    }

    protected extractAssignments(lineContent: string): { name: string }[] {
        const assignments: { name: string }[] = [];
        // Match `name =` but not `==`, `!=`, `<=`, `>=`, `===`
        ASSIGNMENT_PATTERN_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = ASSIGNMENT_PATTERN_RE.exec(lineContent)) !== null) {
            const name = match[1];
            if (!name || ['if', 'for', 'while', 'switch', 'return'].includes(name)) continue;
            // Reject when the char immediately before the identifier is a comparison op
            const before = lineContent.slice(Math.max(0, match.index - 1), match.index);
            if (COMPARISON_BEFORE_RE.test(before)) continue;
            assignments.push({ name });
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
        this.cachedVarMap = undefined;
        this.cachedVarMapGeneration = -1;
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
