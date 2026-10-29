import { ApiError } from '@tencent-connect/qqbot-nodejs/protocol';
import type { ReplyTarget } from '@tencent-connect/qqbot-nodejs';

/** Only an explicit rejection on this peer's message endpoint proves it was not delivered. */
export function isExpiredReplyRejection(error: unknown, target: ReplyTarget): boolean {
  if (!(error instanceof ApiError) || error.httpStatus !== 400 || !target.msgId) return false;
  const peer = target.scope === 'group' ? 'groups' : 'users';
  if (error.path !== `/v2/${peer}/${target.targetId}/messages`) return false;
  const message = `${error.bizMessage ?? ''} ${error.message}`;
  return /(?:msg[ _-]?id|消息\s*id|回复消息)[^\n]{0,32}(?:已(?:经)?过期|expired)|(?:expired|过期)[^\n]{0,32}msg[ _-]?id/i.test(message);
}

/** Retry once as a proactive message, preserving the peer and bypassing cached reply IDs. */
export async function withExpiredReplyFallback<T>(
  target: ReplyTarget,
  send: (target: ReplyTarget) => Promise<T>,
  warn?: (message: string) => void,
): Promise<T> {
  try {
    return await send(target);
  } catch (error) {
    if (!isExpiredReplyRejection(error, target)) throw error;
    warn?.('QQ rejected an expired reply ID; sending this result once as a proactive message');
    const { msgId: _expired, ...proactive } = target;
    // Deliberately outside the catch: permission/quota failures or ambiguous failures never loop.
    return await send(proactive);
  }
}
