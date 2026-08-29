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
import { normalizeFsPath } from '../browser/git-path-utils';
import { GitBackendService, GitCommandResult } from '../common/git-protocol';

const execFileAsync = promisify(execFile);

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
    const { stdout } = await execFileAsync('git', args, { cwd, env: gitEnv(), maxBuffer });
    return { stdout };
  }

  async $findRepoRoot(cwd: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        env: gitEnv(),
      });
      return normalizeFsPath(stdout.trim());
    } catch {
      return undefined;
    }
  }

  async $findNearestRepoRoot(cwd: string, maxDepth = 2): Promise<string | undefined> {
    // 1. Downward BFS: workspace folders frequently contain project repos.
    const queue: Array<{ dir: string; depth: number }> = [{ dir: cwd, depth: 0 }];
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
    return this.$findRepoRoot(cwd);
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
