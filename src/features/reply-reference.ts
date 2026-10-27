import type { Middleware, ReplyTarget, SendMessageOptions } from '@tencent-connect/qqbot-nodejs';

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 2000;
const refs = new Map<string, { ref: string; at: number }>();
/** Namespace references by account, conversation and exact incoming message. */
function key(accountId: string, target: ReplyTarget, msgId: string): string {
  return JSON.stringify([accountId, target.scope, target.targetId, msgId]);
}

/** msg_id authorizes a reply; msgIdx/REFIDX identifies the visible quote. They are not interchangeable. */
export function rememberReplyReferences(accountId: string): Middleware {
  return async (ctx, next) => {
    const m = ctx.message;
    if (m.kind === 'group' && m.msgIdx && m.messageId) {
      const k = key(accountId, m.replyTarget, m.messageId);
      refs.delete(k);
      refs.set(k, { ref: m.msgIdx, at: Date.now() });
      for (const [oldKey, value] of refs) {
        if (Date.now() - value.at > TTL_MS || refs.size > MAX_ENTRIES) refs.delete(oldKey);
        else break;
      }
    }
    await next();
  };
}

/** Prefer ordinary Markdown delivery for formatted text; never combine it with a native quote. */
export function hasMarkdownFormatting(text: string): boolean {
  // Remove escaped punctuation so literal markers do not disable ordinary quotes.
  const value = text.replace(/\\[\\`*_{}\[\]()#+.!>~|-]/g, '');
  return /(?:^|\n) {0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+|`{3,}|~{3,})/.test(value)
    || /`+[^`\n]+`+/.test(value)
    || /(?:\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~)/.test(value)
    || /(?:\*[^*\s](?:[^*\n]*[^*\s])?\*|(?:^|[^a-zA-Z0-9_])_[^_\s](?:[^_\n]*[^_\s])?_(?=$|[^a-zA-Z0-9_]))/.test(value)
    || /!?\[[^\]\n]*\]\([^\n]+\)/.test(value)
    || /(?:^|\n) {0,3}(?:[-*_] *){3,}(?:\n|$)/.test(value)
    || /(?:^|\n)[^\n]+\n {0,3}(?:=+|-+)\s*(?:\n|$)/.test(value)
    || /(?:^|\n) *\|?(?: *:?-{3,}:? *\|)+ *:?-{3,}:? *\|? *(?:\n|$)/.test(value);
}

/** Build a plain-text group quote only for unformatted text with an exact reference. */
export function quotedTextOptions(accountId: string, target: ReplyTarget, text: string): SendMessageOptions | undefined {
  if (target.scope !== 'group' || !target.msgId || hasMarkdownFormatting(text)) return undefined;
  const entry = refs.get(key(accountId, target, target.msgId));
  if (!entry || Date.now() - entry.at > TTL_MS) return undefined;
  return {
    target,
    // Match the SDK's plain-text-only reference lane: some QQ clients duplicate
    // the displayed body when Markdown and a native reference are combined.
    msgType: 0,
    content: text,
    messageReference: { message_id: entry.ref },
  };
}
