import * as React from 'react';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { WorkspaceService } from '@theia/workspace/lib/browser';
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
}

const ReferencesGroupComponent: React.FC<{
  group: ReferenceGroup;
  onToggleExpand: () => void;
  onNavigate: (item: ReferenceItem) => void;
}> = ({ group, onToggleExpand, onNavigate }) => {
  return (
    <div>
      <div
        className="kairo-refs-group"
        style={{
          padding: '4px 8px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          fontWeight: 500,
          backgroundColor: 'var(--theia-list-hoverBackground)',
          userSelect: 'none',
        }}
        onClick={onToggleExpand}
      >
        <span style={{ width: '16px', flexShrink: 0, textAlign: 'center' }}>
          {group.expanded ? '▾' : '▸'}
        </span>
        <span className="codicon codicon-file-code" style={{ marginRight: '4px', flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {group.fileName}
        </span>
        <span style={{ color: 'var(--theia-descriptionForeground)', marginLeft: '8px', fontSize: '12px' }}>
          ({group.references.length})
        </span>
        <span style={{ color: 'var(--theia-descriptionForeground)', marginLeft: '8px', fontSize: '11px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
          {group.filePath}
        </span>
      </div>
      {group.expanded && group.references.map((ref, idx) => (
        <div
          key={`${ref.uri}:${ref.line}:${idx}`}
          className="kairo-refs-item"
          style={{
            padding: '2px 8px 2px 32px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'flex-start',
            fontSize: '12px',
            lineHeight: '18px',
          }}
          onClick={() => onNavigate(ref)}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theia-list-hoverBackground)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
        >
          <span style={{ color: 'var(--theia-descriptionForeground)', marginRight: '8px', flexShrink: 0, minWidth: '40px', textAlign: 'right' }}>
            {ref.line + 1}
          </span>
          <code style={{
            fontFamily: 'var(--theia-ui-font-monospace)',
            whiteSpace: 'pre',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: 1,
          }}>
            {ref.preview}
          </code>
        </div>
      ))}
    </div>
  );
};

const ReferencesWidgetComponent: React.FC<{
  state: ReferencesWidgetState;
  onToggleGroup: (idx: number) => void;
  onNavigate: (item: ReferenceItem) => void;
}> = ({ state, onToggleGroup, onNavigate }) => {
  if (state.loading) {
    return (
      <div className="kairo-refs-container" style={{ padding: '16px' }}>
        <div className="kairo-refs-loading">Finding usages...</div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="kairo-refs-container" style={{ padding: '16px' }}>
        <div className="kairo-refs-error" style={{ color: 'var(--theia-errorForeground)' }}>{state.error}</div>
      </div>
    );
  }

  if (state.groups.length === 0) {
    return (
      <div className="kairo-refs-container" style={{ padding: '16px' }}>
        <div className="kairo-refs-placeholder">
          Place the cursor on a symbol and press <strong>Alt+F7</strong> to find usages.
        </div>
      </div>
    );
  }

  return (
    <div className="kairo-refs-container" style={{ padding: '4px 0', overflow: 'auto', height: '100%' }}>
      <div style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--theia-descriptionForeground)', borderBottom: '1px solid var(--theia-sideBarSectionHeader-border)' }}>
        Found {state.groups.reduce((acc, g) => acc + g.references.length, 0)} usages of '{state.symbolName}'
      </div>
      {state.groups.map((group, idx) => (
        <ReferencesGroupComponent
          key={group.uri}
          group={group}
          onToggleExpand={() => onToggleGroup(idx)}
          onNavigate={onNavigate}
        />
      ))}
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

  protected widgetState: ReferencesWidgetState = {
    symbolName: '',
    groups: [],
    loading: false,
    error: null,
  };

  constructor() {
    super();
    this.id = JavaReferencesWidget.ID;
    this.title.label = 'Find Usages';
    this.title.caption = 'Find Usages';
    this.title.iconClass = 'codicon codicon-search';
    this.title.closable = true;
    this.addClass('kairo-references-widget');
  }

  async findUsages(uri: string, line: number, character: number, symbolName?: string): Promise<void> {
    this.widgetState = {
      symbolName: symbolName ?? 'symbol',
      groups: [],
      loading: true,
      error: null,
    };
    this.update();
    this.title.label = `Find Usages — ${symbolName ?? '...'}`;

    try {
      const references = await this.languageClient.references({ uri, line, character, includeDeclaration: true });
      if (!references || references.length === 0) {
        this.widgetState = {
          ...this.widgetState,
          loading: false,
          error: 'No usages found.',
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
      };
      this.title.label = `Find Usages — ${name} (${references.length})`;
      this.update();
    } catch (err) {
      this.widgetState = {
        ...this.widgetState,
        loading: false,
        error: `Failed to find usages: ${String(err)}`,
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
    return `// Line ${line + 1}`;
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
    return 'symbol';
  }

  protected toggleGroup(idx: number): void {
    this.widgetState.groups[idx].expanded = !this.widgetState.groups[idx].expanded;
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
      />
    );
  }
}
