/**
 * Kairo IDE general settings schema.
 *
 * Registers Kairo-branded preference categories that appear in the
 * Theia Preferences widget (Cmd+,). Theia already provides the
 * search bar, tree view, scope tabs, and value editing — this
 * schema just declares the Kairo-specific keys.
 */

import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';

export const kairoSettingsPreferenceSchema: PreferenceSchema = {
  title: 'Kairo IDE',
  properties: {
    // ── General ──────────────────────────────────────────────
    'kairo.general.showWelcome': {
      type: 'boolean',
      default: true,
      description: 'Show the Welcome tab on startup when no project is active.',
    },
    'kairo.general.confirmBeforeDelete': {
      type: 'boolean',
      default: true,
      description: 'Show a confirmation dialog before deleting files.',
    },
    'kairo.general.autoRevealInExplorer': {
      type: 'boolean',
      default: true,
      description: 'Automatically reveal the active file in the Explorer view.',
    },
    // ── Appearance ───────────────────────────────────────────
    'kairo.appearance.fontSize': {
      type: 'number',
      default: 14,
      minimum: 8,
      maximum: 32,
      description: 'Editor font size in pixels.',
    },
    'kairo.appearance.fontFamily': {
      type: 'string',
      default: 'monospace',
      description: 'Editor font family.',
    },
    'kairo.appearance.lineHeight': {
      type: 'number',
      default: 1.5,
      minimum: 1,
      maximum: 3,
      description: 'Editor line height multiplier.',
    },
    'kairo.appearance.tabSize': {
      type: 'number',
      default: 4,
      minimum: 1,
      maximum: 16,
      description: 'Number of spaces per indentation level.',
    },
    'kairo.appearance.insertSpaces': {
      type: 'boolean',
      default: true,
      description: 'Insert spaces when pressing Tab.',
    },
    // ── Build ────────────────────────────────────────────────
    'kairo.build.autoClean': {
      type: 'boolean',
      default: false,
      description: 'Automatically clean before each build.',
    },
    'kairo.build.showVerboseLogs': {
      type: 'boolean',
      default: false,
      description: 'Show verbose build output including compiler warnings.',
    },
    'kairo.build.maxBuildHistory': {
      type: 'number',
      default: 50,
      minimum: 1,
      maximum: 500,
      description: 'Maximum number of build records to keep in history.',
    },
    // ── Server ───────────────────────────────────────────────
    'kairo.server.autoStart': {
      type: 'boolean',
      default: false,
      description: 'Automatically start the Tomcat server when a project is loaded.',
    },
    'kairo.server.autoStop': {
      type: 'boolean',
      default: true,
      description: 'Automatically stop the Tomcat server when the IDE closes.',
    },
    'kairo.server.defaultHttpPort': {
      type: 'number',
      default: 8080,
      minimum: 1024,
      maximum: 65535,
      description: 'Default HTTP port for new Tomcat server instances.',
    },
    'kairo.server.defaultDebugPort': {
      type: 'number',
      default: 8000,
      minimum: 1024,
      maximum: 65535,
      description: 'Default JDWP debug port for new Tomcat server instances.',
    },
    'kairo.server.logMaxLines': {
      type: 'number',
      default: 10000,
      minimum: 100,
      maximum: 100000,
      description: 'Maximum number of log lines to keep in the Tomcat Logs view.',
    },
    // ── Encoding ─────────────────────────────────────────────
    'kairo.encoding.defaultProjectEncoding': {
      type: 'string',
      enum: ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be', 'gbk', 'gb18030', 'iso-8859-1', 'us-ascii'],
      default: 'utf-8',
      description: 'Default encoding for new Kairo projects.',
    },
    'kairo.encoding.autoDetect': {
      type: 'boolean',
      default: true,
      description: 'Automatically detect file encoding based on content.',
    },
    // ── Hot Reload ───────────────────────────────────────────
    'kairo.hotReload.autoSyncOnSave': {
      type: 'boolean',
      default: true,
      description: 'Automatically compile and sync Java files when saved.',
    },
    'kairo.hotReload.onFrameDeactivation': {
      type: 'boolean',
      default: true,
      description: 'Automatically save all files when the IDE window loses focus.',
    },
    'kairo.hotReload.autoCompileJava': {
      type: 'boolean',
      default: true,
      description: 'Automatically compile Java files on save (non-debug mode).',
    },
    'kairo.hotReload.debounceMs': {
      type: 'number',
      default: 500,
      minimum: 200,
      maximum: 3000,
      description: 'Debounce delay in milliseconds before triggering hot deploy after save.',
    },
    // ── Search ───────────────────────────────────────────────
    'kairo.search.excludePatterns': {
      type: 'array',
      default: ['**/node_modules', '**/.git', '**/WEB-INF/lib', '**/*.class'],
      description: 'Glob patterns to exclude from file search.',
    },
    'kairo.search.maxResults': {
      type: 'number',
      default: 10000,
      minimum: 100,
      maximum: 100000,
      description: 'Maximum number of search results to display.',
    },
  },
};

export const KairoSettingsPreferenceContribution: PreferenceContribution = {
  schema: kairoSettingsPreferenceSchema,
};