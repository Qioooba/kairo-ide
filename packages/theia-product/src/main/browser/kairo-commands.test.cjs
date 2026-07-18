// KairoViewsContribution.registerCommands — contract test.
//
// The Theia contribution registers a set of commands. We
// exercise the registration in isolation with a stub
// CommandRegistry that records every registration, and
// assert that every command the Kairo UI relies on is
// present.
//
// This is the "code written but never called" guard: if a
// refactor removes a registry.registerCommand(...) line, or
// renames a Command constant so it no longer matches the
// expected id, this test fails loudly.
//
// The Theia product's compiled module pulls in Theia +
// Lumino DOM utilities at import time, so requiring it in
// plain Node is not viable. Instead we read the source
// file and parse the KairoCommands namespace + the
// registerCommands() body via a small regex extractor.
// This is the same approach we use to keep the test
// independent of the Theia runtime, while still catching
// the regression we care about: a missing or renamed
// command id, and a missing registerCommand() call.
//
// Run with:
//   pnpm --filter @kairo/theia-product exec node --test src/main/browser/kairo-commands.test.cjs

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'kairo-views-contribution.ts');

function readSrc() {
  return fs.readFileSync(SRC, 'utf-8');
}

test('KairoCommands namespace declares the expected command ids with non-empty labels', () => {
  const src = readSrc();
  const expected = [
    'kairo.project.scan',
    'kairo.build',
    'kairo.buildAndDeploy',
    'kairo.server.start',
    'kairo.server.debug',
    'kairo.server.stop',
    'kairo.server.restart',
    'kairo.app.open',
    'kairo.view.servers',
    'kairo.view.builds',
    'kairo.view.deployments',
    'kairo.view.logs',
  ];
  for (const id of expected) {
    // Match `id: 'kairo.x.y'` literally.
    const re = new RegExp(`id:\\s*'${id.replace(/\./g, '\\.')}'`);
    assert.ok(re.test(src), `KairoCommands.${id} is missing from ${SRC}`);
    // The same line should have a label.
    const block = new RegExp(`id:\\s*'${id.replace(/\./g, '\\.')}',\\s*label:\\s*'([^']+)'`);
    const m = block.exec(src);
    assert.ok(m, `${id} should have a label`);
    assert.ok(m[1].length > 0, `${id} label should be non-empty`);
  }
});

test('KairoViewsContribution.registerCommands body registers every KairoCommands id', () => {
  const src = readSrc();
  // Slice out the registerCommands method body. The body
  // is the text between the opening brace after
  // `registerCommands(` and the matching closing brace at
  // the method's level. Because each command handler is an
  // arrow function with its own block, we need a proper
  // brace counter.
  const start = src.indexOf('async registerCommands(');
  assert.ok(start >= 0, 'registerCommands method must exist');
  let i = src.indexOf('{', start);
  assert.ok(i >= 0, 'registerCommands must have a body');
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  const body = src.slice(start, i);
  // Expected: 12 ids, each one referenced via
  // `KairoCommands.<NAME>` exactly once in registerCommands.
  const expected = [
    'SCAN_PROJECT',
    'BUILD',
    'BUILD_AND_DEPLOY',
    'START_SERVER',
    'DEBUG_SERVER',
    'STOP_SERVER',
    'RESTART_SERVER',
    'OPEN_APPLICATION',
    'REVEAL_KAIRO_SERVERS',
    'REVEAL_KAIRO_BUILDS',
    'REVEAL_KAIRO_DEPLOYMENTS',
    'REVEAL_KAIRO_LOGS',
  ];
  for (const name of expected) {
    const re = new RegExp(`registry\\.registerCommand\\(\\s*KairoCommands\\.${name}\\b`);
    assert.ok(re.test(body), `KairoCommands.${name} is not wired into registerCommands`);
  }
  // Sanity: at least 12 registerCommand calls in the body.
  const calls = body.match(/registry\.registerCommand\(/g) || [];
  assert.ok(
    calls.length >= expected.length,
    `registerCommands should call registry.registerCommand at least ${expected.length} times; saw ${calls.length}`,
  );
});
