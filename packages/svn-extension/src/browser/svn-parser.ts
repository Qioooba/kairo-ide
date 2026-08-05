import {
  SvnStatusEntry,
  SvnWorkingCopyInfo,
  SvnLogEntry,
  SvnBlameLine,
  SvnChangedPath,
  RepoEntry,
  mapSvnItemStatus,
} from './svn-types';

interface SimpleXmlElement {
  [key: string]: any;
  '@_attributes'?: Record<string, string>;
  '#text'?: string;
  '#children'?: SimpleXmlElement[];
}

function getAttr(elem: SimpleXmlElement | undefined, name: string): string | undefined {
  return elem?.['@_attributes']?.[name];
}

function getChild(elem: SimpleXmlElement | undefined, name: string): SimpleXmlElement | undefined {
  return elem?.[name];
}

function getChildText(elem: SimpleXmlElement | undefined, name: string): string | undefined {
  const child = getChild(elem, name);
  if (!child) return undefined;
  if (typeof child === 'string') return child;
  return child['#text'];
}

function getChildren(elem: SimpleXmlElement | undefined, name: string): SimpleXmlElement[] {
  const child = elem?.[name];
  if (!child) return [];
  if (Array.isArray(child)) return child;
  return [child];
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function parseSimpleXml(xml: string): SimpleXmlElement | null {
  try {
    // Strip comments and expand CDATA so the tag regex never sees raw markup
    // inside them (VC-P1-6). Attribute values with '>' are handled via a
    // quoted-attribute scanner below.
    let input = xml
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, cdata: string) =>
        cdata
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;'),
      );

    const tagRegex = /<(\/?)([\w:-]+)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    const root: SimpleXmlElement = {};
    const stack: { elem: SimpleXmlElement; name: string }[] = [{ elem: root, name: '' }];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(input)) !== null) {
      const [, isClosing, tagName, attrs, selfClosing] = match;
      const start = match.index;
      const end = tagRegex.lastIndex;

      if (start > lastIndex) {
        const text = decodeXmlEntities(input.substring(lastIndex, start).trim());
        if (text && stack.length > 0) {
          const top = stack[stack.length - 1].elem;
          top['#text'] = (top['#text'] || '') + text;
        }
      }

      if (isClosing === '/') {
        while (stack.length > 1 && stack[stack.length - 1].name !== tagName) {
          stack.pop();
        }
        if (stack.length > 1) stack.pop();
      } else {
        const attributes: Record<string, string> = {};
        if (attrs) {
          const attrRegex = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
          let attrMatch: RegExpExecArray | null;
          while ((attrMatch = attrRegex.exec(attrs)) !== null) {
            attributes[attrMatch[1]] = decodeXmlEntities(attrMatch[2] ?? attrMatch[3] ?? '');
          }
        }

        const newElem: SimpleXmlElement = { '@_attributes': attributes };
        const parent = stack[stack.length - 1].elem;

        if (selfClosing === '/') {
          if (!parent[tagName]) {
            parent[tagName] = newElem;
          } else if (Array.isArray(parent[tagName])) {
            parent[tagName].push(newElem);
          } else {
            parent[tagName] = [parent[tagName], newElem];
          }
        } else {
          if (!parent[tagName]) {
            parent[tagName] = newElem;
          } else if (Array.isArray(parent[tagName])) {
            parent[tagName].push(newElem);
          } else {
            parent[tagName] = [parent[tagName], newElem];
          }
          stack.push({ elem: newElem, name: tagName });
        }
      }

      lastIndex = end;
    }

    return root;
  } catch (e) {
    console.error('XML parse error:', e);
    return null;
  }
}

function _ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function parseStatusEntry(entry: SimpleXmlElement, changelistName?: string): SvnStatusEntry | undefined {
  const wcStatus = getChild(entry, 'wc-status');
  if (!wcStatus) return undefined;

  const item = getAttr(wcStatus, 'item') || 'none';
  const props = getAttr(wcStatus, 'props') || 'none';
  const revisionStr = getAttr(wcStatus, 'revision');
  const revision = revisionStr ? parseInt(revisionStr, 10) : undefined;
  // Prefer explicit changelist group name (SVN puts changelist files under
  // <changelist name="...">); fall back to rare attribute on wc-status.
  const changelist = changelistName || getAttr(wcStatus, 'changelist');
  const copied = getAttr(wcStatus, 'copied') === 'true';
  const switched = getAttr(wcStatus, 'switched') === 'true';

  let lastChangedRevision: number | undefined;
  let lastChangedAuthor: string | undefined;
  let lastChangedDate: Date | undefined;
  let reposRootUrl: string | undefined;
  let reposUuid: string | undefined;
  let switchedUrl: string | undefined;
  let isLocked = false;
  let lockOwner: string | undefined;
  let lockComment: string | undefined;
  let treeConflict = false;
  let conflictOld: string | undefined;
  let conflictNew: string | undefined;
  let conflictWorking: string | undefined;

  const commit = getChild(wcStatus, 'commit');
  if (commit) {
    const cr = getAttr(commit, 'revision');
    lastChangedRevision = cr ? parseInt(cr, 10) : undefined;
    lastChangedAuthor = getChildText(commit, 'author');
    const dateStr = getChildText(commit, 'date');
    if (dateStr) lastChangedDate = new Date(dateStr);
  }

  const repos = getChild(entry, 'repos');
  if (repos) {
    reposRootUrl = getChildText(repos, 'root');
    reposUuid = getChildText(repos, 'uuid');
  }

  if (switched) {
    switchedUrl = getChildText(entry, 'url');
  }

  const lock = getChild(entry, 'lock') || getChild(wcStatus, 'lock');
  if (lock) {
    isLocked = true;
    lockOwner = getChildText(lock, 'owner');
    lockComment = getChildText(lock, 'comment');
  }

  if (getAttr(wcStatus, 'tree-conflicted') === 'true') {
    treeConflict = true;
  }

  const conflict = getChild(wcStatus, 'conflict');
  if (conflict) {
    conflictOld = getChildText(conflict, 'prev-base-file') || getChildText(conflict, 'old-file');
    conflictNew = getChildText(conflict, 'prev-wc-file') || getChildText(conflict, 'new-file');
    conflictWorking = getChildText(conflict, 'cur-base-file') || getChildText(conflict, 'working-file');
  }

  return {
    path: getAttr(entry, 'path') || '',
    status: mapSvnItemStatus(item),
    props: props !== 'none' ? mapSvnItemStatus(props) : undefined,
    reposStatus: (() => {
      const repos = getChild(entry, 'repos-status');
      if (!repos) return undefined;
      const reposItem = getAttr(repos, 'item');
      return reposItem && reposItem !== 'none' ? mapSvnItemStatus(reposItem) : undefined;
    })(),
    revision,
    lastChangedRevision,
    lastChangedAuthor,
    lastChangedDate,
    reposRootUrl,
    reposUuid,
    switchedUrl,
    changelist,
    isCopied: copied,
    isLocked,
    lockOwner,
    lockComment,
    treeConflict,
    conflictOld,
    conflictNew,
    conflictWorking,
  };
}

export function parseStatusXml(xml: string): SvnStatusEntry[] {
  const result: SvnStatusEntry[] = [];
  try {
    const obj = parseSimpleXml(xml);
    if (!obj) return result;

    const statusElem = getChild(obj, 'status');
    if (!statusElem) return result;

    // Default (no changelist) entries live under <target>
    for (const target of getChildren(statusElem, 'target')) {
      for (const entry of getChildren(target, 'entry')) {
        const parsed = parseStatusEntry(entry);
        if (parsed) result.push(parsed);
      }
    }

    // Named changelist entries live under <changelist name="..."> and are
    // NOT duplicated under <target>. Without this, they silently vanish.
    for (const cl of getChildren(statusElem, 'changelist')) {
      const clName = getAttr(cl, 'name') || '';
      for (const entry of getChildren(cl, 'entry')) {
        const parsed = parseStatusEntry(entry, clName);
        if (parsed) result.push(parsed);
      }
    }
  } catch (e) {
    console.error('Failed to parse svn status XML:', e);
  }
  return result;
}

export function parseInfoXml(xml: string): SvnWorkingCopyInfo | undefined {
  try {
    const obj = parseSimpleXml(xml);
    if (!obj) return undefined;

    const infoElem = getChild(obj, 'info');
    if (!infoElem) return undefined;

    let entry = getChild(infoElem, 'entry');
    if (Array.isArray(entry)) entry = entry[0];
    if (!entry) return undefined;

    const repository = getChild(entry, 'repository');
    const wcInfo = getChild(entry, 'wc-info');
    const commit = getChild(entry, 'commit');

    if (!repository || !wcInfo) return undefined;

    return {
      wcRoot: getChildText(wcInfo, 'wcroot-abspath') || getChildText(wcInfo, 'wcroot') || '',
      url: getChildText(entry, 'url') || '',
      reposRootUrl: getChildText(repository, 'root') || '',
      reposUuid: getChildText(repository, 'uuid') || '',
      revision: parseInt(getAttr(entry, 'revision') || '0', 10),
      lastChangedRev: commit ? parseInt(getAttr(commit, 'revision') || '0', 10) : 0,
      lastChangedDate: commit && getChildText(commit, 'date') ? getChildText(commit, 'date')! : new Date().toISOString(),
      lastChangedAuthor: (commit && getChildText(commit, 'author')) || '',
      schedule: (getChildText(wcInfo, 'schedule') as any) || 'normal',
      depth: (getChildText(wcInfo, 'depth') as any) || 'infinity',
    };
  } catch (e) {
    console.error('Failed to parse svn info XML:', e);
    return undefined;
  }
}

export function parseLogXml(xml: string): SvnLogEntry[] {
  const result: SvnLogEntry[] = [];
  try {
    const obj = parseSimpleXml(xml);
    if (!obj) return result;

    const logElem = getChild(obj, 'log');
    if (!logElem) return result;

    const logEntries = getChildren(logElem, 'logentry');
    for (const entry of logEntries) {
      const changedPaths: SvnChangedPath[] = [];

      const pathsElem = getChild(entry, 'paths');
      if (pathsElem) {
        const paths = getChildren(pathsElem, 'path');
        for (const p of paths) {
          changedPaths.push({
            path: p['#text'] || '',
            action: (getAttr(p, 'action') as 'A' | 'D' | 'M' | 'R') || 'M',
            copyFromPath: getAttr(p, 'copyfrom-path'),
            copyFromRev: getAttr(p, 'copyfrom-rev') ? parseInt(getAttr(p, 'copyfrom-rev')!, 10) : undefined,
          });
        }
      }

      result.push({
        revision: parseInt(getAttr(entry, 'revision') || '0', 10),
        author: getChildText(entry, 'author') || '',
        date: getChildText(entry, 'date') ? new Date(getChildText(entry, 'date')!) : new Date(),
        message: getChildText(entry, 'msg') || '',
        changedPaths,
        hasChildren: getAttr(entry, 'has-children') === 'true',
      });
    }
  } catch (e) {
    console.error('Failed to parse svn log XML:', e);
  }
  return result;
}

export function parseBlameXml(xml: string): SvnBlameLine[] {
  const result: SvnBlameLine[] = [];
  try {
    const obj = parseSimpleXml(xml);
    if (!obj) return result;

    const blameElem = getChild(obj, 'blame');
    if (!blameElem) return result;

    const target = getChild(blameElem, 'target');
    if (!target) return result;

    const entries = getChildren(target, 'entry');
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const commit = getChild(entry, 'commit');
      if (!commit) continue;

      result.push({
        revision: parseInt(getAttr(commit, 'revision') || '0', 10),
        author: getChildText(commit, 'author') || '',
        date: getChildText(commit, 'date') ? new Date(getChildText(commit, 'date')!) : new Date(),
        line: i + 1,
        content: '',
      });
    }
  } catch (e) {
    console.error('Failed to parse svn blame XML:', e);
  }
  return result;
}

export function parseListXml(xml: string): RepoEntry[] {
  const result: RepoEntry[] = [];
  try {
    const obj = parseSimpleXml(xml);
    if (!obj) return result;

    const listsElem = getChild(obj, 'lists');
    if (!listsElem) return result;

    const lists = getChildren(listsElem, 'list');
    for (const list of lists) {
      const listPath = getAttr(list, 'path') || '';
      const entries = getChildren(list, 'entry');
      for (const entry of entries) {
        const commit = getChild(entry, 'commit');
        const name = getChildText(entry, 'name') || '';
        result.push({
          name,
          path: listPath ? `${listPath}/${name}` : name,
          kind: (getAttr(entry, 'kind') as 'file' | 'dir') || 'file',
          size: getChildText(entry, 'size') ? parseInt(getChildText(entry, 'size')!, 10) : undefined,
          lastChangedRevision: commit ? parseInt(getAttr(commit, 'revision') || '0', 10) : undefined,
          lastChangedAuthor: commit ? getChildText(commit, 'author') : undefined,
          lastChangedDate: commit && getChildText(commit, 'date') ? new Date(getChildText(commit, 'date')!) : undefined,
        });
      }
    }
  } catch (e) {
    console.error('Failed to parse svn list XML:', e);
  }
  return result;
}

export function parseVersionString(versionStr: string): { major: number; minor: number; full: string } {
  const match = versionStr.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (match) {
    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      full: versionStr.trim(),
    };
  }
  return { major: 0, minor: 0, full: versionStr.trim() };
}
