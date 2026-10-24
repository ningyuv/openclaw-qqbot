export interface MarkdownImage {
  start: number;
  end: number;
  url: string;
}

/** Locate code spans/fences so literal Markdown examples never become media sends. */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    if (i === 0 || text[i - 1] === '\n') {
      const opening = text.slice(i).match(/^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/);
      if (opening) {
        const fence = opening[1]!;
        const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*\\r?$`, 'gm');
        closing.lastIndex = i + opening[0].length;
        const match = closing.exec(text);
        const end = match ? match.index + match[0].length : text.length;
        ranges.push([i, end]); i = end; continue;
      }
    }
    if (text[i] === '`' && !isEscaped(text, i)) {
      const run = text.slice(i).match(/^`+/)![0];
      const end = text.indexOf(run, i + run.length);
      if (end >= 0) {
        ranges.push([i, end + run.length]); i = end + run.length; continue;
      }
      i += run.length; continue;
    }
    i++;
  }
  return ranges;
}

/** An odd number of preceding backslashes escapes the following Markdown token. */
function isEscaped(text: string, offset: number): boolean {
  let slashes = 0;
  for (let i = offset - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

/** Extract inline HTTP(S) images; preserve code, ordinary links and unsupported destinations verbatim. */
export function extractMarkdownImages(text: string): MarkdownImage[] {
  const protectedRanges = codeRanges(text);
  const images: MarkdownImage[] = [];
  const pattern = /!\[((?:\\.|[^\]\\])*)\]\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const start = match.index;
    if (isEscaped(text, start) || protectedRanges.some(([a, b]) => start >= a && start < b)) continue;
    let pos = pattern.lastIndex;
    while (text[pos] === ' ' || text[pos] === '\t') pos++;
    let raw: string;
    if (text[pos] === '<') {
      const close = text.indexOf('>', pos + 1);
      if (close < 0) continue;
      raw = text.slice(pos + 1, close); pos = close + 1;
    } else {
      const begin = pos;
      let depth = 0;
      while (pos < text.length) {
        const ch = text[pos];
        if (ch === '\\' && pos + 1 < text.length) { pos += 2; continue; }
        if (/\s/.test(ch!)) break;
        if (ch === '(') depth++;
        if (ch === ')') { if (depth === 0) break; depth--; }
        pos++;
      }
      if (depth !== 0) continue;
      raw = text.slice(begin, pos);
    }
    const suffix = text.slice(pos).match(/^[ \t]*(?:(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*')[ \t]*)?\)/);
    if (!suffix || /[\r\n]/.test(raw)) continue;
    const url = raw.replace(/\\([\\()[\]<> ])/g, '$1');
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) continue;
    } catch { continue; }
    const end = pos + suffix[0].length;
    images.push({ start, end, url });
    pattern.lastIndex = end;
  }
  return images;
}

/** Remove only successfully delivered images; retain failed/unsupported image links for the reader. */
export function removeDeliveredImages(text: string, images: MarkdownImage[], delivered: Set<string>): string {
  let out = ''; let from = 0;
  for (const image of images) {
    if (!delivered.has(image.url)) continue;
    out += text.slice(from, image.start); from = image.end;
  }
  return (out + text.slice(from)).trim();
}
