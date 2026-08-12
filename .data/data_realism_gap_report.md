# Data Realism Gap Report — BuildersEye (150 พนักงาน / 23 Sheets)

> รายงานผลการ Audit ความสมจริงของฐานข้อมูลพนักงานตามมุมมองหัวหน้างาน 12 แผนก
> ไฟล์อ้างอิง: `server/.data/registry/employees.json` (ฐานข้อมูลหลักที่ระบบ BuildersEye อ่าน)

## สรุปภาพรวม (Summary)

- จำนวน Check ทั้งหมด: **40**
- ผ่าน (PASS): **40**
- ไม่ผ่าน (GAP): **0**
- สถานะ: **✅ ทุก criterion ผ่าน — ข้อมูลสมจริงครบ 12 แผนก**

ข้อมูล ณ วันที่: 2026-08-10T00:39:27.252357Z

## ผลตรวจรายแผนก (12 Departments)

| แผนก | Check | เป้า | ครอบคลุม | สถานะ |
|---|---|---|---|---|
| Executive (6 คน) | EXEC-CAC — KPI/OKR ต้องพูดถึงการลด CAC และเป้ายอดโอนกรรมสิทธิ์ | 80% | 6/6 (100%) | ✅ |
| Executive (6 คน) | EXEC-TRANSFER — เป้ายอดโอนกรรมสิทธิ์ (transfer target) | 80% | 6/6 (100%) | ✅ |
| Sales (28 คน) | SALES-REJECT — ปัญหาลูกค้ากู้แบงก์ไม่ผ่าน (Mortgage Rejection) | 70% | 28/28 (100%) | ✅ |
| Sales (28 คน) | SALES-DROP — เคสทิ้งดาวน์ / ยกเลิกการจอง | 50% | 28/28 (100%) | ✅ |
| Sales (28 คน) | SALES-SITEVISIT — KPI เรื่องจำนวน Site Visits | 80% | 28/28 (100%) | ✅ |
| Marketing (10 คน) | MKT-FB — เบิกค่า Facebook Ads | 70% | 10/10 (100%) | ✅ |
| Marketing (10 คน) | MKT-TIKTOK — ยิง TikTok | 60% | 10/10 (100%) | ✅ |
| Marketing (10 คน) | MKT-EXPO — ออกบูธมหกรรมบ้านและคอนโด | 60% | 10/10 (100%) | ✅ |
| Design & Architecture (18 คน) | DES-SHOPDRAW — แบบ Shop Drawing ไม่ตรงดิ่ง | 60% | 18/18 (100%) | ✅ |
| Design & Architecture (18 คน) | DES-BOQ — คำนวณ BOQ พลาด | 60% | 18/18 (100%) | ✅ |
| Design & Architecture (18 คน) | DES-CHANGE — ลูกค้าขอแก้แบบจนงานดีเลย์ | 60% | 18/18 (100%) | ✅ |
| Engineering & Construction (38 คน) | ENG-OT — ทำ OT ข้ามคืนเทปูน | 60% | 38/38 (100%) | ✅ |
| Engineering & Construction (38 คน) | ENG-SUBCON — ผู้รับเหมาช่วงทิ้งงาน | 60% | 38/38 (100%) | ✅ |
| Engineering & Construction (38 คน) | ENG-CPAC — ปูน CPAC เข้าหน้างานช้า | 50% | 38/38 (100%) | ✅ |
| Engineering & Construction (38 คน) | ENG-LABOR — ขาดแคลนแรงงานต่างด้าว | 50% | 38/38 (100%) | ✅ |
| Procurement & Warehouse (12 คน) | PROC-STEEL — ซัพพลายเออร์ส่งเหล็กเส้นช้า | 70% | 12/12 (100%) | ✅ |
| Procurement & Warehouse (12 คน) | PROC-TILE — กระเบื้อง Lot สีเพี้ยน | 60% | 12/12 (100%) | ✅ |
| Customer Service & Warranty (12 คน) | CS-LEAK — น้ำรั่วซึมจากขอบหน้าต่างอลูมิเนียม | 60% | 12/12 (100%) | ✅ |
| Customer Service & Warranty (12 คน) | CS-TILE — กระเบื้องร่อน/โปร่ง | 50% | 12/12 (100%) | ✅ |
| Customer Service & Warranty (12 คน) | CS-CRACK — ผนังร้าว (Latent Defect) | 60% | 12/12 (100%) | ✅ |
| Customer Service & Warranty (12 คน) | CS-LAMINATE — พื้นลามิเนตยวบ | 40% | 12/12 (100%) | ✅ |
| Finance & Accounting (10 คน) | FIN-ADV — ปัญหาเบิก Advance หน้างานล่าช้า | 70% | 10/10 (100%) | ✅ |
| Finance & Accounting (10 คน) | FIN-ENT — ค่ารับรองลูกค้า | 60% | 10/10 (100%) | ✅ |
| Finance & Accounting (10 คน) | FIN-KYS — หักหนี้ กยศ. (student-loan garnishment) | 50% | 10/10 (100%) | ✅ |
| HR & Admin (8 คน) | HR-SICKPOL — ลาป่วยการเมือง (politically-motivated sick leave) | 50% | 8/8 (100%) | ✅ |
| HR & Admin (8 คน) | HR-LATE — มาสายเพราะฝนตก/รถติด | 60% | 8/8 (100%) | ✅ |
| HR & Admin (8 คน) | HR-CAMP — ทะเลาะกันในแคมป์คนงาน | 50% | 8/8 (100%) | ✅ |
| HR & Admin (8 คน) | HR-NEPO — ปัญหาเด็กเส้น (Nepotism) | 40% | 8/8 (100%) | ✅ |
| HR & Admin (8 คน) | HR-SSO — โดนหักประกันสังคม (SSO) | 50% | 8/8 (100%) | ✅ |
| IT (4 คน) | IT-ASSET — ระบุยี่ห้อจริง Dell Latitude/ThinkPad/Workstation | 80% | 4/4 (100%) | ✅ |
| IT (4 คน) | IT-BSOD — เคสจอฟ้า | 60% | 4/4 (100%) | ✅ |
| IT (4 คน) | IT-RANSOM — เคสติด Ransomware | 60% | 4/4 (100%) | ✅ |
| IT (4 คน) | IT-NET — ต่อเน็ตไซต์งานไม่ได้ | 60% | 4/4 (100%) | ✅ |
| Legal (2 คน) | LEGAL-TURNKEY — สัญญาจ้างเหมา Turnkey ผิดนัดส่งมอบ | 50% | 2/2 (100%) | ✅ |
| Legal (2 คน) | LEGAL-EIA — ปัญหาการขอ EIA | 50% | 2/2 (100%) | ✅ |
| Legal (2 คน) | LEGAL-SKB — ลูกบ้านฟ้องร้อง สคบ. | 50% | 2/2 (100%) | ✅ |
| Office Support (2 คน) | OFF-BADGE — สถิติทาบบัตร/สแกนนิ้วเข้าไซต์งาน | 50% | 2/2 (100%) | ✅ |
| Office Support (2 คน) | OFF-KEY — กุญแจรถบริษัทหาย | 50% | 2/2 (100%) | ✅ |

## Cross-cutting Checks (ทุกคนทั้ง 150)

- **X-SKILL** — ทุกคนมี Skill_Matrix >= 3 แถวพร้อมสกิลจริง (AutoCAD/Revit/BIM/etc.): 150/150 (coverage 100%) ✅
- **X-BAND** — มีพนักงานเกรด C และ D อยู่ในระบบ (ไม่เพอร์เฟกต์): C=548 / D=260 ✅

## Gap ที่ต้องปิด (ถ้ามี)

ไม่มี gap — ทุก criterion ผ่านเกณฑ์เรียบร้อย

## สิ่งที่ถูกเติม/อัปเดต (Log of changes)

- รันเมื่อ: 2026-08-10T00:38:12.116747Z
- พนักงาน: 150 คน | แถวทั้งหมด: 12407 → 12407 (+0)

### แถวต่อ Sheet (หลังอัปเดต)

- 360_Feedback: 150 rows
- Attendance_Record: 166 rows
- Benefit_Claims: 150 rows
- Career_Timeline: 1000 rows
- Collaboration_Network: 4434 rows
- Compliance_Mandates: 756 rows
- Employee_Engagement: 150 rows
- Employee_Profile: 150 rows
- Expense_Reports: 249 rows
- Grievance_Log: 48 rows
- IT_Asset_Register: 188 rows
- IT_Ticket_Log: 240 rows
- KPI_OKR_History: 896 rows
- Learning_Development: 528 rows
- Onboarding_Journey: 150 rows
- Physical_Security: 150 rows
- Project_History: 891 rows
- Salary_History: 150 rows
- Skill_Matrix: 893 rows
- Software_Licenses: 232 rows
- Succession_Planning: 150 rows
- Timesheet_Log: 378 rows
- Warning_Disciplinary_History: 308 rows

### ผลแต่ละ Stage

- **cluster_a** (Executive + Sales + Marketing + Design & Architecture) — {"employees_enriched": 62, "kpi_updated": 0, "kpi_rows_added": 0, "sales_proj_rows_added": 0, "design_proj_rows_added": 0, "expense_rows_added": 0, "sales_collab_updated": 18, "skill_rows": 364, "departments": {"Executive": 6, "Sales": 28, "Marketing": 10, "Design & Architecture": 18}}
- **cluster_b** (Engineering & Construction + Procurement & Warehouse + Customer Service) — {"cluster": "B", "employees_enriched": 62, "skill_rows": 357, "timesheet_rows_added": 0, "project_rows_added": 0, "kpi_rows_added": 0, "kpi_feedback_updated": 186, "grievance_rows_added": 0, "grievance_rows_filled": 0, "ticket_rows_added": 0, "ticket_rows_filled": 0, "collab_rows_added": 0, "collab_rows_updated": 76, "departments": {"Engineering & Construction": 38, "Procurement & Warehouse": 12, 
- **cluster_c** (Finance & Accounting + HR & Admin + IT) — {"employees_enriched": 22, "finance": {"expense_rows": 0, "salary_notes": 0, "kpi": 0, "skill_rows": 0}, "hr": {"attendance_rows": 0, "warnings": 0, "salary_notes": 0, "kpi": 0, "skill_rows": 0}, "it": {"asset_rows": 0, "ticket_rows": 0, "kpi": 0, "skill_rows": 0}, "warning_case_ids": ["CASE292", "CASE293", "CASE294", "CASE295", "CASE296", "CASE297", "CASE298", "CASE299", "CASE300", "CASE301", "CA
- **cluster_d** (Legal + Office Support) — {"cluster": "D", "employees_enriched": 4, "skill_rows": 0, "mandate_rows_filled": 0, "mandate_rows_added": 0, "kpi_feedback_updated": 3, "physical_rows_updated": 0, "grievance_rows_added": 0, "grievance_rows_filled": 0, "warning_rows_added": 0, "departments": {"Legal": 2, "Office Support": 2}}
- **perfection_pass** (Anti-perfect: C/D bands + imperfect timesheets (all 150)) — {"band_downgraded": 0, "timesheet_rows_added": 0, "attendance_notes": 22, "learning_incomplete": 24}


