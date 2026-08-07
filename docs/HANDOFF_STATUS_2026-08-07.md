# 🤖 BuildersEye — HANDOFF สถานะปัจจุบัน (อัปเดต 2026-08-07)

> คัดบล็อกด้านล่างไปวางในแชทใหม่ (context window เดิมเต็มแล้ว):

```
คุณคือผู้ช่วยพัฒนาโปรเจกต์ BuildersEye — Org-Graph Intelligence (HR RAG + 3D Graph)
ทำงานในโฟลเดอร์: /Users/arm/AI Test/mail-onedrive-org-graph
ก่อนทำอะไร: อ่านไฟล์ที่เกี่ยวข้องให้เข้าใจก่อน แล้วค่อยแก้/ทดสอบ/Commit
ไฟล์อ้างอิงหลัก: docs/HANDOFF_PROMPT.md (โปรเจกต์ + สถาปัตยกรรม + secrets + gotchas เต็ม)

## สถานะปัจจุบันทันที (ตรวจก่อนทำอะไร)
- เทสต์ Playwright 50x50 UI กำลังรัน (รายละเอียดในหัวข้อถัดไป) — อย่า restart backend/vite ระหว่างรัน
- Local backend :5199 กำลังรัน (node index.js) | vite dev :5174 กำลังรัน (สำหรับ Playwright)
- git: main ahead origin/main 4 commits (e186650, 8029d09, 44beebd, ace8e98) — ยังไม่ push
- ไฟล์ยังไม่ commit: e2e_50x50_ui.mjs, server/.ui_50x50_progress.json
- DeepSeek API ยังไม่ได้ต่อ (local .env ไม่มี key) — ดูหัวข้อ "DeepSeek API"

## เทสต์ที่กำลังรัน: e2e_50x50_ui.mjs (แบบมนุษย์จริงผ่าน UI)
- เป้าหมาย: 50 ตำแหน่ง × 50 คำถาม = 2500 — เข้าเว็บ → login จริง → พิมพ์ถามในช่องแชท → เก็บคำตอบ
- log: /tmp/ui50-full.log | CSV: server/ui_50x50_results.csv (เขียน real-time) | resume: server/.ui_50x50_progress.json
- เริ่ม ~11:30 local, ความเร็ว ~50 ถาม/2 นาที/คน, avgLat ~2.6s/คำถาม (หน้า 3D หนัก)
- ETA เต็ม 2500 ≈ 2 ชม.; วิธีดู: tail -f /tmp/ui50-full.log; ถ้าหยุดแล้วรันต่อ: node e2e_50x50_ui.mjs (ข้ามคนที่เสร็จแล้ว)
- config: MAX_USERS / Q_PER_USER / TEST_SEED env; ต้อง backend:5199 + vite:5174
- ผลระหว่างทาง (ตอนเขียน): ~1200/2500, ok=1140, blocked=60 (เงินเดือน Manager/Employee), fail=0
- เมื่อจบ: รายงานสถิติรายบทบาท + ตัวอย่างคำตอบ + เทียบกับ API-test (multirole_50x50_results.csv)

## งานที่เสร็จในเซสชันนี้ (commit เรียงใหม่ → เก่า)
1. ace8e98 feat(obs): API cost tracking DeepSeek — tools/upgrade_360/cost_tracker.py + deepseek_client/phase2_generator/main.py + server/llmClient.js (getUsageStats + log [llm-cost]); ราคาปรับได้ DS_PRICE_INPUT/OUTPUT, LLM_PRICE_*
2. 44beebd test: e2e-role-matrix.mjs — Playwright RBAC 4 บทบาท (CEO/HR/Manager/Employee) login จริง ตรวจ userChip/ปุ่ม Sync/chat scope/เงินเดือน block — 20 checks ผ่าน
3. 8029d09 test: test_multirole_50x50.js (API 50x50 = 2500 Q, ใช้ JWT) + multirole_50x50_results.csv + analyze_50x50.mjs — RBAC: CEO/HR 0 block, Manager 66, Employee 61; avgLat 10ms
4. e186650 feat(tools): tools/upgrade_360/ — CLI "360-Degree Digital Twin" สำหรับ 150 คน (ทำโดยทีม 4 agents: architect/core-dev/gen-engineer/qa-validator)
5. 942d6c2 docs: ย้าย Azure OpenAI approval ไปท้ายสุดของงานที่เหลือ
6. 1d111ff chore: ลบ plan docs เก่า/.bak/xlsx ค้าง + commit upload-vectors.js + gitignore __pycache__
7. 02bc074 feat(ui): ปุ่ม Sync OneDrive + Registry status panel (topbar + side panel) — Vercel ขึ้น live แล้ว

## tools/upgrade_360 — 360-Degree Digital Twin CLI (งานใหญ่)
- โครงสร้าง: design/ (DESIGN.md + relationship_matrix.json 2,194 คู่ + storyline_catalog.json 101 events) | cli.py (typer) | main.py (3 เฟส) | excel_io/checkpoint (resume ต่อคน) | faker_routines (th_TH 80%) | deepseek_client (openai→DeepSeek v4-flash + offline template) | pydantic_models | phase2_generator (pair-centric reciprocal) | phase3_validate (150x150 + auto-repair) | tests/ (3 ข้อผ่าน) | cost_tracker.py
- .venv พร้อมแล้ว (python 3.14, pandas 3.0.5 ฯลฯ)
- รัน: cd tools/upgrade_360 && .venv/bin/python cli.py run --phase all --no-api --limit 3 --output-dir out/xxx
- ผล E2E เต็ม 150 คน (--no-api --workers 4 → out/full_150): 150/150 คน, 25,346 events, ตรวจ 2,194 คู่ → failed 0, passRate 100%, auto-repaired 3,142 mismatches; ไฟล์อัปเกรด 68MB ใน out/full_150/hr_onedrive_upgraded (gitignored)
- หมายเหตุ: 202 คู่ใน matrix ไม่มี event จริง (ทั้ง 2 ฝั่งเงียบ) = backlog

## DeepSeek API (ยังไม่ได้ต่อ)
- Local server/.env มีแค่ LLM_SKIP/AZURE_CLIENT_ID/AZURE_TENANT_ID/ONEDRIVE_SYNC_FOLDER/DATABASE_URL — ไม่มี key → isLLMAvailable()=false → ตอบ template
- Cloud (ACA ที่ deploy) ก็ตอบ template เหมือนกัน + deploy ล่าสุดล้ม (GH runner คิวแน่น: "job not acquired by Runner")
- วิธีต่อ: user เพิ่ม DEEPSEEK_API_KEY + LLM_MODEL=deepseek-v4-flash ใน server/.env → restart backend → LLM ตอบจริง + cost tracker นับจริง
- User เติมเงิน DeepSeek ไว้แล้ว (v4 flash ถูกมาก) — key รอ user ใส่

## สิ่งที่ค้าง/ถัดไป
1. รอเทสต์ 50x50 UI จบ → รายงานผล (เทียบกับ API test)
2. ต่อ DeepSeek (user ใส่ key) → rerun 50x50 รอบ LLM จริง + รัน 360-gen แบบ API
3. push 4 commits + deploy (GH runner คิว — gh run list / rerun)
4. Backlog: 202 คู่ไร้ linkage, webhook จริงยังไม่ทดสอบ (รอ deploy), Azure/Flywheel/Enterprise ตัดไว้
5. หลังเทสต์จบ: หยุด vite dev ที่รันไว้ (nohup) — backend เก็บไว้

## Commands / Gotchas
- เทสต์ 50x50 UI: node e2e_50x50_ui.mjs | API 50x50: cd server && node test_multirole_50x50.js | วิเคราะห์: node analyze_50x50.mjs
- 360: cd tools/upgrade_360 && .venv/bin/python cli.py run --help
- evalRag: cd server && node evalRag.js (Recall@5=100%) | registry e2e: node test_registry_e2e.js (17/17)
- ห้าม commit keys/.data; dist/ gitignored (Vercel build); *.csv gitignored (ต้อง git add -f ถ้าจะ commit)
- GH Actions คิวแน่น → deploy อาจถูก cancel; ใช้ gh run list / rerun
- ACA scale-to-zero cold ~20s; health ตอบ 503 warming + Retry-After
```
