# Problem Log (การจัดการปัญหาและสาเหตุที่แท้จริง)
> **Purpose:** บันทึกว่าปัญหานี้เกิดขึ้นตอนไหน, เกิดจากสาเหตุอะไร (Root Cause), ใครเป็นคนทำ และจะป้องกันไม่ให้เกิดซ้ำได้อย่างไร
> **Rule:** บันทึกเป็นตารางหลังจากวิเคราะห์หาสาเหตุที่แท้จริงเรียบร้อยแล้ว

| Date / Time | Incident Ref | Root Cause (สาเหตุที่แท้จริง / ทำไมถึงเกิด) | Who Caused It (ใครทำ) | Preventative Action (วิธีป้องกัน) |
| :--- | :--- | :--- | :--- | :--- |
| 2026-08-18 15:05 | 2026-08-18 Login พัง | มีการเพิ่ม `requireAuth` ใน API ที่ต้องใช้ก่อน Login ทำให้ติดลูป Chicken-and-Egg | Mr ArmArmCream | ห้ามใส่ Auth Middleware บล็อก API ที่ต้องใช้ในหน้า Pre-login |

| 2026-08-18 15:21 | 2026-08-18 Slow Login | ลืมแก้ Hardcode URL ใน `src/main.js` ตอนย้ายระบบ ทำให้ Frontend ยังชี้ไปที่ Render ตัวเก่า (ซึ่ง Sleep ได้) แทนที่จะเป็น Azure ที่ซื้อ Plan ไว้ | Migration Team / Antigravity | ควรใช้ Environment Variables (เช่น `.env` ของ Vercel) แทนการ Hardcode URL เพื่อความยืดหยุ่น |
| 2026-08-23 09:08 | 2026-08-23 ลบบันทึก CEO (EMP001) โดยไม่ตั้งใจ | Smoke test ของ route `DELETE /employees/:code` ถูก mount กับ real store เพราะ `ACCESS_DB_ADAPTER` ไม่ได้ตั้งค่า → access store ทำงานในโหมดไฟล์ JSON (`server/.data/access/`) และตัว test ไม่ได้แยก data dir ออก ทำให้คำสั่ง DELETE ไปแก้ข้อมูลจริง (ไม่ใช่ข้อมูลจำลอง) | Antigravity AI (ระหว่างทดสอบ) | ห้ามรัน destructive smoke test กับข้อมูลจริง: ทุก test ที่แตะ access store ต้องชี้ `ACCESS_DATA_DIR` ไป temp dir แยก (เป็นไฟล์ จำลอง) ก่อนเสมอ และตรวจสอบว่า test ใช้ mock/store ที่แยกออกจาก production data |
| 2026-08-23 11:08 | 2026-08-23 เสี่ยงลบ CEO ซ้ำ (การป้องกันยังเป็น "วินัย" เท่านั้น) | มีเพียงกฎการทำงาน/ระเบียบเท่านั้นที่ป้องกันการลบ CEO — ยังไม่มี guard ในโค้ด ระบบจึงเสี่ยงถูก destructive test หรือ admin session ที่พลาดลบ account CEO จริงซ้ำได้ | Antigravity AI (จาก review) | เพิ่ม guard ใน `deleteEmployee()` ให้ปฏิเสธ (403) เมื่อเป้าหมายเป็น `GLOBAL_ADMIN` + บังคับเป็นกฎ `.clinerules` ให้ destructive test ใช้ `ACCESS_DATA_DIR` ชั่วคราวเสมอ (ไม่ใช่ default data dir) |
