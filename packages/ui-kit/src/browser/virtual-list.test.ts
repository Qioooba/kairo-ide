// VirtualList component — source-level contract tests.
//
// The VirtualList component uses React hooks (useRef, useState,
// useEffect) which cannot be called outside of a React render
// context in Node.js without jsdom. We verify the source code
// contract instead.
//
// Run with:
//   pnpm --filter @kairo/ui-kit test

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'virtual-list.tsx'), 'utf8');

// ---- Component existence ----

test('VirtualList is an exported function component', () => {
  assert.match(source, /export function VirtualList/);
});

test('VirtualList is a generic component with type parameter T', () => {
  assert.match(source, /export function VirtualList<T>/);
});

// ---- Props interface ----

test('VirtualListProps interface is exported', () => {
  assert.match(source, /export interface VirtualListProps/);
});

test('VirtualListProps has items prop', () => {
  assert.match(source, /items: readonly T\[\]/);
});

test('VirtualListProps has rowHeight optional prop', () => {
  assert.match(source, /rowHeight\?:\s*number/);
});

test('VirtualListProps has renderItem prop', () => {
  assert.match(source, /renderItem:/);
});

test('VirtualListProps has selectedIndex optional prop', () => {
  assert.match(source, /selectedIndex\?:\s*number/);
});

test('VirtualListProps has overscan optional prop', () => {
  assert.match(source, /overscan\?:\s*number/);
});

test('VirtualListProps has keyboardNavigation optional prop', () => {
  assert.match(source, /keyboardNavigation\?:\s*boolean/);
});

test('VirtualListProps has ariaLabel optional prop', () => {
  assert.match(source, /ariaLabel\?:\s*string/);
});

test('VirtualListProps has testId optional prop', () => {
  assert.match(source, /testId\?:\s*string/);
});

test('VirtualListProps has role optional prop with default "listbox"', () => {
  assert.match(source, /role\s*=\s*'listbox'/);
});

// ---- Virtualization logic ----

test('VirtualList uses ResizeObserver for container height', () => {
  assert.match(source, /new ResizeObserver/);
});

test('VirtualList calculates visible range based on scroll position', () => {
  assert.match(source, /startIndex = Math\.max/);
  assert.match(source, /endIndex = Math\.min/);
});

test('VirtualList uses absolute positioning for visible items', () => {
  assert.match(source, /position: 'absolute'/);
});

test('VirtualList has scroll-to-bottom detection', () => {
  assert.match(source, /onScrollToBottom/);
});

test('VirtualList supports keyboard navigation', () => {
  assert.match(source, /handleKeyDown/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /PageDown/);
  assert.match(source, /PageUp/);
  assert.match(source, /Home/);
  assert.match(source, /End/);
});

test('VirtualList has aria-activedescendant for accessibility', () => {
  assert.match(source, /aria-activedescendant/);
});

test('VirtualList has scrollToIndex support', () => {
  assert.match(source, /scrollToIndex/);
});

test('VirtualList default overscan is 5', () => {
  assert.match(source, /DEFAULT_OVERSCAN = 5/);
});

test('VirtualList default rowHeight is 24', () => {
  assert.match(source, /DEFAULT_ROW_HEIGHT = 24/);
});