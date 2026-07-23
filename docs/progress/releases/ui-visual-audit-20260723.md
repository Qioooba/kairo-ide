# Kairo IDE UI 视觉规范验证报告

**生成时间：** 2026/7/23 13:46:45
**扫描范围：** packages/ 下所有 CSS (.css) 和 TSX (.tsx) 文件
**CSS 文件数：** 2
**总耗时：** 66ms

## 汇总

| 检查项 | 结果 | 问题数 |
|--------|------|--------|
| WCAG AA 正文对比度 | ✅ 通过 | 0 |
| ui-kit token 使用 | ✅ 通过 | 0 |
| 字号规范 | ✅ 通过 | 0 |
| 阴影/模糊/动画 | ✅ 通过 | 0 |
| prefers-reduced-motion | ✅ 通过 | 0 |
| 图标复用 | ✅ 通过 | 0 |
| 焦点/滚动/布局 | ✅ 通过 | 2 |
| **总计** | **7/7 通过** | |

## 1. WCAG AA 正文对比度

- **检查的颜色对：** 0
- **不合规问题：** 0

✅ 未发现高严重度对比度问题。

## 2. ui-kit token 使用

- **CSS 变量引用数：** 320
- **硬编码颜色数：** 0
- **涉及文件数：** 0

## 3. 字号规范

- **不合规字号：** 0

✅ 所有字号在规范范围内。

**规范：** 正文 13px/20px (±2px)，状态/提示 11-12px，标题 20px+

## 4. 阴影/模糊/动画

- **问题数：** 0

✅ 未发现异常阴影/模糊/动画。

## 5. prefers-reduced-motion

- **缺失文件数：** 0

✅ 所有含动画的 CSS 文件都包含 prefers-reduced-motion 媒体查询。

## 6. 图标复用

- **自定义图标引用数：** 0

✅ 未发现自定义图标引用，所有图标使用 codicon/theia 图标集。

## 7. 焦点/滚动/布局

- **问题数：** 2

| 文件 | 类型 | 详情 | 严重度 |
|------|------|------|--------|
| `packages/search-extension/src/browser/search-center.css` | fixed-height | Fixed height (12px) may cause layout shift with content overflow | low |
| `packages/ui-kit/src/browser/kairo-theme.css` | fixed-height | Fixed height (28px) may cause layout shift with content overflow | low |

---

*报告由 `scripts/audit-ui-visual.cjs` 自动生成*