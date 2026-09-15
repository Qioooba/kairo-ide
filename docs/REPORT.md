# Kairo IDE 前端 UI 审核与整改实施方案

**审计基准：** `Qioooba/kairo-ide` / `6ea00095d1d2a93c3f79ce2a15803b2f893d92ef`。审计日期：2026-09-14。

**用途：**交给前端开发人员或编码 AI 的工作说明。只处理页面布局、控件交互、可访问性、视觉一致性、前端渲染体验和真实截图验收；不重写 IDE、不扩展后端功能路线。

## 0. 审核结果和证据边界

当前最应优先修复的不是“所有页面统一增加 padding”，而是：项目结构弹窗的横向布局错误、加载期间可保存、JVM 参数输入行为、SQL 快捷键闭包、无效调试交互，以及会把源码存在性当成 UI 通过的测试方式。

本轮读取了固定提交下的组件实现、主题样式的相关区段、装配入口、工厂 ID、部分菜单命令及测试实现。`findings.json` 记录 18 个整改项；`surface-inventory.json` 列出 39 个界面族作为覆盖清单的种子。**39 个界面族不是 39 个已完成实机审核的页面，也不是声称已经穷尽所有嵌套弹窗。**清单逐项记录本轮是读了实现、读了样式，还是仅完成入口盘点。

**当前构建截图：0 张；当前应用启动：未成功；项目单元/E2E 测试：本轮未执行。**容器不能获取可运行仓库及依赖，未取得可访问的当前 IDE 实例。仓库存在历史截图，但本轮未完成其图片内容及运行版本核验，没有将历史截图充作当前构建验收证据。没有制作静态 HTML 仿制界面、没有生成效果图代替真实截图。

随附采集脚本必须连接真正运行的 Theia 页面，能保存截图、trace、控制台错误和布局测量；**脚本不是已经跑过的测试报告，截图采集成功也不等于视觉审核通过。**具体执行状态见 `evidence/execution-status.json`。

### 证据等级

`code-confirmed`：在所读源代码中能直接确认结构或行为缺口；不等于本轮已经操作产品复现。

`runtime-risk`：源代码提示裁切、溢出或尺寸时序风险，必须补实际截图/操作后才能认定像素级缺陷。

`code-computed-runtime-unverified`：对指定源码色值的计算；未替代运行时样式、透明背景合成和实际主题的测量。

P1 为本轮前端体验应先解决的问题；P2 为后续一致性和边界体验整改。没有依据把普通视觉问题宣称为生产 P0 事故。

## 1. 不允许偏离的开发边界

保留 Theia/Lumino 的外层窗口、停靠、Tab、工作区恢复和 Monaco 编辑器；不要另做一套 IDE Shell。保留现有命令 ID、WidgetFactory ID、运行配置持久化格式和服务契约。旧布局兼容工厂不能因为看起来像空页就删除，需要先确认是否仅用于恢复旧工作区。

本轮不修改 Java/JSP 分析器、索引路线、JDK/Tomcat 兼容、文件编码保存规则或调试协议。表单与快捷键 bug 涉及调用现有服务时可以修适配层，但不能以 UI 整改为名新增后端平台。IDE 自身的 Chromium 前端与被编辑的历史 JSP/IE 项目不是同一个兼容目标，不能把 IDE UI 降成 IE5 页面。

保留已经存在的合理实现：日志页用了 `VirtualList`；Git/SVN 提交文本框已有 `resize: vertical`；SQL Monaco 使用 `automaticLayout`；部分拖动已用 requestAnimationFrame 合并事件；主题已有 Theia light 类型切换。不得先拆掉这些能力再重新开发。

## 2. 完整 UI 审核应覆盖什么

| 审核维度 | 必须检查的实际问题 | 证据方式 |
|---|---|---|
| 页面结构 | 标题、工具栏、主体、底栏是否正确分区；按钮是否被挤入内容列 | DOM 几何 + 全窗口截图 |
| 对齐 | 同一行控件边框上下边缘、表单列起点、图标与文字基线 | 同一局部截图；测量允许误差初始定为 1 CSS px |
| 空间密度 | 侧栏是否被大标题、大卡片、重复说明吞掉；内容是否过挤 | 窄/宽面板成对截图；统计实际可见行数 |
| 拉伸与收缩 | 外层停靠、内部分割、文本域、列宽、复杂弹窗 | 真实拖动前后截图 + 尺寸断言 |
| 溢出与滚动 | 页面级横滚、双滚动条、底栏消失、长路径遮住按钮 | 边界尺寸、scrollWidth/clientWidth、手工滚动 |
| 弹层与菜单 | 靠边翻转、遮挡、层级、焦点恢复、子菜单 | 打开状态截图，而非只截图收起状态 |
| 表单 | 标签关联、必填、只读/禁用、输入中间态、校验和保存反馈 | 逐键输入、标签点击、失败保持草稿 |
| 选择控件 | 单选/多选语义、搜索选择、长选项、默认值和未知旧值 | 鼠标与键盘分别走通 |
| 状态完整性 | loading/empty/error/busy/success/disabled/dirty | 每个适用分支至少一项真实状态证据 |
| 可访问性 | Tab 顺序、方向键、Space/Enter、可见焦点、名称、对比度 | axe + 手工键盘 + 焦点截图 |
| 环境 | 深浅主题、中文/英文、容器宽度、真实 Windows 缩放 | 独立基线，记录环境，不混合比较 |
| 渲染性能 | 日志持续刷新、长表格、展开深树、拖动时主线程负担 | 固定夹具、浏览器性能记录、DOM 数量 |

边距“过大/过小”必须在页面的用途和真实尺寸下判断。24px 在欢迎页可能合理，在 320px 工具栏中重复三层就可能不合理。不能仅通过正则搜到某个像素值就判定 UI 有问题。

## 3. 可追踪问题清单

以下每项均以基准提交为准。代码锚点使用文件与函数/选择器；开发前必须核对工作分支是否已修改该处，不能硬套旧行号。

### UI-01 · P1 · 项目结构弹窗底栏成为横向第三列

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `packages/project-extension/src/browser/project-structure-dialog.tsx`；`packages/project-extension/src/browser/project-structure-dialog.css`。锚点：`render / renderFooter / .kairo-ps-body`。

**源码事实：**renderFooter() 在 display:flex、默认 row 的 .kairo-ps-body 内，与 tabs、content 同级；未在读取的全局主题样式发现同名覆盖。

**用户影响：**按钮占用内容宽度，而不是位于内容下方。实际像素和各分辨率影响仍需截图。

**实现要求：**新增 column 根容器，body 仅包含导航与内容；footer 移为 body 的兄弟。滚动放到内容区，footer flex-shrink:0；修 loading 分支。

**验收要求：**四个页签及 loading/error 状态截图；断言 footer.top >= body.bottom-1、footer 宽度覆盖容器、窄窗口无按钮裁切。


### UI-02 · P1 · 项目结构加载期间仍允许应用和确定

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `packages/project-extension/src/browser/project-structure-dialog.tsx`。锚点：`renderFooter / save`。

**源码事实：**loading 分支渲染 footer；按钮仅 disabled=saving；save 无 loading 防护。

**用户影响：**数据未加载完成时可触发保存。默认值覆盖实际配置是需通过延迟加载场景确认的风险，不宣称已经发生。

**实现要求：**保存控件与 save 方法双重拦截 loading/saving/缺少项目/校验失败；dirty 状态区分应用与关闭；错误原位保留草稿。

**验收要求：**对加载请求施加受控延迟；UI 点击不能提交；截图 loading、load-error、saving；网络日志仅作观察证据。


### UI-03 · P1 · JVM 参数逐键过滤空行，破坏回车换行

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `packages/theia-product/src/main/browser/kairo-run-configurations-widget.tsx`。锚点：`ConfigurationEditor / VM options textarea`。

**源码事实：**受控 value=vmOptions.join("\n")；onChange split(/\r?\n/).filter(Boolean)。

**用户影响：**在末尾按回车，末尾空串被删除，界面不能正常保留新一行。

**实现要求：**编辑层保存 vmOptionsText 原文；提交时才转数组；不要逐键 trim/filter；处理切换配置、IME、CRLF。

**验收要求：**真实 press Enter 后输入第二行；断言 textarea.value 包含换行；保存重开两行仍在。


### UI-04 · P1 · SQL 快捷键执行回调捕获初始连接状态

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `packages/theia-product/src/main/browser/kairo-sql-console-widget.tsx`。锚点：`Monaco initialization useEffect([]) / addAction / handleExecute`。

**源码事实：**只运行一次的 effect 注册 run:()=>handleExecute()；handleExecute 读取 React 的 connected、connectionId。

**用户影响：**连接后按钮使用新 render 的回调，而原先注册的 Ctrl/Cmd+Enter 回调仍可能按初始未连接状态判断。

**实现要求：**用 latest callback ref 或有清理的 action 更新；编辑器实例保持稳定；所有入口共用同步的 in-flight 防重入守卫。

**验收要求：**同一连接同一 SQL：按钮和快捷键均得到真实结果；连接切换后作用于新连接；连续按键不重复启动。


### UI-05 · P1 · 调试线程选择存在空回调

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `packages/theia-product/src/main/browser/debug-tool-window-widget.tsx`。锚点：`DebugToolWindow / onSelectThread`。

**源码事实：**传给 frames 组件的 onSelectThread 只有 future enhancement 注释，无动作。

**用户影响：**用户看到可选择线程的入口，却不能完成预期操作。

**实现要求：**接入现有线程选择服务，联动栈帧和变量；能力确实不支持时禁用并解释，不得保持可点无反应。

**验收要求：**真实多线程暂停会话，鼠标/键盘切线程并截图当前线程、调用栈、变量；没有会话时不能用空状态截图代替。


### UI-06 · P1 · 调试内部可拉伸不完整且边界写死

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `packages/theia-product/src/main/browser/debug-tool-window-widget.tsx`；`packages/ui-kit/src/browser/kairo-theme.css`。锚点：`framesHeight / mouse handlers / watches container`。

**源码事实：**仅调用栈与断点之间有鼠标拖条；高度 clamp 60..500；观察区固定 200px；未提供对应键盘分隔条和比例持久化。

**用户影响：**外层 Theia 可停靠不代表内部区域都能拉伸；矮面板存在内容被挤占风险。

**实现要求：**复用外层 Theia/Lumino；仅实现内部统一 split；按容器计算边界、支持键盘、折叠、复位及工作区比例持久化。

**验收要求：**拖动、键盘箭头、极小高度、窗口缩放、关闭重开；截图 drag-before/after/min/restore；检查变量与观察区都有可用面积。


### UI-07 · P1 · UI 测试可退化为源码字符串检查

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `tests/e2e/comprehensive/ch22-runconfig.spec.ts`；`tests/e2e/comprehensive/campaign.ts`。锚点：`expectFile / uiOrFile`。

**源码事实：**运行配置章节大多数用例仅 expectFile；uiOrFile 在页面文字不匹配时改为检查源码。

**用户影响：**绿灯不能证明用户操作、布局、字段验证或按钮流程通过。

**实现要求：**静态契约检查移到独立测试分类；UI 测试禁止 uiOrFile 兜底；缺少按钮、无法打开、不能交互必须失败。

**验收要求：**故意破坏按钮 handler、footer 结构及换行；对应 UI 测试必须变红；不能因为源码仍含关键字而通过。


### UI-08 · P1 · 视觉回归脚本只有截图，没有基线比较

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `tests/e2e/visual-regression.cjs`；`tests/e2e/playwright.config.ts`；`package.json`。锚点：`visual runner / root verify`。

**源码事实：**已读 visual runner 仅主窗口和命令面板两图；无图片断言；有个人 Windows Chromium 路径；根 verify 未含 UI/visual/a11y。

**用户影响：**不能证明全部页面已截图审核；现有其他 E2E 的存在不能填补这一个视觉入口的缺口。

**实现要求：**保留旧命令作为 capture smoke；新增独立 visual gate、稳定运行环境、人工批准基线和差异图；检查 CI 实际调用链后接入。

**验收要求：**正常构建产 actual/expected/diff；不批准首次基线不放行；本地无个人路径也能运行；命令失败不得回退静态检查。


### UI-09 · P1 · 自定义页签和表单的键盘与可访问名称不完整

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `packages/project-extension/src/browser/project-structure-dialog.tsx`；`packages/theia-product/src/main/browser/kairo-remote-widget.tsx`。锚点：`tabs / field / renderSdkTab / remote form`。

**源码事实：**项目结构 div role=tab 没有 tabIndex/键盘逻辑；field 采用 span；SDK radio 缺关联 label；remote label 与 input 无 for/id 配对。

**用户影响：**视觉上有标签，不代表键盘可用或辅助技术能识别；点击标签也不一定聚焦输入框。

**实现要求：**button tabs + roving tabIndex；id/aria-controls/labelledby 配套；FormField 统一 htmlFor；radio 卡片用 label 和 fieldset。

**验收要求：**仅键盘走完整页签及 JDK 单选；getByLabel 可唯一定位；点击标签聚焦正确输入；axe + 手工键盘 + 焦点截图。


### UI-10 · P2 · 工具栏项目列表缺少刷新来源

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `packages/theia-product/src/main/browser/kairo-toolbar-widget.tsx`。锚点：`load projects useEffect([runtime])`。

**源码事实：**projects 列表只在 effect 请求一次；失败后保持空列表；activeProject 订阅只更新当前选中项。

**用户影响：**服务对象不变时，首次离线后重连或新增项目，项目下拉列表可能保持过期内容。

**实现要求：**统一项目列表 store；订阅导入/删除/重连事件；区分加载中、无项目、加载失败和过期状态；保留选中项稳定 ID。

**验收要求：**IDE 启动离线→重连；通过 UI 新导入项目→无需重开窗口即出现在下拉；截图失败/重试/成功。


### UI-11 · P2 · 新建运行配置可能使用编辑标题

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `packages/theia-product/src/main/browser/kairo-run-configurations-widget.tsx`。锚点：`ConfigurationEditor title / create template`。

**源码事实：**标题通过 initial.id 判断 edit/new，但新建模板也已经生成非空 id。

**用户影响：**新建/编辑语义混淆。

**实现要求：**传递显式 mode:create|edit；不要用有无生成后的 id 推断场景。

**验收要求：**新建标题、编辑标题分别断言，默认 ID 不影响模式；截图两种状态。


### UI-12 · P2 · 切换构建类型重建对象导致草稿丢失

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `packages/theia-product/src/main/browser/kairo-run-configurations-widget.tsx`。锚点：`Build type onChange`。

**源码事实：**切换类型时替换为该类型默认 build 对象。

**用户影响：**Ant/Custom 等配置切换往返，之前输入的非默认字段不能保留。

**实现要求：**编辑器内部缓存各类型草稿；保存只序列化当前类型；不要修改持久化 schema 来存 UI 临时状态。

**验收要求：**输入 Ant 自定义目标，切 Custom 输入命令，再切回；两份草稿分别完整；取消不落盘。


### UI-13 · P2 · 只读和数字输入的编辑行为不合理

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `packages/theia-product/src/main/browser/kairo-run-configurations-widget.tsx`；`packages/theia-product/src/main/browser/kairo-remote-widget.tsx`。锚点：`field helper / port inputs`。

**源码事实：**运行配置 readonly 同时设置 disabled；部分 port onChange 立即 Number(value)，无完整输入态。

**用户影响：**只读值难以键盘聚焦复制；清空数字被转换成 0；输入中的空态/无效态被过早归一。

**实现要求：**readonly 与 disabled 分开；端口保留 raw string，提交校验整数 1..65535；错误靠近字段且 aria-describedby。

**验收要求：**只读字段可聚焦复制但不可改；清空可保留；0/65536/小数被明确拒绝；正确端口通过。


### UI-14 · P2 · 通知摘要的交互语义嵌套且展开状态不可知

**证据等级：** `code-confirmed`；本轮未实机复现。

**代码位置：** `packages/theia-product/src/main/browser/kairo-notification-center.tsx`。锚点：`NotificationCenter summary`。

**源码事实：**role=button 容器内嵌关闭 button；键盘只处理 Enter；无 aria-expanded/controls；类别图标函数返回 $(error) 一类字符串直接放 span。

**用户影响：**键盘关闭动作可能冒泡到摘要，展开状态不清晰；图标字符串需核对最终呈现。

**实现要求：**展开按钮与关闭按钮做兄弟；采用原生 button；声明展开状态；显式渲染 codicon；已读状态通过 service 方法发事件。

**验收要求：**Enter/Space 展开与收起；关闭按钮不触发展开；长通知、无详情、错误详情分别截图；不出现原样图标占位符。


### UI-15 · P2 · SQL 历史弹层可能被面板边界裁切

**证据等级：** `runtime-risk`；本轮未实机复现。

**代码位置：** `packages/theia-product/src/main/browser/kairo-sql-console-widget.tsx`；`packages/ui-kit/src/browser/kairo-theme.css`。锚点：`history dropdown / .kairo-sql-* overflow chain`。

**源码事实：**弹层 position:absolute、z-index:10；相关面板祖先 overflow:hidden；其自身有最小宽度。

**用户影响：**侧栏/底栏变窄或触发器靠边时，存在菜单出界/被裁切风险；尚无当前实机截图证实。

**实现要求：**优先现有 overlay 服务；否则 portal 到正确模态层，测量定位并 flip/shift；不以单纯增大 z-index 解决裁切。

**验收要求：**拖窄容器、触发器贴右/下边缘，展开历史；截图四个边界；Esc 关闭并还原焦点。


### UI-16 · P2 · 部分名义主题色对比度不足

**证据等级：** `code-computed-runtime-unverified`；本轮未实机复现。

**代码位置：** `packages/ui-kit/src/browser/kairo-theme.css`。锚点：`root badge tokens / .kairo-git-staged-count`。

**源码事实：**不透明白字 #fff 对 #4a9eff 计算为 2.754:1；对白字 #f04757 为 3.656:1。

**用户影响：**对普通小字号有效信息不够清晰；该结论是指定色值的计算，不等同于实际 computed style 测量。

**实现要求：**按语义色对成组调整并覆盖深浅/高对比主题；不要只改字号或用 opacity 模糊处理；运行时复核背景合成。

**验收要求：**普通有效文本对比度至少 4.5:1；截图 Git 徽标、主按钮和错误徽标；disabled/装饰文本按标准例外单列。


### UI-17 · P2 · 面板/弹窗使用固定尺寸与 viewport 断点，容器变窄时需复核

**证据等级：** `runtime-risk`；本轮未实机复现。

**代码位置：** `packages/project-extension/src/browser/project-structure-dialog.css`；`packages/ui-kit/src/browser/kairo-theme.css`。锚点：`project structure fields / shortcuts table / wizard layout`。

**源码事实：**项目结构导航160、label160、输入max320；部分工具页响应式依赖 viewport，而 IDE 内容区域可独立收缩。

**用户影响：**整窗较宽但某个停靠区很窄时，窗口断点不一定触发；不能仅凭这些数值断言已发生错位。

**实现要求：**基于可用容器的布局：min-width:0/min-height:0、minmax(0,1fr)、容器查询或 ResizeObserver fallback；明确哪些表格允许横向滚动。

**验收要求：**窗口1440但目标工具区320/480/720；长中文和路径；实际截图验证标签/输入/按钮边缘与滚动所有权。


### UI-18 · P2 · Shell 手动像素兜底与 Lumino 几何共同管理

**证据等级：** `runtime-risk`；本轮未实机复现。

**代码位置：** `packages/theia-product/src/main/browser/kairo-shell-layout-contribution.ts`。锚点：`ensureShellFillsWindow / onStart / onStop`。

**源码事实：**resize rAF 后设置 shell absolute + px width/height；启动另有 500/2000ms 两次 setTimeout。

**用户影响：**DPI、窗口恢复或布局恢复阶段存在时序风险；这不是已实测的错位结论。

**实现要求：**保留现有高 DPI 修复意图；补宿主尺寸观测和清理；仅在必要时干预；先证明根布局契约再决定是否移除 px 兜底。

**验收要求：**Windows 100/125/150/200%、跨显示器、最大化/还原、面板拖拽；实际 OS 缩放截图，不用 CSS zoom 假装。

## 4. 页面级布局和控件策略

### 4.1 “支持拉伸”不是所有东西都出现拖拽柄

| 对象 | 本轮目标行为 | 不应采用的做法 |
|---|---|---|
| 左/右侧栏、底部工具区 | 保留 Theia 原有拖动、最小尺寸和布局恢复 | 用 CSS resize 代替 DockPanel |
| 调试栈/变量/观察，SQL 编辑/结果 | 使用内部可调整 split；支持鼠标、键盘、折叠、复位 | 固定 200px/固定 55:45 且不能调整 |
| 单行文本框 | 跟随父容器宽度；长值可选中、复制和水平移动光标 | 每个 input 添加独立自由拖动，破坏列对齐 |
| 多行文本框 | 按容器限制纵向拉伸；默认高度匹配用途 | 强制 resize:none，或 resize:both 把按钮挤走 |
| 结果表格列 | 长字段支持调宽；记忆用户宽度；表格内部允许必要横滚 | 页面整体横向滚动；为塞进一屏隐藏关键列 |
| Select/菜单 | 触发器自适应，面板有最大高度、滚动和边缘定位 | 给菜单加手工拖拽柄；所有选项强制一行展示完整 |
| 复杂项目设置弹窗 | 可选的受限缩放；内容区扩展；操作区稳定 | 只放大外框，内部仍锁死 520px |
| 简短确认弹窗 | 大小由文案和 viewport 限制决定 | 为统一风格而强制大尺寸、强制可拖大 |

### 4.2 建议的紧凑桌面控件规格

以下是本项目设计初值，不是对源码当前尺寸的描述，也不是来自某个标准的硬性规定。常规工具栏/表单控件 28px，高密度模式 24px；主体字号 13px，次要信息 12px；常规间距用 4/8/12/16px；24px 仅用于大区域分隔。图标可见大小与可点击区域分开定义，不能为了紧凑把关闭/展开按钮做成只有 10px 的命中范围。

同组控件必须共享 height、box-sizing、边框和内边距规则，不能靠给某个 input 加 `margin-top:2px` 修齐。标签列使用统一 Grid 列；错误文本落在字段下方，不改变其它字段的左边缘。多行标签按顶部或第一行基线对齐，不强制与多行输入的整体中心对齐。

只读路径保留复制能力；长路径在展示区域做省略并提供完整值查看/复制，不能靠 tooltip 作为唯一可读方式。选择项包含名称和次级路径/地址；持久化仍使用稳定 ID。旧配置引用的对象不存在时显示“对象不存在/需要重新选择”，不能悄悄把值清空或改成列表第一项。

### 4.3 单选、多选、下拉分别怎么设计

JDK 互斥选择保留 radio 语义，用整张 label 卡片增加可点击范围；复选框表示独立开关。不要把所有可选项变成只有颜色变化的 div，也不要为所谓高级感把原生控件全部替换为新依赖。

编译版本等少量固定选项可以保留原生 select；项目、服务、JDK、历史连接数量多时可用可检索选择器。组件需处理空列表、加载、错误、已选对象消失、同名不同路径、长中文、键盘确认和 Esc 退出。触发器的宽度与弹层的宽度允许不同，但弹层不得超出可见边界。

复杂表单只保留一个主保存动作。“测试连接”与“连接”、“应用”与“确定”、“运行”与“调试”应在名称、禁用原因和忙碌状态上区分；不是所有按钮都使用蓝色主按钮样式。

## 5. 代码改造设计

### 5.1 项目结构：先修层级，再修自适应

修改 `packages/project-extension/src/browser/project-structure-dialog.tsx` 和同名 CSS。把 footer 从 `.kairo-ps-body` 中移出；正常、加载和失败状态共用同一个外层骨架。下面是**结构示意，不是未经编译就可直接替换整个类的补丁**：

```tsx
return (
  <div className="kairo-ps-layout" data-testid="project-structure-layout">
    <div className="kairo-ps-body" data-testid="project-structure-body">
      {this.renderNavigation() /* 从现有 TABS 渲染提取，补键盘行为 */}
      <div className="kairo-ps-content" data-testid="project-structure-content">
        {this.renderCurrentState() /* loading / error / active tab */}
      </div>
    </div>
    {this.renderFooter()}
  </div>
);
```

建议骨架样式如下，字段细节在本页作用域内逐步迁移，不覆盖全局 `.theia-input` 或 `.dialogContent`：

```css
.kairo-project-structure-dialog .dialogContent {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.kairo-ps-layout {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  block-size: min(520px, 70vh); /* 仅初始尺寸；缩放时由对话框几何接管 */
  container-type: inline-size;
}
.kairo-ps-body {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  height: auto;
  max-height: none;
  overflow: hidden;
}
.kairo-ps-content {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px;
}
.kairo-ps-dialog-footer {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.kairo-ps-field {
  display: grid;
  grid-template-columns: minmax(112px, 144px) minmax(0, 1fr);
  gap: 8px 12px;
  align-items: start;
}
.kairo-ps-field-label { width: auto; padding-right: 0; }
.kairo-ps-field .theia-input,
.kairo-ps-field .theia-select {
  width: 100%;
  max-width: none;
  min-width: 0;
  box-sizing: border-box;
}
@container (max-width: 560px) {
  .kairo-ps-field { grid-template-columns: minmax(0, 1fr); }
  .kairo-ps-field-label { text-align: left; }
}
```

容器查询需在项目实际支持的 Electron/Chromium 上核对；不满足时用已有 ResizeObserver 能力添加局部宽度状态，不能用 `window.innerWidth` 冒充面板宽度。新增可调对话框尺寸时应解除初始 block-size 的固定约束，由几何控制器设定；不要把一个初始值永久写死。

`renderFooter()` 中，loading 时“应用/确定”禁用；`save()` 入口也拒绝 loading/saving。Apply 在无更改时禁用；OK 在无更改时可直接关闭，不必假装保存。Cancel、右上角关闭、Esc 共用草稿关闭策略；避免二者行为不同。异步保存过程不得导致取消后再次自动关闭另一个新打开的对话框，需有实例生命周期/请求序号保护。

### 5.2 运行配置：显示草稿与提交模型分离

仅在 UI 编辑层保留 raw text，不把不完整输入强行塞入最终协议类型。建议内部字段如下：

```ts
type EditorMode = 'create' | 'edit';
interface RunConfigurationDraftUi {
  mode: EditorMode;
  vmOptionsText: string;
  environmentText: string;
  httpPortText: string;
  debugPortText: string;
  dirty: boolean;
  // 为各 build 类型分别缓存 UI 草稿；仅当前类型参与最终保存。
}
```

JVM 文本框仅更新文本；保存阶段执行规范化：

```tsx
const [vmOptionsText, setVmOptionsText] = React.useState(
  () => initial.vmOptions.join('\n')
);
<textarea
  data-testid="run-config-vm-options"
  value={vmOptionsText}
  onChange={e => setVmOptionsText(e.currentTarget.value)}
/>
// submit 中，而不是 onChange 中：
const vmOptions = vmOptionsText
  .split(/\r?\n/)
  .filter(line => line.trim().length > 0);
```

不要把每行再按空格拆分，否则带空格的路径、引号参数会产生新 bug。切换编辑记录才重建表单草稿，并先处理未保存更改；不能依赖父组件每次返回的新对象引用就重置草稿。添加稳定 test id 和可访问标签，不能以 test id 代替 label。

端口用字符串保存输入态。提交阶段校验全为十进制数字、整数、范围 1..65535；与业务冲突校验联动。只读字段 `readOnly={true}` 不再自动 `disabled={true}`。构建类型切换不得清空其它类型的暂存草稿；取消编辑不得落盘。不要改动原有 run configuration schema 来保存这些 UI 细节。

### 5.3 SQL：统一执行入口，保持编辑器实例稳定

修改 `kairo-sql-console-widget.tsx`。快捷键、工具栏按钮和可能的上下文菜单都调用同一个当前执行入口。保留原 `automaticLayout`，不要每次连接状态改变就销毁重建 Monaco。

```tsx
// 下列代码放在 handleExecute 已声明之后，融入现有组件；不可复制出第二套 editor。
const executeRef = React.useRef<(() => Promise<void>) | null>(null);
React.useLayoutEffect(() => {
  executeRef.current = handleExecute;
});
// 原有 editor 初始化 effect 中注册：
const executeAction = editor.addAction({
  id: 'kairo-sql-execute',
  label: executeLabel,
  keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
  run: () => executeRef.current?.(),
});
// 现有 effect cleanup 中处理 executeAction.dispose() 和 editor.dispose()。
```

`handleExecute` 内使用同步 ref 防重入，UI busy state 用于显示；只靠 setState 后按钮禁用不足以阻止紧邻的重复快捷键。执行时连接 ID、SQL 文本必须来自同一次状态快照。断开/重连、切换连接时明确取消或拒绝旧请求的结果回写。

连接成功后，表单显示实际已连接的 endpoint，而不是允许编辑的 draft 冒充当前连接。可采用锁定连接字段后“断开再修改”，或显式 dirty + “重新连接”模式。编辑器与结果之间添加内部 split；结果表头、列宽和横滚属于结果区，不能带动整个 IDE 横滚。

### 5.4 统一内部 SplitPane，不重写 Theia 外层停靠

建议在 `packages/ui-kit/src/browser/` 新增 `resizable-split.tsx`、`resizable-split.css`、相关逻辑测试，并在现有 `index.ts` 导出。这是新增文件建议，不是声称仓库已存在该组件。先用于 debug、SQL，再按截图收益扩散；不要一次性替换所有工具页。

```ts
interface SplitLayoutState {
  schemaVersion: 1;
  ratio: number;
  collapsed: 'primary' | 'secondary' | null;
  previousRatio: number;
}
interface ResizableSplitProps {
  orientation: 'horizontal' | 'vertical'; // 指分隔条方向，避免与布局方向混淆
  primaryMinPx: number;
  secondaryMinPx: number;
  defaultRatio: number;
  storageKey: string; // workspace + widget + logical split id
  primaryLabel: string;
  primary: React.ReactNode;
  secondary: React.ReactNode;
}
```

分隔条高度/宽度从可用容器尺寸中扣除后，计算 primary 的上下界。`available < minPrimary + minSecondary` 时进入明确的折叠/受控滚动策略，不能得到负高度或 NaN。隐藏面板初始尺寸为 0 时暂停测量，显示后重新计算。临时缩小窗口导致的 clamp 不应永久覆盖用户在大屏上的期望比例。

PointerEvent + pointer capture 处理拖动，覆盖 pointercancel/lostpointercapture；requestAnimationFrame 合并 DOM 写入；拖动结束再持久化；组件销毁清理监听。分隔条可聚焦并提供 role=separator、方向、当前值、边界、名称及受控区域关联；左右/上下键改变尺寸，Home/End 到边界，恢复默认有明确入口。W3C APG 的 Window Splitter 模式可作交互参考，仍需在本项目验证。

Monaco 的布局更新只能有一个清晰的所有者：已有 automaticLayout 能处理时不要叠加无限 ResizeObserver→style→ResizeObserver 循环。日志 VirtualList 的 rowHeight 应与密度/行高一致；表格、日志不能为了截图整齐而一次性渲染全部大数据。

### 5.5 统一表单与弹层的最小公共能力

先检查 `ui-kit/src/tokens.ts` 与已有样式，增量扩展，不创建第二套互相覆盖的 tokens。公共能力建议分为：FormField（label/error/help/readonly）、ToolWindowFrame（header/body/footer/滚动所有权）、ResizableSplit、必要的弹层适配。不要一口气上大型新组件库替换 Theia。

FormField 需要稳定 id、label htmlFor、aria-invalid、aria-describedby；帮助文本和错误文本独立。radio card 的可见说明与 input 通过 label 建立关联。Tab 必须是可聚焦的真实控件，有 selected、controls 和 panel labelledby，提供符合方向的键盘移动，不能只加 role 就认为完成。

SQL 历史、提交建议、文件过滤等弹层必须使用当前模态层允许的 portal/overlay 根节点；不能不分场景全部挂到 document.body，导致弹窗 focus trap 把菜单排除。滚动/窗口变化后重算定位；先计算可用边界再翻转或偏移。Esc 关闭并恢复触发器焦点；选中项滚入可见范围。自定义历史建议列表是 listbox 还是命令 menu，应按功能选择，不能混用角色。

通知中心把“展开/收起”和“关闭通知”变成同级原生按钮；服务层新增 markRead(id) 并发 change 事件，而不是 view 直接修改通知对象。类别图标显式输出 codicon 节点。状态栏无需把每一个瞬时数据都设为 live region，避免光标坐标/计时频繁播报，改成只播报有意义的状态变化。

### 5.6 主题、间距与样式文件治理

`kairo-theme.css` 同时承载大量页面样式；不是因为文件长就一定慢或错误，但继续尾部叠加覆盖会增大回归风险。按 tokens、公共布局、forms、debug、project、sql、VCS 等逻辑逐块迁移到对应样式文件，保持导入顺序可审计。每次迁移先证明视觉等价，再做功能性布局调整；不能把拆文件与全面改色混为一个 PR。

不要全局增加 `overflow:hidden` 遮住溢出，不要全局去掉 outline，不要给所有 input/select 固定宽度，不要用 `!important` 与 Lumino 几何对抗。声明允许横滚的具体区域，例如 SQL 结果或快捷键表，而不是要求一切元素都不得超出自己文本宽度。

指定色值的不透明计算：白色对 #4a9eff 为 2.754:1，白色对 #f04757 为 3.656:1；#1e1f22 对 #4a9eff 为 5.984:1。可将后者作为配色候选而非一刀切方案。实际主题下需读取 computed style，处理透明背景后再确认。普通有效文本按 WCAG 的 4.5:1 目标，大字和非活动控件的例外要分开记录，不能为了降低失败率把正常徽标标成 disabled。

## 6. 分批实施和交付物

| PR | 改造范围 | 明确交付 | 放行条件 |
|---|---|---|---|
| UI-00 | 覆盖清单与测试分类 | 从装配入口/工厂/菜单/对话框整理 manifest；移除 UI 用例的静态兜底；建立截图目录 | 缺失页面显示未覆盖，不得变绿；不改生产布局 |
| UI-01 | 项目结构 | body/footer 分离；loading 保存锁；tab/label/radio | 四页签 + loading/error/窄窗实机截图；几何和键盘用例通过 |
| UI-02 | 运行配置 | raw draft、标题、构建草稿缓存、只读、数字校验 | 真实逐键输入与保存重开；新建/编辑截图 |
| UI-03 | SQL + 调试交互 | 最新快捷键回调、线程选择、公共 split 第一批 | 真实连接/调试夹具；按钮与快捷键结果一致；拖动/键盘截图 |
| UI-04 | 工具栏 + 通知 + 表单/弹层 | 项目列表刷新、通知结构、统一命名与定位 | 离线恢复、导入刷新、通知键盘、边缘弹层截图 |
| UI-05 | 全页面一致性 | 按 manifest 迁移布局/tokens；长内容与主题检查 | 每个可达页面至少覆盖默认和适用边界状态，不留未说明空白 |
| UI-06 | 真实 Windows/Electron 回归 | 缩放、跨屏、原生菜单/文件框、布局恢复 | OS 层截图 + renderer 截图 + 构建来源；人工审核签名 |

每个 PR 写明“保持不变的命令/API/schema”“修改的文件/函数”“修改前后操作路径”“截图文件”“自动断言”“未覆盖项”。一个问题未取得实机复现时，不得在报告中把 risk 改写成 reproduced。新截图有差异时先解释差异，不得直接批量更新基线消除红灯。

## 7. 真实截图审核方案

### 7.1 建立真正的页面覆盖清单

以 TypeScript Compiler API 扫描实际生产源码中的 WidgetFactory 注册、ReactWidget、ReactDialog、菜单/命令绑定与动态弹层创建，作为候选集；再结合装配入口和运行时可达菜单确定用户可达界面。扫描仅用于盘点，不是 UI 测试。旧布局恢复 ID、仅服务对象、无独立页面的 contribution 要注明豁免原因。

每一项至少记录：sourceFiles、entryAction、widgetOrDialogId、parentSurface、supportedStates、fixtureId、supportedHosts、locale/theme、caseIds、screenshots、reviewer、status。嵌套选择器、确认框、右键子菜单、错误弹窗必须是独立状态，不得因为归属于某个主页面就省略。

本包的 `surface-inventory.json` 是种子，必须补充运行时发现项；不能宣称清单里没有的页面就不需要测。

### 7.2 测试层级必须分开

**静态契约/单元测试**检查纯逻辑，例如 draft 解析、split 边界和命令注册。可以读源码，但报告中不得冠以“用户已操作成功”。

**真实渲染交互测试**打开实际 Theia/Electron 构建，使用页面点击、键盘、选择、拖动和滚动走流程；API 可以用于准备隔离夹具或受控错误注入，必须标记，不得通过 API 直接完成待验收的用户操作后再宣称 UI 成功。

**视觉与人工复核**保存 full-window + 目标区域图片，结合几何断言和行为结果检查。单纯保存 PNG 不是基线比较；`toHaveScreenshot` 等图像断言需要与人工批准、同环境的基线比较。图片只能证明可见状态，不能单独证明按钮功能、键盘或保存持久化。

### 7.3 屏幕与状态矩阵

所有可达页面：先在 1440×900、中文、深色、100% 内容缩放下覆盖默认状态及适用的空/错误/加载状态。存在独立内部工具区的页面，额外将其容器拖到 320/480/720 CSS px；**窗口仍宽 1440px 也要测窄工具区**。

项目结构、运行配置、SQL、组合调试、菜单和主工具栏：覆盖 1366×768、1920×1080、2560×1440，中文/英文，深色/浅色；交叉组合采用风险驱动成对覆盖，关键缺陷必须在其触发条件下单独执行。实际 Windows 100/125/150/200% 缩放和跨显示器另开桌面场景。DPR、Windows 系统缩放、浏览器/Electron 内容缩放是三个不同量，不能用 deviceScaleFactor 直接冒充系统缩放。

所有控件族覆盖 normal/hover/focus/disabled/error；可展开控件必须保存展开图。全部可能组合并非每次 PR 都跑，但缺少的组合要明确标记未覆盖，不能以一次桌面宽屏截图宣称全部兼容。

### 7.4 截图证据目录

```text
artifacts/ui-audit/<run-id>/<build-sha>/<platform-profile>/<case-id>/
  full.png
  target.png
  actual.png                 # 图像比较产物
  expected.png               # 已人工批准的同环境基线
  diff.png                   # 仅有差异时
  trace.zip
  browser-log.json
  geometry.json
  metadata.json
  review.json
```

metadata 至少记录源提交、运行包哈希、应用自报版本/构建提交、测试机器 OS、浏览器/Electron 版本、viewport、devicePixelRatio、实际系统缩放、应用缩放、主题、语言、夹具、操作步骤、截图 SHA256。只提供一个 git SHA 环境变量不能证明正在运行的二进制就是该提交；不具备构建核对证据时显式写 `appBuildVerified:false`，不能伪造来源。

review 记录问题 ID、通过/失败/未审、判断原因、审核人及日期。使用 AI 审图时也要保留输入图片、观察点和结论；自动结果不能掩盖缺图或打开失败。

### 7.5 真正的截图/布局断言示例

以下例子依赖本方案新增的 test id，不是声称当前代码已经具备这些选择器：

```ts
await expect(page.locator('#kairo-project-structure-dialog')).toBeVisible();
const body = page.getByTestId('project-structure-body');
const footer = page.getByTestId('project-structure-footer');
const [b, f] = await Promise.all([body.boundingBox(), footer.boundingBox()]);
expect(b).not.toBeNull();
expect(f).not.toBeNull();
expect(f!.y).toBeGreaterThanOrEqual(b!.y + b!.height - 1);
await expect(page.locator('#kairo-project-structure-dialog'))
  .toHaveScreenshot('project-structure-project-tab.png');
```

上述几何断言还需配合 footer 可点击/位于 viewport 内。对齐检查限于语义上应同排的控件；允许局部滚动容器内的非可见行不在 viewport 内，不能把所有屏外节点都当 bug。

```ts
const vm = page.getByTestId('run-config-vm-options');
await vm.fill('-Xms256m');
await vm.press('End');
await vm.press('Enter');
await vm.pressSequentially('-Xmx1024m');
await expect(vm).toHaveValue('-Xms256m\n-Xmx1024m');
```

不能只 `.fill('两行完整字符串')` 就认为已经测了用户输入回车，必须有单独的键盘事件。SQL 用例既要点击执行，也要按 Ctrl/Cmd+Enter；必须断言可见结果与当前连接，不能只断言执行函数名存在。

### 7.6 必测操作场景

| 用例 | 页面操作 | 必须断言 | 截图状态 |
|---|---|---|---|
| PS-01 | 打开项目结构，依次点四页签 | 内容与所选 tab 一致，按钮在底部 | 四个页签 |
| PS-02 | 延迟加载时尝试应用/确定 | 禁用且没有提交；失败不出现可保存默认表单 | loading/error |
| PS-03 | 修改后取消、Esc、关闭叉 | 相同草稿保护策略，焦点回到触发器 | dirty/确认框 |
| PS-04 | 键盘切 SDK，选择 JDK | label 可定位，单选状态正确 | 键盘焦点 |
| RUN-01 | 新建/编辑配置 | 标题正确，ID 只读可复制 | 新建/编辑 |
| RUN-02 | JVM 连续换行输入、保存重开 | 文本/参数保持正确 | 输入中/重开 |
| RUN-03 | Ant→Custom→Ant 往返 | 两类草稿保留 | 类型切换 |
| RUN-04 | 清空/输入非法端口/输入合法端口 | 中间态保留，错误就地提示 | 错误/恢复 |
| SQL-01 | 连接后按钮和快捷键执行相同 SQL | 两种入口都得到真实结果 | 连接/结果 |
| SQL-02 | 连续快捷键、断开/重连后执行 | 不重复执行；不作用于旧连接 | busy/新连接 |
| SQL-03 | 打开历史，键盘移动、Esc | 弹层不裁切、焦点恢复 | 右下角/窄区 |
| SQL-04 | 拉动编辑/结果分隔，调列宽 | 比例真实改变，内容跟随布局 | before/after |
| DBG-01 | 真实暂停后切线程 | 线程/调用栈/变量联动 | 多线程 |
| DBG-02 | 调整调用栈、变量、观察 | 鼠标/键盘都能改，边界有效 | min/max/restore |
| DBG-03 | 深对象、长表达式、求值失败 | 可展开、可复制，错误不覆盖其它行 | 长值/错误 |
| TOOL-01 | 启动离线，再通过 UI 重连 | 错误→加载→成功；选择器更新 | 三个状态 |
| TOOL-02 | 通过向导导入另一个项目 | 工具栏无需重启即可出现新项目 | 新项目列表 |
| NOTIF-01 | 展开、收起、关闭通知 | 关闭不触发展开；Space/Enter 均有效 | 展开/焦点 |
| LOG-01 | 日志流中向上滚动、恢复追尾 | 不强抢滚动；恢复后跟随最新 | 暂停/追尾 |
| LOG-02 | 长日志、过滤无结果、大量行 | 无意外全窗横滚、虚拟列表行为正确 | 长行/空过滤 |
| MENU-01 | 四角打开右键/子菜单 | 可见、无裁切、Esc 层级正确 | 各边界 |
| FORM-01 | 点击所有标签，逐个 Tab 导航 | 焦点/控件名称正确，顺序合理 | 焦点巡检 |
| LAYOUT-01 | 宽窗口下拖窄工具区 | 布局按容器改变而非只按 viewport | 320/480/720 |
| LAYOUT-02 | 最大化/还原/关闭重开工具区 | 状态栏到底、分隔位置恢复 | 前后对比 |
| DESKTOP-01 | 实际改变 Windows 缩放/跨屏 | 控件完整、窗口坐标恢复正确 | OS 层全窗口 |
| NATIVE-01 | 文件/JDK/JAR 原生选择器 | 取消、选择、焦点和长路径正确 | OS 原生弹窗 |

Git/SVN、Maven、测试树、问题、大纲、历史、书签、设置和编辑器周边界面按清单扩展，逐项录入入口和状态。不要把上表当成全部产品用例数量。

### 7.7 原生窗口与截图真实性

Playwright 的 renderer 页面截图主要覆盖网页内容。OS 原生文件选择器、某些原生下拉、Electron 原生菜单、窗口边框和跨屏缩放不能靠普通 DOM 截图完整证明，须用桌面/OS 层采集并记录同一构建。截图夹具只能使用无敏感信息的演示项目、测试数据库与假 token；不得为了产出可分享的证据把真实密码/连接口令写进日志。

不允许使用 `page.setContent`、拼装静态 HTML、隐藏出错控件、修改 CSS 后只截图“修好的假页面”、只对纯空壳截图、通过读取源码自动把失败 UI 标记为成功。必要的网络延迟/失败模拟必须记录为受控故障夹具，与真实后端端到端通过分开统计。

## 8. 质量门禁和回归边界

**自动门禁：**涉及布局的 PR 必须有对应真实页面行为用例、布局断言和截图；语法/typecheck/unit 成功不替代 UI 通过。所有新 UI case 禁止调用 expectFile/uiOrFile 作验收。只上传成功图片不够，失败要保留 trace、实际图和错误日志。现有测试配置只失败截图可保留用于一般 E2E，视觉审核套件必须额外采集成功状态的待审证据。

**人工门禁：**必须看 actual/expected/diff 三者；新基线不是自动正确；审核人确认边距、对齐、截断、可点击性、文案、焦点与状态一致。未连接调试、SQL、远程的空状态图片不能替代对应连接成功场景。

**行为回归：**不丢草稿、保存目标正确、快捷键与按钮一致、禁用有理由、恢复焦点、长内容可查看。**性能回归：**选固定机器/夹具比较拖动和滚动，确保没有全表重复渲染或编辑器反复重建；具体阈值先测基线再定，不凭空承诺 FPS 或耗时。

**兼容回归：**保留旧工作区布局、命令 ID、schema 和编辑行为；修改 tokens 不连带改变 Monaco 语法主题；同一个控件在深浅主题都能看清。

最终验收应输出：活跃界面族数量、应测状态数量、已执行数、截图已人工审核数、通过数、失败数、受阻数、明确豁免数。分母不能用“本次写了几条测试”代替全部约定范围。未执行、未连接、未审图、缺原生窗口证据不得折算为通过。

## 9. 给编码 AI 的实施约束（可直接复制）

> 你在 Qioooba/kairo-ide 上实施 UI-only 整改。先核对当前 HEAD 与审计提交 6ea00095d1d2a93c3f79ce2a15803b2f893d92ef 的差异。只修本文所列前端结构、输入交互、可访问性、内部拉伸和截图测试；不改 Java/JSP/索引/后端路线，不替换 Theia/Lumino/Monaco，不改已有命令 ID、Factory ID、持久化 schema。先做 UI-00 测试分类和覆盖清单，再分 PR 做项目结构、运行配置、SQL/调试、工具栏/通知/弹层、全页面一致性。每个问题必须定位实际代码、写能在修改前失败的行为或几何测试、修复、启动真实构建、从页面操作、保存完整截图和 trace，并逐张审图。不能用 expectFile、uiOrFile、源码正则、API-only smoke 或静态 HTML 代替 UI 通过。已有问题在新 HEAD 已修复时，提供验证证据，不能重复改坏。遇到运行环境或夹具受阻，标记 blocked，列明缺失证据，不得标记已完成。每个 PR 交付修改文件、根因、保留的不变契约、操作路径、截图索引、测试结果和剩余风险。禁止批量覆盖图片基线来消灭失败。

## 10. 来源与复核入口

代码来源统一为本报告固定提交。核心证据文件是：项目结构 TSX/CSS、运行配置 TSX、SQL TSX、组合调试 TSX、工具栏 TSX、通知 TSX、远程 TSX、Shell 布局 contribution、ARIA patch contribution、主题 CSS、UI kit 目录与日志 renderer，以及 `tests/e2e/visual-regression.cjs`、`tests/e2e/comprehensive/ch22-runconfig.spec.ts`、`campaign.ts`、`playwright.config.ts`、根 package.json。每项详细位置在 findings.json 中。

布局和交互模式参考 W3C APG（不是替代本项目的运行验证）：

`https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/`

`https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/`

文本对比度参考 WCAG 2.2 SC 1.4.3 的说明：

`https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html`

图片比较及同环境基线参考 Playwright 官方文档：

`https://playwright.dev/docs/test-snapshots`

**本报告到此仍是代码审计和可执行的实施/测试设计，不是当前版本全页面已实机审图通过的证书。**
