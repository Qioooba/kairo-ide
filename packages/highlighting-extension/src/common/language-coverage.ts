/**
 * Language coverage and dialect classification for Kairo IDE.
 * Pure logic — no DOM or Theia UI dependencies.
 */

export type JspDialect = 'jsp' | 'jspf' | 'jspx' | 'tag' | 'tagx';

export interface LanguageDialectInfo {
  languageId: string;
  dialect: string;
  isXmlSyntax: boolean;
  supportsJspDirectives: boolean;
  supportsScriptlets: boolean;
  supportsEl: boolean;
}

export const SUPPORTED_EXTENSIONS_MAP: Record<string, { languageId: string; dialect: string }> = {
  '.jsp': { languageId: 'jsp', dialect: 'jsp' },
  '.jspf': { languageId: 'jsp', dialect: 'jspf' },
  '.jspx': { languageId: 'jsp', dialect: 'jspx' },
  '.tag': { languageId: 'jsp', dialect: 'tag' },
  '.tagx': { languageId: 'jsp', dialect: 'tagx' },
  '.java': { languageId: 'java', dialect: 'java' },
  '.xml': { languageId: 'xml', dialect: 'xml' },
  '.tld': { languageId: 'xml', dialect: 'tld' },
  '.dtd': { languageId: 'xml', dialect: 'dtd' },
  '.xsd': { languageId: 'xml', dialect: 'xsd' },
  '.wsdl': { languageId: 'xml', dialect: 'wsdl' },
  '.html': { languageId: 'html', dialect: 'html' },
  '.htm': { languageId: 'html', dialect: 'html' },
  '.js': { languageId: 'javascript', dialect: 'javascript' },
  '.cjs': { languageId: 'javascript', dialect: 'javascript' },
  '.mjs': { languageId: 'javascript', dialect: 'javascript' },
  '.css': { languageId: 'css', dialect: 'css' },
  '.json': { languageId: 'json', dialect: 'json' },
  '.jsonc': { languageId: 'jsonc', dialect: 'jsonc' },
  '.properties': { languageId: 'properties', dialect: 'properties' },
};

export function detectLanguageAndDialect(uriOrFilename: string): LanguageDialectInfo {
  const lower = uriOrFilename.toLowerCase();
  const lastDot = lower.lastIndexOf('.');
  const ext = lastDot >= 0 ? lower.slice(lastDot) : '';
  const match = SUPPORTED_EXTENSIONS_MAP[ext];

  if (match) {
    const isXmlSyntax = match.dialect === 'jspx' || match.dialect === 'tagx' || match.languageId === 'xml';
    return {
      languageId: match.languageId,
      dialect: match.dialect,
      isXmlSyntax,
      supportsJspDirectives: match.languageId === 'jsp',
      supportsScriptlets: match.languageId === 'jsp',
      supportsEl: match.languageId === 'jsp' || match.languageId === 'html',
    };
  }

  // Fallback defaults
  return {
    languageId: 'plaintext',
    dialect: 'plaintext',
    isXmlSyntax: false,
    supportsJspDirectives: false,
    supportsScriptlets: false,
    supportsEl: false,
  };
}

export function isJspFamily(languageId: string, dialect?: string): boolean {
  if (languageId === 'jsp') return true;
  return dialect === 'jsp' || dialect === 'jspf' || dialect === 'jspx' || dialect === 'tag' || dialect === 'tagx';
}
