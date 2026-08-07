# 🤖 BuildersEye — Promt สำหรับแชทใหม่ (อัปเดตล่าสุด 2026-08-08)

> เปิดไฟล์นี้ → Copy ทั้งไฟล์ → วางในแชทใหม่ได้เลย (ไม่ต้องปรับอีก)
> ไฟล์อ้างอิงเพิ่มเติม: docs/HANDOFF_PROMPT.md (โปรเจกต์/สถาปัตยกรรม/secrets/gotchas เต็ม)

คุณคือผู้ช่วยพัฒนาโปรเจกต์ BuildersEye — Org-Graph Intelligence (HR RAG + 3D Graph)
ทำงานในโฟลเดอร์: /Users/arm/AI Test/mail-onedrive-org-graph
ก่อนทำอะไร: อ่านไฟล์ที่เกี่ยวข้องให้เข้าใจก่อน แล้วค่อยแก้/ทดสอบ/Commit
ไฟล์อ้างอิงหลัก: docs/HANDOFF_PROMPT.md (โปรเจกต์ + สถาปัตยกรรม + secrets + gotchas เต็ม)

## สถานะปัจจุบันทันที (ตรวจก่อนทำอะไร)
- เทสต์ 50x50 UI **เสร็จสมบูรณ์แล้ว** (2500/2500) — ไม่มี test รันค้างแล้ว
- Local backend :5199 กำลังรัน (node index.js) — เก็บไว้ | **vite dev :5174 หยุดแล้ว** (เลิกใช้แล้ว หลัง test จบ)
- git: main ahead origin/main **1 commit (c558290 — cost work)** — push ยังไม่ทำ (รอรอบนี้)
- **Deploy ล่าสุดสำเร็จ**: run 31196075322 (push 7 commits รอบก่อน) = success — build-deploy ผ่าน
- DeepSeek API ยังไม่ได้ต่อ (local .env ไม่มี key) — ดูหัวข้อ "DeepSeek API"
- ราคา DeepSeek v4-flash จริง: input $0.14/M (miss), $0.0028/M (cache hit), output $0.28/M — cost tracker ใช้ราคานี้แล้ว
- DeepSeek เตือนจะขึ้นราคาเร็วๆ นี้ → งานใหญ่ควรทำตอนนี้

## เทสต์ 50x50 UI — ผลจบแล้ว (e2e_50x50_ui.mjs)
- **2500/2500 คำถาม (50 ตำแหน่ง × 50)** | ok=2359 (94.4%) blocked=141 (5.6%) fail=0 avgLat=2547ms
- blocked ทั้งหมด = คำถามเงินเดือน (RbacBlocked): Manager 81/105, Employee 60/84, CEO/HR 0
- เทียบ API test (multirole_50x50_results.csv): ok% 94.4% vs 94.9%, fail 0 ทั้งคู่ — **RBAC พฤติกรรมเหมือนกันทั้ง 2 เส้นทาง**
- รายงาน: server/ui_vs_api_50x50_report.md | CSV: server/ui_50x50_results.csv (2501 บรรทัด)
- server/analyze_50x50.mjs อัปเกรดให้รับ CSV path arg ได้ (ใช้ `node server/analyze_50x50.mjs server/ui_50x50_results.csv`)

## งานที่เสร็จในเซสชันนี้ (commit เรียงใหม่ → เก่า)
1. c558290 perf(cost): response cache คำถามซ้ำ + 360-gen batch LLM + max_tokens 600 (ยังไม่ push)
2. 85c4131 docs: refresh handoff prompt (v4-flash pricing, thinking-disabled, 6 commits ahead, live test %)
3. 096eb33 perf(cost): ราคา v4-flash จริง + ปิด thinking mode สำหรับงาน JSON
4. d1b3108 docs: current-state handoff + e2e_50x50_ui.mjs
5. ace8e98 feat(obs): API cost tracking DeepSeek (upgrade_360 + backend)
6. 44beebd test: Playwright RBAC role-matrix (CEO/HR/Manager/Employee UI) — 20 checks
7. 8029d09 test: multi-role 50x50 API stress test (2500 Qs) + multirole_50x50_results.csv
8. e186650 feat(tools): upgrade_360 — 360-Degree Digital Twin CLI (ทีม 4 agents)
9. 02bc074 feat(ui): ปุ่ม Sync OneDrive + Registry status panel — Vercel live แล้ว

## Cost reduction (c558290 — verify ผ่านหมด)
- **server/responseCache.js** (ใหม่): in-memory cache TTL 15 นาที / max 1000 / FIFO; key = normalized query + role + employeeId; ต่อเข้า chatController.js — active เฉพาะเมื่อ isLLMAvailable() และ cache เฉพาะคำตอบ LLM (llmUsed)
- **360-gen batch**: deepseek_client.generate_drama_events() กลุ่ม N events/1 call (JSON array, eventId-mapped, offline template fallback ต่อ spec); phase2_generator DataGenContext.prewarm_descriptions() prefetch คำอธิบายก่อนวางแผน + arg --desc-batch-size (default 8)
- **max_tokens 800→600**: server/llmClient.js (rawSql) + deepseek_client single-call
- Verify: upgrade_360 tests 3/3 PASS, evalRag Recall@5=100%, registry e2e 17/17, offline workers=4 OK

## Backlog 202 คู่ไร้ linkage (docs/backlog_202_pairs.md + _full.md)
- 202/2,194 คู่ (9.2%) ไม่มี event จริงทั้ง 2 ฝั่ง — root cause: hire-date skip ใน _plan_collab_pairs (event แรกของคู่ เกิดก่อนวันเริ่มงานของสมาชิก → ข้ามทั้งคู่) = design gap ไม่ใช่ data failure
- กระจุก E&C 227 slots, Sales 43, CSW 30, Procurement 25 | work_partner 93/friendship 66/conflict 25/collusion 10/family 6/mentorship 2
- ข้อเสนอ: hire-feasible event pick + faker routine fallback + ~6 storyline ใหม่ + matrix join-date guard

## DeepSeek API (ยังไม่ได้ต่อ)
- docs/deepseek_connect_checklist.md — checklist ครบ: ใส่ key → restart → verify isLLMAvailable()=true + cost tracking
- Local server/.env มีแค่ LLM_SKIP/AZURE_CLIENT_ID/AZURE_TENANT_ID/ONEDRIVE_SYNC_FOLDER/DATABASE_URL — ไม่มี key → isLLMAvailable()=false → ตอบ template
- วิธีต่อ: user เพิ่ม DEEPSEEK_API_KEY + LLM_MODEL=deepseek-v4-flash (+ DEEPSEEK_THINKING=0 อยากปิด thinking) ใน server/.env → restart backend
- ค่าใช้จ่ายโดยประมาณ (v4-flash): 360-gen 150 คน ≈ $1.7 (ปิด thinking + cache → <$1) | 50x50 กับ cloud ≈ <$1

## สิ่งที่ค้าง/ถัดไป
1. **push c558290 + deploy** (รอบสุดท้าย)
2. ต่อ DeepSeek (user ใส่ key) → rerun 50x50 รอบ LLM จริง + รัน 360-gen แบบ API
3. webhook จริงยังไม่ทดสอบ (deploy รอบก่อน success แล้ว — ทดสอบ webhook กับ ACA ได้เลย)
4. Backlog: 202 คู่ไร้ linkage (ข้อเสนอพร้อม), Azure/Flywheel/Enterprise ตัดไว้
5. Cost ลดเพิ่ม (ยังไม่ทำ): ลด max_tokens เพิ่ม, batch ฝั่ง chat

## Commands / Gotchas
- เทสต์ 50x50 UI: node e2e_50x50_ui.mjs (ต้อง backend:5199 + vite) | API 50x50: cd server && node test_multirole_50x50.js | วิเคราะห์: node server/analyze_50x50.mjs <csv>
- 360: cd tools/upgrade_360 && .venv/bin/python cli.py run --help
- evalRag: cd server && node evalRag.js (Recall@5=100%) | registry e2e: node test_registry_e2e.js (17/17)
- ห้าม commit keys/.data; dist/ gitignored (Vercel build); *.csv gitignored (ต้อง git add -f ถ้าจะ commit)
- GH Actions คิวแน่น → deploy อาจถูก cancel; ใช้ gh run list / rerun
- ACA scale-to-zero cold ~20s; health ตอบ 503 warming + Retry-After
