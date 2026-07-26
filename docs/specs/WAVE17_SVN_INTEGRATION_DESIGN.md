# Kairo IDE SVN 集成开发设计与验收方案

## 文档信息

| 项目 | 内容 |
|------|------|
| 版本 | 1.0 |
| 日期 | 2026-07-25 |
| 目标 | 参考 IntelliJ IDEA SVN 功能，实现开箱即用的 SVN 版本控制集成 |
| 优先级 | P1（企业用户核心需求） |
| 依赖 | 无外部依赖，自动检测系统 SVN 客户端 |

---

## 一、产品需求概述

### 1.1 核心目标

为 Kairo IDE 提供完整的 Subversion (SVN) 版本控制集成，参考 IntelliJ IDEA 的 SVN 功能设计和用户体验，实现：

1. **零配置开箱即用**：Windows 电脑安装任意版本 SVN（TortoiseSVN、SlikSVN、VisualSVN、CollabNet SVN 等）即可自动检测并使用
2. **文件/文件夹级操作**：支持文件和文件夹的比对、提交、更新、还原等操作
3. **历史追溯**：查看提交历史、单行标注（Annotate/Blame）显示提交人
4. **IDEA 级体验**：UI 布局、交互流程、状态指示参考 IDEA 的 Subversion 集成

### 1.2 功能范围

| 类别 | P0 必选 | P1 重要 | P2 增强 |
|------|---------|---------|---------|
| 基础操作 | Checkout、Update、Commit、Add、Revert、Cleanup | Import、Export、Switch | Relocate、Upgrade |
| 变更管理 | Local Changes 视图、文件状态标记、传入/传出变更 | Changelist 分组、Shelve Changes | Patch 创建/应用 |
| 差异比较 | 文件 Diff、文件夹 Diff、提交前 Diff 预览 | 与历史版本比较、分支比较 | 三向合并冲突解决 |
| 历史记录 | 版本历史、提交详情、单行标注（Blame） | 版本图、作者筛选 | Change Log 报告 |
| 分支标签 | Branch/Tag 创建、Switch 切换 | Merge 合并 | Reintegrate、Cherry-pick |
| 属性锁定 | svn:ignore、Lock/Unlock | 属性编辑器 | svn:externals 管理 |

### 1.3 非功能需求

- **性能**：本地操作响应 < 500ms，网络操作有进度指示
- **兼容性**：支持 SVN 1.6 - 1.14 工作副本格式
- **鲁棒性**：SVN 命令失败时显示友好错误，不崩溃 IDE
- **并发安全**：同一时间同一工作副本只执行一个写操作

---

## 二、IDEA SVN 功能参考分析

### 2.1 IDEA SVN 核心界面组件

#### 2.1.1 Subversion 工作窗口（Alt+9）

IDEA 的 SVN 工具窗口包含以下标签页（按使用频率排序）：

1. **Local Changes（本地变更）** - 主界面
   - 按变更列表（Changelist）分组
   - 默认分组：Default Changelist、Unversioned Files、Ignored Files
   - 每个文件显示：状态图标、文件名、路径
   - 右键菜单：Commit、Compare with Same Repository Version、Revert、Show Diff、Update File
   - 顶部工具栏：Commit、Update、Refresh、Rollback、Shelve Changes

2. **Repository（仓库浏览器）**
   - 树状结构浏览仓库
   - 支持创建文件夹、删除、复制/移动
   - 查看文件历史、标记分支标签
   - Checkout 某个目录

3. **Incoming（传入变更）**
   - 显示服务器上有但本地没有的提交
   - 支持单个文件更新或整个更新
   - 可在更新前查看传入变更详情

4. **Info（信息）**
   - 当前工作副本信息：URL、Revision、Last Changed Author/Date
   - 工作副本根路径
   - SVN 客户端版本

5. **History（历史）**
   - 选定文件/文件夹的版本历史列表
   - 列：Revision、Author、Date、Message
   - 可按作者、日期、消息筛选
   - 双击打开版本详情，右键可 Compare、Checkout、Revert to this Revision

#### 2.1.2 编辑器集成

1. **行级标注（Annotate）**
   - 编辑器左侧显示：作者、日期、版本号
   - 悬停显示完整提交信息
   - 右键 Annotate 菜单开启/关闭
   - 不同提交用颜色区分（类似 Git Blame，但信息更丰富）

2. **变更标记（Gutter Marks）**
   - 左侧沟槽显示修改行标记
   - 新增行：绿色
   - 修改行：蓝色
   - 删除行：红色三角
   - 悬停显示 Diff 预览
   - 可点击进行快速 Revert/Show Diff

3. **文件标签状态**
   - 文件名后显示状态：[Modified]、[Added]、[Deleted]等
   - 文件图标颜色叠加：蓝色修改、绿色新增、灰色删除

4. **项目视图装饰（Project View Decorations）**
   - 文件名颜色：蓝色=修改、绿色=新增、灰色=已删除（未提交）、红色=冲突
   - 文件夹递归显示状态标记（父文件夹变色表示子项有变更）
   - 文件名后显示版本号或状态提示

#### 2.1.3 提交对话框（Commit Dialog）

IDEA 的 Commit Changes 对话框是核心工作流界面：

1. **变更列表区域**（左侧）
   - 树形结构显示所有待提交文件
   - 复选框选择要提交的文件
   - 按目录或变更列表分组
   - 每个文件显示状态图标

2. **Diff 预览区域**（右侧）
   - 选中文件时显示差异对比
   - 支持在提交前编辑 diff 视图中的文件
   - 上/下一个差异快速跳转

3. **提交信息区域**（底部）
   - Commit Message 输入框（支持模板、历史记录）
   - Before Commit 选项：
     - Reformat code
     - Rearrange code
     - Optimize imports
     - Perform code analysis
     - Check TODO
     - Run tests
   - Author 字段（可选）
   - Keep files checked out after commit（保留锁）

4. **提交按钮组**
   - Commit（直接提交）
   - Commit and Push（Git 才有，SVN 不需要）
   - Create Patch（创建补丁而非提交）

#### 2.1.4 差异比较器（Diff Viewer）

1. **三面板布局**
   - 左侧：服务器版本/本地基础版本
   - 中间：合并结果（有冲突时编辑）
   - 右侧：本地修改版本

2. **差异高亮**
   - 新增行：绿色背景
   - 删除行：红色背景
   - 修改行：蓝色高亮
   - 字符级差异高亮

3. **工具栏**
   - 上/下一个差异
   - 接受左侧/右侧变更
   - 比较设置（忽略空格、显示行号）
   - 语法高亮
   - 编辑模式

#### 2.1.5 历史视图（History View）

1. **版本列表**
   - Revision 号（可点击跳转）
   - Author
   - Date（相对时间+绝对时间）
   - Commit Message（可折叠长文本）
   - Changed Paths 数量

2. **变更路径面板**（下方）
   - 显示该版本修改的所有文件
   - 每个文件显示修改类型（M/A/D/R）
   - 点击可查看该文件在该版本的 diff
   - 支持 Browse at this revision

3. **工具栏**
   - 筛选：按作者、日期范围、消息关键字
   - 刷新
   - Compare with Local
   - Revert to this Revision
   - Create Patch

### 2.2 IDEA SVN 核心工作流

#### 工作流 1：日常修改提交

```
1. 编辑文件 → 文件自动标记为 Modified（蓝色）
2. 打开 Local Changes 视图 (Alt+9) → 查看待提交文件
3. 选择要提交的文件（默认全选）
4. 双击文件 → 查看 Diff，确认修改
5. 点击 Commit → 输入提交信息
6. （可选）勾选 Before Commit 检查项
7. 点击 Commit → 等待提交完成
8. 文件状态恢复为正常（黑色），版本号更新
```

#### 工作流 2：更新到最新版本

```
1. 点击 Update Project（Ctrl+T）→ Update 对话框
2. 选择更新策略：
   - Update from server（默认）
   - Clean all local changes（还原后更新）
3. 点击 OK → 显示更新进度
4. 如有冲突 → 打开合并对话框解决
5. 更新完成 → 显示更新摘要（更新了多少文件）
```

#### 工作流 3：查看谁修改了某行

```
1. 打开文件 → 右键行号区域
2. 选择 Annotate → 左侧显示每一行的提交人、日期、版本
3. 鼠标悬停在标注上 → 显示完整提交消息
4. 点击标注 → 打开该版本的详情视图
5. 再次右键 → Close Annotations 关闭
```

#### 工作流 4：查看文件历史并对比

```
1. 项目视图中右键文件 → Subversion → Show History
2. History 视图打开 → 显示所有历史版本
3. 选择一个版本 → 下方显示该版本修改的文件
4. 右键两个版本 → Compare → 打开 Diff Viewer
5. 右键某个版本 → Get Revision 检出该版本
6. 右键某个版本 → Revert to this Revision 回退到该版本
```

#### 工作流 5：文件夹比较

```
1. 项目视图右键文件夹 → Subversion → Compare with Branch
2. 选择要比较的标签/分支/URL
3. 文件夹比较视图打开，显示：
   - 仅本地存在的文件
   - 仅远程存在的文件
   - 内容不同的文件
   - 内容相同的文件
4. 双击文件 → 打开文件级 Diff
5. 可操作：同步单个文件、同步整个文件夹
```

#### 工作流 6：解决冲突

```
1. Update 后发现冲突 → 文件标记为红色，状态 = Conflicted
2. 右键文件 → Subversion → Resolve Conflicts
3. 三向合并视图打开：
   - 左：服务器最新版本
   - 中：手动合并结果（可编辑）
   - 右：本地修改版本
4. 逐个冲突解决：Accept Left / Accept Right / Merge Manually
5. 全部解决后 → Mark as Resolved → 完成
```

### 2.3 IDEA SVN 状态图标与颜色

IDEA 使用一套统一的视觉状态指示系统：

| 状态 | 颜色 | 图标 | 说明 |
|------|------|------|------|
| Normal | 黑色（默认） | 普通文件图标 | 已提交，无变更 |
| Modified | 蓝色 | 文件图标右下角蓝色标记 | 本地已修改，未提交 |
| Added | 绿色 | 文件图标右下角绿色+号 | 新增文件，已 `svn add` |
| Deleted | 灰色 + 删除线 | 灰色图标 | 已标记删除，未提交 |
| Unknown/Unversioned | 红色 | 红色问号图标 | 未纳入版本控制 |
| Ignored | 灰色 | 灰色减号图标 | svn:ignore 忽略 |
| Conflicted | 红色 | 红色感叹号图标 | 更新冲突，需解决 |
| Replaced | 蓝色 | 蓝色替换图标 | 文件被替换 |
| Missing | 红色 | 红色丢失图标 | 本地文件丢失但有版本记录 |
| Obstructed | 橙色 | 橙色阻塞图标 | 工作副本阻塞 |
| Locked | 紫色锁 | 锁图标 | 文件被锁定（自己或他人） |
| Switched | 紫色 | 分支图标 | 文件/目录切换到分支/标签 |
| Read-only | 灰色只读 | 锁图标 | 只读属性 |

---

## 三、系统架构设计

### 3.1 整体架构分层

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Kairo IDE Frontend                            │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ SVN Views    │  │ SVN Commands │  │  SVN Editor Integration  │   │
│  │ (Local/Repo/ │  │ & Menus      │  │  (Blame/Gutter/Tab)      │   │
│  │  History)    │  │              │  │                          │   │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬──────────────┘   │
│         │                 │                      │                   │
│  ┌──────┴─────────────────┴──────────────────────┴──────────────┐   │
│  │                    SvnService (Frontend API)                 │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌────────────────────────┐  │   │
│  │  │ SvnStatus   │ │ SvnHistory   │ │ SvnDiff/Blame/Commit   │  │   │
│  │  │ Polling     │ │ Service      │ │ Operations             │  │   │
│  │  └─────────────┘ └──────────────┘ └────────────────────────┘  │   │
│  └──────────────────────────────┬───────────────────────────────┘   │
├─────────────────────────────────┼───────────────────────────────────┤
│                                 │ Node.js child_process             │
│  ┌──────────────────────────────┴───────────────────────────────┐   │
│  │              SVN CLI Command Executor Layer                  │   │
│  │  ┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐   │   │
│  │  │ SVN Binary      │ │ Command      │ │ Output Parser    │   │   │
│  │  │ Detector        │ │ Queue        │ │ (XML/--xml)      │   │   │
│  │  └─────────────────┘ └──────────────┘ └──────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  System SVN CLI  │  ← TortoiseSVN / SlikSVN /
                    │  (svn.exe/svn)   │    CollabNet / VisualSVN / etc.
                    └──────────────────┘
```

### 3.2 模块划分

参考现有 `git-extension` 的目录结构，创建 `svn-extension` 包：

```
packages/svn-extension/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                          # 导出入口、bindSvnExtension()
    └── browser/
        ├── svn-service.ts                # 核心服务：CLI 封装、状态轮询
        ├── svn-detector.ts               # SVN 客户端自动检测
        ├── svn-command-queue.ts          # 命令执行队列（串行化写操作）
        ├── svn-parser.ts                 # SVN XML/文本输出解析
        ├── svn-types.ts                  # 所有类型定义
        ├── svn-store.ts                  # MobX/响应式状态存储
        ├── svn-changes-widget.tsx        # Local Changes 视图（主界面）
        ├── svn-history-widget.tsx        # History 视图
        ├── svn-repository-widget.tsx     # Repository 浏览器
        ├── svn-commit-widget.tsx         # Commit 对话框
        ├── svn-diff-widget.tsx           # Diff 查看器（复用@theia/editor的diff）
        ├── svn-annotate-decorator.ts     # 行级标注（Blame）装饰器
        ├── svn-file-status-decorator.ts  # 编辑器标签状态
        ├── svn-explorer-decorator.ts     # 项目视图文件装饰
        ├── svn-gutter-decorator.ts       # 编辑器沟槽变更标记
        ├── svn-status-bar-contribution.ts # 状态栏 SVN 信息
        ├── svn-commands.ts               # 所有命令注册（菜单、快捷键、命令面板）
        ├── svn-context-menu.ts           # 右键菜单贡献
        └── svn-preferences.ts            # SVN 相关设置项
```

### 3.3 核心模块详细设计

#### 3.3.1 SvnDetector - SVN 客户端自动检测

**设计目标**：Windows 上安装任意 SVN 客户端都能自动找到 svn.exe，无需用户配置。

**检测策略**（按优先级顺序）：

1. **PATH 环境变量检测**：直接调用 `svn --version --quiet`，检查是否可用
2. **Windows 常见安装路径探测**：
   - TortoiseSVN: `C:\Program Files\TortoiseSVN\bin\svn.exe`
   - TortoiseSVN (x86): `C:\Program Files (x86)\TortoiseSVN\bin\svn.exe`
   - SlikSVN: `C:\Program Files\SlikSvn\bin\svn.exe`
   - CollabNet Subversion: `C:\Program Files\CollabNet\Subversion Client\svn.exe`
   - VisualSVN: `C:\Program Files\VisualSVN\bin\svn.exe`
   - Cygwin: `C:\cygwin64\bin\svn.exe`
   - Git for Windows (附带): `C:\Program Files\Git\usr\bin\svn.exe`
   - Chocolatey: `C:\ProgramData\chocolatey\bin\svn.exe`
   - Scoop: `%USERPROFILE%\scoop\shims\svn.exe`
   - WANdisco: `C:\Program Files\WANdisco\Subversion\bin\svn.exe`
3. **Windows 注册表查询**：
   - `HKLM\SOFTWARE\TortoiseSVN` → 读取 `InstallDir`
   - `HKLM\SOFTWARE\Wow6432Node\TortoiseSVN`（32位程序在64位系统）
4. **macOS / Linux 常见路径**：
   - `/usr/bin/svn`
   - `/usr/local/bin/svn`
   - `/opt/subversion/bin/svn`
   - Homebrew: `/opt/homebrew/bin/svn`
5. **用户设置覆盖**：`kairo.svn.path` 首选项指定的路径

**检测时机**：

1. IDE 启动时异步检测（不阻塞 UI）
2. 用户手动触发 "Configure SVN" 时重新检测
3. 每次执行 SVN 命令前检查 svn 路径是否可用，如果不可用则重新检测

**检测结果缓存**：

- 检测成功后缓存路径，避免重复探测
- 若命令执行返回 ENOENT（找不到文件），清除缓存重新检测
- 向用户提供状态：已检测到（显示版本号）/未检测到（提示安装）

```typescript
// svn-detector.ts
interface SvnInstallation {
  path: string;           // 完整路径到 svn 可执行文件
  version: string;        // 版本号，如 "1.14.2 (r1899510)"
  versionMajor: number;   // 14
  versionMinor: number;   // 2
  source: 'path' | 'registry' | 'common-location' | 'user-config';
}

@injectable()
class SvnDetector {
  async detect(): Promise<SvnInstallation | undefined>;
  async validatePath(path: string): Promise<SvnInstallation | undefined>;
  getCached(): SvnInstallation | undefined;
  invalidateCache(): void;
}
```

#### 3.3.2 SvnCommandQueue - 命令执行队列

**设计目标**：SVN 工作副本不是线程安全的，同一 WC 同时执行写操作会损坏，需要串行化执行。

**设计要点**：

1. 每个工作副本根目录一个独立队列（按 WC root 隔离）
2. 读操作（status、log、diff、blame、info）可以并行执行
3. 写操作（commit、update、revert、add、delete、cleanup、switch）必须串行排队
4. 命令执行有超时机制（默认 5 分钟，可配置）
5. 支持取消正在执行的命令（通过子进程 kill）
6. 执行中的命令显示进度通知
7. 命令失败时捕获 stderr，返回结构化错误

```typescript
// svn-command-queue.ts
type CommandType = 'read' | 'write';

interface QueuedCommand {
  id: string;
  args: string[];
  cwd: string;
  type: CommandType;
  options?: {
    timeout?: number;
    onProgress?: (data: string) => void;
  };
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

@injectable()
class SvnCommandQueue {
  async exec(args: string[], cwd: string, type?: CommandType): Promise<CommandResult>;
  async execXml<T>(args: string[], cwd: string): Promise<T>;  // 自动加 --xml 并解析
  cancel(commandId: string): void;
  isWorking(cwd: string): boolean;  // 该 WC 是否有正在执行的写命令
}
```

#### 3.3.3 SvnService - 核心业务服务

参考 `GitService` 设计，封装所有 SVN 业务逻辑。**所有 SVN 操作都通过这个服务**，其他组件不直接调用 CLI。

```typescript
// svn-types.ts
enum SvnFileStatus {
  Normal = 'normal',
  Modified = 'modified',
  Added = 'added',
  Deleted = 'deleted',
  Conflict = 'conflicted',
  Missing = 'missing',
  Unversioned = 'unversioned',
  Ignored = 'ignored',
  Replaced = 'replaced',
  Obstructed = 'obstructed',
  Locked = 'locked',
  Switched = 'switched',
  External = 'external',
}

interface SvnStatusEntry {
  path: string;              // 相对于 WC root 的路径
  status: SvnFileStatus;
  props?: SvnFileStatus;     // 属性状态
  revision?: number;         // 工作副本版本
  lastChangedRevision?: number;
  lastChangedAuthor?: string;
  lastChangedDate?: Date;
  switchedUrl?: string;
  reposRootUrl?: string;
  reposUuid?: string;
  changelist?: string;       // 所属变更列表
  isCopied?: boolean;
  isLocked?: boolean;
  lockOwner?: string;
  lockComment?: string;
  treeConflict?: boolean;
  conflictOld?: string;
  conflictNew?: string;
  conflictWorking?: string;
}

interface SvnWorkingCopyInfo {
  wcRoot: string;
  url: string;
  reposRootUrl: string;
  reposUuid: string;
  revision: number;
  lastChangedRev: number;
  lastChangedDate: Date;
  lastChangedAuthor: string;
  schedule?: 'normal' | 'add' | 'delete' | 'replace';
  depth?: 'infinity' | 'immediates' | 'files' | 'empty';
}

interface SvnCommitInfo {
  revision: number;
  author: string;
  date: Date;
  message: string;
  changedPaths: SvnChangedPath[];
}

interface SvnChangedPath {
  path: string;
  action: 'A' | 'D' | 'M' | 'R';
  copyFromPath?: string;
  copyFromRev?: number;
}

interface SvnBlameLine {
  revision: number;
  author: string;
  date: Date;
  line: number;
  content: string;
  mergedRevision?: number;  // 合并来源版本
  mergedPath?: string;
  mergedAuthor?: string;
}

interface SvnLogEntry {
  revision: number;
  author: string;
  date: Date;
  message: string;
  changedPaths: SvnChangedPath[];
  hasChildren: boolean;
}

interface SvnDiffOptions {
  revision?: number | 'BASE' | 'HEAD' | 'PREV' | 'COMMITTED';
  pegRevision?: number;
  oldUrl?: string;      // 用于跨 URL 比较
  oldRevision?: number;
  depth?: 'infinity' | 'immediates' | 'files' | 'empty';
  ignoreWhitespace?: boolean;
  ignoreEolStyle?: boolean;
  showCopiesAsAdds?: boolean;
}

type SvnProgressEvent = {
  operation: string;
  current: number;
  total: number;
  path?: string;
};
```

```typescript
// svn-service.ts
@injectable()
class SvnService {
  // ── 事件 ──────────────────────────────────────────────
  readonly onDidChangeStatus: Event<SvnStatusEntry[]>;
  readonly onDidCommitSuccess: Event<SvnCommitInfo>;
  readonly onDidUpdateComplete: Event<{ revision: number; updated: number }>;
  readonly onProgress: Event<SvnProgressEvent>;
  readonly onSvnAvailabilityChange: Event<boolean>;  // SVN 可用/不可用切换

  // ── WC 管理 ──────────────────────────────────────────
  async findWcRoot(cwd: string): Promise<string | undefined>;
  async getWcInfo(path?: string): Promise<SvnWorkingCopyInfo | undefined>;
  setActiveWcRoot(root: string): void;
  getActiveWcRoot(): string | undefined;

  // ── SVN 检测 ─────────────────────────────────────────
  isSvnAvailable(): boolean;
  getSvnInstallation(): SvnInstallation | undefined;
  async detectSvn(): Promise<void>;

  // ── 状态轮询 ──────────────────────────────────────────
  startStatusPolling(interval?: number): void;  // 默认 3 秒
  stopStatusPolling(): void;
  async refreshStatus(): Promise<SvnStatusEntry[]>;
  getCachedStatus(): SvnStatusEntry[];
  getFileStatus(relPath: string): SvnStatusEntry | undefined;

  // ── 基础操作 ──────────────────────────────────────────
  async checkout(url: string, path: string, options?: {
    revision?: number;
    depth?: 'infinity' | 'immediates' | 'files' | 'empty';
    username?: string;
    password?: string;
  }): Promise<void>;

  async update(paths?: string[], options?: {
    revision?: number;
    depth?: 'infinity' | 'immediates' | 'files' | 'empty';
    accept?: 'postpone' | 'working' | 'base' | 'mine-conflict' | 'theirs-conflict' | 'mine-full' | 'theirs-full';
  }): Promise<{ revision: number; updatedFiles: number }>;

  async commit(paths: string[], message: string, options?: {
    keepLocks?: boolean;
    changelist?: string;
    username?: string;
    password?: string;
  }): Promise<SvnCommitInfo>;

  async add(paths: string[], options?: {
    force?: boolean;
    parents?: boolean;
    noIgnore?: boolean;
    depth?: 'infinity' | 'immediates' | 'files' | 'empty';
  }): Promise<void>;

  async revert(paths: string[], options?: {
    recursive?: boolean;
    changelist?: string;
  }): Promise<void>;

  async cleanup(path?: string, options?: {
    breakLocks?: boolean;
    fixTimestamps?: boolean;
    vacuumPristines?: boolean;
    removeUnversioned?: boolean;
    removeIgnored?: boolean;
  }): Promise<void>;

  async delete(paths: string[], options?: {
    force?: boolean;
    keepLocal?: boolean;
  }): Promise<void>;

  async resolve(path: string, options?: {
    accept: 'working' | 'base' | 'mine-conflict' | 'theirs-conflict' | 'mine-full' | 'theirs-full';
    recursive?: boolean;
  }): Promise<void>;

  // ── 锁操作 ────────────────────────────────────────────
  async lock(paths: string[], comment?: string, stealLock?: boolean): Promise<void>;
  async unlock(paths: string[], breakLock?: boolean): Promise<void>;

  // ── 忽略 ──────────────────────────────────────────────
  async ignore(paths: string[], ignore?: boolean): Promise<void>;
  async getIgnoredPatterns(dirPath: string): Promise<string[]>;
  async setIgnoredPatterns(dirPath: string, patterns: string[]): Promise<void>;

  // ── 历史记录 ──────────────────────────────────────────
  async getLog(path?: string, options?: {
    startRevision?: number;
    endRevision?: number;
    limit?: number;
    author?: string;
    searchMessage?: string;
    stopOnCopy?: boolean;
    includeChangedPaths?: boolean;
  }): Promise<SvnLogEntry[]>;

  async getLogEntry(revision: number, path?: string): Promise<SvnLogEntry | undefined>;

  // ── Blame/Annotate ───────────────────────────────────
  async annotate(path: string, options?: {
    startRevision?: number;
    endRevision?: number;
    ignoreWhitespace?: boolean;
    includeMerged?: boolean;
  }): Promise<SvnBlameLine[]>;

  // ── Diff ──────────────────────────────────────────────
  async getDiff(path: string, options?: SvnDiffOptions): Promise<string>;
  async getFolderDiff(url1: string, rev1: number, url2: string, rev2: number): Promise<FolderDiffResult>;
  async getUnifiedDiff(path: string, options?: SvnDiffOptions): Promise<string>;

  // ── 分支/标签 ─────────────────────────────────────────
  async switch(url: string, options?: {
    revision?: number;
    depth?: 'infinity' | 'immediates' | 'files' | 'empty';
    ignoreAncestry?: boolean;
    force?: boolean;
  }): Promise<void>;

  async copy(srcUrlOrPath: string, dstUrl: string, options?: {
    message?: string;
    revision?: number;
    parents?: boolean;
  }): Promise<SvnCommitInfo>;

  async merge(sourceUrl: string, options?: {
    startRevision?: number;
    endRevision?: number;
    reintegrate?: boolean;
    accept?: 'postpone' | 'working' | 'base' | 'mine-conflict' | 'theirs-conflict' | 'mine-full' | 'theirs-full';
  }): Promise<void>;

  // ── 仓库浏览 ──────────────────────────────────────────
  async listRepository(url: string, options?: {
    revision?: number;
    depth?: 'immediates' | 'infinity';
  }): Promise<RepoEntry[]>;

  async mkdir(url: string, message?: string, parents?: boolean): Promise<SvnCommitInfo>;
  async move(srcUrl: string, dstUrl: string, message?: string): Promise<SvnCommitInfo>;
  async removeFromRepo(url: string, message?: string, force?: boolean): Promise<SvnCommitInfo>;

  // ── 变更列表 ──────────────────────────────────────────
  async addToChangelist(paths: string[], changelist: string): Promise<void>;
  async removeFromChangelist(paths: string[]): Promise<void>;
  async getChangelists(): Promise<Map<string, string[]>>;

  // ── 导出/导入 ─────────────────────────────────────────
  async export(srcUrlOrPath: string, dstPath: string, options?: {
    revision?: number;
    force?: boolean;
    ignoreExternals?: boolean;
  }): Promise<void>;

  async import(srcPath: string, dstUrl: string, message?: string): Promise<SvnCommitInfo>;
}
```

#### 3.3.4 SvnStore - 响应式状态管理

使用 Theia 推荐的响应式状态管理（类似 GitStore），提供 UI 层可订阅的状态。

```typescript
// svn-store.ts
@injectable()
class SvnStore {
  // ── 响应式状态 ──────────────────────────────────────
  @observable isSvnAvailable: boolean = false;
  @observable svnVersion: string = '';
  @observable activeWcRoot: string | undefined = undefined;
  @observable wcInfo: SvnWorkingCopyInfo | undefined = undefined;
  @observable isRefreshing: boolean = false;
  @observable isCommitting: boolean = false;
  @observable isUpdating: boolean = false;
  @observable status: SvnStatusEntry[] = [];
  @observable selectedFiles: Set<string> = new Set();
  @observable activeChangelist: string = 'default';
  @observable commitMessage: string = '';
  @observable progress: SvnProgressEvent | undefined;

  // ── 计算属性 ────────────────────────────────────────
  @computed get modifiedFiles(): SvnStatusEntry[];
  @computed get addedFiles(): SvnStatusEntry[];
  @computed get deletedFiles(): SvnStatusEntry[];
  @computed get unversionedFiles(): SvnStatusEntry[];
  @computed get conflictedFiles(): SvnStatusEntry[];
  @computed get ignoredFiles(): SvnStatusEntry[];
  @computed get missingFiles(): SvnStatusEntry[];
  @computed get hasConflicts(): boolean;
  @computed get totalChanges(): number;

  // ── 操作方法 ────────────────────────────────────────
  toggleFileSelection(path: string): void;
  selectAll(): void;
  deselectAll(): void;
  setCommitMessage(msg: string): void;
  addFilesToChangelist(paths: string[], changelist: string): void;
}
```

### 3.5 数据解析：SVN --xml 输出

SVN 命令支持 `--xml` 参数输出 XML 格式结果，便于可靠解析。关键命令及格式：

#### `svn status --xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="src/main/java/Hello.java">
      <wc-status item="modified" revision="1234" props="none">
        <commit revision="1230">
          <author>zhangsan</author>
          <date>2026-07-20T10:30:00.000000Z</date>
        </commit>
      </wc-status>
    </entry>
    <entry path="newfile.txt">
      <wc-status item="unversioned" props="none"></wc-status>
    </entry>
  </target>
</status>
```

#### `svn log --xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="1235">
    <author>lisi</author>
    <date>2026-07-25T09:15:00.000000Z</date>
    <msg>修复登录页面样式问题</msg>
    <paths>
      <path action="M" props-modified="false">/trunk/src/main/webapp/login.css</path>
      <path action="A" props-modified="false">/trunk/src/main/webapp/images/logo.png</path>
    </paths>
  </logentry>
</log>
```

#### `svn blame --xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="Hello.java">
    <entry line-number="1">
      <commit revision="1200">
        <author>wangwu</author>
        <date>2026-07-10T14:00:00.000000Z</date>
      </commit>
    </entry>
  </target>
</blame>
```

#### `svn info --xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="." revision="1235" kind="dir">
    <url>https://svn.example.com/repos/project/trunk</url>
    <relative-url>^/trunk</relative-url>
    <repository>
      <root>https://svn.example.com/repos/project</root>
      <uuid>12345678-1234-1234-1234-1234567890ab</uuid>
    </repository>
    <wc-info>
      <wcroot-abspath>/Users/qi/projects/myproject</wcroot-abspath>
      <schedule>normal</schedule>
      <depth>infinity</depth>
    </wc-info>
    <commit revision="1235">
      <author>lisi</author>
      <date>2026-07-25T09:15:00.000000Z</date>
    </commit>
  </entry>
</info>
```

### 3.4 UI 界面设计

#### 3.4.1 SVN Local Changes 视图（主面板，类似 IDEA Alt+9）

**布局**（参考 IDEA Subversion 工具窗口 + VS Code SCM 视图）：

```
┌──────────────────────────────────────────────────────────────────┐
│  Local Changes ▼                                    [⟳] [⚙️]   │  ← 工具栏：刷新、提交、更新、设置
├──────────────────────────────────────────────────────────────────┤
│  ┌─ Default Changelist ──────────────────────────────────────┐  │
│  │ [x] 📄 Hello.java          [Modified]                    │  │  ← 复选框选择提交
│  │ [x] 📄 index.jsp           [Modified]                    │  │  ← 文件名 + 状态标签
│  │ [x] 📄 login.css           [Modified]                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌─ Unversioned Files ──────────────────────────────────────┐  │
│  │ [ ] 📄 newfeature.txt      [Unversioned]  [+]            │  │  ← [+]按钮快速 add
│  │ [ ] 📄 test-output.log     [Ignored?]     [Add to Ignore]│  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌─ Conflicts ─────────────────────────────────────────────┐  │
│  │ [ ] 📄 merge.txt           [Conflict]     [Resolve]     │  │  ← 出现冲突时才显示
│  └───────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│  Message (press Ctrl+Enter to commit)                            │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 修复用户登录页面的表单验证问题...                            │  │  ← 提交信息输入区
│  │                                                             │  │
│  └────────────────────────────────────────────────────────────┘  │
│  [ ] Keep locks    [ ] Reformat    [✓] Show diff before commit  │  ← 提交选项
│  ──────────────────────────────────────────────────────────────  │
│  [  Commit  ]  [  Commit & Patch  ]  [  Changelist ▼ ]         │  ← 操作按钮
└──────────────────────────────────────────────────────────────────┘
```

**文件图标颜色方案**（参考 IDEA）：

| 状态 | 文件名颜色 | 图标叠加 |
|------|-----------|---------|
| Modified | `var(--theia-gitDecoration-modifiedResourceForeground)` (#569CD6 蓝) | 右下角蓝色方块 |
| Added | `var(--theia-gitDecoration-addedResourceForeground)` (#4EC9B0 绿) | 右下角绿色+号 |
| Deleted | `var(--theia-gitDecoration-deletedResourceForeground)` (#F48771 红) | 红色删除线 |
| Unversioned | `var(--theia-gitDecoration-untrackedResourceForeground)` (#C586C0 紫) | 红色问号? |
| Conflicted | `var(--theia-gitDecoration-conflictingResourceForeground)` (#FF0000 红) | 红色感叹号! |
| Ignored | `var(--theia-gitDecoration-ignoredResourceForeground)` (#808080 灰) | 灰色半透明 |

**复用 Theia/Git 的颜色变量**，保持 UI 一致性。

#### 3.4.2 提交对话框（Commit Dialog）

可以复用 `SvnCommitWidget`，也可以作为独立模态框：

```
┌─────────────────────────────────────────────────────────────────┐
│  Commit Changes                                        [_][□][X]│
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────┐  ┌────────────────────────────────┐ │
│  │ Changed Files          │  │ Diff Preview                   │ │
│  │  ┌─ [x] src/           │  │ ┌────────────────────────────┐ │ │
│  │  │  ├ [x] Hello.java   │  │ │  -  old line 1             │ │ │
│  │  │  ├ [x] login.css    │  │ │  +  new line 1    <--->   │ │ │
│  │  │  └ [ ] new.txt      │  │ │  -  old line 2             │ │ │
│  │  └─────────────────────┘  │ │  +  new line 2             │ │ │
│  │                            │ └────────────────────────────┘ │ │
│  │  [Select All] [Deselect]   │                                  │ │
│  └────────────────────────────┘  ┌────────────────────────────┐ │
│                                  │ Line: 42, Column: 15       │ │
│                                  └────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  Author: [________________] (optional)                          │
│  ──────────────────────────────────────────────────────────────  │
│  Commit Message:                                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ──────────────────────────────────────────────────────────────  │
│  Before Commit:                              Changelist: [Default▼]│
│  [ ] Reformat code                                           │
│  [ ] Optimize imports                                        │
│  [ ] Perform code analysis                                   │
│  [ ] Check TODO comments                                     │
│  [ ] Keep files locked after commit                          │
├─────────────────────────────────────────────────────────────────┤
│                        [Cancel]  [Create Patch]  [* Commit]    │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.4.3 History 视图（类似 IDEA History 标签页）

```
┌──────────────────────────────────────────────────────────────────┐
│  History for: src/main/java/Hello.java    [⟳] [🔍 Filter] [⚙️] │
├──────────────────────────────────────────────────────────────────┤
│  Revision  Author       Date               Message               │
│  ──────────────────────────────────────────────────────────────── │
│  ▶ 1235    lisi      2026-07-25 09:15  修复登录样式问题       │
│  ▶ 1234    zhangsan  2026-07-24 16:40  添加用户输入校验       │
│  ▶ 1230    wangwu    2026-07-20 10:30  重构数据库连接池       │
│  ▶ 1200    zhaoliu   2026-07-10 14:00  Initial import         │
│  ▼ 1195    lisi      2026-07-05 11:20  创建基础框架    ←展开│
│     ├─ M  /trunk/src/main/java/Hello.java                     │
│     ├─ A  /trunk/src/main/java/util/DbHelper.java              │
│     └─ M  /trunk/WebRoot/WEB-INF/web.xml                       │
├──────────────────────────────────────────────────────────────────┤
│  Toolbar: [Compare with Local] [Revert to This Rev] [Browse]   │
│           [Create Patch] [Copy Revision Number]                │
└──────────────────────────────────────────────────────────────────┘
```

#### 3.4.4 文件夹比较视图（Folder Diff）

参考 IDEA "Compare with Branch" 功能：

```
┌──────────────────────────────────────────────────────────────────┐
│  Compare: trunk @ HEAD  ↔  branches/feature-x @ HEAD             │
├──────────────────────────────────────────────────────────────────┤
│  Files that differ:                                             │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ File Name              Side      Size      Last Modified   │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ 📄 login.css            ≠        12.3K     2026-07-25      │  │ ← 内容不同
│  │ 📄 index.jsp            ≠        8.5K      2026-07-24      │  │
│  │ 📄 newmodule.txt       +>         -                      │  │ ← 仅右侧
│  │ 📄 oldpage.txt         <+         -                      │  │ ← 仅左侧
│  │ 📄 samefile.txt        ==        4.2K      2026-07-20      │  │ ← 相同
│  └────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│  ┌─────────────── Diff Preview ───────────────────────────────┐  │
│  │ (双击文件显示两侧Diff)                                      │  │
│  └────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│  [Synchronize All] [Synchronize Selected] [Show Same] [Show Diff]│
│  [Mirror from Left to Right] [Mirror from Right to Left]        │
└──────────────────────────────────────────────────────────────────┘
```

#### 3.4.5 编辑器行级标注（Annotate/Blame）

参考 IDEA Annotate 和现有 GitBlameDecorator：

```
行号区域:
  ┌───┬──────────────────────────────────────────────────────────
15│lisi│  public class HelloServlet extends HttpServlet {
  │7/25│
  ├───┼──────────────────────────────────────────────────────────
16│wang│      protected void doPost(HttpServletRequest req...
  │7/20│
  ├───┼──────────────────────────────────────────────────────────
17│lisi│          String username = req.getParameter("usern...
  │7/25│  ^^^^  hover显示完整commit message
  └───┴──────────────────────────────────────────────────────────
      ↑
      标注区域：显示 作者 + 日期（简短格式）
      背景色：按revision哈希着色，区分不同提交
```

**标注格式**：
- 默认：`作者缩写, 月/日`（如 `lisi, 7/25`）
- 悬停 tooltip：`作者全名 <邮箱> · 完整日期 · Revision · 提交消息前100字`
- 点击标注：打开该版本的 History 详情
- 右键标注菜单：Show Diff、Annotate Previous Revision、Copy Revision Number

#### 3.4.6 状态栏贡献

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ...  [ SVN: trunk | r1235 | 3 modified files | ↑2 ↓0 ]  UTF-8  LF   │
└─────────────────────────────────────────────────────────────────────────┘
         ↑     ↑          ↑             ↑
         |     |          |             └─ 落后/领先提交数（从服务器获取）
         |     |          └─ 本地变更摘要
         |     └─ 当前版本号 r数字
         └─ 当前分支/目录名（URL 最后部分）
```

- 点击状态栏弹出 Quick Pick 菜单：Update、Commit、Show History、Checkout、Settings

#### 3.4.7 右键菜单

**项目视图右键文件/文件夹** → Subversion 子菜单：

```
Subversion ▸
  ├─ Update File / Update Folder...
  ├─ Commit File...
  ├─ Compare with Same Repository Version
  ├─ Compare with Branch/Tag...
  ├─ Show History
  ├─ Annotate (toggle)
  ├────────────────────
  ├─ Add to VCS / Add to Ignore
  ├─ Revert...
  ├─ Lock... / Unlock
  ├────────────────────
  ├─ Resolve Conflicts... (仅冲突时显示)
  ├─ Mark as Resolved (仅冲突时)
  ├────────────────────
  ├─ Switch...
  ├─ Branch/Tag...
  ├─ Merge...
  ├────────────────────
  ├─ Copy to...
  ├─ Move/Rename...
  ├─ Delete...
  ├────────────────────
  ├─ Create Patch...
  ├─ Apply Patch...
  ├────────────────────
  ├─ Browse Changes in Repository
  ├─ Show SVN Info
  ├─ Show Properties
  ├─ Edit Properties...
  ├────────────────────
  ├─ Cleanup
  ├─ Refresh Status
  └─ SVN Settings...
```

**编辑器内右键** → Subversion 子菜单：

```
Subversion ▸
  ├─ Compare with Same Repository Version
  ├─ Compare with Latest Repository Version
  ├─ Compare with Branch/Tag...
  ├─ Compare with Revision...
  ├────────────────────
  ├─ Show History
  ├─ Annotate (toggle on/off)
  ├────────────────────
  ├─ Revert Selected Lines
  ├─ Show Diff
  └─ Commit File...
```

**编辑器左侧沟槽右键**：

```
Subversion ▸
  ├─ Annotate (toggle)
  ├─ Show Diff for This Line
  ├─ Rollback Changes in This Hunk
  └─ Show Revision History for This Line
```

### 3.6 命令与快捷键

参考 IDEA 快捷键，兼容用户肌肉记忆：

| 命令 ID | 名称 | 快捷键（Win/Linux） | 快捷键（Mac） |
|---------|------|---------------------|---------------|
| `svn.update` | Update Project | `Ctrl+T` | `⌘T` |
| `svn.commit` | Commit Changes | `Ctrl+K` | `⌘K` |
| `svn.showChanges` | Show Local Changes (View) | `Alt+9` | `⌘9` |
| `svn.showHistory` | Show History | `Alt+Shift+H` / 右键 | `⌃⇧H` |
| `svn.annotate` | Toggle Annotate | 右键菜单 | 右键菜单 |
| `svn.revert` | Revert | `Ctrl+Alt+Z` | `⌘⌥Z` |
| `svn.cleanup` | Cleanup | 命令面板 | 命令面板 |
| `svn.resolve` | Resolve Conflict | 右键菜单 | 右键菜单 |
| `svn.browseRepo` | Browse Repository | Alt+9 切标签 | ⌘9 切标签 |
| `svn.compare` | Compare with Same Version | 右键 / Ctrl+D | 右键 / ⌘D |
| `svn.add` | Add to VCS | `Ctrl+Alt+A` | `⌘⌥A` |
| `svn.ignore` | Add to svn:ignore | 右键菜单 | 右键菜单 |
| `svn.lock` | Lock File | 右键菜单 | 右键菜单 |
| `svn.unlock` | Unlock File | 右键菜单 | 右键菜单 |
| `svn.switch` | Switch Branch/Tag | 右键菜单 | 右键菜单 |
| `svn.branchTag` | Create Branch/Tag | 右键菜单 | 右键菜单 |
| `svn.merge` | Merge | 右键菜单 | 右键菜单 |
| `svn.checkout` | Checkout from SVN | 命令面板 | 命令面板 |
| `svn.export` | Export | 右键菜单 | 右键菜单 |
| `svn.import` | Import into SVN | 命令面板 | 命令面板 |
| `svn.refresh` | Refresh Status | `F5` (在SVN视图内) | `F5` |
| `svn.properties` | SVN Properties | 右键菜单 | 右键菜单 |
| `svn.showInfo` | SVN Info | 右键菜单 | 右键菜单 |

### 3.7 设置项（Preferences）

在设置中添加 SVN 分类：

```jsonc
// SVN 设置项
{
  "kairo.svn.enabled": {
    "type": "boolean",
    "default": true,
    "description": "Enable SVN integration"
  },
  "kairo.svn.path": {
    "type": "string",
    "default": "",
    "description": "Path to SVN executable (leave empty for auto-detection)"
  },
  "kairo.svn.pollingInterval": {
    "type": "number",
    "default": 3000,
    "description": "Status polling interval in milliseconds",
    "minimum": 1000,
    "maximum": 60000
  },
  "kairo.svn.username": {
    "type": "string",
    "default": "",
    "description": "Default SVN username (stored insecurely; use credential helper instead)"
  },
  "kairo.svn.autoAdd": {
    "type": "boolean",
    "default": false,
    "description": "Automatically add new unversioned files on commit"
  },
  "kairo.svn.showIgnoredFiles": {
    "type": "boolean",
    "default": false,
    "description": "Show ignored files in Local Changes view"
  },
  "kairo.svn.excludeDirectories": {
    "type": "array",
    "items": { "type": "string" },
    "default": ["node_modules", ".git", "target", "build", "dist"],
    "description": "Directories to exclude from SVN status scanning"
  },
  "kairo.svn.annotate.enabled": {
    "type": "boolean",
    "default": false,
    "description": "Show SVN annotations by default in editors"
  },
  "kairo.svn.annotate.showDate": {
    "type": "boolean",
    "default": true,
    "description": "Show date in annotations"
  },
  "kairo.svn.annotate.showRevision": {
    "type": "boolean",
    "default": false,
    "description": "Show revision number in annotations"
  },
  "kairo.svn.commit.showDiffByDefault": {
    "type": "boolean",
    "default": true,
    "description": "Show diff preview in commit dialog by default"
  },
  "kairo.svn.diff.ignoreWhitespace": {
    "type": "boolean",
    "default": false,
    "description": "Ignore whitespace changes in diff view"
  },
  "kairo.svn.conflict.autoResolveOnUpdate": {
    "type": "boolean",
    "default": false,
    "description": "Auto-resolve conflicts on update (accept postpone for manual resolution)"
  },
  "kairo.svn.log.maxEntries": {
    "type": "number",
    "default": 100,
    "description": "Maximum number of log entries to fetch",
    "minimum": 10,
    "maximum": 1000
  },
  "kairo.svn.gutterMarkers": {
    "type": "boolean",
    "default": true,
    "description": "Show change markers in editor gutter"
  },
  "kairo.svn.tabDecorations": {
    "type": "boolean",
    "default": true,
    "description": "Show SVN status in editor tab titles"
  },
  "kairo.svn.explorerDecorations": {
    "type": "boolean",
    "default": true,
    "description": "Show SVN status colors in Explorer/Project view"
  },
  "kairo.svn.clearAuthCache": {
    "type": "boolean",
    "default": false,
    "description": "Clear SVN authentication cache on startup"
  }
}
```

---

## 四、开发实施计划

### 4.1 开发波次（Waves）

按照敏捷迭代方式分 4 个波次完成，每个波次都有可验证的交付物。

---

#### Wave 17A：SVN 基础框架与状态检测（P0 核心）

**目标**：SVN 自动检测成功，工作副本识别，基础状态显示

**预计工时**：3-4 天

**任务清单**：

| 编号 | 任务 | 产出物 |
|------|------|--------|
| 17A-01 | 创建 svn-extension 包骨架，配置 package.json、tsconfig.json | `packages/svn-extension/` 目录结构 |
| 17A-02 | 实现 SvnDetector：PATH 检测 + Windows 常见路径探测 + 版本解析 | `svn-detector.ts` |
| 17A-03 | 实现 SvnCommandQueue：命令串行化、超时、取消、错误处理 | `svn-command-queue.ts` |
| 17A-04 | 实现 XML 输出解析器：status/log/info/blame 的 XML 解析 | `svn-parser.ts` |
| 17A-05 | 定义所有 SVN 类型：SvnFileStatus、SvnStatusEntry 等 | `svn-types.ts` |
| 17A-06 | 实现 SvnService 基础方法：findWcRoot、getWcInfo、status 轮询 | `svn-service.ts` 基础框架 |
| 17A-07 | 实现 SvnStore 响应式状态存储 | `svn-store.ts` |
| 17A-08 | 在 theia-product 中注册 svn-extension 的 bindSvnExtension | `product-bindings.ts` 修改 |
| 17A-09 | 单元测试：SvnDetector 路径探测、SvnParser XML 解析 | 测试文件 |

**验收标准（DoD）**：

- [ ] Windows 上安装 TortoiseSVN/SlikSVN 后启动 IDE 能自动检测到 svn.exe 并显示版本号
- [ ] 打开 SVN 工作副本项目能识别到 WC 根路径
- [ ] 状态栏显示 SVN 可用状态和当前分支/版本号
- [ ] 轮询功能正常（3 秒刷新一次状态，修改文件后状态更新）
- [ ] svn 未安装时显示友好提示（"未检测到 SVN 客户端，请安装 TortoiseSVN 等"）

---

#### Wave 17B：变更视图与提交/更新/还原（P0 核心工作流）

**目标**：Local Changes 视图可用，完成 80% 日常 SVN 工作流

**预计工时**：4-5 天

**任务清单**：

| 编号 | 任务 | 产出物 |
|------|------|--------|
| 17B-01 | 实现 SvnExplorerDecorator：项目视图文件名颜色和图标叠加 | `svn-explorer-decorator.ts` |
| 17B-02 | 实现 SvnFileStatusDecorator：编辑器标签页状态标记 | `svn-file-status-decorator.ts` |
| 17B-03 | 实现 SvnStatusBarContribution：状态栏分支/版本/变更数显示 | `svn-status-bar-contribution.ts` |
| 17B-04 | 实现 SvnChangesWidget：Local Changes 主视图（文件列表+状态） | `svn-changes-widget.tsx` |
| 17B-05 | 实现 SvnService.add()、revert()、update()、commit() 方法 | `svn-service.ts` 核心写操作 |
| 17B-06 | 实现 SvnCommitWidget：提交对话框（消息输入+文件选择） | `svn-commit-widget.tsx` |
| 17B-07 | 注册核心命令：svn.update、svn.commit、svn.revert、svn.add、svn.refresh | `svn-commands.ts` |
| 17B-08 | 右键菜单贡献：项目视图 Subversion 子菜单（基础操作） | `svn-context-menu.ts` |
| 17B-09 | 快捷键绑定：Ctrl+T 更新、Ctrl+K 提交、Alt+9 显示视图 | 快捷键配置 |
| 17B-10 | 添加进度通知：长时间操作（update/commit）显示进度条和取消按钮 | 进度通知集成 |
| 17B-11 | 错误处理：命令失败时显示错误通知（含 stderr 摘要，不弹栈） | 统一错误处理 |

**验收标准（DoD）**：

- [ ] 修改文件后项目视图文件名变蓝色，标签页显示 [Modified]
- [ ] 新增文件显示绿色 [Added] 状态（先手动 add 后）
- [ ] Local Changes 视图按状态分组显示（Modified、Unversioned、Conflicts）
- [ ] 选择文件、输入提交消息、点击 Commit 能成功提交到仓库
- [ ] Update (Ctrl+T) 能从服务器拉取最新版本，显示更新了多少文件
- [ ] Revert 能撤销本地修改，文件恢复到 BASE 版本
- [ ] 右键文件→Subversion 能看到操作菜单并可执行
- [ ] 提交时网络错误/认证失败有友好提示，不崩溃 IDE
- [ ] 大量文件变更（100+）时界面不卡顿（虚拟列表）

---

#### Wave 17C：Diff、History、Annotate（P1 重要功能）

**目标**：差异比较、历史查看、行级标注——参考 IDEA 的核心追溯功能

**预计工时**：4-5 天

**任务清单**：

| 编号 | 任务 | 产出物 |
|------|------|--------|
| 17C-01 | 实现 SvnService.getDiff()、getUnifiedDiff()：生成 unified diff | `svn-service.ts` diff 方法 |
| 17C-02 | 实现 SvnDiffWidget：复用 Theia 的 DiffEditor 显示 SVN 差异 | `svn-diff-widget.tsx` |
| 17C-03 | 编辑器沟槽变更标记：新增/修改/删除行的颜色标记 | `svn-gutter-decorator.ts` |
| 17C-04 | 实现 SvnService.getLog()：获取版本历史（--xml 解析） | `svn-service.ts` log 方法 |
| 17C-05 | 实现 SvnHistoryWidget：历史视图（版本列表+变更路径） | `svn-history-widget.tsx` |
| 17C-06 | 历史视图工具栏：Compare、Revert to This Revision、Copy Rev No | 历史工具栏 |
| 17C-07 | 历史筛选：按作者/消息关键字筛选 | 筛选功能 |
| 17C-08 | 实现 SvnService.annotate()：svn blame --xml 解析 | `svn-service.ts` blame 方法 |
| 17C-09 | 实现 SvnAnnotateDecorator：编辑器行级标注（参考 GitBlameDecorator） | `svn-annotate-decorator.ts` |
| 17C-10 | 标注交互：悬停 tooltip、点击打开版本详情、颜色区分提交 | 标注交互功能 |
| 17C-11 | 文件夹比较：svn diff --summarize 目录差异列表 | 文件夹 diff 后端 |
| 17C-12 | SvnFolderDiffWidget：文件夹比较视图（基础版本） | 文件夹 diff 组件 |
| 17C-13 | 冲突处理：svn resolve 命令、冲突标记显示、基础三向合并入口 | 冲突处理基础 |
| 17C-14 | 设置项注册：所有 SVN 配置项 | `svn-preferences.ts` |

**验收标准（DoD）**：

- [ ] 双击 Local Changes 中的文件能打开 Diff 视图，正确显示新增/删除/修改
- [ ] Diff 视图有语法高亮，支持上/下一个差异跳转
- [ ] 编辑器左侧沟槽有蓝/绿/红标记，悬停可预览变更
- [ ] 右键→Show History 能显示该文件的所有历史版本
- [ ] 历史列表双击版本能看到该版本修改的所有文件
- [ ] 右键→Annotate 能在编辑器行首显示作者和日期
- [ ] 悬停标注显示完整提交消息，点击打开该版本详情
- [ ] 标注颜色区分不同提交（同一提交颜色一致）
- [ ] 右键→Compare with Branch 能打开文件夹比较（至少显示哪些文件不同）
- [ ] 冲突文件显示红色 [Conflict] 状态，有 Resolve 入口

---

#### Wave 17D：高级功能与完善（P1/P2 增强）

**目标**：分支标签、锁定、属性、仓库浏览器、Changelist，达到 IDEA 85% 功能

**预计工时**：4-5 天

**任务清单**：

| 编号 | 任务 | 产出物 |
|------|------|--------|
| 17D-01 | 实现 SvnService 分支/标签操作：copy、switch、merge 基础 | 分支/标签服务方法 |
| 17D-02 | 切换分支对话框：选择 URL + revision，显示当前 URL | Switch 对话框 |
| 17D-03 | 创建分支/标签对话框：源 URL、目标 URL、日志消息 | Branch/Tag 对话框 |
| 17D-04 | 实现 SvnService.lock/unlock：文件锁定与解锁 | 锁操作方法 |
| 17D-05 | 锁状态显示：项目视图/Local Changes 显示锁图标和锁持有者 | 锁状态装饰 |
| 17D-06 | svn:ignore 管理：添加/移除忽略模式，忽略文件视图 | 忽略功能 |
| 17D-07 | 实现 SvnService.listRepository()、mkdir()、remove() 仓库操作 | 仓库浏览后端 |
| 17D-08 | SvnRepositoryWidget：仓库浏览器（树状浏览远程仓库） | 仓库浏览视图 |
| 17D-09 | 仓库浏览器操作：新建文件夹、删除、查看历史、Checkout | 仓库浏览器工具栏 |
| 17D-10 | Changelist 支持：将文件分组到不同变更列表、切换活动 Changelist | Changelist 功能 |
| 17D-11 | 实现 SvnService.cleanup()：Cleanup 各种选项 | Cleanup 功能 |
| 17D-12 | 认证处理：svn 用户名/密码输入对话框、缓存认证 | 认证对话框 |
| 17D-13 | svn:externals 识别与显示（外部定义） | externals 支持 |
| 17D-14 | 创建/应用补丁：svn diff 生成补丁，svn patch 应用补丁 | 补丁功能 |
| 17D-15 | E2E 测试：在真实 SVN 仓库上执行完整工作流 | E2E Playwright 测试 |
| 17D-16 | 性能优化：大量文件（>1000）状态刷新性能、虚拟列表渲染 | 性能优化 |
| 17D-17 | Windows 10 + TortoiseSVN 端到端验证 | Windows 环境验证 |
| 17D-18 | 文档：用户手册 SVN 章节 | 使用说明 |

**验收标准（DoD）**：

- [ ] Switch 切换分支功能正常，切换后文件更新、状态正确
- [ ] 创建 Branch/Tag 成功，仓库中能看到新分支
- [ ] Lock/Unlock 文件正常，锁定状态在 UI 中正确显示
- [ ] Add to svn:ignore 后文件进入 Ignored 组不再显示为 Unversioned
- [ ] Repository 视图能浏览远程仓库目录结构
- [ ] Changelist 能创建/切换，文件可在 Changelist 间移动
- [ ] Cleanup 能解决工作副本阻塞问题
- [ ] 首次访问需要认证的仓库弹出用户名/密码对话框，输入后成功
- [ ] Create Patch 能生成 .patch 文件，Apply Patch 能应用补丁
- [ ] Windows 10 + TortoiseSVN 环境下所有 P0/P1 功能正常
- [ ] E2E 测试通过（Checkout→Modify→Commit→Update→History→Annotate 闭环）

---

### 4.2 总开发周期

| 波次 | 工时 | 累计 | 关键里程碑 |
|------|------|------|-----------|
| 17A | 3-4天 | 4天 | SVN 检测成功，状态可识别 |
| 17B | 4-5天 | 9天 | 提交/更新/还原核心工作流可用 |
| 17C | 4-5天 | 14天 | Diff/History/Annotate 追溯功能可用 |
| 17D | 4-5天 | 19天 | 高级功能完成，达到可交付质量 |

**总周期**：约 3 周（13-19 个工作日）

---

## 五、验收标准与测试方案

### 5.1 总体验收原则

1. **功能完整性**：覆盖本文档中所有 P0 功能，P1 功能覆盖 ≥ 85%
2. **开箱即用**：Windows 安装任意 SVN 客户端（TortoiseSVN 等）后无需配置即可使用
3. **IDEA 操作习惯兼容**：常用操作流程、快捷键、视觉反馈与 IDEA 一致
4. **鲁棒性**：网络异常、认证失败、冲突、WC 损坏等场景不崩溃 IDE，有友好提示
5. **性能**：1000 个文件的项目状态刷新 < 2 秒，操作响应无明显卡顿
6. **跨版本兼容**：支持 SVN 1.6 - 1.14 工作副本格式（无需用户升级 WC）

### 5.2 环境矩阵测试

| 操作系统 | SVN 客户端版本 | 测试重点 |
|---------|---------------|---------|
| Windows 10 | TortoiseSVN 1.14 (command line) | **主要目标环境**，完整功能测试 |
| Windows 10 | SlikSVN 1.14 | 独立 svn.exe，验证 PATH 检测 |
| Windows 10 | VisualSVN command line | 另一种常见分发 |
| Windows 10 | 无 SVN 安装 | 友好提示，不报错 |
| Windows 10 | TortoiseSVN 未勾选 command line | 提示安装 command line client |
| macOS 12+ | /usr/bin/svn (Xcode CLT) | macOS 兼容性 |
| macOS 12+ | Homebrew svn 1.14 | Homebrew 安装路径检测 |
| Linux (Ubuntu) | apt install subversion | Linux 兼容性 |

### 5.3 功能测试用例（P0 必测）

#### 5.3.1 SVN 检测与 WC 识别

| 用例 ID | 用例 | 步骤 | 预期结果 |
|--------|------|------|---------|
| SVN-001 | 自动检测已安装的 TortoiseSVN | 1. Windows 安装 TortoiseSVN 并勾选 command line<br>2. 启动 Kairo IDE | 状态栏显示 "SVN: rXXX"，设置中能看到检测到的路径和版本 |
| SVN-002 | 未安装 SVN 时提示 | 1. 卸载所有 SVN 客户端<br>2. 启动 IDE，打开项目 | 显示提示 "未检测到 SVN 客户端"，不崩溃，其他功能正常 |
| SVN-003 | 识别 SVN 工作副本 | 1. 用 TortoiseSVN Checkout 一个项目<br>2. 在 Kairo 中打开该目录 | 自动识别为 SVN 项目，状态栏显示 WC 信息 |
| SVN-004 | 非 SVN 目录不显示 SVN 功能 | 1. 打开一个普通目录（非 SVN/Git） | 不显示 SVN 状态、不弹错误 |
| SVN-005 | 自定义 svn 路径 | 1. 设置中指定 svn.exe 路径<br>2. 重启 IDE | 使用指定路径的 svn.exe |

#### 5.3.2 状态显示与装饰

| 用例 ID | 用例 | 步骤 | 预期结果 |
|--------|------|------|---------|
| SVN-101 | 修改文件显示 Modified 状态 | 1. 打开 SVN 工作副本文件<br>2. 编辑并保存 | 项目视图中文件名变蓝，标签显示 [Modified]，Local Changes 中列出该文件 |
| SVN-102 | 新增文件显示 Unversioned | 1. 在项目中新建文件 | 文件显示为 Unversioned（紫色/问号） |
| SVN-103 | Add 后文件显示 Added 状态 | 1. 对 Unversioned 文件执行 Add | 文件变绿色 [Added] |
| SVN-104 | 标记删除后显示 Deleted | 1. 执行 Delete（keep local=false） | 文件灰色删除线 [Deleted] |
| SVN-105 | 冲突文件显示 Conflict 状态 | 1. 制造冲突后 Update | 文件变红 [Conflict]，有 Resolve 按钮 |
| SVN-106 | 目录递归显示状态 | 1. 修改深层子目录的文件 | 父级目录名也变色（蓝色表示有子项修改） |
| SVN-107 | 忽略文件显示 Ignored | 1. 添加到 svn:ignore | 文件变灰色 [Ignored]，默认不影响变更计数 |

#### 5.3.3 提交工作流

| 用例 ID | 用例 | 步骤 | 预期结果 |
|--------|------|------|---------|
| SVN-201 | 提交单个文件修改 | 1. 修改文件<br>2. 打开 Local Changes，选择文件<br>3. 输入提交消息，点击 Commit | 提交成功，版本号+1，文件恢复 Normal 状态 |
| SVN-202 | 提交多个文件 | 1. 修改多个文件<br>2. 全选，输入消息，Commit | 所有选定文件一起提交 |
| SVN-203 | 提交时取消选择某些文件 | 1. 修改多个文件<br>2. 取消勾选不想提交的文件<br>3. Commit | 只有勾选的文件被提交，未勾选的保持 Modified |
| SVN-204 | 提交新增文件 | 1. 新建文件，Add<br>2. 选择该文件 Commit | 文件成功加入仓库，其他开发者 Update 能获取 |
| SVN-205 | 提交时认证失败提示 | 1. 提交到需要认证的仓库但不输密码 | 显示认证对话框或错误提示，文件保持 Modified 状态（不丢失） |
| SVN-206 | 空提交消息拦截 | 1. 不输入消息直接点 Commit | 提示 "请输入提交消息"，不执行提交 |
| SVN-207 | 提交前显示 Diff | 1. 勾选 "Show diff before commit"<br>2. Commit | 先打开 Diff 预览，确认后才提交 |

#### 5.3.4 更新工作流

| 用例 ID | 用例 | 步骤 | 预期结果 |
|--------|------|------|---------|
| SVN-301 | 更新到最新版本 | 1. 其他用户提交了修改<br>2. 按 Ctrl+T 执行 Update | 下载新版本，显示 "Updated to rXXX, N files updated" |
| SVN-302 | 更新单个文件 | 1. 右键文件→Update File | 只更新该文件 |
| SVN-303 | 更新时无新内容 | 1. 当前已是最新版本<br>2. 执行 Update | 提示 "Already at the latest version" |
| SVN-304 | 更新产生冲突 | 1. 本地修改了同一行<br>2. 其他用户也修改并提交<br>3. 执行 Update | 该文件标记为 Conflict，弹出冲突解决提示 |
| SVN-305 | Update 过程中取消 | 1. 大更新过程中点击取消 | 更新中止，已更新的文件保留，不损坏 WC |

#### 5.3.5 还原操作

| 用例 ID | 用例 | 步骤 | 预期结果 |
|--------|------|------|---------|
| SVN-401 | 还原修改的文件 | 1. 修改文件<br>2. 右键 Revert | 文件恢复到 BASE 版本，Modified 标记消失 |
| SVN-402 | 还原新增的文件 | 1. Add 一个新文件<br>2. Revert | 文件回到 Unversioned 状态（不会被删除） |
| SVN-403 | 还原多个文件 | 1. 选择多个文件 Revert | 所有选中文件恢复到 BASE |
| SVN-404 | 还原时确认对话框 | 1. 点击 Revert | 显示确认对话框 "Are you sure..."，防止误操作 |

#### 5.3.6 Diff 差异查看

| 用例 ID | 用例 | 步骤 | 预期结果 |
|--------|------|------|---------|
| SVN-501 | 查看本地修改 Diff | 1. 修改文件<br>2. 双击 Local Changes 中该文件 | 打开 Diff 视图，正确显示新增/删除/修改的行 |
| SVN-502 | Diff 有语法高亮 | 1. 打开 .java 文件的 Diff | 有 Java 语法高亮 |
| SVN-503 | 与最新版本比较 | 1. 右键→Compare with Latest Repository Version | 显示本地版本与 HEAD 的差异 |
| SVN-504 | Diff 中上/下一个差异跳转 | 1. 打开 Diff 视图<br>2. 点击上/下按钮 | 光标跳到上/下一个差异处 |
| SVN-505 | 编辑器沟槽变更标记 | 1. 修改文件后查看编辑器左侧 | 修改行有蓝色标记，新增行绿色，删除行有红色三角 |
| SVN-506 | 文件夹比较显示差异文件 | 1. 右键文件夹→Compare with Branch<br>2. 选择一个分支 | 显示两目录之间有哪些文件不同 |

#### 5.3.7 历史记录

| 用例 ID | 用例 | 步骤 | 预期结果 |
|--------|------|------|---------|
| SVN-601 | 查看文件历史 | 1. 右键文件→Show History | 显示该文件的所有历史版本列表（Revision、Author、Date、Message） |
| SVN-602 | 历史列表显示变更路径 | 1. 展开历史列表中的某个版本 | 显示该版本修改了哪些文件 |
| SVN-603 | 历史按作者筛选 | 1. 在 History 视图输入作者名筛选 | 只显示该作者的提交 |
| SVN-604 | 双击历史版本中的文件打开 Diff | 1. 在历史视图展开版本<br>2. 双击变更路径中的文件 | 打开该文件在该版本的 Diff |
| SVN-605 | 回退到历史版本 | 1. 右键某个历史版本→Revert to this Revision | 文件内容回到该版本，可重新提交 |

#### 5.3.8 Annotate/Blame 行级标注

| 用例 ID | 用例 | 步骤 | 预期结果 |
|--------|------|------|---------|
| SVN-701 | 开启 Annotate 显示作者日期 | 1. 打开文件<br>2. 右键→Subversion→Annotate | 编辑器每行左侧显示作者和日期 |
| SVN-702 | 不同提交用颜色区分 | 1. 开启 Annotate | 不同 revision 的行有不同背景色 |
| SVN-703 | 悬停显示详细信息 | 1. 鼠标悬停在标注上 | 显示完整提交消息、日期、作者邮箱 |
| SVN-704 | 点击标注打开历史 | 1. 点击某行标注 | 打开 History 视图定位到该版本 |
| SVN-705 | 关闭 Annotate | 1. 右键→Close Annotations | 标注消失，编辑器恢复正常 |

#### 5.3.9 冲突解决

| 用例 ID | 用例 | 步骤 | 预期结果 |
|--------|------|------|---------|
| SVN-801 | 冲突文件有明显标记 | 1. Update 产生冲突 | 文件标记红色 [Conflict]，Local Changes 中 Conflicts 分组显示 |
| SVN-802 | 冲突文件包含冲突标记 | 1. 打开冲突文件 | 文件中有 <<<<<<< .mine / ======= / >>>>>>> .rXXX 标记 |
| SVN-803 | Mark as Resolved | 1. 手动编辑解决冲突<br>2. 右键→Mark as Resolved | 冲突标记消失，文件变为 Modified，可提交 |
| SVN-804 | 接受我的版本解决 | 1. 右键→Resolve→Accept Mine | 文件以本地版本为准，标记为 resolved |

### 5.4 性能测试基准

| 场景 | 性能指标 | 合格标准 |
|------|---------|---------|
| SVN 客户端检测（冷启动） | 首次检测耗时 | < 3 秒（后台异步，不阻塞 UI） |
| 小项目状态刷新（< 50 文件） | `svn status` 轮询延迟 | < 1 秒 |
| 中型项目状态刷新（~500 文件） | 轮询延迟 | < 2 秒 |
| 大型项目状态刷新（~2000 文件） | 轮询延迟 | < 5 秒 |
| Local Changes 视图渲染（100 个变更文件） | 列表渲染时间 | < 500ms（虚拟列表） |
| Diff 视图打开 | 从双击到显示 diff | < 1 秒 |
| History 视图加载（获取 100 条历史） | 历史列表显示 | < 3 秒 |
| Annotate 标注加载（1000 行文件） | 标注出现时间 | < 2 秒 |
| Commit 提交（10 个文件） | 从点按钮到完成 | 视网络速度，有进度提示 |
| Update 更新（拉取 50 个文件） | 更新完成时间 | 视网络，有进度提示和取消 |

### 5.5 异常场景测试

| 场景 | 预期行为 |
|------|---------|
| 网络断开时执行 Commit/Update | 显示网络错误提示，不丢失本地修改，不损坏 WC |
| SVN 服务器认证失败 | 弹出用户名/密码对话框，允许重新输入 |
| 工作副本被其他程序锁定 | 提示执行 Cleanup，提供 Cleanup 按钮 |
| svn.exe 被删除/卸载 | 检测到不可用，提示重新安装或配置路径 |
| 工作副本格式过旧（pre-1.6） | 提示需要升级 WC，提供 Upgrade 选项 |
| 提交空消息/无文件选中 | 前端拦截，不执行 svn commit |
| 并发写操作（快速连点两次 Commit） | 命令队列串行化，不会并发执行两个 commit |
| 工作副本含有冲突时尝试 Commit | 提示存在冲突文件，需先解决冲突才能提交 |
| 大文件 (>100MB) Diff | 不崩溃，提示文件过大跳过 diff 或直接显示二进制 |
| 二进制文件 Diff | 提示 "Binary files differ"，不尝试文本比较 |

### 5.6 E2E 端到端测试（Playwright）

编写 E2E 测试脚本，在测试 SVN 仓库上执行完整工作流闭环：

```typescript
// tests/e2e/svn-e2e.spec.ts
test.describe('SVN Integration E2E', () => {
  test('complete workflow: checkout → modify → commit → update → history → annotate', async ({ app }) => {
    // 1. 检测到 SVN 客户端
    // 2. Checkout 测试仓库
    // 3. 验证工作副本识别成功
    // 4. 修改文件并保存
    // 5. 验证 Local Changes 中显示 Modified
    // 6. 打开 Diff 验证差异显示
    // 7. 提交文件（使用测试账号）
    // 8. 验证提交成功，版本号更新
    // 9. 执行 Update（无新内容场景）
    // 10. 打开 History 验证能看到刚提交的记录
    // 11. 开启 Annotate 验证最后一行显示自己
    // 12. Revert 修改验证恢复
  });

  test('file status decorations', async ({ app }) => {
    // 测试各种状态下的文件颜色/图标
  });

  test('conflict detection and resolution', async ({ app }) => {
    // 制造冲突、检测冲突、解决冲突
  });
});
```

---

## 六、关键技术难点与解决方案

### 6.1 难点 1：Windows SVN 客户端多样性

**问题**：Windows 上 SVN 客户端分发很多（TortoiseSVN 默认不装命令行工具，SlikSVN、CollabNet 等安装路径不同），用户可能安装了任意一种。

**解决方案**：

1. **多层检测策略**：PATH → 常见安装路径表 → 注册表查询 → 用户配置
2. **TortoiseSVN 特殊处理**：检测 TortoiseSVN 安装目录但未找到 svn.exe 时，提示用户重新运行安装程序勾选 "command line client tools"
3. **检测结果可视化**：设置页面显示当前检测状态：
   - ✅ 已检测到：`C:\Program Files\TortoiseSVN\bin\svn.exe` (version 1.14.2)
   - ❌ 未检测到 SVN 客户端 → [下载 TortoiseSVN] 按钮（链接到官网）
   - ⚠️ 检测到 TortoiseSVN 但未安装 command line tools → 提示如何启用

### 6.2 难点 2：工作副本并发安全

**问题**：SVN 工作副本使用 SQLite 数据库（wc.db），不支持并发写操作，多命令同时执行会导致数据库被锁损坏。

**解决方案**：

1. 每个 WC root 维护一个独立的命令队列
2. 写操作（commit/update/revert/add/delete/cleanup/switch/resolve）必须串行排队
3. 读操作（status/log/diff/blame/info/list）允许并行（但同一 WC 最多 3 个并发）
4. 当有写操作正在执行时，UI 禁用相关按钮，显示 "SVN is busy..." 状态
5. 写操作完成后自动触发一次 status refresh

### 6.3 难点 3：SVN 认证交互

**问题**：SVN 命令行在需要认证时会交互式提示输入用户名/密码，但 child_process 难以处理这种交互。

**解决方案**：

1. **优先使用缓存认证**：SVN 默认会在 `~/.subversion/auth/` 缓存认证，大多数情况无需交互
2. **--non-interactive 模式**：先以非交互模式执行，如果认证失败再提示用户输入
3. **--username/--password 参数**：用户输入凭证后通过命令行参数传递（注意：密码可能在进程列表可见，但 SVN 本身就这样）
4. **认证缓存提示**：告诉用户 SVN 会缓存密码，后续无需再输入
5. **认证对话框**：使用 Theia 的 QuickInput/Dialog 系统弹出用户名密码输入框
6. **失败重试**：认证失败时重新弹出对话框，允许用户重试（最多 3 次）

```typescript
// 认证处理逻辑
async execWithAuth(args: string[], cwd: string): Promise<CommandResult> {
  // 第一次尝试：非交互（用缓存凭证）
  try {
    return await this.exec([...args, '--non-interactive'], cwd, 'write');
  } catch (e) {
    if (isAuthError(e)) {
      // 弹出认证对话框
      const credentials = await this.promptCredentials();
      if (credentials) {
        // 使用用户提供的凭证重试
        return await this.exec([
          ...args,
          '--non-interactive',
          '--username', credentials.username,
          '--password', credentials.password,
        ], cwd, 'write');
      }
      throw new SvnAuthError('Authentication cancelled by user');
    }
    throw e;
  }
}
```

### 6.4 难点 4：状态轮询性能与文件句柄泄漏

**问题**：频繁执行 `svn status` 可能导致：
- 大项目 CPU 占用高
- 文件句柄泄漏（某些 SVN 版本的问题）
- 用户操作被轮询阻塞

**解决方案**：

1. **动态轮询间隔**：
   - 窗口激活时：3 秒
   - 窗口失焦时：30 秒
   - 正在执行写操作时：暂停轮询
   - 连续 3 次结果无变化时：延长到 10 秒
2. **`--depth` 和忽略目录**：跳过 `node_modules`、`target`、`.git` 等目录（通过 `--changelist` 排除或配置排除列表）
3. **基于 `svn status -u` 的服务器同步**：手动触发或每 60 秒检查一次服务器更新（`-u` 参数显示服务器侧变更）
4. **文件系统监听辅助**：利用 Theia 的 FileService 监听文件变化，本地变更时立即触发 status，不等待轮询
5. **超时保护**：每次 status 命令最多执行 10 秒，超时取消避免堆积

### 6.5 难点 5：差异与合并的 UI 实现

**问题**：自己实现一个功能完整的 Diff/Merge 编辑器工作量很大。

**解决方案**：

1. **复用 Theia/Monaco 的 DiffEditor**：Theia 已经有 DiffEditor 组件，基于 Monaco 的 inline diff 和 side-by-side diff
2. **生成 Unified Diff 格式**：`svn diff` 默认输出 unified diff 格式，Monaco DiffEditor 可以直接使用
3. **三向合并**：利用 `svn diff --old --new` 获取三端内容，先实现基础的三向视图（左=服务器基础，中=合并结果，右=本地），接受/拒绝按钮
4. **二进制文件处理**：根据 svn mime-type 属性或文件扩展名判断，二进制文件不尝试文本 diff，显示 "Binary files differ" + 大小信息

### 6.6 难点 6：svn:ignore 与全局忽略

**问题**：SVN 的忽略机制不同于 Git（.gitignore），是通过目录属性 `svn:ignore` 实现的，且有全局忽略配置。

**解决方案**：

1. 读取 `svn propget svn:ignore <dir>` 获取忽略模式
2. 写入 `svn propset svn:ignore <patterns> <dir>` 设置忽略
3. 读取 `~/.subversion/config` 中 `global-ignores` 配置
4. IDE 额外忽略列表：`kairo.svn.excludeDirectories`（如 node_modules）
5. 添加忽略时提供选项：
   - 只忽略该文件（精确文件名）
   - 忽略该扩展名（*.ext）
   - 自定义忽略模式

---

## 七、与现有 Git 扩展的关系

### 7.1 双 VCS 共存策略

项目可能同时存在 .svn 和 .git（罕见但存在），处理策略：

1. **优先级配置**：用户设置 `kairo.svn.priorityOverGit` (默认 false，即 Git 优先)
2. **自动检测**：如果同一目录下同时有 .svn 和 .git：
   - 默认启用 Git（因为现有 Git 功能已完成）
   - 状态栏显示 "Git + SVN" 或让用户选择激活哪个
   - 两个 VCS 的装饰不冲突（使用不同图标，Git 用圆形，SVN 用方形）
3. **功能隔离**：SvnService 和 GitService 完全独立，状态轮询、装饰器互不干扰
4. **切换机制**：命令面板提供 "Switch Active VCS" 命令切换当前激活的版本控制系统

### 7.2 代码复用

虽然 SVN 和 Git 概念不同，但以下 UI 组件和模式可以复用：

- **响应式 Store 模式**：参考 GitStore 实现 SvnStore
- **文件装饰器架构**：参考 GitExplorerDecorator/GitFileStatusDecorator
- **Blame/Annotate 渲染**：参考 GitBlameDecorator 的渲染逻辑，适配 SVN 数据格式
- **Diff Widget 基础结构**：可复用，但数据来源不同
- **History Widget 表格**：表格渲染逻辑可复用，列不同
- **命令队列模式**：新设计的 SvnCommandQueue 比 GitService 直接 exec 更健壮，可以后续移植到 Git

### 7.3 统一 SCM 抽象（后续 P2）

长期来看，可以抽象出通用的 SourceControl 接口：

```typescript
interface SourceControlProvider {
  id: 'git' | 'svn';
  name: string;
  isAvailable(): boolean;
  getStatus(): Promise<FileStatusEntry[]>;
  commit(files: string[], message: string): Promise<CommitResult>;
  update(): Promise<UpdateResult>;
  // ... 通用接口
}
```

但 Wave 17 先不做这个抽象，优先保证 SVN 功能完整可用。后续可以统一视图层，让 Local Changes 视图同时支持 Git/SVN。

---

## 八、风险与应对

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|---------|
| TortoiseSVN 默认不装 command line 导致用户找不到 svn.exe | 用户以为功能坏了 | 高 | 1. 详细检测提示<br>2. 文档明确说明需要勾选 command line<br>3. 考虑打包一个轻量 svn.exe（合规问题需评估） |
| SVN 工作副本被并发操作损坏 | 数据丢失，用户差评 | 中 | 严格的命令队列，写操作串行化，UI 显示 busy 状态 |
| 大项目 status 轮询太慢 | UI 卡顿 | 中 | 动态轮询间隔、排除目录、超时取消、FS 事件辅助 |
| 旧版 SVN (1.6) WC 格式不支持 `--xml` 某些参数 | 解析失败 | 低 | 检测 SVN 版本，对旧版本使用兼容的命令参数和文本解析 |
| SVN 认证在 HTTPS + 自签名证书场景失败 | 无法连接企业仓库 | 中 | 提供 `--trust-server-cert` 选项、设置中可配置信任选项 |
| Windows 路径空格/中文/特殊字符问题 | 命令执行失败 | 中 | 所有路径用引号包裹，使用 execFile（不是 exec），spawn 时正确传递 args 数组 |
| 与已有 Theia SCM/Git 模块冲突 | 装饰重复显示 | 低 | 检查现有 @theia/scm 是怎么绑定的，如果已激活则复用而非新建视图 |

---

## 九、交付物清单

Wave 17 完成后交付以下内容：

### 9.1 代码交付

- [ ] `packages/svn-extension/` 完整的 SVN 扩展包
  - [ ] 核心服务层（detector、queue、parser、service、store）
  - [ ] UI 组件（Changes、History、Commit、Diff、Repository、FolderDiff widgets）
  - [ ] 装饰器（Explorer、Tab、Gutter、Annotate、StatusBar）
  - [ ] 命令、菜单、快捷键注册
  - [ ] 偏好设置
- [ ] `packages/theia-product/` 修改：注册 svn-extension
- [ ] 单元测试：parser、service、detector 核心逻辑测试
- [ ] E2E 测试：完整工作流 Playwright 测试
- [ ] pnpm-lock.yaml 更新

### 9.2 文档交付

- [ ] 用户手册中 SVN 使用章节（docs/user-manual.md 或独立章节）
- [ ] 界面截图（docs/screenshots/svn-*.png）
- [ ] Windows 环境测试报告
- [ ] 性能基准测试结果

### 9.3 验证环境

- [ ] Windows 10 测试虚拟机：安装 TortoiseSVN 1.14 + JDK 6 + Tomcat 6 + 真实 SVN 企业仓库
- [ ] 本地测试 SVN 仓库（svnadmin create）用于自动化测试

---

## 十、参考资源

1. **SVN 官方文档**：http://svnbook.red-bean.com/ (Version Control with Subversion)
2. **SVN 命令参考**：`svn help` 命令，`svn help <subcommand>`
3. **IntelliJ IDEA SVN 文档**：https://www.jetbrains.com/help/idea/using-subversion-integration.html
4. **Theia SCM 模块**：参考 `@theia/scm` 和 `@theia/git` 的扩展点
5. **现有 Git 扩展**：[git-service.ts](file:///Users/qi/Documents/spaces/kairo-ide/packages/git-extension/src/browser/git-service.ts)、[git-blame-decorator.ts](file:///Users/qi/Documents/spaces/kairo-ide/packages/git-extension/src/browser/git-blame-decorator.ts)

---

## 附录 A：SVN 命令速查表（核心命令）

| 功能 | SVN 命令 |
|------|---------|
| 检出 | `svn checkout URL [PATH]` |
| 更新 | `svn update [PATH...]` |
| 提交 | `svn commit [PATH...] -m "MSG"` |
| 状态 | `svn status [PATH] --xml` |
| 添加 | `svn add PATH...` |
| 删除 | `svn delete PATH...` |
| 还原 | `svn revert PATH... [-R]` |
| 清理 | `svn cleanup [PATH]` |
| 差异 | `svn diff [PATH]` |
| 日志 | `svn log [PATH] --xml -l LIMIT` |
| 标注 | `svn blame PATH --xml` |
| 信息 | `svn info [PATH] --xml` |
| 加锁 | `svn lock PATH... -m "COMMENT"` |
| 解锁 | `svn unlock PATH...` |
| 复制（分支/标签） | `svn copy SRC DST -m "MSG"` |
| 切换 | `svn switch URL [PATH]` |
| 合并 | `svn merge SOURCE[@REV] [TARGET_WCPATH]` |
| 解决 | `svn resolve PATH --accept ARG` |
| 列表（仓库） | `svn list URL --xml` |
| 建目录（仓库） | `svn mkdir URL -m "MSG"` |
| 移动 | `svn move SRC DST -m "MSG"` |
| 属性获取 | `svn propget PROPNAME [PATH]` |
| 属性设置 | `svn propset PROPNAME PROPVAL [PATH]` |
| 属性列表 | `svn proplist [PATH]` |
| 导出 | `svn export SRC [DST]` |
| 导入 | `svn import PATH URL -m "MSG"` |
| 变更列表添加 | `svn changelist CLNAME PATH...` |
| 变更列表移除 | `svn changelist --remove PATH...` |
| 补丁创建 | `svn diff > file.patch` |
| 补丁应用 | `svn patch file.patch` |

---

## 附录 B：IDEA SVN 与本方案功能对照

| IDEA SVN 功能 | 本方案实现 | 波次 | 备注 |
|--------------|-----------|------|------|
| Local Changes 视图 | ✅ SvnChangesWidget | 17B | 完整实现 |
| Commit Dialog | ✅ SvnCommitWidget | 17B | 核心功能，Before Commit 部分选项简化 |
| Update Project | ✅ svn.update | 17B | Ctrl+T |
| Revert | ✅ svn.revert | 17B | 含确认对话框 |
| Checkout from SVN | ✅ svn.checkout | 17B | 命令面板入口 |
| Show History | ✅ SvnHistoryWidget | 17C | 含版本详情 |
| Annotate (Blame) | ✅ SvnAnnotateDecorator | 17C | 颜色区分、hover、点击 |
| Compare with Same Version | ✅ SvnDiffWidget | 17C | 基于 Monaco DiffEditor |
| Compare with Branch/Tag | ✅ SvnFolderDiffWidget | 17C/D | 基础版本，高级同步后续增强 |
| Editor Gutter Marks | ✅ SvnGutterDecorator | 17C | 新增/修改/删除标记 |
| Explorer Decorations | ✅ SvnExplorerDecorator | 17B | 颜色+图标 |
| Tab Decorations | ✅ SvnFileStatusDecorator | 17B | 文件名后缀状态 |
| Status Bar | ✅ SvnStatusBarContribution | 17B | 分支/版本/变更数 |
| Repository Browser | ✅ SvnRepositoryWidget | 17D | 树状浏览+基础操作 |
| Branch/Tag | ✅ copy + Switch | 17D | 创建+切换 |
| Merge | ⚠️ 基础支持 | 17D | 基础合并，高级 merge 选项 P2 |
| Lock/Unlock | ✅ lock/unlock | 17D | 状态显示 |
| svn:ignore | ✅ ignore 管理 | 17D | 添加/移除忽略模式 |
| Changelists | ✅ Changelist 分组 | 17D | 基础分组管理 |
| Cleanup | ✅ svn.cleanup | 17D | 各种选项 |
| Properties Editor | ⚠️ 只读显示 | 17D | P2 做编辑 |
| Conflict Resolution | ⚠️ 基础三向 | 17C/D | 三向视图，接受/拒绝 |
| Create/Apply Patch | ✅ patch | 17D | 基础补丁 |
| Shelve Changes | ❌ P3 | - | 搁置功能（类似 git stash），SVN 1.10+ 支持 |
| svn:externals | ⚠️ 识别 | 17D | 显示，不做管理 |

**功能覆盖度**：
- P0 功能：100%（Wave 17B 完成即可使用核心工作流）
- P1 功能：85%（Wave 17D 完成）
- 整体覆盖 IDEA 常用 SVN 功能：约 80%

---

*文档结束 — Wave 17 SVN Integration Design v1.0*
