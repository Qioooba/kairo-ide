// SPDX-License-Identifier: Apache-2.0
//
// Kairo git-extension — Node.js backend service.
//
// Runs the real `git` CLI (child_process is only available here, never in
// the browser bundle) and returns raw stdout so all porcelain parsing
// logic stays in the shared frontend service.

import { injectable } from '@theia/core/shared/inversify';
import { execFile } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { normalizeFsPath } from '../common/git-path-utils';
import { GitBackendService, GitCommandResult } from '../common/git-protocol';

const execFileAsync = promisify(execFile);

/**
 * Convert the browser/Theia representation of a Windows drive path into a
 * native filesystem path.  URI.path is commonly received as `/g:/...` while
 * Node's Windows APIs require `G:/...`; treating the former as a POSIX path
 * makes repository discovery silently fail.
 */
function backendFsPath(value: string): string {
  const normalized = normalizeFsPath(value);
  return /^\/[a-zA-Z]:\//.test(normalized) ? normalized.substring(1) : normalized;
}

/** Force C locale so status/log output stays machine-parseable. */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...(typeof process !== 'undefined' ? process.env : {}),
    LANG: 'C',
    LC_ALL: 'C',
    LANGUAGE: 'C',
  };
}

@injectable()
export class GitBackendServiceImpl implements GitBackendService {
  async $exec(args: string[], cwd: string, maxBuffer = 1024 * 1024): Promise<GitCommandResult> {
    const { stdout } = await execFileAsync('git', args, { cwd: backendFsPath(cwd), env: gitEnv(), maxBuffer });
    return { stdout };
  }

  async $findRepoRoot(cwd: string): Promise<string | undefined> {
    const nativeCwd = backendFsPath(cwd);
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd: nativeCwd,
        env: gitEnv(),
      });
      return normalizeFsPath(stdout.trim());
    } catch {
      return undefined;
    }
  }

  async $findNearestRepoRoot(cwd: string, maxDepth = 2): Promise<string | undefined> {
    const nativeCwd = backendFsPath(cwd);
    // 1. Downward BFS: workspace folders frequently contain project repos.
    const queue: Array<{ dir: string; depth: number }> = [{ dir: nativeCwd, depth: 0 }];
    while (queue.length > 0) {
      const { dir, depth } = queue.shift()!;
      if (await this.isRepoRoot(dir)) {
        return normalizeFsPath(dir);
      }
      if (depth >= maxDepth) continue;
      let entries;
      try {
        entries = await fsPromises.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
      }
    }
    // 2. Standard upward walk from cwd.
    return this.$findRepoRoot(nativeCwd);
  }

  protected async isRepoRoot(dir: string): Promise<boolean> {
    try {
      const st = await fsPromises.stat(path.join(dir, '.git'));
      return st.isDirectory() || st.isFile();
    } catch {
      return false;
    }
  }
}
