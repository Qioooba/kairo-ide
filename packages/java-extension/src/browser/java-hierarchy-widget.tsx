import * as React from 'react';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
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
  title: string;
}

export interface HierarchyWidgetProps {
  state: HierarchyWidgetState;
  onToggleExpand: (item: HierarchyTreeItem) => void;
  onNavigate: (item: HierarchyTreeItem) => void;
}

const HierarchyItemComponent: React.FC<{
  item: HierarchyTreeItem;
  onToggleExpand: (item: HierarchyTreeItem) => void;
  onNavigate: (item: HierarchyTreeItem) => void;
}> = ({ item, onToggleExpand, onNavigate }) => {
  const hasChildren = item.children.length > 0 || !item.loaded;
  const paddingLeft = item.depth * 16 + 8;

  return (
    <div>
      <div
        className="kairo-hierarchy-item"
        style={{ paddingLeft: `${paddingLeft}px`, cursor: 'pointer', display: 'flex', alignItems: 'center', height: '24px', userSelect: 'none' }}
        onClick={() => onNavigate(item)}
      >
        <span
          style={{ width: '16px', flexShrink: 0, textAlign: 'center', cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); onToggleExpand(item); }}
        >
          {hasChildren ? (item.expanded ? '▾' : '▸') : ' '}
        </span>
        <span className="codicon codicon-symbol-method" style={{ marginRight: '4px', flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.label}
          {item.detail ? <span style={{ color: 'var(--theia-descriptionForeground)', marginLeft: '8px' }}>{item.detail}</span> : null}
        </span>
      </div>
      {item.expanded && item.children.length > 0 && (
        <div>
          {item.children.map(child => (
            <HierarchyItemComponent
              key={child.id}
              item={child}
              onToggleExpand={onToggleExpand}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
      {item.expanded && !item.loaded && (
        <div style={{ paddingLeft: `${paddingLeft + 16}px`, color: 'var(--theia-descriptionForeground)', fontSize: '12px', height: '20px' }}>
          Loading…
        </div>
      )}
    </div>
  );
};

export const HierarchyWidgetComponent: React.FC<HierarchyWidgetProps> = ({ state, onToggleExpand, onNavigate }) => {
  if (state.loading) {
    return (
      <div className="kairo-hierarchy-container" style={{ padding: '16px' }}>
        <div className="kairo-hierarchy-loading">Loading hierarchy…</div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="kairo-hierarchy-container" style={{ padding: '16px' }}>
        <div className="kairo-hierarchy-error" style={{ color: 'var(--theia-errorForeground)' }}>{state.error}</div>
      </div>
    );
  }

  if (!state.rootItem) {
    return (
      <div className="kairo-hierarchy-container" style={{ padding: '16px' }}>
        <div className="kairo-hierarchy-placeholder">
          Place the cursor on a method or class and run <strong>Show Call Hierarchy</strong> or <strong>Show Type Hierarchy</strong> from the command palette.
        </div>
      </div>
    );
  }

  return (
    <div className="kairo-hierarchy-container" style={{ padding: '4px 0', overflow: 'auto', height: '100%' }}>
      <div style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--theia-descriptionForeground)', borderBottom: '1px solid var(--theia-sideBarSectionHeader-border)' }}>
        {state.title}
      </div>
      <HierarchyItemComponent
        item={state.rootItem}
        onToggleExpand={onToggleExpand}
        onNavigate={onNavigate}
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

  protected widgetState: HierarchyWidgetState = {
    mode: 'call-incoming',
    rootItem: null,
    loading: false,
    error: null,
    title: 'Call Hierarchy',
  };

  constructor() {
    super();
    this.id = JavaHierarchyWidget.ID;
    this.title.label = 'Java Hierarchy';
    this.title.caption = 'Java Call / Type Hierarchy';
    this.title.iconClass = 'codicon codicon-type-hierarchy';
    this.title.closable = true;
    this.addClass('kairo-hierarchy-widget');
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
      title: mode === 'call-incoming' ? 'Call Hierarchy — Incoming Calls' : 'Call Hierarchy — Outgoing Calls',
    };
    this.update();

    try {
      const items = await this.languageClient.prepareCallHierarchy({ uri, line, character });
      if (!items || items.length === 0) {
        this.widgetState = {
          ...this.widgetState,
          loading: false,
          error: 'No call hierarchy information available at this position.',
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
      };
      this.update();
    } catch (err) {
      this.widgetState = {
        ...this.widgetState,
        loading: false,
        error: `Failed to load call hierarchy: ${String(err)}`,
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
      title: mode === 'type-supertypes' ? 'Type Hierarchy — Supertypes' : 'Type Hierarchy — Subtypes',
    };
    this.update();

    try {
      const items = await this.languageClient.prepareTypeHierarchy({ uri, line, character });
      if (!items || items.length === 0) {
        this.widgetState = {
          ...this.widgetState,
          loading: false,
          error: 'No type hierarchy information available at this position.',
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
      };
      this.update();
    } catch (err) {
      this.widgetState = {
        ...this.widgetState,
        loading: false,
        error: `Failed to load type hierarchy: ${String(err)}`,
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
        const callItem: LSPCallHierarchyItem = {
          name: item.label,
          kind: 6,
          uri: item.uri,
          range: { start: item.range.start, end: item.range.end },
          selectionRange: { start: item.range.start, end: item.range.end },
          detail: item.detail,
        };
        const calls = await this.languageClient.incomingCalls(callItem);
        item.children = calls.map((c, i) => this.toCallHierarchyTreeItem(c.from, item.depth + 1, false, i));
        item.loaded = true;
      } else if (this.widgetState.mode === 'call-outgoing') {
        const callItem: LSPCallHierarchyItem = {
          name: item.label,
          kind: 6,
          uri: item.uri,
          range: { start: item.range.start, end: item.range.end },
          selectionRange: { start: item.range.start, end: item.range.end },
          detail: item.detail,
        };
        const calls = await this.languageClient.outgoingCalls(callItem);
        item.children = calls.map((c, i) => this.toCallHierarchyTreeItem(c.to, item.depth + 1, false, i));
        item.loaded = true;
      } else if (this.widgetState.mode === 'type-supertypes') {
        const typeItem: LSPTypeHierarchyItem = {
          name: item.label,
          kind: 5,
          uri: item.uri,
          range: { start: item.range.start, end: item.range.end },
          selectionRange: { start: item.range.start, end: item.range.end },
          detail: item.detail,
        };
        const types = await this.languageClient.supertypes(typeItem);
        item.children = types.map((t, i) => this.toTypeHierarchyTreeItem(t, item.depth + 1, false, i));
        item.loaded = true;
      } else if (this.widgetState.mode === 'type-subtypes') {
        const typeItem: LSPTypeHierarchyItem = {
          name: item.label,
          kind: 5,
          uri: item.uri,
          range: { start: item.range.start, end: item.range.end },
          selectionRange: { start: item.range.start, end: item.range.end },
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
      this.widgetState.error = `Failed to expand: ${String(err)}`;
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
      />
    );
  }
}