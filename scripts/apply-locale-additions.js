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
  if (lang === 'zh') return words.map(w => zhTerms[w.toLowerCase()] || w).join('');
  return words.join(' ');
}

function camelToWords(str) {
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim().replace(/\s+/g, ' ');
}

const zhTerms = {
  // Common UI
  add: '添加', all: '全部', amend: '修正', apply: '应用', aria: '', author: '作者',
  button: '按钮', browse: '浏览', build: '构建', cancel: '取消', caption: '说明',
  changes: '更改', cherry: '遴选', cherrypick: '遴选', class: '类', clean: '清理',
  clear: '清除', close: '关闭', column: '列', commit: '提交', commits: '提交',
  compare: '比较', completed: '已完成', conflict: '冲突', conflicts: '冲突',
  connect: '连接', connection: '连接', containers: '容器', copy: '复制', count: '数量',
  current: '当前', custom: '自定义', date: '日期', debug: '调试', default: '默认',
  delete: '删除', dependencies: '依赖', dependency: '依赖', deploy: '部署', deselect: '取消选择',
  detail: '详情', details: '详情', detect: '检测', diff: '差异', directory: '目录',
  disconnected: '已断开', disconnect: '断开', discover: '发现', dismiss: '关闭',
  drop: '丢弃', edit: '编辑', empty: '空', enabled: '已启用', ended: '结束',
  enter: '输入', error: '错误', errors: '错误', event: '事件', events: '事件',
  every: '每', execute: '执行', executing: '执行中', export: '导出', failed: '失败',
  failure: '失败', fetch: '获取', file: '文件', files: '文件', filter: '筛选',
  find: '查找', folder: '文件夹', force: '强制', go: '前往', group: '组',
  hash: '哈希', hide: '隐藏', history: '历史', host: '主机', hot: '热',
  ignored: '已忽略', import: '导入', in: '', info: '信息', information: '信息',
  interval: '间隔', item: '项目', items: '项目', keep: '保持', key: '密钥', label: '标签',
  last: '最近', latency: '延迟', left: '左侧', lifecycle: '生命周期', line: '行',
  lines: '行', lint: 'Lint', load: '加载', loaded: '已加载', loading: '加载中',
  local: '本地', locked: '已锁定', log: '日志', match: '匹配', matches: '匹配',
  max: '最大', message: '消息', method: '方法', methods: '方法', min: '最小',
  mode: '模式', modified: '已修改', module: '模块', modules: '模块', multimodule: '多模块',
  name: '名称', new: '新建', next: '下一个', no: '无', none: '无', not: '未',
  null: 'NULL', of: '/', ok: '确定', old: '旧', one: '个', online: '在线',
  only: '仅', open: '打开', optional: '可选', oracle: 'Oracle', other: '其他',
  output: '输出', package: '打包', packages: '包', page: '页', panel: '面板',
  password: '密码', path: '路径', paths: '路径', perf: '性能', performance: '性能',
  pick: '选择', placeholder: '占位符', port: '端口', previous: '上一个', progress: '进度',
  project: '项目', projects: '项目', properties: '属性', pull: '拉取', push: '推送',
  query: '查询', reason: '原因', reconnect: '重新连接', refresh: '刷新', regex: '正则',
  reload: '重载', remote: '远程', remove: '移除', replace: '替换', replaceall: '全部替换',
  replacement: '替换为', repository: '仓库', resolved: '已解析', results: '结果', retry: '重试',
  revert: '还原', revision: '版本', right: '右侧', role: '角色', rollback: '回滚',
  root: '根', rows: '行', run: '运行', running: '运行中', save: '保存',
  scope: '范围', search: '搜索', section: '部分', select: '选择', selected: '已选择',
  server: '服务器', service: '服务', services: '服务', session: '会话', sessions: '会话',
  set: '设置', settings: '设置', show: '显示', sid: 'SID', signoff: 'Signed-off-by',
  since: '自', size: '大小', skip: '跳过', sql: 'SQL', stack: '堆栈', stage: '暂存',
  staged: '已暂存', stages: '已暂存', start: '启动', started: '开始', state: '状态',
  status: '状态', stash: '贮藏', stashes: '贮藏', stop: '停止', stopped: '已停止',
  success: '成功', successful: '成功', summary: '摘要', svn: 'SVN', swap: '交换',
  symbol: '符号', symbols: '符号', sync: '同步', syncing: '同步中', target: '目标',
  terminal: '终端', test: '测试', testing: '测试中', tests: '测试', time: '时间',
  times: '次', title: '标题', tls: 'TLS', to: '到', token: '令牌', toolbar: '工具栏',
  tooltip: '提示', trace: '跟踪', tree: '测试树', type: '类型', undo: '撤销',
  unstage: '取消暂存', unstaged: '未暂存', unknown: '未知', unstash: '取消贮藏',
  untracked: '未跟踪', update: '更新', updating: '更新中', upload: '上传', use: '使用',
  used: '已使用', usages: '处引用', username: '用户名', value: '值', version: '版本',
  versions: '版本', warning: '警告', warnings: '警告', watch: '监视', with: '带',
  word: '单词', working: '工作', workspace: '工作区', yesterday: '昨天',
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
  scanning: { en: 'Scanning...', zh: '扫描中...' },
  compiling: { en: 'Compiling...', zh: '编译中...' },
};

const specialCases = {
  'common.unknownError': { en: 'Unknown error', zh: '未知错误' },

  // Git
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
  'widget.git.commit.noVerifyLabel': { en: 'No verify', zh: '跳过验证' },
  'widget.git.commit.signoffLabel': { en: 'Sign off', zh: '添加 Signed-off-by' },
  'widget.git.commit.runBuildLabel': { en: 'Run build', zh: '运行构建' },
  'widget.git.commit.runLintLabel': { en: 'Run lint', zh: '运行 Lint' },
  'widget.git.commit.runTestsLabel': { en: 'Run tests', zh: '运行测试' },
  'widget.git.commit.commitOptionsTitle': { en: 'Commit options', zh: '提交选项' },
  'widget.git.commit.preCommitChecksTitle': { en: 'Pre-commit checks', zh: '预提交检查' },
  'widget.git.commit.suggestionsTitle': { en: 'Suggestions', zh: '建议' },
  'widget.git.commit.placeholder': { en: 'Commit message', zh: '提交消息' },
  'widget.git.commit.amendLabel': { en: 'Amend', zh: '修正上次提交' },
  'widget.git.commit.checkStatusFailed': { en: 'Check failed', zh: '检查失败' },
  'widget.git.commit.checkStatusPassed': { en: 'Check passed', zh: '检查通过' },
  'widget.git.commit.checkType.build': { en: 'Build', zh: '构建' },
  'widget.git.commit.checkType.lint': { en: 'Lint', zh: 'Lint' },
  'widget.git.commit.checkType.test': { en: 'Tests', zh: '测试' },
  'widget.git.commit.checkType.checking': { en: 'Checking', zh: '检查中' },
  'widget.git.commit.checking': { en: 'Checking...', zh: '检查中...' },
  'widget.git.commit.commitButton': { en: 'Commit', zh: '提交' },
  'widget.git.commit.commitButtonAria': { en: 'Commit changes', zh: '提交更改' },
  'widget.git.commit.forceCommitButton': { en: 'Force commit', zh: '强制提交' },
  'widget.git.commit.forceCommitButtonAria': { en: 'Force commit changes', zh: '强制提交更改' },
  'widget.git.commit.skipChecksButton': { en: 'Skip checks', zh: '跳过检查' },
  'widget.git.commit.skipChecksButtonAria': { en: 'Skip checks and commit', zh: '跳过检查并提交' },

  'widget.git.changes.noChanges': { en: 'No changes', zh: '暂无更改' },
  'widget.git.changes.stagedTitle': { en: 'Staged Changes', zh: '已暂存的更改' },
  'widget.git.changes.unstagedTitle': { en: 'Unstaged Changes', zh: '未暂存的更改' },
  'widget.git.changes.stageAllButton': { en: 'Stage all', zh: '全部暂存' },
  'widget.git.changes.stageAllButtonAria': { en: 'Stage all changes', zh: '暂存所有更改' },
  'widget.git.changes.stageSelectedButton': { en: 'Stage selected', zh: '暂存所选' },
  'widget.git.changes.stageSelectedButtonAria': { en: 'Stage selected changes', zh: '暂存所选更改' },
  'widget.git.changes.unstageAllButton': { en: 'Unstage all', zh: '全部取消暂存' },
  'widget.git.changes.unstageAllButtonAria': { en: 'Unstage all changes', zh: '取消暂存所有更改' },
  'widget.git.changes.unstageSelectedButton': { en: 'Unstage selected', zh: '取消暂存所选' },
  'widget.git.changes.unstageSelectedButtonAria': { en: 'Unstage selected changes', zh: '取消暂存所选更改' },
  'widget.git.changes.refreshButton': { en: 'Refresh', zh: '刷新' },
  'widget.git.changes.refreshButtonAria': { en: 'Refresh changes', zh: '刷新更改' },
  'widget.git.changes.viewDiffTooltip': { en: 'View diff', zh: '查看差异' },

  'widget.git.diff.stagedSuffix': { en: ' (staged)', zh: '（已暂存）' },
  'widget.git.diff.loading': { en: 'Loading diff...', zh: '正在加载差异...' },

  'widget.git.history.cherryPickAria': { en: 'Cherry-pick commit {hash}', zh: '遴选提交 {hash}' },
  'widget.git.history.cherryPickButton': { en: 'Cherry-pick', zh: '遴选' },
  'widget.git.history.cherryPickTitle': { en: 'Cherry-pick', zh: '遴选' },
  'widget.git.history.detail.commit': { en: 'Commit:', zh: '提交：' },
  'widget.git.history.detail.author': { en: 'Author:', zh: '作者：' },
  'widget.git.history.detail.date': { en: 'Date:', zh: '日期：' },
  'widget.git.history.resultsCount': { en: '{count} commits', zh: '{count} 条提交' },
  'widget.git.history.searchPlaceholder': { en: 'Search history...', zh: '搜索历史...' },
  'widget.git.history.searchTimedOut': { en: 'Search timed out', zh: '搜索超时' },
  'widget.git.history.refreshButton': { en: 'Refresh', zh: '刷新' },
  'widget.git.history.refreshButtonAria': { en: 'Refresh history', zh: '刷新历史' },
  'widget.git.history.noCommits': { en: 'No commits', zh: '暂无提交' },
  'widget.git.history.noSearchResults': { en: 'No matching commits', zh: '无匹配的提交' },
  'widget.git.history.searching': { en: 'Searching...', zh: '搜索中...' },

  'widget.git.stash.stashesCount': { en: '({count})', zh: '({count})' },
  'widget.git.stash.stashesTitle': { en: 'Stashes', zh: '贮藏' },
  'widget.git.stash.saveStashTitle': { en: 'Save stash', zh: '保存贮藏' },
  'widget.git.stash.showTitle': { en: 'Show stash', zh: '显示贮藏' },
  'widget.git.stash.messagePlaceholder': { en: 'Stash message', zh: '贮藏消息' },
  'widget.git.stash.includeUntracked': { en: 'Include untracked files', zh: '包含未跟踪文件' },
  'widget.git.stash.stagedOnly': { en: 'Staged changes only', zh: '仅暂存的更改' },
  'widget.git.stash.saveButton': { en: 'Save', zh: '保存' },
  'widget.git.stash.saveButtonAria': { en: 'Save stash', zh: '保存贮藏' },
  'widget.git.stash.applyButton': { en: 'Apply', zh: '应用' },
  'widget.git.stash.applyAria': { en: 'Apply stash', zh: '应用贮藏' },
  'widget.git.stash.popButton': { en: 'Pop', zh: '弹出' },
  'widget.git.stash.popAria': { en: 'Pop stash', zh: '弹出贮藏' },
  'widget.git.stash.dropButton': { en: 'Drop', zh: '删除' },
  'widget.git.stash.dropAria': { en: 'Drop stash', zh: '删除贮藏' },
  'widget.git.stash.clearAllButton': { en: 'Clear all', zh: '全部清除' },
  'widget.git.stash.clearAllButtonAria': { en: 'Clear all stashes', zh: '清除所有贮藏' },
  'widget.git.stash.refreshButton': { en: 'Refresh', zh: '刷新' },
  'widget.git.stash.refreshButtonAria': { en: 'Refresh stashes', zh: '刷新贮藏' },
  'widget.git.stash.noStashes': { en: 'No stashes', zh: '暂无贮藏' },
  'widget.git.stash.noDiffContent': { en: 'No diff content', zh: '暂无差异内容' },
  'widget.git.stash.branchLabel': { en: 'Branch', zh: '分支' },

  // SVN
  'widget.svn.changes.lockedBy': { en: 'Locked by {owner}', zh: '由 {owner} 锁定' },
  'widget.svn.changes.revertConfirm': { en: 'Revert {count} selected file(s)?', zh: '还原选中的 {count} 个文件？' },
  'widget.svn.changes.conflictsBanner': { en: '{count} conflict(s) need resolution', zh: '{count} 个冲突需要解决' },
  'widget.svn.changes.conflictsTitle': { en: 'Conflicts ({count})', zh: '冲突（{count}）' },
  'widget.svn.changes.defaultChangelistTitle': { en: 'Default Changelist ({count})', zh: '默认变更列表（{count}）' },
  'widget.svn.changes.unversionedFilesTitle': { en: 'Unversioned Files ({count})', zh: '未版本控制文件（{count}）' },
  'widget.svn.changes.ignoredFilesTitle': { en: 'Ignored Files ({count})', zh: '已忽略文件（{count}）' },
  'widget.svn.changes.lockedFilesTitle': { en: 'Locked Files ({count})', zh: '已锁定文件（{count}）' },
  'widget.svn.changes.selectedCount': { en: '{count} selected', zh: '已选择 {count} 个' },
  'widget.svn.changes.commitMessageTitle': { en: 'Commit message', zh: '提交消息' },
  'widget.svn.changes.commitMessagePlaceholder': { en: 'Enter commit message...', zh: '输入提交消息...' },
  'widget.svn.changes.commitHint': { en: 'Ctrl+Enter to commit', zh: '按 Ctrl+Enter 提交' },
  'widget.svn.changes.noConflicts': { en: 'No conflicts', zh: '暂无冲突' },
  'widget.svn.changes.svnNotDetected': { en: 'SVN not detected', zh: '未检测到 SVN' },
  'widget.svn.changes.add': { en: 'Add', zh: '添加' },
  'widget.svn.changes.commit': { en: 'Commit', zh: '提交' },
  'widget.svn.changes.update': { en: 'Update', zh: '更新' },
  'widget.svn.changes.revert': { en: 'Revert', zh: '还原' },
  'widget.svn.changes.resolve': { en: 'Resolve', zh: '解决' },
  'widget.svn.changes.refresh': { en: 'Refresh', zh: '刷新' },
  'widget.svn.changes.selectAll': { en: 'Select all', zh: '全选' },
  'widget.svn.changes.deselect': { en: 'Deselect', zh: '取消选择' },
  'widget.svn.changes.committing': { en: 'Committing...', zh: '提交中...' },
  'widget.svn.changes.updating': { en: 'Updating...', zh: '更新中...' },
  'widget.svn.changes.refreshing': { en: 'Refreshing...', zh: '刷新中...' },

  'widget.svn.diff.status.leftLabel': { en: '{label}', zh: '{label}' },
  'widget.svn.diff.status.leftRev': { en: 'r{rev}', zh: 'r{rev}' },
  'widget.svn.diff.status.rightLabel': { en: '{label}', zh: '{label}' },
  'widget.svn.diff.status.rightWorkingCopy': { en: 'Working Copy', zh: '工作副本' },
  'widget.svn.diff.status.repositoryRev': { en: 'r{rev}', zh: 'r{rev}' },
  'widget.svn.diff.status.workingCopy': { en: 'Working Copy', zh: '工作副本' },
  'widget.svn.diff.status.svnNotAvailable': { en: 'SVN not available', zh: 'SVN 不可用' },
  'widget.svn.diff.pickRevisionPlaceholder': { en: 'Select revision for {target} ({path})', zh: '为 {target} 选择版本（{path}）' },
  'widget.svn.diff.pickRevisionTooltip': { en: 'Pick revision', zh: '选择版本' },
  'widget.svn.diff.filePathPlaceholder': { en: 'Enter file path...', zh: '输入文件路径...' },
  'widget.svn.diff.leftRevisionPlaceholder': { en: 'Enter left revision...', zh: '输入左侧版本...' },
  'widget.svn.diff.rightRevisionPlaceholder': { en: 'Enter right revision...', zh: '输入右侧版本...' },
  'widget.svn.diff.filePathAria': { en: 'File path', zh: '文件路径' },
  'widget.svn.diff.leftRevisionAria': { en: 'Left revision', zh: '左侧版本' },
  'widget.svn.diff.rightRevisionAria': { en: 'Right revision', zh: '右侧版本' },
  'widget.svn.diff.showDiff': { en: 'Show diff', zh: '显示差异' },
  'widget.svn.diff.swapTooltip': { en: 'Swap sides', zh: '交换两侧' },
  'widget.svn.diff.titleWithFile': { en: 'Diff: {file}', zh: '差异：{file}' },
  'widget.svn.diff.noActiveWorkingCopy': { en: 'No active working copy', zh: '没有活动的工作副本' },
  'widget.svn.diff.noHistoryForFile': { en: 'No history for file', zh: '该文件无历史记录' },
  'widget.svn.diff.noMessage': { en: 'No message', zh: '无消息' },
  'widget.svn.diff.enterFilePathFirst': { en: 'Enter a file path first', zh: '请先输入文件路径' },
  'widget.svn.diff.error.enterFilePath': { en: 'Enter a file path', zh: '请输入文件路径' },
  'widget.svn.diff.error.loadFailed': { en: 'Failed to load diff', zh: '加载差异失败' },
  'widget.svn.diff.error.noDiffContent': { en: 'No diff content', zh: '暂无差异内容' },
  'widget.svn.diff.loadHistoryFailed': { en: 'Failed to load history', zh: '加载历史失败' },
  'widget.svn.diff.mode.label': { en: 'Mode', zh: '模式' },
  'widget.svn.diff.mode.localBase': { en: 'Local base', zh: '本地基础版本' },
  'widget.svn.diff.mode.localHead': { en: 'Local HEAD', zh: '本地 HEAD' },
  'widget.svn.diff.mode.localRev': { en: 'Local revision', zh: '本地版本' },
  'widget.svn.diff.mode.revRev': { en: 'Revision vs revision', zh: '版本比较' },
  'widget.svn.diff.revBase': { en: 'Base', zh: '基础版本' },
  'widget.svn.diff.revCommitted': { en: 'Committed', zh: '已提交' },
  'widget.svn.diff.revHead': { en: 'HEAD', zh: 'HEAD' },
  'widget.svn.diff.revPrev': { en: 'Previous', zh: '上一个' },

  'widget.svn.history.daysAgo': { en: '{count} days ago', zh: '{count} 天前' },
  'widget.svn.history.exportedTo': { en: 'Exported to {path}', zh: '已导出到 {path}' },
  'widget.svn.history.exportFailed': { en: 'Export failed: {message}', zh: '导出失败：{message}' },
  'widget.svn.history.revertConfirm': { en: 'Revert {path} to r{rev}?', zh: '将 {path} 还原到 r{rev}？' },
  'widget.svn.history.revertedTo': { en: 'Reverted to r{rev}', zh: '已还原到 r{rev}' },
  'widget.svn.history.revertFailed': { en: 'Revert failed: {message}', zh: '还原失败：{message}' },
  'widget.svn.history.copiedRevision': { en: 'Copied r{rev}', zh: '已复制 r{rev}' },
  'widget.svn.history.copyFailed': { en: 'Copy failed: {message}', zh: '复制失败：{message}' },
  'widget.svn.history.yesterday': { en: 'Yesterday', zh: '昨天' },
  'widget.svn.history.titleWithPath': { en: 'History: {path}', zh: '历史：{path}' },
  'widget.svn.history.revisionTitle': { en: 'Revision {rev}', zh: '版本 {rev}' },
  'widget.svn.history.changedPaths': { en: 'Changed paths', zh: '变更路径' },
  'widget.svn.history.compareWithPrevious': { en: 'Compare with previous', zh: '与上一个比较' },
  'widget.svn.history.compareWithWorkingCopy': { en: 'Compare with working copy', zh: '与工作副本比较' },
  'widget.svn.history.exportRevision': { en: 'Export revision', zh: '导出版本' },
  'widget.svn.history.copyRevision': { en: 'Copy revision', zh: '复制版本' },
  'widget.svn.history.revertToRevision': { en: 'Revert to revision', zh: '还原到版本' },
  'widget.svn.history.showChangedPaths': { en: 'Show changed paths', zh: '显示变更路径' },
  'widget.svn.history.filterAuthorPlaceholder': { en: 'Filter author...', zh: '筛选作者...' },
  'widget.svn.history.filterMessagePlaceholder': { en: 'Filter message...', zh: '筛选消息...' },
  'widget.svn.history.authorLabel': { en: 'Author', zh: '作者' },
  'widget.svn.history.dateLabel': { en: 'Date', zh: '日期' },
  'widget.svn.history.messageLabel': { en: 'Message', zh: '消息' },
  'widget.svn.history.noActiveWorkingCopy': { en: 'No active working copy', zh: '没有活动的工作副本' },
  'widget.svn.history.noFilePathBound': { en: 'No file path bound', zh: '未绑定文件路径' },
  'widget.svn.history.noMessage': { en: 'No message', zh: '无消息' },
  'widget.svn.history.noPreviousRevision': { en: 'No previous revision', zh: '没有上一个版本' },
  'widget.svn.history.refresh': { en: 'Refresh', zh: '刷新' },

  // Search
  'widget.search.center.stats.match': { en: '{count} matches', zh: '{count} 个匹配' },
  'widget.search.center.stats.matchInFiles': { en: '{count} matches in {fileCount} files', zh: '{count} 个匹配，涉及 {fileCount} 个文件' },
  'widget.search.center.stats.streaming': { en: ' (streaming)', zh: '（流式加载）' },
  'widget.search.center.status.error': { en: 'Error: {message}', zh: '错误：{message}' },
  'widget.search.center.status.cancelled': { en: 'Cancelled', zh: '已取消' },
  'widget.search.center.status.empty': { en: 'No results', zh: '无结果' },
  'widget.search.center.status.idle': { en: 'Idle', zh: '空闲' },
  'widget.search.center.status.loading': { en: 'Loading...', zh: '加载中...' },
  'widget.search.center.status.unknownError': { en: 'Unknown error', zh: '未知错误' },
  'widget.search.center.placeholder.search': { en: 'Search...', zh: '搜索...' },
  'widget.search.center.placeholder.replace': { en: 'Replace...', zh: '替换...' },
  'widget.search.center.placeholder.replaceWith': { en: 'Replace with...', zh: '替换为...' },
  'widget.search.center.placeholder.fileTypes': { en: 'File types...', zh: '文件类型...' },
  'widget.search.center.closeTooltip': { en: 'Close', zh: '关闭' },
  'widget.search.center.cancel': { en: 'Cancel', zh: '取消' },
  'widget.search.center.submit.find': { en: 'Find', zh: '查找' },
  'widget.search.center.submit.search': { en: 'Search', zh: '搜索' },
  'widget.search.center.submit.searching': { en: 'Searching...', zh: '搜索中...' },
  'widget.search.center.mode.search': { en: 'Search', zh: '搜索' },
  'widget.search.center.mode.replace': { en: 'Replace', zh: '替换' },
  'widget.search.center.preview.show': { en: 'Show preview', zh: '显示预览' },
  'widget.search.center.preview.hide': { en: 'Hide preview', zh: '隐藏预览' },
  'widget.search.center.replace.all': { en: 'Replace all', zh: '全部替换' },
  'widget.search.center.replace.replacing': { en: 'Replacing...', zh: '替换中...' },
  'widget.search.center.replace.undo': { en: 'Undo', zh: '撤销' },
  'widget.search.center.truncated': { en: 'Results truncated', zh: '结果已截断' },
  'widget.search.center.filter.case.title': { en: 'Match case', zh: '区分大小写' },
  'widget.search.center.filter.regex.title': { en: 'Regex', zh: '正则表达式' },
  'widget.search.center.filter.word.title': { en: 'Whole word', zh: '全字匹配' },
  'widget.search.center.ariaLabel.searchQuery': { en: 'Search query', zh: '搜索查询' },
  'widget.search.center.ariaLabel.replaceText': { en: 'Replace text', zh: '替换文本' },
  'widget.search.center.ariaLabel.scope': { en: 'Search scope', zh: '搜索范围' },
  'widget.search.center.ariaLabel.fileTypes': { en: 'File types', zh: '文件类型' },
  'widget.search.center.ariaLabel.results': { en: 'Search results', zh: '搜索结果' },
  'widget.search.center.ariaLabel.findInPath': { en: 'Find in path', zh: '在路径中查找' },
  'widget.search.center.ariaLabel.replaceInPath': { en: 'Replace in path', zh: '在路径中替换' },

  'widget.search.everywhere.placeholder': { en: 'Search everywhere...', zh: '全局搜索...' },
  'widget.search.everywhere.status.empty': { en: 'No results', zh: '无结果' },
  'widget.search.everywhere.status.idle': { en: 'Idle', zh: '空闲' },
  'widget.search.everywhere.status.loading': { en: 'Loading...', zh: '加载中...' },
  'widget.search.everywhere.category.ariaLabel': { en: 'Categories', zh: '分类' },
  'widget.search.everywhere.ariaLabel.query': { en: 'Search query', zh: '搜索查询' },
  'widget.search.everywhere.ariaLabel.categories': { en: 'Categories', zh: '分类' },

  'widget.search.findAction.placeholder': { en: 'Find action...', zh: '查找操作...' },
  'widget.search.findAction.status.empty': { en: 'No results', zh: '无结果' },
  'widget.search.findAction.status.idle': { en: 'Idle', zh: '空闲' },
  'widget.search.findAction.status.loading': { en: 'Loading...', zh: '加载中...' },
  'widget.search.findAction.status.unknownError': { en: 'Unknown error', zh: '未知错误' },
  'widget.search.findAction.ariaLabel.query': { en: 'Action query', zh: '操作查询' },
  'widget.search.findAction.ariaLabel.results': { en: 'Action results', zh: '操作结果' },

  'widget.search.findClass.placeholder': { en: 'Find class...', zh: '查找类...' },
  'widget.search.findClass.status.empty': { en: 'No results', zh: '无结果' },
  'widget.search.findClass.status.idle': { en: 'Idle', zh: '空闲' },
  'widget.search.findClass.status.loading': { en: 'Loading...', zh: '加载中...' },
  'widget.search.findClass.status.unknownError': { en: 'Unknown error', zh: '未知错误' },
  'widget.search.findClass.ariaLabel.query': { en: 'Class query', zh: '类查询' },
  'widget.search.findClass.ariaLabel.results': { en: 'Class results', zh: '类结果' },

  'widget.search.findFile.placeholder': { en: 'Find file...', zh: '查找文件...' },
  'widget.search.findFile.status.empty': { en: 'No results', zh: '无结果' },
  'widget.search.findFile.status.idle': { en: 'Idle', zh: '空闲' },
  'widget.search.findFile.status.loading': { en: 'Loading...', zh: '加载中...' },
  'widget.search.findFile.status.unknownError': { en: 'Unknown error', zh: '未知错误' },
  'widget.search.findFile.ariaLabel.query': { en: 'File query', zh: '文件查询' },
  'widget.search.findFile.ariaLabel.results': { en: 'File results', zh: '文件结果' },

  'widget.search.findSymbol.placeholder': { en: 'Find symbol...', zh: '查找符号...' },
  'widget.search.findSymbol.status.empty': { en: 'No results', zh: '无结果' },
  'widget.search.findSymbol.status.idle': { en: 'Idle', zh: '空闲' },
  'widget.search.findSymbol.status.loading': { en: 'Loading...', zh: '加载中...' },
  'widget.search.findSymbol.status.unknownError': { en: 'Unknown error', zh: '未知错误' },
  'widget.search.findSymbol.ariaLabel.query': { en: 'Symbol query', zh: '符号查询' },
  'widget.search.findSymbol.ariaLabel.results': { en: 'Symbol results', zh: '符号结果' },

  // SQL
  'widget.sql.connection.detail': { en: '{name} — {username}@{host}:{port}', zh: '{name} — {username}@{host}:{port}' },
  'widget.sql.connection.oracleVersion': { en: 'Version {version}', zh: '版本 {version}' },
  'widget.sql.connection.testSuccess': { en: 'Connection OK', zh: '连接成功' },
  'widget.sql.connection.testFailed': { en: 'Connection failed: {error}', zh: '连接失败：{error}' },
  'widget.sql.connection.imported': { en: 'Imported {count} connection(s)', zh: '已导入 {count} 个连接' },
  'widget.sql.connection.invalidImport': { en: 'Invalid import file', zh: '导入文件无效' },
  'widget.sql.connection.addConnection': { en: 'Add connection', zh: '添加连接' },
  'widget.sql.connection.editTitle': { en: 'Edit connection', zh: '编辑连接' },
  'widget.sql.connection.newTitle': { en: 'New connection', zh: '新建连接' },
  'widget.sql.connection.save': { en: 'Save', zh: '保存' },
  'widget.sql.connection.update': { en: 'Update', zh: '更新' },
  'widget.sql.connection.test': { en: 'Test', zh: '测试' },
  'widget.sql.connection.testing': { en: 'Testing…', zh: '测试中…' },
  'widget.sql.connection.deleteConfirm': { en: 'Delete this connection?', zh: '删除此连接？' },
  'widget.sql.connection.importConfigs': { en: 'Import', zh: '导入' },
  'widget.sql.connection.exportConfigs': { en: 'Export', zh: '导出' },
  'widget.sql.connection.useServiceName': { en: 'Use service name', zh: '使用服务名' },
  'widget.sql.connection.empty': { en: 'No connections', zh: '暂无连接' },
  'widget.sql.connection.hostLabel': { en: 'Host', zh: '主机' },
  'widget.sql.connection.portLabel': { en: 'Port', zh: '端口' },
  'widget.sql.connection.nameLabel': { en: 'Name', zh: '名称' },
  'widget.sql.connection.usernameLabel': { en: 'Username', zh: '用户名' },
  'widget.sql.connection.passwordLabel': { en: 'Password', zh: '密码' },
  'widget.sql.connection.serviceNameLabel': { en: 'Service name', zh: '服务名' },
  'widget.sql.connection.sidLabel': { en: 'SID', zh: 'SID' },
  'widget.sql.connection.hostPlaceholder': { en: 'Host...', zh: '主机...' },
  'widget.sql.connection.namePlaceholder': { en: 'Name...', zh: '名称...' },
  'widget.sql.connection.usernamePlaceholder': { en: 'Username...', zh: '用户名...' },
  'widget.sql.connection.passwordPlaceholder': { en: 'Password...', zh: '密码...' },
  'widget.sql.connection.serviceNamePlaceholder': { en: 'Service name...', zh: '服务名...' },
  'widget.sql.connection.sidPlaceholder': { en: 'SID...', zh: 'SID...' },

  'widget.sql.editor.connectionOption': { en: '{name} ({username}@{host}:{port})', zh: '{name}（{username}@{host}:{port}）' },
  'widget.sql.editor.dangerousStatement': { en: 'Dangerous statement: {reason}\n{sql}', zh: '危险语句：{reason}\n{sql}' },
  'widget.sql.editor.historyTime': { en: '{time}ms', zh: '{time}ms' },
  'widget.sql.editor.historyRowCount': { en: '{count} rows', zh: '{count} 行' },
  'widget.sql.editor.execute': { en: 'Execute', zh: '执行' },
  'widget.sql.editor.executeAnyway': { en: 'Execute anyway', zh: '仍要执行' },
  'widget.sql.editor.executing': { en: 'Executing...', zh: '执行中...' },
  'widget.sql.editor.history': { en: 'History', zh: '历史' },
  'widget.sql.editor.hideHistory': { en: 'Hide history', zh: '隐藏历史' },
  'widget.sql.editor.historyTitle': { en: 'Query history', zh: '查询历史' },
  'widget.sql.editor.historyEmpty': { en: 'No history', zh: '暂无历史' },
  'widget.sql.editor.placeholder': { en: 'Enter SQL...', zh: '输入 SQL...' },
  'widget.sql.editor.readOnly': { en: 'Read only', zh: '只读' },
  'widget.sql.editor.selectConnection': { en: 'Select connection', zh: '选择连接' },
  'widget.sql.editor.executeTooltip': { en: 'Execute query', zh: '执行查询' },
  'widget.sql.editor.historyItemTooltip': { en: 'History item', zh: '历史项' },
  'widget.sql.editor.disableReadOnlyConfirm': { en: 'Disable read-only mode?', zh: '禁用只读模式？' },

  'widget.sql.results.rowCount': { en: '{count} rows', zh: '{count} 行' },
  'widget.sql.results.truncated': { en: ' (total {total})', zh: '（共 {total}）' },
  'widget.sql.results.executionTime': { en: '{time}ms', zh: '{time}ms' },
  'widget.sql.results.pageInfo': { en: 'Page {page} of {total}', zh: '第 {page} / {total} 页' },
  'widget.sql.results.nullValue': { en: 'NULL', zh: 'NULL' },
  'widget.sql.results.csvFileName': { en: 'results-{timestamp}.csv', zh: 'results-{timestamp}.csv' },
  'widget.sql.results.jsonFileName': { en: 'results-{timestamp}.json', zh: 'results-{timestamp}.json' },
  'widget.sql.results.columnTooltip': { en: '{label} ({type})', zh: '{label}（{type}）' },
  'widget.sql.results.empty': { en: 'No results', zh: '暂无结果' },
  'widget.sql.results.next': { en: 'Next', zh: '下一页' },
  'widget.sql.results.previous': { en: 'Previous', zh: '上一页' },
  'widget.sql.results.exportCsv': { en: 'Export CSV', zh: '导出 CSV' },
  'widget.sql.results.exportJson': { en: 'Export JSON', zh: '导出 JSON' },
  'widget.sql.results.truncatedHint': { en: 'Results truncated', zh: '结果已截断' },
  'widget.sql.results.error.title': { en: 'Error', zh: '错误' },

  // Test
  'widget.test.output.runOption': { en: '{scope}: {target}', zh: '{scope}：{target}' },
  'widget.test.output.label.scope': { en: 'Scope: {scope}', zh: '范围：{scope}' },
  'widget.test.output.label.target': { en: 'Target: {target}', zh: '目标：{target}' },
  'widget.test.output.label.started': { en: 'Started: {startTime}', zh: '开始：{startTime}' },
  'widget.test.output.label.ended': { en: 'Ended: {endTime}', zh: '结束：{endTime}' },
  'widget.test.output.summary.passed': { en: '{count} passed', zh: '{count} 通过' },
  'widget.test.output.summary.failed': { en: '{count} failed', zh: '{count} 失败' },
  'widget.test.output.summary.skipped': { en: '{count} skipped', zh: '{count} 跳过' },
  'widget.test.output.summary.errors': { en: '{count} errors', zh: '{count} 错误' },
  'widget.test.output.selectRunAria': { en: 'Select test run', zh: '选择测试运行' },
  'widget.test.output.targetAll': { en: 'All tests', zh: '所有测试' },
  'widget.test.output.testResults': { en: 'Test results', zh: '测试结果' },
  'widget.test.output.rawOutput': { en: 'Raw output', zh: '原始输出' },
  'widget.test.output.stackTrace': { en: 'Stack trace', zh: '堆栈跟踪' },
  'widget.test.output.assertionFailure': { en: 'Assertion failure', zh: '断言失败' },
  'widget.test.output.output': { en: 'Output', zh: '输出' },

  'widget.test.tree.count.one': { en: '{count} test', zh: '{count} 个测试' },
  'widget.test.tree.count.other': { en: '{count} tests', zh: '{count} 个测试' },
  'widget.test.tree.summary.passed': { en: '{passed}/{total} passed', zh: '{passed}/{total} 通过' },
  'widget.test.tree.summary.failed': { en: '{count} failed', zh: '{count} 失败' },
  'widget.test.tree.summary.skipped': { en: '{count} skipped', zh: '{count} 跳过' },
  'widget.test.tree.emptyStateReason': { en: 'Press {action} to discover tests.', zh: '点击「{action}」发现测试。' },
  'widget.test.tree.runAll': { en: 'Run all', zh: '运行全部' },
  'widget.test.tree.runAllAria': { en: 'Run all tests', zh: '运行全部测试' },
  'widget.test.tree.run': { en: 'Run', zh: '运行' },
  'widget.test.tree.runAria': { en: 'Run test', zh: '运行测试' },
  'widget.test.tree.cancel': { en: 'Cancel', zh: '取消' },
  'widget.test.tree.cancelAria': { en: 'Cancel test run', zh: '取消测试运行' },
  'widget.test.tree.cancelling': { en: 'Cancelling…', zh: '取消中…' },
  'widget.test.tree.refresh': { en: 'Refresh', zh: '刷新' },
  'widget.test.tree.refreshAria': { en: 'Refresh tests', zh: '刷新测试' },
  'widget.test.tree.treeAria': { en: 'Test tree', zh: '测试树' },
  'widget.test.tree.disconnectedTitle': { en: 'Disconnected', zh: '已断开连接' },
  'widget.test.tree.disconnectedReason': { en: 'Cannot reach the runtime agent. Test commands are unavailable.', zh: '无法连接到运行时代理，测试命令不可用。' },
  'widget.test.tree.loading': { en: 'Loading...', zh: '加载中...' },

  // Java
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
  'widget.java.debugMultimodule.loading': { en: 'Loading...', zh: '加载中...' },
  'widget.java.debugMultimodule.retry': { en: 'Retry', zh: '重试' },
  'widget.java.debugMultimodule.tablistAriaLabel': { en: 'Debug sessions', zh: '调试会话' },
  'widget.java.debugMultimodule.loadingAriaLabel': { en: 'Loading debug sessions', zh: '正在加载调试会话' },
  'widget.java.debugMultimodule.retryTitle': { en: 'Retry loading', zh: '重试加载' },
  'widget.java.debugMultimodule.breakpoint.deferred': { en: 'Deferred', zh: '延迟' },
  'widget.java.debugMultimodule.breakpoint.deferredAria': { en: 'Deferred breakpoint', zh: '延迟断点' },
  'widget.java.debugMultimodule.breakpoint.deferredTitle': { en: 'Deferred breakpoint', zh: '延迟断点' },
  'widget.java.debugMultimodule.breakpoint.disableAria': { en: 'Disable breakpoint', zh: '禁用断点' },
  'widget.java.debugMultimodule.breakpoint.disableTitle': { en: 'Disable breakpoint', zh: '禁用断点' },
  'widget.java.debugMultimodule.breakpoint.enableAria': { en: 'Enable breakpoint', zh: '启用断点' },
  'widget.java.debugMultimodule.breakpoint.enableTitle': { en: 'Enable breakpoint', zh: '启用断点' },
  'widget.java.debugMultimodule.breakpoints.emptyAriaLabel': { en: 'No breakpoints', zh: '无断点' },
  'widget.java.debugMultimodule.breakpoints.emptyReason': { en: 'No breakpoints set', zh: '未设置断点' },
  'widget.java.debugMultimodule.breakpoints.emptyTitle': { en: 'No breakpoints', zh: '无断点' },
  'widget.java.debugMultimodule.breakpoints.listAriaLabel': { en: 'Breakpoints list', zh: '断点列表' },
  'widget.java.debugMultimodule.dependencies.dependsOn': { en: 'Depends on', zh: '依赖于' },
  'widget.java.debugMultimodule.dependencies.emptyAriaLabel': { en: 'No dependencies', zh: '无依赖' },
  'widget.java.debugMultimodule.dependencies.emptyReason': { en: 'No module dependencies', zh: '无模块依赖' },
  'widget.java.debugMultimodule.dependencies.emptyTitle': { en: 'No dependencies', zh: '无依赖' },
  'widget.java.debugMultimodule.dependencies.nodeTitle': { en: 'Module dependency', zh: '模块依赖' },
  'widget.java.debugMultimodule.dependencies.treeAriaLabel': { en: 'Dependencies tree', zh: '依赖树' },
  'widget.java.debugMultimodule.events.emptyAriaLabel': { en: 'No events', zh: '无事件' },
  'widget.java.debugMultimodule.events.emptyReason': { en: 'No debug events', zh: '无调试事件' },
  'widget.java.debugMultimodule.events.emptyTitle': { en: 'No events', zh: '无事件' },
  'widget.java.debugMultimodule.events.listAriaLabel': { en: 'Events list', zh: '事件列表' },
  'widget.java.debugMultimodule.sessions.emptyAriaLabel': { en: 'No sessions', zh: '无会话' },
  'widget.java.debugMultimodule.sessions.emptyReason': { en: 'No debug sessions', zh: '无调试会话' },
  'widget.java.debugMultimodule.sessions.emptyTitle': { en: 'No sessions', zh: '无会话' },
  'widget.java.debugMultimodule.sessions.listAriaLabel': { en: 'Sessions list', zh: '会话列表' },

  'widget.java.hierarchy.loadingChildren': { en: 'Loading children...', zh: '加载子节点...' },
  'widget.java.hierarchy.error.expand': { en: 'Failed to expand: {message}', zh: '展开失败：{message}' },
  'widget.java.hierarchy.error.loadCallHierarchy': { en: 'Failed to load call hierarchy: {message}', zh: '加载调用层次结构失败：{message}' },
  'widget.java.hierarchy.error.loadTypeHierarchy': { en: 'Failed to load type hierarchy: {message}', zh: '加载类型层次结构失败：{message}' },
  'widget.java.hierarchy.error.noCallHierarchy': { en: 'No call hierarchy', zh: '无调用层次结构' },
  'widget.java.hierarchy.error.noTypeHierarchy': { en: 'No type hierarchy', zh: '无类型层次结构' },
  'widget.java.hierarchy.empty.title': { en: 'No hierarchy', zh: '无层次结构' },
  'widget.java.hierarchy.empty.reason': { en: 'Select a type to view its hierarchy.', zh: '选择类型以查看其层次结构。' },
  'widget.java.hierarchy.loading': { en: 'Loading...', zh: '加载中...' },

  'widget.java.hotswap.durationMs': { en: '{ms}ms', zh: '{ms}ms' },
  'widget.java.hotswap.durationSec': { en: '{sec}s', zh: '{sec}秒' },
  'widget.java.hotswap.detail.title': { en: 'Details', zh: '详情' },
  'widget.java.hotswap.detail.file': { en: 'File', zh: '文件' },
  'widget.java.hotswap.detail.status': { en: 'Status', zh: '状态' },
  'widget.java.hotswap.detail.time': { en: 'Time', zh: '时间' },
  'widget.java.hotswap.detail.duration': { en: 'Duration', zh: '耗时' },
  'widget.java.hotswap.detail.message': { en: 'Message', zh: '消息' },
  'widget.java.hotswap.empty.title': { en: 'No hot swap operations', zh: '无热替换操作' },
  'widget.java.hotswap.empty.hint': { en: 'Edit and save a Java file during debugging to trigger hot swap.', zh: '调试期间编辑并保存 Java 文件以触发热替换。' },
  'widget.java.hotswap.historyAriaLabel': { en: 'Hot swap history', zh: '热替换历史' },
  'widget.java.hotswap.status.failed': { en: 'Failed', zh: '失败' },
  'widget.java.hotswap.status.inProgress': { en: 'In Progress...', zh: '进行中...' },
  'widget.java.hotswap.status.success': { en: 'Success', zh: '成功' },

  'widget.java.references.resultSummary': { en: '{count} usages of {symbolName}', zh: '{symbolName} 的 {count} 处引用' },
  'widget.java.references.titleWithSymbol': { en: 'References: {symbolName}', zh: '引用：{symbolName}' },
  'widget.java.references.titleWithCount': { en: '{name} ({count})', zh: '{name}（{count}）' },
  'widget.java.references.linePreview': { en: 'Line {line}', zh: '第 {line} 行' },
  'widget.java.references.fallbackSymbol': { en: 'symbol', zh: '符号' },
  'widget.java.references.loading': { en: 'Loading...', zh: '加载中...' },
  'widget.java.references.empty.title': { en: 'No references', zh: '无引用' },
  'widget.java.references.empty.reason': { en: 'Select a symbol to find its references.', zh: '选择符号以查找其引用。' },
  'widget.java.references.empty.noResults': { en: 'No references found', zh: '未找到引用' },
  'widget.java.references.error.fetchFailed': { en: 'Failed to fetch references', zh: '获取引用失败' },

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

  // Build
  'widget.build.customRunner.result.success': { en: 'Success (exit {exitCode})', zh: '成功（退出码 {exitCode}）' },
  'widget.build.customRunner.result.failed': { en: 'Failed (exit {exitCode})', zh: '失败（退出码 {exitCode}）' },
  'widget.build.customRunner.log.started': { en: 'Build {buildId} started', zh: '构建 {buildId} 已启动' },
  'widget.build.customRunner.log.running': { en: 'Running: {command}', zh: '正在运行：{command}' },
  'widget.build.customRunner.log.waiting': { en: 'Waiting for completion...', zh: '等待完成...' },
  'widget.build.customRunner.error.noCommand': { en: 'No command specified', zh: '未指定命令' },
  'widget.build.customRunner.error.requestFailed': { en: 'Request failed: {message}', zh: '请求失败：{message}' },
  'widget.build.customRunner.commandPlaceholder': { en: 'Enter command...', zh: '输入命令...' },
  'widget.build.customRunner.title': { en: 'Custom Build Runner', zh: '自定义构建运行器' },
  'widget.build.customRunner.caption': { en: 'Kairo Custom Build Runner', zh: 'Kairo 自定义构建运行器' },

  'widget.build.maven.section.conflicts': { en: 'Conflicts ({count})', zh: '冲突（{count}）' },
  'widget.build.maven.section.dependencies': { en: 'Dependencies ({count})', zh: '依赖（{count}）' },
  'widget.build.maven.section.lifecycleGoals': { en: 'Lifecycle Goals', zh: '生命周期目标' },
  'widget.build.maven.conflict.versions': { en: 'Versions: {versions}', zh: '版本：{versions}' },
  'widget.build.maven.conflict.resolved': { en: 'Resolved: {version}', zh: '已解析：{version}' },
  'widget.build.maven.output.failed': { en: 'Failed', zh: '失败' },
  'widget.build.maven.output.success': { en: 'Success', zh: '成功' },
  'widget.build.maven.loading': { en: 'Loading...', zh: '加载中...' },
  'widget.build.maven.title': { en: 'Maven', zh: 'Maven' },
  'widget.build.maven.caption': { en: 'Kairo Maven', zh: 'Kairo Maven' },
  'widget.build.maven.empty.noProjectTitle': { en: 'No Maven project', zh: '无 Maven 项目' },
  'widget.build.maven.empty.noProjectReason': { en: 'Open a workspace containing a pom.xml.', zh: '打开包含 pom.xml 的工作区。' },
  'widget.build.maven.label.artifact': { en: 'Artifact', zh: 'Artifact' },
  'widget.build.maven.label.description': { en: 'Description', zh: '描述' },
  'widget.build.maven.label.group': { en: 'Group', zh: 'Group' },
  'widget.build.maven.label.packaging': { en: 'Packaging', zh: '打包方式' },
  'widget.build.maven.label.version': { en: 'Version', zh: '版本' },

  // Remote
  'widget.remote.connection.terminalName': { en: 'Terminal {index}', zh: '终端 {index}' },
  'widget.remote.connection.retry': { en: 'Reconnecting ({attempt})...', zh: '正在重连（{attempt}）...' },
  'widget.remote.connection.title': { en: 'Remote Connection', zh: '远程连接' },
  'widget.remote.connection.caption': { en: 'Kairo Remote Connection', zh: 'Kairo 远程连接' },
  'widget.remote.connection.action.connect': { en: 'Connect', zh: '连接' },
  'widget.remote.connection.action.disconnect': { en: 'Disconnect', zh: '断开' },
  'widget.remote.connection.action.newTerminal': { en: 'New terminal', zh: '新建终端' },
  'widget.remote.connection.action.goUp': { en: 'Go up', zh: '上一级' },
  'widget.remote.connection.auth.password': { en: 'Password', zh: '密码' },
  'widget.remote.connection.auth.keyFile': { en: 'Key file', zh: '密钥文件' },
  'widget.remote.connection.auth.keyData': { en: 'Key data', zh: '密钥内容' },
  'widget.remote.connection.column.mode': { en: 'Mode', zh: '模式' },
  'widget.remote.connection.column.modified': { en: 'Modified', zh: '修改时间' },
  'widget.remote.connection.label.authMethod': { en: 'Auth method', zh: '认证方式' },
  'widget.remote.connection.label.host': { en: 'Host', zh: '主机' },
  'widget.remote.connection.label.port': { en: 'Port', zh: '端口' },
  'widget.remote.connection.label.username': { en: 'Username', zh: '用户名' },
  'widget.remote.connection.label.password': { en: 'Password', zh: '密码' },
  'widget.remote.connection.label.path': { en: 'Path', zh: '路径' },
  'widget.remote.connection.label.keyFile': { en: 'Key file', zh: '密钥文件' },
  'widget.remote.connection.label.keyData': { en: 'Key data', zh: '密钥内容' },
  'widget.remote.connection.label.keyPassphrase': { en: 'Key passphrase', zh: '密钥密码' },
  'widget.remote.connection.label.remoteAgentPort': { en: 'Remote agent port', zh: '远程代理端口' },
  'widget.remote.connection.label.keepAliveInterval': { en: 'Keep-alive interval', zh: '保活间隔' },
  'widget.remote.connection.label.maxReconnectRetries': { en: 'Max reconnect retries', zh: '最大重连次数' },
  'widget.remote.connection.placeholder.host': { en: 'Host...', zh: '主机...' },
  'widget.remote.connection.placeholder.username': { en: 'Username...', zh: '用户名...' },
  'widget.remote.connection.placeholder.password': { en: 'Password...', zh: '密码...' },
  'widget.remote.connection.placeholder.keyFile': { en: 'Key file path...', zh: '密钥文件路径...' },
  'widget.remote.connection.placeholder.keyData': { en: 'Key data...', zh: '密钥内容...' },
  'widget.remote.connection.placeholder.keyPassphrase': { en: 'Key passphrase...', zh: '密钥密码...' },
  'widget.remote.connection.state.connected': { en: 'Connected', zh: '已连接' },
  'widget.remote.connection.tabsAria': { en: 'Remote connection tabs', zh: '远程连接标签页' },
  'widget.remote.connection.empty.connectTitle': { en: 'Not connected', zh: '未连接' },
  'widget.remote.connection.empty.connectReason': { en: 'Enter connection details and click Connect.', zh: '输入连接信息并点击连接。' },
  'widget.remote.connection.empty.filesTitle': { en: 'No files', zh: '无文件' },
  'widget.remote.connection.empty.filesReason': { en: 'Connect to a remote host to browse files.', zh: '连接到远程主机以浏览文件。' },
  'widget.remote.connection.empty.terminalTitle': { en: 'No terminal', zh: '无终端' },
  'widget.remote.connection.empty.terminalReason': { en: 'Open a terminal after connecting.', zh: '连接后打开终端。' },
  'widget.remote.connection.errorTitle': { en: 'Connection error', zh: '连接错误' },

  'widget.remote.panel.title': { en: 'Remote Panel', zh: '远程面板' },
  'widget.remote.panel.caption': { en: 'Kairo Remote Panel', zh: 'Kairo 远程面板' },
  'widget.remote.panel.tabsAria': { en: 'Remote panel tabs', zh: '远程面板标签页' },
  'widget.remote.panel.header.title': { en: 'Remote', zh: '远程' },
  'widget.remote.panel.header.connected': { en: 'Connected', zh: '已连接' },
  'widget.remote.panel.header.disconnected': { en: 'Disconnected', zh: '已断开' },
  'widget.remote.panel.loadingTitle': { en: 'Loading', zh: '加载中' },
  'widget.remote.panel.loadingReason': { en: 'Loading remote panel data...', zh: '正在加载远程面板数据...' },
  'widget.remote.panel.connection.title': { en: 'Connection', zh: '连接' },
  'widget.remote.panel.connection.host': { en: 'Host', zh: '主机' },
  'widget.remote.panel.connection.port': { en: 'Port', zh: '端口' },
  'widget.remote.panel.connection.connectedAt': { en: 'Connected at', zh: '连接于' },
  'widget.remote.panel.connection.latency': { en: 'Latency', zh: '延迟' },
  'widget.remote.panel.connection.tlsVersion': { en: 'TLS version', zh: 'TLS 版本' },
  'widget.remote.panel.containers.title': { en: 'Containers', zh: '容器' },
  'widget.remote.panel.containers.action.start': { en: 'Start', zh: '启动' },
  'widget.remote.panel.containers.action.stop': { en: 'Stop', zh: '停止' },
  'widget.remote.panel.containers.action.pause': { en: 'Pause', zh: '暂停' },
  'widget.remote.panel.sessions.title': { en: 'Sessions', zh: '会话' },
  'widget.remote.panel.sessions.count': { en: '{count} session(s)', zh: '{count} 个会话' },
  'widget.remote.panel.sessions.role': { en: 'Role', zh: '角色' },
  'widget.remote.panel.sessions.activeSince': { en: 'Active since', zh: '活跃自' },
  'widget.remote.panel.sessions.lastActive': { en: 'Last active', zh: '最后活跃' },
  'widget.remote.panel.sync.title': { en: 'File Sync', zh: '文件同步' },
  'widget.remote.panel.sync.files': { en: 'Files', zh: '文件' },
  'widget.remote.panel.sync.conflicts': { en: 'Conflicts', zh: '冲突' },
  'widget.remote.panel.sync.lastSync': { en: 'Last sync', zh: '上次同步' },
  'widget.remote.panel.sync.progress': { en: 'Sync progress', zh: '同步进度' },
  'widget.remote.panel.sync.status.inSync': { en: 'In sync', zh: '已同步' },
  'widget.remote.panel.sync.status.syncing': { en: 'Syncing…', zh: '同步中…' },
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

  if (leaf.endsWith('Button')) return translatePhrase(camelToWords(leaf.replace(/Button$/, ''))) + '按钮';
  if (leaf.endsWith('ButtonAria')) return translatePhrase(camelToWords(leaf.replace(/ButtonAria$/, ''))) + '按钮';
  if (leaf.endsWith('Aria')) return translatePhrase(camelToWords(leaf.replace(/Aria$/, '')));
  if (leaf.endsWith('AriaLabel')) return translatePhrase(camelToWords(leaf.replace(/AriaLabel$/, '')));
  if (leaf.endsWith('Tooltip')) return translatePhrase(camelToWords(leaf.replace(/Tooltip$/, '')));
  if (leaf.endsWith('Placeholder')) return '输入' + translatePhrase(camelToWords(leaf.replace(/Placeholder$/, ''))) + '...';
  if (leaf.endsWith('Label')) return translatePhrase(camelToWords(leaf.replace(/Label$/, '')));
  if (leaf.endsWith('Hint')) return translatePhrase(camelToWords(leaf.replace(/Hint$/, '')));

  if (/^no[A-Z]/.test(leaf)) return '暂无' + translatePhrase(camelToWords(leaf.replace(/^no/, '')));

  const en = generateEn(keyPath);
  return translatePhrase(en);
}

function translatePhrase(text) {
  // Keep placeholders intact
  const placeholders = [];
  const template = text.replace(/\{[^}]+\}/g, m => {
    placeholders.push(m);
    return '\u0000';
  });

  const lower = template.toLowerCase();

  // Common phrase patterns
  const phrasePatterns = [
    [/^no (.+) yet$/i, '暂无$1'],
    [/^no (.+)$/i, '暂无$1'],
    [/^enter (.+)\.\.\.$/i, '输入$1...'],
    [/^start using the (.+) toolbar to populate this view\.$/i, '使用「$1」工具栏开始工作。'],
    [/^kairo (.+)$/i, 'Kairo $1'],
  ];

  for (const [regex, replacement] of phrasePatterns) {
    const m = lower.match(regex);
    if (m) {
      const translated = translateWords(m[1]);
      let result = replacement.replace('$1', translated);
      result = restorePlaceholders(result, placeholders);
      return result;
    }
  }

  return restorePlaceholders(translateWords(template), placeholders);
}

function translateWords(text) {
  const words = text.split(/\s+/);
  return words.map(w => {
    if (!w) return '';
    const lower = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!lower) return w;
    return zhTerms[lower] || w;
  }).join('').replace(/\{count\}\s*个/g, '{count} 个');
}

function restorePlaceholders(text, placeholders) {
  let idx = 0;
  return text.replace(/\u0000/g, () => placeholders[idx++]);
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

function escapeTsString(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/'/g, "\\'");
}

function objectToTs(obj, indent) {
  const lines = [];
  const prefix = ' '.repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`;
    if (typeof value === 'string') {
      lines.push(`${prefix}${safeKey}: '${escapeTsString(value)}',`);
    } else {
      lines.push(`${prefix}${safeKey}: {`);
      lines.push(...objectToTs(value, indent + 2));
      lines.push(`${prefix}},`);
    }
  }
  return lines;
}

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

function insertBlock(filePath, objectName, additions) {
  const content = fs.readFileSync(filePath, 'utf8');
  const search = new RegExp(`(\\s+${objectName}:\\s*\\{)`);
  const match = content.match(search);
  if (!match) throw new Error(`Could not find ${objectName} block in ${filePath}`);

  const insertIndex = match.index + match[1].length;
  const lines = objectToTs(additions, 4);
  if (lines.length === 0) return content;
  const block = '\n' + lines.join('\n') + '\n  ';
  return content.slice(0, insertIndex) + block + content.slice(insertIndex);
}

function insertCommonKeys(filePath, additions) {
  let content = fs.readFileSync(filePath, 'utf8');
  for (const key of additions) {
    const parts = key.split('.');
    const leaf = parts[parts.length - 1];
    const valueEn = specialCases[key]?.en || camelToWords(leaf);
    const valueZh = specialCases[key]?.zh || translatePhrase(valueEn);
    const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(leaf) ? leaf : `'${leaf}'`;
    const lineEn = `    ${safeKey}: '${valueEn.replace(/'/g, "\\'")}',`;
    const lineZh = `    ${safeKey}: '${valueZh.replace(/'/g, "\\'")}',`;

    const commonBlock = /(common:\s*\{)/;
    const match = content.match(commonBlock);
    if (!match) throw new Error(`Could not find common block in ${filePath}`);

    const insertIndex = match.index + match[1].length;
    const isZh = filePath.includes('zh-CN');
    const line = isZh ? lineZh : lineEn;
    content = content.slice(0, insertIndex) + '\n' + line + content.slice(insertIndex);
  }
  return content;
}

const enPath = path.join(process.cwd(), 'packages/i18n/src/locales/en.ts');
const zhPath = path.join(process.cwd(), 'packages/i18n/src/locales/zh-CN.ts');

let enContent = fs.readFileSync(enPath, 'utf8');
let zhContent = fs.readFileSync(zhPath, 'utf8');

// Insert widget additions
enContent = insertBlock(enPath, 'widget', enWidgetAdditions);
zhContent = insertBlock(zhPath, 'widget', zhWidgetAdditions);

// Insert common additions
if (missingCommonKeys.length > 0) {
  enContent = insertCommonKeysIntoContent(enContent, missingCommonKeys, 'en');
  zhContent = insertCommonKeysIntoContent(zhContent, missingCommonKeys, 'zh');
}

fs.writeFileSync(enPath, enContent);
fs.writeFileSync(zhPath, zhContent);

console.log(JSON.stringify({
  newWidgetKeys: missingWidgetKeys.length,
  newCommonKeys: missingCommonKeys.length,
  newWidgetNamespaces: Object.keys(enWidgetAdditions).length,
}, null, 2));

function insertCommonKeysIntoContent(content, additions, lang) {
  for (const key of additions) {
    const parts = key.split('.');
    const leaf = parts[parts.length - 1];
    const value = lang === 'en'
      ? (specialCases[key]?.en || camelToWords(leaf))
      : (specialCases[key]?.zh || translatePhrase(camelToWords(leaf)));
    const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(leaf) ? leaf : `'${leaf}'`;
    const line = `    ${safeKey}: '${escapeTsString(value)}',`;

    const commonBlock = /(common:\s*\{)/;
    const match = content.match(commonBlock);
    if (!match) throw new Error('Could not find common block');

    const insertIndex = match.index + match[1].length;
    content = content.slice(0, insertIndex) + '\n' + line + content.slice(insertIndex);
  }
  return content;
}
