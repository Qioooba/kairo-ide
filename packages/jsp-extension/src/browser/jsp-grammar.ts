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

import { languages } from '@theia/monaco/lib/browser';
import type { MonacoTextmateService } from '@theia/monaco/lib/browser/textmate';
// The actual API we need is monaco.languages.register; we reach
// for it via the global `monaco` exposed by Theia.

export const JSP_LANGUAGE_ID = 'jsp';

const JSP_MONARCH: any = {
  defaultToken: '',
  tokenPostfix: '.jsp',

  tokenizer: {
    root: [
      // JSP directive: <%@ ... %>
      [/<\s*%@\s*[^%]*%>/, 'tag.jsp-directive'],

      // JSP declaration: <%! ... %>
      [/<\s*%!\s*[^%]*%>/, 'tag.jsp-decl'],

      // JSP expression: <%= ... %>
      [/<\s*%=\s*[^%]*%>/, 'tag.jsp-expr'],

      // JSP scriptlet: <% ... %>
      [/<\s*%[^%]*%>/, 'tag.jsp-scriptlet'],

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
