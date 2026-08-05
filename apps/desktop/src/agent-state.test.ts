/**
 * Run with: pnpm --filter @kairo/desktop test
 */

import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  agentStateJsonContainsSecret,
  parseAgentStateJson,
  resolveAgentSecretFromEnv,
} from './agent-state';

describe('agent-state', () => {
  it('parseAgentStateJson reads port and pid without secret', () => {
    const record = parseAgentStateJson(
      JSON.stringify({
        port: 18080,
        pid: 42,
        bindAddress: '127.0.0.1',
        startedAt: '2026-08-04T00:00:00Z',
      }),
    );
    assert.ok(record);
    assert.strictEqual(record.port, 18080);
    assert.strictEqual(record.pid, 42);
    assert.strictEqual(record.bindAddress, '127.0.0.1');
  });

  it('parseAgentStateJson ignores legacy secret field', () => {
    const record = parseAgentStateJson(
      JSON.stringify({ port: 9, pid: 1, secret: 'leaked-do-not-use' }),
    );
    assert.ok(record);
    assert.strictEqual(record.port, 9);
    assert.strictEqual((record as { secret?: string }).secret, undefined);
    assert.strictEqual(agentStateJsonContainsSecret('{"port":1,"secret":"x"}'), true);
    assert.strictEqual(
      agentStateJsonContainsSecret('{"port":1,"pid":2}'),
      false,
    );
  });

  it('resolveAgentSecretFromEnv reads KAIRO_LOCAL_SECRET only', () => {
    assert.strictEqual(resolveAgentSecretFromEnv({}), '');
    assert.strictEqual(
      resolveAgentSecretFromEnv({ KAIRO_LOCAL_SECRET: '  abc  ' }),
      'abc',
    );
  });
});
