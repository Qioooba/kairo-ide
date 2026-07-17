# ADR-0007 — Encoding handling (GBK, UTF-8, BOM, properties)

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Architecture

## Context

Legacy Chinese projects mix GBK (GB2312, GB18030) and UTF-8
files, sometimes with a UTF-8 BOM, sometimes without.
`properties` files are ISO-8859-1 with `\uXXXX` escapes. JSP
files are often GBK even when the rest of the project is
UTF-8. **Saving a file with the wrong encoding destroys data,
silently.**

We have seen developers lose days of work to "the IDE
auto-saved as UTF-8" bugs. The product's encoding discipline
is one of the highest-stakes parts of the UX.

## Decision

### Encoding model

Every text file in the workspace has an associated
`DocumentEncoding`:

```ts
interface DocumentEncoding {
  /** What the file is *actually* in on disk. */
  current: EncodingId;
  /** What the user has *declared* they want it to be. */
  declared?: EncodingId;
  /** How `current` was determined. */
  provenance:
    | { kind: 'bom'; encoding: 'utf-8' | 'utf-16le' | 'utf-16be' }
    | { kind: 'declared' }
    | { kind: 'detected'; confidence: number; candidates: EncodingId[] };
  /** Line endings, separately. */
  eol: 'lf' | 'crlf' | 'cr';
}
```

`EncodingId` is a string in a known set: `utf-8`, `utf-8-bom`,
`utf-16le`, `utf-16be`, `gbk`, `gb18030`, `iso-8859-1`,
`us-ascii`, plus user-registered aliases.

### Detection

1. **BOM first.** A real BOM is a hard signal.
2. **Project default.** If the project has
   `encoding.default: gbk`, treat absence of BOM as GBK.
3. **Heuristics.** For files without BOM and no project default,
   use a small Go detector:
   - Valid UTF-8 with no replacement characters? → `utf-8`.
   - High density of bytes ≥ 0x80 in patterns typical of GBK?
     → `gbk` (with `gb18030` as a superset fallback).
   - Otherwise → `iso-8859-1`, since it never errors on any
     byte sequence.
4. **Trust the file.** The detector is a *guess*. The UI shows
   the guess in the status bar, and the user can override with
   "Reopen with encoding".

### Save behavior

- **Save (Ctrl+S)** writes the file back in `current` encoding
  with the file's existing `eol`. No transformation.
- **Save with encoding** prompts for a target encoding, shows
  a transformation preview (first N bytes), warns if the
  target cannot represent the file (e.g. UTF-8 → ISO-8859-1
  with non-ASCII characters), and asks for confirmation.
- **Save copy as** writes a *new* file with the chosen
  encoding; the original is untouched.

### Properties files

- Detect by extension. If the file is `*.properties`, **always**
  read as ISO-8859-1. Display with `\uXXXX` decoded to characters
  in the editor (read-only display layer).
- On save, re-encode to ISO-8859-1 with `\uXXXX` for any
  non-ASCII character. This is what `java.util.Properties` does
  by default; we match it.
- "Save as UTF-8" is offered for files that are not under
  `src/main/resources/`. We refuse to silently re-encode.

### EOL

- Detected on first read. Stored in `DocumentEncoding.eol`.
- The user can change per-file via the status bar.
- Mixed EOL inside a single file is preserved on save.

### Encoding registry

- A workspace can declare aliases in
  `.legacyflow/project.yaml`:
  ```yaml
  encoding:
    default: gbk
    aliases:
      cp936: gbk
      ms936: gbk
  ```
- The status bar shows the file's current encoding. Hover shows
  provenance ("detected (high confidence)" / "BOM" / "declared
  by project").

## Rejected alternatives

- **Always assume UTF-8.** Rejected: this is the bug we are
  specifically avoiding.
- **Detect per-line.** Rejected: too easy to get wrong, no
  user is going to debug it.
- **Convert everything to UTF-8 on import.** Rejected: changes
  the user's bytes; sometimes legal, often not.

## Consequences

- The search engine in the Go agent must read files with their
  declared encoding, not assume UTF-8. The implementation
  uses `golang.org/x/text/encoding` and the registry above.
- The text document model in Theia is wrapped by a Kairo
  `EncodingDocument` that participates in save/load and the
  status bar.
- The agent exposes a `/api/v1/encoding/detect` endpoint that
  E2E tests use to lock in the heuristic.

## Follow-ups

- The encoding library and the alias list are reviewed when
  we add a new language (Japanese → Shift_JIS / EUC-JP).
- The detector is benchmarked in `runtime-agent/test/encoding/`.
