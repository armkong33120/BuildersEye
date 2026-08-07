# -*- coding: utf-8 -*-
"""faker_routines.py — Routine Logs ภาษาไทย (80% ของแถว)

ใช้ Faker(locale='th_TH') + template กิจกรรมรายวัน/รายสัปดาห์ตามตำแหน่ง/แผนก
- ประชุม, ออก site, ติดตามงาน, จัดซื้อ, ขาย, เขียนรายงาน, training ฯลฯ
- timestamp เรียงตามเวลา ภายในช่วง hire date จนถึง as_of (ค่าเริ่มต้น 2026-08-07)
- routine event ที่มีคู่คน (ประชุมกับเพื่อนร่วมทีม) → link ผ่าน relationship matrix
  แบบ low-key (~20% ของแถว routine) — phase2_generator จะสร้างฝั่ง mirror ให้

เจ้าของไฟล์: Data Generation (Phase 2)
"""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from faker import Faker

try:  # รันแบบ package
    from .pydantic_models import COMMON_COLS, RoutineLogRow
    from .deepseek_client import _stable_seed

except ImportError:  # รันแบบ script ตรง
    from pydantic_models import COMMON_COLS, RoutineLogRow
    from deepseek_client import _stable_seed

# ---------------------------------------------------------------------------
# คอลัมน์เดิมของแต่ละ sheet (อ้างอิงจาก scripts/build_excel_files.py)
# ---------------------------------------------------------------------------
SHEET_ORIGINAL_COLS: Dict[str, List[str]] = {
    "Employee_Profile": ["pk","code","name","department","jobTitle","roleGroup","managerCode","managerName","email","mailAlias","licensePlan","mailboxQuotaGb","oneDriveQuotaGb","oneDriveUrl","oneDriveOwner","mfaStatus","accountStatus","accountRisk","hierarchyDepth","directReportCount","hireDate","tenureMonths","startingPosition","currentPositionStartDate","promotionCount","mainStrength","mainWeakness","learningTheme","retentionRisk","successionPotential"],
    "Career_Timeline": ["date","eventType","title","department","notes"],
    "KPI_OKR_History": ["reviewPeriod","kpiScore","okrScore","performanceBand","strongArea","weakArea","managerFeedback","improvementPlan","followUpStatus"],
    "Project_History": ["projectId","role","contributionSummary","individualOutcome","hasMistake","mistakeIssue","recoveryAction"],
    "Collaboration_Network": ["collaboratorEmployeeId","collaboratorName","collaboratorDept","projectId","relationshipType","collaborationQuality","hasConflict","conflictSummary","resolutionSummary"],
    "Warning_Disciplinary_History": ["caseId","caseDate","caseType","severity","formalWarning","summary","rootCause","actionTaken","resolutionStatus","managerInvolved","hrConfidentialityLevel","redactionRequired","linkedProjectId","linkedTrainingId"],
    "Learning_Development": ["trainingId","trainingName","required","completionStatus","completionDate","skillArea","skillLevelBefore","skillLevelAfter","relatedMistake","relatedProjectId","notes"],
    "IT_Asset_Register": ["Asset_Type","Brand","Cost_THB","Status"],
    "IT_Ticket_Log": ["Ticket_Issue","Status"],
    "Software_Licenses": ["License_Name","Status"],
    "Salary_History": ["Base_Salary","Bonus_Months","Increase_Percent"],
    "Attendance_Record": ["Sick_Leave_Days","Personal_Leave_Days","Late_Arrivals"],
    "360_Feedback": ["Reviewer_Type","Comment"],
    "Skill_Matrix": ["Core_Skill","Language_Score_IELTS","Certification"],
    "Succession_Planning": ["Flight_Risk_Pct","Impact_of_Loss","Readiness"],
    "Benefit_Claims": ["Medical_THB","Dental_THB","Wellness_THB"],
    "Expense_Reports": ["Travel_THB","Entertainment_THB","Office_Supplies_THB"],
    "Grievance_Log": ["Complaint_Type","Status"],
    "Compliance_Mandates": ["Mandate","Status"],
    "Onboarding_Journey": ["Culture_Fit_Score","Interview_Score","Buddy_Name"],
    "Employee_Engagement": ["eNPS","Burnout_Risk"],
    "Physical_Security": ["Access_Zone","Parking_Slot","Last_Badge_Swipe"],
    "Timesheet_Log": ["Billable_Hours_Pct","Admin_Hours_Pct"],
}

# ---------------------------------------------------------------------------
# source ต่อ sheet (ระบบต้นทาง)
# ---------------------------------------------------------------------------
SHEET_SOURCE: Dict[str, str] = {
    "Employee_Profile": "HRIS", "Career_Timeline": "HRIS", "KPI_OKR_History": "HRIS",
    "Project_History": "PMO", "Collaboration_Network": "OrgGraph",
    "Warning_Disciplinary_History": "HRIS", "Learning_Development": "LMS",
    "IT_Asset_Register": "ITSM", "IT_Ticket_Log": "ITSM", "Software_Licenses": "ITSM",
    "Salary_History": "HRIS", "Attendance_Record": "Badge", "360_Feedback": "360",
    "Skill_Matrix": "LMS", "Succession_Planning": "HRIS", "Benefit_Claims": "HRIS",
    "Expense_Reports": "Expense", "Grievance_Log": "HRIS", "Compliance_Mandates": "Legal",
    "Onboarding_Journey": "HRIS", "Employee_Engagement": "360",
    "Physical_Security": "Badge", "Timesheet_Log": "HRIS",
}

PROJECT_IDS: List[str] = [f"PRJ{i:03d}" for i in range(1, 71)]
PROJECT_ROLES: List[str] = ["Contributor", "Key Contributor", "Project Lead", "Team Lead",
                            "Reviewer", "Specialist", "Support", "Department Lead",
                            "Executive Sponsor", "Steering Committee"]
SITES: List[str] = ["site-nonthaburi", "site-bangna", "site-chaengwattana",
                    "site-rangsit", "site-samutprakarn"]

# กิจกรรม routine ที่เป็นคู่ (ประชุม/ประสานงาน) — ใช้ link ผ่าน matrix
PAIR_ACTIVITY_HINTS = ("ประชุม", "ประสานงาน", "ปรึกษา", "ติดตามร่วม", "ทบทวนร่วม", "workshop")

# ---------------------------------------------------------------------------
# Routine activity pools ต่อแผนก — (sheet, กิจกรรมภาษาไทย, location, weight)
# ---------------------------------------------------------------------------
DEPT_ROUTINE_POOL: Dict[str, List[Tuple[str, str, str, int]]] = {
    "Executive": [
        ("Timesheet_Log", "ประชุมผู้บริหารทบทวนผลประกอบการประจำเดือน", "HQ", 8),
        ("Timesheet_Log", "ประชุมติดตามแผนกลยุทธ์รายไตรมาส", "HQ", 6),
        ("Timesheet_Log", "ทบทวนรายงานผลการดำเนินงานจากทุกแผนก", "HQ", 6),
        ("Timesheet_Log", "ประชุมคณะกรรมการนโยบายการเงิน", "HQ", 4),
        ("Project_History", "ประชุมสปอนเซอร์โครงการ ทบทวนสถานะการลงทุน", "HQ", 5),
        ("Collaboration_Network", "ประชุมกับหัวหน้าฝ่าย ทบทวนผลงานรายเดือน", "HQ", 6),
        ("KPI_OKR_History", "ทบทวน KPI/OKR ของสายงานประจำไตรมาส", "HQ", 5),
        ("360_Feedback", "รับฟัง feedback จากบอร์ดบริหาร", "HQ", 3),
        ("Learning_Development", "เข้าร่วมอบรมภาวะผู้นำสำหรับผู้บริหาร", "HQ", 2),
        ("Expense_Reports", "เบิกค่าใช้จ่ายเดินทางประชุมกับสถาบันการเงิน", "HQ", 2),
        ("Attendance_Record", "ลงเวลาปฏิบัติงานประจำวัน", "HQ", 8),
    ],
    "Engineering & Construction": [
        ("Timesheet_Log", "ออกตรวจงานหน้างานโครงการ", "site", 10),
        ("Timesheet_Log", "ประชุมความคืบหน้าหน้างานรายสัปดาห์", "site", 8),
        ("Timesheet_Log", "ติดตามผู้รับเหมาเรื่องความคืบหน้างาน", "site", 7),
        ("Project_History", "บันทึกความคืบหน้าการก่อสร้างโครงการ", "site", 7),
        ("Collaboration_Network", "ประชุมประสานงานกับสถาปนิก/วิศวกรออกแบบ", "HQ", 6),
        ("Attendance_Record", "ลงเวลาทำงานหน้างาน", "site", 8),
        ("Learning_Development", "อบรมความปลอดภัยหน้างาน (Safety)", "site", 4),
        ("IT_Ticket_Log", "แจ้งซ่อมเครื่องมือวัดหน้างาน", "site", 2),
        ("Expense_Reports", "เบิกค่าน้ำมันเดินทางตรวจหน้างาน", "site", 3),
    ],
    "Sales": [
        ("Timesheet_Log", "โทรติดตามลูกค้าเป้าหมาย", "HQ", 9),
        ("Timesheet_Log", "ประชุมทีมขายประจำสัปดาห์", "HQ", 7),
        ("Timesheet_Log", "พาลูกค้าชมโครงการบ้านตัวอย่าง", "site", 7),
        ("Project_History", "ติดตามสถานะการโอนบ้านลูกค้า", "HQ", 5),
        ("Collaboration_Network", "ประชุมร่วมกับฝ่ายก่อสร้างเรื่องวันโอนบ้าน", "HQ", 6),
        ("KPI_OKR_History", "ทบทวนยอดขายรายเดือนเทียบเป้า", "HQ", 5),
        ("Expense_Reports", "เบิกค่าเดินทางพบลูกค้าต่างจังหวัด", "HQ", 3),
        ("Learning_Development", "อบรมเทคนิคการขายและบริการ", "HQ", 3),
        ("Attendance_Record", "ลงเวลาปฏิบัติงานประจำวัน", "HQ", 8),
        ("IT_Ticket_Log", "ขอสิทธิ์เข้าถึง CRM เพื่อปิดดีลลูกค้า", "HQ", 2),
    ],
    "Procurement & Warehouse": [
        ("Timesheet_Log", "จัดซื้อวัสดุก่อสร้างและเปรียบเทียบใบเสนอราคา", "HQ", 9),
        ("Timesheet_Log", "ตรวจรับของเข้าคลังและตรวจสอบเอกสาร", "site", 7),
        ("Timesheet_Log", "ตรวจนับสต็อกประจำเดือน", "site", 6),
        ("Project_History", "ติดตามการส่งมอบวัสดุโครงการ", "site", 5),
        ("Collaboration_Network", "ประสานงานกับผู้รับเหมา/ซัพพลายเออร์", "HQ", 6),
        ("Expense_Reports", "เบิกค่าน้ำมันขนส่งวัสดุ", "site", 3),
        ("IT_Ticket_Log", "ลงทะเบียนวัสดุในระบบ ERP", "HQ", 2),
        ("Attendance_Record", "ลงเวลาปฏิบัติงานประจำวัน", "HQ", 8),
        ("Learning_Development", "อบรมมาตรฐานการจัดซื้อจัดจ้าง", "HQ", 2),
    ],
    "Finance & Accounting": [
        ("Timesheet_Log", "ปิดบัญชีประจำเดือน", "HQ", 8),
        ("Timesheet_Log", "ตรวจสอบใบเบิก/ใบสำคัญจ่าย", "HQ", 7),
        ("Timesheet_Log", "จัดทำงบประมาณประจำปี", "HQ", 6),
        ("KPI_OKR_History", "ทบทวนตัวเลขทางการเงินรายเดือน", "HQ", 5),
        ("Collaboration_Network", "ประสานงานกับฝ่ายขายเรื่องรายได้และลูกหนี้", "HQ", 5),
        ("Learning_Development", "อบรมมาตรฐานบัญชีใหม่", "HQ", 3),
        ("Expense_Reports", "เบิกค่าใช้จ่ายเดินทางไปธนาคาร", "HQ", 2),
        ("Attendance_Record", "ลงเวลาปฏิบัติงานประจำวัน", "HQ", 8),
    ],
    "HR & Admin": [
        ("Timesheet_Log", "ประมวลเงินเดือนประจำเดือน", "HQ", 7),
        ("Timesheet_Log", "สัมภาษณ์ผู้สมัครงานรอบแรก", "HQ", 6),
        ("Timesheet_Log", "จัดกิจกรรม/อบรมพัฒนาพนักงาน", "HQ", 5),
        ("Collaboration_Network", "พูดคุยกับหัวหน้าแผนกเรื่องอัตรากำลัง", "HQ", 5),
        ("KPI_OKR_History", "ติดตามผล engagement และอัตราการลาออก", "HQ", 4),
        ("Grievance_Log", "รับเรื่องร้องเรียนและให้คำปรึกษาพนักงาน", "HQ", 4),
        ("Attendance_Record", "ลงเวลาปฏิบัติงานประจำวัน", "HQ", 8),
        ("Expense_Reports", "เบิกค่าวัสดุจัดกิจกรรม", "HQ", 2),
        ("Learning_Development", "อบรมกฎหมายแรงงานและวินัยพนักงาน", "HQ", 2),
    ],
    "IT": [
        ("Timesheet_Log", "แก้ไข ticket ของผู้ใช้", "HQ", 8),
        ("Timesheet_Log", "สำรองข้อมูลระบบประจำวัน", "HQ", 6),
        ("Timesheet_Log", "ตรวจสอบสิทธิ์การเข้าถึงระบบ", "HQ", 5),
        ("IT_Ticket_Log", "ปิด ticket ตาม SLA", "HQ", 6),
        ("Collaboration_Network", "ประสานงานกับฝ่ายอื่นเรื่องระบบ ERP/CRM", "HQ", 5),
        ("Learning_Development", "อบรมความปลอดภัยไซเบอร์ประจำปี", "HQ", 3),
        ("Expense_Reports", "เบิกค่าเดินทางไปติดตั้งอุปกรณ์สาขา", "site", 2),
        ("Attendance_Record", "ลงเวลาปฏิบัติงานประจำวัน", "HQ", 8),
    ],
    "Design & Architecture": [
        ("Timesheet_Log", "เขียนแบบ/แก้แบบตาม feedback ลูกค้า", "HQ", 9),
        ("Timesheet_Log", "ประชุมออกแบบกับทีมสถาปนิก", "HQ", 7),
        ("Project_History", "ส่งมอบแบบก่อสร้างโครงการ", "HQ", 6),
        ("Collaboration_Network", "ประชุมกับวิศวกรโครงสร้างเรื่องแบบ", "HQ", 6),
        ("Learning_Development", "อบรมซอฟต์แวร์ออกแบบรุ่นใหม่", "HQ", 3),
        ("Attendance_Record", "ลงเวลาปฏิบัติงานประจำวัน", "HQ", 8),
        ("IT_Ticket_Log", "ขอเพิ่มหน่วยความจำเครื่องคอมพิวเตอร์ออกแบบ", "HQ", 2),
    ],
    "Marketing": [
        ("Timesheet_Log", "วางแผนแคมเปญการตลาดประจำเดือน", "HQ", 8),
        ("Timesheet_Log", "วิเคราะห์ผลแคมเปญและยอด engagement", "HQ", 7),
        ("Collaboration_Network", "ประชุมกับเอเจนซี/ทีมขายเรื่องโปรโมชัน", "HQ", 6),
        ("KPI_OKR_History", "ติดตาม KPI การตลาดรายเดือน", "HQ", 5),
        ("IT_Ticket_Log", "แก้ไขปัญหาหน้าเว็บ/CRM การตลาด", "HQ", 3),
        ("Learning_Development", "อบรมเครื่องมือโฆษณาออนไลน์", "HQ", 3),
        ("Attendance_Record", "ลงเวลาปฏิบัติงานประจำวัน", "HQ", 8),
        ("Expense_Reports", "เบิกค่าวัสดุทำสื่อแคมเปญ", "HQ", 2),
    ],
    "Customer Service & Warranty": [
        ("Timesheet_Log", "รับเรื่องร้องเรียนลูกค้าผ่านช่องทางต่างๆ", "HQ", 9),
        ("Timesheet_Log", "ติดตามเคลมประกันบ้านให้ลูกค้า", "HQ", 7),
        ("Timesheet_Log", "โทรแจ้งความคืบหน้าให้ลูกค้า", "HQ", 6),
        ("Collaboration_Network", "ประสานฝ่ายก่อสร้างเรื่องงานเคลม", "HQ", 6),
        ("Grievance_Log", "ปิดเรื่องร้องเรียนหลังแก้ไขเสร็จ", "HQ", 4),
        ("Attendance_Record", "ลงเวลาปฏิบัติงานประจำวัน", "HQ", 8),
        ("Learning_Development", "อบรมการบริการลูกค้า", "HQ", 3),
    ],
    "Legal": [
        ("Timesheet_Log", "ทบทวนร่างสัญญากับคู่ค้า/ลูกค้า", "HQ", 8),
        ("Timesheet_Log", "ตรวจสอบ compliance ของเอกสาร", "HQ", 6),
        ("Collaboration_Network", "ประชุมกับฝ่ายจัดซื้อเรื่องเงื่อนไขสัญญา", "HQ", 5),
        ("Compliance_Mandates", "ทบทวนข้อกำหนดกฎหมายที่เกี่ยวข้อง", "HQ", 5),
        ("Attendance_Record", "ลงเวลาปฏิบัติงานประจำวัน", "HQ", 8),
        ("Learning_Development", "อบรมกฎหมาย PDPA และแรงงาน", "HQ", 3),
    ],
    "Office Support": [
        ("Timesheet_Log", "ประสานงานจองห้องประชุม/จัดเตรียมเอกสาร", "HQ", 9),
        ("Timesheet_Log", "จัดซื้อวัสดุสำนักงาน", "HQ", 6),
        ("Collaboration_Network", "ประสานงานกับทุกแผนกเรื่องงานธุรการ", "HQ", 5),
        ("Expense_Reports", "เบิกค่าวัสดุสำนักงาน", "HQ", 3),
        ("Attendance_Record", "ลงเวลาปฏิบัติงานประจำวัน", "HQ", 8),
        ("IT_Ticket_Log", "แจ้งซ่อมเครื่องพิมพ์/อุปกรณ์สำนักงาน", "HQ", 2),
    ],
}

# pool ทั่วไป (ใช้เสริมเมื่อแผนกไหนมี pool ไม่พอ)
GENERIC_POOL: List[Tuple[str, str, str, int]] = [
    ("Timesheet_Log", "ประชุมทีมประจำสัปดาห์", "HQ", 8),
    ("Timesheet_Log", "เขียนรายงานสรุปงานประจำสัปดาห์", "HQ", 6),
    ("Timesheet_Log", "ตอบอีเมลและติดตามงานค้าง", "HQ", 6),
    ("Attendance_Record", "ลงเวลาปฏิบัติงานประจำวัน", "HQ", 8),
    ("Expense_Reports", "เบิกค่าใช้จ่ายประจำเดือนตามปกติ", "HQ", 3),
    ("Learning_Development", "เรียนรู้หลักสูตรออนไลน์พัฒนาทักษะ", "HQ", 2),
]

# ---------------------------------------------------------------------------
# ค่าเติมสำหรับคอลัมน์เดิมของแต่ละ sheet
# ---------------------------------------------------------------------------
def orig_values_for(sheet: str, emp: Dict[str, Any], ctx: Any, rng: random.Random,
                    dt: Optional[datetime] = None, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """สร้างค่า (dict ตามคอลัมน์เดิม) สำหรับแถว routine ลง sheet ต่าง ๆ."""
    extra = extra or {}
    dt = dt or datetime.now()
    dept = emp.get("department", "")
    if sheet == "Timesheet_Log":
        bill = rng.randint(55, 95)
        return {"Billable_Hours_Pct": bill, "Admin_Hours_Pct": 100 - bill}
    if sheet == "Attendance_Record":
        roll = rng.random()
        if roll < 0.85:
            return {"Sick_Leave_Days": 0, "Personal_Leave_Days": 0, "Late_Arrivals": 0}
        if roll < 0.92:
            return {"Sick_Leave_Days": 1, "Personal_Leave_Days": 0, "Late_Arrivals": 0}
        return {"Sick_Leave_Days": 0, "Personal_Leave_Days": 1, "Late_Arrivals": 0}
    if sheet == "Expense_Reports":
        return {"Travel_THB": rng.randint(0, 6000), "Entertainment_THB": rng.randint(0, 4000),
                "Office_Supplies_THB": rng.randint(0, 2500)}
    if sheet == "Collaboration_Network":
        other_code = extra.get("other", "")
        other = ctx.identity_by_code.get(other_code, {}) if other_code else {}
        rel = extra.get("relationship", "work_partner")
        rel_name = {"work_partner": "คู่ทำงาน", "friendship": "เพื่อนร่วมงาน", "mentorship": "พี่เลี้ยง",
                    "family": "ญาติ", "conflict": "ขัดแย้ง", "collusion": "สมคบ"}.get(rel, rel)
        return {
            "collaboratorEmployeeId": other.get("pk", ""),
            "collaboratorName": other.get("name", ""),
            "collaboratorDept": other.get("department", ""),
            "projectId": extra.get("projectId", rng.choice(PROJECT_IDS)),
            "relationshipType": rel_name,
            "collaborationQuality": rng.choice(["Good", "Good", "Normal", "Normal", "Difficult"]) if rel in ("conflict",) else rng.choice(["Good", "Good", "Normal"]),
            "hasConflict": "Yes" if rel in ("conflict", "collusion") else "No",
            "conflictSummary": ("ความเห็นต่างในการทำงานร่วมกัน" if rel in ("conflict", "collusion") else ""),
            "resolutionSummary": ("ประชุมไกล่เกลี่ยและกำหนดแนวทางร่วมกัน" if rel in ("conflict", "collusion") else ""),
        }
    if sheet == "Project_History":
        return {"projectId": rng.choice(PROJECT_IDS), "role": rng.choice(PROJECT_ROLES),
                "contributionSummary": extra.get("activity", ""), "individualOutcome": "สำเร็จตามแผน",
                "hasMistake": "No", "mistakeIssue": "", "recoveryAction": ""}
    if sheet == "KPI_OKR_History":
        q = f"{dt.year}-Q{(dt.month - 1) // 3 + 1}"
        score = round(rng.uniform(2.6, 4.4), 1)
        band = "Meets (C)" if score < 3.7 else "Exceeds (B)"
        return {"reviewPeriod": q, "kpiScore": score, "okrScore": round(max(1.0, score - rng.uniform(0.1, 0.5)), 1),
                "performanceBand": band, "strongArea": rng.choice(["Teamwork", "Execution", "Communication"]),
                "weakArea": rng.choice(["Time Management", "Reporting", "Cross-dept Coordination"]),
                "managerFeedback": "ผลงานเป็นไปตามเป้าหมาย ควรรักษามาตรฐานนี้ต่อไป", "improvementPlan": "", "followUpStatus": ""}
    if sheet == "Learning_Development":
        return {"trainingId": "TRN-" + str(rng.randint(1000, 9999)), "trainingName": extra.get("activity", "อบรมพัฒนาทักษะ"),
                "required": "Yes", "completionStatus": "Completed", "completionDate": dt.strftime("%Y-%m-%d"),
                "skillArea": rng.choice(["Technical", "Soft Skill", "Compliance"]), "skillLevelBefore": "2",
                "skillLevelAfter": "3", "relatedMistake": "", "relatedProjectId": "", "notes": ""}
    if sheet == "IT_Ticket_Log":
        return {"Ticket_Issue": extra.get("activity", "ปัญหาเล็กน้อยเกี่ยวกับอุปกรณ์"), "Status": "Resolved"}
    if sheet == "Grievance_Log":
        return {"Complaint_Type": extra.get("activity", "ข้อร้องเรียนทั่วไป"), "Status": "Resolved"}
    if sheet == "360_Feedback":
        return {"Reviewer_Type": rng.choice(["Peer", "Manager", "Subordinate"]), "Comment": extra.get("activity", "ทำงานดี มีส่วนร่วมสูง")}
    if sheet == "Career_Timeline":
        return {"date": dt.strftime("%Y-%m-%d"), "eventType": "Milestone", "title": extra.get("activity", "งานประจำ"),
                "department": dept, "notes": "บันทึกเหตุการณ์ประจำ"}
    if sheet == "Compliance_Mandates":
        return {"Mandate": extra.get("activity", "ทบทวนข้อกำหนด compliance"), "Status": "Compliant"}
    if sheet == "Physical_Security":
        return {"Access_Zone": rng.choice(["HQ-Zone-A", "HQ-Zone-B", "Site-Zone"]), "Parking_Slot": "P" + str(rng.randint(1, 150)),
                "Last_Badge_Swipe": dt.strftime("%Y-%m-%dT%H:%M:%S")}
    if sheet == "Employee_Engagement":
        return {"eNPS": rng.randint(15, 65), "Burnout_Risk": rng.choice(["Low", "Low", "Moderate"])}
    if sheet == "Benefit_Claims":
        return {"Medical_THB": rng.randint(0, 5000), "Dental_THB": rng.randint(0, 3000), "Wellness_THB": rng.randint(0, 2000)}
    if sheet == "Succession_Planning":
        return {"Flight_Risk_Pct": rng.randint(5, 40), "Impact_of_Loss": rng.choice(["Low", "Medium"]),
                "Readiness": rng.choice(["Ready in 1-2y", "Ready in 3y+"])}
    if sheet == "Skill_Matrix":
        return {"Core_Skill": extra.get("activity", "ทักษะวิชาชีพ"), "Language_Score_IELTS": rng.randint(5, 8),
                "Certification": rng.choice(["", "", "AutoCAD", "PMP", "CPA"]).strip()}
    return {}


def _fmt_iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S+07:00")


def _working_days(start: date, end: date) -> List[date]:
    days: List[date] = []
    cur = start
    while cur <= end:
        if cur.weekday() < 5:  # จ-ศ
            days.append(cur)
        cur += timedelta(days=1)
    return days

# ---------------------------------------------------------------------------
def generate_routine_plan(emp: Dict[str, Any], ctx: Any, budget: int) -> List[Dict[str, Any]]:
    """สร้าง routine rows จำนวน ~budget แถว สำหรับพนักงาน 1 คน

    ใช้ ctx.rng, ctx.identity_by_code, ctx.pairs_by_code, ctx.hire_date(code)
    - timestamp เรียงตามเวลา (ทำงาน จ-ศ, 08:30-18:00) ระหว่าง hire date ถึง as_of
    - ~routine_pair_ratio ของแถว ประชุม/ประสานงาน จะ link กับคู่จาก relationship matrix
      (field ``pairWith``) เพื่อให้ phase2_generator สร้างฝั่ง mirror ให้คนคู่นั้น

    Return: list ของ dict (schema เดียวกับ RoutineLogRow + originalCols + pairWith)
    """
    rng = ctx.get_rng() if hasattr(ctx, "get_rng") else ctx.rng
    code = emp["code"]
    dept = emp.get("department", "")
    as_of = ctx.config.get("as_of", "2026-08-07")
    hire = ctx.hire_date(code) or date(2018, 1, 1)
    end = date.fromisoformat(as_of) if isinstance(as_of, str) else as_of
    if end <= hire:
        end = hire + timedelta(days=365)

    pool = DEPT_ROUTINE_POOL.get(dept, GENERIC_POOL)
    if len(pool) < 6:
        pool = pool + GENERIC_POOL
    weights = [p[3] for p in pool]

    # กระจายวันทำงานให้ทั่วช่วงเวลา อย่างสม่ำเสมอ
    workdays = _working_days(hire, end)
    if not workdays:
        workdays = [hire + timedelta(days=i * 7) for i in range(4)]

    rows: List[Dict[str, Any]] = []
    n = max(0, int(budget))
    if n == 0:
        return rows

    # เลือกวัน (เรียงเวลา): กระจาย index ให้ครอบคลุมทั้งช่วง
    idxs = [int(i * (len(workdays) - 1) / max(1, n - 1)) for i in range(n)] if n > 1 else [0]
    day_seq = [workdays[min(i, len(workdays) - 1)] for i in idxs]

    # กำหนดเวลาทำงาน (เช้า 09:00-12:00 / บ่าย 13:30-17:30)
    for i, d in enumerate(day_seq):
        act = rng.choices(pool, weights=weights, k=1)[0]
        sheet, activity, loc, _ = act
        if loc == "site":
            loc = rng.choice(SITES)
        elif loc == "HQ":
            loc = "HQ"
        hour = rng.choice([9, 9, 10, 11, 13, 14, 15, 16, 17])
        minute = rng.randint(0, 59)
        dt = datetime(d.year, d.month, d.day, hour, minute)
        src = SHEET_SOURCE.get(sheet, "HRIS")

        common: Dict[str, Any] = {
            "logDateTime": _fmt_iso(dt),
            "logType": "routine",
            "subject": activity,
            "counterpartyEmployeeCode": "",
            "eventId": "",
            "location": loc,
            "source": src,
            "notes": f"บันทึกงานประจำ: {activity} ({src})",
        }
        # คู่คนแบบ low-key: กิจกรรมประชุม/ประสานงาน บางส่วน link ผ่าน relationship matrix
        pair_with = ""
        pair_rel = ""
        if any(h in activity for h in PAIR_ACTIVITY_HINTS) and rng.random() < ctx.config.get("routine_pair_ratio", 0.2):
            candidates = ctx.pairs_by_code.get(code, [])
            good = [p for p in candidates if p.get("relationship") in ("work_partner", "friendship", "mentorship", "family")]
            if good:
                pick = rng.choice(good)
                pair_with = pick["b"] if pick["a"] == code else pick["a"]
                pair_rel = pick.get("relationship", "work_partner")
                other = ctx.identity_by_code.get(pair_with, {})
                common["counterpartyEmployeeCode"] = pair_with
                common["subject"] = f"{activity} กับ {other.get('name', pair_with)}"
                common["notes"] = f"ประชุม/ประสานงานกับ {other.get('name', pair_with)} ({other.get('department','')})"
        if sheet == "Collaboration_Network" and not pair_with:
            # collab row ที่ไม่มีคู่ → เลือกคู่สุ่มจาก matrix (low-key)
            candidates = ctx.pairs_by_code.get(code, [])
            if candidates:
                pick = rng.choice(candidates)
                pair_with = pick["b"] if pick["a"] == code else pick["a"]
                pair_rel = pick.get("relationship", "work_partner")
                common["counterpartyEmployeeCode"] = pair_with
        row: Dict[str, Any] = {
            "sheet": sheet,
            "kind": "routine",
            "eventId": "",
            "logDateTime": common["logDateTime"],
            "orig": orig_values_for(sheet, emp, ctx, rng, dt, {
                "activity": activity, "other": pair_with, "relationship": pair_rel,
                "projectId": rng.choice(PROJECT_IDS),
            }),
            "common": common,
            "meta": {"employeeCode": code, "category": "routine", "riskLevel": "low",
                     "relationship": pair_rel, "faction": "",
                     "descriptionTH": common["notes"], "logType": "routine",
                     "mirrorRequired": False, "mirrorEmployeeCode": ""},
            "pairWith": pair_with,
            "pair": ({"other": pair_with, "relationship": pair_rel, "faction": ""}
                     if pair_with else None),
        }
        rows.append(row)

    rows.sort(key=lambda r: r["logDateTime"])
    return rows
