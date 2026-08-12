# scripts/realism — Data Realism Upgrade Pipeline (BuildersEye)

อัปเกรดข้อมูลพนักงาน 150 คน / 23 Sheets ใน `server/.data/registry/employees.json`
ให้สมจริงแบบ "ไฟล์ความลับบริษัทอสังหาฯ-รับเหมาก่อสร้างของไทย" ตามมุมมองหัวหน้างาน 12 แผนก

## Pipeline

| Step | Command | ผลลัพธ์ |
|---|---|---|
| 1. เติมข้อมูล (clusters + perfection) | `python3 scripts/realism/apply_all.py` | เขียน `employees.json` + `schema.json`, log ไปที่ `.data/data_realism_apply_stats.json` |
| 2. Audit ความสมจริง 40 criteria | `python3 scripts/realism/audit_realism.py` | `.data/audit_realism.json` (ผลแยกแผนก) |
| 3. รายงาน Gap (deliverable หลัก) | `python3 scripts/realism/audit_realism.py --report` | `.data/data_realism_gap_report.md` |

## โครงสร้างโมดูล

- `realism_common.py` — shared helpers (load/save, sheet access, seeded RNG, skill pools, schema refresh)
- `dept_cluster_a.py` — Executive, Sales, Marketing, Design & Architecture (62 คน)
- `dept_cluster_b.py` — Engineering & Construction, Procurement & Warehouse, Customer Service (62 คน)
- `dept_cluster_c.py` — Finance & Accounting, HR & Admin, IT (22 คน)
- `dept_cluster_d.py` — Legal, Office Support (4 คน)
- `perfection_pass.py` — anti-perfect pass: เกรด C/D, timesheet ผิดพลาด, human errors (ทุกคน)
- `apply_all.py` — master runner (ลำดับ A→B→C→D→perfection, เขียนไฟล์ครั้งเดียว)
- `audit_realism.py` — 40 checks ครอบคลุม 12 แผนก + cross-cutting (X-SKILL, X-BAND)

## กติกา

- แต่ละ cluster ต้อง deterministic (seeded `rng_for`) + idempotent (รันซ้ำได้ไม่เพิ่มซ้ำ)
- ห้ามแก้ Excel ต้นทาง `src/data/hr_onedrive_demo/` — registry จะถูก build แบบ incremental
  จากไฟล์ Excel และ **ข้ามไฟล์ที่ไม่เปลี่ยน** (hash เดิม) → ข้อมูลที่เติมยังอยู่หลัง restart
- Backup ก่อนรัน: `server/.data/registry/employees.json` → `/tmp/builderseye_employees_backup_before_realism.json`
