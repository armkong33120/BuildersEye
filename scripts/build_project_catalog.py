#!/usr/bin/env python3
"""Generate the global project catalog and verify assignment coverage."""
import json
import random
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)

APP_ROOT = Path(__file__).resolve().parents[1]
SOURCE = APP_ROOT / "src" / "data" / "identity-graph.json"

g = json.loads(SOURCE.read_text(encoding="utf-8"))
idents = g["identities"]
depts = g["departments"]

employees_by_pk = {e["pk"]: e for e in idents}
employees_by_dept = defaultdict(list)
for e in idents:
    employees_by_dept[e["department"]].append(e)

dept_names = sorted(employees_by_dept.keys())

# ---------------------------------------------------------------------------
# Project Types (from LOOP 2 taxonomy)
# ---------------------------------------------------------------------------
PROJECT_TYPES = {
    "P01": {"name": "Construction Site Project", "min_dur": 12, "max_dur": 36, "min_collab": 12, "max_collab": 25},
    "P02": {"name": "Renovation / Retrofit", "min_dur": 3, "max_dur": 12, "min_collab": 8, "max_collab": 15},
    "P03": {"name": "Architectural Design Competition", "min_dur": 1, "max_dur": 6, "min_collab": 5, "max_collab": 10},
    "P04": {"name": "Sales Pursuit / Tender", "min_dur": 1, "max_dur": 4, "min_collab": 4, "max_collab": 8},
    "P05": {"name": "Procurement RFP / Vendor Selection", "min_dur": 1, "max_dur": 3, "min_collab": 3, "max_collab": 7},
    "P06": {"name": "Internal IT System Rollout", "min_dur": 2, "max_dur": 8, "min_collab": 4, "max_collab": 12},
    "P07": {"name": "IT Security / Compliance Audit", "min_dur": 1, "max_dur": 4, "min_collab": 3, "max_collab": 6},
    "P08": {"name": "HR Policy / Training Program", "min_dur": 1, "max_dur": 6, "min_collab": 2, "max_collab": 8},
    "P09": {"name": "Financial Audit / Budget Planning", "min_dur": 1, "max_dur": 3, "min_collab": 3, "max_collab": 8},
    "P10": {"name": "Marketing Campaign", "min_dur": 1, "max_dur": 4, "min_collab": 3, "max_collab": 7},
    "P11": {"name": "Customer Warranty Resolution", "min_dur": 1, "max_dur": 6, "min_collab": 3, "max_collab": 10},
    "P12": {"name": "Legal / Regulatory Compliance", "min_dur": 1, "max_dur": 6, "min_collab": 2, "max_collab": 5},
    "P13": {"name": "Office Relocation / Expansion", "min_dur": 1, "max_dur": 3, "min_collab": 3, "max_collab": 8},
    "P14": {"name": "Executive Strategic Initiative", "min_dur": 3, "max_dur": 12, "min_collab": 5, "max_collab": 15},
    "P15": {"name": "Sustainability / Green Building", "min_dur": 6, "max_dur": 18, "min_collab": 5, "max_collab": 12},
}

# Ownership mapping: which departments own which project types
TYPE_DEPT_MAP = {
    "P01": ["Engineering & Construction"],
    "P02": ["Engineering & Construction", "Design & Architecture"],
    "P03": ["Design & Architecture"],
    "P04": ["Sales"],
    "P05": ["Procurement & Warehouse"],
    "P06": ["IT"],
    "P07": ["IT"],
    "P08": ["HR & Admin"],
    "P09": ["Finance & Accounting"],
    "P10": ["Marketing"],
    "P11": ["Customer Service & Warranty"],
    "P12": ["Legal"],
    "P13": ["Office Support"],
    "P14": ["Executive"],
    "P15": ["Design & Architecture"],
}

# Related departments for cross-functional collaboration
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

# ---------------------------------------------------------------------------
# Project Name Templates (Thai/English mix, construction-company themed)
# ---------------------------------------------------------------------------
PROJECT_NAMES = {
    "P01": [
        "โครงการก่อสร้างคอนโดมิเนียม {city}",
        "Site Construction — {city} Mixed-Use Tower",
        "โครงการก่อสร้างโรงงานอุตสาหกรรม {city}",
        "Site Execution — {city} Residential Phase {phase}",
        "โครงการก่อสร้างอาคารสำนักงาน {city}",
        "Site Development — {city} Commercial Complex",
        "โครงการก่อสร้างศูนย์การค้า {city}",
    ],
    "P02": [
        "รีโนเวทอาคารสำนักงานใหญ่ {city}",
        "Retrofit — {city} Heritage Building",
        "ปรับปรุงระบบไฟฟ้าและ HVAC {city}",
        "Renovation — {city} Hotel Tower",
        "รีโนเวทพื้นที่ค้าปลีก {city}",
    ],
    "P03": [
        "ประกวดแบบสถาปัตยกรรม {city}",
        "Design Competition — {city} Cultural Center",
        "แบบเสนอโครงการ {city} Landmark",
        "Competition — {city} Waterfront Development",
        "ประกวดแบบอาคารสูง {city}",
    ],
    "P04": [
        "ยื่นประมูลโครงการ {city} Mega Project",
        "Tender — {city} Government Complex",
        "เตรียมแบบประมูล {city} Hospital",
        "Sales Pursuit — {city} Airport Expansion",
        "ยื่นซองประกวดราคา {city} Convention Center",
    ],
    "P05": [
        "คัดเลือกผู้รับเหมาช่วง {city}",
        "Vendor RFP — {city} Steel Supply",
        "ประมูลจัดซื้อวัสดุก่อสร้าง {city}",
        "Supplier Selection — {city} MEP Package",
        "RFP — {city} Facade Contractor",
    ],
    "P06": [
        "Rollout ระบบ ERP ภายในองค์กร",
        "Deploy Microsoft 365 Governance Tools",
        "Implement Zero-Trust Network Architecture",
        "Rollout ระบบจัดการเอกสารดิจิทัล",
        "Upgrade Infrastructure to Cloud-Hybrid",
        "Deploy Endpoint Security Platform",
        "Implement BI Dashboard for Executive",
    ],
    "P07": [
        "ISO 27001 Certification Audit",
        "Penetration Test & Vulnerability Assessment",
        "PDPA Compliance Gap Analysis",
        "Annual IT General Controls Review",
        "Security Incident Response Drill",
    ],
    "P08": [
        "ปรับโครงสร้างเงินเดือนประจำปี",
        "Rollout Performance Management System",
        "ออกแบบ Training Roadmap สำหรับพนักงานใหม่",
        "Diversity & Inclusion Awareness Program",
        "ปรับปรุงสวัสดิการพนักงาน",
    ],
    "P09": [
        "Annual Financial Statement Audit",
        "Quarterly Budget Review & Forecasting",
        "Internal Control Assessment",
        "Tax Compliance Review",
        "Cost Optimization Initiative",
    ],
    "P10": [
        "เปิดตัวโครงการใหม่ {city}",
        "Brand Awareness Campaign — Digital",
        "จัดงานแสดงสินค้าและนิทรรศการ",
        "Social Media & Content Marketing Strategy",
        "Customer Loyalty Program Launch",
        "ESG & Sustainability PR Campaign",
    ],
    "P11": [
        "ตรวจสอบและแก้ไข Warranty Claim {city}",
        "Customer Complaint Resolution — {city} Tower",
        "Site Inspection & Defect Rectification {city}",
        "Post-Handover Warranty Program {city}",
    ],
    "P12": [
        "ตรวจสอบสัญญาก่อสร้าง {city}",
        "Labor Law Compliance Review",
        "Contract Risk Assessment for {city} Project",
        "Permit & License Filing",
        "Corporate Governance Policy Update",
    ],
    "P13": [
        "ย้ายสำนักงาน {city} Branch",
        "Office Expansion — Floor Renovation",
        "ปรับปรุงพื้นที่ Co-Working และห้องประชุม",
    ],
    "P14": [
        "Strategic Market Entry — {region}",
        "M&A Due Diligence — Target Acquisition",
        "Corporate Restructuring Initiative",
        "Digital Transformation Roadmap",
        "ESG Strategy & Board-Level KPI",
        "New Business Unit Feasibility Study",
    ],
    "P15": [
        "LEED Gold Certification — {city} Project",
        "Sustainability Assessment — {city}",
        "Green Building Design — {city}",
        "Energy Efficiency Audit — {city}",
        "TREES Certification for {city} Office",
    ],
}

THAI_CITIES = ["กรุงเทพ", "ชลบุรี", "ระยอง", "เชียงใหม่", "ภูเก็ต", "นครราชสีมา", "ขอนแก่น", "สงขลา", "อยุธยา", "ปทุมธานี"]
REGIONS = ["Eastern Economic Corridor", "Northern Thailand", "Southern Thailand", "Northeastern Thailand"]
PLAN_START = datetime(2018, 1, 1)
PLAN_END = datetime(2026, 6, 1)

# ---------------------------------------------------------------------------
# Generate individual employee info for assignment logic
# ---------------------------------------------------------------------------
def employee_display(e):
    return f"EMP{e['pk']:03d} ({e['name']}) [{e['department']}, LV{e['hierarchyDepth']}]"

def is_senior(e):
    return e["hierarchyDepth"] <= 2 or e.get("directReportCount", 0) > 0

def is_junior(e):
    return e["hierarchyDepth"] >= 4

executives = [e for e in idents if e["department"] == "Executive"]
dept_heads = [e for e in idents if "Head" in e.get("jobTitle", "") or "Director" in e.get("jobTitle", "")]
managers = [e for e in idents if e.get("directReportCount", 0) > 0]

print(f"Total employees: {len(idents)}")
print(f"Total managers (directReportCount>0): {len(managers)}")
print(f"Executives: {len(executives)}")
for e in executives:
    print(f"  {employee_display(e)}")

print(f"\nDept Heads / Directors:")
for e in dept_heads:
    if e not in executives:
        print(f"  {employee_display(e)}")

# Build pool per department
dept_senior = defaultdict(list)
dept_junior = defaultdict(list)
dept_all = defaultdict(list)
for e in idents:
    dept_all[e["department"]].append(e["pk"])
    if is_senior(e):
        dept_senior[e["department"]].append(e["pk"])
    if is_junior(e):
        dept_junior[e["department"]].append(e["pk"])

print(f"\nDept senior pool sizes:")
for d in dept_names:
    print(f"  {d}: senior={len(dept_senior[d])}, junior={len(dept_junior[d])}, total={len(dept_all[d])}")

# ---------------------------------------------------------------------------
# Build projects
# ---------------------------------------------------------------------------
projects = []
pid_counter = 0

for dept_name in dept_names:
    # Determine which project types this dept owns
    owned_types = [pt for pt, owners in TYPE_DEPT_MAP.items() if dept_name in owners]
    small_dept = len(dept_all[dept_name]) <= 4

    # Each dept gets 3-7 projects depending on size
    num_projects = max(3, min(7, len(dept_all[dept_name]) // 2 + 2)) if not small_dept else random.randint(2, 4)

    for _ in range(num_projects):
        pt = random.choice(owned_types) if owned_types else random.choice(list(PROJECT_TYPES.keys()))
        pt_info = PROJECT_TYPES[pt]

        pid_counter += 1
        pid = f"PRJ{pid_counter:03d}"

        # Name
        city = random.choice(THAI_CITIES)
        name_template = random.choice(PROJECT_NAMES.get(pt, ["Project {city}"]))
        name = name_template.format(city=city, phase=random.randint(1, 3), region=random.choice(REGIONS))

        # Duration
        duration = random.randint(pt_info["min_dur"], pt_info["max_dur"])
        start_offset = random.randint(0, max(0, (PLAN_END - PLAN_START).days - duration * 30))
        start_date = PLAN_START + timedelta(days=start_offset)
        end_date = min(start_date + timedelta(days=duration * 30), PLAN_END)
        end_date_actual = end_date

        # Status
        now = datetime(2026, 6, 26)
        if end_date_actual < now:
            status = "Completed"
        elif start_date > now:
            status = "Not Started"
        elif start_date <= now <= end_date_actual:
            status = "Active"
        else:
            status = "Completed"

        # Related departments
        related_raw = TYPE_RELATED_DEPTS.get(pt, [dept_name])
        related = [dept_name]  # owner always included
        for rd in related_raw:
            if rd == "All":
                # pick 2-3 random depts excluding owner
                others = [d for d in dept_names if d != dept_name]
                related.extend(random.sample(others, min(3, len(others))))
            elif rd not in related:
                related.append(rd)

        # Sponsor: executive or dept head
        sponsor_pool = [e["pk"] for e in executives + dept_heads if e["department"] in related + [dept_name, "Executive"]]
        if not sponsor_pool:
            sponsor_pool = [e["pk"] for e in executives]
        sponsor_pk = random.choice(sponsor_pool)

        # Lead: senior from owning dept
        lead_pool = [pk for pk in dept_senior.get(dept_name, dept_all[dept_name])]
        if not lead_pool:
            lead_pool = [e["pk"] for e in managers]
        lead_pk = random.choice(lead_pool)

        # Collaborator count
        collab_count = random.randint(pt_info["min_collab"], pt_info["max_collab"])

        # Problems (30% of projects have documented problems)
        has_problem = random.random() < 0.30
        problem_desc = ""
        if has_problem:
            problems = [
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
            problem_desc = random.choice(problems)

        # Outcome
        if status == "Completed":
            if has_problem:
                outcomes = [
                    "Delivered with modifications after issue resolution",
                    "Completed with documented lessons learned",
                    "Achieved revised scope; post-mortem filed",
                    "Closed after recovery plan execution",
                ]
            else:
                outcomes = [
                    "Delivered on-time and within budget",
                    "All objectives met; client sign-off received",
                    "Successful handover to operations",
                    "Completed ahead of schedule",
                ]
            outcome = random.choice(outcomes)
        else:
            outcome = "Ongoing — on track" if not has_problem else "Ongoing — recovery plan active"

        # Risks
        risks_pool = [
            "Supplier delay risk from single-source dependency",
            "Scope creep from client change requests",
            "Regulatory approval timeline uncertainty",
            "Skilled labor shortage in construction market",
            "Currency fluctuation impact on imported materials",
            "Data privacy compliance for customer data handling",
            "Integration risk with legacy systems",
            "Weather-related construction downtime",
            "Subcontractor performance risk",
            "Technology obsolescence before project completion",
            "Stakeholder expectation misalignment",
            "Budget reallocation risk from competing priorities",
        ]
        key_risk = random.choice(risks_pool)

        projects.append({
            "projectId": pid,
            "projectName": name,
            "projectType": pt,
            "projectTypeName": pt_info["name"],
            "owningDepartment": dept_name,
            "sponsorEmployeeId": sponsor_pk,
            "leadEmployeeId": lead_pk,
            "startDate": start_date.strftime("%Y-%m-%d"),
            "endDate": end_date_actual.strftime("%Y-%m-%d"),
            "status": status,
            "businessGoal": f"Deliver {pt_info['name'].lower()} for {dept_name}",
            "keyRisk": key_risk,
            "hasDocumentedProblem": has_problem,
            "problemDescription": problem_desc,
            "outcomeSummary": outcome,
            "relatedDepartments": related,
            "expectedCollaboratorCount": collab_count,
        })

# ---------------------------------------------------------------------------
# Verify constraints
# ---------------------------------------------------------------------------
print(f"\n{'='*80}")
print(f"PROJECT CATALOG SUMMARY")
print(f"{'='*80}")
print(f"Total projects: {len(projects)}")

# Count by department
dept_proj_count = Counter(p["owningDepartment"] for p in projects)
print(f"\nProjects by Owning Department:")
for d in dept_names:
    print(f"  {d:45s}: {dept_proj_count.get(d, 0)}")

# Count by status
status_count = Counter(p["status"] for p in projects)
print(f"\nProjects by Status:")
for s, c in sorted(status_count.items()):
    print(f"  {s}: {c}")

# Count by type
type_count = Counter(p["projectType"] for p in projects)
print(f"\nProjects by Type:")
for pt, c in sorted(type_count.items()):
    print(f"  {pt} ({PROJECT_TYPES[pt]['name']}): {c}")

# Assign employees to projects
# Simple assignment: each employee gets assigned to projects based on their department
employee_project_count = defaultdict(int)
employee_completed_count = defaultdict(int)
employee_problem_count = defaultdict(int)
project_assignments = defaultdict(list)  # project -> list of pks

for p in projects:
    pid = p["projectId"]
    owner_dept = p["owningDepartment"]
    related = p["relatedDepartments"]

    # Everyone in owning dept gets this project
    target_count = p["expectedCollaboratorCount"]
    assigned = set()

    # Owner department employees
    owner_pool = list(dept_all[owner_dept])
    random.shuffle(owner_pool)
    # assign all from small dept, or proportion from large dept
    if len(owner_pool) <= 8:
        assigned.update(owner_pool)
    else:
        assigned.update(owner_pool[:max(3, len(owner_pool)//3)])

    # Related departments: assign some
    for rd in related:
        if rd == owner_dept:
            continue
        rd_pool = list(dept_all.get(rd, []))
        random.shuffle(rd_pool)
        take = min(len(rd_pool), max(1, len(rd_pool)//4 + 1))
        assigned.update(rd_pool[:take])

    # Always include sponsor and lead
    assigned.add(p["sponsorEmployeeId"])
    assigned.add(p["leadEmployeeId"])

    # Cap at target
    assigned_list = list(assigned)[:max(target_count, len(assigned))]
    project_assignments[pid] = assigned_list

    # Count for each employee
    is_completed = p["status"] == "Completed"
    has_problem = p["hasDocumentedProblem"]
    for pk in assigned_list:
        employee_project_count[pk] += 1
        if is_completed:
            employee_completed_count[pk] += 1
        if has_problem:
            employee_problem_count[pk] += 1

# Check coverage
print(f"\n{'='*80}")
print(f"COVERAGE CHECK")
print(f"{'='*80}")

failed_min_total = [pk for pk in range(1, 151) if employee_project_count.get(pk, 0) < 3]
failed_min_completed = [pk for pk in range(1, 151) if employee_completed_count.get(pk, 0) < 2]
failed_min_problem = [pk for pk in range(1, 151) if employee_problem_count.get(pk, 0) < 1]

print(f"Employees with < 3 total projects: {len(failed_min_total)}")
for pk in failed_min_total:
    e = employees_by_pk[pk]
    print(f"  PK={pk} {employee_display(e)} — current: {employee_project_count.get(pk, 0)} projects")

print(f"\nEmployees with < 2 completed projects: {len(failed_min_completed)}")
for pk in failed_min_completed:
    e = employees_by_pk[pk]
    print(f"  PK={pk} {employee_display(e)} — completed: {employee_completed_count.get(pk, 0)}")

print(f"\nEmployees with < 1 problem project: {len(failed_min_problem)}")
for pk in failed_min_problem:
    e = employees_by_pk[pk]
    print(f"  PK={pk} {employee_display(e)} — problem projects: {employee_problem_count.get(pk, 0)}")

# Distribution stats
all_counts = [employee_project_count.get(pk, 0) for pk in range(1, 151)]
print(f"\nProject count distribution:")
print(f"  Min: {min(all_counts)}, Max: {max(all_counts)}, Mean: {sum(all_counts)/150:.1f}")
count_dist = Counter(all_counts)
for c in sorted(count_dist.keys()):
    print(f"  {c} projects: {count_dist[c]} employees")

print(f"\nCompleted project distribution:")
comp_counts = [employee_completed_count.get(pk, 0) for pk in range(1, 151)]
print(f"  Min: {min(comp_counts)}, Max: {max(comp_counts)}, Mean: {sum(comp_counts)/150:.1f}")

print(f"\nProblem project distribution:")
prob_counts = [employee_problem_count.get(pk, 0) for pk in range(1, 151)]
print(f"  Min: {min(prob_counts)}, Max: {max(prob_counts)}, Mean: {sum(prob_counts)/150:.1f}")

print(f"\n{'='*80}")
print(f"PRINT FULL PROJECT CATALOG")
print(f"{'='*80}")
for p in projects:
    sponsor = employees_by_pk[p["sponsorEmployeeId"]]
    lead = employees_by_pk[p["leadEmployeeId"]]
    print(f"\n--- {p['projectId']}: {p['projectName']} ---")
    print(f"  Type: {p['projectType']} — {p['projectTypeName']}")
    print(f"  Owner: {p['owningDepartment']}")
    print(f"  Sponsor: {employee_display(sponsor)}")
    print(f"  Lead: {employee_display(lead)}")
    print(f"  Dates: {p['startDate']} → {p['endDate']} | Status: {p['status']}")
    print(f"  Related Depts: {', '.join(p['relatedDepartments'])}")
    print(f"  Expected Collaborators: {p['expectedCollaboratorCount']}")
    print(f"  Risk: {p['keyRisk']}")
    print(f"  Has Problem: {p['hasDocumentedProblem']} — {p['problemDescription']}")
    print(f"  Outcome: {p['outcomeSummary']}")
    print(f"  Assigned: {len(project_assignments[p['projectId']])} employees")

print(f"\n{'='*80}")
print(f"END OF LOOP 3")
print(f"{'='*80}")