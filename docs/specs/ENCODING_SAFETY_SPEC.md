# Kairo IDE — 编码安全规范

> 文档用途：Encoding 功能的完整行为规范  
> 负责 Agent：Agent A（后端实现）+ Agent C（前端集成）  
> 实现 Wave：Wave 3 收口阶段

---

## 0. 目标

确保 Kairo IDE 在 GBK/GB18030/UTF-8/ISO-8859-1 等编码环境下，文件打开、编辑、保存、批量转换全部字节级安全。

---

## 1. 当前问题

1. 浏览器 `TextEncoder` 只产生 UTF-8，用它验证 GBK/ISO-8859-1 是错误的（N-025）
2. `Recode` 用 `os.WriteFile` 原地覆盖，进程崩溃或磁盘满可能损坏文件（N-027）
3. `eol` 参数在协议存在，后端不处理
4. `.properties` 有 Go helper，但编辑器读写链没有接入
5. 注释声称 plain save 被拦截，但实际只注册了三个命令，无自动 detect/open/save integration

---

## 2. 目标行为

### 2.1 文件打开

```
BOM 检测 → project per-extension encoding → project default encoding → heuristic 检测
```

**实现要求**：
1. 按优先级检测编码
2. 状态栏显示 provenance（如 "GBK (detected)" vs "GBK (project default)"）
3. 检测失败时 fallback 到 UTF-8 并显示警告

### 2.2 普通保存

**规则**：保留当前编码和 EOL，不做隐式转换。

**实现要求**：
1. 记录文件打开时的编码和 EOL
2. 保存时使用相同编码，不改变 EOL
3. 如果编辑器内容包含不可表示字符，保存失败并显示错误

### 2.3 Save with Encoding

**流程**：
```
1. 用户在 UI 选择目标编码
2. 前端将 UTF-8 model text 发给 Agent 的 encoding/validate
3. Agent 用 x/text 判断目标编码可表示性
4. 如果可表示 → atomic recode
5. 如果不可表示 → 保存失败，显示不可表示字符列表，原文件不变
```

### 2.4 批量/原地 recode

**流程**：
```
1. 先写同目录临时文件（<filename>.kairo-tmp）
2. flush/sync
3. 保留原文件 mode
4. 原子替换（os.Rename）
5. 可选：保留 .bak 备份
```

**实现要求**：
- 进程崩溃或磁盘满不留下半文件
- 操作前显示预览（哪些文件要转换、目标编码）
- 用户确认后执行

### 2.5 `.properties` 文件

**两种模式**：
1. **Java 6 escaped ISO-8859-1**（默认）：`\uXXXX` escape 序列
2. **显式 UTF-8**：直接 UTF-8 编码

**实现要求**：
- 实现真实 editor round-trip test
- 打开时自动检测模式
- 保存时保持相同模式
- escape/unescape 与 Java `Properties` 类行为一致

---

## 3. 实现细则

### 3.1 Go 后端

**文件**：`runtime-agent/internal/encoding/encoding.go`

**关键函数**：

```go
// DetectEncoding 检测文件编码
func DetectEncoding(filePath string, projectConfig ProjectConfig) (EncodingResult, error)

type EncodingResult struct {
    Encoding   string  // "UTF-8", "GBK", "GB18030", "ISO-8859-1"
    BOM        bool
    Confidence float64
    Provenance string  // "bom", "project-config", "heuristic"
}

// ValidateEncoding 验证目标编码是否可表示给定文本
func ValidateEncoding(text string, targetEncoding string) (*ValidationResult, error)

type ValidationResult struct {
    OK                bool
    UnrepresentableChars []UnrepresentableChar
}

type UnrepresentableChar struct {
    Char     string
    Position int
    Line     int
    Column   int
}

// RecodeFile 原子转码文件
func RecodeFile(filePath string, targetEncoding string, targetEOL string, keepBackup bool) error
```

**实现要求**：
1. 使用 `golang.org/x/text` 进行编码检测和转换
2. 所有写入使用 `atomicfile.AtomicWrite`（temp + fsync + rename）
3. EOL 参数支持 `LF`、`CRLF`、`CR`
4. `.properties` escape/unescape 在 `encoding/properties.go` 中实现

### 3.2 前端

**文件**：`packages/encoding-extension/src/browser/encoding-service.ts`

**关键逻辑**：

```ts
// 删除伪 canEncode
// ❌ const canEncode = new TextEncoder().encode(text); // 永远 UTF-8

// 改为调用 Agent
async canEncode(text: string, targetEncoding: string): Promise<boolean> {
    const result = await this.agentClient.validateEncoding(text, targetEncoding);
    return result.ok;
}

// 保存时拦截
onSave(document: MonacoDocument, encoding: string): void {
    if (encoding === 'UTF-8') {
        // 本地 fast path
        document.save();
        return;
    }
    // 非 UTF-8：发送到 Agent 验证
    const result = await this.agentClient.validateEncoding(document.getText(), encoding);
    if (!result.ok) {
        showError('Cannot save: characters not representable in ' + encoding);
        return;
    }
    // Agent recode + atomic save
    await this.agentClient.recodeFile(document.uri, encoding, document.eol);
}
```

**实现要求**：
1. 删除 `SUPPORTS_ENCODER` 和伪 `canEncode`
2. 只保留 UTF-8 的本地 fast path
3. 其余编码由 Agent 验证
4. 普通保存自动检测并保留编码
5. Save with Encoding 提供编码选择 UI

---

## 4. 测试要求

### 4.1 字节级 round-trip 测试

```go
func TestGBKRoundTrip(t *testing.T) {
    original := []byte{0xc4, 0xe3, 0xba, 0xc3} // "你好" in GBK
    
    // 写文件
    os.WriteFile(path, original, 0644)
    
    // 检测编码
    result := DetectEncoding(path, config)
    assert.Equal(t, "GBK", result.Encoding)
    
    // 模拟编辑（UTF-8 text）
    edited := "你好世界"
    
    // 验证可表示性
    validation := ValidateEncoding(edited, "GBK")
    assert.True(t, validation.OK)
    
    // 保存
    RecodeFile(path, "GBK", "LF", false)
    
    // 验证字节
    saved, _ := os.ReadFile(path)
    assert.Equal(t, []byte{0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7}, saved)
}
```

### 4.2 不可表示字符拒绝测试

```go
func TestGBKUnrepresentableCharRejected(t *testing.T) {
    text := "Hello 😀" // emoji 不在 GBK 中
    
    validation := ValidateEncoding(text, "GBK")
    assert.False(t, validation.OK)
    assert.NotEmpty(t, validation.UnrepresentableChars)
}
```

### 4.3 原子写入测试

```go
func TestRecodeAtomicWrite(t *testing.T) {
    // 模拟磁盘满
    // 验证原文件不变
    // 验证不留下 temp 文件
}
```

### 4.4 `.properties` round-trip 测试

```go
func TestPropertiesRoundTrip(t *testing.T) {
    input := "key=\u4f60\u597d"  // Java escaped
    // parse → edit → serialize
    // 验证 escape 序列不变
}
```

---

## 5. 编码支持矩阵

| 编码 | 检测 | 打开 | 保存 | 批量转换 | 备注 |
|------|------|------|------|----------|------|
| UTF-8 | BOM / heuristic | ✅ | ✅ | ✅ | 默认 |
| UTF-8 BOM | BOM | ✅ | ✅ | ✅ | 保留 BOM |
| GBK | heuristic / project config | ✅ | ✅ | ✅ | 主要目标编码 |
| GB18030 | heuristic | ✅ | ✅ | ✅ | GBK 超集 |
| ISO-8859-1 | heuristic / project config | ✅ | ✅ | ✅ | .properties 默认 |
| UTF-16 | BOM | ✅ | ✅ | ✅ | BOM 必需 |
| Shift-JIS | heuristic | ✅ | ✅ | ❌ | 非目标但不应破坏 |
| EUC-KR | heuristic | ✅ | ✅ | ❌ | 非目标但不应破坏 |

---

## 6. 禁止行为

- 不得将非 UTF-8 文件静默转为 UTF-8
- 不得在保存时丢弃 BOM
- 不得在保存时改变 EOL（除非用户明确选择）
- 不得用 `TextEncoder` 验证非 UTF-8 编码
- 不得原地覆盖文件（必须 atomic write）