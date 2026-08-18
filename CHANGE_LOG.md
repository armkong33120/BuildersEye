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
