import type { Middleware, MiddlewareContext } from '@tencent-connect/qqbot-nodejs';

// A context may already represent an earlier collected batch when it reaches
// the SDK busy queue. Snapshot its own attachments before aggregating them.
const ownAttachments = Symbol('batch-own-attachments');

export function mergeMessageContexts(contexts: MiddlewareContext[]): MiddlewareContext {
  const seen = new Set<MiddlewareContext>();
  const messages: MiddlewareContext[] = [];
  for (const ctx of contexts) {
    const previous = ctx.state.mergedMessages as MiddlewareContext[] | undefined;
    for (const item of previous?.length ? previous : [ctx]) {
      if (!seen.has(item)) { seen.add(item); messages.push(item); }
    }
  }
  const last = messages[messages.length - 1]!;
  const attachments = messages.flatMap((ctx) => {
    const state = ctx.state as any;
    if (!(ownAttachments in state)) state[ownAttachments] = [...(ctx.message.attachments ?? [])];
    return state[ownAttachments] as NonNullable<MiddlewareContext['message']['attachments']>;
  });
  if (messages.length > 1) last.state.mergedMessages = messages;
  if (attachments.length) last.message.attachments = attachments;
  delete last.state.assembledBody;
  return last;
}

interface Waiting {
  ctx: MiddlewareContext;
  next: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}
interface Batch {
  firstAt: number;
  entries: Waiting[];
  timer?: ReturnType<typeof setTimeout>;
}

/** Collect before the existing serial guard; never run downstream twice. */
export function createGroupMessageBatch(options: {
  quietMs?: number;
  maxWaitMs?: number;
  maxMessages?: number;
} = {}): { middleware: Middleware; dispose: () => void } {
  const quietMs = options.quietMs ?? 3000;
  const maxWaitMs = options.maxWaitMs ?? 8000;
  const maxMessages = options.maxMessages ?? 50;
  const batches = new Map<string, Batch>();
  let disposed = false;

  function cancel(key: string) {
    const batch = batches.get(key);
    if (!batch) return;
    clearTimeout(batch.timer);
    batches.delete(key);
    for (const entry of batch.entries) {
      entry.ctx.stop('group-batch-cancelled');
      entry.resolve();
    }
  }

  async function flush(key: string, batch: Batch) {
    if (batches.get(key) !== batch) return;
    clearTimeout(batch.timer);
    batches.delete(key);
    try {
      mergeMessageContexts(batch.entries.map((entry) => entry.ctx));
      const survivor = batch.entries[batch.entries.length - 1]!;
      await survivor.next();
      for (const entry of batch.entries) entry.resolve();
    } catch (error) {
      for (const entry of batch.entries) entry.reject(error);
    }
  }

  const middleware: Middleware = async (ctx, next) => {
    if (disposed) { ctx.stop('group-batch-disposed'); return; }
    if (ctx.message.kind !== 'group') { await next(); return; }
    const key = ctx.message.replyTarget.targetId;
    if ((ctx.message.content ?? '').trim() === '/stop') {
      cancel(key);
      await next();
      return;
    }
    let batch = batches.get(key);
    if (!batch) {
      batch = { firstAt: Date.now(), entries: [] };
      batches.set(key, batch);
    }
    const current = batch;
    await new Promise<void>((resolve, reject) => {
      current.entries.push({ ctx, next, resolve, reject });
      clearTimeout(current.timer);
      if (current.entries.length >= maxMessages) {
        void flush(key, current);
      } else {
        const delay = Math.max(0, Math.min(quietMs, maxWaitMs - (Date.now() - current.firstAt)));
        current.timer = setTimeout(() => { void flush(key, current); }, delay);
      }
    });
  };
  return {
    middleware,
    dispose: () => { disposed = true; for (const key of batches.keys()) cancel(key); },
  };
}
