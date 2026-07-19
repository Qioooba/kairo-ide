/**
 * Monarch grammar for JSP.
 *
 * Covers the most common JSP constructs: directives, declarations,
 * scriptlets, expressions, EL, JSTL, taglib invocation. We do
 * not attempt a full HTML/JS/CSS interleave grammar here —
 * Monaco's HTML tokenizer handles the outer embedding; the
 * JSP-specific bits are escaped into our scope.
 *
 * The grammar is registered as a Monaco language; the
 * semantic completion (taglib attrs, EL implicit objects) is
 * out of scope for v1 and is documented in MILESTONES.md.
 */

// The actual API we need is monaco.languages.register; we reach
// for it via the global `monaco` exposed by Theia.

export const JSP_LANGUAGE_ID = 'jsp';

export const JSP_MONARCH: any = {
  defaultToken: '',
  tokenPostfix: '.jsp',

  tokenizer: {
    root: [
      // Use states instead of scanning the rest of every line with four
      // overlapping `[^%]*` expressions. This is linear, supports multiline
      // blocks, and lets Monaco resume tokenization from its cached line state.
      [/<\s*%@/, { token: 'tag.jsp-directive', next: '@jspDirective' }],
      [/<\s*%!/, { token: 'tag.jsp-decl', next: '@jspDeclaration' }],
      [/<\s*%=/, { token: 'tag.jsp-expr', next: '@jspExpression' }],
      [/<\s*%/, { token: 'tag.jsp-scriptlet', next: '@jspScriptlet' }],

      // EL: ${ ... } and #{ ... } (deprecated JSP EL)
      [/\$\{[^}]*\}/, 'metatag.el'],
      [/#\{[^}]*\}/, 'metatag.el'],

      // JSTL tags: <c:if, <c:forEach, ...
      [/<\s*(c:if|c:forEach|c:choose|c:when|c:otherwise|c:set|c:out|c:url|c:param|c:import|c:redirect)\b/, 'tag.jsp-jstl'],

      // JSP taglib invocation: <k:hello>
      [/<\s*[a-zA-Z_][\w-]*:[a-zA-Z_][\w-]*/, 'tag.jsp-taglib'],

      // Standard HTML
      [/<\/?\s*[a-zA-Z][\w-]*/, 'tag'],
      [/\/?>/, 'tag'],
      [/<\/\s*[a-zA-Z][\w-]*\s*>/, 'tag'],

      // Numbers
      [/\b\d+\b/, 'number'],
    ],
    jspDirective: [
      [/%>/, { token: 'tag.jsp-directive', next: '@pop' }],
      [/[^%]+/, 'tag.jsp-directive'],
      [/%/, 'tag.jsp-directive'],
    ],
    jspDeclaration: [
      [/%>/, { token: 'tag.jsp-decl', next: '@pop' }],
      [/[^%]+/, 'tag.jsp-decl'],
      [/%/, 'tag.jsp-decl'],
    ],
    jspExpression: [
      [/%>/, { token: 'tag.jsp-expr', next: '@pop' }],
      [/[^%]+/, 'tag.jsp-expr'],
      [/%/, 'tag.jsp-expr'],
    ],
    jspScriptlet: [
      [/%>/, { token: 'tag.jsp-scriptlet', next: '@pop' }],
      [/[^%]+/, 'tag.jsp-scriptlet'],
      [/%/, 'tag.jsp-scriptlet'],
    ],
  },
};

export function registerJspLanguage(): void {
  const monaco = (window as any).monaco;
  if (!monaco) return;
  if (!monaco.languages.getLanguages().some((l: any) => l.id === JSP_LANGUAGE_ID)) {
    monaco.languages.register({ id: JSP_LANGUAGE_ID, extensions: ['.jsp', '.jspx', '.tag', '.tagx'], aliases: ['JSP', 'jsp'] });
  }
  monaco.languages.setMonarchTokensProvider(JSP_LANGUAGE_ID, JSP_MONARCH);
}

export function bindJspExtension(bind: any): void {
  // The actual binding happens at startup in apps/browser.
  // We expose a `start` function that registers the language.
  bind('kairo.jsp.start').toFactory(() => () => registerJspLanguage());
}
