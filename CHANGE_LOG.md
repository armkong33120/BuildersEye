# Change Log (การบันทึกการเปลี่ยนแปลง)
> **Purpose:** เก็บบันทึกการเปลี่ยนแปลงทุกครั้งที่มีการแก้ไข ว่าแก้อะไรไปบ้าง และกระทบกับระบบส่วนไหน
> **Rule:** บันทึกเป็นตารางทุกครั้งที่มีการปรับปรุงหรือแก้โค้ดเสร็จสิ้น

| Date / Time | Change Description (รายละเอียดที่แก้ไข) | Affected Systems / Modules (ระบบที่ได้รับผลกระทบ) | Done By (ผู้แก้ไข) |
| :--- | :--- | :--- | :--- |
| 2026-08-18 14:34 | ลบ `requireAuth` ออกจาก `/api/preview/credentials` (แก้บั๊ก Login) | Backend / Auth (server/index.js) | Mr ArmArmCream |
| 2026-08-18 14:58 | อัปเดตข้อความบนหน้า Login เป็น "BuildersEye 1.1..." | Frontend (app.html) | Antigravity AI |
| 2026-08-18 15:03 | แก้ไขสคริปต์เทสต์ E2E ให้ชี้ไปที่ Local Backend `?backend=...` | Testing (scripts/test_ui_...) | Antigravity AI |
| 2026-08-18 15:15 | จัดทำระบบ Log ตามหลัก ITIL (Incident, Problem, Change) | Docs / Knowledge Base | Antigravity AI |

| 2026-08-18 15:21 | แก้ไข `RAG_BACKEND` ให้ชี้ไปที่ลิงก์ของ Microsoft Azure | Frontend (src/main.js) | Antigravity AI |
| 2026-08-19 11:34 | ปรับหน้า Admin "Data Sources" จัดกลุ่มตาม Department รองรับ 1:many (พนักงาน ↔ หลายไฟล์) + เพิ่ม API สร้าง/แก้พนักงาน + Re-index แบบ runtime + sync กราฟ 3D แบบเรียลไทม์ | Backend (adminRoutes.js, access/adminService.js, employeeRegistry.js, registryIngest.js, chunker.js, index.js) / Frontend (src/js/admin.js, src/main.js, src/styles/admin.css) | Antigravity AI |
| 2026-08-19 12:31 | แก้บั๊ก Login: เปลี่ยนค่า default `RAG_BACKEND` ใน `src/main.js:16` จาก Azure เก่า (`builderseye-backend.wittybush...azurecontainerapps.io`) ไปเป็น Render (`builderseye-backend.onrender.com`) ซึ่งเป็น backend ที่ deploy ล่าสุด (รหัสทดสอบคนละตัวกันทำให้ Login ไม่ได้) + รองรับ `VITE_RAG_BACKEND`/`VITE_API_BASE_URL` | Frontend (src/main.js) | Antigravity AI |
| 2026-08-19 13:00 | แก้บั๊กต่อเนื่อง: พบว่าโปรเจกต์ Vercel มี `VITE_RAG_BACKEND` ตั้งไว้ (เป็นค่าเก่า) ซึ่งโค้ดเดิมไม่เคยใช้ แต่โค้ดใหม่ที่เพิ่มเข้าไปทำให้ env นี้ override ค่า default → อัปเดต `VITE_RAG_BACKEND` บน Vercel เป็น `https://builderseye-backend.onrender.com` และ redeploy (commit ว่าง `0b82b47`) เพื่อให้ build ฝังค่า Render | Deployment / Vercel env / Frontend (src/main.js) | Antigravity AI |
| 2026-08-19 13:31 | กำหนด Azure Container Apps เป็น backend หลักของ Production (จ่ายผ่าน Azure Education): จัดการให้ Container App `builderseye-backend` ตื่นตลอด ด้วย `minReplicas=1` (เดิม `0` ทำให้หลับ/cold-start มา), ชี้หน้าทุกหน้าของ frontend (main.js, showcase.js, admin.js) + Vercel env `VITE_RAG_BACKEND` กลับไปที่ Azure | Backend (Azure Container App scale) / Frontend (src/main.js, src/js/showcase.js, src/js/admin.js) / Deployment (Vercel env) | Antigravity AI |
| 2026-08-23 09:12 | Refactor: ย้าย `POST /api/admin/scale-test` ออกจาก `server/index.js` ไปเป็น `router.post('/scale-test', ...)` ใน `server/adminRoutes.js` โดยส่ง `reloadData` + `injectMockOrg` แบบ dependency injection (pattern เดียวกับ `reindex`) | Backend (server/index.js, server/adminRoutes.js) | Antigravity AI |
| 2026-08-23 09:12 | Feature: Hard Delete Employee — เพิ่ม `DELETE /api/admin/employees/:code` (ลบถาวร + cascade ลบ relationship edges ที่อ้างถึง) ใน `adminService.deleteEmployee()` และปุ่ม "Delete (Permanent)" พร้อม `confirm()` บนหน้า Admin | Backend (server/access/adminService.js, server/adminRoutes.js) / Frontend (src/js/admin.js) | Antigravity AI |
| 2026-08-23 09:12 | Feature: AI System Settings — สร้างระบบ config แบบพลวัต (`server/aiConfig.js`) เก็บ `llmModel`/`ragTimeoutMs`/`systemPromptOverride` ลง `server/.data/ai_config.json` + `GET/POST /api/admin/system-config` + แท็บ "⚙️ System Settings" ใน Admin | Backend (server/aiConfig.js ใหม่, server/adminRoutes.js) / Frontend (admin.html, src/js/admin.js) | Antigravity AI |
