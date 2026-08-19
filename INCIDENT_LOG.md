# Incident Log (การจัดการอุบัติการณ์)
> **Purpose:** บันทึกว่าเกิดเหตุการณ์อะไรขึ้น และแก้ไขเฉพาะหน้าเพื่อกู้ระบบให้กลับมาใช้งานได้เร็วที่สุดได้อย่างไร (Quick Fix / Workaround)
> **Rule:** บันทึกเป็นตารางทุกครั้งเมื่อเกิดเหตุและแก้ไขเบื้องต้นแล้ว

| Date / Time | Symptom / Issue (อาการที่พบ) | Immediate Action / Quick Fix (วิธีแก้เฉพาะหน้าเพื่อกู้ระบบ) | Status |
| :--- | :--- | :--- | :--- |
| 2026-08-18 15:00 | ผู้ใช้เข้าระบบไม่ได้ หน้า Login พัง (Timeout / 403) | นำ `requireAuth` ออกจาก API `/api/preview/credentials` ทันทีเพื่อให้ระบบ Login กลับมาทำงานได้ | Resolved |

| 2026-08-18 15:21 | หน้าเว็บใช้เวลา Login นานผิดปกติ (27 วิ) เพราะ Backend หลับ | เปลี่ยน URL ชี้ไปที่ Azure Container Apps ทันทีเพื่อให้ระบบตอบสนองไวขึ้น | Resolved |
| 2026-08-19 12:31 | ผู้ใช้ Login ไม่ได้ ได้รับ "Invalid username or password" เพราะ frontend ชี้ default ไป backend Azure เก่าที่ใช้รหัสทดสอบคนละตัวกับ backend Render ที่ deploy ล่าสุด | เปลี่ยนค่า default `RAG_BACKEND` ใน `src/main.js` ไปชี้ที่ Render (`builderseye-backend.onrender.com`) และรองรับ env override | Resolved |
