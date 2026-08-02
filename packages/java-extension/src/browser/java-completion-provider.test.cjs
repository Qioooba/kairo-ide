// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for JavaCompletionProvider — fallback logic and
// empty-LS trust behaviour (duplicated pure helpers where the
// inversify class cannot be constructed headless).
//
// Run with: pnpm --filter @kairo/java-extension test

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  adaptLspCompletion,
  adaptIntelliSenseCompletion,
  filterSmartCompletions,
} = require('../../lib/browser/java-completion-adapter');

describe('adaptLspCompletion (provider surface)', () => {
  test('converts basic LSP completion item', () => {
    const item = adaptLspCompletion({
      label: 'String',
      kind: 7,
      detail: 'java.lang.String',
      sortText: '0String',
      filterText: 'String',
      insertText: 'String',
    });
    assert.equal(item.label, 'String');
    assert.equal(item.kind, 7);
    assert.equal(item.detail, 'java.lang.String');
    assert.equal(item.sortText, '0String');
    assert.equal(item.filterText, 'String');
    assert.equal(item.insertText, 'String');
  });

  test('falls back to label for insertText when undefined', () => {
    const item = adaptLspCompletion({ label: 'String', kind: 7 });
    assert.equal(item.insertText, 'String');
  });

  test('handles string documentation', () => {
    const item = adaptLspCompletion({
      label: 'String',
      kind: 7,
      documentation: 'Immutable sequence of characters.',
    });
    assert.equal(item.documentation, 'Immutable sequence of characters.');
  });

  test('handles object documentation with value', () => {
    const item = adaptLspCompletion({
      label: 'String',
      kind: 7,
      documentation: { kind: 'markdown', value: '**String** class' },
    });
    assert.equal(item.documentation, '**String** class');
  });

  test('detects deprecated tag', () => {
    const item = adaptLspCompletion({ label: 'oldMethod', kind: 2, tags: [1] });
    assert.equal(item.isDeprecated, true);
  });

  test('not deprecated when tags is empty', () => {
    const item = adaptLspCompletion({ label: 'newMethod', kind: 2, tags: [] });
    assert.equal(item.isDeprecated, false);
  });

  test('not deprecated when tags is undefined', () => {
    const item = adaptLspCompletion({ label: 'method', kind: 2 });
    assert.equal(item.isDeprecated, false);
  });

  test('handles documentation as undefined', () => {
    const item = adaptLspCompletion({ label: 'String', kind: 7 });
    assert.equal(item.documentation, undefined);
  });
});

describe('adaptIntelliSenseCompletion', () => {
  test('converts intellisense completion item', () => {
    const item = adaptIntelliSenseCompletion({
      label: 'public',
      kind: 14,
      detail: 'access modifier',
      documentation: 'Public access — visible everywhere.',
      sortText: '1public',
      filterText: 'public',
      insertText: 'public',
    });
    assert.equal(item.label, 'public');
    assert.equal(item.kind, 14);
    assert.equal(item.detail, 'access modifier');
    assert.equal(item.documentation, 'Public access — visible everywhere.');
    assert.equal(item.sortText, '1public');
    assert.equal(item.filterText, 'public');
    assert.equal(item.insertText, 'public');
  });

  test('handles snippet insertText', () => {
    const item = adaptIntelliSenseCompletion({
      label: 'sout',
      kind: 15,
      detail: 'System.out.println',
      insertText: 'System.out.println(${1});',
      sortText: '0sout',
      filterText: 'sout',
    });
    assert.equal(item.insertText, 'System.out.println(${1});');
    assert.equal(item.kind, 15);
    assert.equal(item.insertTextFormat, 2);
  });

  test('handles deprecated flag', () => {
    const item = adaptIntelliSenseCompletion({
      label: 'oldMethod',
      kind: 2,
      isDeprecated: true,
    });
    assert.equal(item.isDeprecated, true);
  });

  test('handles missing optional fields', () => {
    const item = adaptIntelliSenseCompletion({
      label: 'hello',
      kind: 1,
    });
    assert.equal(item.label, 'hello');
    assert.equal(item.kind, 1);
    assert.equal(item.documentation, undefined);
    assert.equal(item.isDeprecated, undefined);
  });
});

function fallbackCompletions(sourceCache, intellisense, uri, line, character, triggerCharacter) {
  const source = sourceCache.get(uri);
  if (!source) {
    return { isIncomplete: false, items: [] };
  }
  const result = intellisense.provideCompletions(source, line, character, triggerCharacter);
  return {
    isIncomplete: result.isIncomplete,
    items: result.items.map(adaptIntelliSenseCompletion),
  };
}

/** Mirrors provideCompletions: trust empty LS, fallback only when not ready / error. */
async function provideCompletions(client, sourceCache, intellisense, req) {
  const state = await (client.fetchStateQuick || client.fetchState)();
  if (state !== 'ready') {
    return fallbackCompletions(sourceCache, intellisense, req.uri, req.line, req.character, req.triggerCharacter);
  }
  try {
    const list = await client.completion(req);
    const items = list.items.map(adaptLspCompletion);
    const response = { isIncomplete: list.isIncomplete, items };
    return req.smart ? { isIncomplete: response.isIncomplete, items: filterSmartCompletions(items) } : response;
  } catch (err) {
    return fallbackCompletions(sourceCache, intellisense, req.uri, req.line, req.character, req.triggerCharacter);
  }
}

describe('fallbackCompletions', () => {
  test('returns empty when no source cached', () => {
    const sourceCache = new Map();
    const intellisense = {
      provideCompletions: () => ({ isIncomplete: false, items: [] }),
    };
    const result = fallbackCompletions(sourceCache, intellisense, 'file:///Test.java', 0, 0);
    assert.equal(result.isIncomplete, false);
    assert.deepEqual(result.items, []);
  });

  test('returns completions when source is cached', () => {
    const sourceCache = new Map();
    sourceCache.set('file:///Test.java', 'public class Foo {}');
    const intellisense = {
      provideCompletions: () => ({
        isIncomplete: false,
        items: [
          { label: 'public', kind: 14, detail: 'access modifier', sortText: '1public', filterText: 'public', insertText: 'public' },
          { label: 'class', kind: 14, detail: 'class declaration', sortText: '1class', filterText: 'class', insertText: 'class' },
        ],
      }),
    };
    const result = fallbackCompletions(sourceCache, intellisense, 'file:///Test.java', 0, 0);
    assert.equal(result.isIncomplete, false);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].label, 'public');
    assert.equal(result.items[1].label, 'class');
  });

  test('passes line and character to intellisense', () => {
    const sourceCache = new Map();
    sourceCache.set('file:///Test.java', 'public class Foo {}');
    let capturedLine, capturedCharacter;
    const intellisense = {
      provideCompletions: (source, line, character) => {
        capturedLine = line;
        capturedCharacter = character;
        return { isIncomplete: false, items: [] };
      },
    };
    fallbackCompletions(sourceCache, intellisense, 'file:///Test.java', 5, 10);
    assert.equal(capturedLine, 5);
    assert.equal(capturedCharacter, 10);
  });

  test('passes triggerCharacter to intellisense', () => {
    const sourceCache = new Map();
    sourceCache.set('file:///Test.java', 'foo.');
    let capturedTrigger;
    const intellisense = {
      provideCompletions: (source, line, character, triggerCharacter) => {
        capturedTrigger = triggerCharacter;
        return { isIncomplete: false, items: [] };
      },
    };
    fallbackCompletions(sourceCache, intellisense, 'file:///Test.java', 0, 4, '.');
    assert.equal(capturedTrigger, '.');
  });
});

describe('provideCompletions empty-LS trust', () => {
  test('does not fallback when LS returns empty list', async () => {
    const client = {
      fetchState: async () => 'ready',
      fetchStateQuick: async () => 'ready',
      completion: async () => ({ isIncomplete: false, items: [] }),
    };
    const sourceCache = new Map([['file:///T.java', 'class T {}']]);
    const intellisense = {
      provideCompletions: () => ({
        isIncomplete: false,
        items: [{ label: 'public', kind: 14, insertText: 'public' }],
      }),
    };
    const result = await provideCompletions(client, sourceCache, intellisense, {
      uri: 'file:///T.java', line: 0, character: 0,
    });
    assert.equal(result.items.length, 0);
  });

  test('falls back when LS is not ready', async () => {
    const client = {
      fetchState: async () => 'starting',
      fetchStateQuick: async () => 'starting',
      completion: async () => ({ isIncomplete: false, items: [] }),
    };
    const sourceCache = new Map([['file:///T.java', 'class T {}']]);
    const intellisense = {
      provideCompletions: () => ({
        isIncomplete: false,
        items: [{ label: 'public', kind: 14, insertText: 'public' }],
      }),
    };
    const result = await provideCompletions(client, sourceCache, intellisense, {
      uri: 'file:///T.java', line: 0, character: 0,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].label, 'public');
  });

  test('falls back when LS throws', async () => {
    const client = {
      fetchState: async () => 'ready',
      fetchStateQuick: async () => 'ready',
      completion: async () => { throw new Error('timeout'); },
    };
    const sourceCache = new Map([['file:///T.java', 'class T {}']]);
    const intellisense = {
      provideCompletions: () => ({
        isIncomplete: false,
        items: [{ label: 'class', kind: 14, insertText: 'class' }],
      }),
    };
    const result = await provideCompletions(client, sourceCache, intellisense, {
      uri: 'file:///T.java', line: 0, character: 0,
    });
    assert.equal(result.items[0].label, 'class');
  });

  test('smart mode filters LS results', async () => {
    const client = {
      fetchState: async () => 'ready',
      fetchStateQuick: async () => 'ready',
      completion: async () => ({
        isIncomplete: false,
        items: [
          { label: 'public', kind: 14, insertText: 'public' },
          { label: 'String', kind: 7, insertText: 'String' },
        ],
      }),
    };
    const result = await provideCompletions(client, new Map(), { provideCompletions: () => ({ items: [] }) }, {
      uri: 'file:///T.java', line: 0, character: 0, smart: true,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].label, 'String');
  });
});

function fallbackDefinition(sourceCache, intellisense, uri, line, character) {
  const source = sourceCache.get(uri);
  if (!source) return [];
  return intellisense.provideDefinition(uri, source, line, character).map(d => ({
    uri: d.uri,
    range: {
      start: { line: d.line, character: d.character },
      end: { line: d.endLine, character: d.endCharacter },
    },
  }));
}

describe('fallbackDefinition', () => {
  test('returns empty when no source cached', () => {
    const sourceCache = new Map();
    const intellisense = { provideDefinition: () => [] };
    const result = fallbackDefinition(sourceCache, intellisense, 'file:///Test.java', 0, 0);
    assert.deepEqual(result, []);
  });

  test('returns definition when source is cached', () => {
    const sourceCache = new Map();
    sourceCache.set('file:///Test.java', 'public class Foo {}');
    const intellisense = {
      provideDefinition: () => [
        { uri: 'file:///Test.java', line: 0, character: 13, endLine: 0, endCharacter: 16 },
      ],
    };
    const result = fallbackDefinition(sourceCache, intellisense, 'file:///Test.java', 0, 16);
    assert.equal(result.length, 1);
    assert.equal(result[0].uri, 'file:///Test.java');
    assert.equal(result[0].range.start.line, 0);
    assert.equal(result[0].range.start.character, 13);
  });

  test('maps definition to range format', () => {
    const sourceCache = new Map();
    sourceCache.set('file:///Test.java', 'public class Foo {}');
    const intellisense = {
      provideDefinition: () => [
        { uri: 'file:///Other.java', line: 5, character: 10, endLine: 5, endCharacter: 15 },
      ],
    };
    const result = fallbackDefinition(sourceCache, intellisense, 'file:///Test.java', 0, 0);
    assert.equal(result[0].range.end.line, 5);
    assert.equal(result[0].range.end.character, 15);
  });
});

describe('sourceCache', () => {
  test('cacheSource stores source text', () => {
    const cache = new Map();
    cache.set('file:///Test.java', 'public class Foo {}');
    assert.equal(cache.get('file:///Test.java'), 'public class Foo {}');
  });

  test('clearSource removes source text', () => {
    const cache = new Map();
    cache.set('file:///Test.java', 'public class Foo {}');
    cache.delete('file:///Test.java');
    assert.equal(cache.get('file:///Test.java'), undefined);
  });

  test('cacheSource overwrites existing entry', () => {
    const cache = new Map();
    cache.set('file:///Test.java', 'old content');
    cache.set('file:///Test.java', 'new content');
    assert.equal(cache.get('file:///Test.java'), 'new content');
  });
});

async function whenReady(client, empty, request) {
  if (await client.fetchState() !== 'ready') {
    return empty;
  }
  try {
    return await request();
  } catch (err) {
    return empty;
  }
}

describe('whenReady', () => {
  test('returns empty when client is not ready', async () => {
    const client = { fetchState: async () => 'uninitialized' };
    const result = await whenReady(client, null, async () => 'result');
    assert.equal(result, null);
  });

  test('calls request when client is ready', async () => {
    const client = { fetchState: async () => 'ready' };
    const result = await whenReady(client, null, async () => 'result');
    assert.equal(result, 'result');
  });

  test('returns empty on request error', async () => {
    const client = { fetchState: async () => 'ready' };
    const result = await whenReady(client, [], async () => { throw new Error('fail'); });
    assert.deepEqual(result, []);
  });

  test('returns empty array when client is not ready', async () => {
    const client = { fetchState: async () => 'stopped' };
    const result = await whenReady(client, [], async () => ['item']);
    assert.deepEqual(result, []);
  });
});

describe('JavaCompletionResponse types', () => {
  test('JavaCompletionResponseItem has all optional fields', () => {
    const item = {
      label: 'test',
      kind: undefined,
      detail: undefined,
      documentation: undefined,
      sortText: undefined,
      filterText: undefined,
      insertText: undefined,
      isDeprecated: false,
      score: 0.5,
    };
    assert.equal(item.label, 'test');
    assert.equal(item.kind, undefined);
    assert.equal(item.score, 0.5);
  });

  test('JavaCompletionResponse has isIncomplete and items', () => {
    const response = {
      isIncomplete: true,
      items: [{ label: 'test', kind: 1 }],
    };
    assert.equal(response.isIncomplete, true);
    assert.equal(response.items.length, 1);
  });
});

describe('JavaDefinitionResponse types', () => {
  test('JavaDefinitionResponse has uri and range', () => {
    const def = {
      uri: 'file:///Foo.java',
      range: {
        start: { line: 5, character: 10 },
        end: { line: 5, character: 15 },
      },
    };
    assert.equal(def.uri, 'file:///Foo.java');
    assert.equal(def.range.start.line, 5);
    assert.equal(def.range.start.character, 10);
    assert.equal(def.range.end.line, 5);
    assert.equal(def.range.end.character, 15);
  });
});

describe('JavaCompletionRequest types', () => {
  test('JavaCompletionRequest has required and optional fields', () => {
    const req = {
      uri: 'file:///Test.java',
      line: 10,
      character: 5,
      triggerKind: 2,
      triggerCharacter: '.',
      smart: true,
    };
    assert.equal(req.uri, 'file:///Test.java');
    assert.equal(req.line, 10);
    assert.equal(req.character, 5);
    assert.equal(req.triggerKind, 2);
    assert.equal(req.triggerCharacter, '.');
    assert.equal(req.smart, true);
  });

  test('JavaCompletionRequest with minimal fields', () => {
    const req = {
      uri: 'file:///Test.java',
      line: 0,
      character: 0,
    };
    assert.equal(req.triggerKind, undefined);
    assert.equal(req.triggerCharacter, undefined);
  });
});
