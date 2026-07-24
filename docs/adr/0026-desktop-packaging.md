# ADR-0026 — Desktop 打包策略

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Architecture (Session 4 — Desktop Productization)

## Context

Kairo IDE 需要支持 Windows 桌面端打包，使遗留项目开发者可以像使用传统 IDE 一样安装和使用 Kairo IDE。桌面打包是 Wave 5 (Desktop Productization) 的核心目标之一。

当前状态：
- `apps/desktop/` 目录已存在，包含 Electron 主进程代码
- `apps/browser/` 提供 Web 版本
- Desktop 与 Browser 仅在启动层分叉，业务功能不分叉
- 打包流程尚未建立

## Decision

### 1. 打包工具选择：electron-builder

使用 `electron-builder` 作为打包工具，原因：
- 与 Electron 生态深度集成
- 支持 Windows (NSIS/portable)、macOS (DMG)、Linux (AppImage/deb)
- 支持自动更新 (electron-updater)
- 支持代码签名

### 2. 打包架构

```
apps/desktop/
├── electron-builder.yml          # 打包配置
├── package.json                  # 依赖声明
├── scripts/
│   ├── build-agent.js            # Go Agent 交叉编译
│   ├── copy-browser-artifacts.js # 拷贝 browser 构建产物
│   └── copy-bundled.js           # 拷贝 bundled 资源
├── src/
│   ├── main.ts                   # Electron 主进程
│   └── preload.ts                # 预加载脚本
└── resources/
    └── bin/                      # 平台特定二进制文件
        └── .gitkeep
```

### 3. 打包流程

```
1. 构建 Go Agent
   ├── Windows: GOOS=windows GOARCH=amd64 go build -o kairo-runtime.exe
   ├── macOS:   GOOS=darwin  GOARCH=amd64 go build -o kairo-runtime
   └── Linux:   GOOS=linux   GOARCH=amd64 go build -o kairo-runtime

2. 构建前端
   └── pnpm build (生产模式)

3. 拷贝资源
   ├── copy-browser-artifacts.js → apps/desktop/dist/
   ├── copy-bundled.js           → apps/desktop/dist/bundled/
   └── build-agent.js            → apps/desktop/dist/bin/

4. 打包
   └── electron-builder --config electron-builder.yml
```

### 4. electron-builder 配置

```yaml
# electron-builder.yml
appId: com.kairo-ide.desktop
productName: Kairo IDE
directories:
  output: dist-electron
  buildResources: resources
files:
  - dist/**/*
  - bundled/**/*
  - bin/**/*
  - package.json
extraResources:
  - from: bundled/
    to: bundled/
win:
  target:
    - target: nsis
      arch: [x64]
  artifactName: Kairo-IDE-Setup-${version}.${ext}
mac:
  target:
    - target: dmg
      arch: [x64, arm64]
  artifactName: Kairo-IDE-${version}.${ext}
linux:
  target:
    - target: AppImage
      arch: [x64]
  artifactName: Kairo-IDE-${version}.${ext}
```

### 5. Desktop 与 Browser 分叉策略

| 功能 | Browser | Desktop | 说明 |
|------|---------|---------|------|
| Go Agent 启动 | 手动启动 | 自动启动 | Desktop 在 main.ts 中启动 agent |
| 端口管理 | 硬编码 | 动态分配 | Desktop 自动分配端口 |
| 自动更新 | N/A | electron-updater | Desktop 支持自动更新 |
| 文件关联 | N/A | 注册表 | Desktop 注册 `.java` 文件关联 |
| 系统托盘 | N/A | 支持 | Desktop 最小化到系统托盘 |

### 6. 当前状态

| 组件 | 状态 | 说明 |
|------|------|------|
| Desktop main | partial | 需要配置匹配 |
| Process cleanup | partial | 有 shutdown 逻辑 |
| Packaging | not_started | 需要 electron-builder 配置 |
| Code signing | not_started | 需要代码签名证书 |

## Alternatives Considered

### 替代方案 A：使用 electron-forge
`electron-forge` 是 Electron 官方推荐的打包工具，但功能不如 `electron-builder` 丰富，且社区插件生态较弱。

### 替代方案 B：使用 Tauri 替代 Electron
Tauri 使用 Rust 后端，比 Electron 更轻量。但 Tauri 需要 Rust 工具链，且与 Theia 的集成复杂度高，不适合当前阶段。

### 替代方案 C：仅提供 Browser 版本
不打包桌面端，仅提供 Web 版本。此方案工作量为零，但不满足遗留项目开发者的使用习惯（他们期望桌面 IDE 体验）。

## Consequences

### 正面影响
- 提供完整的桌面 IDE 安装体验
- 自动管理 Go Agent 生命周期
- 支持自动更新，降低维护成本
- Desktop 与 Browser 共享业务代码，减少维护成本

### 负面影响
- 打包流程复杂，需要跨平台构建环境
- 安装包体积大（约 200MB+，包含 JDT LS 和 Tomcat 6）
- 代码签名需要额外费用和证书管理
- electron-builder 的配置需要持续维护

### 后续工作
- 完成 electron-builder 配置
- 实现 Go Agent 自动启动
- 实现文件关联注册
- 实现自动更新
- 代码签名证书申请