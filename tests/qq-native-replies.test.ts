import assert from 'node:assert/strict';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { rememberReplyReferences, quotedTextOptions } from '../src/features/reply-reference.js';
import { QQBotGateway } from '../src/gateway/qqbot-gateway.js';

const account = { accountId: 'test-account', markdownSupport: true, config: {} } as any;
async function main() {
  await rememberReplyReferences(account.accountId)({ message: {
    kind: 'group', messageId: 'question', msgIdx: 'REFIDX_question',
    replyTarget: { scope: 'group', targetId: 'group-a' },
  } } as any, async () => {});
  const target = { scope: 'group', targetId: 'group-a', msgId: 'question' } as const;
  const options = quotedTextOptions(account.accountId, target, 'Answer', true)!;
  assert.equal(options.messageReference?.message_id, 'REFIDX_question', 'reply must quote the triggering message');
  assert.equal(options.markdown?.content, 'Answer');
  assert.equal(quotedTextOptions('another-account', target, 'Answer', true), undefined);
  assert.equal(quotedTextOptions(account.accountId, { ...target, targetId: 'group-b' }, 'Answer', true), undefined);
  assert.equal(quotedTextOptions(account.accountId, { ...target, scope: 'c2c' }, 'Answer', true), undefined);
  assert.equal(quotedTextOptions(account.accountId, { ...target, msgId: 'unknown' }, 'Answer', true), undefined);
  assert.equal(quotedTextOptions(account.accountId, target, 'Answer', false)?.content, 'Answer');

  let wire: any;
  await QQBot.prototype.send.call({ messageApi: { sendRaw: async (_scope: any, _peer: any, _creds: any, body: any) => {
    wire = body; return { id: 'response' };
  } } } as any, options);
  assert.deepEqual(wire.message_reference, { message_id: 'REFIDX_question' });
  assert.equal(wire.msg_id, 'question');
  assert.equal(wire.msg_type, 2);

  const gateway = Object.create(QQBotGateway.prototype) as any;
  gateway.account = account; gateway.textTimeout = 0;
  gateway.bot = { send: async (o: any) => { wire = o; return { id: 'sent' }; },
    sendText: async () => { throw new Error('native quote path was bypassed'); } };
  assert.equal((await gateway.sendText({ scope: 'group', targetId: 'group-a' }, 'Answer', { msgId: 'question' })).id, 'sent');
  assert.equal(wire.messageReference.message_id, 'REFIDX_question');
  console.log('QQ native reply checks passed: exact triggering message, Markdown/plain text, group/account isolation, fallback and SDK wire body.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
