/**
 * web.xml parser. Pure functions that extract servlet-class
 * and servlet-mapping elements from web.xml content.
 *
 * Uses the browser's DOMParser (zero deps).
 */

export interface ServletDef {
  servletName: string;
  servletClass: string;
}

export interface ServletMapping {
  servletName: string;
  urlPattern: string;
}

export interface WebXml {
  /** Keyed by servlet-name. */
  servlets: Record<string, ServletDef>;
  /** All servlet-mappings. */
  mappings: ServletMapping[];
  /** servlet-class → servlet-name reverse lookup. */
  classToServlet: Record<string, string>;
}

/**
 * Parse a web.xml string into structured servlet definitions.
 * Returns undefined when the XML is malformed or not a web-app.
 */
export function parseWebXml(xml: string): WebXml | undefined {
  if (typeof DOMParser === 'undefined') return undefined;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return undefined;

  const root = doc.documentElement;
  if (!root || root.tagName !== 'web-app') return undefined;

  const byTag = (parent: Element, tag: string): Element | undefined =>
    parent.getElementsByTagName(tag)[0];
  const allByTag = (parent: Element, tag: string): Element[] =>
    Array.from(parent.getElementsByTagName(tag));

  const servlets: Record<string, ServletDef> = {};
  const classToServlet: Record<string, string> = {};
  const mappings: ServletMapping[] = [];

  for (const servletEl of allByTag(root, 'servlet')) {
    const name = byTag(servletEl, 'servlet-name')?.textContent?.trim() ?? '';
    const clazz = byTag(servletEl, 'servlet-class')?.textContent?.trim() ?? '';
    if (name && clazz) {
      servlets[name] = { servletName: name, servletClass: clazz };
      classToServlet[clazz] = name;
    }
  }

  for (const mappingEl of allByTag(root, 'servlet-mapping')) {
    const name = byTag(mappingEl, 'servlet-name')?.textContent?.trim() ?? '';
    const pattern = byTag(mappingEl, 'url-pattern')?.textContent?.trim() ?? '';
    if (name && pattern) {
      mappings.push({ servletName: name, urlPattern: pattern });
    }
  }

  return { servlets, mappings, classToServlet };
}

/**
 * Find all fully qualified class names referenced in a web.xml.
 * Returns deduplicated array of servlet-class values.
 */
export function extractServletClasses(webXml: WebXml): string[] {
  return [...new Set(Object.values(webXml.servlets).map(s => s.servletClass))];
}