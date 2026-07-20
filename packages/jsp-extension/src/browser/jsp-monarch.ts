/**
 * Monarch grammar data for JSP (pure data, no imports) so unit
 * tests can load it without a DOM/Monaco environment.
 *
 * Covers the most common JSP constructs: directives, declarations,
 * scriptlets, expressions, EL, JSTL, taglib invocation. The
 * embedded Java inside scriptlets is tokenized as a single block
 * (no nested Java highlighting) — documented v1 limitation.
 */

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
