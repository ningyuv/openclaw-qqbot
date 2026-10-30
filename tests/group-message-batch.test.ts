import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { concurrencyGuard } from '@tencent-connect/qqbot-nodejs';
import { createGroupMessageBatch, mergeMessageContexts } from '../src/middleware/group-message-batch.js';
import { assembleBody } from '../src/dispatch/body-assembler.js';
import { attachmentProcessor } from '../src/middleware/attachment.js';
import { downloadFixture } from './helpers/media-download.js';

const message = (id: string, extra: any = {}): any => ({
  state: {}, log: { debug() {}, warn() {}, info() {}, error() {} }, stop() {},
  message: { messageId: id, content: id, kind: 'group', senderId: 'alice',
    replyTarget: { scope: 'group', targetId: 'group-a', msgId: id }, ...extra },
});
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function main() {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  try {
    // Text, then an image: no dispatch until the quiet window closes.
    let batch = createGroupMessageBatch(); const calls: any[] = [];
    const a = message('look at this'); a.state.mention = { wasMentioned: true };
    const b = message('', { attachments: [{ content_type: 'image/png', url: 'https://example.com/fixture.png' }] });
    const p1 = batch.middleware(a, async () => { calls.push(a); });
    mock.timers.tick(2500); await settle(); assert.equal(calls.length, 0);
    const p2 = batch.middleware(b, async () => { calls.push(b); });
    mock.timers.tick(2999); await settle(); assert.equal(calls.length, 0);
    mock.timers.tick(1); await Promise.all([p1, p2]);
    assert.deepEqual(calls, [b]); assert.deepEqual(b.state.mergedMessages, [a, b]);
    assert.equal(b.message.attachments.length, 1);
    const assembled = assembleBody(b, b.message, { accountId: 'test', config: {} } as any);
    assert.match(assembled.agentBody, /look at this/); assert.match(assembled.agentBody, /\(@you\)/);
    batch.dispose();

    // The collector + real busy merge must flatten all text and keep each image once.
    const c = message('second request', { attachments: [{ url: 'https://example.com/second.png', content_type: 'image/png' }] });
    const d = message('second picture', { attachments: [{ url: 'https://example.com/third.png', content_type: 'image/png' }] });
    const second = mergeMessageContexts([c, d]);
    const merge = concurrencyGuard({ strategy: 'merge', maxQueue: 50, onMerge: mergeMessageContexts });
    let release!: () => void; const blocked = new Promise<void>(r => { release = r; });
    const observed: any[] = [];
    const owner = merge(message('busy'), () => blocked);
    const queued1 = merge(b, async () => { observed.push(b); });
    const queued2 = merge(second, async () => { observed.push(second); });
    await settle(); assert.equal(observed.length, 0);
    release(); await Promise.all([owner, queued1, queued2]);
    assert.deepEqual(observed, [d]); assert.deepEqual(d.state.mergedMessages, [a, b, c, d]);
    assert.equal(d.message.attachments.length, 3);
    mergeMessageContexts([d]); assert.equal(d.message.attachments.length, 3, 'no nested duplication');
    const body = assembleBody(d, d.message, { accountId: 'test', config: {} } as any).agentBody;
    for (const text of ['look at this', 'second request', 'second picture']) assert.match(body, new RegExp(text));
    assert.match(body, /\(@you\)/);
    // Pass the combined images through the real attachment processor, not only filenames.
    const downloads: string[] = [];
    downloadFixture.handler = async ({ url }) => { downloads.push(url); return { path: `/tmp/qqbot-regression/${downloads.length}.png` }; };
    await attachmentProcessor({ getRuntime: () => ({ config: { loadConfig: () => ({}) } }) } as any)(d, async () => {});
    assert.equal(d.state.processedAttachments.localMediaPaths.length, 3);
    assert.equal(new Set(downloads).size, 3);
    downloadFixture.handler = undefined;

    // General window: multiple text messages, different senders and a file.
    batch = createGroupMessageBatch(); const genericCalls: any[] = [];
    const text1 = message('first requirement');
    const text2 = message('additional requirement', { senderId: 'bob', senderName: 'Bob' });
    const file = message('document', { attachments: [{ url: 'https://example.com/spec.pdf', content_type: 'application/pdf' }] });
    const general = [text1, text2, file].map(ctx => batch.middleware(ctx, async () => { genericCalls.push(ctx); }));
    mock.timers.tick(3000); await Promise.all(general);
    assert.deepEqual(genericCalls, [file]);
    const genericBody = assembleBody(file, file.message, { accountId: 'test', config: {} } as any).agentBody;
    assert.match(genericBody, /first requirement/); assert.match(genericBody, /additional requirement/);
    for (const ctx of [text1, text2, file]) assert.ok(genericBody.includes(`[Source message_id: ${JSON.stringify(ctx.message.messageId)}]`));
    assert.match(genericBody, /Bob/); assert.match(genericBody, /alice/);
    assert.equal(file.message.attachments[0].content_type, 'application/pdf'); batch.dispose();

    // Sustained messages cannot postpone the batch beyond eight seconds.
    batch = createGroupMessageBatch(); let count = 0; const promises: Promise<void>[] = [];
    for (let i = 0; i < 4; i++) {
      promises.push(batch.middleware(message(String(i)), async () => { count++; }));
      mock.timers.tick(2000); await settle();
    }
    await Promise.all(promises); assert.equal(count, 1); batch.dispose();

    // Different groups have independent quiet deadlines; private chats are immediate.
    batch = createGroupMessageBatch(); const seen: string[] = [];
    const ga = batch.middleware(message('a'), async () => { seen.push('a'); });
    mock.timers.tick(1500);
    const gb = batch.middleware(message('b', { replyTarget: { scope: 'group', targetId: 'group-b' } }), async () => { seen.push('b'); });
    await batch.middleware(message('dm', { kind: 'c2c' }), async () => { seen.push('dm'); });
    assert.deepEqual(seen, ['dm']); mock.timers.tick(1500); await settle();
    assert.deepEqual(seen, ['dm', 'a']); mock.timers.tick(1500); await Promise.all([ga, gb]);
    assert.deepEqual(seen, ['dm', 'a', 'b']); batch.dispose();

    // /stop cancels pending input and bypasses the delay. Shutdown cancels timers.
    batch = createGroupMessageBatch(); count = 0;
    const pending = batch.middleware(message('pending'), async () => { count++; });
    await batch.middleware(message('/stop'), async () => { count += 10; }); await pending;
    assert.equal(count, 10); mock.timers.tick(10000); await settle(); assert.equal(count, 10);
    const pending2 = batch.middleware(message('pending2'), async () => { count++; });
    batch.dispose(); await pending2; mock.timers.tick(10000); await settle(); assert.equal(count, 10);

    // Capacity flushes rather than dropping the accumulated input.
    batch = createGroupMessageBatch({ maxMessages: 2 }); count = 0;
    const cap1 = batch.middleware(message('one'), async () => { count++; });
    const cap2 = batch.middleware(message('two'), async () => { count++; });
    await Promise.all([cap1, cap2]); assert.equal(count, 1); batch.dispose();

    // Downstream failures propagate to the waiting middleware, with no replay.
    batch = createGroupMessageBatch(); const error = new Error('downstream failed');
    const bad = batch.middleware(message('bad'), async () => { throw error; });
    const rejected = assert.rejects(bad, e => e === error);
    mock.timers.tick(3000); await rejected; batch.dispose();
    console.log('Group batching: text/image delay, busy flattening, media preparation, mentions, deadline, isolation, stop, cleanup, capacity and failure checks passed');
  } finally { mock.timers.reset(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
