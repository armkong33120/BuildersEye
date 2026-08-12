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
- ⚠️ **ระวัง**: มี `server/core/*`, `server/security/*`, `server/controllers/*`, `server/services/*` = **โค้ดเก่า/stale ที่ไม่มีใคร import** — อย่าแก้ผิดไฟล์ (ของจริงอยู่ flat `server/*.js`)

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

**Azure env (production)**: `JWT_SECRET`(secretRef jwt-secret), `ENABLE_TEST_CREDS=true`, `TEST_ACCOUNT_PASSWORD=CEO@Landyi2026`, `LLM_API_KEY`(secretRef llm-api-key), `LLM_BASE_URL=https://api.deepseek.com`, `LLM_MODEL=deepseek-v4-flash`, `DATABASE_URL`(neon), `VECTOR_INDEX_DISABLED=true`, scale = **minReplicas 0 / maxReplicas 1** (scale-to-zero)

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

หน้า self-contained เดียว (522 บรรทัด, vanilla JS) = **"RAG Assistant + Org graph retrieval + online live chat"**:

- **Admin gate**: ต้องใส่ `root` / `1234` ก่อนเข้าใช้ (client-side, sessionStorage `be_debug_admin`)
- **RAG Assistant**: dropdown เลือก **150 user** (จาก `/api/preview/credentials`) + chat → **auto-login** ด้วย `TEST_ACCOUNT_PASSWORD` (`CEO@Landyi2026` — ใช้ได้ทุก user ทั้ง local+prod) → `/api/chat` → แสดงคำตอบ + caption (`as ceo (CEO) · 12.3s · answerSource=sql-analytics · sqlUsed · llmUsed · cached`)
- **Node truth**: เฉพาะ node ใน `trace` สว่าง/animate ตามลำดับ+ms, node ที่ไม่รัน **หรี่** (เช่น cache hit → สว่างแค่ `q→pol→sql→pron→cache→mem`)
- **Trace/connection log**: `#idx node +ms note` + **History** (`localStorage['be_debug_history']`, cap 50, ใหม่สุดบน, คลิกดูย้อนหลัง → แสดง trace/คำตอบ/node highlight เดิมเป๊ะ)
- **Online live**: poll `/api/debug/pipeline` (2s) + `/api/debug/online` (3s) → `#online` รายชื่อผู้ใช้ออนไลน์
- `?backend=` ใช้ชี้ backend อื่นได้ (local dev: `?backend=http://localhost:5199`)

---

## 6. Auth & Session

- **JWT**: access token (TTL 30m, stateless) + refresh token (7 วัน, เก็บ hash ใน server)
- **Sessions**: production เก็บใน **Neon `auth_sessions`** (อยู่รอด container cold start / scale-to-zero — ไม่งั้นโดน "เซสชันหมดอายุ" ทุกครั้งที่ container ตื่น) / local เก็บไฟล์ `server/.data/auth/sessions.json`
- **users seeding**: `server/authStore.js seedUsers()` — default **random password ทุกคน** (ปลอดภัย); ถ้า `ENABLE_TEST_CREDS=true` + `TEST_ACCOUNT_PASSWORD` ตั้งไว้ → ทุก user ได้รหัสเดียวกัน (`CEO@Landyi2026`) + `mustChangePassword=false`
- **Rate limit**: login 5 ครั้ง/นาที/user+IP → อย่า retry login ซ้ำในสคริปต์ test



---

## 7. สิ่งที่ทำเสร็จแล้ว (ล่าสุด, 2026-08-11/12)

1. debug page แสดง **19 node pipeline จริง** (เดิม 13 + path ผิดๆ ชี้โค้ด stale)
2. **node-truth trace**: backend เก็บ `trace[]` ต่อคำถามจริง → หน้าแสดง node ที่รันจริง (verify: SQL route มี `sqle`, vector มี `emb+vec`, cache hit แค่ 6 node)
3. **RAG Assistant + admin gate (root/1234) + dropdown 150 คน** ใน debug page
4. **แก้ login production** (เคย "Invalid username or password" เพราะ random password) → เปิด test mode
5. **แก้ "เซสชันหมดอายุ"** → session ลง Neon อยู่รอด cold start
6. ทดสอบ Playwright ครบ: headful login→chat→debug (EXIT 0), production 3 scenarios, role-matrix 4 สิทธิ์ (4/4), QA debug page 19/19

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
- ข้อมูล local: `server/.data/auth/users.json` (150 user, ทุกคนรหัส `CEO@Landyi2026` — ตั้งเพื่อ test)
- ⚠️ Vercel page เรียก `http://localhost:5199` ต้องเปิด browser ด้วย PNA-disable flags (Chrome บล็อก HTTPS→loopback): `--disable-features=BlockInsecurePrivateNetworkRequests,...`

---

## 9. Known issues / ข้อควรระวัง

- 🔴 **Repo ยัง PUBLIC** + มีข้อมูล HR demo + รหัส test ในโค้ด → **ควรทำให้ repo เป็น private** เป็นงานด่วน
- 🔴 **`root/1234` เป็น client-side gate** (ไม่ใช่ security จริง — ใครอ่านโค้ดก็รู้) + `CEO@Landyi2026` โผล่ในหน้าเว็บ/โค้ด
- 🐛 Query บางตัว LLM intent misclassify เป็น TEXT_TO_SQL → SQL route รันไม่ผ่าน → "Query execution failed" (`server/sqlEngine.js:102`) — เช่น "วิศวกรคนไหนทำ OT เทปูนข้ามคืน" (regex เจอ "ปัญหา") — ยังไม่แก้
- ⚠️ Chat บาง path ใช้เวลา >15s (frontend AbortSignal.timeout 15s) → ตอบไม่ทันแม้ backend ยังประมวลผล (pipeline จะอัปเดตทีหลัง)
- ⚠️ `llmRerank.js`/`hybridSearch.js`/`vectorEngine.js` = **ไม่ได้ถูกเรียกใน chat flow จริง** (โค้ดตาย) — อย่าสับสน
- ⚠️ `emp001` / `hr-manager` **ไม่มีใน seed จริง** (150 = ceo + it-manager + emp002..emp150)
- ไฟล์ที่ตั้งใจไม่ commit: `pdf_extracted.txt` (ข้อมูล HR demo), `server/setup_local_auth.mjs` (มีรหัส), logs, screenshots

---

## 10. งานค้าง / ไอเดียต่อ

- ทำให้ repo เป็น private + ลบ/สับเปลี่ยนข้อมูล HR demo + เปลี่ยนรหัส test
- แก้ SQL misclassification / timeout 15s (stream หรือ เพิ่ม timeout)
- เพิ่มการเก็บ trace ระยะยาว (ตอนนี้ history อยู่ client localStorage + latestPipeline ในหน่วยความจำ backend)
- เพิ่ม test case อื่น (login ผิดรหัส, preview mode, blocked query → trace สั้นๆ)
- ดู `NEXT_SESSION_PROMPT.md` สำหรับ handoff รายละเอียดต่อ session
