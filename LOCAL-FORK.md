# QQ local fork

User-authorized fork of tencent-connect/openclaw-qqbot, upstream commit 8998881, official version 2.0.4.
Local package: @ningyuv/openclaw-qqbot 2.0.4-ningyuv.7. Plugin ID and QQ channel ID remain unchanged.
Branch: fix/qq-media-and-native-replies. GitHub fork: https://github.com/ningyuv/openclaw-qqbot
Review branch: https://github.com/ningyuv/openclaw-qqbot/tree/fix/qq-media-and-native-replies

Changes:
- Access control precedes group history/ref-index capture.
- Retain attachment metadata and msgIdx in recent group history and the persisted ref index before mentionGate.
- When a message triggers a reply, resolve quoted pictures (including filename-only quotes with a cached original), download them and recent history pictures, and pass real image paths/MIME types to OpenClaw.
- Respect the configured mention gate. As of2026-10-30, selective participation uses defaultRequireMention=false and surfaces.qqbot.silentReply.group=allow; unmentioned authorized group input can invoke the model, which should mostly stay silent.
- Context images: explicit quote first, most recent four buffered history pictures, at most eight context images total. Image downloads have a 20 MiB / 15 second limit. Other upstream attachment limits remain unchanged.
- Native group text replies carry message_reference.message_id=the triggering message's msgIdx/REFIDX, while retaining msg_id. Reply reference lookup is scoped by account, peer and exact message ID, with a ten-minute TTL.
- Messages containing Markdown formatting use ordinary SDK delivery (account Markdown mode), without a native quote. Plain text retains native quotes. This is the user-selected policy as of 2026-10-27.
- Native quoted replies always use plain text (msg_type=0 with content and no markdown), matching the SDK reference lane. Some mobile QQ clients displayed one Markdown+reference message as concatenated duplicate text despite a single successful send. Ordinary, unquoted messages retain the account Markdown setting. Live client validation after this change is pending.
- Native quotes use explicit reply IDs only; cached passive-reply IDs do not select a quote.
- Explicit HTTP 400/422 unsupported-reference rejections retry ordinary text once with the original quoted target, even if the peer cache advanced; network/timeouts/rate-limit/server errors do not retry.
- Context images download concurrently while preserving label order; filename-only recovery requires the exact quoted message reference.
- Missing reference IDs fall back to upstream text sending; no fabricated references or proactive test messages.

Validation:
- npm run test:qq-fixes: separate image and native-reply regression suites plus 18 body assembly tests.
- npm run typecheck; npm run build; git diff --check.
- One pre-existing body test expected retired history tags; updated its assertion to the upstream implementation's existing tags and corrected its type-only import path.
- Deployed through the official local-archive installer; QQ connected, Weixin and Telegram remain running.
- Actual QQ rendering and model recognition require a fresh user-originated image/mention. Offline tests do not establish end-to-end delivery.

Limitations:
- Pictures never received by the plugin cannot be recovered. Old filename-only messages may lack the original URL.
- Background chatter stores attachment URLs, not image binaries. Expired signed URLs still require resending the picture.
- Group history follows historyLimit (0 disables), and is cleared after a completed dispatch as upstream does.
- The package is a custom local fork, so upstream official provenance is intentionally unavailable. Do not mislabel it as trusted official code.

Operation:
- Source: /root/qqbot-fork
- Installed plugin: /root/.openclaw/extensions/openclaw-qqbot
- Backups, original verified official package, install/status evidence: /root/qqbot-fork-backup-20261024
- Future general plugin updates must preserve this fork. Review/rebase upstream changes and rebuild the package deliberately.
- Roll back using the official installer for @tencent-connect/openclaw-qqbot@2.0.4 with --force, then verify channel status. Do not restore the entire shared state database over newer conversations/configuration.
- No Docker image was built or changed for this work.

Markdown image delivery: inline HTTP(S) Markdown images outside code blocks/spans are converted to image sends through the existing validated media path. Successful images are removed from the text; failures retain the original link. Inline/structured media and block/final deliveries share deduplication. Reply text uses ordinary Markdown delivery when formatting is detected; unformatted text uses native quotes. The recent backer-rod source URL returned HTTP 403 from this server, so extraction cannot guarantee delivery of that particular source.

Expired passive reply fallback (2026-10-29): user confirms proactive-message permission. Text and all media retry once as proactive after a structured HTTP400 rejection explicitly saying msg_id expired, on the exact original peer messages endpoint. Clear msgId and native quote, preserve original peer/account and body/Markdown behavior. Media uploads once with srvSendMsg:false, reuses file_info across the rejected passive send and proactive retry, and retains outgoing reference indexing. Do not retry network/timeout/5xx/rate-limit, unrelated errors, upload failures, wrong-peer endpoints, or failed proactive delivery. Platform proactive permission/quota errors propagate.

General inbound group batching (2026-10-30): all eligible group messages pass through a 3-second quiet window, bounded by8seconds from the first message or50messages. Text, images, files and other attachments use the same window. Different groups collect independently; direct messages have no new delay. Existing access checks, rate limits, mention gate and plugin commands run before collection. /stop cancels pending group collection and bypasses the wait; gateway shutdown/abort clears pending timers. The existing busy merge flattens collected batches, preserving original order, sender identities, each message’s mention marker and original attachments without nested duplication. Attachment processing occurs before the merged turn reaches AI. There is no wait for uploads that have not yet arrived after the collection deadline, and invalid/expired image URLs still require resend. Regression tests cover quiet/reset/deadline, mixed senders and text/file input, text+image recognition preparation, busy queue flattening, urgent stop, cleanup, capacity and error propagation. No custom image or new daemon.

Separate outgoing topic replies (2026-10-30): inbound batching remains enabled. Every merged input carries its original source message_id for message-tool replyTo targeting. Deployment sets deliverDebounce.enabled=false and adds Anya message tool through tools.alsoAllow (existing coding tools preserved). QQ group prompt requires separate message sends for independent people/topics, same-topic followups may share one answer; only current source group is authorized, use each topic’s own id, end NO_REPLY after successful sends to prevent duplicate final. Plain text native quote/Markdown ordinary-delivery compatibility still applies. The screenshot was confirmed to be one model-authored multi-topic final, not a debounce join. Semantic topic separation is an agent rule, not a deterministic sentence/paragraph splitter; no live external test messages sent.
