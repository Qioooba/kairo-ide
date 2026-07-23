// SPDX-License-Identifier: Apache-2.0
//
// Kairo Java Live Templates — snippet-based code completions
// triggered by short prefixes (e.g. "sout" → System.out.println).
//
// Registered as a second CompletionItemProvider for the Java
// language so the JDT LS provider and the snippet provider
// coexist without conflict.
//
// ── Available Templates ──────────────────────────────────────────
// sout       System.out.println()
// soutv      System.out.println("variable = " + variable)
// psvm       public static void main(String[] args)
// psf        public static final
// prsf       private static final
// psfs       private static final String
// fori       for (int i = 0; i < limit; i++)
// foreach    for (Type item : collection)
// ifn        if (xx == null)
// inn        if (xx != null)
// ifelse     if-else statement
// while      while loop
// dowhile    do-while loop
// switch     switch statement
// try        try-catch block
// trycf      try-catch-finally block
// thr        throw new Exception
// log        Logger declaration (SLF4J)
// logi       Logger.info
// loge       Logger.error with exception
// logd       Logger.debug
// field      private field
// getter     getter method
// setter     setter method
// const      public static final constant
// list       new ArrayList<>
// map        new HashMap<>
// set        new HashSet<>
// conn       JDBC connection with try-finally
// doGet      Servlet doGet method
// doPost     Servlet doPost method
// fwd        Servlet forward
// redirect   Servlet redirect
// tostring   toString method
// equals     equals method
// hashcode   hashCode method
// override   @Override annotation
// test       JUnit test method
// before     JUnit setUp method
// ─────────────────────────────────────────────────────────────────

import * as monaco from '@theia/monaco-editor-core';
import { Disposable } from '@theia/core/lib/common/disposable';

interface TemplateDef {
  prefix: string;
  label: string;
  insertText: string;
  detail: string;
}

const TEMPLATES: TemplateDef[] = [
  // ===== Output =====
  {
    prefix: 'sout',
    label: 'sout',
    insertText: 'System.out.println(${1});',
    detail: 'Print to standard output',
  },
  {
    prefix: 'soutv',
    label: 'soutv',
    insertText: 'System.out.println("${1:variable} = " + ${1:variable});',
    detail: 'Print variable value to standard output',
  },

  // ===== Main & Constants =====
  {
    prefix: 'psvm',
    label: 'psvm',
    insertText: 'public static void main(String[] args) {\n\t${1}\n}',
    detail: 'Main method declaration',
  },
  {
    prefix: 'psf',
    label: 'psf',
    insertText: 'public static final ${1}',
    detail: 'Public static final constant',
  },
  {
    prefix: 'prsf',
    label: 'prsf',
    insertText: 'private static final ${1}',
    detail: 'Private static final constant',
  },
  {
    prefix: 'psfs',
    label: 'psfs',
    insertText: 'private static final String ${1} = "${2}";',
    detail: 'Private static final String constant',
  },

  // ===== Loops =====
  {
    prefix: 'fori',
    label: 'fori',
    insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:limit}; ${1:i}++) {\n\t${3}\n}',
    detail: 'Iterate with index',
  },
  {
    prefix: 'foreach',
    label: 'foreach',
    insertText: 'for (${1:Type} ${2:item} : ${3:collection}) {\n\t${4}\n}',
    detail: 'Iterate over collection',
  },
  {
    prefix: 'while',
    label: 'while',
    insertText: 'while (${1:condition}) {\n\t${2}\n}',
    detail: 'While loop',
  },
  {
    prefix: 'dowhile',
    label: 'dowhile',
    insertText: 'do {\n\t${1}\n} while (${2:condition});',
    detail: 'Do-while loop',
  },

  // ===== Conditionals =====
  {
    prefix: 'ifn',
    label: 'ifn',
    insertText: 'if (${1:condition} == null) {\n\t${2}\n}',
    detail: 'If null check',
  },
  {
    prefix: 'inn',
    label: 'inn',
    insertText: 'if (${1:condition} != null) {\n\t${2}\n}',
    detail: 'If not null check',
  },
  {
    prefix: 'ifelse',
    label: 'ifelse',
    insertText: 'if (${1:condition}) {\n\t${2}\n} else {\n\t${3}\n}',
    detail: 'If-else statement',
  },
  {
    prefix: 'switch',
    label: 'switch',
    insertText: 'switch (${1:key}) {\n\tcase ${2:value}:\n\t\t${3}\n\t\tbreak;\n\tdefault:\n\t\t${4}\n\t\tbreak;\n}',
    detail: 'Switch statement',
  },

  // ===== Exception Handling =====
  {
    prefix: 'try',
    label: 'try',
    insertText: 'try {\n\t${1}\n} catch (${2:Exception} ${3:e}) {\n\t${4}\n}',
    detail: 'Try-catch block',
  },
  {
    prefix: 'trycf',
    label: 'trycf',
    insertText: 'try {\n\t${1}\n} catch (${2:Exception} ${3:e}) {\n\t${4}\n} finally {\n\t${5}\n}',
    detail: 'Try-catch-finally block',
  },
  {
    prefix: 'thr',
    label: 'thr',
    insertText: 'throw new ${1:Exception}("${2}");',
    detail: 'Throw exception',
  },

  // ===== Logging (SLF4J) =====
  {
    prefix: 'log',
    label: 'log',
    insertText: 'private static final Logger ${1:logger} = LoggerFactory.getLogger(${2:ClassName}.class);',
    detail: 'Logger declaration (SLF4J)',
  },
  {
    prefix: 'logi',
    label: 'logi',
    insertText: '${1:logger}.info("${2}");',
    detail: 'Logger info',
  },
  {
    prefix: 'loge',
    label: 'loge',
    insertText: '${1:logger}.error("${2}", ${3:e});',
    detail: 'Logger error with exception',
  },
  {
    prefix: 'logd',
    label: 'logd',
    insertText: '${1:logger}.debug("${2}");',
    detail: 'Logger debug',
  },

  // ===== Class Members =====
  {
    prefix: 'field',
    label: 'field',
    insertText: 'private ${1:Type} ${2:name};',
    detail: 'Private field',
  },
  {
    prefix: 'getter',
    label: 'getter',
    insertText: 'public ${1:Type} get${2:Name}() {\n\treturn this.${3:field};\n}',
    detail: 'Getter method',
  },
  {
    prefix: 'setter',
    label: 'setter',
    insertText: 'public void set${1:Name}(${1:Type} ${2:field}) {\n\tthis.${2:field} = ${2:field};\n}',
    detail: 'Setter method',
  },
  {
    prefix: 'const',
    label: 'const',
    insertText: 'public static final ${1:Type} ${2:NAME} = ${3:value};',
    detail: 'Public constant',
  },

  // ===== Collections =====
  {
    prefix: 'list',
    label: 'list',
    insertText: 'List<${1:Type}> ${2:list} = new ArrayList<>();',
    detail: 'New ArrayList',
  },
  {
    prefix: 'map',
    label: 'map',
    insertText: 'Map<${1:Key}, ${2:Value}> ${3:map} = new HashMap<>();',
    detail: 'New HashMap',
  },
  {
    prefix: 'set',
    label: 'set',
    insertText: 'Set<${1:Type}> ${2:set} = new HashSet<>();',
    detail: 'New HashSet',
  },

  // ===== JDBC =====
  {
    prefix: 'conn',
    label: 'conn',
    insertText: 'Connection ${1:conn} = null;\nPreparedStatement ${2:ps} = null;\nResultSet ${3:rs} = null;\ntry {\n\t${1:conn} = DriverManager.getConnection(${4:url}, ${5:user}, ${6:password});\n\t${2:ps} = ${1:conn}.prepareStatement("${7:sql}");\n\t${3:rs} = ${2:ps}.executeQuery();\n\twhile (${3:rs}.next()) {\n\t\t${8}\n\t}\n} finally {\n\tif (${3:rs} != null) ${3:rs}.close();\n\tif (${2:ps} != null) ${2:ps}.close();\n\tif (${1:conn} != null) ${1:conn}.close();\n}',
    detail: 'JDBC connection with try-finally',
  },

  // ===== Servlet =====
  {
    prefix: 'doGet',
    label: 'doGet',
    insertText: 'protected void doGet(HttpServletRequest ${1:req}, HttpServletResponse ${2:resp}) throws ServletException, IOException {\n\t${3}\n}',
    detail: 'Servlet doGet method',
  },
  {
    prefix: 'doPost',
    label: 'doPost',
    insertText: 'protected void doPost(HttpServletRequest ${1:req}, HttpServletResponse ${2:resp}) throws ServletException, IOException {\n\t${1:req}.setCharacterEncoding("UTF-8");\n\t${2:resp}.setContentType("text/html;charset=UTF-8");\n\t${3}\n}',
    detail: 'Servlet doPost method',
  },
  {
    prefix: 'fwd',
    label: 'fwd',
    insertText: 'request.getRequestDispatcher("${1:/path}").forward(request, response);',
    detail: 'Servlet forward',
  },
  {
    prefix: 'redirect',
    label: 'redirect',
    insertText: 'response.sendRedirect("${1:/path}");',
    detail: 'Servlet redirect',
  },

  // ===== Object Methods =====
  {
    prefix: 'tostring',
    label: 'tostring',
    insertText: '@Override\npublic String toString() {\n\treturn "${1:ClassName}{" +\n\t\t${2}\n\t\t+ "}";\n}',
    detail: 'toString method',
  },
  {
    prefix: 'equals',
    label: 'equals',
    insertText: '@Override\npublic boolean equals(Object ${1:obj}) {\n\tif (this == ${1:obj}) return true;\n\tif (${1:obj} == null || getClass() != ${1:obj}.getClass()) return false;\n\t${2:ClassName} ${3:other} = (${2:ClassName}) ${1:obj};\n\treturn ${4};\n}',
    detail: 'equals method',
  },
  {
    prefix: 'hashcode',
    label: 'hashcode',
    insertText: '@Override\npublic int hashCode() {\n\treturn Objects.hash(${1});\n}',
    detail: 'hashCode method',
  },

  // ===== Annotations & Testing =====
  {
    prefix: 'override',
    label: 'override',
    insertText: '@Override',
    detail: 'Override annotation',
  },
  {
    prefix: 'test',
    label: 'test',
    insertText: '@Test\npublic void ${1:testMethod}() {\n\t${2}\n}',
    detail: 'JUnit test method',
  },
  {
    prefix: 'before',
    label: 'before',
    insertText: '@Before\npublic void setUp() {\n\t${1}\n}',
    detail: 'JUnit setUp method',
  },
];

/**
 * Register Java live-template completion items.
 *
 * Uses a separate provider from the JDT LS completion provider
 * so snippet completions are offered even when the language
 * server is not yet ready or returns an empty list.
 */
export function registerJavaLiveTemplates(languageId: string): Disposable {
  return monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: [],
    provideCompletionItems: (model, position, _context, _token) => {
      const word = model.getWordUntilPosition(position);
      const prefix = word.word;

      const suggestions: monaco.languages.CompletionItem[] = [];
      for (const tpl of TEMPLATES) {
        if (tpl.prefix === prefix) {
          const range = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          );
          suggestions.push({
            label: tpl.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: tpl.detail,
            insertText: tpl.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            filterText: tpl.prefix,
            range,
            sortText: '0' + tpl.prefix,
          });
        }
      }

      return { suggestions };
    },
  });
}