# BuildersEye — AI Project Context (สำหรับ AI ตัวอื่น / ผู้ร่วมงานใหม่)

> ไฟล์นี้สรุปว่าโปรเจกต์ BuildersEye กำลังทำอะไร ทำไปแล้วอะไรบ้าง ทำไม และใครเป็นผู้ดูแล
> อ่านจบแล้วควรตอบได้: ระบบนี้คืออะไร, โค้ดอยู่ตรงไหน, ทำงานยังไง, รัน/ทดสอบยังไง, และมีอะไรค้างอยู่

---

## 1. โปรเจกต์นี้คืออะไร

**BuildersEye** = ระบบ **RAG (Retrieval-Augmented Generation) เหนือ Org-Graph ของบริษัท** (ข้อมูล HR demo 150 คน)
เป้าหมาย: ทำให้กระบวนการค้น-คิด-ตอบของ AI "มองเห็นได้" — ผู้ใช้เห็นว่า AI สแกนข้อมูลส่วนไหน ผ่านขั้นตอนไหน โดน RBAC กันอย่างไร ก่อนจะตอบ — เพื่อสร้างความเชื่อใจและจับจุดผิดพลาดได้เร็ว

- **แนวคิดหลัก**: ไม่ซ่อนการ retrieval ไว้หลัง chat box → แสดงเป็น "surface ที่มองเห็นได้" (3D org graph + neural-network pipeline inspector)
- **เทคโนโลยี**: Frontend Vite (Vanilla JS) บน **Vercel** + Backend Node/Express บน **Azure Container Apps** + DB **Neon (Postgres + pgvector)** + LLM **DeepSeek (deepseek-v4-flash)**
- **Repo**: https://github.com/armkong33120/BuildersEye.git (branch `main`, **ยังเป็น PUBLIC**)

---

## 2. สถาปัตยกรรม

```
User ──> https://builders-eye.vercel.app/
            ├─ index.html                     (landing page)
            ├─ app.html                       (แอปหลัก: 3D org graph + chat, ต้อง login)
            └─ debug_neural_network_diagram.html  (หน้า inspect pipeline: RAG Assistant, admin gate)
                      │  ?backend=  เลือก backend ได้ (local: http://localhost:5199)
                      ▼
Azure Container Apps: https://builderseye-backend.wittybush-d59275bd.southeastasia.azurecontainerapps.io
            ├─ /api/auth/*       (JWT login/refresh/logout)
            ├─ /api/chat         (RAG ถาม-ตอบ → เก็บ latestPipeline + trace)
            ├─ /api/debug/pipeline · /api/debug/online
            └─ /api/preview/credentials  (รายชื่อ 150 user สำหรับ test/demo)
                      ▼
Neon Postgres (DATABASE_URL)  — employees/chunks(embedding 384d)/auth_sessions
```

- **Frontend repo**: ไฟล์ HTML root-level (`index.html`, `app.html`, `debug_neural_network_diagram.html`) + `src/` (main.js, styles) — Vite multi-page build
- **Backend**: `server/` — Express.js โค้ด flat files (`index.js`, `chatController.js`, `searchIndex.js`, `policy.js`, `authStore.js`, `sqlEngine.js`, `vectorStore.js`, `localEmbedder.js`, `llmClient.js`, `anonymizer.js`, `neonStore.js` …)
- ⚠️ **ระวัง**: ~~มี `server/core/*`, `server/security/*`, `server/controllers/*`, `server/services/*` = **โค้ดเก่า/stale ที่ไม่มีใคร import**~~ → **ย้ายไป `server/archive/` แล้ว (2026-08-12)** โค้ดจริงทั้งหมดอยู่ flat `server/*.js`
- 📐 **ARCHITECTURE.md**: ดู architecture diagram, module boundaries, request lifecycle, trace nodes, failure fallback แบบละเอียด

---

## 3. Production URLs & Azure

| สิ่ง | ที่อยู่ |
|---|---|
| Landing | https://builders-eye.vercel.app/ |
| แอปหลัก (login) | https://builders-eye.vercel.app/app.html |
| Debug page (admin gate) | https://builders-eye.vercel.app/debug_neural_network_diagram.html |
| Backend (health) | https://builderseye-backend.wittybush-d59275bd.southeastasia.azurecontainerapps.io/api/health |
| Azure | rg `rg-builderseye` · ContainerApp `builderseye-backend` (owner: theerachot.si.61@live.ubu.ac.th) |
| CI/CD | GitHub Actions `deploy-aca.yml` (push `server/**` → build image → deploy) + Vercel auto-deploy (frontend) |

**Azure env (production)**: `JWT_SECRET`(secretRef jwt-secret), `ENABLE_TEST_CREDS=true` ⚠️ (ควรตั้งเป็น `false`), `TEST_ACCOUNT_PASSWORD=[REDACTED_TEST_PASSWORD]`, `LLM_API_KEY`(secretRef llm-api-key), `LLM_BASE_URL=https://api.deepseek.com`, `LLM_MODEL=deepseek-v4-flash`, `DATABASE_URL`(neon), `VECTOR_INDEX_DISABLED=true`, scale = **minReplicas 0 / maxReplicas 1** (scale-to-zero)

> ⚠️ **2026-08-19 update**: Production safety hardened — `server/authStore.js` now calls `process.exit(1)` if `ENABLE_TEST_CREDS=true` + `NODE_ENV=production` + known password is set. Backend will REFUSE to start until this is fixed on Azure.

---

## 4. RAG Pipeline — 19 nodes + trace (ความจริงต่อคำถาม)

ทุกคำถามผ่าน `POST /api/chat` → `server/chatController.js` → เก็บ **`latestPipeline`** (GET `/api/debug/pipeline`) ซึ่งตอนนี้มี **`trace[]`** = ลำดับ node ที่รันจริง พร้อม `ms` + note

**19 node** (id ที่ debug page ใช้):
- L0 `input`: `q` User Query, `mem` Conversation Memory
- L1 `h1`: `pol` Policy, `sql` SQL Detect, `pron` Pronoun, `cache` Response Cache, `sem` Semantic Intent, `scope` RBAC Scope, `sheet` Sheet Mentions
- L2 `h2`: `kw` Keyword Search (7 matchers), `rbac` RBAC Re-check, `sqle` SQL Engine, `emb` Embed, `vec` Vector Search
- L3 `h3`: `ctx` Context Build, `anom` Anonymize/De-anonymize
- L4 `h4`: `llm` LLM Generate (deepseek-v4-flash), `tpl` Template Fallback
- L5 `out`: `out` Answer Enrich + Save

**ความจริงที่สำคัญ**: ไม่ใช่ทุก node วิ่งทุกครั้ง! มี branch:
- วิ่งประจำ: `q pol sql pron scope kw rbac sheet out` (+`mem`)
- conditional: `cache/sem` (LLM on เท่านั้น), `sqle` (SQL route: เจอคำแนววิเคราะห์), `emb+vec` (vector route), `anom` (path keyword+LLM), `llm`, `tpl` (ไม่มี LLM / ไม่มี branch ชนะ)
- early-exit: policy block → จบที่ `pol`; clarification → จบที่ `sem`; **cache hit → จบที่ `cache→mem`** (trace แค่ 6 nodes)

`latestPipeline` fields: `{query, answer, chunks, sources, matchedEmployeePks, matchedDepartments, responseTimeMs, at, trace[], llmUsed, sqlUsed, answerSource, matchersUsed, cached, viewer}`

---

## 5. Debug page (debug_neural_network_diagram.html)

หน้า self-contained เดียว (vanilla JS) = **"RAG Assistant + Org graph retrieval + online live chat"**:

- **Admin gate**: client-side `root`/`1234` (cosmetic — backend endpoints ป้องกันด้วย JWT `requireAuth` แล้ว)
- **RAG Assistant**: dropdown เลือก **150 user** (จาก `/api/preview/credentials`, ต้อง JWT auth) + chat → `/api/chat` → แสดงคำตอบ + caption
- **Node truth**: เฉพาะ node ใน `trace` สว่าง/animate ตามลำดับ+ms
- **Trace/connection log**: `#idx node +ms note` + History (localStorage, cap 50)
- **Online live**: poll `/api/debug/pipeline` (2s) + `/api/debug/online` (3s) — ทั้งคู่ต้อง JWT auth
- `?backend=` ใช้ชี้ backend อื่นได้

---

## 6. Auth & Session

- **JWT**: access token (TTL 30m, stateless) + refresh token (7 วัน, เก็บ hash ใน server)
- **Sessions**: production เก็บใน **Neon `auth_sessions`** (อยู่รอด container cold start) / local `server/.data/auth/sessions.json`
- **users seeding**: default **random password ทุกคน** (ปลอดภัย); ถ้า `ENABLE_TEST_CREDS=true` + `TEST_ACCOUNT_PASSWORD` ตั้งไว้ → ทุก user ได้รหัสเดียวกัน + `mustChangePassword=false` ⚠️ production ใช้ `ENABLE_TEST_CREDS=false` (default ปลอดภัย)
- **Rate limit**: login 5 ครั้ง/นาที/user+IP
- **Admin**: CEO role = admin (`isAdmin: true`), ใช้ `requireAdmin` middleware
- **Debug endpoints**: ป้องกันด้วย `requireAuth` (JWT), pipeline/latency endpoints เพิ่มเติมได้
- 📄 อ่าน `SECURITY.md` สำหรับ threat model + deployment checklist



---

## 7. สิ่งที่ทำเสร็จแล้ว (ล่าสุด, 2026-08-12)

1. ✅ debug page แสดง **19 node pipeline จริง**
2. ✅ **node-truth trace** ต่อคำถามจริง
3. ✅ **RAG Assistant** + dropdown 150 คน ใน debug page
4. ✅ session ลง Neon อยู่รอด cold start
5. ✅ Playwright tests ครบทุก scenario
6. ✅ **Archive cleanup**: ย้าย stale code ไป `server/archive/` + สร้าง `ARCHITECTURE.md`
7. ✅ **Security hardening (2026-08-12)**:
   - Debug endpoints (`/api/debug/pipeline`, `/api/debug/online`) ต้องใช้ JWT auth แล้ว
   - `/api/preview/credentials` ต้องใช้ JWT auth แล้ว
   - เพิ่ม `requireAdmin` middleware (CEO role check)
   - `ENABLE_TEST_CREDS=true` ใน production แสดงคำเตือนชัดเจน
   - สร้าง `server/.env.example` (ไม่มี secret จริง)
   - สร้าง `SECURITY.md` พร้อม threat model + deployment checklist
   - สร้าง `scripts/verify_security.mjs`
   - เพิ่ม `isAdmin` field ให้ user
8. ✅ **RAG Evaluation framework**:
   - `eval/golden_questions.json` 65 ข้อ 8 categories
   - `eval/run_eval.mjs` dual-mode (direct + HTTP)
   - `eval/EVALUATION.md` methodology
   - SQL misclassification regression test (q026)
9. ✅ **Reliability improvements**:
   - LLM timeout (30s default) + retry (max 2, exponential backoff)
   - SQL failure fallback → keyword/vector path (ไม่ขึ้น error)
   - p50/p95 latency tracking (`/api/debug/latency`)
10. ✅ **QA test suite**: 9 API test scripts + orchestrator

**Commits ล่าสุด**: `76b8762` (docs) → `cb7d758` (RAG Assistant + trace) → `602d946` (ลบ preset/RUN/chip) → `e562e98` (Neon sessions) → `ad631f5` (test creds)

---

## 8. วิธีรัน & ทดสอบ (local)

```bash
# backend (port 5199) — ต้องมี server/.env (JWT_SECRET ฯลฯ)
cd server && node index.js            # หรือ: cd .. && npm run dev:backend

# frontend (port 5174)
npm run dev                            # Vite

# ทดสอบ UI (headful, เห็นหน้าจอ) — ผ่าน deployed frontend + local backend
node scripts/test_ui_playwright_headful.mjs          # login→chat→debug
node scripts/test_ui_playwright_production.mjs       # prod 3 scenarios
node scripts/test_ui_playwright_role_live.mjs        # 4 สิทธิ์ (CEO/HR/Mgr/Emp)
```

- ดู debug page: http://localhost:5174/debug_neural_network_diagram.html (gate `root`/`1234`)
- ข้อมูล local: `server/.data/auth/users.json` (150 user, ทุกคนรหัส `[REDACTED_TEST_PASSWORD]` — ตั้งเพื่อ test)
- ⚠️ Vercel page เรียก `http://localhost:5199` ต้องเปิด browser ด้วย PNA-disable flags (Chrome บล็อก HTTPS→loopback): `--disable-features=BlockInsecurePrivateNetworkRequests,...`

---

## 9. Known issues / ข้อควรระวัง

- ✅ **Repo PRIVATE แล้ว** (2026-08-12) — ไม่มีข้อมูล HR demo หลุดสู่สาธารณะ
- ✅ Debug page client-side gate (`root/1234`) ถูกลบออกแล้ว — backend endpoints ป้องกันด้วย JWT `requireAuth` อย่างเดียว
- ⚠️ Chat บาง path ใช้เวลา >15s (frontend AbortSignal.timeout 15s) → streaming เป็น future work
- ⚠️ `emp001` / `hr-manager` **ไม่มีใน seed จริง** (150 = ceo + it-manager + emp002..emp150)
- ไฟล์ที่ตั้งใจไม่ commit: `pdf_extracted.txt`, `server/setup_local_auth.mjs`, logs, screenshots
- ✅ SQL misclassification "วิศวกรคนไหนทำ OT เทปูนข้ามคืน" — แก้แล้ว: SQL failure fallback ไป keyword/vector
- ✅ Debug endpoints — ป้องกันด้วย JWT requireAuth แล้ว
- ✅ `[REDACTED_TEST_PASSWORD]` — ลบออกจาก source code, ใช้ env var TEST_ACCOUNT_PASSWORD แทน
- ✅ Production safety — `ENABLE_TEST_CREDS=true` + `NODE_ENV=production` → `process.exit(1)` (backend ไม่ยอม start)

---

## 10. งานค้าง / ไอเดียต่อ

- ✅ ทำให้ repo เป็น private — เสร็จแล้ว (2026-08-12)
- Streaming สำหรับ long-running queries (>15s)
- เพิ่มการเก็บ trace ระยะยาว (database แทน in-memory)
- HTTPS/WSS สำหรับ debug page PNA issue
- ✅ Production safety — `ENABLE_TEST_CREDS=true` + production = `process.exit(1)` (backend ปฏิเสธการ start อัตโนมัติ)
- Rotate JWT_SECRET และ API keys (ดู SECURITY.md) — ต้องทำบน Azure Portal

## 11. การรันเทสต์และประเมินผล

```bash
# Build
npm run build

# Tests (ต้องมี backend รันที่ localhost:5199)
npm test                          # รันทุก deterministic test
npm run test:api                  # RBAC matrix test
npm run test:e2e                  # Playwright E2E test

# RAG Evaluation
npm run eval:rag                  # Direct mode (ไม่ต้องใช้ backend)
npm run eval:rag -- --http        # HTTP mode (backend ต้องรัน)

# Security verification
npm run verify:security           # Static analysis
```
