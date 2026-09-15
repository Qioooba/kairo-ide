// UI-00: UI surface coverage manifest generator (REPORT §7.1).
//
// Scans production sources for WidgetFactory registrations (factory ids),
// ReactDialog subclasses and kairo.* command registrations, then merges them
// with the curated state matrix to produce docs/ui-audit/surface-manifest.json.
//
// The scan only inventories — it is NOT a UI test. Every surface starts at
// status "uncovered"; a surface becomes "covered" only with real rendering
// evidence (artifacts/ui-audit/<run-id>/... + human review.json).
// Usage: node tests/e2e/ui-surface-manifest.cjs [--write]
'use strict';

const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..', '..');
const write = process.argv.includes('--write');
const outFile = path.join(repo, 'docs', 'ui-audit', 'surface-manifest.json');

function read(rel) {
  try {
    return fs.readFileSync(path.join(repo, rel), 'utf8');
  } catch {
    return '';
  }
}

// 1. Factory ids = candidate widget surfaces.
const factorySrc = read('packages/theia-product/src/main/browser/kairo-factory-ids.ts');
const factories = [...factorySrc.matchAll(/export const (\w+)\s*=\s*'([^']+)'/g)]
  .map(m => ({ constName: m[1], factoryId: m[2] }));

// 2. ReactDialog subclasses = dialog surfaces.
const dialogHits = [];
{
  const files = [
    'packages/project-extension/src/browser/project-structure-dialog.tsx',
  ];
  for (const rel of files) {
    const src = read(rel);
    const m = src.match(/export class (\w+)\s+extends\s+ReactDialog/);
    if (m) dialogHits.push({ className: m[1], file: rel });
  }
}

// 3. Curated state matrix (REPORT §7.6 core cases + widget states).
const states = {
  loading: ['project-structure', 'toolbar-projects', 'run-configurations'],
  empty: ['run-configurations', 'sql-results', 'debug-tool-window', 'notifications', 'todo'],
  error: ['project-structure', 'run-configurations', 'sql-results', 'toolbar-projects'],
  busy: ['run-configurations', 'sql-console', 'toolbar'],
  disconnected: ['sql-console', 'remote', 'debug-tool-window'],
};

// 4. Entry actions (command palette labels observed in campaign specs).
const entryActions = {
  'kairo-run-configurations': 'Kairo: Manage Run Configurations',
  'kairo-sql-console': 'Kairo: Show SQL Console',
  'kairo-debug-tool-window': 'Debug Tool Window',
  'kairo-toolbar': '(always visible)',
  'kairo-notification-center': 'kairo.notification.toggle',
  'kairo-remote': 'Kairo: Show Remote Development',
};

const surfaces = factories.map(f => {
  const short = f.factoryId.replace(/^kairo-/, '');
  return {
    surfaceId: f.factoryId,
    constName: f.constName,
    sourceFiles: [`packages/theia-product/src/main/browser/*${short}*.tsx`],
    entryAction: entryActions[f.factoryId] || '(see kairo-views-contribution)',
    parentSurface: f.factoryId === 'kairo-toolbar' ? 'shell' : 'main-area',
    supportedStates: Object.entries(states)
      .filter(([, ids]) => ids.some(id => f.factoryId.includes(id.replace(/-/g, '-')) || short.includes(id.split('-')[0])))
      .map(([state]) => state),
    caseIds: [],
    screenshots: [],
    reviewer: '',
    status: 'uncovered',
  };
});

const manifest = {
  generatedAt: new Date().toISOString(),
  auditBaseline: '6ea00095d1d2a93c3f79ce2a15803b2f893d92ef',
  note: 'Seed inventory from static scan. Runtime-discovered nested dialogs, context submenus and error popups must be appended during real runs; surfaces absent here are NOT exempt from testing (REPORT §7.1).',
  counts: { surfaces: surfaces.length, covered: 0, uncovered: surfaces.length },
  dialogs: dialogHits,
  surfaces,
};

if (write) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.log(`wrote ${outFile} (${surfaces.length} surfaces)`);
} else {
  console.log(JSON.stringify(manifest, null, 2));
}
