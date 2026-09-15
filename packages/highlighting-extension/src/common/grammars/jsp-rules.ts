/**
 * Robust Monarch Grammar Rules for JSP / JSP Fragments.
 * Fixes:
 *  - JSP Comment <%-- --%>
 *  - EL swallowing in body text (regex [^<$#]+)
 *  - EL #{...} and JSP expression <%= ... %> in attributes
 *  - Embedded <script> and <style>
 * Pure data/logic — no DOM or Theia UI dependencies.
 */

export interface MonarchLanguage {
  defaultToken: string;
  tokenPostfix?: string;
  ignoreCase?: boolean;
  brackets?: Array<{ open: string; close: string; token: string }>;
  tokenizer: Record<string, unknown[]>;
}

const JSTL_OPEN = /<\s*(?:c|fmt|fn|sql|x|jsp|spring|form|security|s):[a-zA-Z_][\w-]*/;
const JSTL_CLOSE = /<\/\s*(?:c|fmt|fn|sql|x|jsp|spring|form|security|s):[a-zA-Z_][\w-]*/;

export const JSP_MONARCH_RULES: MonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.jsp',

  tokenizer: {
    root: [
      // 1. Comments: JSP Comment before HTML Comment
      [/<%--/, { token: 'comment.block.jsp', next: '@jspComment' }],
      [/<!--/, { token: 'comment.block.html', next: '@htmlComment' }],

      // 2. Embedded Script and Style tags
      [/<script\b[^>]*>/, { token: 'tag', next: '@embeddedScript', nextEmbedded: 'javascript' }],
      [/<style\b[^>]*>/, { token: 'tag', next: '@embeddedStyle', nextEmbedded: 'css' }],

      // 3. JSP Delimiters
      [/<%[@]/, { token: 'tag.jsp-directive', next: '@jspDirective' }],
      [/<%!/, { token: 'tag.jsp-decl', next: '@jspDeclaration', nextEmbedded: 'java' }],
      [/<%=/, { token: 'tag.jsp-expr', next: '@jspExpression', nextEmbedded: 'java' }],
      [/<%/, { token: 'tag.jsp-scriptlet', next: '@jspScriptlet', nextEmbedded: 'java' }],

      // 4. Expression Language (${...} and #{...})
      [/\$\{/, { token: 'metatag.el', next: '@el' }],
      [/#\{/, { token: 'metatag.el', next: '@el' }],

      // 5. JSTL and Custom Taglibs
      [JSTL_OPEN, { token: 'tag.jsp-jstl', next: '@jstlOpen' }],
      [JSTL_CLOSE, { token: 'tag.jsp-jstl', next: '@tagCloseJstl' }],
      [/<\s*[a-zA-Z_][\w-]*:[a-zA-Z_][\w-]*/, { token: 'tag.jsp-taglib', next: '@taglibOpen' }],
      [/<\/\s*[a-zA-Z_][\w-]*:[a-zA-Z_][\w-]*/, { token: 'tag.jsp-taglib', next: '@tagCloseTaglib' }],

      // 6. Generic HTML / XML tags
      [/<\/\s*[a-zA-Z_][\w:.-]*/, { token: 'tag', next: '@tagClose' }],
      [/<\s*[a-zA-Z_][\w:.-]*/, { token: 'tag', next: '@tagOpen' }],
      [/<!DOCTYPE[^>]*>/i, 'metatag'],

      // 7. Body text: Stop at <, $, or # so EL expressions are not swallowed
      [/[^<\\$#]+/, ''],
      [/\$/, ''],
      [/#/, ''],
    ],

    jspComment: [
      [/--%>/, { token: 'comment.block.jsp', next: '@pop' }],
      [/[^-]+/, 'comment.block.jsp'],
      [/-/, 'comment.block.jsp'],
    ],

    htmlComment: [
      [/-->/, { token: 'comment.block.html', next: '@pop' }],
      [/[^-]+/, 'comment.block.html'],
      [/-/, 'comment.block.html'],
    ],

    embeddedScript: [
      [/<\/script\s*>/i, { token: 'tag', next: '@pop', nextEmbedded: '@pop' }],
      [/[^<]+/, ''],
      [/</, ''],
    ],

    embeddedStyle: [
      [/<\/style\s*>/i, { token: 'tag', next: '@pop', nextEmbedded: '@pop' }],
      [/[^<]+/, ''],
      [/</, ''],
    ],

    jspDirective: [
      [/%>/, { token: 'tag.jsp-directive', next: '@pop' }],
      [/\s+/, ''],
      [/\b(page|taglib|include|tag|attribute|variable)\b/, 'keyword'],
      [/[a-zA-Z_][\w-]*/, 'attribute.name'],
      [/=/, 'delimiter'],
      [/"/, { token: 'attribute.value', next: '@attrValueDq' }],
      [/'/, { token: 'attribute.value', next: '@attrValueSq' }],
      [/[^%\s=]+/, 'tag.jsp-directive'],
      [/%/, 'tag.jsp-directive'],
    ],

    jspDeclaration: [
      [/%>/, { token: 'tag.jsp-decl', next: '@pop', nextEmbedded: '@pop' }],
      [/[^%\n]+/, ''],
      [/%/, ''],
      [/\n/, 'tag.jsp-decl'],
    ],

    jspExpression: [
      [/%>/, { token: 'tag.jsp-expr', next: '@pop', nextEmbedded: '@pop' }],
      [/[^%\n]+/, ''],
      [/%/, ''],
      [/\n/, 'tag.jsp-expr'],
    ],

    jspScriptlet: [
      [/%>/, { token: 'tag.jsp-scriptlet', next: '@pop', nextEmbedded: '@pop' }],
      [/[^%\n]+/, ''],
      [/%/, ''],
      [/\n/, 'tag.jsp-scriptlet'],
    ],

    el: [
      [/\}/, { token: 'metatag.el', next: '@pop' }],
      [/\s+/, ''],
      [/\b(empty|not|and|or|true|false|null|eq|ne|lt|gt|le|ge|div|mod)\b/, 'keyword'],
      [/\b(param|paramValues|header|headerValues|cookie|initParam|pageScope|requestScope|sessionScope|applicationScope|pageContext|request|session|application|out|response|config|page)\b/, 'predefined'],
      [/"[^"]*"/, 'string'],
      [/'[^']*'/, 'string'],
      [/\d+(\.\d+)?/, 'number'],
      [/[a-zA-Z_][\w.]*/, 'identifier'],
      [/[^}\s]+/, 'metatag.el'],
    ],

    tagOpen: [
      [/\s+/, ''],
      [/\/?>/, { token: 'tag', next: '@pop' }],
      [/[a-zA-Z_:][\w:.-]*/, 'attribute.name'],
      [/=/, 'delimiter'],
      [/"/, { token: 'attribute.value', next: '@attrValueDq' }],
      [/'/, { token: 'attribute.value', next: '@attrValueSq' }],
    ],

    jstlOpen: [
      [/\s+/, ''],
      [/\/?>/, { token: 'tag.jsp-jstl', next: '@pop' }],
      [/[a-zA-Z_:][\w:.-]*/, 'attribute.name'],
      [/=/, 'delimiter'],
      [/"/, { token: 'attribute.value', next: '@attrValueDq' }],
      [/'/, { token: 'attribute.value', next: '@attrValueSq' }],
    ],

    taglibOpen: [
      [/\s+/, ''],
      [/\/?>/, { token: 'tag.jsp-taglib', next: '@pop' }],
      [/[a-zA-Z_:][\w:.-]*/, 'attribute.name'],
      [/=/, 'delimiter'],
      [/"/, { token: 'attribute.value', next: '@attrValueDq' }],
      [/'/, { token: 'attribute.value', next: '@attrValueSq' }],
    ],

    tagClose: [
      [/\s*>/, { token: 'tag', next: '@pop' }],
      [/>/, { token: 'tag', next: '@pop' }],
    ],
    tagCloseJstl: [
      [/\s*>/, { token: 'tag.jsp-jstl', next: '@pop' }],
      [/>/, { token: 'tag.jsp-jstl', next: '@pop' }],
    ],
    tagCloseTaglib: [
      [/\s*>/, { token: 'tag.jsp-taglib', next: '@pop' }],
      [/>/, { token: 'tag.jsp-taglib', next: '@pop' }],
    ],

    attrValueDq: [
      [/"/, { token: 'attribute.value', next: '@pop' }],
      [/\$\{/, { token: 'metatag.el', next: '@el' }],
      [/#\{/, { token: 'metatag.el', next: '@el' }],
      [/<%=/, { token: 'tag.jsp-expr', next: '@jspExpression', nextEmbedded: 'java' }],
      [/[^"$#<]+/, 'attribute.value'],
      [/\$/, 'attribute.value'],
      [/#/, 'attribute.value'],
      [/</, 'attribute.value'],
    ],

    attrValueSq: [
      [/'/, { token: 'attribute.value', next: '@pop' }],
      [/\$\{/, { token: 'metatag.el', next: '@el' }],
      [/#\{/, { token: 'metatag.el', next: '@el' }],
      [/<%=/, { token: 'tag.jsp-expr', next: '@jspExpression', nextEmbedded: 'java' }],
      [/[^'$#<]+/, 'attribute.value'],
      [/\$/, 'attribute.value'],
      [/#/, 'attribute.value'],
      [/</, 'attribute.value'],
    ],
  },
};
