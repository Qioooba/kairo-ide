# Large-file performance

Kairo keeps Monaco's built-in viewport rendering and model-level large-file
optimizations enabled. It adds an earlier, Kairo-specific guard because legacy
JSP and Java files can be expensive well before Monaco's built-in 20 MB / 300k
line cutoff.

## Adaptive modes

| Mode | Default trigger | Behaviour |
|------|-----------------|-----------|
| Normal | Below both large thresholds | All configured editor features |
| Large | 2M characters or 20k lines | No minimap, folding, CodeLens, inlay hints, links, occurrence/selection highlights, bracket-pair colourization, sticky scroll, or whitespace rendering |
| Huge | 10M characters or 80k lines | Large mode plus plaintext model, provider/diagnostic decorations disabled, and long-line rendering capped at 5k characters |

The status bar reports the active mode. Clicking it runs
`Large File: Toggle Full Editor Features`, which temporarily restores the
editor's original options and language for that editor only.

The thresholds are exposed as `kairo.largeFiles.*` preferences. Classification
uses the Monaco model's existing character and line counters and does not copy
the entire document into another JavaScript string.

## JSP and Java

The JSP Monarch grammar uses cached states for directives, declarations,
expressions, and scriptlets. This avoids four overlapping scans on every line
and correctly handles multiline blocks.

The production JDT LS profile disables verbose protocol tracing, argument
guessing, implementations CodeLens, and indexing references in decompiled
sources. Its heap defaults to 768 MB and can be set to 256-4096 MB with
`KAIRO_JDTLS_MAX_HEAP_MB`.

## Deliberate non-goals

Editable files are not loaded in line-range chunks. A partial Monaco model
would make undo/redo, save, line positions, diagnostics, and LSP synchronization
incorrect. Files beyond the huge threshold remain fully represented in the
model, but expensive language and presentation work is disabled.

## Regression fixtures

Release performance runs should cover 20k/80k-line JSP files, a 20k-line Java
class, GBK JSP files, and individual lines of 20k and 100k characters. Track
time-to-visible-text, keystroke latency, main-thread long tasks, tab-switch
latency, renderer heap growth, and warm JDT completion latency.
