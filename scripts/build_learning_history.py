#!/usr/bin/env python3
"""Generate Learning / Development History for all 150 employees."""
import json
import random
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

random.seed(20260707)

APP_ROOT = Path(__file__).resolve().parents[1]
IDENTITY_FILE = APP_ROOT / "src" / "data" / "identity-graph.json"
CAREER_FILE = APP_ROOT / "src" / "data" / "career-story-plan.json"
WARNING_FILE = APP_ROOT / "src" / "data" / "warning-history.json"
ASSIGNMENTS_FILE = APP_ROOT / "src" / "data" / "project-assignments.json"
KPI_FILE = APP_ROOT / "src" / "data" / "kpi-okr-history.json"
OUTPUT = APP_ROOT / "src" / "data" / "learning-history.json"

# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------
g = json.loads(IDENTITY_FILE.read_text(encoding="utf-8"))
idents = g["identities"]
employees_by_pk = {e["pk"]: e for e in idents}
depth_by_pk = {e["pk"]: e["hierarchyDepth"] for e in idents}
dept_by_pk = {e["pk"]: e["department"] for e in idents}

career_stories = json.loads(CAREER_FILE.read_text(encoding="utf-8"))
career_by_pk = {s["employeeId"]: s for s in career_stories}

warnings = json.loads(WARNING_FILE.read_text(encoding="utf-8"))
warnings_by_pk = defaultdict(list)
for w in warnings:
    warnings_by_pk[w["employeeId"]].append(w)

assignments = json.loads(ASSIGNMENTS_FILE.read_text(encoding="utf-8"))
assignments_by_pk = defaultdict(list)
for a in assignments:
    assignments_by_pk[a["employeeId"]].append(a)

kpi_records = json.loads(KPI_FILE.read_text(encoding="utf-8"))
kpi_by_pk = defaultdict(list)
for r in kpi_records:
    kpi_by_pk[r["employeeId"]].append(r)

# ---------------------------------------------------------------------------
# Training catalog (from LOOP 2 T01-T14)
# ---------------------------------------------------------------------------
TRAINING_CATALOG = {
    "T01": {
        "name": "M365 & Security Fundamentals",
        "skillArea": "Digital Literacy",
        "mandatoryForDepts": "ALL",
        "mandatoryForRoles": "ALL",
        "category": "Compliance",
    },
    "T02": {
        "name": "Data Protection & Privacy (PDPA)",
        "skillArea": "Data Governance",
        "mandatoryForDepts": ["IT", "Legal", "HR & Admin", "Finance & Accounting"],
        "mandatoryForRoles": ["CEO", "COO", "CFO", "Head_of_Sales", "Head_of_Construction"],
        "category": "Compliance",
    },
    "T03": {
        "name": "Leadership & Management Essentials",
        "skillArea": "People Leadership",
        "mandatoryForDepts": "ALL",
        "mandatoryForRoles": ["CEO", "COO", "CFO", "Head_of_Sales", "Head_of_Construction", "Department_Manager"],
        "category": "Leadership",
    },
    "T04": {
        "name": "Project Management Professional",
        "skillArea": "Project Delivery",
        "mandatoryForDepts": ["Engineering & Construction", "Design & Architecture", "IT"],
        "mandatoryForRoles": [],
        "category": "Technical",
    },
    "T05": {
        "name": "Technical / Trade Skills Advanced",
        "skillArea": "Technical Depth",
        "mandatoryForDepts": ["Engineering & Construction", "Design & Architecture"],
        "mandatoryForRoles": [],
        "category": "Technical",
    },
    "T06": {
        "name": "Sales & Negotiation Skills",
        "skillArea": "Commercial Acumen",
        "mandatoryForDepts": ["Sales", "Marketing"],
        "mandatoryForRoles": [],
        "category": "Commercial",
    },
    "T07": {
        "name": "Finance & Accounting Compliance (TFRS)",
        "skillArea": "Financial Governance",
        "mandatoryForDepts": ["Finance & Accounting"],
        "mandatoryForRoles": ["CFO"],
        "category": "Compliance",
    },
    "T08": {
        "name": "Safety & Construction Regulations (OSHA/ISO 45001)",
        "skillArea": "Safety Management",
        "mandatoryForDepts": ["Engineering & Construction", "Procurement & Warehouse"],
        "mandatoryForRoles": [],
        "category": "Compliance",
    },
    "T09": {
        "name": "Customer Service Excellence",
        "skillArea": "Service Delivery",
        "mandatoryForDepts": ["Customer Service & Warranty", "Sales"],
        "mandatoryForRoles": [],
        "category": "Service",
    },
    "T10": {
        "name": "Legal & Contract Basics",
        "skillArea": "Legal Awareness",
        "mandatoryForDepts": ["Legal", "Sales", "Procurement & Warehouse"],
        "mandatoryForRoles": [],
        "category": "Compliance",
    },
    "T11": {
        "name": "HR Compliance & Workplace Ethics",
        "skillArea": "Workplace Ethics",
        "mandatoryForDepts": ["HR & Admin", "Executive"],
        "mandatoryForRoles": ["Department_Manager"],
        "category": "Compliance",
    },
    "T12": {
        "name": "Quality Management Systems (ISO 9001)",
        "skillArea": "Quality Assurance",
        "mandatoryForDepts": ["Engineering & Construction", "Design & Architecture", "Procurement & Warehouse"],
        "mandatoryForRoles": [],
        "category": "Technical",
    },
    "T13": {
        "name": "Sustainability / Green Building (LEED/TREES)",
        "skillArea": "Sustainability",
        "mandatoryForDepts": ["Design & Architecture", "Engineering & Construction"],
        "mandatoryForRoles": [],
        "category": "Technical",
    },
    "T14": {
        "name": "OneDrive / SharePoint Governance",
        "skillArea": "Digital Governance",
        "mandatoryForDepts": "ALL",
        "mandatoryForRoles": "ALL",
        "category": "Compliance",
    },
}

# ---------------------------------------------------------------------------
# Skill levels
# ---------------------------------------------------------------------------
SKILL_LEVELS = ["Beginner", "Developing", "Proficient", "Advanced", "Expert"]

def skill_improvement(before, training_category, completed):
    """Determine skill level after training."""
    if not completed:
        return before  # no improvement if not completed
    progression = SKILL_LEVELS
    idx = progression.index(before) if before in progression else 1
    # Most training raises by 1 level, leadership/expert by 0-1, compliance remains
    if training_category == "Compliance":
        gain = random.choices([0, 1], weights=[0.6, 0.4], k=1)[0]
    elif training_category == "Leadership":
        gain = random.choices([0, 1], weights=[0.3, 0.7], k=1)[0]
    else:
        gain = 1
    new_idx = min(len(progression) - 1, idx + gain)
    return progression[new_idx]

# ---------------------------------------------------------------------------
# Mistake-to-training mapping
# ---------------------------------------------------------------------------
MISTAKE_TO_TRAINING = {
    "Unauthorized Data Sharing": ["T02"],
    "Missed Regulatory Deadline": ["T02", "T07", "T08"],
    "Budget Overrun (Project)": ["T04", "T07"],
    "Design Error / Rework": ["T05", "T12"],
    "Vendor / Supplier Dispute": ["T10", "T04"],
    "Customer Complaint Escalation": ["T09"],
    "Security Incident (Minor)": ["T01", "T02"],
    "Hiring / HR Process Error": ["T11"],
    "Communication / Stakeholder Misalignment": ["T03", "T04"],
    "KPI / Performance Data Error": ["T01", "T04"],
    "OneDrive Quota Exceeded": ["T14"],
    "Wrong Sensitivity Label Applied": ["T02", "T14"],
    "Process Bypass (Shortcut)": ["T03", "T12"],
}

# Weak area to training mapping
WEAK_AREA_TO_TRAINING = {
    "Operational Detail": ["T04", "T12"],
    "Hands-on Execution": ["T05"],
    "Work-Life Balance Modeling": ["T03"],
    "Timely Decision Making": ["T03"],
    "Bottom-Up Communication": ["T03", "T11"],
    "Delegation": ["T03"],
    "Strategic Planning": ["T04", "T07"],
    "Data-Driven Decision Making": ["T01", "T04"],
    "Conflict Resolution": ["T03", "T11"],
    "Budget Forecasting": ["T07"],
    "Self-Direction": ["T03", "T12"],
    "Presentation Skills": ["T06"],
    "Process Improvement": ["T12"],
    "Stakeholder Communication": ["T04", "T06"],
    "Technical Depth": ["T05"],
}

# ---------------------------------------------------------------------------
# Notes templates
# ---------------------------------------------------------------------------
COMPLETED_NOTES = [
    "ผ่านการอบรมและประเมินผล — สามารถนำไปปรับใช้ในงานได้",
    "เข้าร่วมครบตามชั่วโมงที่กำหนด — ได้รับ certificate",
    "ผ่านการทดสอบ post-training ด้วยคะแนนดีเยี่ยม",
    "นำเสนอ case study จากประสบการณ์จริงในองค์กร",
    "ได้รับคำชมจาก instructor ว่ามีส่วนร่วมดีเยี่ยม",
    "สามารถ apply ความรู้กับ project ปัจจุบันได้ทันที",
]

INCOMPLETE_NOTES = [
    "ยังไม่ได้รับ certificate — ต้อง retake ในรอบถัดไป",
    "เข้าเรียนไม่ครบตามชั่วโมงที่กำหนด",
    "ติดภารกิจ project ทำให้เลื่อนการอบรม",
    "รอจัด session ถัดไปจาก HR",
    "อยู่ระหว่างดำเนินการ — คาดว่าจะเสร็จ Q ถัดไป",
    "สอบ post-training ไม่ผ่าน — ต้อง retraining",
]

MISTAKE_LINKED_NOTES = [
    "อบรมนี้เป็นส่วนหนึ่งของ corrective action plan หลัง incident",
    "กำหนดโดย manager หลังจากพบ gap ใน performance review",
    "เป็นเงื่อนไขใน PIP — ต้องผ่านภายใน 60 วัน",
    "อบรมตามคำแนะนำของ HR หลังจาก case review",
    "กำหนดใน development plan เพื่อป้องกัน incident ซ้ำ",
]

# ---------------------------------------------------------------------------
# Generate learning records
# ---------------------------------------------------------------------------
print("Generating learning/development history for 150 employees...")

learning_records = []
all_skill_before = []
all_skill_after = []

for e in sorted(idents, key=lambda x: x["pk"]):
    pk = e["pk"]
    depth = e["hierarchyDepth"]
    dept = e["department"]
    role = e["roleGroup"]
    is_manager = e.get("directReportCount", 0) > 0
    career = career_by_pk[pk]
    career_join = datetime.strptime(career["joinDate"], "%Y-%m-%d")
    career_tenure = career["tenureMonths"]
    emp_warnings = warnings_by_pk[pk]
    emp_assignments = assignments_by_pk[pk]
    emp_kpis = kpi_by_pk[pk]

    # Find weak areas and mistake themes
    weak_areas = set()
    for k in emp_kpis:
        weak_areas.add(k["weakArea"])
    mistake_themes = career.get("mistakeThemes", [])
    learning_theme = career.get("learningTheme", "")

    # Determine which trainings are mandatory for this employee
    mandatory_trainings = set()
    for tid, info in TRAINING_CATALOG.items():
        depts = info["mandatoryForDepts"]
        roles = info["mandatoryForRoles"]
        if depts == "ALL" or dept in depts:
            mandatory_trainings.add(tid)
        if roles == "ALL" or role in roles:
            mandatory_trainings.add(tid)

    # Special rules from LOOP 2:
    # T03 mandatory for managers
    if is_manager:
        mandatory_trainings.add("T03")
    # T02 mandatory for Privileged/Sensitive
    if e["accountRisk"] in ("Privileged", "Sensitive"):
        mandatory_trainings.add("T02")
    # T14 mandatory for ALL
    mandatory_trainings.add("T14")
    # T01 mandatory for ALL
    mandatory_trainings.add("T01")

    # Build pool: 2-5 training records
    num_records = random.randint(2, min(5, len(TRAINING_CATALOG)))
    # Leaders get more
    if depth <= 2:
        num_records = random.randint(3, 5)

    # 1. Start with mandatory trainings
    chosen_trainings = set()
    mandatory_list = list(mandatory_trainings)
    random.shuffle(mandatory_list)
    # Take up to num_records mandatory first
    for tid in mandatory_list[:num_records]:
        chosen_trainings.add(tid)

    # 2. Add mistake-linked training if not already chosen
    for theme in mistake_themes:
        linked = MISTAKE_TO_TRAINING.get(theme, [])
        for lt in linked:
            if lt not in chosen_trainings and len(chosen_trainings) < num_records:
                chosen_trainings.add(lt)

    # 3. Add weak-area-linked training
    for wa in weak_areas:
        linked = WEAK_AREA_TO_TRAINING.get(wa, [])
        for lt in linked:
            if lt not in chosen_trainings and len(chosen_trainings) < num_records:
                chosen_trainings.add(lt)

    # 4. Leaders get leadership/governance/coaching training
    if depth <= 2 and len(chosen_trainings) < num_records:
        leader_trainings = ["T03", "T04", "T11", "T12"]
        for lt in leader_trainings:
            if lt not in chosen_trainings and len(chosen_trainings) < num_records:
                chosen_trainings.add(lt)

    # 5. Fill remaining with random relevant trainings
    while len(chosen_trainings) < num_records:
        available = [t for t in TRAINING_CATALOG if t not in chosen_trainings]
        if not available:
            break
        # Prefer trainings relevant to dept
        dept_relevant = [t for t in available if TRAINING_CATALOG[t]["mandatoryForDepts"] != "ALL" and dept in TRAINING_CATALOG[t]["mandatoryForDepts"]]
        if not dept_relevant:
            dept_relevant = available
        chosen_trainings.add(random.choice(dept_relevant))

    # Trim to exactly num_records
    chosen_trainings = set(list(chosen_trainings)[:num_records])

    # Generate records for each training
    for tid in chosen_trainings:
        info = TRAINING_CATALOG[tid]
        is_mandatory = tid in mandatory_trainings

        # Completion status
        if is_mandatory:
            # Mandatory trainings are usually completed (85%)
            completed = random.random() < 0.85
        else:
            completed = random.random() < 0.70

        # For managers and sensitive depts, force compliance
        if (is_manager or depth <= 2 or e["accountRisk"] in ("Privileged", "Sensitive")) and is_mandatory:
            completed = random.random() < 0.95

        # IT and HR: always completed for mandatory
        if dept in ("IT", "HR & Admin") and is_mandatory:
            completed = True

        # Completion date: some point after join date
        if completed:
            days_after_join = random.randint(90, max(180, career_tenure * 30 - 60))
            comp_date = career_join + timedelta(days=days_after_join)
            if comp_date > datetime(2026, 6, 26):
                comp_date = datetime(2026, 6, 1) - timedelta(days=random.randint(1, 30))
            comp_date_str = comp_date.strftime("%Y-%m-%d")
        else:
            comp_date_str = ""

        # Skill level before/after
        skill_before = random.choice(SKILL_LEVELS[:3])  # Beginner to Proficient
        if depth <= 2:
            skill_before = random.choice(SKILL_LEVELS[2:4])  # Proficient to Advanced
        skill_after = skill_improvement(skill_before, info["category"], completed)

        # Related mistake or project
        related_mistake = ""
        related_project = ""
        if mistake_themes and random.random() < 0.5:
            related_mistake = random.choice(mistake_themes)
        elif emp_warnings and random.random() < 0.4:
            related_mistake = emp_warnings[0]["caseType"] if emp_warnings else ""
        if emp_assignments:
            # Find a project with a mistake if this training is mistake-linked
            mistake_assignments = [a for a in emp_assignments if a.get("hasMistake", False)]
            if mistake_assignments and tid in MISTAKE_TO_TRAINING.get(related_mistake, []):
                related_project = random.choice(mistake_assignments)["projectId"]
            elif random.random() < 0.3:
                related_project = random.choice(emp_assignments)["projectId"]

        # Notes
        if completed:
            if related_mistake or related_project:
                note_pool = COMPLETED_NOTES + MISTAKE_LINKED_NOTES
            else:
                note_pool = COMPLETED_NOTES
        else:
            note_pool = INCOMPLETE_NOTES
        notes = random.choice(note_pool)

        learning_records.append({
            "employeeId": pk,
            "trainingId": tid,
            "trainingName": info["name"],
            "required": is_mandatory,
            "completionStatus": "Completed" if completed else "Incomplete",
            "completionDate": comp_date_str,
            "skillArea": info["skillArea"],
            "skillLevelBefore": skill_before,
            "skillLevelAfter": skill_after,
            "relatedMistake": related_mistake,
            "relatedProjectId": related_project,
            "notes": notes,
        })
        all_skill_before.append(skill_before)
        all_skill_after.append(skill_after)

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
print("\n" + "=" * 80)
print("LEARNING / DEVELOPMENT HISTORY VALIDATION")
print("=" * 80)

# V1: Total records
print(f"\nTotal learning records: {len(learning_records)}")

# V2: Records per employee
records_per_emp = Counter(r["employeeId"] for r in learning_records)
counts = [records_per_emp.get(pk, 0) for pk in range(1, 151)]
below_2 = [pk for pk in range(1, 151) if records_per_emp.get(pk, 0) < 2]
above_5 = [pk for pk in range(1, 151) if records_per_emp.get(pk, 0) > 5]
print(f"Records per employee: Min={min(counts)}, Max={max(counts)}, Mean={sum(counts)/150:.1f}")
print(f"Below 2: {len(below_2)}")
print(f"Above 5: {len(above_5)}")

# V3: Completion rate
completed_count = sum(1 for r in learning_records if r["completionStatus"] == "Completed")
print(f"\nCompletion rate: {completed_count}/{len(learning_records)} ({completed_count/len(learning_records)*100:.1f}%)")

# V4: Training distribution
training_dist = Counter(r["trainingId"] for r in learning_records)
print(f"\nTraining Distribution:")
for tid in sorted(TRAINING_CATALOG.keys()):
    cnt = training_dist.get(tid, 0)
    bar = "█" * cnt
    print(f"  {tid} ({TRAINING_CATALOG[tid]['name'][:40]}): {cnt:>3d}  {bar}")

# V5: Required vs Optional
req_count = sum(1 for r in learning_records if r["required"])
opt_count = len(learning_records) - req_count
print(f"\nRequired: {req_count} | Optional: {opt_count}")

# V6: Skill improvement
improved = 0
same = 0
for r in learning_records:
    before_idx = SKILL_LEVELS.index(r["skillLevelBefore"]) if r["skillLevelBefore"] in SKILL_LEVELS else 1
    after_idx = SKILL_LEVELS.index(r["skillLevelAfter"]) if r["skillLevelAfter"] in SKILL_LEVELS else before_idx
    if after_idx > before_idx:
        improved += 1
    if after_idx == before_idx:
        same += 1
print(f"\nSkill improvement: {improved} improved, {same} unchanged, {len(learning_records)-improved-same} other")
print(f"  Before avg index: {sum(SKILL_LEVELS.index(s) if s in SKILL_LEVELS else 2 for s in all_skill_before)/len(all_skill_before):.1f}")
print(f"  After avg index: {sum(SKILL_LEVELS.index(s) if s in SKILL_LEVELS else 2 for s in all_skill_after)/len(all_skill_after):.1f}")

# V7: Mistake-linked training
mistake_linked = sum(1 for r in learning_records if r["relatedMistake"])
print(f"\nTraining linked to mistake: {mistake_linked} / {len(learning_records)} ({mistake_linked/len(learning_records)*100:.1f}%)")

# V8: Employees with mandatory training completion
mandatory_complete = defaultdict(list)
for r in learning_records:
    if r["required"]:
        mandatory_complete[r["employeeId"]].append(r["completionStatus"] == "Completed")
non_compliant = []
for pk in range(1, 151):
    if pk in mandatory_complete:
        all_comp = mandatory_complete[pk]
        if len(all_comp) > 0 and not all(all_comp):
            non_compliant.append(pk)
print(f"\nEmployees with incomplete mandatory training: {len(non_compliant)}")
if non_compliant[:10]:
    for pk in non_compliant[:5]:
        emp = employees_by_pk[pk]
        incomplete = [t for t in learning_records if t["employeeId"] == pk and t["required"] and t["completionStatus"] != "Completed"]
        print(f"  PK={pk} ({emp['code']} {emp['name']}): {len(incomplete)} incomplete mandatory")
    print(f"  ... and {len(non_compliant)-5} more")

# V9: Leaders have leadership training
leader_pks = [pk for pk in range(1, 151) if depth_by_pk[pk] <= 2 or employees_by_pk[pk].get("directReportCount", 0) > 0]
leaders_without_t03 = []
for pk in leader_pks:
    has_t03 = any(r["employeeId"] == pk and r["trainingId"] == "T03" for r in learning_records)
    if not has_t03:
        leaders_without_t03.append(pk)
print(f"\nLeaders without T03 (Leadership): {len(leaders_without_t03)} / {len(leader_pks)}")

# V10: Completion dates make sense
bad_dates = 0
for r in learning_records:
    if r["completionDate"]:
        career = career_by_pk[r["employeeId"]]
        join_dt = datetime.strptime(career["joinDate"], "%Y-%m-%d")
        comp_dt = datetime.strptime(r["completionDate"], "%Y-%m-%d")
        if comp_dt < join_dt:
            bad_dates += 1
        if comp_dt > datetime(2026, 7, 1):
            bad_dates += 1
print(f"\nRecords with impossible completion dates: {bad_dates}")

# V11: IT/HR mandatory compliance (from LOOP 2: forced true)
it_hr_pks = [e["pk"] for e in idents if e["department"] in ("IT", "HR & Admin")]
it_hr_incomplete = []
for pk in it_hr_pks:
    for r in learning_records:
        if r["employeeId"] == pk and r["required"] and r["completionStatus"] != "Completed":
            it_hr_incomplete.append(pk)
            break
print(f"IT/HR employees with incomplete mandatory training: {len(it_hr_incomplete)}")
if it_hr_incomplete:
    print(f"  PKs: {it_hr_incomplete}")

# V12: Skill area diversity
area_dist = Counter(r["skillArea"] for r in learning_records)
print(f"\nSkill Area Diversity: {len(area_dist)} unique areas")

# V13: Incomplete training affecting risk
incomplete_pks = set()
for r in learning_records:
    if r["completionStatus"] != "Completed":
        incomplete_pks.add(r["employeeId"])
print(f"Employees with any incomplete training: {len(incomplete_pks)} / 150")

# ---------------------------------------------------------------------------
# Write output
# ---------------------------------------------------------------------------
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(learning_records, ensure_ascii=False, indent=2), encoding="utf-8")

print(f"\nOutput written to: {OUTPUT}")

# Print samples
print(f"\n{'='*80}")
print("SAMPLE LEARNING RECORDS (PK=1, CEO)")
print(f"{'='*80}")
ceo_learning = sorted([r for r in learning_records if r["employeeId"] == 1], key=lambda x: x["trainingId"])
for r in ceo_learning:
    req = "REQ" if r["required"] else "OPT"
    status = "✓" if r["completionStatus"] == "Completed" else "○"
    date = r["completionDate"] or "—"
    print(f"  {r['trainingId']} [{req}] {status} {r['trainingName']}")
    print(f"    Skill: {r['skillLevelBefore']} → {r['skillLevelAfter']} ({r['skillArea']})")
    print(f"    Date: {date} | Mistake: {r['relatedMistake'] or '—'} | Project: {r['relatedProjectId'] or '—'}")
    print(f"    Notes: {r['notes'][:70]}...")

print(f"\n{'='*80}")
print("SAMPLE LEARNING RECORDS (PK=12, Junior Sales)")
print(f"{'='*80}")
jr_learning = sorted([r for r in learning_records if r["employeeId"] == 12], key=lambda x: x["trainingId"])
for r in jr_learning:
    req = "REQ" if r["required"] else "OPT"
    status = "✓" if r["completionStatus"] == "Completed" else "○"
    print(f"  {r['trainingId']} [{req}] {status} {r['trainingName']} | {r['skillLevelBefore']}→{r['skillLevelAfter']}")

print(f"\n{'='*80}")
print("LOOP 8 COMPLETE")
print(f"{'='*80}")