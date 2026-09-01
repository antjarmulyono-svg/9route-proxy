---
name: 9router-video
description: Generate videos via 9Router /v1/videos/generations using xAI Grok Imagine (grok-imagine-video) or Google Veo (veo-3.1-generate-preview, veo-3.1-fast-generate-preview, veo-3.1-lite-generate-preview, veo-2.0-generate-001). Async job flow - submit, poll request_id until done, download MP4. Use when the user wants to create, generate, or render a video, text-to-video (txt2vid), or image-to-video.
---

# 9Router — Video Generation (xAI Grok Imagine & Google Veo)

Requires `NINEROUTER_URL` (and `NINEROUTER_KEY` if auth enabled). See https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md for setup.

Requires a connected video account in the 9Router dashboard (**Media Providers → Video**):
- **Google Gemini** — a Gemini API key from aistudio.google.com. The same key that serves Gemini chat/image also serves Veo.
- **xAI** — either **Grok Build OAuth** (SuperGrok / X Premium+ subscription sign-in) or a direct **xAI API key** from console.x.ai. The two are separate auth types with separate billing; the dashboard shows which one each connection uses.

## Models

| Model ID | Notes |
|---|---|
| `gemini/veo-3.1-generate-preview` | Veo 3.1, highest quality |
| `gemini/veo-3.1-fast-generate-preview` | Veo 3.1, faster |
| `gemini/veo-3.1-lite-generate-preview` | Veo 3.1, fastest / cheapest |
| `gemini/veo-2.0-generate-001` | Veo 2.0 |
| `xai/grok-imagine-video` | Grok Imagine |

A bare `veo-*` model id (no `gemini/` prefix) routes to Gemini; any other bare id routes to xAI.

## Endpoints (async job flow)

Video generation is **asynchronous**: the POST returns a `request_id` immediately, then you poll until the job is `done` or `failed`.

| Endpoint | Purpose |
|---|---|
| `POST /v1/videos/generations` | text-to-video / image-to-video |
| `POST /v1/videos/edits` | edit an existing video (xAI) |
| `POST /v1/videos/extensions` | extend an existing video (xAI) |
| `GET /v1/videos/{request_id}` | poll job status |
| `GET /v1/videos/{request_id}/content` | download the finished MP4 (Veo) |

Request fields:

| Field | Required | Notes |
|---|---|---|
| `model` | no | see the table above (the provider prefix is stripped before upstream) |
| `prompt` | yes for T2V | video description |
| `duration` | no | seconds — Veo 3.1 takes 4/6/8, xAI takes its own range |
| `aspect_ratio` | no | Veo: `16:9`, `9:16` · xAI: `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `3:2`, `2:3` |
| `resolution` | no | `480p`, `720p`, `1080p` (model-dependent) |
| `negative_prompt` | no | what to keep out of the video (Veo) |
| `person_generation` | no | Veo's people-safety setting, forwarded to Google as-is |
| `seed` | no | reproducible output (Veo) |
| `image` | no | image-to-video. Veo: a `data:image/…;base64,…` URL or raw base64 (http(s) URLs are **not** accepted — Veo only takes inline bytes). xAI: `{ "url": "https://… or data:…" }` |
| `video` | edits/extensions | xAI only — `{ "url": "…mp4" }` or `{ "file_id": "…" }` |
| `parameters` | no | Veo escape hatch: merged last into the upstream `parameters` object, so any Veo field this table doesn't list yet can still be passed through |

xAI passes request fields through unchanged — see https://docs.x.ai/developers/rest-api-reference/inference/videos. Veo fields are mapped onto `predictLongRunning` (`instances[]` / `parameters{}`); values are forwarded verbatim, so Google's own error text names the accepted values.

## Examples

### Google Veo

```bash
curl -X POST "$NINEROUTER_URL/v1/videos/generations" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini/veo-3.1-lite-generate-preview","prompt":"A drone shot of ocean waves crashing on black volcanic rocks","aspect_ratio":"16:9","duration":8}'
# → {"request_id":"gemini_bW9kZWxzL3Zlby0zLjEt…","status":"pending","model":"veo-3.1-lite-generate-preview"}
#   (response header x-9router-connection-id: <id>)
```

Poll until done (echo the connection header back so the same account polls the job):

```bash
curl "$NINEROUTER_URL/v1/videos/gemini_bW9kZWxzL3Zlby0zLjEt…" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "x-connection-id: <id from create response>"
# → {"status":"in_progress"}
# → {"status":"done","video":{"url":"$NINEROUTER_URL/v1/videos/gemini_…/content","mime_type":"video/mp4"}}
# → {"status":"failed","error":{"code":…,"message":"…"}}
```

Download — `video.url` points back at the gateway, so send the 9Router key, not a Google one:

```bash
curl -L "$NINEROUTER_URL/v1/videos/gemini_bW9kZWxzL3Zlby0zLjEt…/content" \
  -H "Authorization: Bearer $NINEROUTER_KEY" -o ocean.mp4
```

### xAI Grok Imagine

```bash
curl -X POST "$NINEROUTER_URL/v1/videos/generations" \
  -H "Authorization: Bearer $NINEROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-video","prompt":"A cinematic tracking shot through a neon city at night","duration":8,"aspect_ratio":"16:9","resolution":"720p"}'
# → {"request_id":"abc123"}
```

Poll the same way; xAI's `done` response carries a directly downloadable `video.url` (no `/content` hop, no gateway auth).

## CLI one-shot

```bash
9router gemini video --prompt "A drone shot of ocean waves" --output ocean.mp4
# options: --model --duration --aspect-ratio --resolution --negative-prompt
#          --person-generation --seed --image --timeout --port --host --api-key

9router xai video --prompt "A cinematic tracking shot through a neon city" --output city.mp4
# options: --model --duration --aspect-ratio --resolution --image --timeout --port --api-key
```

Both submit, poll with progress, download to `<output>.part`, and atomically rename on success. Ctrl+C cancels cleanly; non-zero exit on failure.

## Notes & limits

- Jobs are **account-bound** upstream: poll with the same connection that created the job (`x-connection-id` header, value from the create response's `x-9router-connection-id`).
- Creation POSTs are **never auto-retried** (a retry could create and bill two videos). Only a 401→token-refresh→single-retry is performed, which upstream rejects before job creation.
- Video models are tagged `kind: "video"` and are excluded from chat model lists and chat fallback combos.
- Veo job ids are opaque tokens (`gemini_…`). They encode the upstream operation name, which contains slashes that a URL path segment can't carry — don't try to unpack or rebuild them.
- Veo delivers finished videos through the Files API, which only opens with the Gemini API key. The gateway streams those bytes itself via `/content` so the key never reaches the client. The upstream file expires after ~2 days.
- Veo can finish a job with no video when its safety filter blocks every sample; 9Router reports that as `status: "failed"` with the filter reason.
- Grok Build **subscription OAuth** tokens are sent to the same `api.x.ai/v1/videos` endpoints as API keys; whether a given subscription tier includes video-generation quota is controlled by xAI and is not verified by 9Router — a `403`/`permission_denied` from upstream means the connected account has no video access.
