const fs = require('fs');
const path = require('path');

require('ts-node/register');
const existingEn = require(path.join(process.cwd(), 'packages/i18n/src/locales/en.ts')).default;

const dirs = [
  'packages/build-extension/src/browser',
  'packages/git-extension/src/browser',
  'packages/svn-extension/src/browser',
  'packages/search-extension/src/browser',
  'packages/sql-extension/src/browser',
  'packages/test-extension/src/browser',
  'packages/java-extension/src/browser',
  'packages/remote-extension/src/browser',
];

const keyPattern = /(?:t\(|this\.t\(|i18n\.t\()\s*['"]([^'"]+)['"]/g;

function extractKeys() {
  const keys = new Set();
  for (const dir of dirs) {
    for (const file of walk(path.join(process.cwd(), dir))) {
      if (!file.endsWith('.tsx')) continue;
      const content = fs.readFileSync(file, 'utf8');
      let m;
      while ((m = keyPattern.exec(content)) !== null) keys.add(m[1]);
    }
  }
  return Array.from(keys).sort();
}

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

const keys = extractKeys();
const widgetKeys = keys.filter(k => k.startsWith('widget.'));
const commonKeys = keys.filter(k => k.startsWith('common.'));

function keyExists(root, dotPath) {
  const parts = dotPath.split('.');
  let node = root;
  for (const p of parts) {
    if (node == null || typeof node !== 'object') return false;
    if (!(p in node)) return false;
    node = node[p];
  }
  return true;
}

const missingWidgetKeys = widgetKeys.filter(k => !keyExists(existingEn, k));
const missingCommonKeys = commonKeys.filter(k => !keyExists(existingEn, k));

console.error('Missing widget keys:', missingWidgetKeys.length);
console.error('Missing common keys:', missingCommonKeys.length);

function buildTree(keys) {
  const root = {};
  for (const key of keys) {
    const parts = key.split('.');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!node[p]) node[p] = {};
      node = node[p];
    }
    node[parts[parts.length - 1]] = null;
  }
  return root;
}

const widgetTree = buildTree(missingWidgetKeys);

const namespaceTitles = {
  'widget.build': { en: 'Build', zh: '构建' },
  'widget.build.customRunner': { en: 'Custom Build Runner', zh: '自定义构建运行器' },
  'widget.build.maven': { en: 'Maven', zh: 'Maven' },
  'widget.git': { en: 'Git', zh: 'Git' },
  'widget.git.changes': { en: 'Changes', zh: '更改' },
  'widget.git.commit': { en: 'Commit', zh: '提交' },
  'widget.git.diff': { en: 'Diff', zh: '差异' },
  'widget.git.history': { en: 'History', zh: '历史' },
  'widget.git.stash': { en: 'Stash', zh: '贮藏' },
  'widget.svn': { en: 'SVN', zh: 'SVN' },
  'widget.svn.changes': { en: 'SVN Changes', zh: 'SVN 更改' },
  'widget.svn.diff': { en: 'SVN Diff', zh: 'SVN 比较' },
  'widget.svn.history': { en: 'SVN History', zh: 'SVN 历史' },
  'widget.search': { en: 'Search', zh: '搜索' },
  'widget.search.center': { en: 'Search Center', zh: '搜索中心' },
  'widget.search.everywhere': { en: 'Search Everywhere', zh: '全局搜索' },
  'widget.search.findAction': { en: 'Find Action', zh: '查找操作' },
  'widget.search.findClass': { en: 'Find Class', zh: '查找类' },
  'widget.search.findFile': { en: 'Find File', zh: '查找文件' },
  'widget.search.findSymbol': { en: 'Find Symbol', zh: '查找符号' },
  'widget.sql': { en: 'SQL', zh: 'SQL' },
  'widget.sql.connection': { en: 'SQL Connections', zh: 'SQL 连接' },
  'widget.sql.editor': { en: 'SQL Editor', zh: 'SQL 编辑器' },
  'widget.sql.results': { en: 'SQL Results', zh: 'SQL 结果' },
  'widget.test': { en: 'Test', zh: '测试' },
  'widget.test.output': { en: 'Test Output', zh: '测试输出' },
  'widget.test.tree': { en: 'Tests', zh: '测试' },
  'widget.java': { en: 'Java', zh: 'Java' },
  'widget.java.debugMultimodule': { en: 'Multi-Module Debug', zh: '多模块调试' },
  'widget.java.hierarchy': { en: 'Type Hierarchy', zh: '类型层次结构' },
  'widget.java.hotswap': { en: 'Hot Swap', zh: '热替换' },
  'widget.java.maven': { en: 'Maven', zh: 'Maven' },
  'widget.java.maven.dependencies': { en: 'Dependencies', zh: '依赖' },
  'widget.java.maven.lifecycle': { en: 'Lifecycle', zh: '生命周期' },
  'widget.java.maven.modules': { en: 'Modules', zh: '模块' },
  'widget.java.maven.overview': { en: 'Overview', zh: '概览' },
  'widget.java.references': { en: 'References', zh: '引用' },
  'widget.remote': { en: 'Remote Development', zh: '远程开发' },
  'widget.remote.connection': { en: 'Remote Connection', zh: '远程连接' },
  'widget.remote.panel': { en: 'Remote Panel', zh: '远程面板' },
  'widget.remote.panel.connection': { en: 'Connection', zh: '连接' },
  'widget.remote.panel.containers': { en: 'Containers', zh: '容器' },
  'widget.remote.panel.sessions': { en: 'Sessions', zh: '会话' },
  'widget.remote.panel.sync': { en: 'File Sync', zh: '文件同步' },
};

function getNsTitle(path, lang) {
  const key = path.join('.');
  if (namespaceTitles[key]) return namespaceTitles[key][lang];
  const last = path[path.length - 1];
  return camelToTitle(last, lang);
}

function camelToTitle(str, lang) {
  const words = str.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim().split(/\s+/);
  if (lang === 'zh') return words.map(w => zhWords[w.toLowerCase()] || w).join('');
  return words.join(' ');
}

function camelToWords(str) {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim().replace(/\s+/g, ' ');
}

const zhWords = {
  build: '构建', button: '按钮', cancel: '取消', caption: '说明', changes: '更改',
  cherry: '遴选', class: '类', clean: '清理', commit: '提交', conflicts: '冲突',
  connect: '连接', connection: '连接', count: '数量', debug: '调试', delete: '删除',
  dependencies: '依赖', detail: '详情', detect: '检测', diff: '差异', disconnect: '断开',
  edit: '编辑', empty: '空', error: '错误', everywhere: '全局', execute: '执行',
  export: '导出', file: '文件', filter: '筛选', find: '查找', history: '历史',
  host: '主机', import: '导入', in: '中', label: '标签', loading: '加载中',
  message: '消息', mode: '模式', module: '模块', multimodule: '多模块', name: '名称',
  new: '新建', next: '下一步', no: '无', oracle: 'Oracle', output: '输出',
  package: '打包', panel: '面板', password: '密码', path: '路径', perf: '性能',
  pick: '选择', placeholder: '占位符', port: '端口', previous: '上一个', progress: '进度',
  project: '项目', reason: '原因', refresh: '刷新', remote: '远程', replace: '替换',
  results: '结果', retry: '重试', revert: '还原', run: '运行', running: '运行中',
  save: '保存', search: '搜索', select: '选择', service: '服务', sessions: '会话',
  settings: '设置', show: '显示', sid: 'SID', size: '大小', sql: 'SQL',
  stack: '堆栈', start: '启动', state: '状态', status: '状态', stash: '贮藏',
  stop: '停止', success: '成功', svn: 'SVN', symbol: '符号', sync: '同步',
  target: '目标', test: '测试', testing: '测试中', time: '时间', title: '标题',
  tooltip: '提示', trace: '跟踪', tree: '树', type: '类型', undo: '撤销',
  unknown: '未知', update: '更新', updating: '更新中', use: '使用', version: '版本',
  warning: '警告', with: '带', working: '工作',
};

const progressWords = {
  loading: { en: 'Loading...', zh: '加载中...' },
  refreshing: { en: 'Refreshing...', zh: '刷新中...' },
  searching: { en: 'Searching...', zh: '搜索中...' },
  committing: { en: 'Committing...', zh: '提交中...' },
  executing: { en: 'Executing...', zh: '执行中...' },
  cancelling: { en: 'Cancelling…', zh: '取消中…' },
  updating: { en: 'Updating...', zh: '更新中...' },
  testing: { en: 'Testing…', zh: '测试中…' },
  running: { en: 'Running...', zh: '运行中...' },
  connecting: { en: 'Connecting…', zh: '连接中…' },
  disconnecting: { en: 'Disconnecting…', zh: '断开中…' },
  replacing: { en: 'Replacing…', zh: '替换中…' },
  inProgress: { en: 'In Progress...', zh: '进行中...' },
  inSync: { en: 'In Sync', zh: '已同步' },
  syncing: { en: 'Syncing…', zh: '同步中…' },
};

const specialCases = {
  'common.unknownError': { en: 'Unknown error', zh: '未知错误' },
  'widget.git.commit.amendWarning': { en: 'Warning: the last commit may have been pushed; amend will rewrite history.', zh: '警告：最后一次提交可能已推送，amend 将重写历史。' },
  'widget.git.commit.preCommitFailed': { en: 'Pre-commit checks failed.', zh: '预提交检查失败。' },
  'widget.git.commit.successWithHash': { en: 'Committed {hash}', zh: '已提交 {hash}' },
  'widget.git.commit.bodyWarningTooltip': { en: 'Line {line} exceeds {length} characters', zh: '第 {line} 行超过 {length} 个字符' },
  'widget.git.commit.bodyWarningText': { en: '{count} body line warning(s)', zh: '{count} 行正文警告' },
  'widget.git.commit.stagedCountSingular': { en: '{count} file staged', zh: '已暂存 {count} 个文件' },
  'widget.git.commit.stagedCountPlural': { en: '{count} files staged', zh: '已暂存 {count} 个文件' },
  'widget.git.commit.charCount': { en: '{count} chars', zh: '{count} 字符' },
  'widget.git.commit.preCommitProgress': { en: 'Running {check}...', zh: '正在运行 {check}...' },
  'widget.git.commit.commitHint': { en: 'Ctrl+Enter to commit', zh: '按 Ctrl+Enter 提交' },
  'widget.git.stash.stashesCount': { en: '({count})', zh: '({count})' },
  'widget.git.history.resultsCount': { en: '{count} commits', zh: '{count} 条提交' },
  'widget.git.history.cherryPickAria': { en: 'Cherry-pick commit {hash}', zh: '遴选提交 {hash}' },
  'widget.git.history.detail.commit': { en: 'Commit:', zh: '提交：' },
  'widget.git.history.detail.author': { en: 'Author:', zh: '作者：' },
  'widget.git.history.detail.date': { en: 'Date:', zh: '日期：' },
  'widget.svn.changes.lockedBy': { en: 'Locked by {owner}', zh: '由 {owner} 锁定' },
  'widget.svn.changes.revertConfirm': { en: 'Revert {count} selected file(s)?', zh: '还原选中的 {count} 个文件？' },
  'widget.svn.changes.conflictsBanner': { en: '{count} conflict(s) need resolution', zh: '{count} 个冲突需要解决' },
  'widget.svn.changes.conflictsTitle': { en: 'Conflicts ({count})', zh: '冲突（{count}）' },
  'widget.svn.changes.defaultChangelistTitle': { en: 'Default Changelist ({count})', zh: '默认变更列表（{count}）' },
  'widget.svn.changes.unversionedFilesTitle': { en: 'Unversioned Files ({count})', zh: '未版本控制文件（{count}）' },
  'widget.svn.changes.ignoredFilesTitle': { en: 'Ignored Files ({count})', zh: '已忽略文件（{count}）' },
  'widget.svn.changes.lockedFilesTitle': { en: 'Locked Files ({count})', zh: '已锁定文件（{count}）' },
  'widget.svn.changes.selectedCount': { en: '{count} selected', zh: '已选择 {count} 个' },
  'widget.svn.diff.status.leftLabel': { en: '{label}', zh: '{label}' },
  'widget.svn.diff.status.leftRev': { en: 'r{rev}', zh: 'r{rev}' },
  'widget.svn.diff.status.rightLabel': { en: '{label}', zh: '{label}' },
  'widget.svn.diff.status.rightWorkingCopy': { en: 'Working Copy', zh: '工作副本' },
  'widget.svn.diff.status.repositoryRev': { en: 'r{rev}', zh: 'r{rev}' },
  'widget.svn.diff.status.workingCopy': { en: 'Working Copy', zh: '工作副本' },
  'widget.svn.diff.pickRevisionPlaceholder': { en: 'Select revision for {target} ({path})', zh: '为 {target} 选择版本（{path}）' },
  'widget.svn.history.daysAgo': { en: '{count} days ago', zh: '{count} 天前' },
  'widget.svn.history.exportedTo': { en: 'Exported to {path}', zh: '已导出到 {path}' },
  'widget.svn.history.exportFailed': { en: 'Export failed: {message}', zh: '导出失败：{message}' },
  'widget.svn.history.revertConfirm': { en: 'Revert {path} to r{rev}?', zh: '将 {path} 还原到 r{rev}？' },
  'widget.svn.history.revertedTo': { en: 'Reverted to r{rev}', zh: '已还原到 r{rev}' },
  'widget.svn.history.revertFailed': { en: 'Revert failed: {message}', zh: '还原失败：{message}' },
  'widget.svn.history.copiedRevision': { en: 'Copied r{rev}', zh: '已复制 r{rev}' },
  'widget.svn.history.copyFailed': { en: 'Copy failed: {message}', zh: '复制失败：{message}' },
  'widget.search.center.stats.match': { en: '{count} matches', zh: '{count} 个匹配' },
  'widget.search.center.stats.matchInFiles': { en: '{count} matches in {fileCount} files', zh: '{count} 个匹配，涉及 {fileCount} 个文件' },
  'widget.search.center.stats.streaming': { en: ' (streaming)', zh: '（流式加载）' },
  'widget.search.center.status.error': { en: 'Error: {message}', zh: '错误：{message}' },
  'widget.sql.connection.detail': { en: '{name} — {username}@{host}:{port}', zh: '{name} — {username}@{host}:{port}' },
  'widget.sql.connection.oracleVersion': { en: 'Version {version}', zh: '版本 {version}' },
  'widget.sql.connection.testSuccess': { en: 'Connection OK', zh: '连接成功' },
  'widget.sql.connection.testFailed': { en: 'Connection failed: {error}', zh: '连接失败：{error}' },
  'widget.sql.connection.imported': { en: 'Imported {count} connection(s)', zh: '已导入 {count} 个连接' },
  'widget.sql.connection.invalidImport': { en: 'Invalid import file', zh: '导入文件无效' },
  'widget.sql.editor.connectionOption': { en: '{name} ({username}@{host}:{port})', zh: '{name}（{username}@{host}:{port}）' },
  'widget.sql.editor.dangerousStatement': { en: 'Dangerous statement: {reason}\n{sql}', zh: '危险语句：{reason}\n{sql}' },
  'widget.sql.editor.historyTime': { en: '{time}ms', zh: '{time}ms' },
  'widget.sql.editor.historyRowCount': { en: '{count} rows', zh: '{count} 行' },
  'widget.sql.results.rowCount': { en: '{count} rows', zh: '{count} 行' },
  'widget.sql.results.truncated': { en: ' (total {total})', zh: '（共 {total}）' },
  'widget.sql.results.executionTime': { en: '{time}ms', zh: '{time}ms' },
  'widget.sql.results.pageInfo': { en: 'Page {page} of {total}', zh: '第 {page} / {total} 页' },
  'widget.sql.results.nullValue': { en: 'NULL', zh: 'NULL' },
  'widget.sql.results.csvFileName': { en: 'results-{timestamp}.csv', zh: 'results-{timestamp}.csv' },
  'widget.sql.results.jsonFileName': { en: 'results-{timestamp}.json', zh: 'results-{timestamp}.json' },
  'widget.sql.results.columnTooltip': { en: '{label} ({type})', zh: '{label}（{type}）' },
  'widget.test.output.runOption': { en: '{scope}: {target}', zh: '{scope}：{target}' },
  'widget.test.output.label.scope': { en: 'Scope: {scope}', zh: '范围：{scope}' },
  'widget.test.output.label.target': { en: 'Target: {target}', zh: '目标：{target}' },
  'widget.test.output.label.started': { en: 'Started: {startTime}', zh: '开始：{startTime}' },
  'widget.test.output.label.ended': { en: 'Ended: {endTime}', zh: '结束：{endTime}' },
  'widget.test.output.summary.passed': { en: '{count} passed', zh: '{count} 通过' },
  'widget.test.output.summary.failed': { en: '{count} failed', zh: '{count} 失败' },
  'widget.test.output.summary.skipped': { en: '{count} skipped', zh: '{count} 跳过' },
  'widget.test.output.summary.errors': { en: '{count} errors', zh: '{count} 错误' },
  'widget.test.tree.count.one': { en: '{count} test', zh: '{count} 个测试' },
  'widget.test.tree.count.other': { en: '{count} tests', zh: '{count} 个测试' },
  'widget.test.tree.summary.passed': { en: '{passed}/{total} passed', zh: '{passed}/{total} 通过' },
  'widget.test.tree.summary.failed': { en: '{count} failed', zh: '{count} 失败' },
  'widget.test.tree.summary.skipped': { en: '{count} skipped', zh: '{count} 跳过' },
  'widget.test.tree.emptyStateReason': { en: 'Press {action} to discover tests.', zh: '点击「{action}」发现测试。' },
  'widget.java.debugMultimodule.sessionCount': { en: '{count} session(s)', zh: '{count} 个会话' },
  'widget.java.debugMultimodule.session.hostTitle': { en: '{hostname}:{port}', zh: '{hostname}:{port}' },
  'widget.java.debugMultimodule.session.startedLabel': { en: 'Started {startedAt}', zh: '启动于 {startedAt}' },
  'widget.java.debugMultimodule.session.startedTitle': { en: 'Started at {startedAt}', zh: '启动时间 {startedAt}' },
  'widget.java.debugMultimodule.session.stateAria': { en: '{moduleName} {state}', zh: '{moduleName} {state}' },
  'widget.java.debugMultimodule.breakpoints.summary': { en: '{enabled}/{total} breakpoints', zh: '{enabled}/{total} 个断点' },
  'widget.java.debugMultimodule.breakpoint.locationTitle': { en: '{moduleName} — {className}:{lineNumber}', zh: '{moduleName} — {className}:{lineNumber}' },
  'widget.java.debugMultimodule.breakpoint.resolved': { en: 'Resolved: {classes}', zh: '已解析：{classes}' },
  'widget.java.debugMultimodule.breakpoint.resolvedTitle': { en: 'Resolved in {classes}', zh: '解析于 {classes}' },
  'widget.java.debugMultimodule.events.typeTitle': { en: 'Event: {eventType}', zh: '事件：{eventType}' },
  'widget.java.debugMultimodule.events.moduleTitle': { en: 'Module: {moduleName}', zh: '模块：{moduleName}' },
  'widget.java.debugMultimodule.events.locationTitle': { en: '{className}:{lineNumber}', zh: '{className}:{lineNumber}' },
  'widget.java.debugMultimodule.events.timeTitle': { en: '{timestamp}', zh: '{timestamp}' },
  'widget.java.hierarchy.loadingChildren': { en: 'Loading children...', zh: '加载子节点...' },
  'widget.java.hierarchy.error.expand': { en: 'Failed to expand: {message}', zh: '展开失败：{message}' },
  'widget.java.hierarchy.error.loadCallHierarchy': { en: 'Failed to load call hierarchy: {message}', zh: '加载调用层次结构失败：{message}' },
  'widget.java.hierarchy.error.loadTypeHierarchy': { en: 'Failed to load type hierarchy: {message}', zh: '加载类型层次结构失败：{message}' },
  'widget.java.hotswap.durationMs': { en: '{ms}ms', zh: '{ms}ms' },
  'widget.java.hotswap.durationSec': { en: '{sec}s', zh: '{sec}秒' },
  'widget.java.references.resultSummary': { en: '{count} usages of {symbolName}', zh: '{symbolName} 的 {count} 处引用' },
  'widget.java.references.titleWithSymbol': { en: 'References: {symbolName}', zh: '引用：{symbolName}' },
  'widget.java.references.titleWithCount': { en: '{name} ({count})', zh: '{name}（{count}）' },
  'widget.java.references.linePreview': { en: 'Line {line}', zh: '第 {line} 行' },
  'widget.java.references.fallbackSymbol': { en: 'symbol', zh: '符号' },
  'widget.java.maven.dependencies.conflictsTitle': { en: 'Dependency Conflicts', zh: '依赖冲突' },
  'widget.java.maven.dependencies.noDependencies': { en: 'No dependencies.', zh: '暂无依赖。' },
  'widget.java.maven.dependencies.optional': { en: 'optional', zh: '可选' },
  'widget.java.maven.dependencies.refresh': { en: 'Refresh', zh: '刷新' },
  'widget.java.maven.dependencies.resolved': { en: 'Resolved: {version}', zh: '已解析：{version}' },
  'widget.java.maven.dependencies.versions': { en: 'Versions: {versions}', zh: '版本：{versions}' },
  'widget.java.maven.dependencies.title': { en: 'Dependencies', zh: '依赖' },
  'widget.java.maven.detect': { en: 'Detect', zh: '检测' },
  'widget.java.maven.empty.detectPrompt': { en: 'Enter a project path and click Detect.', zh: '输入项目路径并点击检测。' },
  'widget.java.maven.empty.notFound': { en: 'No Maven project found.', zh: '未找到 Maven 项目。' },
  'widget.java.maven.emptyValue': { en: '—', zh: '—' },
  'widget.java.maven.lifecycle.outputTitle': { en: 'Output', zh: '输出' },
  'widget.java.maven.lifecycle.run': { en: 'Run', zh: '运行' },
  'widget.java.maven.lifecycle.running': { en: 'Running...', zh: '运行中...' },
  'widget.java.maven.lifecycle.title': { en: 'Lifecycle', zh: '生命周期' },
  'widget.java.maven.modules.root': { en: 'Root', zh: '根' },
  'widget.java.maven.modules.title': { en: 'Modules', zh: '模块' },
  'widget.java.maven.overview.artifactId': { en: 'Artifact ID', zh: 'Artifact ID' },
  'widget.java.maven.overview.buildDir': { en: 'Build Directory', zh: '构建目录' },
  'widget.java.maven.overview.conflictCount': { en: 'Conflicts: {count}', zh: '冲突：{count}' },
  'widget.java.maven.overview.dependencyCount': { en: 'Dependencies: {count}', zh: '依赖：{count}' },
  'widget.java.maven.overview.description': { en: 'Description', zh: '描述' },
  'widget.java.maven.overview.groupId': { en: 'Group ID', zh: 'Group ID' },
  'widget.java.maven.overview.name': { en: 'Name', zh: '名称' },
  'widget.java.maven.overview.outputDir': { en: 'Output Directory', zh: '输出目录' },
  'widget.java.maven.overview.packaging': { en: 'Packaging', zh: '打包方式' },
  'widget.java.maven.overview.projectInfo': { en: 'Project Information', zh: '项目信息' },
  'widget.java.maven.overview.summary': { en: 'Summary', zh: '摘要' },
  'widget.java.maven.overview.taskCount': { en: 'Tasks: {count}', zh: '任务：{count}' },
  'widget.java.maven.overview.version': { en: 'Version', zh: '版本' },
  'widget.java.maven.pathPlaceholder': { en: 'Project path...', zh: '项目路径...' },
  'widget.remote.connection.terminalName': { en: 'Terminal {index}', zh: '终端 {index}' },
  'widget.remote.connection.retry': { en: 'Reconnecting ({attempt})...', zh: '正在重连（{attempt}）...' },
  'widget.remote.panel.sessions.count': { en: '{count} session(s)', zh: '{count} 个会话' },
  'widget.remote.panel.sync.progress': { en: 'Sync progress', zh: '同步进度' },
  'widget.build.customRunner.result.success': { en: 'Success (exit {exitCode})', zh: '成功（退出码 {exitCode}）' },
  'widget.build.customRunner.result.failed': { en: 'Failed (exit {exitCode})', zh: '失败（退出码 {exitCode}）' },
  'widget.build.customRunner.log.started': { en: 'Build {buildId} started', zh: '构建 {buildId} 已启动' },
  'widget.build.customRunner.log.running': { en: 'Running: {command}', zh: '正在运行：{command}' },
  'widget.build.customRunner.log.waiting': { en: 'Waiting for completion...', zh: '等待完成...' },
  'widget.build.customRunner.error.noCommand': { en: 'No command specified', zh: '未指定命令' },
  'widget.build.customRunner.error.requestFailed': { en: 'Request failed: {message}', zh: '请求失败：{message}' },
  'widget.build.maven.section.conflicts': { en: 'Conflicts ({count})', zh: '冲突（{count}）' },
  'widget.build.maven.section.dependencies': { en: 'Dependencies ({count})', zh: '依赖（{count}）' },
  'widget.build.maven.conflict.versions': { en: 'Versions: {versions}', zh: '版本：{versions}' },
  'widget.build.maven.conflict.resolved': { en: 'Resolved: {version}', zh: '已解析：{version}' },
  'widget.build.maven.output.failed': { en: 'Failed', zh: '失败' },
  'widget.build.maven.output.success': { en: 'Success', zh: '成功' },
};

function generateEn(keyPath) {
  const full = keyPath.join('.');
  if (specialCases[full]) return specialCases[full].en;
  const leaf = keyPath[keyPath.length - 1];
  const parent = keyPath.slice(0, -1);
  const nsTitle = getNsTitle(parent, 'en');

  if (leaf === 'title') return nsTitle;
  if (leaf === 'caption') return nsTitle.startsWith('Kairo ') ? nsTitle : 'Kairo ' + nsTitle;
  if (progressWords[leaf]) return progressWords[leaf].en;
  if (leaf === 'emptyStateTitle') return 'No ' + nsTitle + ' yet';
  if (leaf === 'emptyStateReason') return 'Start using the ' + nsTitle + ' toolbar to populate this view.';
  if (leaf === 'empty') return 'No ' + nsTitle.toLowerCase();
  if (/^no[A-Z]/.test(leaf)) return 'No ' + camelToWords(leaf.replace(/^no/, '')).toLowerCase();

  if (leaf.endsWith('Button')) return camelToWords(leaf.replace(/Button$/, ''));
  if (leaf.endsWith('ButtonAria')) return camelToWords(leaf.replace(/ButtonAria$/, '')) + ' button';
  if (leaf.endsWith('Aria')) return camelToWords(leaf.replace(/Aria$/, ''));
  if (leaf.endsWith('AriaLabel')) return camelToWords(leaf.replace(/AriaLabel$/, ''));
  if (leaf.endsWith('Tooltip')) return camelToWords(leaf.replace(/Tooltip$/, ''));
  if (leaf.endsWith('Placeholder')) return 'Enter ' + camelToWords(leaf.replace(/Placeholder$/, '')).toLowerCase() + '...';
  if (leaf.endsWith('Label')) return camelToWords(leaf.replace(/Label$/, ''));
  if (leaf.endsWith('Hint')) return camelToWords(leaf.replace(/Hint$/, ''));

  if (leaf.includes('Count') || leaf.includes('count')) {
    const base = leaf.replace(/Count$/, '').replace(/Count(Singular|Plural|One|Other)$/, '');
    return '{count} ' + camelToWords(base).toLowerCase();
  }

  return camelToWords(leaf);
}

function generateZh(keyPath) {
  const full = keyPath.join('.');
  if (specialCases[full]) return specialCases[full].zh;
  const leaf = keyPath[keyPath.length - 1];
  const parent = keyPath.slice(0, -1);
  const nsTitle = getNsTitle(parent, 'zh');

  if (leaf === 'title') return nsTitle;
  if (leaf === 'caption') return nsTitle.startsWith('Kairo ') ? nsTitle : 'Kairo ' + nsTitle;
  if (progressWords[leaf]) return progressWords[leaf].zh;
  if (leaf === 'emptyStateTitle') return '暂无' + nsTitle;
  if (leaf === 'emptyStateReason') return '使用「' + nsTitle + '」工具栏开始工作。';
  if (leaf === 'empty') return '暂无' + nsTitle;

  const en = generateEn(keyPath);
  let zh = en;
  const phraseMap = [
    ['No ', '暂无'], [' yet', ''], ['Enter ', '输入'], [' button', '按钮'],
    ['Start using the ', '使用'], [' toolbar to populate this view.', '工具栏开始工作。'],
  ];
  for (const [from, to] of phraseMap) zh = zh.split(from).join(to);

  const words = zh.split(/\s+/);
  return words.map(w => {
    const lower = w.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
    return zhWords[lower] || w;
  }).join('').replace(/\{count\}/g, '{count}').replace(/\{message\}/g, '{message}').replace(/\{time\}/g, '{time}').replace(/\{fileCount\}/g, '{fileCount}').replace(/\{matchCount\}/g, '{matchCount}').replace(/\{page\}/g, '{page}').replace(/\{total\}/g, '{total}');
}

function treeToObject(tree, path, lang) {
  const obj = {};
  for (const [key, value] of Object.entries(tree)) {
    const currentPath = [...path, key];
    if (value === null) {
      obj[key] = lang === 'en' ? generateEn(currentPath) : generateZh(currentPath);
    } else {
      obj[key] = treeToObject(value, currentPath, lang);
    }
  }
  return obj;
}

const enWidgetAdditions = treeToObject(widgetTree.widget, ['widget'], 'en');
const zhWidgetAdditions = treeToObject(widgetTree.widget, ['widget'], 'zh');

function objectToTs(obj, indent) {
  const lines = [];
  const prefix = ' '.repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`;
    if (typeof value === 'string') {
      lines.push(`${prefix}${safeKey}: '${value.replace(/'/g, "\\'")}',`);
    } else {
      lines.push(`${prefix}${safeKey}: {`);
      lines.push(...objectToTs(value, indent + 2));
      lines.push(`${prefix}},`);
    }
  }
  return lines;
}

// For zh-CN, build flat additions matching en structure
function buildZhFlat(enObj, path, out) {
  for (const [key, value] of Object.entries(enObj)) {
    const currentPath = [...path, key];
    if (typeof value === 'string') {
      out[currentPath.join('.')] = generateZh(currentPath);
    } else {
      buildZhFlat(value, currentPath, out);
    }
  }
}
const zhFlat = {};
buildZhFlat(enWidgetAdditions, [], zhFlat);

console.log(JSON.stringify({
  enWidgetAdditions,
  zhFlat,
  missingCommon: missingCommonKeys,
}, null, 2));
