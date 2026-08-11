# 📋 PROMPT สำหรับ Session ใหม่ (ดำเนินงานต่อ)

วางโค้ดนี้ในเซสชั่นใหม่เพื่อดำเนินงานต่อ:

---

```
คุณคือผู้ช่วยที่ดูแลโปรเจกต์ BuildersEye (ระบบ RAG HR Org-Graph บน Azure + Vercel)

## สถานะโปรเจกต์
- โปรเจกต์: `/Users/arm/AI Test/mail-onedrive-org-graph/`
- Git remote: https://github.com/armkong33120/BuildersEye.git (branch: main)
- Last commits: `6ed1ac3` (security+debug), `df50983` (vite build fix)
- Production: Frontend https://builders-eye.vercel.app/ | Backend https://builderseye-backend.wittybush-d59275bd.southeastasia.azurecontainerapps.io
- Debug page: https://builders-eye.vercel.app/debug_neural_network_diagram.html
- Azure Container App: `builderseye-backend` / rg `rg-builderseye` / user `theerachot.si.61@live.ubu.ac.th`

## งานที่กำลังทำ (ถูกขัดจังหวะ — ต้องทำต่อ)
เป้าหมาย: ทดสอบว่า Login, Debug, Chat ทำงานร่วมกันได้จริง ด้วย Playwright headful (แบบมนุษย์)

### เสร็จแล้ว
1. ✅ `server/.env`: JWT_SECRET=random64hex, VECTOR_INDEX_DISABLED=true, ENABLE_TEST_CREDS=true
2. ✅ `server/setup_local_auth.mjs` สร้าง `server/.data/auth/users.json` 150 users
   - ceo = `CEO@Landyi2026`, mustChangePassword=false (login ได้ทันที)
3. ✅ backend local รันที่ http://localhost:5199 (health ok, indexReady=true)
4. ✅ frontend Vite รันที่ http://localhost:5174 (http 200)
5. ✅ เขียน `scripts/test_ui_playwright_headful.mjs` (headless:false) แล้ว — Login ceo → Chat "CEO คือใคร" → Debug page ตรวจ pipeline query + online ceo
6. ✅ รัน headful test ผ่านครบ: A Login ✅ | B Chat ✅ | C Debug ✅ (EXIT 0)
   - screenshot อยู่ที่ /tmp/e2e-shots/ (01-login → 05-debug-assertions)
   - q="CEO คือใคร" chip="live · HH:MM:SS" online มี ceo ✅

### หมายเหตุสำคัญ (พบระหว่างทดสอบ)
- ⚠️ backend ถูก restart แล้ว (โค้ด server/index.js แก้ 04:07 แต่ process เก่าเริ่ม 19:57 วันก่อน → debug routes ไม่มีใน process ที่รัน)
  ตอนนี้ process ใหม่รันโค้ดล่าสุดแล้ว (uptime ใหม่) — ถ้าจะเริ่ม backend เอง: `cd server && node index.js`
- วิธีรัน test: `cd '/Users/arm/AI Test/mail-onedrive-org-graph' && node scripts/test_ui_playwright_headful.mjs`
  (ใช้เวลาประมาณ 90 วิ — แนะนำรันแบบ detached: `(nohup node scripts/... > /tmp/e2e-headful-run.log 2>&1 &)`)

### ต้องทำต่อ (ถ้ามี)
- ลองเพิ่ม test case อื่น เช่น login ผิดรหัส, preview mode, chat เป็น emp อื่น
- ตรวจสอบ/commit ไฟล์ที่ยังไม่ได้ commit

## ✅ ทดสอบ PRODUCTION เสร็จ (2026-08-11 08:13) — ALL PASSED (exit 0)
Script: `scripts/test_ui_playwright_production.mjs` (รัน headful: `node scripts/test_ui_playwright_production.mjs`)
- **S1 Pure prod login** ✅ — `ceo/CEO@Landyi2026` โดน 401 `Invalid username or password` (ตั้งใจ — prod users ถูก seed random password + mustChangePassword=true, `.dockerignore` ตัด `**/.data`, preview creds ปิด ENABLE_TEST_CREDS=false → **ไม่มีทาง login prod ด้วย creds ที่รู้จัก**)
- **S2 Prod frontend + local backend** (`?backend=http://localhost:5199`) ✅ — login OK → chat `ประวัติและการทำงานของ CEO` (answer 403 chars) → debug page ขึ้น query ใหม่ + `chip="live · 8:13:24 AM"` + `ceo` online ✅ (พิสูจน์ว่า UI ที่ deploy บน Vercel ทำงาน flow เต็มได้จริง)
- **S3 Pure prod debug page** ✅ — default preset, `chip="ollama"`, online count=0 ("ไม่มีใคร login บน prod")
- ⚠️ **PNA**: Chrome บล็อก HTTPS origin (vercel) → loopback localhost → script มี launch flags `--disable-web-security` + PNA-disable (test-harness only)
- สรุปตรงๆ: **บน pure production (frontend+backend prod) ยังทดสอบ animation+online ไม่ได้** เพราะ auth ล็อก (ไม่มี creds) — ต้องแก้ prod ก่อน เช่น ตั้ง password ให้ ceo บน container / เปิด ENABLE_TEST_CREDS / add admin reset
- Screenshots: /tmp/e2e-shots/prod-s1-* … prod-s3-*

## ✅ ปรับปรุง debug page (2026-08-11) — แสดงโหนด pipeline จริงทั้งหมด 19 โหนด
ไฟล์: `debug_neural_network_diagram.html` (แก้ local แล้ว, verify 5/5 PASS, node --check ผ่าน)
- เดิม 13 โหนด (6 ชั้น) → ตอนนี้ **19 โหนด** ตามโค้ดจริง (audit ทั้ง pipeline):
  - L0 input: `q` User Query, `mem` Conversation Memory
  - L1 h1: `pol` Policy, `sql` SQL Detect, `pron` Pronoun, `cache` Response Cache, `sem` Semantic, `scope` RBAC, `sheet` Sheet Mentions
  - L2 h2: `kw` Keyword Search (7 matchers), `rbac` Redact, `sqle` SQL Engine, `emb` Embed (e5-small 384d), `vec` Vector Search (k=15 min 0.85)
  - L3 h3: `ctx` Context, `anom` Anonymize/De-anonymize
  - L4 h4: `llm` Generate (deepseek-v4-flash), `tpl` Template Fallback
  - L5 out: `out` Answer Enrich + Save
- แก้ path ผิด: `server/core/*`, `server/security/*` → flat `server/*.js` (ของเดิมคือโค้ด stale ที่ไม่ถูก import)
- ลบ node ที่ไม่จริง: `hyde`/`rr` (llmRerank ไม่ได้ใช้ใน chat), `flt` (รวมใน rbac) ฯลฯ
- Model จริง: `deepseek-v4-flash` (เดิมเขียน llama3.1:8b)
- CSS: เพิ่ม `--amber`, `#online` เป็น `pointer-events:none` (ไม่บัง node q/mem)
- ✅ **deploy ขึ้น Vercel เรียบร้อยแล้ว** (commit `b09a9d7`, push main → auto-deploy) — ดูได้ที่ https://builders-eye.vercel.app/debug_neural_network_diagram.html (verify 19 nodes, chip=deepseek-v4-flash, ไม่มี JS error)
- ไฟล์ที่ยังไม่ได้ commit (ตั้งใจข้าม, repo public): `pdf_extracted.txt` (ข้อมูล HR demo), `server/setup_local_auth.mjs` (มีรหัส ceo), log/screenshot, ไฟล์ source ที่แก้ค้างจาก session ก่อน (app.html, src/main.js, server/anonymizer.js, server/sqlEngine.js — push ตัว server/* จะ trigger backend Azure redeploy)

## ✅ ทดสอบ live chat → 19-node animation แบบหลายสิทธิ์ (2026-08-11) — 4/4 PASS
Script: `scripts/test_ui_playwright_role_live.mjs` (headless + PNA flags) — login → chat จริง → เปิด debug page → ตรวจ pipeline pick up query + animation
- **CEO** (ceo) ✅ chat 417 chars · **HR** (emp135) ✅ chat 1425 chars (SQL route) · **Manager** (emp007) ✅ chat 393 chars · **Employee** (emp012) ✅ chat 438 chars
- ทุกสิทธิ์: `qPicked=true`, `chip="live · HH:MM:SS"`, **`sawBusy=true sawActive=true`**, **`done=19/19 allVisited=true`** — animation วิ่งครบ 19 nodes ระหว่าง live chat จริง
- ⚠️ ตั้งรหัส test บน local users.json: emp135/emp007/emp012 = `Pass@1234` (local only, users.json โดน gitignore)
- ⚠️ finding: query "วิศวกรคนไหนทำ OT เทปูนข้ามคืน" ที่ role Manager ถูก LLM intent misclassify เป็น TEXT_TO_SQL → SQL route รันไม่ผ่าน → "Query execution failed" (server/sqlEngine.js:102) — ยังเป็น bug ของ app ต้องแก้ (ไม่ได้อยู่ในขอบเขตงานนี้)
- screenshots: /tmp/e2e-shots/role-{ceo,hr,manager,employee}-{01,02,03}.png

## ✅ แก้ login production ไม่ได้ (2026-08-11) — ceo login ได้แล้ว!
ปัญหา: production seed users ด้วย random password ทุกครั้ง (รวม ceo) + ENABLE_TEST_CREDS=false → "Invalid username or password" เสมอ
แก้: `server/authStore.js` seedUsers() รองรับ test mode — ถ้า `ENABLE_TEST_CREDS=true` + `TEST_ACCOUNT_PASSWORD` ตั้งไว้ (≥8 ตัว) → ทุก user ได้รหัสที่รู้ค่า + mustChangePassword=false (default ยัง random password เหมือนเดิม)
- Azure env ที่ตั้ง: `ENABLE_TEST_CREDS=true`, `TEST_ACCOUNT_PASSWORD=CEO@Landyi2026` (az containerapp update)
- Deploy: commit `ad631f5` → CI success → **login ceo/CEO@Landyi2026 บน https://builders-eye.vercel.app/app.html ได้แล้ว** (verify: login 200, chat OK, #online แสดง ceo)
- 🔴 คำเตือน: production ตอนนี้ใครก็ login เป็น ceo (หรือ user ใดก็ได้) ด้วยรหัสเดียวกันได้ + `/api/preview/credentials` เปิดแสดงรายชื่อ user → **ควรทำให้ repo เป็น private** หรือเปลี่ยน `TEST_ACCOUNT_PASSWORD` เป็นค่าที่ไม่เปิดเผย แล้วปิด ENABLE_TEST_CREDS หลังทดสอบเสร็จ

## ✅ แก้ "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" (2026-08-11) — session อยู่รอด cold start
สาเหตุ: session เก็บใน `server/.data/auth/sessions.json` (filesystem ephemeral) + container scale-to-zero (`minReplicas:0`) → ทุก cold start = session ถูกลบ → refresh ล้มเหลว → ถูกเตะออก
แก้: เก็บ session ลง **Neon Postgres** (ตาราง `auth_sessions`) เมื่อมี `DATABASE_URL` (prod) ส่วน local ยังใช้ไฟล์เหมือนเดิม
- `server/authStore.js`: session ops async + durable (loadSessionsDurable/saveSessionsDurable + ensureAuthSessionsTable)
- `server/index.js`: routes auth (`/api/auth/login|refresh|logout`) + `/api/debug/online` เป็น async
- `server/neonStore.js`: เพิ่มตาราง `auth_sessions` ใน initNeonSchema
- commit `e562e98` → CI success → verify บน prod: login → `az containerapp restart` → **refresh เดิม → 200** ✅, online แสดง ceo ✅, UI login+reload ยัง login อยู่ ✅
- หมายเหตุ: local backend ใช้ DATABASE_URL เดียวกันกับ prod → local sessions ลงตารางเดียวกัน (ผู้ใช้จะโผล่ online บน prod ด้วย — เป็นแค่ cosmetic)

## ✅ ลบ preset/RUN/chip ออกจาก debug page (2026-08-11)
ผู้ใช้ให้ลบ `OT เทปูน · vector` (select preset), ปุ่ม RUN, chip สถานะ (deepseek-v4-flash / live · เวลา) เพราะเห็นว่าไม่มีประโยชน์
- ลบ HTML: `<select id="preset">`, `<button id="run">`, `<span id="chip">`
- ลบ JS: DATA array (3 presets), SYS const, wiring `$('preset').onchange`/`$('run').onclick`, chip update ใน pollPipeline, `render(DATA[0])` ที่ init
- คงไว้: 19-node LAYERS, run()/burst() animation, pollPipeline (live) + pollOnline (#online), ช่อง #q, tooltip hover
- verify: preset/RUN/chip ไม่อยู่, live chat → animation 19/19 ยังทำงาน, ไม่มี JS error
- commit `?` → Vercel auto-deploy

### ข้อควรรู้
- local ไม่มี LLM_API_KEY → chat ตอบ template answer (llmUsed=false) แต่ยังบันทึก latestPipeline + highlight node ได้
- debug page ใช้ backend: hostname localhost → http://localhost:5199 (ในโค้ด debug_neural_network_diagram.html)
- ตรวจสอบ src/main.js ว่า API base ชี้ localhost:5199 หรือไม่ (search_files หา "5199|/api/|fetch(" ใน src/ ไม่เจอ — ต้องดู main.js ตรงๆ หรือ vite.config.js proxy)

## สิ่งที่แก้ไขแล้ว (deploy production)
1. server/authStore.js — บังคับ JWT_SECRET, random passwords, previewCreds ไม่คืน pwd, listOnlineUsers()
2. server/chatController.js — node กระพริบตามชื่อ/EMP ในคำตอบ
3. server/index.js — GET /api/debug/pipeline + /api/debug/online
4. debug_neural_network_diagram.html — ลบ panels, เพิ่ม online users, BACKEND ชี้ production, poll 2-3 วิ
5. vite.config.js — เพิ่ม debug page เป็น build entry

## Azure env (production)
JWT_SECRET(secretRef jwt-secret), ENABLE_TEST_CREDS=false, LLM_API_KEY(secretRef llm-api-key), LLM_BASE_URL=https://api.deepseek.com, LLM_MODEL=deepseek-chat, DATABASE_URL(neon-db-url)

## ข้อควรรู้เพิ่มเติม
- repo ยัง PUBLIC (ยังไม่ private / ยังไม่ลบข้อมูล HR demo)
- ไฟล์ยังไม่ commit: app.html, index.html, src/main.js, src/styles.css, server/anonymizer.js, server/sqlEngine.js, scripts/test_ui_playwright.mjs, server.log, pdf_extracted.txt, .data/, screenshots
- ไฟล์ใหม่ยังไม่ commit: server/setup_local_auth.mjs, NEXT_SESSION_PROMPT.md
- ระบบต้องการ LLM_API_KEY (DeepSeek) เพื่อ generateAnswer จริง

## งานที่อาจทำต่อ
- ทำให้ repo เป็น private / ลบข้อมูล HR demo / ลบไฟล์ขยะ

## คำแนะนำ
- เทอร์มินัลอาจมีปัญหา rendering → redirect output ไปไฟล์แล้วอ่านด้วย read_file
- ใช้แท็กปิดที่ถูกต้อง (</path>, </diff>) ห้ามใช้ </｜DSML｜>
- งานถูกขัดจังหวะบ่อย → ตรวจสอบสถานะก่อน (curl health, git status) แล้วค่อยทำต่อ
```

---

## วิธีใช้
วาง prompt ข้างบนในเซสชั่นใหม่ แล้วบอกงานต่อ เช่น "ทำการทดสอบ Playwright headful ต่อ" ผมจะตรวจสอบสถานะ backend/Vite และดำเนินการให้