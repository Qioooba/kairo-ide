# Phase P 全局 UI/UX 审计报告

**审计范围：** `packages/*/src/browser/**/*.tsx`（含 git/svn/search/sql/test/remote/java/build/project/plugin/tomcat/ui-kit/i18n 等）  
**审计日期：** 2026-08-01  
**说明：** 本报告仅做审计，未修改任何源码。报告反映的是 Task 2/3 清理完成后的当前代码状态。

---

## 1. 执行摘要

| 审计项 | 发现数量 | 关键结论 |
|--------|----------|----------|
| 内联样式 `style={{` | 11 处匹配 | 排除 `virtual-list.tsx` 的 2 处绝对定位样式后，剩余 9 处均为动态 CSS 自定义属性（tree depth、score 等），符合规范；另有 1 处 Maven 进度条宽度直接写在内联样式中，建议改用 CSS 变量。 |
| 硬编码中文字符串 | 0 处 | 用户可见文案中无硬编码中文；注释中亦未发现。 |
| 明显硬编码英文用户文案 | 25 处 | 21 处为 widget 构造器中 `this.title.label` / `this.title.caption` 的英文默认值；4 处为导入向导的编码下拉选项显示文本。 |
| i18n 键一致性 | 0 处差异 | 扫描 38 个 browser TSX 文件，918 个合理 i18n 键；`en.ts` 与 `zh-CN.ts` 无缺失键、无结构不一致。 |

**总体评估：** Phase P 清理工作效果显著，`project-structure-dialog.tsx` 的内联样式和硬编码英文已全部接入 i18n；当前剩余问题主要集中在 widget 标题默认值和少量遗留选项文本，风险可控。

---

## 2. 内联样式扫描

### 执行摘要
- 共扫描到 `style={{` **11 处**，分布在 **7 个文件**。
- 按任务要求排除 `packages/ui-kit/src/browser/virtual-list.tsx` 的 2 处绝对定位内联样式。
- 剩余 9 处均为动态值注入 CSS 自定义属性，符合 Phase P 规范；**硬编码布局/颜色/字号样式已清零**。
- **1 处建议优化**：`maven-view-widget.tsx:382` 的进度条宽度直接以内联 `width` 设置，未走 CSS 变量。

### 详细发现

| 文件 | 行号 | 内容摘要 | 是否动态 | 建议修复 |
|------|------|----------|----------|----------|
| `packages/ui-kit/src/browser/virtual-list.tsx` | 209 / 218 | `height: totalHeight`、`transform: translateY(...)` 等绝对定位样式 | 是 | **按任务要求排除**；虚拟列表必须依赖运行时计算尺寸 |
| `packages/java-extension/src/browser/debug-multimodule-widget.tsx` | 376 | `--kairo-debug-multimodule-dep-depth: idx` | 是 | 符合规范，保留 |
| `packages/java-extension/src/browser/java-hierarchy-widget.tsx` | 58 / 96 | `--kairo-java-hierarchy-depth: item.depth` | 是 | 符合规范，保留 |
| `packages/java-extension/src/browser/maven-view-widget.tsx` | 312 | `--kairo-maven-dep-depth: depth` | 是 | 符合规范，保留 |
| `packages/java-extension/src/browser/maven-view-widget.tsx` | 382 | `width: \`\${progress.percentComplete}%\`` | 是 | **建议优化**：改为 `--kairo-maven-progress-width` CSS 变量，保持 JS 只负责传值 |
| `packages/java-extension/src/browser/maven-view-widget.tsx` | 478 | `--kairo-maven-module-depth: depth` | 是 | 符合规范，保留 |
| `packages/plugin-extension/src/browser/kairo-extensions-widget.tsx` | 444 | `--kairo-extension-score: Math.round(report.score * 100)` | 是 | 符合规范，保留 |
| `packages/test-extension/src/browser/test-tree-widget.tsx` | 60 / 93 | `--kairo-test-tree-depth: depth` | 是 | 符合规范，保留 |

### 结论
- 非必要内联样式已清零，`virtual-list.tsx` 的例外已在报告中记录。
- 唯一待优化项是 Maven 进度条宽度，迁移后可彻底消除所有直接 `width` 内联样式。

---

## 3. 硬编码中文字符扫描

### 执行摘要
- 在 `packages/*/src/browser/**/*.tsx` 中搜索中文字符 `\u4e00-\u9fa5`：
- **发现数量：0 处**
- 用户可见界面文案中无硬编码中文；文件注释中亦无中文残留。

### 详细发现
无。

### 结论
中文硬编码问题已完全解决。

---

## 4. 硬编码英文用户文案扫描

### 执行摘要
- 通过组合扫描 `placeholder=`、`title=`、`aria-label=`、`label=`、JSX 文本节点、`this.title.label/caption` 等模式，共发现 **25 处** 明显硬编码英文用户文案。
- 其中 **21 处** 集中在各 widget 构造器中的 `this.title.label` / `this.title.caption` 默认值；
- **4 处** 为 `import-wizard-widget.tsx` 中编码下拉选项的显示文本。
- `placeholder`、`title`、`aria-label` 等交互属性已全部接入 `t(...)`，无硬编码。

### 详细发现

#### 4.1 Widget 标题默认值（构造器中硬编码）

这些标题在运行时通常会被 `updateTitle()` 或 `init()` 用 i18n 键覆盖，但在单元测试、无 Inversify 容器或语言服务尚未注入的场景下仍会展示英文，应统一接入 `KairoI18nService` 或声明为可本地化的回退常量。

| 文件 | 行号 | 硬编码文案 | 类型 |
|------|------|------------|------|
| `packages/build-extension/src/browser/build-view-widget.tsx` | 261 | `Kairo Build` | `title.label` |
| `packages/build-extension/src/browser/build-view-widget.tsx` | 262 | `Kairo Build View` | `title.caption` |
| `packages/build-extension/src/browser/maven-view-widget.tsx` | 441 | `Maven` | `title.label` |
| `packages/build-extension/src/browser/maven-view-widget.tsx` | 442 | `Kairo Maven Project Management` | `title.caption` |
| `packages/git-extension/src/browser/git-changes-widget.tsx` | 219 | `Git Changes` | `title.label` |
| `packages/git-extension/src/browser/git-changes-widget.tsx` | 220 | `Git Changes View` | `title.caption` |
| `packages/git-extension/src/browser/git-commit-widget.tsx` | 493 | `Git Commit` | `title.label` |
| `packages/git-extension/src/browser/git-commit-widget.tsx` | 494 | `Git Commit View` | `title.caption` |
| `packages/git-extension/src/browser/git-diff-widget.tsx` | 167 | `Git Diff` | `title.label` |
| `packages/git-extension/src/browser/git-diff-widget.tsx` | 168 | `Git Diff View` | `title.caption` |
| `packages/git-extension/src/browser/git-history-widget.tsx` | 33 | `Git Commit History` | `title.caption` |
| `packages/git-extension/src/browser/git-stash-widget.tsx` | 285 | `Git Stash` | `title.label` |
| `packages/git-extension/src/browser/git-stash-widget.tsx` | 286 | `Git Stash View` | `title.caption` |
| `packages/project-extension/src/browser/import-wizard-widget.tsx` | 67 | `Kairo IDE - Import Project` | `title.label` |
| `packages/project-extension/src/browser/import-wizard-widget.tsx` | 69 | `Kairo Project Import Wizard` | `title.caption` |
| `packages/project-extension/src/browser/project-selector-widget.tsx` | 39 | `Project` | `title.label` |
| `packages/project-extension/src/browser/project-selector-widget.tsx` | 41 | `Select active project` | `title.caption` |
| `packages/tomcat-extension/src/browser/log-viewer-widget.tsx` | 17 | `Server Logs` / `Kairo Server Log Viewer` | `title.label` / `title.caption`（同一行） |
| `packages/tomcat-extension/src/browser/server-view-widget.tsx` | 415 | `Kairo Server` | `title.label` |
| `packages/tomcat-extension/src/browser/server-view-widget.tsx` | 416 | `Kairo Server View` | `title.caption` |

#### 4.2 导入向导编码下拉选项显示文本

| 文件 | 行号 | 硬编码文案 | 说明 |
|------|------|------------|------|
| `packages/project-extension/src/browser/import-wizard-widget.tsx` | 484 | `UTF-8` | 编码标准名，但为下拉选项可见文本 |
| `packages/project-extension/src/browser/import-wizard-widget.tsx` | 485 | `GBK` | 编码标准名，但为下拉选项可见文本 |
| `packages/project-extension/src/browser/import-wizard-widget.tsx` | 486 | `GB18030` | 编码标准名，但为下拉选项可见文本 |
| `packages/project-extension/src/browser/import-wizard-widget.tsx` | 487 | `ISO-8859-1` | 编码标准名，但为下拉选项可见文本 |

> 注：`project-structure-dialog.tsx` 中的同类编码选项已改为 `labelKey` 引用 i18n 键（如 `widget.projectStructure.encoding.utf8`），`import-wizard-widget.tsx` 应同步处理。

### 结论
- 高频交互属性（placeholder、title、aria-label）已无硬编码英文。
- 剩余问题集中在 widget 标题回退值和导入向导编码名，数量少且修复范围明确。

---

## 5. i18n 键审计

### 执行摘要
- `scripts/extract-i18n-keys.js` 存在且可正常运行；同时运行了扩展对比脚本 `C:\Users\Qi\AppData\Local\Temp\phase-p-i18n-compare.js`。
- 扩展扫描覆盖全部 `packages/*/src/browser/**/*.tsx`，共 **38 个文件**。
- 原始 `t(...)` 匹配：**936 个**
- 合理 i18n 键（`widget.*` / `common.*`）：**918 个**
- 正则误匹配（API 路径、注释示例等）：18 个
- **源码使用但 `en.ts` 缺失的键：0 个**
- **`en.ts` 有但 `zh-CN.ts` 缺失的键：0 个**
- **`en.ts` 与 `zh-CN.ts` 结构不一致：0 处**
- **源码把对象键当叶子节点使用：0 处**

### 差异清单
无差异。

### 正则误匹配样例（非 i18n 键，仅作参考）

```
,
.
/
:
@theia/core/lib/common/uri
@theia/core/shared/@lumino/messaging
@theia/filesystem/lib/browser/file-service
GET /api/v1/projects
GET /api/v1/servers/{serverId}/logs
POST /api/v1/build/custom
POST /api/v1/build/custom/{buildId}/cancel
POST /api/v1/jdtls/project
POST /api/v1/toolchains/import
PUT /api/v1/projects/{projectId}
\n
a
input
welcome.title
```

> 注：`welcome.title` 来自 `packages/i18n/src/browser/react-i18n.tsx` 的注释示例，非真实调用；真实调用为 `widget.welcome.title`。

### 结论
- `en.ts` 与 `zh-CN.ts` 结构完全一致，无未翻译键。
- 此前发现的 `widget.remote.panel.sync.status` 键冲突已修复（现使用 `widget.remote.panel.sync.statusLabel`）。

---

## 6. 下一阶段修复优先级建议

### P0（最高优先级）
1. **Widget 标题默认值硬编码英文（21 处 / 11 个 widget）**  
   `build-*`、`git-*`、`project-*`、`tomcat-*` 等 widget 构造器中仍保留英文 `this.title.label` / `this.title.caption` 默认值。虽然运行时多数会被 i18n 覆盖，但回退场景仍暴露英文。建议：
   - 将默认值统一接入 `KairoI18nService`（如 `this.title.label = this.i18n.t('widget.build.maven.title')`）；
   - 或在构造时注入 i18n 服务；若不可行，至少声明为 `KairoI18nKey` 常量并在 `en.ts/zh-CN.ts` 中补充键。

### P1（高优先级）
2. **导入向导编码下拉选项显示文本（4 处）**  
   `import-wizard-widget.tsx:484–487` 的 `UTF-8`、`GBK`、`GB18030`、`ISO-8859-1` 直接写死在 `<option>` 标签内。建议参考 `project-structure-dialog.tsx` 的做法，使用 `labelKey` 绑定到 `widget.importWizard.encoding.*` 键。

3. **Maven 进度条宽度内联样式（1 处）**  
   `maven-view-widget.tsx:382` 使用 `style={{ width: \`\${progress.percentComplete}%\` }}`。建议改为 CSS 自定义属性 `--kairo-maven-progress-width`，由 JS 设置变量值，CSS 负责 `width` 计算，以彻底消除非 CSS 变量的动态内联样式。

### P2（中优先级）
4. **CSS 自定义属性内联样式的类型安全**  
   部分动态样式仍使用 `as any` 绕过 TypeScript（如 `--kairo-debug-multimodule-dep-depth' as any`）。建议统一声明对应的 CSS 属性类型或组件局部类型，避免 `as any` 扩散。

### P3（低优先级 / 可保留）
5. **`virtual-list.tsx` 例外文档化**  
   当前 `virtual-list.tsx` 的 2 处绝对定位内联样式按任务要求已排除。建议在项目规范或 CSS 规范中明确记录该例外，避免后续审计产生歧义。

---

## 附录：审计使用的方法与文件

- 内联样式搜索：`rg "style=\{\{" packages/*/src/browser/**/*.tsx`
- 中文搜索：`rg "[\x{4e00}-\x{9fa5}]" packages/*/src/browser/**/*.tsx`
- 英文文案搜索：组合 `rg "placeholder="`、`rg "title="`、`rg "aria-label="`、`rg "this\.title\.(label|caption)\s*=\s*['\"]"`、`rg ">[A-Z][a-zA-Z ]+<"` 等
- i18n 提取脚本：`node scripts/extract-i18n-keys.js`
- 扩展 i18n 对比脚本：`node C:\Users\Qi\AppData\Local\Temp\phase-p-i18n-compare.js`（临时脚本，未提交）

**报告输出路径：** `g:\spaces\kairo-ide\docs\progress\phase-p-audit-report.md`
