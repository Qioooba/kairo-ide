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
    const root = doc.querySelector('taglib');
    if (!root) return undefined;
    const shortName = root.querySelector('short-name')?.textContent ?? '';
    const uri = root.querySelector('uri')?.textContent ?? '';
    const tags: TldTag[] = [];
    root.querySelectorAll('tag').forEach(t => {
      const attrs: TldAttribute[] = [];
      t.querySelectorAll('attribute').forEach(a => {
        attrs.push({
          name: a.querySelector('name')?.textContent ?? '',
          required: a.querySelector('required')?.textContent?.trim() === 'true',
          rtexprvalue: a.querySelector('rtexprvalue')?.textContent?.trim() !== 'false',
          type: a.querySelector('type')?.textContent ?? undefined,
        });
      });
      tags.push({
        name: t.querySelector('name')?.textContent ?? '',
        tagClass: t.querySelector('tag-class')?.textContent ?? undefined,
        bodyContent: t.querySelector('body-content')?.textContent ?? undefined,
        attributes: attrs,
      });
    });
    return { shortName, uri, tags };
  }
}
