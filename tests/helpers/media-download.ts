// Offline fixture: fail if the media pipeline accidentally tries any other URL.
export async function downloadRemoteMedia(opts: { url: string; originalFilename?: string }) {
  if (!opts.url.startsWith('https://example.com/')) throw new Error('Unexpected test URL');
  return { path: `/tmp/qqbot-regression/${opts.originalFilename}` };
}
