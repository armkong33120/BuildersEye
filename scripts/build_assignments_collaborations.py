#!/usr/bin/env python3
"""Generate Employee-Project Assignments and Collaboration Graph."""
import json
import random
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

random.seed(20260707)

APP_ROOT = Path(__file__).resolve().parents[1]
IDENTITY_FILE = APP_ROOT / "src" / "data" / "identity-graph.json"
ASSIGNMENTS_OUT = APP_ROOT / "src" / "data" / "project-assignments.json"
COLLAB_OUT = APP_ROOT / "src" / "data" / "collaboration-graph.json"

# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------
g = json.loads(IDENTITY_FILE.read_text(encoding="utf-8"))
idents = g["identities"]
employees_by_pk = {e["pk"]: e for e in idents}
dept_by_pk = {e["pk"]: e["department"] for e in idents}
depth_by_pk = {e["pk"]: e["hierarchyDepth"] for e in idents}
role_by_pk = {e["pk"]: e["roleGroup"] for e in idents}
title_by_pk = {e["pk"]: e["jobTitle"] for e in idents}

all_pks = sorted([e["pk"] for e in idents])
dept_all = defaultdict(list)
for e in idents:
    dept_all[e["department"]].append(e["pk"])

# Project catalog built inline (replicating LOOP 3 logic but simpler)
PROJECT_TYPES = {
    "P01": {"name": "Construction Site Project", "min_collab": 12, "max_collab": 25, "min_dur": 12, "max_dur": 36},
    "P02": {"name": "Renovation / Retrofit", "min_collab": 8, "max_collab": 15, "min_dur": 3, "max_dur": 12},
    "P03": {"name": "Architectural Design Competition", "min_collab": 5, "max_collab": 10, "min_dur": 1, "max_dur": 6},
    "P04": {"name": "Sales Pursuit / Tender", "min_collab": 4, "max_collab": 8, "min_dur": 1, "max_dur": 4},
    "P05": {"name": "Procurement RFP / Vendor Selection", "min_collab": 3, "max_collab": 7, "min_dur": 1, "max_dur": 3},
    "P06": {"name": "Internal IT System Rollout", "min_collab": 4, "max_collab": 12, "min_dur": 2, "max_dur": 8},
    "P07": {"name": "IT Security / Compliance Audit", "min_collab": 3, "max_collab": 6, "min_dur": 1, "max_dur": 4},
    "P08": {"name": "HR Policy / Training Program", "min_collab": 2, "max_collab": 8, "min_dur": 1, "max_dur": 6},
    "P09": {"name": "Financial Audit / Budget Planning", "min_collab": 3, "max_collab": 8, "min_dur": 1, "max_dur": 3},
    "P10": {"name": "Marketing Campaign", "min_collab": 3, "max_collab": 7, "min_dur": 1, "max_dur": 4},
    "P11": {"name": "Customer Warranty Resolution", "min_collab": 3, "max_collab": 10, "min_dur": 1, "max_dur": 6},
    "P12": {"name": "Legal / Regulatory Compliance", "min_collab": 2, "max_collab": 5, "min_dur": 1, "max_dur": 6},
    "P13": {"name": "Office Relocation / Expansion", "min_collab": 3, "max_collab": 8, "min_dur": 1, "max_dur": 3},
    "P14": {"name": "Executive Strategic Initiative", "min_collab": 5, "max_collab": 15, "min_dur": 3, "max_dur": 12},
    "P15": {"name": "Sustainability / Green Building", "min_collab": 5, "max_collab": 12, "min_dur": 6, "max_dur": 18},
}

TYPE_DEPT_MAP = {
    "P01": ["Engineering & Construction"], "P02": ["Engineering & Construction", "Design & Architecture"],
    "P03": ["Design & Architecture"], "P04": ["Sales"], "P05": ["Procurement & Warehouse"],
    "P06": ["IT"], "P07": ["IT"], "P08": ["HR & Admin"], "P09": ["Finance & Accounting"],
    "P10": ["Marketing"], "P11": ["Customer Service & Warranty"], "P12": ["Legal"],
    "P13": ["Office Support"], "P14": ["Executive"], "P15": ["Design & Architecture"],
}

TYPE_RELATED_DEPTS = {
    "P01": ["Engineering & Construction", "Procurement & Warehouse", "Design & Architecture", "Legal"],
    "P02": ["Engineering & Construction", "Design & Architecture", "Procurement & Warehouse"],
    "P03": ["Design & Architecture", "Sales", "Marketing", "Engineering & Construction"],
    "P04": ["Sales", "Design & Architecture", "Finance & Accounting", "Legal"],
    "P05": ["Procurement & Warehouse", "Finance & Accounting", "Legal", "Engineering & Construction"],
    "P06": ["IT", "All"],
    "P07": ["IT", "Legal", "Finance & Accounting", "HR & Admin"],
    "P08": ["HR & Admin", "All"],
    "P09": ["Finance & Accounting", "Executive", "All"],
    "P10": ["Marketing", "Sales", "Design & Architecture"],
    "P11": ["Customer Service & Warranty", "Engineering & Construction", "Legal", "Procurement & Warehouse"],
    "P12": ["Legal", "HR & Admin", "Finance & Accounting", "Executive"],
    "P13": ["Office Support", "IT", "Procurement & Warehouse", "HR & Admin"],
    "P14": ["Executive", "All"],
    "P15": ["Design & Architecture", "Engineering & Construction", "Marketing", "Executive"],
}

THAI_CITIES = ["กรุงเทพ", "ชลบุรี", "ระยอง", "เชียงใหม่", "ภูเก็ต", "นครราชสีมา", "ขอนแก่น", "สงขลา", "อยุธยา", "ปทุมธานี"]
PROJECT_NAMES = {
    "P01": ["Site Construction — {city} Mixed-Use Tower", "โครงการก่อสร้างคอนโดมิเนียม {city}", "Site Execution — {city} Residential Phase {phase}"],
    "P02": ["Retrofit — {city} Heritage Building", "รีโนเวทอาคารสำนักงานใหญ่ {city}", "ปรับปรุงระบบไฟฟ้าและ HVAC {city}"],
    "P03": ["Design Competition — {city} Cultural Center", "ประกวดแบบสถาปัตยกรรม {city}", "Competition — {city} Waterfront Development"],
    "P04": ["ยื่นประมูลโครงการ {city} Mega Project", "Tender — {city} Government Complex", "Sales Pursuit — {city} Airport Expansion"],
    "P05": ["คัดเลือกผู้รับเหมาช่วง {city}", "Vendor RFP — {city} Steel Supply", "Supplier Selection — {city} MEP Package"],
    "P06": ["Rollout ระบบ ERP ภายในองค์กร", "Deploy Microsoft 365 Governance Tools", "Implement Zero-Trust Network Architecture", "Deploy Endpoint Security Platform"],
    "P07": ["ISO 27001 Certification Audit", "Penetration Test & Vulnerability Assessment", "PDPA Compliance Gap Analysis"],
    "P08": ["ปรับโครงสร้างเงินเดือนประจำปี", "Rollout Performance Management System", "Diversity & Inclusion Awareness Program"],
    "P09": ["Annual Financial Statement Audit", "Quarterly Budget Review & Forecasting", "Internal Control Assessment"],
    "P10": ["เปิดตัวโครงการใหม่ {city}", "Brand Awareness Campaign — Digital", "Social Media & Content Marketing Strategy"],
    "P11": ["ตรวจสอบและแก้ไข Warranty Claim {city}", "Customer Complaint Resolution — {city} Tower", "Post-Handover Warranty Program {city}"],
    "P12": ["ตรวจสอบสัญญาก่อสร้าง {city}", "Labor Law Compliance Review", "Corporate Governance Policy Update"],
    "P13": ["ย้ายสำนักงาน {city} Branch", "Office Expansion — Floor Renovation", "ปรับปรุงพื้นที่ Co-Working และห้องประชุม"],
    "P14": ["Digital Transformation Roadmap", "ESG Strategy & Board-Level KPI", "New Business Unit Feasibility Study", "Corporate Restructuring Initiative"],
    "P15": ["LEED Gold Certification — {city} Project", "Sustainability Assessment — {city}", "Green Building Design — {city}"],
}

problems_pool = [
    "Schedule delayed by 2 months due to permit approval",
    "Budget overrun 12% from unexpected material cost increase",
    "Key vendor failed to deliver; replacement sourcing required",
    "Design revision needed after client scope change mid-project",
    "Team conflict between departments required executive mediation",
    "Quality inspection failed; rework needed on foundation phase",
    "Regulatory change mid-project required contract amendment",
    "IT system integration issue delayed go-live by 3 weeks",
    "Stakeholder misalignment caused 1-month decision delay",
    "Legal dispute with subcontractor over scope interpretation",
    "Staff turnover mid-project; knowledge transfer gap",
    "Customer dissatisfaction escalated to CEO level",
    "Security finding required architecture redesign",
]

# ---------------------------------------------------------------------------
# Build project catalog (68 projects, replicated from LOOP 3 logic)
# ---------------------------------------------------------------------------
print("Building project catalog...")
PLAN_START = datetime(2018, 1, 1)
PLAN_END = datetime(2026, 6, 1)
REF_DATE = datetime(2026, 6, 26)

projects = []
pid_counter = 0

for dept_name in sorted(dept_all.keys()):
    owned_types = [pt for pt, owners in TYPE_DEPT_MAP.items() if dept_name in owners]
    small_dept = len(dept_all[dept_name]) <= 4
    num_projects = max(3, min(7, len(dept_all[dept_name]) // 2 + 2)) if not small_dept else random.randint(2, 4)

    for _ in range(num_projects):
        pt = random.choice(owned_types) if owned_types else random.choice(list(PROJECT_TYPES.keys()))
        pt_info = PROJECT_TYPES[pt]
        pid_counter += 1
        pid = f"PRJ{pid_counter:03d}"

        city = random.choice(THAI_CITIES)
        name_template = random.choice(PROJECT_NAMES.get(pt, ["Project {city}"]))
        name = name_template.format(city=city, phase=random.randint(1, 3))

        duration = random.randint(pt_info["min_dur"], pt_info["max_dur"])
        start_offset = random.randint(0, max(0, (PLAN_END - PLAN_START).days - duration * 30))
        start_date = PLAN_START + timedelta(days=start_offset)
        end_date = min(start_date + timedelta(days=duration * 30), PLAN_END)

        if end_date < REF_DATE:
            status = "Completed"
        elif start_date > REF_DATE:
            status = "Not Started"
        else:
            status = "Active"

        related_raw = TYPE_RELATED_DEPTS.get(pt, [dept_name])
        related = [dept_name]
        for rd in related_raw:
            if rd == "All":
                others = [d for d in sorted(dept_all.keys()) if d != dept_name]
                related.extend(random.sample(others, min(3, len(others))))
            elif rd not in related:
                related.append(rd)

        collab_count = random.randint(pt_info["min_collab"], pt_info["max_collab"])
        has_problem = random.random() < 0.30
        problem_desc = random.choice(problems_pool) if has_problem else ""

        if status == "Completed":
            if has_problem:
                outcomes = ["Delivered with modifications after issue resolution", "Completed with documented lessons learned",
                          "Achieved revised scope; post-mortem filed", "Closed after recovery plan execution"]
            else:
                outcomes = ["Delivered on-time and within budget", "All objectives met; client sign-off received",
                          "Successful handover to operations", "Completed ahead of schedule"]
            outcome = random.choice(outcomes)
        else:
            outcome = "Ongoing — on track" if not has_problem else "Ongoing — recovery plan active"

        risks_pool_list = ["Supplier delay risk", "Scope creep from client change requests", "Regulatory approval timeline uncertainty",
                          "Skilled labor shortage", "Currency fluctuation", "Data privacy compliance", "Integration risk with legacy systems",
                          "Weather-related downtime", "Subcontractor performance risk", "Technology obsolescence",
                          "Stakeholder expectation misalignment", "Budget reallocation risk"]

        projects.append({
            "projectId": pid,
            "projectName": name,
            "projectType": pt,
            "projectTypeName": pt_info["name"],
            "owningDepartment": dept_name,
            "startDate": start_date.strftime("%Y-%m-%d"),
            "endDate": end_date.strftime("%Y-%m-%d"),
            "status": status,
            "hasDocumentedProblem": has_problem,
            "problemDescription": problem_desc,
            "outcomeSummary": outcome,
            "keyRisk": random.choice(risks_pool_list),
            "relatedDepartments": related,
            "expectedCollaboratorCount": collab_count,
        })

print(f"  Generated {len(projects)} projects")

# ---------------------------------------------------------------------------
# Employee Project Assignments
# ---------------------------------------------------------------------------
print("Assigning employees to projects...")

# Determine role based on hierarchy
def project_role(e, proj):
    depth = e["hierarchyDepth"]
    is_mgr = e.get("directReportCount", 0) > 0
    dept = e["department"]
    owner_dept = proj["owningDepartment"]

    if depth <= 1 and dept == "Executive":
        return random.choice(["Executive Sponsor", "Strategic Advisor"])
    if is_mgr and dept == owner_dept:
        return random.choice(["Project Lead", "Department Lead", "Steering Committee"])
    if depth <= 3 and dept in proj["relatedDepartments"]:
        return random.choice(["Team Lead", "Senior Reviewer", "Key Contributor"])
    if depth >= 4:
        return random.choice(["Contributor", "Junior Contributor", "Reviewer", "Support"])
    return random.choice(["Contributor", "Reviewer", "Specialist"])

# Contribution summaries
contribution_templates = {
    "Executive Sponsor": ["ให้คำแนะนำเชิงกลยุทธ์และอนุมัติงบประมาณ", "กำกับดูแลภาพรวมโครงการและบริหารความเสี่ยงระดับสูง", "เชื่อมโยงโครงการกับวิสัยทัศน์องค์กร"],
    "Strategic Advisor": ["ให้คำปรึกษาด้านกลยุทธ์และการตัดสินใจสำคัญ", "วิเคราะห์ผลกระทบทางธุรกิจ"],
    "Project Lead": ["นำทีมดำเนินงาน ควบคุม timeline และ budget", "บริหารทีมข้ามแผนก ประสานงาน stakeholders", "ตัดสินใจสำคัญในโครงการ แก้ไขปัญหาเฉพาะหน้า"],
    "Department Lead": ["ประสานทรัพยากรจากแผนก สนับสนุนทีมปฏิบัติการ", "ตรวจสอบ deliverables ให้เป็นไปตามมาตรฐานแผนก"],
    "Steering Committee": ["ตรวจสอบความคืบหน้าและอนุมัติ milestone สำคัญ", "ประเมินความเสี่ยงและให้คำแนะนำจากมุมมององค์กร"],
    "Team Lead": ["นำทีมย่อย ควบคุมคุณภาพงาน", "ประสานงานระหว่างทีมและรายงานความคืบหน้า", "แก้ไขปัญหาทางเทคนิคและบริหารทีมปฏิบัติการ"],
    "Senior Reviewer": ["ตรวจสอบคุณภาพงานด้านเทคนิค", "ให้ feedback และคำแนะนำการปรับปรุง"],
    "Key Contributor": ["ดำเนินงานในส่วนสำคัญของโครงการ", "ประสานงานกับผู้เกี่ยวข้องและส่งมอบตามกำหนด"],
    "Contributor": ["ดำเนินงานตามที่ได้รับมอบหมาย", "สนับสนุนทีมในงานปฏิบัติการ", "จัดทำเอกสารและรายงานความคืบหน้า"],
    "Junior Contributor": ["เรียนรู้และสนับสนุนทีมในงานปฏิบัติการ", "ช่วยจัดเตรียมเอกสารและข้อมูล"],
    "Reviewer": ["ตรวจสอบเอกสารและ deliverables", "ให้ความเห็นและข้อเสนอแนะ"],
    "Support": ["สนับสนุนด้าน logistics และประสานงาน", "ช่วยจัดการเอกสารและการสื่อสาร"],
    "Specialist": ["ให้ความรู้เฉพาะทางในสาขาที่เชี่ยวชาญ", "แก้ไขปัญหาทางเทคนิคที่ซับซ้อน"],
}

def get_contribution(role):
    return random.choice(contribution_templates.get(role, ["ดำเนินงานตามที่ได้รับมอบหมาย"]))

# Individual outcomes
personal_outcomes = [
    "พัฒนาทักษะการทำงานข้ามแผนกอย่างมีนัยสำคัญ",
    "ได้รับคำชมเชยจากผู้บริหารสำหรับผลงานที่โดดเด่น",
    "เรียนรู้การจัดการ stakeholder หลายระดับ",
    "สามารถส่งมอบงานก่อนกำหนดและเกินความคาดหมาย",
    "พัฒนาความเชี่ยวชาญด้านเทคนิคเพิ่มขึ้น",
    "เรียนรู้จากความผิดพลาดและปรับปรุงกระบวนการทำงาน",
    "สร้างความสัมพันธ์ที่ดีกับทีมและพันธมิตรทางธุรกิจ",
    "ถูกเสนอชื่อให้เป็นพนักงานดีเด่นประจำโครงการ",
    "ได้รับมอบหมายให้เป็น mentor สำหรับทีมงานใหม่",
    "พัฒนาทักษะการนำเสนอและการสื่อสาร",
    "เรียนรู้เครื่องมือและเทคโนโลยีใหม่ที่ใช้ในโครงการ",
    "ได้รับ trust จากผู้บริหารให้ดูแล project scope ที่ใหญ่ขึ้น",
]

# Recovery actions
recovery_actions = [
    "จัดประชุม root cause analysis และกำหนด corrective action plan",
    "ปรับกระบวนการทำงานและเพิ่ม checkpoint การตรวจสอบ",
    "ขอคำปรึกษาจาก senior management และปรับแผนโครงการ",
    "จัดการประชุม mediation ระหว่าง stakeholders",
    "เพิ่มความถี่ในการรายงานความคืบหน้าและ risk review",
    "จัด training เพิ่มเติมสำหรับทีมที่เกี่ยวข้อง",
    "ปรับ scope และ timeline หลังหารือกับ client",
    "เปลี่ยน supplier และปรับปรุง vendor management process",
    "ดำเนินการ RCA และ implement preventive measures",
    "ขออนุมัติ budget เพิ่มเติมและปรับแผนการเงิน",
    "ปรับโครงสร้างทีมและเพิ่ม resource จากแผนกอื่น",
]

mistake_issues = [
    "ส่งมอบงานล่าช้ากว่ากำหนด 2 สัปดาห์เนื่องจาก underestimation",
    "สื่อสาร requirement ไม่ชัดเจนทำให้เกิด rework",
    "ตัดสินใจผิดพลาดในการเลือก supplier",
    "ไม่ได้ escalate issue สำคัญให้ manager ทราบทันเวลา",
    "ละเลยการตรวจสอบ quality control จนพบ defect ภายหลัง",
    "ทำงานซ้ำซ้อนเนื่องจากขาดการประสานงานกับทีมอื่น",
    "ประเมิน budget ต่ำเกินไปทำให้ต้องขอเพิ่มภายหลัง",
    "ไม่ได้ document การเปลี่ยนแปลง scope ทำให้เกิด dispute",
    "ลืมอัปเดต stakeholder เกี่ยวกับความล่าช้าของโครงการ",
    "ใช้เครื่องมือหรือวิธีการที่ล้าสมัยทำให้ประสิทธิภาพต่ำ",
]

# Build assignments
assignments = []
employee_projects = defaultdict(list)  # pk -> [projectIds]
project_employees = defaultdict(list)  # projectId -> [pks]

for proj in projects:
    pid = proj["projectId"]
    owner_dept = proj["owningDepartment"]
    related = proj["relatedDepartments"]
    target_count = proj["expectedCollaboratorCount"]

    assigned = set()
    roles_assigned = {}

    # Assign executive sponsor (always)
    exec_pool = [e for e in idents if e["department"] == "Executive"]
    if exec_pool:
        sponsor = random.choice(exec_pool)
        assigned.add(sponsor["pk"])
        roles_assigned[sponsor["pk"]] = "Executive Sponsor" if sponsor["pk"] <= 3 else "Strategic Advisor"

    # Owner department: assign most employees
    owner_pool = list(dept_all[owner_dept])
    random.shuffle(owner_pool)
    if len(owner_pool) <= 12:
        take_from_owner = len(owner_pool)  # all
    else:
        take_from_owner = max(4, len(owner_pool) // 3 + 2)
    for pk in owner_pool[:take_from_owner]:
        if pk not in assigned:
            assigned.add(pk)
            roles_assigned[pk] = project_role(employees_by_pk[pk], proj)

    # Related departments: assign some
    for rd in related:
        if rd == owner_dept:
            continue
        rd_pool = list(dept_all.get(rd, []))
        random.shuffle(rd_pool)
        take = max(1, min(len(rd_pool), len(rd_pool) // 3 + 1))
        for pk in rd_pool[:take]:
            if pk not in assigned:
                assigned.add(pk)
                roles_assigned[pk] = project_role(employees_by_pk[pk], proj)

    # Ensure minimum collaborators
    while len(assigned) < min(target_count, max(4, len(assigned) + 1)):
        candidate_pools = [dept_all[owner_dept]]
        for rd in related:
            if rd in dept_all:
                candidate_pools.append(dept_all[rd])
        flat = [pk for pool in candidate_pools for pk in pool if pk not in assigned]
        if not flat:
            flat = [pk for pk in all_pks if pk not in assigned]
        if flat:
            new_pk = random.choice(flat)
            assigned.add(new_pk)
            roles_assigned[new_pk] = project_role(employees_by_pk[new_pk], proj)
        else:
            break

    # Cap at target
    assigned_list = list(assigned)[:target_count]

    # Create assignment records
    has_problem = proj["hasDocumentedProblem"]
    for pk in assigned_list:
        role = roles_assigned.get(pk, "Contributor")
        has_personal_issue = has_problem and random.random() < 0.25
        contrib = get_contribution(role)
        personal_outcome = random.choice(personal_outcomes)
        issue = ""
        recovery = ""
        if has_personal_issue:
            issue = random.choice(mistake_issues)
            recovery = random.choice(recovery_actions) if random.random() < 0.7 else ""

        assignments.append({
            "employeeId": pk,
            "projectId": pid,
            "role": role,
            "contributionSummary": contrib,
            "individualOutcome": personal_outcome,
            "hasMistake": has_personal_issue,
            "mistakeIssue": issue,
            "recoveryAction": recovery,
        })
        employee_projects[pk].append(pid)
        project_employees[pid].append(pk)

print(f"  Generated {len(assignments)} employee-project assignments")

# ---------------------------------------------------------------------------
# Fix: ensure every employee has 3-7 projects
# ---------------------------------------------------------------------------
print("Fixing project coverage gaps...")

for pk in range(1, 151):
    current = len(employee_projects[pk])
    if current < 3:
        # Add to random projects that need more people
        needed = 3 - current
        available_projects = [p for p in projects if pk not in project_employees[p["projectId"]]]
        random.shuffle(available_projects)
        for proj in available_projects[:needed]:
            role = project_role(employees_by_pk[pk], proj)
            assignments.append({
                "employeeId": pk,
                "projectId": proj["projectId"],
                "role": role,
                "contributionSummary": get_contribution(role),
                "individualOutcome": random.choice(personal_outcomes),
                "hasMistake": False,
                "mistakeIssue": "",
                "recoveryAction": "",
            })
            employee_projects[pk].append(proj["projectId"])
            project_employees[proj["projectId"]].append(pk)
    elif current > 7:
        # Trim excess (remove non-lead roles first)
        excess = current - 7
        emp_assignments = [a for a in assignments if a["employeeId"] == pk]
        # Sort: non-lead roles first to remove
        lead_roles = {"Project Lead", "Department Lead", "Executive Sponsor", "Strategic Advisor", "Team Lead", "Steering Committee"}
        emp_assignments.sort(key=lambda a: 0 if a["role"] in lead_roles else 1)
        for a in emp_assignments:
            if excess <= 0:
                break
            if a["role"] not in lead_roles:
                assignments.remove(a)
                employee_projects[pk].remove(a["projectId"])
                project_employees[a["projectId"]].remove(pk)
                excess -= 1

# Ensure every employee has at least 1 project with a mistake
print("Ensuring every employee has at least 1 mistake/issue...")
for pk in range(1, 151):
    emp_assignments = [a for a in assignments if a["employeeId"] == pk]
    has_mistake = any(a["hasMistake"] for a in emp_assignments)
    if not has_mistake and emp_assignments:
        chosen = random.choice(emp_assignments)
        chosen["hasMistake"] = True
        chosen["mistakeIssue"] = random.choice(mistake_issues)
        chosen["recoveryAction"] = random.choice(recovery_actions)

# ---------------------------------------------------------------------------
# Collaboration Graph
# ---------------------------------------------------------------------------
print("Building collaboration graph...")

# Relationship types from LOOP 2
REL_TYPES = {
    "C01": {"name": "Direct Report", "reciprocal": False},
    "C02": {"name": "Peer — Same Dept", "reciprocal": True},
    "C03": {"name": "Cross-Functional — Project Team", "reciprocal": True},
    "C04": {"name": "Cross-Functional — Approver/Reviewer", "reciprocal": False},
    "C05": {"name": "Mentor / Buddy", "reciprocal": True},
    "C07": {"name": "Executive Sponsor", "reciprocal": False},
    "C08": {"name": "Crisis / Incident Response", "reciprocal": True},
}

collaborations = []
collab_id_counter = 0
edge_set = set()  # (min_pk, max_pk, proj_id) for dedup

# Build collaborator pairs from project assignments
for proj in projects:
    pid = proj["projectId"]
    members = project_employees[pid]
    for i, pk_a in enumerate(members):
        for pk_b in members[i+1:]:
            pk_min, pk_max = sorted([pk_a, pk_b])
            edge_key = (pk_min, pk_max, pid)
            if edge_key in edge_set:
                continue
            edge_set.add(edge_key)

            same_dept = dept_by_pk[pk_a] == dept_by_pk[pk_b]
            depth_diff = abs(depth_by_pk[pk_a] - depth_by_pk[pk_b])

            # Determine relationship type
            if same_dept:
                if depth_diff >= 2:
                    rel = "C05"  # Mentor/Buddy
                else:
                    rel = "C02"  # Peer — Same Dept
            elif dept_by_pk[pk_a] == "Executive" or dept_by_pk[pk_b] == "Executive":
                rel = "C07"  # Executive Sponsor
            elif proj["hasDocumentedProblem"] and random.random() < 0.15:
                rel = "C08"  # Crisis/Incident
            else:
                rel = random.choice(["C03", "C03", "C04"])  # Mostly C03, some C04

            # Collaboration quality
            quality_weights = [0.15, 0.40, 0.30, 0.15]
            quality = random.choices(["Excellent", "Good", "Fair", "Difficult"], weights=quality_weights, k=1)[0]

            # Conflict flag (~10% of collaborations have conflict)
            has_conflict = random.random() < 0.10
            conflict_summary = ""
            resolution_summary = ""
            if has_conflict:
                conflicts = [
                    "ความเห็นไม่ตรงกันในการจัดลำดับความสำคัญของงาน",
                    "การสื่อสารที่คลาดเคลื่อนทำให้เกิดความล่าช้า",
                    "รูปแบบการทำงานที่แตกต่างกันทำให้เกิดความตึงเครียด",
                    "การจัดสรรทรัพยากรที่ไม่เท่าเทียมกันในโครงการ",
                    "ขาดความไว้วางใจในการส่งมอบงานระหว่างทีม",
                    "ความขัดแย้งเรื่อง scope ของ deliverables",
                    "วัฒนธรรมการทำงานที่แตกต่างระหว่างแผนก",
                ]
                resolutions = [
                    "จัดการประชุม mediation และกำหนด working agreement ร่วมกัน",
                    "ปรับกระบวนการสื่อสารและเพิ่ม weekly sync meeting",
                    "ผู้จัดการของทั้งสองฝ่ายร่วมกันแก้ไขและกำหนดแนวทาง",
                    "ตกลงร่วมกันในการแบ่ง scope และ escalation path",
                    "สร้าง trust ผ่าน small wins และ transparency",
                    "PM เข้ามาช่วย mediate และปรับ RACI matrix",
                    "จัด team building และ knowledge sharing session",
                ]
                conflict_summary = random.choice(conflicts)
                resolution_summary = random.choice(resolutions) if random.random() < 0.8 else "ยังอยู่ในระหว่างดำเนินการ"

            collab_id_counter += 1
            collab_id = f"COL{collab_id_counter:04d}"

            is_reciprocal = REL_TYPES[rel]["reciprocal"]

            collaborations.append({
                "collaborationId": collab_id,
                "employeeId": pk_a,
                "collaboratorEmployeeId": pk_b,
                "projectId": pid,
                "relationshipType": rel,
                "relationshipTypeName": REL_TYPES[rel]["name"],
                "collaborationQuality": quality,
                "hasConflict": has_conflict,
                "conflictSummary": conflict_summary,
                "resolutionSummary": resolution_summary,
            })

            # Add reciprocal if applicable
            if is_reciprocal:
                collab_id_counter += 1
                collaborations.append({
                    "collaborationId": f"COL{collab_id_counter:04d}",
                    "employeeId": pk_b,
                    "collaboratorEmployeeId": pk_a,
                    "projectId": pid,
                    "relationshipType": rel,
                    "relationshipTypeName": REL_TYPES[rel]["name"],
                    "collaborationQuality": quality,
                    "hasConflict": has_conflict,
                    "conflictSummary": conflict_summary,
                    "resolutionSummary": resolution_summary,
                })

print(f"  Generated {len(collaborations)} collaboration edges")

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
print("\n" + "=" * 80)
print("VALIDATION")
print("=" * 80)

# V1: Project count per employee
emp_proj_count = Counter(a["employeeId"] for a in assignments)
print(f"\nProject assignments per employee:")
counts = [emp_proj_count.get(pk, 0) for pk in range(1, 151)]
print(f"  Min: {min(counts)}, Max: {max(counts)}, Mean: {sum(counts)/150:.1f}")
below_3 = [pk for pk in range(1, 151) if emp_proj_count.get(pk, 0) < 3]
above_7 = [pk for pk in range(1, 151) if emp_proj_count.get(pk, 0) > 7]
print(f"  Below 3: {len(below_3)} — {below_3[:10]}")
print(f"  Above 7: {len(above_7)} — {above_7[:10]}")

# V2: Every employee has at least 1 mistake
no_mistake = []
for pk in range(1, 151):
    emp_a = [a for a in assignments if a["employeeId"] == pk]
    if not any(a["hasMistake"] for a in emp_a):
        no_mistake.append(pk)
print(f"\nEmployees with no mistake/issue: {len(no_mistake)}")
if no_mistake:
    print(f"  PKs: {no_mistake[:10]}")

# V3: Collaborator count per employee
collab_counts = Counter()
for c in collaborations:
    collab_counts[c["employeeId"]] += 1
collab_vals = [collab_counts.get(pk, 0) for pk in range(1, 151)]
print(f"\nCollaborators per employee:")
print(f"  Min: {min(collab_vals)}, Max: {max(collab_vals)}, Mean: {sum(collab_vals)/150:.1f}")
below_5 = [pk for pk in range(1, 151) if collab_counts.get(pk, 0) < 5]
above_12 = [pk for pk in range(1, 151) if collab_counts.get(pk, 0) > 12]
print(f"  Below 5: {len(below_5)}")
print(f"  Above 12: {len(above_12)}")

# V4: Cross-department collaboration check
only_same_dept = []
for pk in range(1, 151):
    emp_collabs = [c for c in collaborations if c["employeeId"] == pk]
    if emp_collabs:
        all_same = all(dept_by_pk[c["collaboratorEmployeeId"]] == dept_by_pk[pk] for c in emp_collabs)
        if all_same:
            only_same_dept.append(pk)
print(f"\nEmployees collaborating only within own dept: {len(only_same_dept)}")
if only_same_dept:
    print(f"  PKs: {only_same_dept[:10]}")

# V5: All project IDs valid
valid_pids = {p["projectId"] for p in projects}
invalid_pids = set(a["projectId"] for a in assignments) - valid_pids
invalid_collab_pids = set(c["projectId"] for c in collaborations) - valid_pids
print(f"\nInvalid project IDs in assignments: {len(invalid_pids)}")
print(f"Invalid project IDs in collaborations: {len(invalid_collab_pids)}")

# V6: All employee IDs valid
valid_pks = set(range(1, 151))
invalid_emp = set(a["employeeId"] for a in assignments) - valid_pks
invalid_collab_emp = set(c["employeeId"] for c in collaborations) - valid_pks
invalid_collab_target = set(c["collaboratorEmployeeId"] for c in collaborations) - valid_pks
print(f"Invalid employee IDs in assignments: {len(invalid_emp)}")
print(f"Invalid employee IDs in collaborations: {len(invalid_collab_emp)}")
print(f"Invalid collaborator IDs in collaborations: {len(invalid_collab_target)}")

# V7: Conflict stats
conflict_count = sum(1 for c in collaborations if c["hasConflict"])
print(f"\nCollaborations with conflicts: {conflict_count} / {len(collaborations)} ({conflict_count/len(collaborations)*100:.1f}%)")

# V8: Relationship type distribution
rel_dist = Counter(c["relationshipType"] for c in collaborations)
print(f"\nRelationship type distribution:")
for rt, cnt in sorted(rel_dist.items()):
    print(f"  {rt} ({REL_TYPES[rt]['name']}): {cnt}")

# V9: Quality distribution
qual_dist = Counter(c["collaborationQuality"] for c in collaborations)
print(f"\nCollaboration quality distribution:")
for q, cnt in sorted(qual_dist.items()):
    print(f"  {q}: {cnt}")

# ---------------------------------------------------------------------------
# Write outputs
# ---------------------------------------------------------------------------
ASSIGNMENTS_OUT.parent.mkdir(parents=True, exist_ok=True)
COLLAB_OUT.parent.mkdir(parents=True, exist_ok=True)

ASSIGNMENTS_OUT.write_text(json.dumps(assignments, ensure_ascii=False, indent=2), encoding="utf-8")
COLLAB_OUT.write_text(json.dumps(collaborations, ensure_ascii=False, indent=2), encoding="utf-8")

print(f"\nAssignments saved to: {ASSIGNMENTS_OUT}")
print(f"Collaborations saved to: {COLLAB_OUT}")

# Print sample records
print(f"\n{'='*80}")
print("SAMPLE ASSIGNMENTS (first 5)")
print(f"{'='*80}")
for a in assignments[:5]:
    emp = employees_by_pk[a["employeeId"]]
    print(f"  EMP{a['employeeId']:03d} ({emp['name']}) → {a['projectId']} as {a['role']}")
    print(f"    Contribution: {a['contributionSummary']}")
    print(f"    Outcome: {a['individualOutcome']}")
    if a["hasMistake"]:
        print(f"    ⚠ Issue: {a['mistakeIssue']}")
        print(f"    ✓ Recovery: {a['recoveryAction']}")

print(f"\n{'='*80}")
print("SAMPLE COLLABORATIONS (first 5)")
print(f"{'='*80}")
for c in collaborations[:5]:
    emp = employees_by_pk[c["employeeId"]]
    collab = employees_by_pk[c["collaboratorEmployeeId"]]
    print(f"  {c['collaborationId']}: EMP{c['employeeId']:03d} ↔ EMP{c['collaboratorEmployeeId']:03d}")
    print(f"    {emp['name']} [{emp['department']}] & {collab['name']} [{collab['department']}]")
    print(f"    Project: {c['projectId']} | Type: {c['relationshipTypeName']} | Quality: {c['collaborationQuality']}")
    if c["hasConflict"]:
        print(f"    ⚠ Conflict: {c['conflictSummary']}")
        print(f"    ✓ Resolution: {c['resolutionSummary']}")

print(f"\n{'='*80}")
print("LOOP 5 COMPLETE")
print(f"{'='*80}")