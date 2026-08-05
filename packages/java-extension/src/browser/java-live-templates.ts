// SPDX-License-Identifier: Apache-2.0
//
// Kairo Java Live Templates — snippet-based code completions
// triggered by short prefixes (e.g. "sout" → System.out.println).
//
// Registered as a second CompletionItemProvider for the Java
// language so the JDT LS provider and the snippet provider
// coexist without conflict.
// ─────────────────────────────────────────────────────────────────
// Available Templates by Category:
//
// [Output]       sout, soutv, serr, serrv
// [Main]         psvm, psf, prsf, psfs
// [Loops]        fori, foreach, while, dowhile, forr, forin
// [Conditionals] ifn, inn, ifelse, switch, ternary
// [Exceptions]   try, trycf, thr, catch
// [Logging]      log, logi, loge, logd, logw
// [Members]      field, getter, setter, const, constructor
// [Collections]  list, map, set, queue, stream, streamFilter, streamMap
// [JDBC]         conn, ps, rs
// [Servlet]      doGet, doPost, fwd, redirect
// [Object]       tostring, equals, hashcode, clone, compareTo
// [Annotations]  override, deprec, suppress, test, before, after, beforeClass, afterClass
// [Lambda]       lambda, lambdaBody, consumer, supplier, function, predicate
// [JSP]          jspForTokens, jspIf, jspChoose, jspForEach, jspSetProperty, jspGetProperty, jspUseBean, jspInclude, jspForward, jspExpression
// [XML]          xmlDecl, xmlTag, xmlTagBody, xmlComment, xmlCDATA, xmlDTD, xmlSchema, xmlNamespace
// [Spring]       autowired, component, service, repository, controller, requestMapping, bean
// ─────────────────────────────────────────────────────────────────

import * as monaco from '@theia/monaco-editor-core';
import { Disposable } from '@theia/core/lib/common/disposable';

interface TemplateDef {
  prefix: string;
  label: string;
  insertText: string;
  detail: string;
  category?: string;
}

const TEMPLATES: TemplateDef[] = [
  // ===== Output =====
  {
    prefix: 'sout',
    label: 'sout',
    insertText: 'System.out.println(${1});',
    detail: 'Print to standard output',
    category: 'Output',
  },
  {
    prefix: 'soutv',
    label: 'soutv',
    insertText: 'System.out.println("${1:variable} = " + ${1:variable});',
    detail: 'Print variable value to standard output',
    category: 'Output',
  },
  {
    prefix: 'serr',
    label: 'serr',
    insertText: 'System.err.println(${1});',
    detail: 'Print to standard error',
    category: 'Output',
  },
  {
    prefix: 'serrv',
    label: 'serrv',
    insertText: 'System.err.println("${1:variable} = " + ${1:variable});',
    detail: 'Print variable value to standard error',
    category: 'Output',
  },
  {
    prefix: 'soutp',
    label: 'soutp',
    insertText: 'System.out.println("${1:message}");',
    detail: 'Print string message',
    category: 'Output',
  },
  {
    prefix: 'soutm',
    label: 'soutm',
    insertText: 'System.out.println("${1:methodName}");',
    detail: 'Print method name placeholder',
    category: 'Output',
  },
  {
    prefix: 'souf',
    label: 'souf',
    insertText: 'System.out.printf("${1:%s}%n", ${2:value});',
    detail: 'Printf to standard output',
    category: 'Output',
  },

  // ===== Main & Constants =====
  {
    prefix: 'psvm',
    label: 'psvm',
    insertText: 'public static void main(String[] args) {\n\t${1}\n}',
    detail: 'Main method declaration',
    category: 'Main',
  },
  {
    prefix: 'psf',
    label: 'psf',
    insertText: 'public static final ${1}',
    detail: 'Public static final constant',
    category: 'Main',
  },
  {
    prefix: 'prsf',
    label: 'prsf',
    insertText: 'private static final ${1}',
    detail: 'Private static final constant',
    category: 'Main',
  },
  {
    prefix: 'psfs',
    label: 'psfs',
    insertText: 'private static final String ${1} = "${2}";',
    detail: 'Private static final String constant',
    category: 'Main',
  },

  // ===== Loops =====
  {
    prefix: 'fori',
    label: 'fori',
    insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:limit}; ${1:i}++) {\n\t${3}\n}',
    detail: 'Iterate with index',
    category: 'Loops',
  },
  {
    prefix: 'iter',
    label: 'iter',
    insertText: 'for (${1:Type} ${2:item} : ${3:collection}) {\n\t${0}\n}',
    detail: 'Iterate over collection (IDEA iter)',
    category: 'Loops',
  },
  {
    prefix: 'itin',
    label: 'itin',
    insertText: 'for (java.util.Iterator<${1:Type}> ${2:it} = ${3:collection}.iterator(); ${2:it}.hasNext(); ) {\n\t${1:Type} ${4:next} = ${2:it}.next();\n\t${0}\n}',
    detail: 'Iterate with Iterator (IDEA itin)',
    category: 'Loops',
  },
  {
    prefix: 'foreach',
    label: 'foreach',
    insertText: 'for (${1:Type} ${2:item} : ${3:collection}) {\n\t${4}\n}',
    detail: 'Iterate over collection',
    category: 'Loops',
  },
  {
    prefix: 'while',
    label: 'while',
    insertText: 'while (${1:condition}) {\n\t${2}\n}',
    detail: 'While loop',
    category: 'Loops',
  },
  {
    prefix: 'dowhile',
    label: 'dowhile',
    insertText: 'do {\n\t${1}\n} while (${2:condition});',
    detail: 'Do-while loop',
    category: 'Loops',
  },
  {
    prefix: 'forr',
    label: 'forr',
    insertText: 'for (int ${1:i} = ${2:max}; ${1:i} >= ${3:0}; ${1:i}--) {\n\t${4}\n}',
    detail: 'Reverse for loop',
    category: 'Loops',
  },
  {
    prefix: 'forin',
    label: 'forin',
    insertText: 'for (int ${1:i} = ${2:start}; ${1:i} <= ${3:end}; ${1:i}++) {\n\t${4}\n}',
    detail: 'For loop with inclusive range',
    category: 'Loops',
  },
  // ===== Conditionals =====
  {
    prefix: 'ifn',
    label: 'ifn',
    insertText: 'if (${1:var} == null) {\n\t${2}\n}',
    detail: 'If null check',
    category: 'Conditionals',
  },
  {
    prefix: 'inn',
    label: 'inn',
    insertText: 'if (${1:var} != null) {\n\t${2}\n}',
    detail: 'If not null check',
    category: 'Conditionals',
  },
  {
    prefix: 'ifelse',
    label: 'ifelse',
    insertText: 'if (${1:condition}) {\n\t${2}\n} else {\n\t${3}\n}',
    detail: 'If-else statement',
    category: 'Conditionals',
  },
  {
    prefix: 'switch',
    label: 'switch',
    insertText: 'switch (${1:key}) {\n\tcase ${2:value}:\n\t\t${3}\n\t\tbreak;\n\tdefault:\n\t\t${4}\n\t\tbreak;\n}',
    detail: 'Switch statement',
    category: 'Conditionals',
  },
  {
    prefix: 'ternary',
    label: 'ternary',
    insertText: '${1:condition} ? ${2:trueValue} : ${3:falseValue}',
    detail: 'Ternary operator',
    category: 'Conditionals',
  },

  // ===== Exception Handling =====
  {
    prefix: 'try',
    label: 'try',
    insertText: 'try {\n\t${1}\n} catch (${2:Exception} ${3:e}) {\n\t${4}\n}',
    detail: 'Try-catch block',
    category: 'Exceptions',
  },
  {
    prefix: 'trycf',
    label: 'trycf',
    insertText: 'try {\n\t${1}\n} catch (${2:Exception} ${3:e}) {\n\t${4}\n} finally {\n\t${5}\n}',
    detail: 'Try-catch-finally block',
    category: 'Exceptions',
  },
  {
    prefix: 'thr',
    label: 'thr',
    insertText: 'throw new ${1:Exception}("${2}");',
    detail: 'Throw exception',
    category: 'Exceptions',
  },
  {
    prefix: 'catch',
    label: 'catch',
    insertText: 'catch (${1:Exception} ${2:e}) {\n\t${3:logger}.error("${4}", ${2:e});\n\t${5}\n}',
    detail: 'Catch block with logging',
    category: 'Exceptions',
  },

  // ===== Logging (SLF4J) =====
  {
    prefix: 'log',
    label: 'log',
    insertText: 'private static final Logger ${1:logger} = LoggerFactory.getLogger(${2:ClassName}.class);',
    detail: 'Logger declaration (SLF4J)',
    category: 'Logging',
  },
  {
    prefix: 'logi',
    label: 'logi',
    insertText: '${1:logger}.info("${2}");',
    detail: 'Logger info',
    category: 'Logging',
  },
  {
    prefix: 'loge',
    label: 'loge',
    insertText: '${1:logger}.error("${2}", ${3:e});',
    detail: 'Logger error with exception',
    category: 'Logging',
  },
  {
    prefix: 'logd',
    label: 'logd',
    insertText: '${1:logger}.debug("${2}");',
    detail: 'Logger debug',
    category: 'Logging',
  },
  {
    prefix: 'logw',
    label: 'logw',
    insertText: '${1:logger}.warn("${2}");',
    detail: 'Logger warn',
    category: 'Logging',
  },

  // ===== Class Members =====
  {
    prefix: 'field',
    label: 'field',
    insertText: 'private ${1:Type} ${2:name};',
    detail: 'Private field',
    category: 'Members',
  },
  {
    prefix: 'getter',
    label: 'getter',
    insertText: 'public ${1:Type} get${2:Name}() {\n\treturn this.${3:field};\n}',
    detail: 'Getter method',
    category: 'Members',
  },
  {
    prefix: 'setter',
    label: 'setter',
    insertText: 'public void set${1:Name}(${1:Type} ${2:field}) {\n\tthis.${2:field} = ${2:field};\n}',
    detail: 'Setter method',
    category: 'Members',
  },
  {
    prefix: 'const',
    label: 'const',
    insertText: 'public static final ${1:Type} ${2:NAME} = ${3:value};',
    detail: 'Public constant',
    category: 'Members',
  },
  {
    prefix: 'constructor',
    label: 'constructor',
    insertText: 'public ${1:ClassName}(${2}) {\n\t${3}\n}',
    detail: 'Constructor',
    category: 'Members',
  },

  // ===== Collections =====
  {
    prefix: 'list',
    label: 'list',
    insertText: 'List<${1:Type}> ${2:list} = new ArrayList<>();',
    detail: 'New ArrayList',
    category: 'Collections',
  },
  {
    prefix: 'map',
    label: 'map',
    insertText: 'Map<${1:Key}, ${2:Value}> ${3:map} = new HashMap<>();',
    detail: 'New HashMap',
    category: 'Collections',
  },
  {
    prefix: 'set',
    label: 'set',
    insertText: 'Set<${1:Type}> ${2:set} = new HashSet<>();',
    detail: 'New HashSet',
    category: 'Collections',
  },
  {
    prefix: 'queue',
    label: 'queue',
    insertText: 'Queue<${1:Type}> ${2:queue} = new LinkedList<>();',
    detail: 'New Queue (LinkedList)',
    category: 'Collections',
  },
  {
    prefix: 'stream',
    label: 'stream',
    insertText: '${1:collection}.stream()',
    detail: 'Create stream from collection',
    category: 'Collections',
  },
  {
    prefix: 'streamFilter',
    label: 'streamFilter',
    insertText: '${1:collection}.stream().filter(${2:item} -> ${3:condition}).collect(Collectors.toList())',
    detail: 'Stream filter and collect',
    category: 'Collections',
  },
  {
    prefix: 'streamMap',
    label: 'streamMap',
    insertText: '${1:collection}.stream().map(${2:item} -> ${3:transform}).collect(Collectors.toList())',
    detail: 'Stream map and collect',
    category: 'Collections',
  },

  // ===== JDBC =====
  {
    prefix: 'conn',
    label: 'conn',
    insertText: 'Connection ${1:conn} = null;\nPreparedStatement ${2:ps} = null;\nResultSet ${3:rs} = null;\ntry {\n\t${1:conn} = DriverManager.getConnection(${4:url}, ${5:user}, ${6:password});\n\t${2:ps} = ${1:conn}.prepareStatement("${7:sql}");\n\t${3:rs} = ${2:ps}.executeQuery();\n\twhile (${3:rs}.next()) {\n\t\t${8}\n\t}\n} finally {\n\tif (${3:rs} != null) ${3:rs}.close();\n\tif (${2:ps} != null) ${2:ps}.close();\n\tif (${1:conn} != null) ${1:conn}.close();\n}',
    detail: 'JDBC connection with try-finally',
    category: 'JDBC',
  },
  {
    prefix: 'ps',
    label: 'ps',
    insertText: 'PreparedStatement ${1:ps} = ${2:conn}.prepareStatement("${3:sql}");',
    detail: 'JDBC PreparedStatement',
    category: 'JDBC',
  },
  {
    prefix: 'rs',
    label: 'rs',
    insertText: 'ResultSet ${1:rs} = ${2:ps}.executeQuery();\nwhile (${1:rs}.next()) {\n\t${3}\n}',
    detail: 'JDBC ResultSet loop',
    category: 'JDBC',
  },

  // ===== Servlet =====
  {
    prefix: 'doGet',
    label: 'doGet',
    insertText: 'protected void doGet(HttpServletRequest ${1:req}, HttpServletResponse ${2:resp}) throws ServletException, IOException {\n\t${3}\n}',
    detail: 'Servlet doGet method',
    category: 'Servlet',
  },
  {
    prefix: 'doPost',
    label: 'doPost',
    insertText: 'protected void doPost(HttpServletRequest ${1:req}, HttpServletResponse ${2:resp}) throws ServletException, IOException {\n\t${1:req}.setCharacterEncoding("UTF-8");\n\t${2:resp}.setContentType("text/html;charset=UTF-8");\n\t${3}\n}',
    detail: 'Servlet doPost method',
    category: 'Servlet',
  },
  {
    prefix: 'fwd',
    label: 'fwd',
    insertText: 'request.getRequestDispatcher("${1:/path}").forward(request, response);',
    detail: 'Servlet forward',
    category: 'Servlet',
  },
  {
    prefix: 'redirect',
    label: 'redirect',
    insertText: 'response.sendRedirect("${1:/path}");',
    detail: 'Servlet redirect',
    category: 'Servlet',
  },

  // ===== Object Methods =====
  {
    prefix: 'tostring',
    label: 'tostring',
    insertText: '@Override\npublic String toString() {\n\treturn "${1:ClassName}{" +\n\t\t${2}\n\t\t+ "}";\n}',
    detail: 'toString method',
    category: 'Object',
  },
  {
    prefix: 'equals',
    label: 'equals',
    insertText: '@Override\npublic boolean equals(Object ${1:obj}) {\n\tif (this == ${1:obj}) return true;\n\tif (${1:obj} == null || getClass() != ${1:obj}.getClass()) return false;\n\t${2:ClassName} ${3:other} = (${2:ClassName}) ${1:obj};\n\treturn ${4};\n}',
    detail: 'equals method',
    category: 'Object',
  },
  {
    prefix: 'hashcode',
    label: 'hashcode',
    insertText: '@Override\npublic int hashCode() {\n\treturn Objects.hash(${1});\n}',
    detail: 'hashCode method',
    category: 'Object',
  },
  {
    prefix: 'clone',
    label: 'clone',
    insertText: '@Override\npublic ${1:ClassName} clone() {\n\ttry {\n\t\treturn (${1:ClassName}) super.clone();\n\t} catch (CloneNotSupportedException e) {\n\t\tthrow new RuntimeException(e);\n\t}\n}',
    detail: 'clone method',
    category: 'Object',
  },
  {
    prefix: 'compareTo',
    label: 'compareTo',
    insertText: '@Override\npublic int compareTo(${1:ClassName} ${2:other}) {\n\treturn ${3};\n}',
    detail: 'compareTo method',
    category: 'Object',
  },

  // ===== Annotations & Testing =====
  {
    prefix: 'override',
    label: 'override',
    insertText: '@Override',
    detail: 'Override annotation',
    category: 'Annotations',
  },
  {
    prefix: 'deprec',
    label: 'deprec',
    insertText: '@Deprecated',
    detail: 'Deprecated annotation',
    category: 'Annotations',
  },
  {
    prefix: 'suppress',
    label: 'suppress',
    insertText: '@SuppressWarnings("${1:unchecked}")',
    detail: 'SuppressWarnings annotation',
    category: 'Annotations',
  },
  {
    prefix: 'test',
    label: 'test',
    insertText: '@Test\npublic void ${1:testMethod}() {\n\t${2}\n}',
    detail: 'JUnit test method',
    category: 'Annotations',
  },
  {
    prefix: 'before',
    label: 'before',
    insertText: '@Before\npublic void setUp() {\n\t${1}\n}',
    detail: 'JUnit setUp method',
    category: 'Annotations',
  },
  {
    prefix: 'after',
    label: 'after',
    insertText: '@After\npublic void tearDown() {\n\t${1}\n}',
    detail: 'JUnit tearDown method',
    category: 'Annotations',
  },
  {
    prefix: 'beforeClass',
    label: 'beforeClass',
    insertText: '@BeforeClass\npublic static void setUpBeforeClass() {\n\t${1}\n}',
    detail: 'JUnit @BeforeClass',
    category: 'Annotations',
  },
  {
    prefix: 'afterClass',
    label: 'afterClass',
    insertText: '@AfterClass\npublic static void tearDownAfterClass() {\n\t${1}\n}',
    detail: 'JUnit @AfterClass',
    category: 'Annotations',
  },

  // ===== Lambda & Functional =====
  {
    prefix: 'lambda',
    label: 'lambda',
    insertText: '(${1:params}) -> ${2:body}',
    detail: 'Lambda expression',
    category: 'Lambda',
  },
  {
    prefix: 'lambdaBody',
    label: 'lambdaBody',
    insertText: '(${1:params}) -> {\n\t${2}\n}',
    detail: 'Lambda with body',
    category: 'Lambda',
  },
  {
    prefix: 'consumer',
    label: 'consumer',
    insertText: 'Consumer<${1:Type}> ${2:consumer} = ${3:param} -> ${4:body};',
    detail: 'Consumer functional interface',
    category: 'Lambda',
  },
  {
    prefix: 'supplier',
    label: 'supplier',
    insertText: 'Supplier<${1:Type}> ${2:supplier} = () -> ${3:value};',
    detail: 'Supplier functional interface',
    category: 'Lambda',
  },
  {
    prefix: 'function',
    label: 'function',
    insertText: 'Function<${1:In}, ${2:Out}> ${3:func} = ${4:param} -> ${5:result};',
    detail: 'Function functional interface',
    category: 'Lambda',
  },
  {
    prefix: 'predicate',
    label: 'predicate',
    insertText: 'Predicate<${1:Type}> ${2:pred} = ${3:param} -> ${4:condition};',
    detail: 'Predicate functional interface',
    category: 'Lambda',
  },

  // ===== JSP Templates =====
  {
    prefix: 'jspForTokens',
    label: 'jspForTokens',
    insertText: '<c:forTokens items="${${1:items}}" delims="${2:,}" var="${3:token}">\n\t${4}\n</c:forTokens>',
    detail: 'JSTL forTokens tag',
    category: 'JSP',
  },
  {
    prefix: 'jspIf',
    label: 'jspIf',
    insertText: '<c:if test="${${1:condition}}">\n\t${2}\n</c:if>',
    detail: 'JSTL if tag',
    category: 'JSP',
  },
  {
    prefix: 'jspChoose',
    label: 'jspChoose',
    insertText: '<c:choose>\n\t<c:when test="${${1:condition}}">\n\t\t${2}\n\t</c:when>\n\t<c:otherwise>\n\t\t${3}\n\t</c:otherwise>\n</c:choose>',
    detail: 'JSTL choose/when/otherwise',
    category: 'JSP',
  },
  {
    prefix: 'jspForEach',
    label: 'jspForEach',
    insertText: '<c:forEach var="${1:item}" items="${${2:collection}}">\n\t${3}\n</c:forEach>',
    detail: 'JSTL forEach tag',
    category: 'JSP',
  },
  {
    prefix: 'jspSetProperty',
    label: 'jspSetProperty',
    insertText: '<jsp:setProperty name="${1:bean}" property="${2:property}" value="${3:value}" />',
    detail: 'JSP setProperty',
    category: 'JSP',
  },
  {
    prefix: 'jspGetProperty',
    label: 'jspGetProperty',
    insertText: '<jsp:getProperty name="${1:bean}" property="${2:property}" />',
    detail: 'JSP getProperty',
    category: 'JSP',
  },
  {
    prefix: 'jspUseBean',
    label: 'jspUseBean',
    insertText: '<jsp:useBean id="${1:id}" class="${2:ClassName}" scope="${3:request}" />',
    detail: 'JSP useBean',
    category: 'JSP',
  },
  {
    prefix: 'jspInclude',
    label: 'jspInclude',
    insertText: '<jsp:include page="${1:page}.jsp" />',
    detail: 'JSP include',
    category: 'JSP',
  },
  {
    prefix: 'jspForward',
    label: 'jspForward',
    insertText: '<jsp:forward page="${1:page}.jsp" />',
    detail: 'JSP forward',
    category: 'JSP',
  },
  {
    prefix: 'jspExpression',
    label: 'jspExpression',
    insertText: '<%= ${1:expression} %>',
    detail: 'JSP expression',
    category: 'JSP',
  },

  // ===== XML Templates =====
  {
    prefix: 'xmlDecl',
    label: 'xmlDecl',
    insertText: '<?xml version="1.0" encoding="UTF-8"?>',
    detail: 'XML declaration',
    category: 'XML',
  },
  {
    prefix: 'xmlTag',
    label: 'xmlTag',
    insertText: '<${1:tag}>${2}</${1:tag}>',
    detail: 'XML tag with content',
    category: 'XML',
  },
  {
    prefix: 'xmlTagBody',
    label: 'xmlTagBody',
    insertText: '<${1:tag}>\n\t${2}\n</${1:tag}>',
    detail: 'XML tag with body',
    category: 'XML',
  },
  {
    prefix: 'xmlComment',
    label: 'xmlComment',
    insertText: '<!-- ${1:comment} -->',
    detail: 'XML comment',
    category: 'XML',
  },
  {
    prefix: 'xmlCDATA',
    label: 'xmlCDATA',
    insertText: '<![CDATA[${1:content}]]>',
    detail: 'XML CDATA section',
    category: 'XML',
  },
  {
    prefix: 'xmlDTD',
    label: 'xmlDTD',
    insertText: '<!DOCTYPE ${1:root} SYSTEM "${2:file}.dtd">',
    detail: 'XML DOCTYPE declaration',
    category: 'XML',
  },
  {
    prefix: 'xmlSchema',
    label: 'xmlSchema',
    insertText: 'xsi:schemaLocation="${1:namespace} ${2:location}"',
    detail: 'XML Schema location',
    category: 'XML',
  },
  {
    prefix: 'xmlNamespace',
    label: 'xmlNamespace',
    insertText: 'xmlns:${1:prefix}="${2:uri}"',
    detail: 'XML namespace declaration',
    category: 'XML',
  },

  // ===== Spring Framework =====
  {
    prefix: 'autowired',
    label: 'autowired',
    insertText: '@Autowired\nprivate ${1:Type} ${2:bean};',
    detail: 'Spring @Autowired field',
    category: 'Spring',
  },
  {
    prefix: 'component',
    label: 'component',
    insertText: '@Component\npublic class ${1:ClassName} {\n\t${2}\n}',
    detail: 'Spring @Component class',
    category: 'Spring',
  },
  {
    prefix: 'service',
    label: 'service',
    insertText: '@Service\npublic class ${1:ClassName} {\n\t${2}\n}',
    detail: 'Spring @Service class',
    category: 'Spring',
  },
  {
    prefix: 'repository',
    label: 'repository',
    insertText: '@Repository\npublic class ${1:ClassName} {\n\t${2}\n}',
    detail: 'Spring @Repository class',
    category: 'Spring',
  },
  {
    prefix: 'controller',
    label: 'controller',
    insertText: '@Controller\npublic class ${1:ClassName} {\n\t${2}\n}',
    detail: 'Spring @Controller class',
    category: 'Spring',
  },
  {
    prefix: 'requestMapping',
    label: 'requestMapping',
    insertText: '@RequestMapping(value = "${1:/path}", method = RequestMethod.${2:GET})\npublic ${3:String} ${4:methodName}(${5}) {\n\t${6}\n}',
    detail: 'Spring @RequestMapping method',
    category: 'Spring',
  },
  {
    prefix: 'bean',
    label: 'bean',
    insertText: '@Bean\npublic ${1:Type} ${2:beanName}() {\n\treturn new ${1:Type}(${3});\n}',
    detail: 'Spring @Bean method',
    category: 'Spring',
  },
];

/** IDEA-style postfix completions: `expr.sout` → `System.out.println(expr);` */
export interface PostfixTemplateDef {
  postfix: string;
  detail: string;
  /** Build snippet insert text; `$EXPR$` is replaced with the matched expression. */
  build: (expr: string) => string;
}

export const POSTFIX_TEMPLATES: PostfixTemplateDef[] = [
  { postfix: 'sout', detail: 'Print expression', build: e => `System.out.println(${e});` },
  { postfix: 'soutv', detail: 'Print expression with label', build: e => `System.out.println("${e} = " + ${e});` },
  { postfix: 'serr', detail: 'Print expression to stderr', build: e => `System.err.println(${e});` },
  { postfix: 'var', detail: 'Introduce variable', build: e => `\${1:Type} \${2:name} = ${e};` },
  { postfix: 'val', detail: 'Introduce final variable', build: e => `final \${1:Type} \${2:name} = ${e};` },
  { postfix: 'field', detail: 'Introduce field', build: e => `\${1:Type} \${2:name} = ${e};` },
  { postfix: 'nn', detail: 'Check not null', build: e => `if (${e} != null) {\n\t$0\n}` },
  { postfix: 'null', detail: 'Check null', build: e => `if (${e} == null) {\n\t$0\n}` },
  { postfix: 'not', detail: 'Negate boolean', build: e => `!(${e})` },
  { postfix: 'notnull', detail: 'Require non-null', build: e => `Objects.requireNonNull(${e});` },
  { postfix: 'cast', detail: 'Cast expression', build: e => `((\${1:Type}) ${e})` },
  { postfix: 'par', detail: 'Parenthesize', build: e => `(${e})` },
  { postfix: 'if', detail: 'If statement', build: e => `if (${e}) {\n\t$0\n}` },
  { postfix: 'while', detail: 'While loop', build: e => `while (${e}) {\n\t$0\n}` },
  { postfix: 'return', detail: 'Return expression', build: e => `return ${e};` },
  { postfix: 'throw', detail: 'Throw expression', build: e => `throw ${e};` },
  { postfix: 'try', detail: 'Try-catch expression', build: e => `try {\n\t\${1:${e}}\n} catch (\${2:Exception} \${3:e}) {\n\t\${3:e}.printStackTrace();\n}` },
  { postfix: 'lambda', detail: 'Lambda from expression', build: e => `() -> ${e}` },
  { postfix: 'switch', detail: 'Switch on expression', build: e => `switch (${e}) {\n\tcase \${1:value}:\n\t\t$0\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}` },
  { postfix: 'assert', detail: 'Assert expression', build: e => `assert ${e} : "\${1:message}";` },
  { postfix: 'synch', detail: 'Synchronized block', build: e => `synchronized (${e}) {\n\t$0\n}` },
  { postfix: 'for', detail: 'For-each loop', build: e => `for (\${1:Type} \${2:item} : ${e}) {\n\t$0\n}` },
  { postfix: 'fori', detail: 'Indexed for loop', build: e => `for (int \${1:i} = 0; \${1:i} < ${e}.size(); \${1:i}++) {\n\t$0\n}` },
  { postfix: 'stream', detail: 'Call .stream()', build: e => `${e}.stream()` },
  { postfix: 'toList', detail: 'Collect to List', build: e => `${e}.stream().collect(java.util.stream.Collectors.toList())` },
  { postfix: 'new', detail: 'New instance', build: e => `new ${e}($0)` },
  { postfix: 'opt', detail: 'Optional.ofNullable', build: e => `Optional.ofNullable(${e})` },
  { postfix: 'orElse', detail: 'Optional.orElse', build: e => `${e}.orElse(\${1:null})` },
  { postfix: 'isempty', detail: 'Check empty', build: e => `if (${e} == null || ${e}.isEmpty()) {\n\t$0\n}` },
  { postfix: 'inst', detail: 'instanceof check', build: e => `if (${e} instanceof \${1:Type}) {\n\t\${1:Type} \${2:name} = (\${1:Type}) ${e};\n\t$0\n}` },
  { postfix: 'format', detail: 'String.format', build: e => `String.format(\${1:"%s"}, ${e})` },
  { postfix: 'reqnonnull', detail: 'Objects.requireNonNull', build: e => `Objects.requireNonNull(${e})` },
];

export interface PostfixMatch {
  expression: string;
  postfix: string;
  /** 1-based start column of the expression (inclusive). */
  expressionStartColumn: number;
}

/** Escape text embedded into Monaco InsertAsSnippet templates (JV-P3-6). */
export function escapeSnippetText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/\}/g, '\\}');
}

const POSTFIX_STOP = new Set('=;,{}?:&|!<>+-*/%^~'.split(''));

/**
 * Walk backward from a trailing `.postfix` to find the expression start,
 * respecting (), [], <> nesting and skipping simple string/char literals.
 * Handles `new Foo().sout` and `list.get(0).nn`.
 */
export function matchPostfix(linePrefix: string): PostfixMatch | undefined {
  const trailing = linePrefix.match(/\.(\w*)$/);
  if (!trailing) {
    return undefined;
  }
  const postfix = trailing[1];
  const dotIndex = linePrefix.length - trailing[0].length; // index of '.'
  if (dotIndex <= 0) {
    return undefined;
  }

  let i = dotIndex - 1;
  // Skip spaces between expr and `.` — IDEA allows `foo .sout` rarely, we allow none;
  // but allow spaces inside already-parsed calls via walker.
  while (i >= 0 && /\s/.test(linePrefix[i])) {
    i--;
  }
  if (i < 0) {
    return undefined;
  }

  let parens = 0;
  let brackets = 0;
  let angles = 0;
  let inSingle = false;
  let inDouble = false;
  let escape = false;

  for (; i >= 0; i--) {
    const ch = linePrefix[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && (inSingle || inDouble)) {
      escape = true;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) {
      continue;
    }

    if (ch === ')') {
      parens++;
      continue;
    }
    if (ch === '(') {
      if (parens === 0) {
        break;
      }
      parens--;
      continue;
    }
    if (ch === ']') {
      brackets++;
      continue;
    }
    if (ch === '[') {
      if (brackets === 0) {
        break;
      }
      brackets--;
      continue;
    }
    if (ch === '>') {
      angles++;
      continue;
    }
    if (ch === '<') {
      if (angles === 0) {
        // comparison, stop
        break;
      }
      angles--;
      continue;
    }

    if (parens === 0 && brackets === 0 && angles === 0) {
      if (POSTFIX_STOP.has(ch)) {
        break;
      }
      // Stop before keywords like `return foo.sout` → expression is `foo`
      if (/\s/.test(ch)) {
        // allow `new Foo()` — look ahead for `new`
        const before = linePrefix.slice(0, i).replace(/\s+$/, '');
        if (/\bnew$/.test(before)) {
          // include `new `
          const newIdx = before.lastIndexOf('new');
          i = newIdx - 1;
          break;
        }
        break;
      }
    }
  }

  const exprStart = i + 1;
  let expression = linePrefix.slice(exprStart, dotIndex).trim();
  if (!expression || expression.endsWith('.')) {
    return undefined;
  }
  // Reject bare package-looking tokens with no call/member when postfix empty? Allow.
  const expressionStartColumn = exprStart + 1; // 1-based
  return { expression, postfix, expressionStartColumn };
}

export interface JavaLiveTemplatesOptions {
  /** When provided, completions are only offered if this returns true. */
  shouldProvide?: (model: monaco.editor.ITextModel, position: monaco.Position) => boolean;
  /** Extra / user templates merged at query time (user prefixes override built-ins). */
  getExtraTemplates?: () => Array<{
    prefix: string;
    label: string;
    insertText: string;
    detail?: string;
    category?: string;
  }>;
}

/**
 * Register Java live-template completion items.
 *
 * Uses a separate provider from the JDT LS completion provider
 * so snippet completions are offered even when the language
 * server is not yet ready or returns an empty list.
 * Also offers IDEA-style postfix templates (`obj.sout`).
 */
export function registerJavaLiveTemplates(
  languageId: string,
  options?: JavaLiveTemplatesOptions,
): Disposable {
  return monaco.languages.registerCompletionItemProvider(languageId, {
    triggerCharacters: ['.'],
    provideCompletionItems: (model, position, _context, _token) => {
      try {
        if (options?.shouldProvide && !options.shouldProvide(model, position)) {
          return { suggestions: [] };
        }
        const word = model.getWordUntilPosition(position);
        const prefix = word.word;
        const startColumn = word.startColumn;
        const lineContent = model.getLineContent(position.lineNumber);
        const linePrefix = lineContent.substring(0, position.column - 1);

        const replaceRange = new monaco.Range(
          position.lineNumber,
          startColumn,
          position.lineNumber,
          position.column,
        );

        const suggestions: monaco.languages.CompletionItem[] = [];

        // Postfix: expr.sout → System.out.println(expr);
        const postfixMatch = matchPostfix(linePrefix);
        if (postfixMatch) {
          const lower = postfixMatch.postfix.toLowerCase();
          const escapedExpr = escapeSnippetText(postfixMatch.expression);
          for (const tpl of POSTFIX_TEMPLATES) {
            if (!tpl.postfix.startsWith(lower)) {
              continue;
            }
            const fullRange = new monaco.Range(
              position.lineNumber,
              postfixMatch.expressionStartColumn,
              position.lineNumber,
              position.column,
            );
            suggestions.push({
              label: `${postfixMatch.expression}.${tpl.postfix}`,
              kind: monaco.languages.CompletionItemKind.Snippet,
              detail: `[Postfix] ${tpl.detail}`,
              documentation: `Wrap \`${postfixMatch.expression}\` — ${tpl.detail}`,
              insertText: tpl.build(escapedExpr),
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              filterText: `${postfixMatch.expression}.${tpl.postfix}`,
              range: fullRange,
              sortText: '0' + tpl.postfix,
            });
          }
        }

        // Avoid flooding the suggest widget with every live template on
        // empty prefix (IDEA only shows them after abbreviation input).
        if (!prefix) {
          return { suggestions };
        }

        // Require at least 2 characters unless exact short classics (sout, if, …)
        const lowerPrefix = prefix.toLowerCase();
        const shortClassics = ['if', 'for', 'sout', 'psvm', 'syso'];
        if (lowerPrefix.length < 2 && !shortClassics.includes(lowerPrefix)) {
          return { suggestions };
        }

        const matches: { tpl: TemplateDef; score: number }[] = [];
        const extras = options?.getExtraTemplates?.() ?? [];
        const byPrefix = new Map<string, TemplateDef>();
        for (const tpl of TEMPLATES) {
          if (languageId === 'java' && (tpl.category === 'JSP' || tpl.category === 'XML')) {
            continue;
          }
          byPrefix.set(tpl.prefix, tpl);
        }
        for (const tpl of extras) {
          byPrefix.set(tpl.prefix, {
            prefix: tpl.prefix,
            label: tpl.label,
            insertText: tpl.insertText,
            detail: tpl.detail ?? 'User template',
            category: tpl.category ?? 'User',
          });
        }
        for (const tpl of byPrefix.values()) {
          const tplPrefixLower = tpl.prefix.toLowerCase();
          if (tplPrefixLower.startsWith(lowerPrefix)) {
            const score = tplPrefixLower === lowerPrefix ? 0 : tpl.prefix.length;
            matches.push({ tpl, score });
          }
        }

        matches.sort((a, b) => a.score - b.score || a.tpl.prefix.localeCompare(b.tpl.prefix));

        for (const { tpl } of matches) {
          suggestions.push({
            label: tpl.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: tpl.detail,
            documentation: tpl.category ? `[${tpl.category}] ${tpl.detail}` : tpl.detail,
            insertText: tpl.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            filterText: tpl.prefix,
            range: replaceRange,
            sortText: '0' + tpl.prefix,
          });
        }

        return { suggestions };
      } catch {
        return { suggestions: [] };
      }
    },
  });
}