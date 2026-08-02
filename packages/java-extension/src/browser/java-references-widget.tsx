import * as React from 'react';
import { inject, injectable, postConstruct, optional } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { KairoI18nService } from '@kairo/i18n';
import type { LSPLocation } from '../common/lsp-protocol';
import { JavaLanguageClient } from './java-language-client';
import * as monaco from '@theia/monaco-editor-core';

interface ReferenceGroup {
  uri: string;
  filePath: string;
  fileName: string;
  references: ReferenceItem[];
  expanded: boolean;
}

interface ReferenceItem {
  uri: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  preview: string;
}

interface ReferencesWidgetState {
  symbolName: string;
  groups: ReferenceGroup[];
  loading: boolean;
  error: string | null;
  filter: string;
}

interface ReferencesGroupComponentProps {
  group: ReferenceGroup;
  onToggleExpand: () => void;
  onNavigate: (item: ReferenceItem) => void;
  i18n: KairoI18nService;
}

const ReferencesGroupComponent: React.FC<ReferencesGroupComponentProps> = ({ group, onToggleExpand, onNavigate, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);

  return (
    <div className="kairo-java-references-group">
      <div
        className="kairo-java-references-group-header"
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        aria-expanded={group.expanded}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand();
          }
        }}
      >
        <span className={`kairo-java-references-toggle codicon ${group.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
        <span className="codicon codicon-file-code kairo-java-references-file-icon" aria-hidden="true" />
        <span className="kairo-java-references-file-name">{group.fileName}</span>
        <span className="kairo-java-references-count">({group.references.length})</span>
        <span className="kairo-java-references-path">{group.filePath}</span>
      </div>
      {group.expanded && group.references.map((ref, idx) => (
        <div
          key={`${ref.uri}:${ref.line}:${idx}`}
          className="kairo-java-references-item"
          onClick={() => onNavigate(ref)}
          role="button"
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onNavigate(ref);
            }
          }}
        >
          <span className="kairo-java-references-line">{ref.line + 1}</span>
          <code className="kairo-java-references-preview">{ref.preview}</code>
        </div>
      ))}
    </div>
  );
};

interface ReferencesWidgetComponentProps {
  state: ReferencesWidgetState;
  onToggleGroup: (idx: number) => void;
  onNavigate: (item: ReferenceItem) => void;
  onFilterChange: (value: string) => void;
  i18n: KairoI18nService;
}

const ReferencesWidgetComponent: React.FC<ReferencesWidgetComponentProps> = ({ state, onToggleGroup, onNavigate, onFilterChange, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);

  if (state.loading) {
    return (
      <div className="kairo-widget-body kairo-loading kairo-java-references-loading">
        <span className="codicon codicon-sync codicon-modifier-spin kairo-loading-icon" aria-hidden="true" />
        <span>{t('widget.java.references.loading')}</span>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="kairo-widget-body kairo-java-references-error">
        <div className="kairo-error-banner" role="alert">
          <span className="codicon codicon-error" aria-hidden="true" />
          <span>{state.error}</span>
        </div>
      </div>
    );
  }

  if (state.groups.length === 0) {
    return (
      <div className="kairo-widget-body kairo-empty-state kairo-java-references-empty">
        <div className="kairo-empty-state-glyph">
          <span className="codicon codicon-search" aria-hidden="true" />
        </div>
        <p className="kairo-empty-state-title">{t('widget.java.references.empty.title')}</p>
        <p className="kairo-empty-state-reason">{t('widget.java.references.empty.reason')}</p>
      </div>
    );
  }

  const filter = state.filter.trim().toLowerCase();
  const visibleGroups = state.groups
    .map(group => {
      if (!filter) return group;
      const fileHit = `${group.fileName} ${group.filePath}`.toLowerCase().includes(filter);
      const refs = fileHit
        ? group.references
        : group.references.filter(ref => ref.preview.toLowerCase().includes(filter) || String(ref.line + 1).includes(filter));
      if (refs.length === 0) return null;
      return { ...group, references: refs };
    })
    .filter((g): g is ReferenceGroup => g !== null);

  const totalUsages = state.groups.reduce((acc, g) => acc + g.references.length, 0);
  const visibleUsages = visibleGroups.reduce((acc, g) => acc + g.references.length, 0);

  return (
    <div className="kairo-widget-body kairo-java-references-container">
      <div className="kairo-widget-header kairo-java-references-summary">
        <span>
          {filter
            ? t('widget.java.references.filteredSummary', { visible: visibleUsages, count: totalUsages, symbolName: state.symbolName })
            : t('widget.java.references.resultSummary', { count: totalUsages, symbolName: state.symbolName })}
        </span>
        <input
          className="kairo-java-references-filter"
          type="search"
          value={state.filter}
          placeholder={t('widget.java.references.filterPlaceholder')}
          aria-label={t('widget.java.references.filterPlaceholder')}
          onChange={e => onFilterChange(e.target.value)}
        />
      </div>
      <div className="kairo-java-references-list">
        {visibleGroups.length === 0 ? (
          <div className="kairo-java-references-filter-empty">{t('widget.java.references.filterEmpty')}</div>
        ) : visibleGroups.map((group, idx) => {
          const originalIdx = state.groups.findIndex(g => g.uri === group.uri);
          return (
            <ReferencesGroupComponent
              key={group.uri}
              group={group}
              onToggleExpand={() => onToggleGroup(originalIdx >= 0 ? originalIdx : idx)}
              onNavigate={onNavigate}
              i18n={i18n}
            />
          );
        })}
      </div>
    </div>
  );
};

@injectable()
export class JavaReferencesWidget extends ReactWidget {
  static readonly ID = 'kairo-java-references';

  @inject(JavaLanguageClient)
  protected readonly languageClient!: JavaLanguageClient;

  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  @inject(WorkspaceService)
  @optional()
  protected readonly workspaceService?: WorkspaceService;

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  protected widgetState: ReferencesWidgetState = {
    symbolName: '',
    groups: [],
    loading: false,
    error: null,
    filter: '',
  };

  constructor() {
    super();
    this.id = JavaReferencesWidget.ID;
    this.title.iconClass = 'codicon codicon-search';
    this.title.closable = true;
    this.addClass('kairo-widget');
    this.addClass('kairo-java-references-widget');
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
    this.title.label = this.widgetState.symbolName
      ? this.t('widget.java.references.titleWithSymbol', { symbolName: this.widgetState.symbolName })
      : this.t('widget.java.references.title');
  }

  async findUsages(uri: string, line: number, character: number, symbolName?: string): Promise<void> {
    this.widgetState = {
      symbolName: symbolName ?? '',
      groups: [],
      loading: true,
      error: null,
      filter: '',
    };
    this.updateTitle();
    this.update();

    try {
      const references = await this.languageClient.references({ uri, line, character, includeDeclaration: true });
      if (!references || references.length === 0) {
        this.widgetState = {
          ...this.widgetState,
          loading: false,
          error: this.t('widget.java.references.empty.noResults'),
        };
        this.update();
        return;
      }

      const groups = this.groupReferences(references);
      const name = symbolName ?? this.extractSymbolName(uri, line, character);

      this.widgetState = {
        symbolName: name,
        groups,
        loading: false,
        error: null,
        filter: '',
      };
      this.title.label = this.t('widget.java.references.titleWithCount', { name, count: references.length });
      this.update();
    } catch (err) {
      this.widgetState = {
        ...this.widgetState,
        loading: false,
        error: this.t('widget.java.references.error.fetchFailed', { message: String(err) }),
      };
      this.update();
    }
  }

  protected groupReferences(references: LSPLocation[]): ReferenceGroup[] {
    const groupMap = new Map<string, ReferenceGroup>();
    const workspaceRoot = (this.workspaceService?.tryGetRoots()[0] as any)?.resource?.toString() ?? (this.workspaceService?.tryGetRoots()[0] as any)?.uri?.toString() ?? '';

    for (const ref of references) {
      let group = groupMap.get(ref.uri);
      if (!group) {
        const uri = new URI(ref.uri);
        const filePath = workspaceRoot ? uri.path.toString().replace(new URI(workspaceRoot).path.toString(), '') : uri.path.toString();
        const fileName = uri.path.base;
        group = {
          uri: ref.uri,
          filePath,
          fileName,
          references: [],
          expanded: true,
        };
        groupMap.set(ref.uri, group);
      }

      const preview = this.getLinePreview(ref.uri, ref.range.start.line);
      group.references.push({
        uri: ref.uri,
        line: ref.range.start.line,
        character: ref.range.start.character,
        endLine: ref.range.end.line,
        endCharacter: ref.range.end.character,
        preview,
      });
    }

    return Array.from(groupMap.values()).sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  protected getLinePreview(uri: string, line: number): string {
    try {
      const model = monaco.editor.getModel(monaco.Uri.parse(uri));
      if (model) {
        const content = model.getLineContent(line + 1);
        return content.trim().substring(0, 200);
      }
    } catch {
      // ignore
    }
    return this.t('widget.java.references.linePreview', { line: line + 1 });
  }

  protected extractSymbolName(uri: string, line: number, character: number): string {
    try {
      const model = monaco.editor.getModel(monaco.Uri.parse(uri));
      if (model) {
        const word = model.getWordAtPosition({ lineNumber: line + 1, column: character + 1 });
        if (word) {
          return word.word;
        }
      }
    } catch {
      // ignore
    }
    return this.t('widget.java.references.fallbackSymbol');
  }

  protected toggleGroup(idx: number): void {
    this.widgetState.groups[idx].expanded = !this.widgetState.groups[idx].expanded;
    this.update();
  }

  protected setFilter(filter: string): void {
    this.widgetState = { ...this.widgetState, filter };
    this.update();
  }

  protected async navigateTo(item: ReferenceItem): Promise<void> {
    await this.editorManager.open(new URI(item.uri), {
      mode: 'activate',
      selection: {
        start: { line: item.line + 1, character: item.character + 1 },
        end: { line: item.endLine + 1, character: item.endCharacter + 1 },
      },
      revealOption: 'centerIfOutsideViewport',
    });
  }

  protected render(): React.ReactNode {
    return (
      <ReferencesWidgetComponent
        state={this.widgetState}
        onToggleGroup={idx => this.toggleGroup(idx)}
        onNavigate={item => this.navigateTo(item)}
        onFilterChange={value => this.setFilter(value)}
        i18n={this.i18n}
      />
    );
  }
}
