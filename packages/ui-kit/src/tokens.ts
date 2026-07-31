/**
 * Kairo design tokens. See docs/ui-spec.md §2.
 *
 * Extensions MUST import tokens from here, never hardcode colors.
 * The CI lint asserts this.
 */

export const tokens = {
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
    huge: 48,
  },
  type: {
    xs: { size: 11, line: 16 },
    sm: { size: 12, line: 18 },
    base: { size: 13, line: 20 },
    md: { size: 14, line: 22 },
    lg: { size: 16, line: 24 },
    xl: { size: 20, line: 28 },
  },
  radius: {
    sm: 3,
    md: 6,
    lg: 10,
  },
  button: {
    heightSm: 26,
    heightMd: 30,
    heightLg: 32,
    paddingX: 14,
    paddingXCompact: 10,
    radius: 6,
    gap: 5,
  },
  components: {
    tabs: {
      height: 28,
      gap: 2,
      paddingX: 12,
      activeBorderWidth: 2,
    },
    table: {
      headerHeight: 32,
      rowHeight: 28,
      cellPaddingX: 8,
      cellPaddingY: 6,
    },
    list: {
      itemPaddingX: 12,
      itemPaddingY: 8,
      gap: 4,
      iconSize: 14,
    },
    emptyState: {
      glyphSize: 36,
      maxWidth: 340,
      paddingY: 32,
    },
    badge: {
      paddingX: 6,
      paddingY: 1,
      radius: 3,
      fontSize: 10,
    },
    form: {
      fieldGap: 10,
      labelGap: 4,
      inputHeight: 30,
      inputPaddingX: 8,
    },
  },
  color: {
    dark: {
      bgCanvas: '#1e1f22',
      bgPanel: '#252628',
      bgElevated: '#2b2c2f',
      bgActive: '#37393c',
      fgPrimary: '#dfe1e5',
      fgSecondary: '#9aa0a6',
      fgMuted: '#6e747a',
      borderSubtle: '#3a3b3e',
      borderStrong: '#4a4c50',
      accentPrimary: '#4a9eff',
      accentDanger: '#f04757',
      accentWarning: '#fbbc04',
      accentSuccess: '#3dcc91',
      serverRunning: '#3dcc91',
      serverStopped: '#6e747a',
      serverError: '#f04757',
      hotReloadGreen: '#3dcc91',
      hotReloadAmber: '#fbbc04',
      hotReloadRed: '#f04757',
      shadow: 'rgba(0, 0, 0, 0.25)',
      focusRing: '#4a9eff',
      hoverOverlay: 'rgba(255, 255, 255, 0.05)',
      disabledFg: '#6e747a',
      disabledBg: '#2b2c2f',
      inputBg: '#1e1f22',
      inputBorder: '#3a3b3e',
      inputFg: '#dfe1e5',
      inputPlaceholderFg: '#9aa0a6',
      badgeSuccessBg: '#3dcc91',
      badgeSuccessFg: '#1e1f22',
      badgeWarningBg: '#fbbc04',
      badgeWarningFg: '#1e1f22',
      badgeErrorBg: '#f04757',
      badgeErrorFg: '#ffffff',
      badgeInfoBg: '#4a9eff',
      badgeInfoFg: '#ffffff',
      badgeDefaultBg: '#6e747a',
      badgeDefaultFg: '#ffffff',
    },
    light: {
      bgCanvas: '#fafafa',
      bgPanel: '#ffffff',
      bgElevated: '#f3f3f3',
      bgActive: '#e8eaed',
      fgPrimary: '#1f1f1f',
      fgSecondary: '#5f6368',
      fgMuted: '#80868b',
      borderSubtle: '#e0e0e0',
      borderStrong: '#c0c0c0',
      accentPrimary: '#1a73e8',
      accentDanger: '#d93025',
      accentWarning: '#f29900',
      accentSuccess: '#188038',
      serverRunning: '#188038',
      serverStopped: '#5f6368',
      serverError: '#d93025',
      hotReloadGreen: '#188038',
      hotReloadAmber: '#f29900',
      hotReloadRed: '#d93025',
      shadow: 'rgba(0, 0, 0, 0.15)',
      focusRing: '#1a73e8',
      hoverOverlay: 'rgba(0, 0, 0, 0.04)',
      disabledFg: '#80868b',
      disabledBg: '#f3f3f3',
      inputBg: '#ffffff',
      inputBorder: '#e0e0e0',
      inputFg: '#1f1f1f',
      inputPlaceholderFg: '#5f6368',
      badgeSuccessBg: '#188038',
      badgeSuccessFg: '#ffffff',
      badgeWarningBg: '#f29900',
      badgeWarningFg: '#1f1f1f',
      badgeErrorBg: '#d93025',
      badgeErrorFg: '#ffffff',
      badgeInfoBg: '#1a73e8',
      badgeInfoFg: '#ffffff',
      badgeDefaultBg: '#5f6368',
      badgeDefaultFg: '#ffffff',
    },
  },
} as const;

export type Theme = 'dark' | 'light';

export interface ColorTokens {
  bgCanvas: string;
  bgPanel: string;
  bgElevated: string;
  bgActive: string;
  fgPrimary: string;
  fgSecondary: string;
  fgMuted: string;
  borderSubtle: string;
  borderStrong: string;
  accentPrimary: string;
  accentDanger: string;
  accentWarning: string;
  accentSuccess: string;
  serverRunning: string;
  serverStopped: string;
  serverError: string;
  hotReloadGreen: string;
  hotReloadAmber: string;
  hotReloadRed: string;
  shadow: string;
  focusRing: string;
  hoverOverlay: string;
  disabledFg: string;
  disabledBg: string;
  inputBg: string;
  inputBorder: string;
  inputFg: string;
  inputPlaceholderFg: string;
  badgeSuccessBg: string;
  badgeSuccessFg: string;
  badgeWarningBg: string;
  badgeWarningFg: string;
  badgeErrorBg: string;
  badgeErrorFg: string;
  badgeInfoBg: string;
  badgeInfoFg: string;
  badgeDefaultBg: string;
  badgeDefaultFg: string;
}

export interface ComponentTokens {
  tabs: {
    height: number;
    gap: number;
    paddingX: number;
    activeBorderWidth: number;
  };
  table: {
    headerHeight: number;
    rowHeight: number;
    cellPaddingX: number;
    cellPaddingY: number;
  };
  list: {
    itemPaddingX: number;
    itemPaddingY: number;
    gap: number;
    iconSize: number;
  };
  emptyState: {
    glyphSize: number;
    maxWidth: number;
    paddingY: number;
  };
  badge: {
    paddingX: number;
    paddingY: number;
    radius: number;
    fontSize: number;
  };
  form: {
    fieldGap: number;
    labelGap: number;
    inputHeight: number;
    inputPaddingX: number;
  };
}

export function getColors(theme: Theme): ColorTokens {
  return tokens.color[theme] as unknown as ColorTokens;
}

export const components: ComponentTokens = tokens.components as unknown as ComponentTokens;

export const KAIRO_BRAND = {
  name: 'Kairo',
  shortName: 'Kairo',
  // Set in docs/ui-spec.md; do not change without product review.
  primaryMark: '#4a9eff',
} as const;

export const KAIRO_VERSION = '0.1.0';

export const KAIRO_HOT_RELOAD_LABELS: Record<string, string> = {
  staticSync: 'Static Sync',
  compileOnly: 'Compile Only',
  classHotSwap: 'Class HotSwap',
  contextReload: 'Context Reload',
};
