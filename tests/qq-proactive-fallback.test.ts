import assert from 'node:assert/strict';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { ApiError } from '@tencent-connect/qqbot-nodejs/protocol';
import { withExpiredReplyFallback } from '../src/gateway/expired-reply-fallback.js';
import { QQBotGateway } from '../src/gateway/qqbot-gateway.js';
import { rememberReplyReferences } from '../src/features/reply-reference.js';
import { cacheMsgId } from '../src/features/msgid-cache.js';

const account = { accountId: 'proactive-test', appId: 'app', markdownSupport: true, config: {} } as any;
const target = { scope: 'group', targetId: 'peer', msgId: 'old' } as const;
const expired = (path = '/v2/groups/peer/messages', status = 400) => new ApiError('msgid已经过期,不能回复', status, path);

async function main() {
  for (const scope of ['group', 'c2c'] as const) {
    const t = { ...target, scope };
    const calls: any[] = [];
    await withExpiredReplyFallback(t, async next => {
      calls.push(next);
      if (next.msgId) throw expired(`/v2/${scope === 'group' ? 'groups' : 'users'}/peer/messages`);
      return 'ok';
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], { scope, targetId: 'peer' });
    assert.equal(t.msgId, 'old', 'never mutate caller-owned targets');
  }
  for (const error of [
    expired('/v2/groups/other/messages'), expired('/v2/groups/peer/files'), expired(undefined, 500),
    expired(undefined, 429), new Error('msgid already expired'),
    new ApiError('permission denied', 403, '/v2/groups/peer/messages'),
    new ApiError('message_reference expired', 400, '/v2/groups/peer/messages'),
    new ApiError('timeout', 0, '/v2/groups/peer/messages'),
  ]) {
    let calls = 0;
    await assert.rejects(withExpiredReplyFallback(target, async () => { calls++; throw error; }), e => e === error);
    assert.equal(calls, 1, 'no retry for ambiguous, unrelated or wrong-peer failures');
  }
  let retries = 0;
  const denied = new ApiError('proactive quota exhausted', 403, '/v2/groups/peer/messages');
  await assert.rejects(withExpiredReplyFallback(target, async t => {
    retries++; if (t.msgId) throw expired(); throw denied;
  }), e => e === denied);
  assert.equal(retries, 2, 'proactive failures propagate once, never loop');

  await rememberReplyReferences(account.accountId)({ message: {
    kind: 'group', messageId: 'old', msgIdx: 'REFIDX_old',
    replyTarget: { scope: 'group', targetId: 'peer' },
  } } as any, async () => {});
  cacheMsgId('group', 'peer', 'newer-cached');
  for (const text of ['Plain answer', '**Markdown answer**']) {
    const g = Object.create(QQBotGateway.prototype) as any;
    g.account = account; g.textTimeout = 0; g.log = { warn() {} };
    const calls: any[] = [];
    g.bot = {
      send: async (o: any) => { calls.push(o); throw expired(); },
      sendText: async (t: any, content: string) => {
        calls.push({ target: t, content });
        if (t.msgId) throw expired();
        return { id: 'proactive-text' };
      },
    };
    assert.equal((await g.sendText(target, text, { msgId: 'old' })).id, 'proactive-text');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].target.msgId, 'old');
    assert.deepEqual(calls[1].target, { scope: 'group', targetId: 'peer' });
    assert.equal(calls[1].messageReference, undefined);
  }

  // Real SDK wire serialization for proactive media: one upload, same file_info,
  // original peer/caption preserved, no expired msg_id and no quote in retry.
  for (const kind of ['image', 'video', 'file', 'voice-path', 'voice-url', 'voice-base64']) {
    const g = Object.create(QQBotGateway.prototype) as any;
    g.account = account; g.mediaTimeout = 0; g.log = { warn() {} };
    const bodies: any[] = []; let uploads = 0;
    g.bot = {
      messageApi: { sendRaw: async (_scope: any, peer: any, _creds: any, body: any) => {
        assert.equal(peer, 'peer'); bodies.push(body);
        if (body.msg_id) throw expired();
        return { id: 'proactive-media' };
      } },
      send: QQBot.prototype.send,
      sendText: async () => ({ id: 'unused' }),
      uploadMedia: async () => { uploads++; return { file_info: 'uploaded-file', file_uuid: 'uuid' }; },
      openStream: () => { throw new Error('unexpected stream'); },
    };
    g.wrapBotSendForRefIndex();
    const opts = { msgId: 'old', text: 'caption' };
    let result;
    if (kind === 'image') result = await g.sendMedia(target, '/tmp/image.png', opts);
    else if (kind === 'video') result = await g.sendVideo(target, '/tmp/video.mp4', opts);
    else if (kind === 'file') result = await g.sendFile(target, '/tmp/file.zip', { ...opts, fileName: 'file.zip' });
    else result = await g.sendVoice(target, kind === 'voice-path' ? { localPath: '/tmp/voice.silk' }
      : kind === 'voice-url' ? { url: 'https://example.com/voice.silk' } : { base64: 'YWJj' }, opts);
    assert.equal(result.id, 'proactive-media');
    assert.equal(uploads, 1, 'do not upload a second copy on message rejection');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].msg_id, 'old');
    assert.equal(bodies[1].msg_id, undefined);
    assert.equal(bodies[1].message_reference, undefined);
    assert.equal(bodies[1].msg_type, 7);
    assert.deepEqual(bodies[1].media, bodies[0].media);
    assert.equal(bodies[1].content, 'caption');
  }
  console.log('Proactive fallback checks passed: exact rejection only, immutable peers, text/Markdown/quotes, all media, upload reuse, bounded retry.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
