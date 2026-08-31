import * as path from 'node:path';

/** Cross-platform filesystem roots shared by regression shards. */
const repoRoot = path.resolve(__dirname, '..', '..', '..');
export const regressionRoot = process.env.KAIRO_REGRESSION_ROOT ||
  path.join(process.env.KAIRO_TMP || path.join(repoRoot, 'tmp'), 'kairo-k4-workspace');

export function regressionWorkspace(shard: string): string {
  return path.join(regressionRoot, 'projects', `workspace-${shard}`);
}
