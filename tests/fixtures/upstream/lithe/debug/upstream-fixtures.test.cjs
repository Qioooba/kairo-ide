'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  BreakpointMigrationCoordinator,
  VariablePagingManager,
  DebugDisconnectPolicy,
  SteppingFilterManager,
  ExceptionBreakpointManager,
} = require('../../../../../packages/java-extension/lib/browser/java-debug-capabilities');

const FIXTURES_DIR = __dirname;

describe('Lithe Upstream Golden Contract Fixtures (Section 12.2 / L09 ~ L11 & Section 12.3)', () => {
  it('L09: validates breakpoint-relocation-v1.json', () => {
    const fixturePath = path.join(FIXTURES_DIR, 'breakpoint-relocation-v1.json');
    assert.ok(fs.existsSync(fixturePath), 'breakpoint-relocation-v1.json must exist');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    const coordinator = new BreakpointMigrationCoordinator();

    for (const c of fixture.cases) {
      coordinator.setBreakpoints(c.initial.uri, c.initial.breakpoints);

      const result = coordinator.applyLineEdit({
        uri: c.initial.uri,
        startLine: c.edit.startLine,
        linesDelta: c.edit.linesDelta,
        deletedCount: c.edit.deletedCount,
        transactionId: c.edit.transactionId,
      });

      assert.strictEqual(result.applied, c.expected.applied, `${c.id}: applied state`);
      assert.strictEqual(result.migrated.length, c.expected.breakpoints.length, `${c.id}: count`);

      for (let i = 0; i < c.expected.breakpoints.length; i++) {
        const expectedBp = c.expected.breakpoints[i];
        const actualBp = result.migrated[i];
        assert.strictEqual(actualBp.line, expectedBp.line, `${c.id}: line`);
        assert.strictEqual(actualBp.condition, expectedBp.condition, `${c.id}: condition`);
        assert.strictEqual(actualBp.hitCondition, expectedBp.hitCondition, `${c.id}: hitCondition`);
        assert.strictEqual(actualBp.logMessage, expectedBp.logMessage, `${c.id}: logMessage`);
        assert.strictEqual(actualBp.enabled, expectedBp.enabled, `${c.id}: enabled`);
      }
    }
  });

  it('L10: validates disconnect-policy-v1.json', () => {
    const fixturePath = path.join(FIXTURES_DIR, 'disconnect-policy-v1.json');
    assert.ok(fs.existsSync(fixturePath), 'disconnect-policy-v1.json must exist');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    for (const c of fixture.cases) {
      const actual = DebugDisconnectPolicy.determineDisconnectArguments(c.input);
      assert.strictEqual(
        actual.terminateDebuggee,
        c.expected.terminateDebuggee,
        `${c.id}: terminateDebuggee must match`,
      );
      assert.strictEqual(
        actual.restart,
        c.expected.restart,
        `${c.id}: restart must match`,
      );
    }
  });

  it('L11: validates variable-paging-v1.json', () => {
    const fixturePath = path.join(FIXTURES_DIR, 'variable-paging-v1.json');
    assert.ok(fs.existsSync(fixturePath), 'variable-paging-v1.json must exist');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    for (const c of fixture.cases) {
      const pages = VariablePagingManager.createPageDescriptors(
        c.input.variablesReference,
        c.input.totalCount,
        c.input.pageSize,
      );

      assert.strictEqual(pages.length, c.expected.pageCount, `${c.id}: page count`);

      if (c.expected.firstPage) {
        assert.deepEqual(pages[0], c.expected.firstPage, `${c.id}: first page`);
      }
      if (c.expected.lastPage) {
        assert.deepEqual(pages[pages.length - 1], c.expected.lastPage, `${c.id}: last page`);
      }
      if (c.expected.pages) {
        assert.deepEqual(pages, c.expected.pages, `${c.id}: pages`);
      }
    }
  });

  it('Section 12.3: validates stepping-filters-v1.json', () => {
    const fixturePath = path.join(FIXTURES_DIR, 'stepping-filters-v1.json');
    assert.ok(fs.existsSync(fixturePath), 'stepping-filters-v1.json must exist');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    const manager = new SteppingFilterManager();

    for (const c of fixture.cases) {
      const skip = manager.shouldSkipStep(c.targetClass);
      assert.strictEqual(skip, c.expectedSkip, `${c.id}: shouldSkipStep for ${c.targetClass}`);
    }
  });

  it('Section 12.3: validates exception-info-v1.json', () => {
    const fixturePath = path.join(FIXTURES_DIR, 'exception-info-v1.json');
    assert.ok(fs.existsSync(fixturePath), 'exception-info-v1.json must exist');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    const manager = new ExceptionBreakpointManager();

    for (const c of fixture.cases) {
      manager.setFilter('caught', c.activeFilter === 'caught');
      manager.setFilter('uncaught', c.activeFilter === 'uncaught');

      const shouldBreak = manager.shouldBreakOnException(c.exception);
      assert.strictEqual(shouldBreak, c.expectedBreak, `${c.id}: shouldBreakOnException`);
    }
  });
});
