# Kairo IDE — Wave 16 详细设计文档：项目模型闭环 + Custom Build

> **文档用途**：Wave 16 开发执行手册  
> **目标**：Ant build.xml classpath 自动解析；Custom Build 命令可执行；构建-部署闭环  
> **周期**：1.5 周  
> **前置依赖**：Wave 15 基本完成（或并行开发，无强依赖）  
> **Gate**：3 种真实 Ant 项目结构自动获得正确 classpath + 补全

---

## 0. 问题现状

当前 [jdtproject/generator.go](file:///Users/qi/Documents/spaces/kairo-ide/runtime-agent/internal/jdtproject/generator.go) 生成 .classpath 的方式：
1. 从 `.kairo/project.yaml` 或 `.legacyflow/project.yaml` 读取 `libraries` 字段
2. 如果未配置，自动扫描 `lib/*.jar` 和 `WebRoot/WEB-INF/lib/*.jar`
3. 不解析 `build.xml` 中的 `<path>`、`<pathelement>`、`<fileset>` 定义

真实遗留项目问题：
- 很多项目的 jar 不在 `lib/` 或 `WEB-INF/lib/`，而是在自定义目录（如 `WebRoot/WEB-INF/lib/`、`third-party/`、`deploy/`）
- classpath 通过 Ant 的 `<path id="...">` 定义，可能包含 `<fileset dir="lib" includes="**/*.jar"/>`
- 有些 jar 通过 `${property}` 变量引用不同路径

---

## 1. Ant build.xml Classpath 解析器设计

### 1.1 解析范围（v1 覆盖 90% 场景）

**支持**：
```xml
<!-- 属性定义 -->
<property name="src.dir" value="src"/>
<property name="webroot" value="WebRoot"/>
<property file="build.properties"/>

<!-- 路径定义 -->
<path id="compile.classpath">
  <pathelement location="${webroot}/WEB-INF/classes"/>
  <pathelement path="${java.class.path}"/>
  <fileset dir="${webroot}/WEB-INF/lib" includes="**/*.jar"/>
  <fileset dir="lib" includes="*.jar" excludes="servlet-api.jar,jsp-api.jar"/>
</path>

<!-- 编译任务引用路径 -->
<javac srcdir="${src.dir}" destdir="${build.dir}" classpathref="compile.classpath"/>

<!-- 导入其他 build.xml -->
<import file="../common/build-common.xml"/>
```

**暂不支持（降级处理）**：
- `<pathconvert>` 复杂路径转换
- 自定义 Ant 任务定义的 path
- 条件路径（`<condition>` 内的 path）
- Maven Ant 任务的依赖管理

### 1.2 模块结构

```
runtime-agent/internal/antpath/
├── parser.go           // XML 解析：构建 AST
├── resolver.go         // 属性解析 + 路径展开 + 模式匹配
├── model.go            // 数据结构：BuildProject, Path, FileSet
├── detector.go         // 检测哪个 path 是编译 classpath
├── parser_test.go      // 测试各种 build.xml 结构
├── resolver_test.go
└── detector_test.go
```

#### model.go 数据结构：

```go
package antpath

type BuildProject struct {
    Name       string
    Default    string
    Basedir    string
    Properties map[string]string      // name → value
    Paths      map[string]*AntPath    // id → path
    Imports    []Import
    Targets    map[string]*Target
}

type AntPath struct {
    ID        string
    Location  []string   // pathelement location
    Path      []string   // pathelement path（分号/冒号分隔的路径列表）
    FileSets  []FileSet
    PathRefs  []string   // 引用其他 path 的 id（path refid="..."）
}

type FileSet struct {
    Dir      string
    Includes []string   // 支持 **/*.jar, *.jar 等
    Excludes []string
}

type Import struct {
    File     string
    Optional bool  // <import optional="true">
}

type Target struct {
    Name         string
    Depends      []string
    JavacTasks   []JavacTask
}

type JavacTask struct {
    SrcDir      string
    DestDir     string
    ClasspathRef string    // 如果用 classpathref="..."
    Source      string
    Target      string
}

type ResolveResult struct {
    Classpath    []string   // 绝对路径 jar/目录 列表
    SourceRoots  []string   // 从 srcdir 推断
    OutputDir    string     // 从 destdir 推断
    WebInfLib    []string   // 推测的 WEB-INF/lib
    Warnings     []ResolveWarning
    Properties   map[string]string  // 解析后的属性值
}

type ResolveWarning struct {
    File    string
    Line    int
    Message string
    Severity string // "warning" | "info"
}
```

#### parser.go — XML 解析：

使用标准库 `encoding/xml` 解析，自定义 Unmarshaler 处理任意子元素（类似现有 [ant_provider.go](file:///Users/qi/Documents/spaces/kairo-ide/runtime-agent/internal/provider/runtime/ant_provider.go) 的模式但更完整）。

```go
func ParseFile(path string) (*BuildProject, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }
    return Parse(data, filepath.Dir(path))
}

func Parse(data []byte, baseDir string) (*BuildProject, error) {
    // 解码 XML
    // 收集 properties
    // 收集 paths（递归展开 PathRef）
    // 收集 import（递归解析被导入文件）
    // 收集 targets 中的 javac 任务
}
```

**递归处理 import**：
- 最多递归深度 5（防止循环 import）
- imported 文件中定义的 property 和 path 合并到主项目
- 属性覆盖规则：后导入的覆盖先导入的，主 build.xml 优先级最高

#### resolver.go — 属性解析与 glob 展开：

```go
func Resolve(buildFile string) (*ResolveResult, error) {
    project, err := ParseFile(buildFile)
    if err != nil {
        return nil, err
    }

    // 1. 展开属性：${property.name} → 值
    //    - 支持 ${basedir}（自动设为 build.xml 所在目录）
    //    - 支持 ${env.JAVA_HOME} 读环境变量
    //    - 支持 ${java.home} 等系统属性（留空或从当前 JVM 推断）
    //    - 无法解析的属性保留原样并产生 warning

    // 2. 检测编译 classpath：
    //    - 查找名为 *compile*, *classpath*, *build* 的 path id
    //    - 查找 <javac> 任务引用的 classpathref
    //    - 查找 WEB-INF/lib 的 fileset（Web 项目特征）
    compilePath := detectCompileClasspath(project)

    // 3. 展开 fileset：
    //    - dir 相对 basedir 解析
    //    - includes 模式转 filepath.Glob 匹配（**/*.jar → 递归）
    //    - excludes 模式过滤
    //    - 返回所有匹配的绝对路径

    // 4. 推断 source roots 和 output dir
    sourceRoots, outputDir := detectSourceAndOutput(project)

    return &ResolveResult{
        Classpath:   resolveAllJars(compilePath, project),
        SourceRoots: sourceRoots,
        OutputDir:   outputDir,
        Properties:  project.ResolvedProperties(),
    }, nil
}
```

**glob 匹配实现**：
- `*.jar` → 当前目录下所有 .jar
- `**/*.jar` → 递归所有子目录下 .jar
- `xxx*.jar` → 前缀匹配
- 多个 includes 取并集，excludes 取差集
- 目录不存在时不报错，产生 warning

#### detector.go — 智能检测编译 classpath：

```go
func detectCompileClasspath(p *BuildProject) *AntPath {
    // 优先级 1：javac 任务直接引用的 classpathref
    for _, target := range p.Targets {
        for _, javac := range target.JavacTasks {
            if javac.ClasspathRef != "" {
                if cp, ok := p.Paths[javac.ClasspathRef]; ok {
                    return cp
                }
            }
            // javac 内部直接定义的 classpath（内联 path）
            if javac.InlineClasspath != nil {
                return javac.InlineClasspath
            }
        }
    }

    // 优先级 2：名称匹配的 path id
    namePatterns := []string{
        "compile.classpath", "compile-classpath",
        "classpath", "build.classpath",
        "cp", "javac.classpath",
        "project.classpath",
    }
    for _, name := range namePatterns {
        if cp, ok := p.Paths[name]; ok {
            return cp
        }
        // 包含匹配：名称含 "classpath" 且长度最短
    }

    // 优先级 3：包含 WEB-INF/lib 的 path（Web 项目）
    for _, cp := range p.Paths {
        for _, fs := range cp.FileSets {
            if strings.Contains(fs.Dir, "WEB-INF/lib") {
                return cp
            }
        }
    }

    // 未找到，返回 nil（降级到目录扫描）
    return nil
}
```

---

### 1.3 集成到 jdtproject.Generator

修改 [generator.go](file:///Users/qi/Documents/spaces/kairo-ide/runtime-agent/internal/jdtproject/generator.go)：

```go
func (g *Generator) Generate(payload []byte) (GenerateResult, error) {
    // ... 现有逻辑 ...

    // 新增：尝试从 build.xml 自动解析 classpath
    antResult, antErr := g.tryResolveAntClasspath(rootAbs)
    if antErr == nil && antResult != nil && len(antResult.Classpath) > 0 {
        // 使用 Ant 解析结果
        // 合并：Ant 解析的 jar + 用户 YAML 显式指定的（用户配置覆盖）
        libs = mergeAntClasspath(libs, antResult.Classpath, proj.Libraries)
        classpathSource = "ant"

        // 如果 YAML 没指定 sourceRoots，从 Ant 推断
        if len(proj.SourceRoots) == 0 && len(antResult.SourceRoots) > 0 {
            srcRoots = antResult.SourceRoots
        }
        // 如果 YAML 没指定 outputDir，从 Ant 推断
        if proj.OutputDir == "build/classes" && antResult.OutputDir != "" {
            outputAbs = antResult.OutputDir
        }
    } else {
        classpathSource = "autodetect"
        if antErr != nil {
            // 记录 warning，不失败
            warnings = append(warnings, antErr.Error())
        }
        // 降级到现有逻辑：自动扫描 lib/ 和 WEB-INF/lib/
    }

    // ... 继续生成 .classpath ...
}

func (g *Generator) tryResolveAntClasspath(rootAbs string) (*antpath.ResolveResult, error) {
    // 查找 build.xml（支持根目录或子目录）
    candidates := []string{
        filepath.Join(rootAbs, "build.xml"),
        filepath.Join(rootAbs, "build", "build.xml"),
    }
    for _, buildFile := range candidates {
        if _, err := os.Stat(buildFile); err == nil {
            return antpath.Resolve(buildFile)
        }
    }
    return nil, fmt.Errorf("no build.xml found")
}
```

**合并策略**：
1. 如果用户在 `.kairo/project.yaml` 中显式配置了 `libraries`，以用户配置为准
2. 否则使用 Ant 解析结果
3. Ant 解析结果 + 自动扫描结果取并集（去重）
4. Servlet API 和 JSTL 仍由 generator 添加（避免遗漏）

---

## 2. HTTP API 新增

### GET /api/v1/ant/classpath/analyze

触发 build.xml 解析（测试/诊断用，不修改项目模型）：

**请求**：
```json
{
  "projectRoot": "/path/to/project",
  "buildFile": "build.xml"  // 可选，默认自动查找
}
```

**响应**：
```json
{
  "success": true,
  "buildFile": "/path/to/project/build.xml",
  "classpath": [
    "/path/to/WebRoot/WEB-INF/lib/jstl-1.2.jar",
    "/path/to/lib/servlet-api-2.5.jar",
    "/path/to/build/classes"
  ],
  "classpathCount": 47,
  "sourceRoots": ["/path/to/src/main/java"],
  "outputDir": "/path/to/build/classes",
  "properties": {
    "src.dir": "src",
    "webroot": "WebRoot"
  },
  "warnings": [
    {
      "line": 42,
      "message": "无法解析属性 ${env.CATALINA_HOME}，忽略相关路径",
      "severity": "warning"
    }
  ],
  "pathIds": ["compile.classpath", "tomcat.classpath", "test.classpath"],
  "detectedCompilePath": "compile.classpath"
}
```

### POST /api/v1/jdtls/project 修改（已在主规划中描述）

新增字段 `autoDetectClasspath` 和 `buildFile`，响应新增 `classpathSource` 和 `warnings`。

---

## 3. 前端新增：Ant Classpath 服务

### AntClasspathService（新建）

文件：`packages/java-extension/src/browser/ant-classpath-service.ts`

```typescript
@injectable()
export class AntClasspathService {
    /**
     * 分析 build.xml 返回解析结果（用于 Project Structure 对话框展示）
     */
    async analyze(projectRoot: string): Promise<AntClasspathAnalysis>;

    /**
     * 监听 build.xml 文件变化，自动触发 JDT LS 刷新。
     * 返回 disposable 用于取消监听。
     */
    watchBuildFile(projectRoot: string): Disposable;

    /**
     * 获取当前项目 classpath 来源（ant/yaml/autodetect/manual）和警告列表
     */
    getClasspathInfo(): Promise<ClasspathInfo>;
}
```

### Project Structure 对话框（在 Wave 19 详细设计，但 Wave 16 加基础入口）

在 Problems 面板或项目上下文菜单增加"Classpath 解析问题"入口，显示 Ant 解析 warnings：
- 黄色警告图标表示有 jar 可能未找到
- 点击显示详情面板，列出未解析的路径
- 提供"在 .kairo/project.yaml 中手动添加"的快速操作

### Problems 面板集成

Ant 解析 warnings 作为 marker 显示在 Problems 面板，type: "Ant"，severity: Warning：
- 文件：build.xml
- 行号：对应 XML 行
- 消息：如"无法解析 fileset dir: ${env.CATALINA_HOME}/lib"

---

## 4. Custom Build 执行引擎

### 4.1 Go 端实现

新增文件：`runtime-agent/internal/build/custom_executor.go`

```go
package build

import (
    "context"
    "os"
    "os/exec"
    "sync"
    "syscall"
)

type CustomBuildExecutor struct {
    mu       sync.Mutex
    running  map[string]*exec.Cmd
    eventHub *events.EventHub
}

type CustomBuildConfig struct {
    BuildID      string            `json:"buildId"`
    ProjectRoot  string            `json:"projectRoot"`
    Command      string            `json:"command"`
    Args         []string          `json:"args"`
    WorkingDir   string            `json:"workingDir"`
    Env          map[string]string `json:"env"`
}

func (e *CustomBuildExecutor) Start(ctx context.Context, cfg CustomBuildConfig) error {
    e.mu.Lock()
    defer e.mu.Unlock()

    // 解析命令（支持 "ant war" 拆分为 command + args）
    cmdParts := shellSplit(cfg.Command)
    if len(cmdParts) == 0 {
        return fmt.Errorf("empty command")
    }
    exe := cmdParts[0]
    args := append(cmdParts[1:], cfg.Args...)

    cmd := exec.CommandContext(ctx, exe, args...)
    cmd.Dir = cfg.WorkingDir
    if cmd.Dir == "" {
        cmd.Dir = cfg.ProjectRoot
    }

    // 环境变量：继承系统 env + 用户配置
    cmd.Env = os.Environ()
    for k, v := range cfg.Env {
        cmd.Env = append(cmd.Env, k+"="+v)
    }

    // stdout/stderr 实时流
    stdout, _ := cmd.StdoutPipe()
    stderr, _ := cmd.StderrPipe()

    if err := cmd.Start(); err != nil {
        return fmt.Errorf("failed to start: %w", err)
    }

    e.running[cfg.BuildID] = cmd

    // 异步流处理
    go e.streamLogs(cfg.BuildID, stdout, "stdout")
    go e.streamLogs(cfg.BuildID, stderr, "stderr")

    // 等待结束
    go func() {
        err := cmd.Wait()
        e.mu.Lock()
        delete(e.running, cfg.BuildID)
        e.mu.Unlock()

        exitCode := 0
        if err != nil {
            if exitErr, ok := err.(*exec.ExitError); ok {
                exitCode = exitErr.ExitCode()
            } else {
                exitCode = -1
            }
        }
        e.eventHub.Emit(events.BuildFinish{
            BuildID:  cfg.BuildID,
            ExitCode: exitCode,
            Error:    err,
        })
    }()

    return nil
}

func (e *CustomBuildExecutor) Cancel(buildID string) error {
    e.mu.Lock()
    cmd, ok := e.running[buildID]
    e.mu.Unlock()
    if !ok {
        return fmt.Errorf("build %s not running", buildID)
    }
    // Windows: 使用 taskkill /T；Unix: syscall.SIGTERM
    return killProcessGroup(cmd)
}
```

**shellSplit**：跨平台 shell 命令分词
- Windows：调用 `cmd.exe /c command` 或解析引号
- Unix：按空格分词，支持引号包围

### 4.2 WebSocket 事件

`/ws/build/{buildId}`：

```json
// 构建开始
{"type":"start","buildId":"build-xxx","pid":12345}

// 日志行（高频）
{"type":"log","stream":"stdout","line":"Buildfile: /path/to/build.xml","ts":1721900000000}
{"type":"log","stream":"stderr","line":"warning: unmappable character","ts":1721900001000}

// 构建结束
{"type":"finish","buildId":"build-xxx","exitCode":0,"durationMs":15234}

// 用户取消
{"type":"cancel","buildId":"build-xxx"}

// 进程启动错误
{"type":"error","buildId":"build-xxx","message":"ant: command not found","code":"COMMAND_NOT_FOUND"}
```

### 4.3 前端修改

修改 [kairo-run-configurations-widget.tsx](file:///Users/qi/Documents/spaces/kairo-ide/packages/theia-product/src/main/browser/kairo-run-configurations-widget.tsx)：
- 删除 `"Stored only; this version never executes custom commands."` 注释
- Custom command 类型可选可用
- 保存时不再 disable custom command 字段

新增组件：`packages/build-extension/src/browser/kairo-custom-build-runner.tsx`
- "Run" 按钮触发执行
- 实时显示 stdout/stderr 流（在 Build Output 面板）
- Cancel 按钮终止进程
- 退出码红/绿标识

---

## 5. build.xml 文件监听

### 前端（Theia）：

使用 `FileService.watch()` 监听项目根目录下的 `build.xml`：
- 文件修改（save）后延迟 1s（debounce）触发重新解析
- 调用 `POST /api/v1/jdtls/project` 重新生成 .classpath
- 通知 JDT LS 刷新工作空间（通过 LSP `workspace/didChangeWatchedFiles`）

```typescript
// 在 AntClasspathService 中
watchBuildFile(projectRoot: string): Disposable {
    const buildXmlUri = URI.file(path.join(projectRoot, 'build.xml'));
    const watcher = this.fileService.watch(buildXmlUri.parent);
    const debouncedRefresh = debounce(async () => {
        await this.regenerateProjectModel(projectRoot);
        this.messageService.info('build.xml changed, classpath refreshed');
    }, 1000);

    return watcher.onDidFilesChanged(event => {
        for (const change of event.changes) {
            if (change.resource.path.endsWith('build.xml')) {
                debouncedRefresh();
            }
        }
    });
}
```

### Go 端（可选，双保险）：

也可在 Go Agent 端用 fsnotify 监听，但优先走前端 Theia 文件监听（已有基础设施）。

---

## 6. 文件变更清单

### 新增文件
```
runtime-agent/internal/antpath/
  ├─ model.go
  ├─ parser.go
  ├─ resolver.go
  ├─ detector.go
  ├─ parser_test.go
  ├─ resolver_test.go
  └─ detector_test.go
runtime-agent/internal/build/custom_executor.go
runtime-agent/internal/build/custom_executor_test.go
packages/java-extension/src/browser/ant-classpath-service.ts
packages/build-extension/src/browser/kairo-custom-build-runner.tsx
```

### 修改文件
```
runtime-agent/internal/jdtproject/generator.go              (集成 Ant 解析)
runtime-agent/internal/api/handlers.go                      (新增 API)
runtime-agent/internal/api/services.go                      (集成 AntClasspath + CustomBuild)
packages/theia-product/src/main/browser/kairo-run-configurations-widget.tsx (启用 custom command)
packages/theia-product/src/main/browser/kairo-problems-widget.tsx           (新增 Ant 类型)
packages/theia-product/src/main/browser/kairo-run-configuration-service.ts  (串联 custom build)
```

---

## 7. Wave 16 Gate 验收清单

| # | 验收项 | 验证方法 |
|---|--------|---------|
| 1 | legacy-sample 项目（标准 Maven 结构 src/main/java + WebRoot）自动检测成功 | 手工 |
| 2 | 真实项目 1：Ant 项目 jar 在 lib/*.jar，自动识别所有 jar | 真实项目测试 |
| 3 | 真实项目 2：Ant 项目 jar 在 WebRoot/WEB-INF/lib/*.jar + 自定义 third-party/*.jar | 真实项目测试 |
| 4 | 真实项目 3：有父 build.xml import，能递归解析 | 真实项目测试 |
| 5 | 修改 build.xml 添加新 jar 路径，保存后 5s 内补全识别新 jar | 手工 |
| 6 | 解析错误时不崩溃，显示 warnings，降级到目录扫描 | 故意错误 build.xml |
| 7 | Custom command: 执行 `ant war` 成功，stdout 实时输出 | 手工 |
| 8 | Custom command: 执行不存在的命令显示明确错误 | 手工 |
| 9 | Custom command: 执行长时间命令可 Cancel | 手工（sleep 30） |
| 10 | 解析 warnings 在 Problems 面板显示（type: Ant） | 手工 |
| 11 | Ant 解析单元测试 ≥ 30 个，覆盖常见 build.xml 模式 | CI |
| 12 | Custom Build 集成测试覆盖成功/失败/取消场景 | CI |
| 13 | 不引入新的第三方 Go 依赖（使用标准库 XML + filepath.Glob） | go.mod 检查 |

---

## 8. 测试 build.xml 样本库

在 `testdata/ant/` 下收集覆盖各种模式的 build.xml 样本：

1. `simple.xml` — 最简单的 classpath，只有 fileset
2. `with-properties.xml` — 使用 property 定义路径
3. `with-import.xml` — import 父 build.xml
4. `web-project.xml` — 典型 Web 项目（Servlet + JSTL + WEB-INF/lib）
5. `multi-path.xml` — 多个 path，javac 引用 classpathref
6. `complex-excludes.xml` — includes/excludes 复杂模式
7. `with-environment.xml` — 使用 ${env.JAVA_HOME}
8. `corrupt.xml` — XML 格式错误（验证优雅降级）

每个样本配一个 `.expected.json` 文件，断言解析出的 classpath 条目数和关键路径。
