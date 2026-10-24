import assert from 'node:assert/strict';
import { extractMarkdownImages, removeDeliveredImages } from '../src/outbound/markdown-images.js';

const text = 'before ![product](https://example.com/backer-rod.png) after';
const images = extractMarkdownImages(text);
assert.deepEqual(images.map(i => i.url), ['https://example.com/backer-rod.png']);
assert.equal(removeDeliveredImages(text, images, new Set([images[0]!.url])), 'before  after');
assert.equal(removeDeliveredImages(text, images, new Set()), text);
assert.deepEqual(extractMarkdownImages('![x](https://example.com/a_(b).png "title")').map(i => i.url), ['https://example.com/a_(b).png']);
assert.deepEqual(extractMarkdownImages('![x](<https://example.com/a_(b).png>)').map(i => i.url), ['https://example.com/a_(b).png']);
assert.deepEqual(extractMarkdownImages('![x](https://example.com/a\\(b\\).png)').map(i => i.url), ['https://example.com/a(b).png']);
for (const example of [
  '\\![escaped](https://example.com/a.png)',
  '```md\n![x](https://example.com/a.png)\n```',
  '~~~md\n![x](https://example.com/a.png)\n~~~',
  '```md\n![x](https://example.com/a.png)',
  '`![x](https://example.com/a.png)`',
  '[normal link](https://example.com/a.png)',
  '![local](file:///etc/passwd)',
  '![data](data:image/png;base64,AAAA)',
  '![invalid](javascript:alert(1))',
  '![creds](https://user:password@example.com/a.png)',
  '![unfinished](https://example.com/a.png',
]) assert.deepEqual(extractMarkdownImages(example), [], example);
console.log('Markdown image parser checks passed.');
