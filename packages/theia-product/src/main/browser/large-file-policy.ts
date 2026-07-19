import {
  IEditorOptions,
  ShowLightbulbIconMode,
} from '@theia/monaco-editor-core/esm/vs/editor/common/config/editorOptions';

export type LargeFileTier = 'normal' | 'large' | 'huge';

export interface LargeFileMetrics {
  characterCount: number;
  lineCount: number;
}

export interface LargeFileThresholds {
  largeCharacterCount: number;
  largeLineCount: number;
  hugeCharacterCount: number;
  hugeLineCount: number;
}

export const DEFAULT_LARGE_FILE_THRESHOLDS: LargeFileThresholds = {
  largeCharacterCount: 2_000_000,
  largeLineCount: 20_000,
  hugeCharacterCount: 10_000_000,
  hugeLineCount: 80_000,
};

export function classifyLargeFile(
  metrics: LargeFileMetrics,
  thresholds: LargeFileThresholds = DEFAULT_LARGE_FILE_THRESHOLDS,
): LargeFileTier {
  if (
    metrics.characterCount >= thresholds.hugeCharacterCount ||
    metrics.lineCount >= thresholds.hugeLineCount
  ) {
    return 'huge';
  }
  if (
    metrics.characterCount >= thresholds.largeCharacterCount ||
    metrics.lineCount >= thresholds.largeLineCount
  ) {
    return 'large';
  }
  return 'normal';
}

/**
 * Per-editor overrides only. Monaco's model-level large-file optimization stays
 * enabled globally; these options remove work that Monaco cannot infer is
 * undesirable for a medium-sized but structurally expensive JSP/Java file.
 */
export function editorOptionsForLargeFile(tier: Exclude<LargeFileTier, 'normal'>): IEditorOptions {
  const common: IEditorOptions = {
    bracketPairColorization: { enabled: false },
    codeLens: false,
    folding: false,
    inlayHints: { enabled: 'off' },
    links: false,
    minimap: { enabled: false },
    occurrencesHighlight: 'off',
    renderWhitespace: 'none',
    selectionHighlight: false,
    stickyScroll: { enabled: false },
    wordWrap: 'off',
  };

  if (tier === 'large') {
    return common;
  }

  return {
    ...common,
    hover: { enabled: 'off' },
    lightbulb: { enabled: ShowLightbulbIconMode.Off },
    parameterHints: { enabled: false },
    quickSuggestions: false,
    renderValidationDecorations: 'off',
    stopRenderingLineAfter: 5_000,
    suggestOnTriggerCharacters: false,
  };
}
