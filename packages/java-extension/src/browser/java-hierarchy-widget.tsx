import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { KairoI18nService } from '@kairo/i18n';
import type {
  LSPCallHierarchyItem,
  LSPTypeHierarchyItem,
} from '../common/lsp-protocol';
import { JavaLanguageClient } from './java-language-client';

export type HierarchyMode = 'call-incoming' | 'call-outgoing' | 'type-supertypes' | 'type-subtypes';

interface HierarchyTreeItem {
  id: string;
  label: string;
  detail?: string;
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  /** The name-selection range — JDT resolves hierarchy items through it
   *  (BUG-20260826-402: reconstructing items with the full body range as
   *  selectionRange made supertypes/subtypes/incoming/outgoing return []). */
  selectionRange?: { start: { line: number; character: number }; end: { line: number; character: number } };
  /** Original LSP item as returned by prepare* — echoed back verbatim on
   *  expand so JDT's opaque `data` handle survives the round trip. */
  raw?: LSPCallHierarchyItem | LSPTypeHierarchyItem;
  children: HierarchyTreeItem[];
  expanded: boolean;
  loaded: boolean;
  depth: number;
}

interface HierarchyWidgetState {
  mode: HierarchyMode;
  rootItem: HierarchyTreeItem | null;
  loading: boolean;
  error: string | null;
  titleKey: string;
  titleParams?: { symbolName?: string };
}

export interface HierarchyWidgetProps {
  state: HierarchyWidgetState;
  onToggleExpand: (item: HierarchyTreeItem) => void;
  onNavigate: (item: HierarchyTreeItem) => void;
  i18n: KairoI18nService;
}

interface HierarchyItemComponentProps {
  item: HierarchyTreeItem;
  onToggleExpand: (item: HierarchyTreeItem) => void;
  onNavigate: (item: HierarchyTreeItem) => void;
  i18n: KairoI18nService;
}

const HierarchyItemComponent: React.FC<HierarchyItemComponentProps> = ({ item, onToggleExpand, onNavigate, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const hasChildren = item.children.length > 0 || !item.loaded;

  return (
    <div>
      <div
        className="kairo-java-hierarchy-item"
        style={{ ['--kairo-java-hierarchy-depth' as any]: item.depth }}
        onClick={() => onNavigate(item)}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onNavigate(item);
          }
        }}
      >
        <span
          className="kairo-java-hierarchy-toggle codicon"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(item); }}
          role="button"
          tabIndex={-1}
          aria-hidden={!hasChildren}
        >
          {hasChildren ? (item.expanded ? <span className="codicon codicon-chevron-down" aria-hidden="true" /> : <span className="codicon codicon-chevron-right" aria-hidden="true" />) : null}
        </span>
        <span className="codicon codicon-symbol-method kairo-java-hierarchy-icon" aria-hidden="true" />
        <span className="kairo-java-hierarchy-label">{item.label}</span>
        {item.detail ? <span className="kairo-java-hierarchy-detail">{item.detail}</span> : null}
      </div>
      {item.expanded && item.children.length > 0 && (
        <div>
          {item.children.map(child => (
            <HierarchyItemComponent
              key={child.id}
              item={child}
              onToggleExpand={onToggleExpand}
              onNavigate={onNavigate}
              i18n={i18n}
            />
          ))}
        </div>
      )}
      {item.expanded && !item.loaded && (
        <div className="kairo-java-hierarchy-loading-children" style={{ ['--kairo-java-hierarchy-depth' as any]: item.depth }}>
          <span className="codicon codicon-sync codicon-modifier-spin" aria-hidden="true" />
          {' '}{t('widget.java.hierarchy.loadingChildren')}
        </div>
      )}
    </div>
  );
};

export const HierarchyWidgetComponent: React.FC<HierarchyWidgetProps> = ({ state, onToggleExpand, onNavigate, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);

  if (state.loading) {
    return (
      <div className="kairo-widget-body kairo-loading kairo-java-hierarchy-loading">
        <span className="kairo-spinner" aria-hidden="true" />
        <span>{t('widget.java.hierarchy.loading')}</span>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="kairo-widget-body kairo-java-hierarchy-error">
        <div className="kairo-error-banner" role="alert">
          <span className="codicon codicon-error" aria-hidden="true" />
          <span>{state.error}</span>
        </div>
      </div>
    );
  }

  if (!state.rootItem) {
    return (
      <div className="kairo-widget-body kairo-empty-state kairo-java-hierarchy-empty">
        <div className="kairo-empty-state-glyph">
          <span className="codicon codicon-type-hierarchy" aria-hidden="true" />
        </div>
        <p className="kairo-empty-state-title">{t('widget.java.hierarchy.empty.title')}</p>
        <p className="kairo-empty-state-reason">{t('widget.java.hierarchy.empty.reason')}</p>
      </div>
    );
  }

  return (
    <div className="kairo-widget-body kairo-java-hierarchy-container">
      <div className="kairo-widget-header kairo-java-hierarchy-header">
        <span className="kairo-widget-title">{t(state.titleKey, state.titleParams)}</span>
      </div>
      <HierarchyItemComponent
        item={state.rootItem}
        onToggleExpand={onToggleExpand}
        onNavigate={onNavigate}
        i18n={i18n}
      />
    </div>
  );
};

@injectable()
export class JavaHierarchyWidget extends ReactWidget {
  static readonly ID = 'kairo-java-hierarchy';

  @inject(JavaLanguageClient)
  protected readonly languageClient!: JavaLanguageClient;

  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  protected widgetState: HierarchyWidgetState = {
    mode: 'call-incoming',
    rootItem: null,
    loading: false,
    error: null,
    titleKey: 'widget.java.hierarchy.title',
  };

  constructor() {
    super();
    this.id = JavaHierarchyWidget.ID;
    this.title.iconClass = 'codicon codicon-type-hierarchy';
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.addClass('kairo-java-hierarchy-widget');
  }

  @postConstruct()
  protected init(): void {
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => {
      this.updateTitle();
      this.update();
    }));
  }

  protected t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key as any, params);
  }

  protected updateTitle(): void {
    this.title.label = this.t(this.widgetState.titleKey, this.widgetState.titleParams);
    this.title.caption = this.t('widget.java.hierarchy.caption');
  }

  /**
   * Show call hierarchy for the given position.
   * mode: 'call-incoming' | 'call-outgoing'
   */
  async showCallHierarchy(mode: 'call-incoming' | 'call-outgoing', uri: string, line: number, character: number): Promise<void> {
    this.widgetState = {
      mode,
      rootItem: null,
      loading: true,
      error: null,
      titleKey: mode === 'call-incoming' ? 'widget.java.hierarchy.title.callIncoming' : 'widget.java.hierarchy.title.callOutgoing',
    };
    this.updateTitle();
    this.update();

    try {
      const items = await this.languageClient.prepareCallHierarchy({ uri, line, character });
      if (!items || items.length === 0) {
        this.widgetState = {
          ...this.widgetState,
          loading: false,
          error: this.t('widget.java.hierarchy.error.noCallHierarchy'),
        };
        this.update();
        return;
      }

      const rootItem = items[0];
      const treeItem = this.toCallHierarchyTreeItem(rootItem, 0, false);

      this.widgetState = {
        ...this.widgetState,
        rootItem: treeItem,
        loading: false,
        titleParams: { symbolName: treeItem.label },
      };
      this.updateTitle();
      this.update();
    } catch (err) {
      this.widgetState = {
        ...this.widgetState,
        loading: false,
        error: this.t('widget.java.hierarchy.error.loadCallHierarchy', { message: String(err) }),
      };
      this.update();
    }
  }

  /**
   * Show type hierarchy for the given position.
   * mode: 'type-supertypes' | 'type-subtypes'
   */
  async showTypeHierarchy(mode: 'type-supertypes' | 'type-subtypes', uri: string, line: number, character: number): Promise<void> {
    this.widgetState = {
      mode,
      rootItem: null,
      loading: true,
      error: null,
      titleKey: mode === 'type-supertypes' ? 'widget.java.hierarchy.title.typeSupertypes' : 'widget.java.hierarchy.title.typeSubtypes',
    };
    this.updateTitle();
    this.update();

    try {
      const items = await this.languageClient.prepareTypeHierarchy({ uri, line, character });
      if (!items || items.length === 0) {
        this.widgetState = {
          ...this.widgetState,
          loading: false,
          error: this.t('widget.java.hierarchy.error.noTypeHierarchy'),
        };
        this.update();
        return;
      }

      const rootItem = items[0];
      const treeItem = this.toTypeHierarchyTreeItem(rootItem, 0, false);

      this.widgetState = {
        ...this.widgetState,
        rootItem: treeItem,
        loading: false,
        titleParams: { symbolName: treeItem.label },
      };
      this.updateTitle();
      this.update();
    } catch (err) {
      this.widgetState = {
        ...this.widgetState,
        loading: false,
        error: this.t('widget.java.hierarchy.error.loadTypeHierarchy', { message: String(err) }),
      };
      this.update();
    }
  }

  protected async toggleExpand(item: HierarchyTreeItem): Promise<void> {
    if (item.loaded) {
      item.expanded = !item.expanded;
      this.update();
      return;
    }

    item.expanded = true;
    this.update();

    try {
      if (this.widgetState.mode === 'call-incoming') {
        const callItem = (item.raw as LSPCallHierarchyItem | undefined) ?? {
          name: item.label,
          kind: 6,
          uri: item.uri,
          range: { start: item.range.start, end: item.range.end },
          selectionRange: { start: (item.selectionRange ?? item.range).start, end: (item.selectionRange ?? item.range).end },
          detail: item.detail,
        };
        const calls = await this.languageClient.incomingCalls(callItem);
        item.children = calls.map((c, i) => this.toCallHierarchyTreeItem(c.from, item.depth + 1, false, i));
        item.loaded = true;
      } else if (this.widgetState.mode === 'call-outgoing') {
        const callItem = (item.raw as LSPCallHierarchyItem | undefined) ?? {
          name: item.label,
          kind: 6,
          uri: item.uri,
          range: { start: item.range.start, end: item.range.end },
          selectionRange: { start: (item.selectionRange ?? item.range).start, end: (item.selectionRange ?? item.range).end },
          detail: item.detail,
        };
        const calls = await this.languageClient.outgoingCalls(callItem);
        item.children = calls.map((c, i) => this.toCallHierarchyTreeItem(c.to, item.depth + 1, false, i));
        item.loaded = true;
      } else if (this.widgetState.mode === 'type-supertypes') {
        const typeItem = (item.raw as LSPTypeHierarchyItem | undefined) ?? {
          name: item.label,
          kind: 5,
          uri: item.uri,
          range: { start: item.range.start, end: item.range.end },
          selectionRange: { start: (item.selectionRange ?? item.range).start, end: (item.selectionRange ?? item.range).end },
          detail: item.detail,
        };
        const types = await this.languageClient.supertypes(typeItem);
        item.children = types.map((t, i) => this.toTypeHierarchyTreeItem(t, item.depth + 1, false, i));
        item.loaded = true;
      } else if (this.widgetState.mode === 'type-subtypes') {
        const typeItem = (item.raw as LSPTypeHierarchyItem | undefined) ?? {
          name: item.label,
          kind: 5,
          uri: item.uri,
          range: { start: item.range.start, end: item.range.end },
          selectionRange: { start: (item.selectionRange ?? item.range).start, end: (item.selectionRange ?? item.range).end },
          detail: item.detail,
        };
        const types = await this.languageClient.subtypes(typeItem);
        item.children = types.map((t, i) => this.toTypeHierarchyTreeItem(t, item.depth + 1, false, i));
        item.loaded = true;
      }
      this.update();
    } catch (err) {
      item.expanded = false;
      item.loaded = false;
      this.widgetState.error = this.t('widget.java.hierarchy.error.expand', { message: String(err) });
      this.update();
    }
  }

  protected async navigateTo(item: HierarchyTreeItem): Promise<void> {
    await this.editorManager.open(new URI(item.uri), {
      mode: 'activate',
      selection: {
        start: { line: item.range.start.line, character: item.range.start.character },
        end: { line: item.range.start.line, character: item.range.start.character },
      },
      revealOption: 'centerIfOutsideViewport',
    });
  }

  protected toCallHierarchyTreeItem(
    item: LSPCallHierarchyItem,
    depth: number,
    loaded: boolean,
    index: number = 0,
  ): HierarchyTreeItem {
    return {
      id: `${item.uri}:${item.range.start.line}:${item.range.start.character}:${depth}:${index}`,
      label: item.name,
      detail: item.detail,
      uri: item.uri,
      range: item.range,
      selectionRange: item.selectionRange ?? item.range,
      raw: item,
      children: [],
      expanded: false,
      loaded,
      depth,
    };
  }

  protected toTypeHierarchyTreeItem(
    item: LSPTypeHierarchyItem,
    depth: number,
    loaded: boolean,
    index: number = 0,
  ): HierarchyTreeItem {
    return {
      id: `${item.uri}:${item.range.start.line}:${item.range.start.character}:${depth}:${index}`,
      label: item.name,
      detail: item.detail,
      uri: item.uri,
      range: item.range,
      selectionRange: item.selectionRange ?? item.range,
      raw: item,
      children: [],
      expanded: false,
      loaded,
      depth,
    };
  }

  protected render(): React.ReactNode {
    return (
      <HierarchyWidgetComponent
        state={this.widgetState}
        onToggleExpand={item => this.toggleExpand(item)}
        onNavigate={item => this.navigateTo(item)}
        i18n={this.i18n}
      />
    );
  }
}
