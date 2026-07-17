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
    },
  },
} as const;

export type Theme = 'dark' | 'light';
export type ColorTokens = typeof tokens.color.dark;

export function getColors(theme: Theme): ColorTokens {
  return tokens.color[theme];
}

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
