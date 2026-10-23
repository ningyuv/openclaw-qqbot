# QQ local fork

User-authorized fork of tencent-connect/openclaw-qqbot, upstream commit 8998881, official version 2.0.4.
Local package: @ningyuv/openclaw-qqbot 2.0.4-ningyuv.2. Plugin ID and QQ channel ID remain unchanged.
Branch: fix/qq-media-and-native-replies. GitHub fork: https://github.com/ningyuv/openclaw-qqbot
Review branch: https://github.com/ningyuv/openclaw-qqbot/tree/fix/qq-media-and-native-replies

Changes:
- Access control precedes group history/ref-index capture.
- Retain attachment metadata and msgIdx in recent group history and the persisted ref index before mentionGate.
- When a message triggers a reply, resolve quoted pictures (including filename-only quotes with a cached original), download them and recent history pictures, and pass real image paths/MIME types to OpenClaw.
- Keep mentionGate enabled. Unmentioned chatter never invokes the agent or downloads attachments.
- Context images: explicit quote first, most recent four buffered history pictures, at most eight context images total. Image downloads have a 20 MiB / 15 second limit. Other upstream attachment limits remain unchanged.
- Native group text replies carry message_reference.message_id=the triggering message's msgIdx/REFIDX, while retaining msg_id and Markdown. Reply reference lookup is scoped by account, peer and exact message ID, with a ten-minute TTL.
- Native quotes use explicit reply IDs only; cached passive-reply IDs do not select a quote.
- Explicit HTTP 400/422 unsupported-reference rejections retry ordinary text once; network/timeouts/rate-limit/server errors do not retry.
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
