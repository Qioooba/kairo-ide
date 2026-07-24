// SPDX-License-Identifier: Apache-2.0
//
// Java IntelliSense Provider — fallback completion, definition,
// and diagnostics that work without JDT LS.
//
// When the JDT LS is not running, this provider supplies
// Java-specific completions (keywords, types, methods, variables,
// imports), basic go-to-definition via text scanning, and
// lightweight diagnostics (syntax, type, unused-variable, missing
// import detection) through regex-based analysis of the source
// text.

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';

// ── Completion ──────────────────────────────────────────────────

/** Completion item returned by the fallback provider. */
export interface JavaIntelliSenseCompletionItem {
  label: string;
  kind: number;
  detail?: string;
  documentation?: string;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  isDeprecated?: boolean;
}

/** Result of a completion request. */
export interface JavaIntelliSenseCompletionResult {
  isIncomplete: boolean;
  items: JavaIntelliSenseCompletionItem[];
}

// LSP CompletionItemKind values
const CIK = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Keyword: 14,
  Snippet: 15,
  Enum: 13,
  Constant: 21,
  TypeParameter: 25,
} as const;

// Java keywords
const JAVA_KEYWORDS: { label: string; detail: string; doc: string }[] = [
  { label: 'abstract', detail: 'abstract modifier', doc: 'Declares a class or method as abstract.' },
  { label: 'assert', detail: 'assert statement', doc: 'Tests a boolean expression.' },
  { label: 'boolean', detail: 'primitive type', doc: 'The boolean data type.' },
  { label: 'break', detail: 'break statement', doc: 'Exits a loop or switch.' },
  { label: 'byte', detail: 'primitive type', doc: 'The byte data type (8-bit signed).' },
  { label: 'case', detail: 'switch case', doc: 'Defines a case in a switch statement.' },
  { label: 'catch', detail: 'exception handler', doc: 'Catches exceptions in a try block.' },
  { label: 'char', detail: 'primitive type', doc: 'The char data type (16-bit Unicode).' },
  { label: 'class', detail: 'class declaration', doc: 'Declares a class.' },
  { label: 'continue', detail: 'continue statement', doc: 'Skips the current loop iteration.' },
  { label: 'default', detail: 'switch default', doc: 'Default case in a switch statement.' },
  { label: 'do', detail: 'do-while loop', doc: 'Executes a block at least once.' },
  { label: 'double', detail: 'primitive type', doc: 'The double data type (64-bit IEEE 754).' },
  { label: 'else', detail: 'else branch', doc: 'Alternative branch in an if statement.' },
  { label: 'enum', detail: 'enum declaration', doc: 'Declares an enumeration type.' },
  { label: 'extends', detail: 'class inheritance', doc: 'Specifies a superclass.' },
  { label: 'final', detail: 'final modifier', doc: 'Declares a constant or non-overridable member.' },
  { label: 'finally', detail: 'finally block', doc: 'Always-executed block after try-catch.' },
  { label: 'float', detail: 'primitive type', doc: 'The float data type (32-bit IEEE 754).' },
  { label: 'for', detail: 'for loop', doc: 'Iterates over a range or collection.' },
  { label: 'if', detail: 'if statement', doc: 'Conditional branch.' },
  { label: 'implements', detail: 'interface implementation', doc: 'Specifies implemented interfaces.' },
  { label: 'import', detail: 'import statement', doc: 'Imports a class or package.' },
  { label: 'instanceof', detail: 'type check', doc: 'Tests if an object is an instance of a type.' },
  { label: 'int', detail: 'primitive type', doc: 'The int data type (32-bit signed).' },
  { label: 'interface', detail: 'interface declaration', doc: 'Declares an interface.' },
  { label: 'long', detail: 'primitive type', doc: 'The long data type (64-bit signed).' },
  { label: 'native', detail: 'native modifier', doc: 'Declares a native method.' },
  { label: 'new', detail: 'object instantiation', doc: 'Creates a new object instance.' },
  { label: 'package', detail: 'package declaration', doc: 'Declares the package of a class.' },
  { label: 'private', detail: 'access modifier', doc: 'Private access — visible only within the class.' },
  { label: 'protected', detail: 'access modifier', doc: 'Protected access — visible within package and subclasses.' },
  { label: 'public', detail: 'access modifier', doc: 'Public access — visible everywhere.' },
  { label: 'return', detail: 'return statement', doc: 'Returns a value from a method.' },
  { label: 'short', detail: 'primitive type', doc: 'The short data type (16-bit signed).' },
  { label: 'static', detail: 'static modifier', doc: 'Declares a class-level member.' },
  { label: 'strictfp', detail: 'strictfp modifier', doc: 'Enforces strict floating-point evaluation.' },
  { label: 'super', detail: 'superclass reference', doc: 'Refers to the superclass.' },
  { label: 'switch', detail: 'switch statement', doc: 'Multi-way branch.' },
  { label: 'synchronized', detail: 'synchronized modifier', doc: 'Acquires a monitor lock.' },
  { label: 'this', detail: 'current instance reference', doc: 'Refers to the current instance.' },
  { label: 'throw', detail: 'throw statement', doc: 'Throws an exception.' },
  { label: 'throws', detail: 'throws clause', doc: 'Declares exceptions thrown by a method.' },
  { label: 'transient', detail: 'transient modifier', doc: 'Excludes a field from serialization.' },
  { label: 'try', detail: 'try block', doc: 'Starts a try-catch-finally block.' },
  { label: 'void', detail: 'return type', doc: 'Indicates no return value.' },
  { label: 'volatile', detail: 'volatile modifier', doc: 'Ensures field visibility across threads.' },
  { label: 'while', detail: 'while loop', doc: 'Loops while a condition is true.' },
];

// Common Java types
const JAVA_COMMON_TYPES: { label: string; detail: string; doc: string }[] = [
  { label: 'String', detail: 'java.lang.String', doc: 'Immutable sequence of characters.' },
  { label: 'Integer', detail: 'java.lang.Integer', doc: 'Wrapper class for int.' },
  { label: 'Long', detail: 'java.lang.Long', doc: 'Wrapper class for long.' },
  { label: 'Double', detail: 'java.lang.Double', doc: 'Wrapper class for double.' },
  { label: 'Float', detail: 'java.lang.Float', doc: 'Wrapper class for float.' },
  { label: 'Boolean', detail: 'java.lang.Boolean', doc: 'Wrapper class for boolean.' },
  { label: 'Character', detail: 'java.lang.Character', doc: 'Wrapper class for char.' },
  { label: 'Byte', detail: 'java.lang.Byte', doc: 'Wrapper class for byte.' },
  { label: 'Short', detail: 'java.lang.Short', doc: 'Wrapper class for short.' },
  { label: 'Object', detail: 'java.lang.Object', doc: 'Root of the class hierarchy.' },
  { label: 'Class', detail: 'java.lang.Class', doc: 'Represents classes and interfaces.' },
  { label: 'System', detail: 'java.lang.System', doc: 'System-level utilities.' },
  { label: 'Math', detail: 'java.lang.Math', doc: 'Math utility methods.' },
  { label: 'Thread', detail: 'java.lang.Thread', doc: 'A thread of execution.' },
  { label: 'Runnable', detail: 'java.lang.Runnable', doc: 'Represents a task to be executed by a thread.' },
  { label: 'Exception', detail: 'java.lang.Exception', doc: 'Base class for checked exceptions.' },
  { label: 'RuntimeException', detail: 'java.lang.RuntimeException', doc: 'Base class for unchecked exceptions.' },
  { label: 'Throwable', detail: 'java.lang.Throwable', doc: 'Superclass of all errors and exceptions.' },
  { label: 'Error', detail: 'java.lang.Error', doc: 'Indicates serious problems.' },
  { label: 'StringBuilder', detail: 'java.lang.StringBuilder', doc: 'Mutable sequence of characters.' },
  { label: 'StringBuffer', detail: 'java.lang.StringBuffer', doc: 'Thread-safe mutable sequence of characters.' },
  { label: 'List', detail: 'java.util.List', doc: 'An ordered collection.' },
  { label: 'ArrayList', detail: 'java.util.ArrayList', doc: 'Resizable-array implementation of List.' },
  { label: 'LinkedList', detail: 'java.util.LinkedList', doc: 'Doubly-linked list implementation.' },
  { label: 'Map', detail: 'java.util.Map', doc: 'Maps keys to values.' },
  { label: 'HashMap', detail: 'java.util.HashMap', doc: 'Hash table based implementation of Map.' },
  { label: 'TreeMap', detail: 'java.util.TreeMap', doc: 'Red-Black tree based implementation of Map.' },
  { label: 'Set', detail: 'java.util.Set', doc: 'A collection that contains no duplicates.' },
  { label: 'HashSet', detail: 'java.util.HashSet', doc: 'Hash table based implementation of Set.' },
  { label: 'TreeSet', detail: 'java.util.TreeSet', doc: 'Tree based implementation of Set.' },
  { label: 'Collections', detail: 'java.util.Collections', doc: 'Utility methods for collections.' },
  { label: 'Arrays', detail: 'java.util.Arrays', doc: 'Utility methods for arrays.' },
  { label: 'Date', detail: 'java.util.Date', doc: 'Represents a specific instant in time.' },
  { label: 'Calendar', detail: 'java.util.Calendar', doc: 'Abstract class for date calculations.' },
  { label: 'Iterator', detail: 'java.util.Iterator', doc: 'Iterator over a collection.' },
  { label: 'Comparator', detail: 'java.util.Comparator', doc: 'Comparison function for ordering.' },
  { label: 'Comparable', detail: 'java.lang.Comparable', doc: 'Natural ordering interface.' },
  { label: 'File', detail: 'java.io.File', doc: 'Abstract representation of file and directory pathnames.' },
  { label: 'InputStream', detail: 'java.io.InputStream', doc: 'Abstract class for byte input streams.' },
  { label: 'OutputStream', detail: 'java.io.OutputStream', doc: 'Abstract class for byte output streams.' },
  { label: 'Reader', detail: 'java.io.Reader', doc: 'Abstract class for character streams.' },
  { label: 'Writer', detail: 'java.io.Writer', doc: 'Abstract class for character streams.' },
  { label: 'BufferedReader', detail: 'java.io.BufferedReader', doc: 'Buffered character input stream.' },
  { label: 'BufferedWriter', detail: 'java.io.BufferedWriter', doc: 'Buffered character output stream.' },
  { label: 'PrintWriter', detail: 'java.io.PrintWriter', doc: 'Formatted character output stream.' },
  { label: 'IOException', detail: 'java.io.IOException', doc: 'Signals an I/O exception.' },
  { label: 'HttpServlet', detail: 'javax.servlet.http.HttpServlet', doc: 'Abstract class for HTTP servlets.' },
  { label: 'HttpServletRequest', detail: 'javax.servlet.http.HttpServletRequest', doc: 'HTTP request interface.' },
  { label: 'HttpServletResponse', detail: 'javax.servlet.http.HttpServletResponse', doc: 'HTTP response interface.' },
  { label: 'HttpSession', detail: 'javax.servlet.http.HttpSession', doc: 'HTTP session interface.' },
  { label: 'ServletException', detail: 'javax.servlet.ServletException', doc: 'General servlet exception.' },
  { label: 'RequestDispatcher', detail: 'javax.servlet.RequestDispatcher', doc: 'Forwards requests or includes content.' },
  { label: 'ServletContext', detail: 'javax.servlet.ServletContext', doc: 'Servlet context interface.' },
  { label: 'PrintStream', detail: 'java.io.PrintStream', doc: 'Formatted output stream (System.out is one).' },
];

// Common Java methods
const JAVA_COMMON_METHODS: { label: string; detail: string; insertText: string; doc: string }[] = [
  { label: 'equals', detail: 'boolean equals(Object obj)', insertText: 'equals(${1:obj})', doc: 'Indicates whether some other object is "equal to" this one.' },
  { label: 'hashCode', detail: 'int hashCode()', insertText: 'hashCode()', doc: 'Returns a hash code value for the object.' },
  { label: 'toString', detail: 'String toString()', insertText: 'toString()', doc: 'Returns a string representation of the object.' },
  { label: 'getClass', detail: 'Class<?> getClass()', insertText: 'getClass()', doc: 'Returns the runtime class of this Object.' },
  { label: 'clone', detail: 'Object clone()', insertText: 'clone()', doc: 'Creates and returns a copy of this object.' },
  { label: 'finalize', detail: 'void finalize()', insertText: 'finalize()', doc: 'Called by the garbage collector.' },
  { label: 'notify', detail: 'void notify()', insertText: 'notify()', doc: 'Wakes up a single thread waiting on this object.' },
  { label: 'notifyAll', detail: 'void notifyAll()', insertText: 'notifyAll()', doc: 'Wakes up all threads waiting on this object.' },
  { label: 'wait', detail: 'void wait(long timeout)', insertText: 'wait(${1:timeout})', doc: 'Causes current thread to wait.' },
  { label: 'length', detail: 'int length()', insertText: 'length()', doc: 'Returns the length of this string.' },
  { label: 'charAt', detail: 'char charAt(int index)', insertText: 'charAt(${1:index})', doc: 'Returns the char value at the specified index.' },
  { label: 'substring', detail: 'String substring(int beginIndex)', insertText: 'substring(${1:beginIndex})', doc: 'Returns a new string that is a substring.' },
  { label: 'indexOf', detail: 'int indexOf(String str)', insertText: 'indexOf(${1:str})', doc: 'Returns the index of the first occurrence.' },
  { label: 'contains', detail: 'boolean contains(CharSequence s)', insertText: 'contains(${1:s})', doc: 'Returns true if the string contains the sequence.' },
  { label: 'startsWith', detail: 'boolean startsWith(String prefix)', insertText: 'startsWith(${1:prefix})', doc: 'Tests if the string starts with the prefix.' },
  { label: 'endsWith', detail: 'boolean endsWith(String suffix)', insertText: 'endsWith(${1:suffix})', doc: 'Tests if the string ends with the suffix.' },
  { label: 'trim', detail: 'String trim()', insertText: 'trim()', doc: 'Returns a copy with leading/trailing whitespace removed.' },
  { label: 'replace', detail: 'String replace(char oldChar, char newChar)', insertText: 'replace(${1:oldChar}, ${2:newChar})', doc: 'Replaces characters.' },
  { label: 'split', detail: 'String[] split(String regex)', insertText: 'split(${1:regex})', doc: 'Splits this string around matches.' },
  { label: 'toLowerCase', detail: 'String toLowerCase()', insertText: 'toLowerCase()', doc: 'Converts to lower case.' },
  { label: 'toUpperCase', detail: 'String toUpperCase()', insertText: 'toUpperCase()', doc: 'Converts to upper case.' },
  { label: 'valueOf', detail: 'String valueOf(Object obj)', insertText: 'valueOf(${1:obj})', doc: 'Returns the string representation.' },
  { label: 'format', detail: 'String format(String fmt, Object... args)', insertText: 'format(${1:fmt}, ${2:args})', doc: 'Returns a formatted string.' },
  { label: 'size', detail: 'int size()', insertText: 'size()', doc: 'Returns the number of elements in this collection.' },
  { label: 'isEmpty', detail: 'boolean isEmpty()', insertText: 'isEmpty()', doc: 'Returns true if this collection contains no elements.' },
  { label: 'add', detail: 'boolean add(E e)', insertText: 'add(${1:e})', doc: 'Appends the element to the collection.' },
  { label: 'remove', detail: 'boolean remove(Object o)', insertText: 'remove(${1:o})', doc: 'Removes the element from the collection.' },
  { label: 'get', detail: 'E get(int index)', insertText: 'get(${1:index})', doc: 'Returns the element at the specified position.' },
  { label: 'put', detail: 'V put(K key, V value)', insertText: 'put(${1:key}, ${2:value})', doc: 'Associates the value with the key.' },
  { label: 'containsKey', detail: 'boolean containsKey(Object key)', insertText: 'containsKey(${1:key})', doc: 'Returns true if the map contains the key.' },
  { label: 'keySet', detail: 'Set<K> keySet()', insertText: 'keySet()', doc: 'Returns a Set view of the keys.' },
  { label: 'values', detail: 'Collection<V> values()', insertText: 'values()', doc: 'Returns a Collection view of the values.' },
  { label: 'entrySet', detail: 'Set<Map.Entry<K,V>> entrySet()', insertText: 'entrySet()', doc: 'Returns a Set view of the mappings.' },
  { label: 'println', detail: 'void println(String x)', insertText: 'println(${1:x})', doc: 'Prints a line of text.' },
  { label: 'print', detail: 'void print(String s)', insertText: 'print(${1:s})', doc: 'Prints text.' },
  { label: 'sort', detail: 'void sort(List<T> list)', insertText: 'sort(${1:list})', doc: 'Sorts the specified list.' },
  { label: 'sleep', detail: 'void sleep(long millis)', insertText: 'sleep(${1:millis})', doc: 'Causes the current thread to sleep.' },
  { label: 'currentTimeMillis', detail: 'long currentTimeMillis()', insertText: 'currentTimeMillis()', doc: 'Returns the current time in milliseconds.' },
  { label: 'doGet', detail: 'void doGet(HttpServletRequest req, HttpServletResponse resp)', insertText: 'doGet(${1:req}, ${2:resp})', doc: 'Handles HTTP GET requests.' },
  { label: 'doPost', detail: 'void doPost(HttpServletRequest req, HttpServletResponse resp)', insertText: 'doPost(${1:req}, ${2:resp})', doc: 'Handles HTTP POST requests.' },
  { label: 'getRequestDispatcher', detail: 'RequestDispatcher getRequestDispatcher(String path)', insertText: 'getRequestDispatcher(${1:path})', doc: 'Returns a RequestDispatcher.' },
  { label: 'sendRedirect', detail: 'void sendRedirect(String location)', insertText: 'sendRedirect(${1:location})', doc: 'Sends a redirect response.' },
  { label: 'setAttribute', detail: 'void setAttribute(String name, Object value)', insertText: 'setAttribute(${1:name}, ${2:value})', doc: 'Stores an attribute.' },
  { label: 'getAttribute', detail: 'Object getAttribute(String name)', insertText: 'getAttribute(${1:name})', doc: 'Returns the attribute value.' },
  { label: 'getParameter', detail: 'String getParameter(String name)', insertText: 'getParameter(${1:name})', doc: 'Returns a request parameter.' },
  { label: 'getWriter', detail: 'PrintWriter getWriter()', insertText: 'getWriter()', doc: 'Returns a PrintWriter for sending character text.' },
];

// Common code snippets
const JAVA_SNIPPETS: { label: string; detail: string; insertText: string; doc: string }[] = [
  {
    label: 'main', detail: 'main method', doc: 'Java application entry point.',
    insertText: 'public static void main(String[] args) {\n\t${1}\n}',
  },
  {
    label: 'class', detail: 'class declaration', doc: 'New class declaration.',
    insertText: 'public class ${1:ClassName} {\n\t${2}\n}',
  },
  {
    label: 'interface', detail: 'interface declaration', doc: 'New interface declaration.',
    insertText: 'public interface ${1:InterfaceName} {\n\t${2}\n}',
  },
  {
    label: 'fori', detail: 'for loop with index', doc: 'Indexed for loop.',
    insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:max}; ${1:i}++) {\n\t${3}\n}',
  },
  {
    label: 'foreach', detail: 'enhanced for loop', doc: 'Enhanced for-each loop.',
    insertText: 'for (${1:Type} ${2:item} : ${3:collection}) {\n\t${4}\n}',
  },
  {
    label: 'ifelse', detail: 'if-else statement', doc: 'If-else conditional.',
    insertText: 'if (${1:condition}) {\n\t${2}\n} else {\n\t${3}\n}',
  },
  {
    label: 'trycatch', detail: 'try-catch block', doc: 'Exception handling block.',
    insertText: 'try {\n\t${1}\n} catch (${2:Exception} ${3:e}) {\n\t${4}\n}',
  },
  {
    label: 'trycatchf', detail: 'try-catch-finally', doc: 'Exception handling with finally.',
    insertText: 'try {\n\t${1}\n} catch (${2:Exception} ${3:e}) {\n\t${4}\n} finally {\n\t${5}\n}',
  },
  {
    label: 'sout', detail: 'System.out.println', doc: 'Print to standard output.',
    insertText: 'System.out.println(${1});',
  },
  {
    label: 'serr', detail: 'System.err.println', doc: 'Print to standard error.',
    insertText: 'System.err.println(${1});',
  },
  {
    label: 'psvm', detail: 'public static void main', doc: 'Main method shorthand.',
    insertText: 'public static void main(String[] args) {\n\t${1}\n}',
  },
  {
    label: 'getset', detail: 'getter and setter', doc: 'Getter and setter for a field.',
    insertText: 'public ${1:Type} get${2:Name}() {\n\treturn ${3:field};\n}\n\npublic void set${2:Name}(${1:Type} ${3:field}) {\n\tthis.${3:field} = ${3:field};\n}',
  },
  {
    label: 'synchronized', detail: 'synchronized block', doc: 'Thread-safe synchronized block.',
    insertText: 'synchronized (${1:lock}) {\n\t${2}\n}',
  },
  {
    label: 'while', detail: 'while loop', doc: 'While loop.',
    insertText: 'while (${1:condition}) {\n\t${2}\n}',
  },
  {
    label: 'dowhile', detail: 'do-while loop', doc: 'Do-while loop.',
    insertText: 'do {\n\t${1}\n} while (${2:condition});',
  },
  {
    label: 'switch', detail: 'switch statement', doc: 'Switch statement.',
    insertText: 'switch (${1:key}) {\n\tcase ${2:value}:\n\t\t${3}\n\t\tbreak;\n\tdefault:\n\t\t${4}\n\t\tbreak;\n}',
  },
  {
    label: 'enum', detail: 'enum declaration', doc: 'Enum type declaration.',
    insertText: 'public enum ${1:Name} {\n\t${2:VALUES}\n}',
  },
  {
    label: 'servlet', detail: 'servlet doGet/doPost', doc: 'HTTP servlet template.',
    insertText: 'protected void doGet(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {\n\tresponse.setContentType("text/html;charset=UTF-8");\n\tPrintWriter out = response.getWriter();\n\t${1}\n}',
  },
];

// ── Definition ──────────────────────────────────────────────────

export interface JavaIntelliSenseDefinition {
  uri: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
}

// ── Diagnostics ─────────────────────────────────────────────────

export interface JavaIntelliSenseDiagnostic {
  line: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  severity: 1 | 2 | 3 | 4; // 1=Error, 2=Warning, 3=Info, 4=Hint
  message: string;
  code?: string;
}

@injectable()
export class JavaIntelliSenseProvider {
  @inject(ILogger)
  protected readonly logger!: ILogger;

  /**
   * Provide fallback completions for Java files.
   * This is called when JDT LS is not available.
   */
  provideCompletions(
    source: string,
    line: number,
    character: number,
    triggerCharacter?: string,
  ): JavaIntelliSenseCompletionResult {
    const lines = source.split('\n');
    const currentLine = lines[line] ?? '';
    const prefix = currentLine.substring(0, character);
    const wordStart = this.findWordStart(prefix);
    const currentWord = prefix.substring(wordStart).toLowerCase();

    const items: JavaIntelliSenseCompletionItem[] = [];

    // Determine context from the current and surrounding lines
    const context = this.detectContext(lines, line, prefix);

    // 1. Keyword completions
    if (context === 'any' || context === 'classBody' || context === 'methodBody' || context === 'topLevel') {
      for (const kw of JAVA_KEYWORDS) {
        if (this.matches(kw.label, currentWord)) {
          items.push({
            label: kw.label,
            kind: CIK.Keyword,
            detail: kw.detail,
            documentation: kw.doc,
            sortText: '1' + kw.label,
            filterText: kw.label,
            insertText: kw.label,
          });
        }
      }
    }

    // 2. Type completions
    if (context === 'any' || context === 'classBody' || context === 'methodBody' || context === 'topLevel' || context === 'typeDecl') {
      for (const t of JAVA_COMMON_TYPES) {
        if (this.matches(t.label, currentWord)) {
          items.push({
            label: t.label,
            kind: CIK.Class,
            detail: t.detail,
            documentation: t.doc,
            sortText: '2' + t.label,
            filterText: t.label,
            insertText: t.label,
          });
        }
      }
    }

    // 3. Snippet completions
    if (context === 'any' || context === 'classBody' || context === 'methodBody' || context === 'topLevel') {
      for (const s of JAVA_SNIPPETS) {
        if (this.matches(s.label, currentWord)) {
          items.push({
            label: s.label,
            kind: CIK.Snippet,
            detail: s.detail,
            documentation: s.doc,
            sortText: '0' + s.label,
            filterText: s.label,
            insertText: s.insertText,
          });
        }
      }
    }

    // 4. Variable completions (from scope)
    if (context === 'methodBody' || context === 'any') {
      const vars = this.extractVariables(lines, line);
      for (const v of vars) {
        if (this.matches(v.name, currentWord)) {
          items.push({
            label: v.name,
            kind: CIK.Variable,
            detail: v.type,
            documentation: `Local variable of type ${v.type}`,
            sortText: '3' + v.name,
            filterText: v.name,
            insertText: v.name,
          });
        }
      }
    }

    // 5. Method completions
    if (triggerCharacter === '.' || context === 'methodBody') {
      for (const m of JAVA_COMMON_METHODS) {
        if (this.matches(m.label, currentWord)) {
          items.push({
            label: m.label,
            kind: CIK.Method,
            detail: m.detail,
            documentation: m.doc,
            sortText: '4' + m.label,
            filterText: m.label,
            insertText: m.insertText,
          });
        }
      }
    }

    // 6. Import completions
    if (context === 'import' || prefix.trimStart().startsWith('import')) {
      const importPrefix = prefix.replace(/^import\s+/, '').trim();
      const commonImports = [
        'java.util.List', 'java.util.ArrayList', 'java.util.HashMap', 'java.util.Map',
        'java.util.Set', 'java.util.HashSet', 'java.util.Collections', 'java.util.Arrays',
        'java.io.File', 'java.io.IOException', 'java.io.BufferedReader', 'java.io.InputStreamReader',
        'java.io.PrintWriter', 'javax.servlet.http.HttpServlet', 'javax.servlet.http.HttpServletRequest',
        'javax.servlet.http.HttpServletResponse', 'javax.servlet.ServletException',
        'javax.servlet.RequestDispatcher', 'java.sql.Connection', 'java.sql.ResultSet',
        'java.sql.PreparedStatement', 'java.sql.SQLException',
      ];
      for (const imp of commonImports) {
        if (this.matches(imp, importPrefix)) {
          items.push({
            label: imp,
            kind: CIK.Module,
            detail: `import ${imp}`,
            documentation: `Import ${imp}`,
            sortText: '5' + imp,
            filterText: imp,
            insertText: imp + ';',
          });
        }
      }
    }

    // 7. Local class/field completions
    const localSymbols = this.extractLocalSymbols(lines);
    for (const sym of localSymbols) {
      if (this.matches(sym.name, currentWord)) {
        items.push({
          label: sym.name,
          kind: sym.kind === 'field' ? CIK.Field : CIK.Method,
          detail: sym.detail,
          sortText: '6' + sym.name,
          filterText: sym.name,
          insertText: sym.name,
        });
      }
    }

    return {
      isIncomplete: false,
      items: items.slice(0, 100), // Cap at 100 items
    };
  }

  /**
   * Provide fallback go-to-definition by scanning the source for
   * class/method/variable declarations that match the word at the
   * cursor position.
   */
  provideDefinition(
    uri: string,
    source: string,
    line: number,
    character: number,
  ): JavaIntelliSenseDefinition[] {
    const lines = source.split('\n');
    const currentLine = lines[line] ?? '';
    const word = this.getWordAt(currentLine, character);
    if (!word) return [];

    const results: JavaIntelliSenseDefinition[] = [];

    // Search for class declarations matching the word
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // Class/interface/enum declaration
      const classMatch = new RegExp(
        `\\b(?:class|interface|enum)\\s+${this.escapeRegex(word)}\\b`,
      ).exec(l);
      if (classMatch) {
        results.push({
          uri,
          line: i,
          character: classMatch.index + classMatch[0].indexOf(word),
          endLine: i,
          endCharacter: classMatch.index + classMatch[0].indexOf(word) + word.length,
        });
      }

      // Method declaration
      const methodMatch = new RegExp(
        `\\b(?:public|protected|private|static|abstract|final|synchronized|native)?\\s*` +
        `(?:<[^>]*>\\s*)?` +
        `(?:\\w+(?:\\[\\])?\\s+)?` +
        `${this.escapeRegex(word)}\\s*\\(`,
      ).exec(l);
      if (methodMatch && !classMatch) {
        const idx = l.indexOf(word);
        if (idx >= 0) {
          results.push({
            uri,
            line: i,
            character: idx,
            endLine: i,
            endCharacter: idx + word.length,
          });
        }
      }

      // Variable/field declaration
      const varMatch = new RegExp(
        `\\b(?:\\w+(?:<[^>]*>)?(?:\\[\\])?)\\s+${this.escapeRegex(word)}\\b`,
      ).exec(l);
      if (varMatch && !classMatch && !methodMatch) {
        const idx = l.indexOf(word, varMatch.index);
        if (idx >= 0) {
          results.push({
            uri,
            line: i,
            character: idx,
            endLine: i,
            endCharacter: idx + word.length,
          });
        }
      }

      // Import statement
      const importMatch: RegExpMatchArray | null = l.match(/^import\s+([\w.]+)$/);
      if (importMatch) {
        const imported: string = importMatch[1];
        const simpleName: string | undefined = imported.split('.').pop();
        if (simpleName === word) {
          results.push({
            uri,
            line: i,
            character: l.indexOf(word),
            endLine: i,
            endCharacter: l.indexOf(word) + word.length,
          });
        }
      }
    }

    return results.slice(0, 10);
  }

  /**
   * Provide fallback diagnostics for Java source code.
   */
  provideDiagnostics(source: string, uri: string): JavaIntelliSenseDiagnostic[] {
    const diagnostics: JavaIntelliSenseDiagnostic[] = [];
    const lines = source.split('\n');

    // Track imports and declared variables for cross-reference
    const importedTypes = new Set<string>();
    const declaredVariables = new Map<string, number>(); // name -> line
    const usedVariables = new Set<string>();

    let braceDepth = 0;
    let inClass = false;
    let className = '';
    let inMethod = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip blank lines and comments
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        continue;
      }

      // Track brace depth
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }

      // Detect class declaration
      const classMatch = trimmed.match(/^(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/);
      if (classMatch) {
        inClass = true;
        className = classMatch[1];
        continue;
      }

      // Detect method declaration
      if (trimmed.match(/^\s*(?:public|protected|private|static|abstract|final|synchronized|native)\s.*\(.*\)\s*(?:\{|throws)/)) {
        inMethod = true;
        continue;
      }

      // Track imports
      const importMatch = trimmed.match(/^import\s+([\w.]+);/);
      if (importMatch) {
        importedTypes.add(importMatch[1].split('.').pop()!);
        continue;
      }

      // Track variable declarations
      const varDecl = trimmed.match(/^\s*(\w+(?:<[^>]*>)?(?:\[\])?)\s+(\w+)\s*[=;]/);
      if (varDecl && !trimmed.includes('(')) {
        declaredVariables.set(varDecl[2], i);
        continue;
      }

      // Track variable usage
      const identifiers = line.match(/\b([a-zA-Z_]\w*)\b/g);
      if (identifiers) {
        for (const id of identifiers) {
          if (!JAVA_KEYWORDS.some(k => k.label === id) && !JAVA_COMMON_TYPES.some(t => t.label === id)) {
            usedVariables.add(id);
          }
        }
      }

      // ── Syntax error detection ──────────────────────────────

      // Unclosed string literal
      const inString = (line.match(/"/g) || []).length % 2 !== 0;
      if (inString && !trimmed.endsWith('+')) {
        diagnostics.push({
          line: i, startColumn: line.lastIndexOf('"'), endLine: i, endColumn: line.length,
          severity: 1, message: 'Unclosed string literal',
          code: 'java-syntax-unclosed-string',
        });
      }

      // Missing semicolon (heuristic: line ends with identifier/number/')' or '}' without ';')
      if (braceDepth >= 0 && !trimmed.startsWith('//') && !trimmed.startsWith('/*') &&
          !trimmed.startsWith('*') && !trimmed.startsWith('@') &&
          !trimmed.endsWith('{') && !trimmed.endsWith('}') &&
          !trimmed.endsWith(';') && !trimmed.endsWith(':') &&
          !trimmed.endsWith('*/') && !trimmed.startsWith('package') &&
          !trimmed.startsWith('import') && !trimmed.match(/^\s*(?:public\s+)?(?:abstract\s+)?(?:final\s+)?class\s/) &&
          !trimmed.match(/^\s*(?:public\s+)?(?:abstract\s+)?interface\s/) &&
          !trimmed.match(/^\s*(?:public\s+)?enum\s/) &&
          trimmed.length > 0 && !trimmed.startsWith('if') && !trimmed.startsWith('else') &&
          !trimmed.startsWith('for') && !trimmed.startsWith('while') &&
          !trimmed.startsWith('do') && !trimmed.startsWith('try') &&
          !trimmed.startsWith('catch') && !trimmed.startsWith('finally') &&
          !trimmed.startsWith('switch') && !trimmed.startsWith('synchronized') &&
          !trimmed.startsWith('//') && !trimmed.startsWith('/*') &&
          !trimmed.endsWith(',') && !trimmed.match(/^\s*}/) &&
          !trimmed.match(/^\s*\/\//) && !trimmed.match(/^\s*\/\*/) &&
          !trimmed.match(/^\s*@/) && !trimmed.match(/^\s*$/)) {
        // Check if it's a method declaration or class declaration
        if (!trimmed.match(/^\s*(?:public|protected|private|static|abstract|final|synchronized|native)\s+\w+\s+\w+\s*\(/) &&
            !trimmed.match(/^\s*(?:public|protected|private|static|abstract|final|synchronized|native)\s+\w+\s*\(/) &&
            !trimmed.match(/^\s*class\s/) && !trimmed.match(/^\s*interface\s/)) {
          diagnostics.push({
            line: i, startColumn: 0, endLine: i, endColumn: trimmed.length,
            severity: 2, message: 'Missing semicolon',
            code: 'java-syntax-missing-semicolon',
          });
        }
      }

      // ── Type error detection ────────────────────────────────

      // Check for type names that aren't imported or common
      const typeUsage = trimmed.match(/^\s*(\w+(?:<[^>]*>)?)\s+(\w+)\s*[=;]/);
      if (typeUsage) {
        const typeName = typeUsage[1];
        const isKeyword = JAVA_KEYWORDS.some(k => k.label === typeName);
        const isCommon = JAVA_COMMON_TYPES.some(t => t.label === typeName);
        const isImported = importedTypes.has(typeName);
        const isPrimitive = ['int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'void'].includes(typeName);
        if (!isKeyword && !isCommon && !isImported && !isPrimitive && typeName !== className) {
          diagnostics.push({
            line: i, startColumn: line.indexOf(typeName), endLine: i, endColumn: line.indexOf(typeName) + typeName.length,
            severity: 2, message: `Type '${typeName}' may not be imported or resolved`,
            code: 'java-type-unresolved',
          });
        }
      }
    }

    // ── Unused variable detection ─────────────────────────────

    for (const [name, varLine] of declaredVariables) {
      if (!usedVariables.has(name)) {
        diagnostics.push({
          line: varLine, startColumn: 0, endLine: varLine, endColumn: lines[varLine].length,
          severity: 3, message: `Variable '${name}' is never used`,
          code: 'java-unused-variable',
        });
      }
    }

    // ── Missing import detection ──────────────────────────────

    // Look for types used but not imported
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const typePattern = /\b(?:new\s+)?(\w+)\s*[\[\(\.\<]/g;
      let match: RegExpExecArray | null;
      while ((match = typePattern.exec(trimmed)) !== null) {
        const typeName = match[1];
        if (typeName && typeName[0] === typeName[0].toUpperCase()) {
          const isKeyword = JAVA_KEYWORDS.some(k => k.label === typeName);
          const isCommon = JAVA_COMMON_TYPES.some(t => t.label === typeName);
          const isImported = importedTypes.has(typeName);
          const isPrimitive = ['int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'void'].includes(typeName);
          if (!isKeyword && !isCommon && !isImported && !isPrimitive && typeName !== className && typeName !== 'String') {
            // Only flag if it looks like a type (capitalized)
            // and is not part of `java.lang.*`
            diagnostics.push({
              line: i, startColumn: match.index, endLine: i, endColumn: match.index + typeName.length,
              severity: 3, message: `Type '${typeName}' may need to be imported`,
              code: 'java-missing-import',
            });
          }
        }
      }
    }

    // ── Brace mismatch ────────────────────────────────────────

    if (braceDepth !== 0 && source.trim().length > 0) {
      diagnostics.push({
        line: 0, startColumn: 0, endLine: 0, endColumn: 1,
        severity: 1, message: `Brace mismatch: ${braceDepth > 0 ? 'missing' : 'extra'} closing brace(s)`,
        code: 'java-syntax-brace-mismatch',
      });
    }

    return diagnostics;
  }

  // ── Private helpers ──────────────────────────────────────────

  private matches(target: string, prefix: string): boolean {
    if (!prefix) return true;
    return target.toLowerCase().startsWith(prefix.toLowerCase());
  }

  private findWordStart(prefix: string): number {
    let i = prefix.length - 1;
    while (i >= 0 && /[\w.]/.test(prefix[i])) {
      i--;
    }
    return i + 1;
  }

  private getWordAt(line: string, column: number): string | undefined {
    let start = column;
    while (start > 0 && /[\w.]/.test(line[start - 1])) start--;
    let end = column;
    while (end < line.length && /[\w.]/.test(line[end])) end++;
    const word = line.substring(start, end);
    return word || undefined;
  }

  private detectContext(lines: string[], line: number, prefix: string): string {
    const trimmed = prefix.trimStart();
    if (trimmed.startsWith('import')) return 'import';
    if (trimmed.startsWith('package')) return 'package';

    // Look at surrounding lines
    let braceDepth = 0;
    for (let i = 0; i < line; i++) {
      const l = lines[i];
      for (const ch of l) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
    }

    if (braceDepth === 0) return 'topLevel';
    if (braceDepth === 1) return 'classBody';
    return 'methodBody';
  }

  private extractVariables(lines: string[], currentLine: number): { name: string; type: string }[] {
    const vars: { name: string; type: string }[] = [];
    // Only look at lines before or at the current line
    for (let i = 0; i <= currentLine; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(/^\s*(\w+(?:<[^>]*>)?(?:\[\])?)\s+(\w+)\s*[=;]/);
      if (match && !trimmed.includes('(') && !trimmed.startsWith('class') && !trimmed.startsWith('interface')) {
        vars.push({ name: match[2], type: match[1] });
      }
      // Also catch method parameters
      const paramMatch = trimmed.match(/\(([^)]*)\)/);
      if (paramMatch) {
        const params = paramMatch[1].split(',');
        for (const p of params) {
          const parts = p.trim().split(/\s+/);
          if (parts.length >= 2) {
            const type = parts[parts.length - 2];
            const name = parts[parts.length - 1].replace(/[^a-zA-Z0-9_]/g, '');
            if (name && !['int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'void'].includes(name)) {
              vars.push({ name, type });
            }
          }
        }
      }
    }
    return vars;
  }

  private extractLocalSymbols(lines: string[]): { name: string; kind: string; detail?: string }[] {
    const symbols: { name: string; kind: string; detail?: string }[] = [];
    for (const l of lines) {
      const trimmed = l.trim();
      // Field declarations
      const fieldMatch = trimmed.match(/^\s*(?:public|protected|private|static|final|volatile|transient)?\s*(?:static\s+)?(?:final\s+)?(\w+(?:<[^>]*>)?(?:\[\])?)\s+(\w+)\s*[=;]/);
      if (fieldMatch && !trimmed.includes('(')) {
        symbols.push({ name: fieldMatch[2], kind: 'field', detail: fieldMatch[1] });
      }
      // Method declarations
      const methodMatch = trimmed.match(/^\s*(?:public|protected|private|static|abstract|final|synchronized|native)?\s*(?:<[^>]*>\s*)?(?:\w+(?:\[\])?\s+)?(\w+)\s*\(/);
      if (methodMatch && !trimmed.startsWith('class') && !trimmed.startsWith('interface') && !trimmed.startsWith('if') && !trimmed.startsWith('while') && !trimmed.startsWith('for') && !trimmed.startsWith('switch') && !trimmed.startsWith('catch') && !trimmed.startsWith('return') && !trimmed.startsWith('new') && !trimmed.startsWith('throw')) {
        symbols.push({ name: methodMatch[1], kind: 'method' });
      }
    }
    return symbols;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}