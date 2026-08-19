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
