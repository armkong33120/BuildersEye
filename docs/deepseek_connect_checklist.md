# DeepSeek Connect Prep — Checklist

Goal: flip the local backend from **template answers** (LLM off) to **real
DeepSeek v4-flash answers** with cost tracking, without touching the running
backend/vite processes.

Status today: `server/.env` has **no DEEPSEEK_API_KEY** → `isLLMAvailable() = false`
→ `/api/chat` returns template answers; cost trackers idle (0 calls).

---

## 1. What to add to `server/.env`

Append these lines (replace `<YOUR_KEY>` with the real DeepSeek key — never commit it):

```bash
# ── DeepSeek LLM (server/llmClient.js reads these) ──
DEEPSEEK_API_KEY=<YOUR_KEY>
LLM_MODEL=deepseek-v4-flash
# Optional — disable chain-of-thought (saves output tokens on summary/retrieval)
LLM_THINKING=disabled
```

| var | required? | effect |
|---|---|---|
| `DEEPSEEK_API_KEY` | ✅ required | enables `getClient()`; without it `isLLMAvailable()` stays `false` |
| `LLM_MODEL` | ✅ recommended | model name; server default is `deepseek-chat`, so set `deepseek-v4-flash` explicitly |
| `LLM_THINKING=disabled` | optional | `server/llmClient.js` disables CoT when `LLM_THINKING === 'disabled'` — **recommended** (v4-flash defaults to thinking = burns output tokens) |
| `LLM_REASONING_EFFORT` | optional | e.g. `low` to cap reasoning tokens further (0-99%) |
| `LLM_BASE_URL` | optional | default `https://api.deepseek.com` — only set if using a proxy |
| `LLM_SKIP` | optional | keep `false` (or remove). If `true`, forces LLM off even with a key |

> Note on `DEEPSEEK_THINKING=0`: that var is read by the **Python** pipeline
> (`tools/upgrade_360/deepseek_client.py`, value `disabled`/`enabled`), **not** by the
> Node server. The Node server uses `LLM_THINKING=disabled`. Set both if you use both:

```bash
# server/.env (Node backend)
LLM_THINKING=disabled

# tools/upgrade_360 (Python pipeline, only if you run phase2 with API)
DEEPSEEK_THINKING=disabled
```

Pricing/cost notes (already wired, no action needed):
- `server/llmClient.js` defaults to v4-flash rates (in $0.14/M, cache-hit $0.0028/M,
  out $0.28/M) and `max_tokens` **500** chat / **600** raw SQL (reduced from 800 in task_0003).
- `tools/upgrade_360/cost_tracker.py` defaults to the same v4-flash prices
  (env-overridable via `DS_PRICE_INPUT`/`DS_PRICE_CACHE_INPUT`/`DS_PRICE_OUTPUT`).


## 2. Restart steps (do NOT do while the e2e is running — it has finished)

The local backend (:5199) and vite (:5174) are currently **running with old code in
memory**. After editing `.env` you MUST restart the backend for the new env to load:

```bash
# 1. stop the old backend (find PID first)
lsof -ti tcp:5199 | xargs kill     # or Ctrl+C in the terminal running `node index.js`

# 2. start it again from server/
cd server
node index.js                       # reads .env → isLLMAvailable() should be true

# 3. vite is unaffected (front-end only) — no restart needed
```

> If you only edited source files (not `.env`), the backend still needs a restart to
> pick up new code — same two commands.

## 3. How to verify

### 3.1 `isLLMAvailable() = true`

```bash
cd server
node --input-type=module -e "
import { isLLMAvailable, getUsageStats } from './llmClient.js';
console.log('isLLMAvailable:', isLLMAvailable());
console.log('usage:', JSON.stringify(getUsageStats()));
"
# expect: isLLMAvailable: true
```

### 3.2 Chat answers are LLM-generated (not template)

```bash
curl -s http://localhost:5199/api/chat \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <CEO_TOKEN>' \
  -d '{"query":"ใครได้ KPI สูงสุดในฝ่ายขาย","conversationId":"verify1"}'
# response should include  "llmUsed": true, "answerSource": "gemini"
# (not "template"), and a natural Thai sentence citing exact values.
```

(Get `<CEO_TOKEN>` via `POST /api/auth/login` with the demo CEO credentials.)

### 3.3 Cost tracking is incrementing

```bash
# after a few chat calls:
curl -s http://localhost:5199/api/usage -H "Authorization: Bearer <CEO_TOKEN>"
# expect calls > 0, promptTokens/completionTokens > 0, estimatedCostUsd > 0
# and server console lines like:
#   [llm-cost] model=deepseek-v4-flash in=… out=… cache=… call≈$0.000xx (รวม≈$0.00xxx)
```

### 3.4 Response cache works (task_0003)

Ask the **same question twice** — the second call should return in ~0-10 ms and include
`"cached": true` (server-side in-memory cache, keyed by normalized query + role + emp id).

### 3.5 Python pipeline cost tracking (tools/upgrade_360)

```bash
cd tools/upgrade_360
DEEPSEEK_API_KEY=<YOUR_KEY> .venv/bin/python phase2_generator.py --codes EMP001,EMP002 --desc-batch-size 8
# events are batched (8/API call); per-call usage logged to out/api_cost_usage.jsonl
# summary via ctx.cost_summary() or read api_cost_usage.jsonl
```

---

## 4. What was changed in task_0003 (relevant to connect)

| file | change |
|---|---|
| `server/llmClient.js` | `max_tokens`: rawSql 800 → **600** (chat stays 500) |
| `server/chatController.js` | response cache lookup/store (only when LLM available, `llmUsed` answers) |
| `server/responseCache.js` | **new** — in-memory cache (TTL 15 min, max 1000, key = query+role+emp) |
| `tools/upgrade_360/deepseek_client.py` | batch generation `generate_drama_events()` (N events / 1 call, `max_tokens` 600/event) |
| `tools/upgrade_360/phase2_generator.py` | `prewarm_descriptions()` batches description fetches before planning; `--desc-batch-size` (default 8) |
| `tools/upgrade_360/cost_tracker.py` | unchanged (already v4-flash pricing) |

## 5. Rollback (if anything misbehaves)

- Remove `DEEPSEEK_API_KEY`/`LLM_MODEL` from `server/.env` (or set `LLM_SKIP=true`) →
  template answers return; no code change needed.
- `git stash` the source edits → `git checkout -- server/ tools/upgrade_360/`.
