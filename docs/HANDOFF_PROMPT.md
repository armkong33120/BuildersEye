# 🤖 BuildersEye — Prompt ส่งต่อสำหรับแชทใหม่ (copy ทั้งบล็อกด้านล่าง)

```
คุณคือผู้ช่วยพัฒนาโปรเจกต์ BuildersEye — Org-Graph Intelligence (HR RAG + 3D Graph)
ทำงานในโฟลเดอร์: /Users/arm/AI Test/mail-onedrive-org-graph
ก่อนทำอะไร: อ่านไฟล์ที่เกี่ยวข้องให้เข้าใจก่อน แล้วค่อยแก้/ทดสอบ/Commit

## โปรเจกต์คืออะไร
ระบบวิเคราะห์ข้อมูล HR 150 คน (ไฟล์ Excel บน OneDrive) ด้วย AI Chat ภาษาไทย + 3D Org Graph
- 150 บัญชีพนักงาน, 23 sheets/คน (Employee_Profile, KPI, Salary, Project...), ~68k records
- RBAC 4 บทบาท (CEO/HR/Manager/Employee) + JWT Auth + Policy Gate
- Hybrid RAG: keyword (inverted index) + vector (pgvector, multilingual-e5-small) RRF fusion + LLM rerank + HyDE
- Recall@5 = 100% (golden set ใน server/eval/golden.json, รัน: cd server && node evalRag.js)

## สถาปัตยกรรมที่ DEPLOY แล้ว (ทำงานจริง)
- Frontend: Vercel → https://builders-eye.vercel.app (landing ที่ /, แอปที่ /app.html)
- Backend: Azure Container Apps → https://builderseye-backend.wittybush-d59275bd.southeastasia.azurecontainerapps.io (scale-to-zero)
- DB: Neon Postgres (pgvector) — source of truth ถาวร: employees + chunks(15738) + registry_meta + onedrive_tokens
- Vectors/Model: Azure Blob stbuilderseye (fallback) — cloud ดึงตอน boot ถ้าไม่มี
- Observability: Application Insights (appi-builderseye) — requests+exceptions+trackAudit (login_ok/login_fail)
- CI/CD: GitHub Actions (.github/workflows/deploy-aca.yml) build → GHCR → az containerapp update (sha tag)
- Keep-warm: ACA Job job-builderseye-keepwarm ping health ทุก 5 นาที 08:00–21:00 ไทย
- OneDrive sync: local (Graph delta) + realtime webhook (POST /api/webhook/onedrive บน ACA, token เก็บใน Neon)
- Auth: JWT (access 30m + refresh 7d rotating), bcryptjs; seed 150 users จาก identity-graph.json
- Emails/sessions registry: server/employeeRegistry.js (dynamic schema, คนเข้า/ออกอัตโนมัติ), write-through → Neon

## โฟลเดอร์สำคัญ (server/)
- index.js (Express ทั้งหมด: routes, requireReady, resolveViewer, registry API, webhook, autosync)
- employeeRegistry.js / registryIngest.js / build-registry.js (data layer dynamic)
- onedriveSync.js / connect-onedrive.js / onedriveWebhook.js / sync-onedrive.js (OneDrive)
- neonStore.js / neonSync.js / migrate-to-neon.js (Postgres)
- vectorStore.js (pgvector + file fallback) / localEmbedder.js (e5-small) / chunker.js / orgDocs.js
- hybridSearch.js / llmRerank.js (RRF + DeepSeek rerank + HyDE)
- chatController.js / sqlEngine.js / searchIndex.js / policy.js / intentParser.js / anonymizer.js
- authStore.js / conversationStore.js / blobSync.js / build-graph.js / evalRag.js
- Dockerfile (node:20-slim + libgomp1; model NOT baked — ดึงจาก Blob ตอน boot)

## คำสั่งประจำ (cd server)
- npm run refresh:data      # sync OneDrive → rebuild registry
- npm run build:vectors     # embed ใหม่ (15.7k chunks, ~16 นาที)
- node build-graph.js       # regenerate identity-graph.json จาก registry
- node test_registry_e2e.js # E2E 17 ข้อ (ต้อง server รันอยู่)
- node e2e-sync-ui.mjs      # E2E ปุ่ม Sync + Registry status (ต้อง vite dev:5174 + backend รันอยู่; BASE env เปลี่ยน target ได้)
- node evalRag.js           # Recall@5 (เป้า 100%)
- node --reindex index.js   # reindex เก่า
- node migrate-to-neon.js   # migrate JSON→Neon

## บัญชีทดสอบ (demo data)
- CEO: ceo / CEO@Landyi2026  (เห็นหมด, สร้าง 8 คน)
- HR: hr-manager / HR@2026test
- Manager: it-manager / Exec@2026test (เห็น subtree IT 4 คน)
- Employee: emp144 / Emp@2026test (เห็นตัวเอง)
- OneDrive demo: account-a = theerachot.si.61@ubu.ac.th (75 ไฟล์), account-b = ddc773@hotmail.com (75 ไฟล์)

## Secrets/env (อยู่ server/.env local + ACA secrets — ห้าม commit)
- DATABASE_URL (Neon), APPINSIGHTS_CONNECTION_STRING, AZURE_CLIENT_ID, LLM_API_KEY (DeepSeek), JWT_SECRET
- ACA: DATABASE_URL=secretref:neon-db-url, APPINSIGHTS..., LLM..., APP_API_KEY เลิกใช้แล้ว (JWT only)
- Vercel: VITE_RAG_BACKEND=https://builderseye-backend...azurecontainerapps.io (Baked ตอน build)
- Render service srv-d9p0e6ugekts73evnivg ถูก suspend (standby, ยังมีอยู่)

## สิ่งที่ยังเหลือ/ต่อไป (อัปเดตล่าสุด)
1. ✅ ปุ่ม Sync + Registry status บนเว็บ — เสร็จแล้ว: topbar ปุ่ม Sync (CEO/HR) + status ⏱, side panel "Registry & Sync" (active employees, data source, last sync, vectors, accounts) + result แถบสี, e2e-sync-ui.mjs ผ่านทุกข้อ
2. ทดสอบ realtime webhook จริง: deploy ยังติด GitHub Actions คิวแน่น (รอ deploy main HEAD: Neon+retrieval+webhook)
3. Azure OpenAI approval (ต้อง user กด portal) — ตัดไว้
4. Flywheel (train-pair→QLoRA→promote gate) — ตัดไว้, eval harness พร้อม
5. Enterprise (Files.Read.All 150 บัญชีจริง, Teams bot) — ตัดไว้

## Gotchas สำคัญ (อ่านก่อนแก้ อย่าพลาด)
- GitHub Actions คิวแน่นช่วงนี้ → deploy อาจถูก cancel; ใช้ gh run list / rerun ตรวจ
- ACA scale-to-zero → cold start ~10-30s นอกเวลา keep-warm; health ตอบ 503 warming + Retry-After
- HNSW vector index ถูก DROP แล้ว (ให้ผลผิด/0 กับ filter) — ใช้ seqscan exact กับ 15.7k rows
- orgdoc index files (Cross_Reference_Map, Employee_Directory...) ถูก block จาก search (ข้อมูลซ้ำ)
- whoBias: คำถาม "ใคร" → person boost ×1.06 / orgdoc ×0.97
- .data/ ถูก gitignore ทั้งหมด; อย่า commit keys/secrets
- Node 24 บน Azure Function (Node 20 EOL); Docker ใช้ node:20-slim + libgomp1 (onnxruntime)
- ESM hoisting: applicationinsights ต้อง import แรกสุดผ่าน appInsightsSetup.js
```
