import URI from '@theia/core/lib/common/uri';

export function resolveWorkspaceMatchUri(workspaceRoot: string, file: string): URI {
  const candidate = file.trim();
  if (!candidate || /^[a-z][a-z\d+.-]*:/i.test(candidate) || /^[\\/]/.test(candidate)) throw new Error(`Unsafe search result path: ${file}`);
  const normalized = candidate.replace(/\\/g, '/');
  if (normalized.split('/').some(segment => segment === '..' || decode(segment) === '..')) throw new Error(`Search result escapes the workspace: ${file}`);
  const root = URI.fromFilePath(workspaceRoot).normalizePath(); const resolved = root.resolve(normalized).normalizePath();
  if (!root.isEqualOrParent(resolved)) throw new Error(`Search result escapes the workspace: ${file}`);
  return resolved;
}
function decode(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
