import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { MenuModelRegistry } from '@theia/core/lib/common/menu';
import {
  Command,
} from '@theia/core/lib/common';
import { EditorManager } from '@theia/editor/lib/browser';
import { KairoI18nService } from '@kairo/i18n';
import { KAIRO_OUTLINE_FACTORY_ID } from './kairo-factory-ids';

/** Mirrors the provider shape registered by java-monaco-registration / JSP. */
interface KairoDocSymbol {
  name: string;
  detail?: string;
  kind?: number;
  range?: { startLineNumber: number; startColumn: number };
  selectionRange?: { startLineNumber: number; startColumn: number };
  children?: KairoDocSymbol[];
}

interface KairoDocSymbolProvider {
  provideDocumentSymbols(model: unknown, token: unknown): Promise<KairoDocSymbol[] | undefined>;
}

interface FlatOutlineNode {
  name: string;
  detail: string;
  line: number;
  column: number;
  depth: number;
}

const OutlinePanel: React.FC<{
  editorManager: EditorManager;
  i18n: KairoI18nService;
}> = ({ editorManager, i18n }) => {
  const t = React.useCallback(
    (key: string) => i18n.t(key as never),
    [i18n],
  );
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);
  const [nodes, setNodes] = React.useState<FlatOutlineNode[]>([]);
  const [fileName, setFileName] = React.useState<string>('');
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const collect = React.useCallback(async () => {
    const editor = editorManager.currentEditor?.editor;
    if (!editor) { setNodes([]); setFileName(''); return; }
    try {
      const monaco = await import('@theia/monaco-editor-core');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const providers = (monaco.languages as any).__kairoDocumentSymbolProviders as KairoDocSymbolProvider[] | undefined;
      if (!providers || providers.length === 0) { setNodes([]); return; }
      const uri = (editor as unknown as { getResourceUri?(): { toString(): string } }).getResourceUri?.();
      setFileName(uri ? uri.toString().split('/').pop() || '' : '');
      const control = (editor as unknown as { getControl?: () => unknown }).getControl?.();
      const model = (control as { getModel?: () => unknown } | undefined)?.getModel?.();
      if (!model) { setNodes([]); return; }
      const token = new monaco.CancellationTokenSource().token;
      let symbols: KairoDocSymbol[] | undefined;
      for (const p of providers) {
        try {
          const r = await p.provideDocumentSymbols(model, token);
          if (r && Array.isArray(r) && r.length > 0) { symbols = r; break; }
        } catch { /* try next provider */ }
      }
      const flat: FlatOutlineNode[] = [];
      const walk = (list: KairoDocSymbol[], depth: number) => {
        for (const s of list) {
          if (!s || !s.name) continue;
          flat.push({
            name: s.name,
            detail: s.detail || '',
            line: s.range?.startLineNumber ?? s.selectionRange?.startLineNumber ?? 1,
            column: s.range?.startColumn ?? s.selectionRange?.startColumn ?? 1,
            depth,
          });
          if (s.children && s.children.length > 0) walk(s.children, depth + 1);
        }
      };
      walk(symbols ?? [], 0);
      setNodes(flat);
    } catch {
      setNodes([]);
    }
  }, [editorManager]);

  const scheduleRefresh = React.useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void collect(), 400);
  }, [collect]);

  React.useEffect(() => {
    void collect();
    const d1 = editorManager.onCurrentEditorChanged(() => scheduleRefresh());
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => {
      d1.dispose();
      disposable.dispose();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editorManager, i18n, collect, scheduleRefresh]);

  const reveal = (node: FlatOutlineNode) => {
    const editor = editorManager.currentEditor?.editor;
    const control = (editor as unknown as {
      getControl?: () => {
        revealLineInCenter(line: number): void;
        setPosition(pos: { lineNumber: number; column: number }): void;
        focus(): void;
      } | undefined;
    })?.getControl?.();
    if (!control) return;
    control.revealLineInCenter(node.line);
    control.setPosition({ lineNumber: node.line, column: node.column });
    control.focus();
  };

  if (nodes.length === 0) {
    return (
      <div className="kairo-widget kairo-outline" data-testid="kairo-outline">
        <div className="kairo-widget-header">
          <span className="kairo-widget-title">{t('widget.outline.title')}</span>
        </div>
        <div className="kairo-empty-state compact" data-testid="kairo-outline-empty">
          <span className="kairo-empty-state-glyph codicon codicon-symbol-class" aria-hidden="true" />
          <h3 className="kairo-empty-state-title">{t('widget.outline.noSymbolsTitle')}</h3>
          <p className="kairo-empty-state-reason">{t('widget.outline.noSymbolsReason')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="kairo-widget kairo-outline" data-testid="kairo-outline">
      <div className="kairo-widget-header">
        <span className="kairo-widget-title">{t('widget.outline.title')}</span>
        {fileName && <span className="kairo-outline-file">{fileName}</span>}
      </div>
      <div className="kairo-outline-body" role="tree">
        {nodes.map((n, i) => (
          <button
            key={`${n.name}-${i}`}
            type="button"
            role="treeitem"
            className="kairo-outline-row"
            style={{ paddingLeft: `${8 + n.depth * 14}px` } as React.CSSProperties}
            onClick={() => reveal(n)}
            title={n.detail}
          >
            <span className="codicon codicon-symbol-outline" aria-hidden="true" />
            <span className="kairo-outline-name">{n.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

@injectable()
export class KairoOutlineWidget extends ReactWidget {
  static readonly ID = KAIRO_OUTLINE_FACTORY_ID;

  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  constructor() {
    super();
    this.id = KairoOutlineWidget.ID;
    this.title.label = '';
    this.title.caption = '';
    this.title.iconClass = "codicon codicon-symbol-outline";
    this.addClass('kairo-widget');
  }

  @postConstruct()
  protected init(): void {
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
  }

  protected updateTitle(): void {
    this.title.label = this.i18n.t('widget.outline.title' as never);
    this.title.caption = this.i18n.t('widget.outline.caption' as never);
  }

  protected render(): React.ReactNode {
    return React.createElement(OutlinePanel, {
      editorManager: this.editorManager,
      i18n: this.i18n,
    });
  }
}

export const KAIRO_OUTLINE_TOGGLE_COMMAND: Command = {
  id: 'kairo.outline.toggle',
  label: 'Kairo: Toggle Outline View',
};

/** Standard view-contribution wiring so the shell can toggle/reveal the panel. */
@injectable()
export class KairoOutlineViewContribution extends AbstractViewContribution<KairoOutlineWidget> {
  constructor() {
    super({
      widgetId: KairoOutlineWidget.ID,
      widgetName: 'Outline',
      defaultWidgetOptions: {
        area: 'left',
        rank: 420,
      },
      toggleCommandId: KAIRO_OUTLINE_TOGGLE_COMMAND.id,
    });
  }

  override registerMenus(menus: MenuModelRegistry): void {
    super.registerMenus(menus);
    menus.registerMenuAction(['view', 'outline'], {
      commandId: KAIRO_OUTLINE_TOGGLE_COMMAND.id,
      label: 'Outline',
      order: 'a',
    });
  }
}
