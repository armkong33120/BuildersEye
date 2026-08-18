# Problem Log (การจัดการปัญหาและสาเหตุที่แท้จริง)
> **Purpose:** บันทึกว่าปัญหานี้เกิดขึ้นตอนไหน, เกิดจากสาเหตุอะไร (Root Cause), ใครเป็นคนทำ และจะป้องกันไม่ให้เกิดซ้ำได้อย่างไร
> **Rule:** บันทึกเป็นตารางหลังจากวิเคราะห์หาสาเหตุที่แท้จริงเรียบร้อยแล้ว

| Date / Time | Incident Ref | Root Cause (สาเหตุที่แท้จริง / ทำไมถึงเกิด) | Who Caused It (ใครทำ) | Preventative Action (วิธีป้องกัน) |
| :--- | :--- | :--- | :--- | :--- |
| 2026-08-18 15:05 | 2026-08-18 Login พัง | มีการเพิ่ม `requireAuth` ใน API ที่ต้องใช้ก่อน Login ทำให้ติดลูป Chicken-and-Egg | Mr ArmArmCream | ห้ามใส่ Auth Middleware บล็อก API ที่ต้องใช้ในหน้า Pre-login |

| 2026-08-18 15:21 | 2026-08-18 Slow Login | ลืมแก้ Hardcode URL ใน `src/main.js` ตอนย้ายระบบ ทำให้ Frontend ยังชี้ไปที่ Render ตัวเก่า (ซึ่ง Sleep ได้) แทนที่จะเป็น Azure ที่ซื้อ Plan ไว้ | Migration Team / Antigravity | ควรใช้ Environment Variables (เช่น `.env` ของ Vercel) แทนการ Hardcode URL เพื่อความยืดหยุ่น |
