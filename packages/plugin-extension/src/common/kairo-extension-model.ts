/**
 * Kairo Extension Model — shared data types for extension management.
 *
 * These types describe the shape of an installed VS Code extension
 * as seen by the Kairo IDE. They do NOT describe the VS Code API
 * surface (that is handled by @theia/plugin-ext-vscode).
 */

/**
 * Represents a single installed VS Code extension.
 */
export interface KairoExtension {
  /** Unique identifier, e.g. "publisher.extension-name" */
  readonly id: string;
  /** Publisher as declared in package.json */
  readonly publisher: string;
  /** Extension name as declared in package.json */
  readonly name: string;
  /** Semantic version string */
  readonly version: string;
  /** Human-readable display name */
  readonly displayName: string;
  /** Short description from package.json */
  readonly description: string;
  /** Icon file path relative to extension root, or undefined */
  readonly icon?: string;
  /** Path to the extension's root directory on disk */
  readonly extensionPath: string;
  /** Whether the extension is currently enabled */
  readonly enabled: boolean;
  /** ISO-8601 timestamp of when the extension was installed */
  readonly installedAt: string;
  /** Categories from package.json (e.g. ["Programming Languages", "Themes"]) */
  readonly categories: string[];
  /** Activation events declared in package.json */
  readonly activationEvents: string[];
  /** Engine version requirement (vscode) from package.json */
  readonly engineVersion?: string;
  /** Whether this extension is on the allowlist (v1 curated mode) */
  readonly allowlisted: boolean;
  /** Whether this extension has been verified to work with Kairo */
  readonly verified: boolean;
}

/**
 * Manifest of installed extensions, persisted to disk.
 */
export interface ExtensionManifest {
  /** Schema version for forward compatibility */
  readonly schemaVersion: 1;
  /** Map of extension id -> metadata */
  readonly extensions: Record<string, ExtensionManifestEntry>;
}

export interface ExtensionManifestEntry {
  readonly id: string;
  readonly version: string;
  enabled: boolean;
  readonly installedAt: string;
  readonly allowlisted: boolean;
  readonly verified: boolean;
}

/**
 * Allowlist entry — defines a known-good extension.
 */
export interface AllowlistEntry {
  /** Publisher + extension name, e.g. "vscjava.vscode-java-pack" */
  readonly id: string;
  /** Human-readable reason for inclusion */
  readonly reason: string;
  /** Optional: known compatibility notes */
  readonly notes?: string;
  /** Optional: version range that has been verified */
  readonly verifiedVersionRange?: string;
}

/**
 * Allowlist structure — persisted to allowlist.json.
 */
export interface Allowlist {
  readonly schemaVersion: 1;
  readonly entries: AllowlistEntry[];
}

/**
 * Result of an extension installation operation.
 */
export type InstallResult =
  | { readonly success: true; readonly extension: KairoExtension }
  | { readonly success: false; readonly error: string; readonly errorCode: InstallErrorCode };

export enum InstallErrorCode {
  /** The .vsix file is corrupt or not a valid zip */
  INVALID_VSIX = 'INVALID_VSIX',
  /** package.json is missing or malformed in the extension */
  MISSING_MANIFEST = 'MISSING_MANIFEST',
  /** Extension is not on the allowlist (v1 curated mode) */
  NOT_ALLOWLISTED = 'NOT_ALLOWLISTED',
  /** Extension with same id+version is already installed */
  ALREADY_INSTALLED = 'ALREADY_INSTALLED',
  /** Filesystem error during extraction */
  FS_ERROR = 'FS_ERROR',
  /** The extension requires a VS Code engine version not supported by Theia */
  ENGINE_NOT_SUPPORTED = 'ENGINE_NOT_SUPPORTED',
}

/**
 * Default empty allowlist — no extensions are pre-approved.
 * Users with admin access can populate this file.
 */
export const DEFAULT_ALLOWLIST: Allowlist = {
  schemaVersion: 1,
  entries: [
    // Common Java ecosystem extensions that are known to work with Theia 1.73.1
    {
      id: 'redhat.java',
      reason: 'Red Hat Java Language Support — core Java editing',
      notes: 'Uses JDT LS; may conflict with Kairo built-in Java LS. Disable Kairo Java LS first.',
    },
    {
      id: 'vscjava.vscode-java-debug',
      reason: 'Java Debugger — DAP-based debug adapter',
      notes: 'May conflict with Kairo built-in debug. Test with caution.',
    },
    {
      id: 'vscjava.vscode-maven',
      reason: 'Maven for Java — pom.xml editing and lifecycle',
      notes: 'Kairo has built-in Maven support; use only if Kairo Maven is insufficient.',
    },
    {
      id: 'SonarSource.sonarlint-vscode',
      reason: 'SonarLint — on-the-fly code quality analysis',
    },
    {
      id: 'EditorConfig.EditorConfig',
      reason: 'EditorConfig — consistent coding styles across editors',
    },
    {
      id: 'DavidAnson.vscode-markdownlint',
      reason: 'Markdown linting',
    },
    {
      id: 'yzhang.markdown-all-in-one',
      reason: 'Markdown editing enhancements',
    },
    {
      id: 'streetsidesoftware.code-spell-checker',
      reason: 'Code spell checker',
    },
    {
      id: 'bierner.markdown-mermaid',
      reason: 'Mermaid diagram support in Markdown preview',
    },
  ],
};

/**
 * Constants for the extension system.
 */
export const KAIRO_EXTENSIONS_DIR_NAME = '.kairo';
export const KAIRO_EXTENSIONS_SUBDIR = 'extensions';
export const KAIRO_EXTENSIONS_MANIFEST = 'extensions.json';
export const KAIRO_ALLOWLIST_FILE = 'allowlist.json';