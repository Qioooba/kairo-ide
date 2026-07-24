/**
 * Java override/implementation gutter — §7.3 P2-JAVA
 *
 * Adds gutter icons (left margin) showing:
 *   - ⬆️ Override marker: method overrides a superclass/interface method
 *   - ⬇️ Implementation marker: method is implemented by subclasses
 *
 * Uses Monaco's `deltaDecorations` API for non-blocking gutter updates.
 * Queries JDT LS for override/implementation information via the Java
 * LanguageClient. Caches results per file session.
 *
 * Click on gutter icon navigates to parent/child.
 *
 * Performance: gutter updates must not block editor input.
 */

import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { ILogger } from '@theia/core/lib/common/logger';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { JavaLanguageClient } from './java-language-client';
import type { LSPLocation as _LSPLocation } from '../common/lsp-protocol';

/** Gutter decoration CSS class names. */
const OVERRIDE_CLASS = 'kairo-gutter-override';
const IMPLEMENTATION_CLASS = 'kairo-gutter-implementation';

/** Maximum number of concurrent decoration updates. */
const MAX_CONCURRENT_UPDATES = 3;

/** Decoration update debounce in ms. */
const DEBOUNCE_MS = 300;

/** Gutter glyph margin class name. */
const GLYPH_MARGIN_CLASS = 'kairo-gutter-glyph';

/** Interface for decoration cache entries. */
interface GutterDecoration {
  lineNumber: number;
  type: 'override' | 'implementation';
  targetUri: string;
  targetRange: { line: number; character: number };
}

/** Cache entry per file URI. */
interface FileGutterCache {
  decorations: GutterDecoration[];
  timestamp: number;
  version: number;
}

/** CSS styles for the gutter glyphs. */
const GUTTER_CSS = `
.monaco-editor .${GLYPH_MARGIN_CLASS} {
  width: 16px !important;
  margin-left: 3px;
  cursor: pointer;
}
.monaco-editor .${OVERRIDE_CLASS} {
  background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><text x="0" y="12" font-size="12" fill="%235698cd">⬆</text></svg>') center center no-repeat;
  width: 14px !important;
  height: 14px !important;
}
.monaco-editor .${IMPLEMENTATION_CLASS} {
  background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><text x="0" y="12" font-size="12" fill="%235698cd">⬇</text></svg>') center center no-repeat;
  width: 14px !important;
  height: 14px !important;
}
`;

/**
 * Java Override/Implementation Gutter provider.
 *
 * Adds gutter icons in the left margin of Java editors showing
 * methods that override or are implemented by subclasses.
 */
@injectable()
export class JavaOverrideGutter implements FrontendApplicationContribution, Disposable {
  @inject(JavaLanguageClient)
  protected readonly languageClient!: JavaLanguageClient;

  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  @inject(ILogger)
  protected readonly logger!: ILogger;

  /** Cache: file URI → gutter decorations. */
  protected cache: Map<string, FileGutterCache> = new Map();

  /** Active decoration IDs per editor model. */
  protected decorationIds: Map<string, string[]> = new Map();

  /** Pending update timers per editor model. */
  protected pendingTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Per-model content-change disposables. */
  protected modelSubs: Map<string, Disposable> = new Map();

  /** Currently running update count. */
  protected runningUpdates = 0;

  protected subs = new DisposableCollection();

  @postConstruct()
  protected init(): void {
    this.logger.info('[JavaOverrideGutter] 初始化完成');
    this.injectCss();
  }

  onStart(): void {
    // Listen to editor changes and schedule gutter updates
    this.subs.push(
      this.editorManager.onCurrentEditorChanged(() => this.scheduleGutterUpdate()),
    );
    // Attach content-change listeners to existing and future models
    for (const model of monaco.editor.getModels()) {
      this.attachModel(model);
    }
    this.subs.push(
      monaco.editor.onDidCreateModel(model => this.attachModel(model)),
    );
  }

  protected attachModel(model: monaco.editor.ITextModel): void {
    const uri = model.uri.toString();
    const sub = model.onDidChangeContent(() => this.scheduleGutterUpdate());
    this.modelSubs.set(uri, sub);
    this.subs.push(
      model.onWillDispose(() => {
        const d = this.modelSubs.get(uri);
        if (d) {
          d.dispose();
          this.modelSubs.delete(uri);
        }
      }),
    );
  }

  dispose(): void {
    this.subs.dispose();
    for (const d of this.modelSubs.values()) {
      d.dispose();
    }
    this.modelSubs.clear();
    this.clearAllTimers();
    this.clearAllDecorations();
    this.cache.clear();
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Manually trigger a gutter update for the current editor.
   */
  async refresh(): Promise<void> {
    await this.updateGutterDecorations();
  }

  /**
   * Clear the cache for a specific file or all files.
   */
  clearCache(fileUri?: string): void {
    if (fileUri) {
      this.cache.delete(fileUri);
    } else {
      this.cache.clear();
    }
  }

  // ── Gutter update ─────────────────────────────────────────────

  /**
   * Schedule a gutter update with debouncing.
   */
  protected scheduleGutterUpdate(): void {
    const editor = this.getCurrentMonacoEditor();
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

    const uri = model.uri.toString();

    // Clear existing timer
    const existing = this.pendingTimers.get(uri);
    if (existing) {
      clearTimeout(existing);
    }

    // Schedule new update
    this.pendingTimers.set(uri, setTimeout(() => {
      this.pendingTimers.delete(uri);
      this.updateGutterDecorations().catch(err => {
        this.logger.warn(`[JavaOverrideGutter] 更新失败: ${String(err)}`);
      });
    }, DEBOUNCE_MS));
  }

  /**
   * Update gutter decorations for the current editor.
   * Does not block editor input — runs asynchronously.
   */
  protected async updateGutterDecorations(): Promise<void> {
    if (this.runningUpdates >= MAX_CONCURRENT_UPDATES) {
      return; // Skip if too many concurrent updates
    }

    const editor = this.getCurrentMonacoEditor();
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

    const uri = model.uri.toString();

    // Only process Java files
    if (!uri.endsWith('.java')) return;

    this.runningUpdates++;

    try {
      // Check cache
      const cached = this.cache.get(uri);
      const version = model.getVersionId();
      if (cached && cached.version === version) {
        this.applyDecorations(editor, cached.decorations);
        return;
      }

      // Query JDT LS for override/implementation information
      const decorations = await this.queryGutterDecorations(model, uri, version);

      // Cache the result
      this.cache.set(uri, {
        decorations,
        timestamp: Date.now(),
        version,
      });

      // Apply decorations
      this.applyDecorations(editor, decorations);
    } catch (err) {
      this.logger.debug(`[JavaOverrideGutter] 查询失败: ${String(err)}`);
    } finally {
      this.runningUpdates--;
    }
  }

  /**
   * Query JDT LS for methods with override/implementation information.
   * Uses the textDocument/documentSymbol to find methods, then
   * queries textDocument/implementation for each method.
   */
  protected async queryGutterDecorations(
    model: monaco.editor.ITextModel,
    uri: string,
    _version: number,
  ): Promise<GutterDecoration[]> {
    const decorations: GutterDecoration[] = [];
    const text = model.getValue();
    const lines = text.split('\n');

    // Find all method declarations (simple heuristic: lines matching
    // Java method signature patterns ending with {)
    // We also use the LSP implementation endpoint on each method
    const methodLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (isJavaMethodDeclaration(line)) {
        methodLines.push(i); // 0-based
      }
    }

    // Query JDT LS for each method's implementation/override status
    // Process in batches to avoid overwhelming the LS
    for (const line of methodLines) {
      try {
        const result = await this.languageClient.implementation({
          uri,
          line,
          character: 0,
        });

        if (result) {
          const locations = Array.isArray(result) ? result : [result];
          for (const loc of locations) {
            if (loc.uri !== uri) {
              // This method has implementations in other files
              decorations.push({
                lineNumber: line + 1, // 1-based
                type: 'implementation',
                targetUri: loc.uri,
                targetRange: {
                  line: loc.range.start.line,
                  character: loc.range.start.character,
                },
              });
            } else if (loc.range.start.line !== line) {
              // This method is itself an override (found in same file at different line)
              decorations.push({
                lineNumber: line + 1,
                type: 'override',
                targetUri: loc.uri,
                targetRange: {
                  line: loc.range.start.line,
                  character: loc.range.start.character,
                },
              });
            }
          }
        }
      } catch {
        // Skip methods that fail to query
      }
    }

    return decorations;
  }

  /**
   * Apply gutter decorations to the editor using deltaDecorations.
   */
  protected applyDecorations(
    editor: monaco.editor.IStandaloneCodeEditor,
    decorations: GutterDecoration[],
  ): void {
    const model = editor.getModel();
    if (!model) return;

    const uri = model.uri.toString();

    const newDecorations: monaco.editor.IModelDeltaDecoration[] = decorations.map(d => ({
      range: new monaco.Range(d.lineNumber, 1, d.lineNumber, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: d.type === 'override' ? OVERRIDE_CLASS : IMPLEMENTATION_CLASS,
        glyphMarginHoverMessage: {
          value: d.type === 'override'
            ? `**⬆ 重写方法** — 点击跳转到父类定义`
            : `**⬇ 被子类实现** — 点击跳转到子类实现`,
        },
        overviewRuler: {
          color: d.type === 'override' ? '#5698cd' : '#16825d',
          position: monaco.editor.OverviewRulerLane.Left,
        },
      },
    }));

    const oldIds = this.decorationIds.get(uri) || [];
    const newIds = editor.deltaDecorations(oldIds, newDecorations);
    this.decorationIds.set(uri, newIds);
  }

  // ── Mouse click handler ───────────────────────────────────────

  /**
   * Handle click on a gutter glyph to navigate to the target.
   */
  handleGutterClick(e: monaco.editor.IEditorMouseEvent): void {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;

    const editor = this.getCurrentMonacoEditor();
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

    const uri = model.uri.toString();
    const cached = this.cache.get(uri);
    if (!cached) return;

    const lineNumber = e.target.position?.lineNumber;
    if (!lineNumber) return;

    // Find the decoration at this line
    const decoration = cached.decorations.find(d => d.lineNumber === lineNumber);
    if (!decoration) return;

    // Navigate to the target
    this.editorManager.open(new URI(decoration.targetUri), {
      mode: 'activate',
      selection: {
        start: {
          line: decoration.targetRange.line,
          character: decoration.targetRange.character,
        },
        end: {
          line: decoration.targetRange.line,
          character: decoration.targetRange.character,
        },
      },
      revealOption: 'centerIfOutsideViewport',
    }).catch(err => {
      this.logger.warn(`[JavaOverrideGutter] 导航失败: ${String(err)}`);
    });
  }

  // ── Helpers ───────────────────────────────────────────────────

  protected getCurrentMonacoEditor(): monaco.editor.IStandaloneCodeEditor | undefined {
    const editorWidget = this.editorManager.currentEditor;
    if (!editorWidget) return undefined;
    return (editorWidget.editor as MonacoEditor).getControl?.() as monaco.editor.IStandaloneCodeEditor | undefined;
  }

  protected clearAllTimers(): void {
    const timers = Array.from(this.pendingTimers.values());
    for (const timer of timers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }

  protected clearAllDecorations(): void {
    for (const [uri, ids] of Array.from(this.decorationIds)) {
      try {
        const model = monaco.editor.getModel(monaco.Uri.parse(uri));
        if (model) {
          const editor = this.getCurrentMonacoEditor();
          if (editor) {
            editor.deltaDecorations(ids, []);
          }
        }
      } catch {
        // Ignore
      }
    }
    this.decorationIds.clear();
  }

  protected injectCss(): void {
    const styleId = 'kairo-override-gutter-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = GUTTER_CSS;
    document.head.appendChild(style);
  }
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Heuristic: check if a line looks like a Java method declaration.
 * Matches: visibility? (static? (final? | abstract?))? returnType methodName(...)
 */
function isJavaMethodDeclaration(line: string): boolean {
  // Skip annotations, comments, empty lines
  if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.startsWith('@')) {
    return false;
  }
  // Must contain parentheses and end with { or ;
  if (!/\(.*\)\s*(\{|;)/.test(line)) return false;
  // Must not be a class/interface/enum declaration
  if (/\b(class|interface|enum)\s+\w+/.test(line)) return false;
  // Must look like a method: contains a type and a name before (
  return /[\w<>[\],\s]+\s+\w+\s*\(/.test(line);
}