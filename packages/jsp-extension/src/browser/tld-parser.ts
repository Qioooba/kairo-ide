/**
 * TLD / web.xml parser. Pure functions; no I/O. The agent
 * already returns scan results that include parsed web.xml;
 * this package parses additional TLD files on the client.
 */

import { injectable } from '@theia/core/shared/inversify';

export interface TldTag {
  name: string;
  tagClass?: string;
  bodyContent?: string;
  attributes: TldAttribute[];
}

export interface TldAttribute {
  name: string;
  required: boolean;
  rtexprvalue: boolean;
  type?: string;
  description?: string;
}

export interface Tld {
  shortName: string;
  uri: string;
  tags: TldTag[];
}

@injectable()
export class TldParser {
  parse(xml: string): Tld | undefined {
    // Lightweight XML scan. We rely on the browser's DOMParser
    // to keep deps zero. The result is what we show in the
    // completion popup.
    if (typeof DOMParser === 'undefined') {
      return undefined;
    }
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    // Bail out cleanly on malformed XML — DOMParser inserts a
    // <parsererror> element rather than throwing.
    if (doc.getElementsByTagName('parsererror').length > 0) {
      return undefined;
    }
    // Real TLDs declare a default namespace (e.g.
    // xmlns="http://java.sun.com/xml/ns/j2ee"). querySelector
    // only matches the null namespace, so for a namespaced TLD
    // it would return null and the function silently produced
    // an empty result. Use documentElement + getElementsByTagName
    // (which ignore namespace) for robustness.
    const root = doc.documentElement && doc.documentElement.tagName === 'taglib'
      ? doc.documentElement
      : doc.getElementsByTagName('taglib')[0];
    if (!root) return undefined;
    // ParentNode doesn't expose getElementsByTagName in the DOM
    // lib (only Element and Document do). Everything we pass in
    // here is an Element, so type the helpers accordingly.
    const byTag = (parent: Element, tag: string): Element | undefined =>
      parent.getElementsByTagName(tag)[0];
    const allByTag = (parent: Element, tag: string): Element[] =>
      Array.from(parent.getElementsByTagName(tag));
    const shortName = byTag(root, 'short-name')?.textContent ?? '';
    const uri = byTag(root, 'uri')?.textContent ?? '';
    const tags: TldTag[] = [];
    for (const t of allByTag(root, 'tag')) {
      const attrs: TldAttribute[] = [];
      for (const a of allByTag(t, 'attribute')) {
        attrs.push({
          name: byTag(a, 'name')?.textContent ?? '',
          required: byTag(a, 'required')?.textContent?.trim() === 'true',
          // JSP 2.3 §JSP.8.5.2: the default for <rtexprvalue> is
          // false. The previous `!== 'false'` defaulted to true
          // when the element was absent (the common case in
          // older TLDs) and also accepted "yes"/"1"/typos as true.
          rtexprvalue: byTag(a, 'rtexprvalue')?.textContent?.trim() === 'true',
          type: byTag(a, 'type')?.textContent ?? undefined,
        });
      }
      tags.push({
        name: byTag(t, 'name')?.textContent ?? '',
        tagClass: byTag(t, 'tag-class')?.textContent ?? undefined,
        bodyContent: byTag(t, 'body-content')?.textContent ?? undefined,
        attributes: attrs,
      });
    }
    return { shortName, uri, tags };
  }
}
