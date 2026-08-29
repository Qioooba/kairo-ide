// SPDX-License-Identifier: Apache-2.0
//
// Theia JSON-RPC contract for the Kairo Git backend service.
//
// The browser frontend cannot spawn `git` (node:child_process is an
// unimplemented stub in the browser bundle), so every git CLI call is
// delegated to the Node.js backend over JSON-RPC — mirroring the
// svn-extension pattern.

export const GitBackendPath = '/services/kairo-git-backend';

/** Browser → backend: execute git CLI commands. */
export const GitBackendService = Symbol('GitBackendService');

export interface GitCommandResult {
  stdout: string;
}

export interface GitBackendService {
  /**
   * Execute `git <args>` with C locale env in the given working directory.
   * Rejects with the underlying exec error when git exits non-zero.
   */
  $exec(args: string[], cwd: string, maxBuffer?: number): Promise<GitCommandResult>;
  /** Walk up from cwd to find the enclosing git repository top-level. */
  $findRepoRoot(cwd: string): Promise<string | undefined>;
  /**
   * Find the nearest git repository around cwd: first scanning DOWN into
   * subdirectories (workspaces often act as containers holding several
   * project repos, e.g. workspace/<project>/.git), then falling back to
   * the standard upward walk. Depth bounds the downward scan.
   */
  $findNearestRepoRoot(cwd: string, maxDepth?: number): Promise<string | undefined>;
}
