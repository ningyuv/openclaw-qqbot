/**
 * 出站投递车道：static-blocks 与 native-stream 同时只跑一条。
 *
 * kind=block 文本在流未占用时立即发；流已占用则跳过。
 * kind=tool 只转发新媒体。
 * kind=final 与已发 block 去重；流占用时收尾后跳过静态文本。
 */
import type { PluginLogger } from '../utils/plugin-logger.js';
import { extractMarkdownImages, removeDeliveredImages } from '../outbound/markdown-images.js';
import { formatLogTextPreview } from '../utils/log-text-preview.js';
import type {
  DeliverContext,
  DeliverInfo,
  DeliverPayload,
} from '../outbound/deliver-pipeline.js';

export type StreamTextOwner = {
  hasStarted: boolean;
  shouldFallbackToStatic: boolean;
  isTerminal: boolean;
  finalize(): Promise<void>;
};

export type DispatchDeliverState = {
  ctx: DeliverContext;
  streamingController: StreamTextOwner | null;
  deliveredMediaUrls: Set<string>;
  deliveredTexts: Set<string>;
  log?: PluginLogger;
  deliverReply: (
    payload: DeliverPayload,
    info: DeliverInfo | undefined,
    ctx: DeliverContext,
  ) => Promise<void>;
};

export function streamOwnsText(controller: StreamTextOwner | null): boolean {
  return Boolean(controller?.hasStarted && !controller.shouldFallbackToStatic);
}

export async function deliverDispatchPayload(
  payload: DeliverPayload,
  info: DeliverInfo | undefined,
  state: DispatchDeliverState,
): Promise<void> {
  const kind = info?.kind;
  const originalText = payload.text?.trim() ?? '';
  if (kind !== 'tool') payload = await forwardInlineImages(payload, state);
  const text = payload.text?.trim() ?? '';
  const textAlreadyDelivered = state.deliveredTexts.has(text) || state.deliveredTexts.has(originalText);
  const hasMedia = !!(payload.mediaUrl || payload.mediaUrls?.length);
  const sendReply = state.deliverReply;
  state.log?.debug(
    `deliver kind=${kind ?? 'none'} textLen=${text.length} voice=${!!payload.audioAsVoice} media=${hasMedia}${formatLogTextPreview(text)}`,
  );

  if (kind === 'tool') {
    await forwardMediaUrls(payload, state);
    return;
  }

  if (originalText && !text && !hasMedia && !payload.audioAsVoice && !streamOwnsText(state.streamingController)) return;

  if (kind === 'block') {
    if (payload.audioAsVoice) {
      await sendReply(payload, info, state.ctx);
      if (text) state.deliveredTexts.add(text);
      return;
    }
    await forwardMediaUrls(payload, state);
    if (streamOwnsText(state.streamingController) || !text || textAlreadyDelivered) {
      return;
    }
    await sendReply({ text }, info, state.ctx);
    state.deliveredTexts.add(text);
    state.deliveredTexts.add(originalText);
    return;
  }

  if (streamOwnsText(state.streamingController)) {
    if (state.streamingController && !state.streamingController.isTerminal) {
      await state.streamingController.finalize();
    }
    if (!state.streamingController?.shouldFallbackToStatic) {
      return;
    }
    state.log?.warn(`streaming fallback to static`);
  }

  if (text && textAlreadyDelivered && !hasMedia && !payload.audioAsVoice) {
    return;
  }

  const filteredPayload = filterDeliveredMedia(payload, state.deliveredMediaUrls);
  const payloadToSend = text && textAlreadyDelivered
    ? { ...filteredPayload, text: undefined }
    : filteredPayload;
  await sendReply(payloadToSend, info, state.ctx);
  if (text) { state.deliveredTexts.add(text); state.deliveredTexts.add(originalText); }
  for (const u of payloadToSend.mediaUrls ?? []) state.deliveredMediaUrls.add(u);
  if (payloadToSend.mediaUrl) state.deliveredMediaUrls.add(payloadToSend.mediaUrl);
}

export async function deliverDispatchPayloadSafe(
  payload: DeliverPayload,
  info: DeliverInfo | undefined,
  state: DispatchDeliverState,
): Promise<void> {
  try {
    await deliverDispatchPayload(payload, info, state);
  } catch (err) {
    state.log?.error(`deliver error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Send Markdown images through the existing validated media path, once per turn. */
async function forwardInlineImages(payload: DeliverPayload, state: DispatchDeliverState): Promise<DeliverPayload> {
  const text = payload.text ?? '';
  const images = extractMarkdownImages(text);
  for (const url of new Set(images.map(image => image.url))) {
    if (state.deliveredMediaUrls.has(url)) continue;
    try {
      const result = await state.ctx.sendMedia(state.ctx.qualifiedTarget, url, { mediaKind: 'image' });
      if (result.error) { state.log?.error(`inline image send failed: ${result.error}`); continue; }
      state.deliveredMediaUrls.add(url);
    } catch (err) {
      state.log?.error(`inline image send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return images.length ? { ...payload, text: removeDeliveredImages(text, images, state.deliveredMediaUrls) } : payload;
}

async function forwardMediaUrls(
  payload: DeliverPayload,
  state: DispatchDeliverState,
): Promise<void> {
  const urls: string[] = [];
  if (payload.mediaUrls?.length) urls.push(...payload.mediaUrls);
  if (payload.mediaUrl && !urls.includes(payload.mediaUrl)) urls.push(payload.mediaUrl);
  const newUrls = urls.filter((u) => !state.deliveredMediaUrls.has(u));
  for (const url of newUrls) {
    try {
      await state.ctx.sendMedia(state.ctx.qualifiedTarget, url, { text: '' });
      state.deliveredMediaUrls.add(url);
    } catch (err) {
      state.log?.error(`media forward failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function filterDeliveredMedia(
  payload: DeliverPayload,
  delivered: Set<string>,
): DeliverPayload {
  if (delivered.size === 0) return payload;
  return {
    ...payload,
    mediaUrl: payload.mediaUrl && !delivered.has(payload.mediaUrl) ? payload.mediaUrl : undefined,
    mediaUrls: payload.mediaUrls?.filter((u) => !delivered.has(u)),
  };
}
