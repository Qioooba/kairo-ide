'use strict';

/**
 * Tests for Kairo agent-config secret delivery policy (S1 residual).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const SRC = path.join(__dirname, 'kairo-agent-config-contribution.ts');

// Prefer compiled helpers when available; otherwise assert source policy.
let shouldSkipHtmlAgentConfigInjection;
let shouldInjectAgentSecret;
let buildAgentConfigInjectScript;
let isSameOriginAgentSecretRequest;
try {
  ({
    shouldSkipHtmlAgentConfigInjection,
    shouldInjectAgentSecret,
    buildAgentConfigInjectScript,
    isSameOriginAgentSecretRequest,
  } = require('../../../lib/node/kairo-agent-config-contribution'));
} catch {
  shouldSkipHtmlAgentConfigInjection = null;
  shouldInjectAgentSecret = null;
  buildAgentConfigInjectScript = null;
  isSameOriginAgentSecretRequest = null;
}

test('source never puts agentSecret on kairoConfig or embeds secret in HTML', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.doesNotMatch(src, /kairoConfig\s*=\s*\{[^}]*agentSecret/);
  assert.match(src, /KAIRO_AGENT_SECRET_VIA_PRELOAD/);
  assert.match(src, /\/kairo-agent-secret/);
  assert.doesNotMatch(src, /injectSecret:\s*true/);
  assert.doesNotMatch(src, /getSecret:\s*function/);
});

test('shouldSkipHtmlAgentConfigInjection is true when preload owns secret', () => {
  if (!shouldSkipHtmlAgentConfigInjection) {
    return;
  }
  assert.equal(shouldSkipHtmlAgentConfigInjection({ KAIRO_AGENT_SECRET_VIA_PRELOAD: '1' }), true);
  assert.equal(shouldSkipHtmlAgentConfigInjection({ KAIRO_DESKTOP: '1' }), true);
  assert.equal(shouldSkipHtmlAgentConfigInjection({ KAIRO_DESKTOP: '1', KAIRO_HEADLESS: '1' }), false);
  assert.equal(shouldSkipHtmlAgentConfigInjection({}), false);
});

test('shouldInjectAgentSecret is inverse of skip (deprecated alias)', () => {
  if (!shouldInjectAgentSecret || !shouldSkipHtmlAgentConfigInjection) {
    return;
  }
  assert.equal(shouldInjectAgentSecret({ KAIRO_AGENT_SECRET_VIA_PRELOAD: '1' }), false);
  assert.equal(shouldInjectAgentSecret({ KAIRO_DESKTOP: '1', KAIRO_HEADLESS: '1' }), true);
});

test('HTML inject script sets agentUrl only — never embeds secret', () => {
  if (!buildAgentConfigInjectScript) return;
  const script = buildAgentConfigInjectScript('http://127.0.0.1:18080');
  assert.doesNotMatch(script, /super-secret-token/);
  assert.doesNotMatch(script, /getSecret/);
  assert.doesNotMatch(script, /agentSecret\s*:/);
  assert.match(script, /kairoConfig/);
  assert.match(script, /agentUrl:\s*u/);
  assert.match(script, /agentBaseUrl:\s*u/);
});

test('isSameOriginAgentSecretRequest requires matching Origin or Referer', () => {
  if (!isSameOriginAgentSecretRequest) return;
  const okOrigin = {
    get(name) {
      if (name === 'host') return '127.0.0.1:3000';
      if (name === 'origin') return 'http://127.0.0.1:3000';
      return undefined;
    },
  };
  const badOrigin = {
    get(name) {
      if (name === 'host') return '127.0.0.1:3000';
      if (name === 'origin') return 'http://evil.example';
      return undefined;
    },
  };
  const okReferer = {
    get(name) {
      if (name === 'host') return '127.0.0.1:3000';
      if (name === 'referer') return 'http://127.0.0.1:3000/index.html';
      return undefined;
    },
  };
  const noHeaders = { get() { return undefined; } };

  assert.equal(isSameOriginAgentSecretRequest(okOrigin), true);
  assert.equal(isSameOriginAgentSecretRequest(okReferer), true);
  assert.equal(isSameOriginAgentSecretRequest(badOrigin), false);
  assert.equal(isSameOriginAgentSecretRequest(noHeaders), false);
});
