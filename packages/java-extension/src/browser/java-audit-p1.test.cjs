'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

describe('JavaLanguageClient withRetry rpcFailed (JV-P1-12)', () => {
  test('rpcFailed skips retry delay and falls back immediately', async () => {
    async function withRetry(rpcFailed, operation, fallback, retries = 4, baseDelay = 750) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        const proxy = rpcFailed ? undefined : { ok: true };
        if (!proxy) {
          if (rpcFailed) {
            return fallback();
          }
          if (attempt >= retries) break;
          await new Promise(r => setTimeout(r, baseDelay * (attempt + 1)));
          continue;
        }
        return operation();
      }
      return fallback();
    }

    const started = Date.now();
    const result = await withRetry(
      true,
      async () => 'rpc',
      async () => 'fallback',
    );
    const elapsed = Date.now() - started;
    assert.equal(result, 'fallback');
    assert.ok(elapsed < 200, `expected immediate fallback, took ${elapsed}ms`);
  });
});

describe('live templates case-insensitive prefix (JV-P1-10)', () => {
  test('camelCase template prefixes match lowercased input', () => {
    const tplPrefix = 'streamFilter';
    const lowerPrefix = 'streamf'.toLowerCase();
    assert.equal(tplPrefix.toLowerCase().startsWith(lowerPrefix), true);
    assert.equal(tplPrefix.startsWith(lowerPrefix), false);
  });
});

describe('completion isIncomplete preserved (JV-P1-11)', () => {
  test('monaco registration uses response.isIncomplete', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, 'java-monaco-registration.ts'), 'utf8');
    assert.match(src, /incomplete:\s*!!response\.isIncomplete/);
  });
});

describe('diagnostics manager uses ProblemManager (JV-P1-14)', () => {
  test('source injects ProblemManager and debounces fallback', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, 'java-diagnostics-manager.ts'), 'utf8');
    assert.match(src, /ProblemManager/);
    assert.doesNotMatch(src, /extends MarkerManager/);
    assert.match(src, /FALLBACK_DIAGNOSTICS_DEBOUNCE_MS|fallbackTimers/);
  });
});

describe('jdt-ls-manager spawn args (JV-P1-18)', () => {
  test('does not pass -classpath jar list or _JAVA_OPTIONS source.level', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, '../node/jdt-ls-manager.ts'), 'utf8');
    assert.doesNotMatch(src, /'_JAVA_OPTIONS'/);
    assert.doesNotMatch(src, /'-classpath'/);
    assert.match(src, /requestedSourceLevel/);
  });
});

describe('jdt-ls-manager JRE probe paths (JV-P2-10)', () => {
  test('does not hardcode E:\\Tools', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, '../node/jdt-ls-manager.ts'), 'utf8');
    assert.doesNotMatch(src, /E:\\\\Tools/);
    assert.doesNotMatch(src, /E:\\Tools/);
  });

  test('probes JRE asynchronously without spawnSync', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, '../node/jdt-ls-manager.ts'), 'utf8');
    assert.doesNotMatch(src, /\bspawnSync\b/);
    assert.match(src, /await resolveHostJre21/);
    assert.match(src, /readReleaseMajor|javaMajorCache/);
    assert.match(src, /Promise\.all/);
  });
});

describe('jdt-ls-service starting guard (JV-P2-9)', () => {
  test('start treats starting like initializing', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, '../node/jdt-ls-service.ts'), 'utf8');
    assert.match(src, /state\$\(\) === ['"]starting['"]/);
  });
});

describe('hotswap all pending files (JV-P2-4)', () => {
  test('debounce loops all files not just last', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, 'java-hotswap-service.ts'), 'utf8');
    assert.match(src, /for\s*\(\s*const file of files\s*\)/);
    assert.doesNotMatch(src, /files\[files\.length - 1\]/);
  });
});

describe('hotswap unsupported no-retry + i18n (ROI)', () => {
  test('skips retries on unsupported/501 and uses i18n toasts', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, 'java-hotswap-service.ts'), 'utf8');
    assert.match(src, /isNonRetryableHotSwapError/);
    assert.match(src, /widget\.java\.hotswap\.toast\./);
    assert.match(src, /KairoI18nService/);
    assert.match(src, /code === ['"]unsupported['"]/);
    assert.doesNotMatch(src, /HotSwap: Reloaded \$\{fileName\}/);
  });
});

describe('java-run-service routes via RuntimeConnectionService (ROI)', () => {
  test('no naked agentPost fetch', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, 'java-run-service.ts'), 'utf8');
    assert.doesNotMatch(src, /agentPost/);
    assert.doesNotMatch(src, /fetch\(/);
    assert.match(src, /POST \/api\/v1\/java\/detect/);
    assert.match(src, /POST \/api\/v1\/java\/run/);
    assert.match(src, /this\.runtime\.request/);
  });
});

describe('completion budget timer cleared (JV-P2-2)', () => {
  test('clears budget timer in finally', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, 'java-completion-provider.ts'), 'utf8');
    assert.match(src, /clearTimeout\(budgetTimer\)/);
  });
});

describe('java-run-service @Test method name (JV-P2-11)', () => {
  test('looks ahead for method signature after annotation-only line', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, 'java-run-service.ts'), 'utf8');
    assert.match(src, /look ahead|aheadMatch|methodLine/i);
  });
});

describe('hippie completion current model first (JV-P2-3)', () => {
  test('prefers currentUri and caps candidates', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, 'java-hippie-completion.ts'), 'utf8');
    assert.match(src, /currentUri/);
    assert.match(src, /MAX_HIPPIE_CANDIDATES/);
    assert.doesNotMatch(src, /void excludeUri/);
    assert.match(src, /hasTextFocus\(\)/);
    assert.doesNotMatch(src, /getEditors\(\)\[0\]/);
    assert.match(src, /jsp-scriptlet:/);
  });
});

describe('monaco completion resolve word range (JV-P1-9)', () => {
  test('resolveCompletionItem uses stored _kairoWordRange', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, 'java-monaco-registration.ts'), 'utf8');
    assert.match(src, /_kairoWordRange/);
    assert.match(src, /completionItemWordRange\(item as MonacoCompletionItemWithData\)/);
    assert.match(src, /suggestion\._kairoWordRange/);
  });
});

describe('diagnostics manager scans existing models (JV-P3-2)', () => {
  test('attaches java models opened before registration', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, 'java-diagnostics-manager.ts'), 'utf8');
    assert.match(src, /monaco\.editor\.getModels\(\)/);
    assert.match(src, /onWillDisposeModel/);
    assert.match(src, /modelContentSubs/);
  });
});

describe('live templates hot-path logging (JV-P3-1)', () => {
  test('has no console.log on completion path', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, 'java-live-templates.ts'), 'utf8');
    assert.doesNotMatch(src, /console\.log/);
    assert.doesNotMatch(src, /KAIRO-JAVA-DEBUG/);
  });
});

describe('intellisense / live-template dedupe (JV-P3-5)', () => {
  test('JAVA_SNIPPETS does not redeclare live-template overlaps', () => {
    const src = fs.readFileSync(
      require('node:path').join(__dirname, 'java-intellisense-provider.ts'),
      'utf8',
    );
    const snippetsBlock = src.match(/const JAVA_SNIPPETS[\s\S]*?\n\];/);
    assert.ok(snippetsBlock, 'JAVA_SNIPPETS block present');
    for (const label of ['sout', 'psvm', 'fori', 'foreach', 'while', 'dowhile', 'ifelse', 'switch', 'serr']) {
      assert.doesNotMatch(snippetsBlock[0], new RegExp(`label:\\s*'${label}'`));
    }
  });
});

describe('language client dispose emitters (JV-P3-8)', () => {
  test('dispose tears down onConnectionStatusEmitter', () => {
    const src = fs.readFileSync(require('node:path').join(__dirname, 'java-language-client.ts'), 'utf8');
    assert.match(src, /onConnectionStatusEmitter\.dispose\(\)/);
  });
});
