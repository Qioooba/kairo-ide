// SPDX-License-Identifier: Apache-2.0
//
// Shared path helpers for SVN status matching across Windows/macOS/Linux.
// Windows `svn status --xml` returns absolute paths; the UI and decorators
// always work with WC-relative forward-slash paths.

/**
 * Convert an absolute (or already-relative) status path into a WC-relative
 * path using forward slashes. Returns '' for the WC root itself.
 */
export function toWcRelativePath(filePath: string, wcRoot: string): string {
  if (!filePath) return '';
  if (!wcRoot) return filePath.replace(/\\/g, '/');

  const normFile = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normRoot = wcRoot.replace(/\\/g, '/').replace(/\/+$/, '');

  const lowerFile = normFile.toLowerCase();
  const lowerRoot = normRoot.toLowerCase();

  if (lowerFile === lowerRoot) return '';
  if (lowerFile.startsWith(lowerRoot + '/')) {
    return normFile.substring(normRoot.length + 1);
  }

  // Already relative (no drive / no leading slash matching root)
  if (!/^[a-zA-Z]:\//.test(normFile) && !normFile.startsWith('/')) {
    return normFile;
  }
  return normFile;
}

/**
 * Strip a file: URI (or bare path) down to a filesystem path string.
 * Handles `file:///G:/foo`, `file:///g%3A/foo`, and plain paths.
 */
export function uriOrPathToFsPath(uriOrPath: string): string {
  if (!uriOrPath) return '';
  if (!uriOrPath.startsWith('file:')) {
    return uriOrPath;
  }
  let rest = uriOrPath.replace(/^file:\/\//, '');
  // file:///G:/x → /G:/x ; file://localhost/G:/x → localhost/G:/x
  if (rest.startsWith('localhost/')) {
    rest = rest.substring('localhost/'.length);
  }
  try {
    rest = decodeURIComponent(rest);
  } catch {
    // keep undecoded
  }
  // /G:/path or /g:/path → G:/path
  if (/^\/[a-zA-Z]:/.test(rest)) {
    rest = rest.substring(1);
  }
  return rest.replace(/\\/g, '/');
}

/**
 * Resolve a URI or absolute path to a WC-relative path, or undefined if
 * the path is outside the working copy.
 */
export function toWcRelativeFromUri(uriOrPath: string, wcRoot: string): string | undefined {
  if (!wcRoot) return undefined;
  const fsPath = uriOrPathToFsPath(uriOrPath);
  const rel = toWcRelativePath(fsPath, wcRoot);
  const normFs = fsPath.replace(/\\/g, '/').toLowerCase();
  const normRoot = wcRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (normFs === normRoot || normFs.startsWith(normRoot + '/')) {
    return rel;
  }
  // Relative path that doesn't look absolute — accept as-is
  if (!/^[a-zA-Z]:\//.test(fsPath.replace(/\\/g, '/')) && !fsPath.startsWith('/') && !uriOrPath.startsWith('file:')) {
    return fsPath.replace(/\\/g, '/');
  }
  return undefined;
}
