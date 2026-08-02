'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const srcDir = __dirname;

describe('Search Extension — Search Service Exports (source check)', () => {
  it('index.ts exports KairoSearchService and KairoSearchCancelledError', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /KairoSearchService/);
    assert.match(source, /KairoSearchCancelledError/);
  });
});

describe('Search Extension — Search Session Model Exports (source check)', () => {
  it('index.ts exports KairoSearchSessionModel', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /KairoSearchSessionModel/);
  });
});

describe('Search Extension — Search Stream Service Exports (source check)', () => {
  it('index.ts exports SearchStreamService', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /SearchStreamService/);
  });
});

describe('Search Extension — Search Widget Exports (source check)', () => {
  it('index.ts exports SearchCenterWidget and SearchCenterComponent', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /SearchCenterWidget/);
    assert.match(source, /SearchCenterComponent/);
  });

  it('index.ts exports groupMatchesByFile and parseGlobInput', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /groupMatchesByFile/);
    assert.match(source, /parseGlobInput/);
  });

  it('index.ts exports resolveWorkspaceMatchUri', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /resolveWorkspaceMatchUri/);
  });
});

describe('Search Extension — Search Everywhere Exports (source check)', () => {
  it('index.ts exports SearchEverywhereWidget and SearchEverywhereModel', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /SearchEverywhereWidget/);
    assert.match(source, /SearchEverywhereModel/);
  });

  it('index.ts exports fuzzyScore and DoubleShiftDetector', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /fuzzyScore/);
    assert.match(source, /DoubleShiftDetector/);
  });
});

describe('Search Extension — Search Replace Service Exports (source check)', () => {
  it('index.ts exports SearchReplaceService, locateEdits, applyEdits, fingerprint', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /SearchReplaceService/);
    assert.match(source, /locateEdits/);
    assert.match(source, /applyEdits/);
    assert.match(source, /fingerprint/);
    assert.match(source, /SEARCH_REPLACE_MAX_FILE_BYTES/);
  });
});

describe('Search Extension — Find Models Exports (source check)', () => {
  it('index.ts exports FindFileModel, FindClassModel, FindSymbolModel, FindActionModel', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /FindFileModel/);
    assert.match(source, /FindClassModel/);
    assert.match(source, /FindSymbolModel/);
    assert.match(source, /FindActionModel/);
  });
});

describe('Search Extension — Find Widgets Exports (source check)', () => {
  it('index.ts exports FindFileWidget, FindClassWidget, FindSymbolWidget, FindActionWidget', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /FindFileWidget/);
    assert.match(source, /FindClassWidget/);
    assert.match(source, /FindSymbolWidget/);
    assert.match(source, /FindActionWidget/);
  });
});

describe('Search Extension — Search Scope Model Exports (source check)', () => {
  it('index.ts exports SearchScopeModel, SCOPE_OPTIONS, GROUP_MODE_OPTIONS', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /SearchScopeModel/);
    assert.match(source, /SCOPE_OPTIONS/);
    assert.match(source, /GROUP_MODE_OPTIONS/);
  });
});
describe('Search Extension — Find Tool Window Exports (source check)', () => {
  it('index.ts exports SearchResultsWidget, FileIndexService, parseFileMask', () => {
    const source = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
    assert.match(source, /SearchResultsWidget/);
    assert.match(source, /FileIndexService/);
    assert.match(source, /parseFileMask/);
  });
});
