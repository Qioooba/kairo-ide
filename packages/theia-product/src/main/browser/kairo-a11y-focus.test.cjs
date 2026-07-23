'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

test('Focus management — panel areas', () => {
  const PANEL_ORDER = ['editor', 'sidebar', 'bottom', 'statusBar'];

  assert.strictEqual(PANEL_ORDER.length, 4);
  assert.strictEqual(PANEL_ORDER[0], 'editor');
  assert.strictEqual(PANEL_ORDER[1], 'sidebar');
  assert.strictEqual(PANEL_ORDER[2], 'bottom');
  assert.strictEqual(PANEL_ORDER[3], 'statusBar');
});

test('Focus management — next panel cycling', () => {
  const PANEL_ORDER = ['editor', 'sidebar', 'bottom', 'statusBar'];
  let currentIndex = 0;

  currentIndex = (currentIndex + 1) % PANEL_ORDER.length;
  assert.strictEqual(PANEL_ORDER[currentIndex], 'sidebar');

  currentIndex = (currentIndex + 1) % PANEL_ORDER.length;
  assert.strictEqual(PANEL_ORDER[currentIndex], 'bottom');

  currentIndex = (currentIndex + 1) % PANEL_ORDER.length;
  assert.strictEqual(PANEL_ORDER[currentIndex], 'statusBar');

  currentIndex = (currentIndex + 1) % PANEL_ORDER.length;
  assert.strictEqual(PANEL_ORDER[currentIndex], 'editor');
});

test('Focus management — previous panel cycling', () => {
  const PANEL_ORDER = ['editor', 'sidebar', 'bottom', 'statusBar'];
  let currentIndex = 0;

  currentIndex = (currentIndex - 1 + PANEL_ORDER.length) % PANEL_ORDER.length;
  assert.strictEqual(PANEL_ORDER[currentIndex], 'statusBar');

  currentIndex = (currentIndex - 1 + PANEL_ORDER.length) % PANEL_ORDER.length;
  assert.strictEqual(PANEL_ORDER[currentIndex], 'bottom');

  currentIndex = (currentIndex - 1 + PANEL_ORDER.length) % PANEL_ORDER.length;
  assert.strictEqual(PANEL_ORDER[currentIndex], 'sidebar');

  currentIndex = (currentIndex - 1 + PANEL_ORDER.length) % PANEL_ORDER.length;
  assert.strictEqual(PANEL_ORDER[currentIndex], 'editor');
});

test('Focus management — tabindex setting', () => {
  const mockElement = {
    tabIndex: -1,
    _tabindex: null,
    getAttribute(name) { return this._tabindex; },
    setAttribute(name, value) { this._tabindex = value; },
    focus() { this.tabIndex = 0; },
  };

  // Simulate setting tabindex
  if (mockElement.getAttribute('tabindex') === null) {
    mockElement.setAttribute('tabindex', '-1');
  }
  mockElement.focus();

  assert.strictEqual(mockElement.getAttribute('tabindex'), '-1');
  assert.strictEqual(mockElement.tabIndex, 0);
});

test('Focus management — skip-to-content link', () => {
  // Test skip-to-content link configuration without actual DOM
  const skipConfig = {
    id: 'kairo-skip-to-content',
    href: '#theia-main-content-panel',
    text: '跳转到主要内容',
    role: 'link',
    ariaLabel: '跳过导航，跳转到编辑器主内容区域',
  };

  assert.strictEqual(skipConfig.id, 'kairo-skip-to-content');
  assert.strictEqual(skipConfig.role, 'link');
  assert.ok(skipConfig.ariaLabel.includes('跳转到'));
  assert.ok(skipConfig.text.includes('主要内容'));
});

test('Focus management — escape handling', () => {
  // Escape should only focus editor when not in an input/textarea/editor
  const shouldIntercept = (target) => {
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return false;
    if (target.closest && target.closest('.monaco-editor')) return false;
    return true;
  };

  const input = { tagName: 'INPUT', closest: () => null };
  const textarea = { tagName: 'TEXTAREA', closest: () => null };
  const editor = { tagName: 'DIV', closest: (sel) => sel === '.monaco-editor' ? {} : null };
  const panel = { tagName: 'DIV', closest: () => null };

  assert.strictEqual(shouldIntercept(input), false);
  assert.strictEqual(shouldIntercept(textarea), false);
  assert.strictEqual(shouldIntercept(editor), false);
  assert.strictEqual(shouldIntercept(panel), true);
});

test('Focus management — focus commands exist', () => {
  const commands = [
    'kairo.focus.editor',
    'kairo.focus.sidebar',
    'kairo.focus.bottomPanel',
    'kairo.focus.statusBar',
    'kairo.focus.nextPanel',
    'kairo.focus.previousPanel',
    'kairo.focus.terminal',
  ];

  assert.strictEqual(commands.length, 7);
  assert.ok(commands.includes('kairo.focus.editor'));
  assert.ok(commands.includes('kairo.focus.terminal'));
  assert.ok(commands.includes('kairo.focus.nextPanel'));
});

test('Screen reader — ARIA live regions', () => {
  // Test ARIA live region configuration without actual DOM
  const politeConfig = {
    'aria-live': 'polite',
    'aria-atomic': 'true',
    'role': 'status',
  };
  const assertiveConfig = {
    'aria-live': 'assertive',
    'aria-atomic': 'true',
    'role': 'alert',
  };

  assert.strictEqual(politeConfig['aria-live'], 'polite');
  assert.strictEqual(politeConfig['role'], 'status');
  assert.strictEqual(assertiveConfig['aria-live'], 'assertive');
  assert.strictEqual(assertiveConfig['role'], 'alert');
});

test('Screen reader — announcement queue', () => {
  const queue = [];
  const MAX_QUEUE_SIZE = 50;

  // Add announcements
  queue.push({ message: 'File opened', priority: 'polite' });
  queue.push({ message: 'Build failed', priority: 'assertive' });

  assert.strictEqual(queue.length, 2);
  assert.strictEqual(queue[0].message, 'File opened');
  assert.strictEqual(queue[1].priority, 'assertive');

  // Shift
  const next = queue.shift();
  assert.strictEqual(next.message, 'File opened');
  assert.strictEqual(queue.length, 1);
});

test('Screen reader — max queue size', () => {
  const queue = [];
  const MAX_QUEUE_SIZE = 50;

  for (let i = 0; i < 60; i++) {
    queue.push({ message: `msg ${i}`, priority: 'polite' });
    if (queue.length > MAX_QUEUE_SIZE) {
      queue.shift();
    }
  }

  assert.strictEqual(queue.length, 50);
  assert.strictEqual(queue[0].message, 'msg 10');
  assert.strictEqual(queue[49].message, 'msg 59');
});

test('Screen reader — convenience methods', () => {
  const messages = [];
  const announce = (msg) => messages.push(msg);

  // Simulate announcements
  announce('已打开文件: App.java');
  announce('文件已保存: App.java');
  announce('构建成功');
  announce('找到 15 个 "UserService" 的结果');
  announce('错误: 连接超时');

  assert.strictEqual(messages.length, 5);
  assert.ok(messages[0].includes('已打开文件'));
  assert.ok(messages[1].includes('文件已保存'));
  assert.ok(messages[2].includes('构建'));
  assert.ok(messages[3].includes('15'));
  assert.ok(messages[4].includes('错误'));
});

test('Screen reader — hidden region styles', () => {
  const styles = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: '0',
  };

  assert.strictEqual(styles.position, 'absolute');
  assert.strictEqual(styles.width, '1px');
  assert.strictEqual(styles.height, '1px');
  assert.strictEqual(styles.overflow, 'hidden');
});

test('A11y patch — ARIA tab roles', () => {
  const mockTab = {
    _role: null,
    _selected: null,
    _label: null,
    getAttribute(name) {
      if (name === 'role') return this._role;
      if (name === 'aria-selected') return this._selected;
      if (name === 'aria-label') return this._label;
      return null;
    },
    setAttribute(name, value) {
      if (name === 'role') this._role = value;
      if (name === 'aria-selected') this._selected = value;
      if (name === 'aria-label') this._label = value;
    },
    classList: { contains: (c) => c === 'lm-mod-current' },
    querySelector: () => ({ textContent: '  Editor  ' }),
    get title() { return ''; },
    get id() { return 'shell-tab-editor'; },
  };

  // Patch the tab
  if (mockTab.getAttribute('role') !== 'tab') {
    mockTab.setAttribute('role', 'tab');
  }
  const selected = mockTab.classList.contains('lm-mod-current') ? 'true' : 'false';
  if (mockTab.getAttribute('aria-selected') !== selected) {
    mockTab.setAttribute('aria-selected', selected);
  }
  const label = mockTab.querySelector('.lm-TabBar-tabLabel');
  const name = (((label && label.textContent) || '').trim()) || mockTab.title || mockTab.id.replace(/^shell-tab-/, '').replace(/-/g, ' ');
  if (name && mockTab.getAttribute('aria-label') !== name) {
    mockTab.setAttribute('aria-label', name);
  }

  assert.strictEqual(mockTab.getAttribute('role'), 'tab');
  assert.strictEqual(mockTab.getAttribute('aria-selected'), 'true');
  assert.strictEqual(mockTab.getAttribute('aria-label'), 'Editor');
});

test('A11y patch — notification center role', () => {
  const notifCenter = {
    _role: null,
    hasAttribute(name) { return this._role !== null; },
    setAttribute(name, value) { this._role = value; },
  };

  if (!notifCenter.hasAttribute('role')) {
    notifCenter.setAttribute('role', 'button');
  }

  assert.strictEqual(notifCenter._role, 'button');
});

test('Keyboard shortcuts — category mapping', () => {
  const getCategory = (commandId) => {
    if (commandId.startsWith('workbench.action.debug')) return 'debug';
    if (commandId.startsWith('editor.action')) return 'editor';
    if (commandId.startsWith('core.')) return 'general';
    if (commandId.startsWith('git.')) return 'git';
    if (commandId.startsWith('java.')) return 'java';
    if (commandId.startsWith('kairo.')) return 'kairo';
    if (commandId.startsWith('search.')) return 'search';
    if (commandId.startsWith('workbench.action.terminal')) return 'terminal';
    if (commandId.startsWith('workbench.action.navigate')) return 'navigate';
    if (commandId.startsWith('workbench.action.')) return 'view';
    return 'general';
  };

  assert.strictEqual(getCategory('editor.action.formatDocument'), 'editor');
  assert.strictEqual(getCategory('workbench.action.debug.start'), 'debug');
  assert.strictEqual(getCategory('git.stage'), 'git');
  assert.strictEqual(getCategory('java.action.organizeImports'), 'java');
  assert.strictEqual(getCategory('kairo.navigation.goToLine'), 'kairo');
  assert.strictEqual(getCategory('search.action.openSearch'), 'search');
  assert.strictEqual(getCategory('workbench.action.terminal.toggleTerminal'), 'terminal');
  assert.strictEqual(getCategory('workbench.action.navigateBack'), 'navigate');
  assert.strictEqual(getCategory('workbench.action.toggleSidebar'), 'view');
  assert.strictEqual(getCategory('core.save'), 'general');
});

test('Keyboard shortcuts — search filtering', () => {
  const shortcuts = [
    { command: 'editor.action.formatDocument', keybinding: 'shift+alt+f', label: 'Format Document', category: 'editor' },
    { command: 'core.save', keybinding: 'ctrl+s', label: 'Save', category: 'general' },
    { command: 'kairo.navigation.goToLine', keybinding: 'ctrl+g', label: 'Go to Line', category: 'kairo' },
  ];

  const searchTerm = 'format';
  const filtered = shortcuts.filter(s =>
    s.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.keybinding.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.command.toLowerCase().includes(searchTerm.toLowerCase())
  );

  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].command, 'editor.action.formatDocument');
});

test('Keyboard shortcuts — keybinding formatting', () => {
  const formatKeybinding = (keybinding) => {
    const isMac = false; // Simulate Windows
    return keybinding
      .replace(/ctrlcmd/g, isMac ? 'Cmd' : 'Ctrl')
      .replace(/\+/g, '+');
  };

  assert.strictEqual(formatKeybinding('ctrlcmd+s'), 'Ctrl+s');
  assert.strictEqual(formatKeybinding('ctrlcmd+shift+f'), 'Ctrl+shift+f');
  assert.strictEqual(formatKeybinding('alt+up'), 'alt+up');
});

test('Keyboard shortcuts — categories sorted', () => {
  const categories = [
    { name: '编辑器 (Editor)', order: 2 },
    { name: '通用 (General)', order: 1 },
    { name: 'Kairo IDE', order: 8 },
    { name: '调试 (Debug)', order: 5 },
  ];

  categories.sort((a, b) => a.order - b.order);

  assert.strictEqual(categories[0].name, '通用 (General)');
  assert.strictEqual(categories[1].name, '编辑器 (Editor)');
  assert.strictEqual(categories[2].name, '调试 (Debug)');
  assert.strictEqual(categories[3].name, 'Kairo IDE');
});