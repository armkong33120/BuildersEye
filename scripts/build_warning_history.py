#!/usr/bin/env python3
"""Generate Warning / Disciplinary History for all 150 employees."""
import json
import random
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

random.seed(20260707)

APP_ROOT = Path(__file__).resolve().parents[1]
IDENTITY_FILE = APP_ROOT / "src" / "data" / "identity-graph.json"
CAREER_FILE = APP_ROOT / "src" / "data" / "career-story-plan.json"
ASSIGNMENTS_FILE = APP_ROOT / "src" / "data" / "project-assignments.json"
KPI_FILE = APP_ROOT / "src" / "data" / "kpi-okr-history.json"
OUTPUT = APP_ROOT / "src" / "data" / "warning-history.json"

# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------
g = json.loads(IDENTITY_FILE.read_text(encoding="utf-8"))
idents = g["identities"]
employees_by_pk = {e["pk"]: e for e in idents}
depth_by_pk = {e["pk"]: e["hierarchyDepth"] for e in idents}
dept_by_pk = {e["pk"]: e["department"] for e in idents}
risk_by_pk = {e["pk"]: e["accountRisk"] for e in idents}
manager_by_pk = {e["pk"]: e.get("managerPk") for e in idents}

career_stories = json.loads(CAREER_FILE.read_text(encoding="utf-8"))
career_by_pk = {s["employeeId"]: s for s in career_stories}

assignments = json.loads(ASSIGNMENTS_FILE.read_text(encoding="utf-8"))
assignments_by_pk = defaultdict(list)
for a in assignments:
    assignments_by_pk[a["employeeId"]].append(a)

kpi_records = json.loads(KPI_FILE.read_text(encoding="utf-8"))
kpi_by_pk = defaultdict(list)
for r in kpi_records:
    kpi_by_pk[r["employeeId"]].append(r)

# ---------------------------------------------------------------------------
# Case type definitions (from LOOP 2 MISTAKE_THEMES + new organizational ones)
# ---------------------------------------------------------------------------
CASE_TYPES = {
    "Process Violation": {
        "severity_weights": [0.40, 0.45, 0.12, 0.03],
        "summaries": [
            "ละเลยขั้นตอนการอนุมัติตามนโยบายภายในองค์กร",
            "ดำเนินการโดยไม่ได้รับอนุญาตตามกระบวนการที่กำหนด",
            "ใช้สิทธิ์เข้าถึงเกินขอบเขตหน้าที่โดยไม่ได้รับอนุญาต",
            "ทำงานนอกกระบวนการ standard operating procedure",
            "เปลี่ยนแปลงข้อมูลในระบบโดยไม่ผ่านกระบวนการ change management",
        ],
        "root_causes": [
            "ความเร่งรีบในการส่งมอบงานให้ทันกำหนด",
            "ความเข้าใจที่ไม่ถูกต้องเกี่ยวกับกระบวนการ",
            "แรงกดดันจาก stakeholder ให้ข้ามขั้นตอน",
            "ขาดความรู้เกี่ยวกับ policy ที่เกี่ยวข้อง",
        ],
    },
    "Data Handling Error": {
        "severity_weights": [0.35, 0.40, 0.20, 0.05],
        "summaries": [
            "แชร์ไฟล์ที่มีข้อมูลสำคัญผ่านช่องทางที่ไม่ปลอดภัย",
            "ใช้ sensitivity label ผิดประเภทบนเอกสารสำคัญ",
            "ส่งข้อมูลลูกค้าให้ผู้รับผิดคนโดยไม่ได้ตั้งใจ",
            "ลบข้อมูลสำคัญโดยไม่มีการสำรองข้อมูล",
            "เก็บข้อมูลส่วนบุคคลเกินระยะเวลาที่กำหนด",
        ],
        "root_causes": [
            "ความไม่เข้าใจในนโยบาย data classification",
            "ความรีบเร่งในการทำงานจนละเลยขั้นตอนความปลอดภัย",
            "ระบบแจ้งเตือนที่ไม่ชัดเจน",
            "training ด้าน data protection ไม่เพียงพอ",
        ],
    },
    "Deadline / SLA Miss": {
        "severity_weights": [0.55, 0.35, 0.08, 0.02],
        "summaries": [
            "ส่งมอบงานล่าช้ากว่ากำหนดโดยไม่แจ้งล่วงหน้า",
            "ไม่สามารถทำตาม SLA ที่ตกลงไว้กับลูกค้าได้",
            "พลาด deadline สำคัญของโครงการโดยไม่มีการ escalate",
            "รายงานประจำเดือนส่งล่าช้าติดต่อกันหลายครั้ง",
        ],
        "root_causes": [
            "การประเมิน workload ต่ำเกินไป",
            "ขาดการวางแผนและจัดลำดับความสำคัญ",
            "ปัญหาการสื่อสารภายในทีม",
            "ขาดเครื่องมือติดตามงานที่มีประสิทธิภาพ",
        ],
    },
    "Quality / Accuracy Issue": {
        "severity_weights": [0.50, 0.35, 0.12, 0.03],
        "summaries": [
            "ส่งมอบงานที่มีข้อผิดพลาดโดยไม่ได้ตรวจสอบก่อน",
            "รายงานทางการเงินมีตัวเลขคลาดเคลื่อนอย่างมีนัยสำคัญ",
            "แบบก่อสร้างมีข้อผิดพลาดที่ต้อง rework",
            "ข้อมูลในระบบ CRM ไม่ถูกต้องทำให้เกิดความเสียหาย",
        ],
        "root_causes": [
            "ขาดกระบวนการตรวจสอบคุณภาพที่เหมาะสม",
            "ความเหนื่อยล้าจาก workload สูง",
            "ขาดการ training ด้านเทคนิคที่เพียงพอ",
            "ไม่มี peer review ก่อนส่งมอบงาน",
        ],
    },
    "Communication Breakdown": {
        "severity_weights": [0.55, 0.38, 0.06, 0.01],
        "summaries": [
            "ไม่ได้แจ้ง stakeholder เกี่ยวกับความล่าช้าของโครงการ",
            "สื่อสาร requirement ไม่ชัดเจนทำให้ทีมทำงานผิดทิศทาง",
            "ไม่ได้ escalate issue สำคัญให้ management ทราบ",
            "ละเลยการตอบ email หรือคำขอจากแผนกอื่นเป็นเวลานาน",
        ],
        "root_causes": [
            "วัฒนธรรมการสื่อสารที่ไม่ proactive",
            "ความกลัวในการรายงานข่าวร้ายให้ผู้บริหาร",
            "ภาระงานที่มากเกินไป",
            "ขาดความเข้าใจในความสำคัญของ stakeholder management",
        ],
    },
    "Security / Access Incident": {
        "severity_weights": [0.10, 0.30, 0.40, 0.20],
        "summaries": [
            "คลิกลิงก์ phishing email ทำให้ account ถูก compromise",
            "ใช้ password ที่ไม่ปลอดภัยหรือแชร์ password กับผู้อื่น",
            "เชื่อมต่ออุปกรณ์ส่วนตัวเข้ากับ network โดยไม่ได้รับอนุญาต",
            "ติดตั้ง software ที่ไม่ได้รับอนุญาตบนเครื่องบริษัท",
            "พบความพยายามเข้าถึงข้อมูลที่ไม่มีสิทธิ์",
        ],
        "root_causes": [
            "ขาดความตระหนักด้าน cybersecurity",
            "ความต้องการความสะดวกในการทำงาน",
            "ยังไม่ผ่าน training ด้าน security awareness",
            "อุปกรณ์ส่วนตัวที่ไม่มีมาตรการป้องกัน",
        ],
    },
    "Budget / Resource Mismanagement": {
        "severity_weights": [0.20, 0.40, 0.30, 0.10],
        "summaries": [
            "ใช้จ่ายเกินงบประมาณโครงการโดยไม่ได้รับอนุมัติ",
            "สั่งซื้อวัสดุโดยไม่เปรียบเทียบราคาตามกระบวนการ",
            "ใช้ทรัพยากรของบริษัทเพื่อประโยชน์ส่วนตัว",
            "บริหารจัดการ overtime ไม่เหมาะสมทำให้ต้นทุนเกิน",
        ],
        "root_causes": [
            "การวางแผนงบประมาณที่ไม่เพียงพอ",
            "ขาดความรู้ด้าน procurement policy",
            "ความเคยชินกับกระบวนการแบบเก่า",
            "แรงกดดันให้โครงการเสร็จทันเวลา",
        ],
    },
}

# ---------------------------------------------------------------------------
# Severity levels
# ---------------------------------------------------------------------------
SEVERITY_LEVELS = ["Low", "Medium", "High", "Critical"]
SEVERITY_TARGET = [0.60, 0.30, 0.08, 0.02]

# ---------------------------------------------------------------------------
# HR Confidentiality by department (from LOOP 2)
# ---------------------------------------------------------------------------
CONFIDENTIALITY_MAP = {
    "Executive": "Tier 1 — Strict",
    "HR & Admin": "Tier 1 — Strict",
    "Finance & Accounting": "Tier 1 — Strict",
    "Legal": "Tier 1 — Strict",
    "IT": "Tier 2 — Sensitive",
    "Engineering & Construction": "Tier 3 — Standard",
    "Design & Architecture": "Tier 3 — Standard",
    "Procurement & Warehouse": "Tier 3 — Standard",
    "Marketing": "Tier 3 — Standard",
    "Sales": "Tier 3 — Standard",
    "Customer Service & Warranty": "Tier 3 — Standard",
    "Office Support": "Tier 3 — Standard",
}

# Redaction required for different tiers
def requires_redaction(severity, confidentiality_tier, is_formal_warning):
    if confidentiality_tier == "Tier 1 — Strict":
        return severity in ("High", "Critical") or is_formal_warning
    if confidentiality_tier == "Tier 2 — Sensitive":
        return severity == "Critical"
    return False

# ---------------------------------------------------------------------------
# Action taken by severity
# ---------------------------------------------------------------------------
ACTIONS = {
    "Low": [
        "Verbal coaching และให้คำแนะนำโดย manager",
        "ส่ง email แจ้งเตือนและให้แนวทางแก้ไข",
        "พูดคุยแบบไม่เป็นทางการและบันทึกใน system",
        "แนะนำให้ทบทวน policy ที่เกี่ยวข้อง",
    ],
    "Medium": [
        "Written warning และบันทึกใน personnel file",
        "กำหนด corrective action plan และติดตามผล",
        "เข้าพบ manager เพื่อหารือและวางแผนปรับปรุง",
        "ส่งเข้า training program ที่เกี่ยวข้อง",
        "กำหนด probationary monitoring period 30 วัน",
    ],
    "High": [
        "Formal written warning พร้อมลงบันทึก HR",
        "พักงานชั่วคราวระหว่างการสอบสวน",
        "ปรับลด bonus หรือสิทธิประโยชน์",
        "กำหนด performance improvement plan (PIP) 60 วัน",
        "รายงานต่อผู้บริหารระดับสูงและ legal department",
    ],
    "Critical": [
        "สอบสวนอย่างเป็นทางการโดย HR และ Legal",
        "พักงานระหว่างดำเนินการทางวินัย",
        "รายงานต่อ board และ regulatory body",
        "ดำเนินการทางวินัยสูงสุดตามนโยบายบริษัท",
        "กำหนด sanction ตามกฎหมายแรงงาน",
    ],
}

# ---------------------------------------------------------------------------
# Resolution status
# ---------------------------------------------------------------------------
RESOLUTION_STATUSES = ["Resolved", "Resolved with Monitoring", "Under Investigation", "Closed — No Further Action"]
RESOLUTION_WEIGHTS = [0.50, 0.30, 0.10, 0.10]

# ---------------------------------------------------------------------------
# Training link IDs
# ---------------------------------------------------------------------------
TRAINING_IDS = [f"T{idx:02d}" for idx in range(1, 15)]  # T01 through T14 (from LOOP 2)

# ---------------------------------------------------------------------------
# Generate cases
# ---------------------------------------------------------------------------
print("Generating warning/disciplinary history for 150 employees...")

warning_records = []
all_severities = []
case_id_counter = 0

for e in sorted(idents, key=lambda x: x["pk"]):
    pk = e["pk"]
    depth = e["hierarchyDepth"]
    dept = e["department"]
    career = career_by_pk[pk]
    emp_assignments = assignments_by_pk[pk]
    emp_kpis = kpi_by_pk[pk]

    confidentiality = CONFIDENTIALITY_MAP.get(dept, "Tier 3 — Standard")
    is_sensitive_dept = confidentiality in ("Tier 1 — Strict", "Tier 2 — Sensitive")

    # Number of cases: 1-4, weighted toward 1-2
    num_cases = random.choices([1, 2, 3, 4], weights=[0.40, 0.35, 0.15, 0.10], k=1)[0]

    # For executives and sensitive depts, bias toward more documentation
    if depth <= 1:
        num_cases = random.choices([1, 2, 3, 4], weights=[0.15, 0.35, 0.30, 0.20], k=1)[0]

    # Get career mistake themes to bias case types
    mistake_themes = career.get("mistakeThemes", [])
    career_join = datetime.strptime(career["joinDate"], "%Y-%m-%d")
    career_tenure = career["tenureMonths"]

    # Find manager
    manager_pk = manager_by_pk.get(pk)
    manager_code = ""
    if manager_pk and manager_pk in employees_by_pk:
        manager_code = employees_by_pk[manager_pk]["code"]

    # Get project IDs with mistakes
    mistake_projects = [a["projectId"] for a in emp_assignments if a.get("hasMistake", False)]
    all_projects = [a["projectId"] for a in emp_assignments]

    # Get dip periods from KPI
    dip_periods = [r["reviewPeriod"] for r in emp_kpis if r["performanceBand"] in ("Below (D)", "Unsatisfactory (E)")]

    generated_cases = []
    for _ in range(num_cases):
        # Choose case type, biased by career mistake themes
        if mistake_themes and random.random() < 0.6:
            # Map mistake theme to case type
            theme_to_case = {
                "Unauthorized Data Sharing": random.choice(["Data Handling Error", "Security / Access Incident"]),
                "Missed Regulatory Deadline": "Deadline / SLA Miss",
                "Budget Overrun (Project)": "Budget / Resource Mismanagement",
                "Design Error / Rework": "Quality / Accuracy Issue",
                "Vendor / Supplier Dispute": "Budget / Resource Mismanagement",
                "Customer Complaint Escalation": "Communication Breakdown",
                "Security Incident (Minor)": "Security / Access Incident",
                "Hiring / HR Process Error": "Process Violation",
                "Communication / Stakeholder Misalignment": "Communication Breakdown",
                "KPI / Performance Data Error": "Quality / Accuracy Issue",
                "OneDrive Quota Exceeded": "Data Handling Error",
                "Wrong Sensitivity Label Applied": "Data Handling Error",
                "Process Bypass (Shortcut)": "Process Violation",
            }
            matching = [theme_to_case.get(t, "Process Violation") for t in mistake_themes if t in theme_to_case]
            if matching:
                case_type = random.choice(matching)
            else:
                case_type = random.choice(list(CASE_TYPES.keys()))
        else:
            case_type = random.choice(list(CASE_TYPES.keys()))

        ct_info = CASE_TYPES[case_type]

        # Severity (target distribution applied globally via post-processing)
        sev = random.choices(SEVERITY_LEVELS, weights=ct_info["severity_weights"], k=1)[0]

        # Critical cases only for Sensitive/Privileged departments and depth ≤ 2 (rare)
        if sev == "Critical" and not (is_sensitive_dept or depth <= 2):
            sev = "High"
        if sev == "Critical" and random.random() < 0.5:
            sev = "High"  # further reduce critical

        # Formal warning flag
        is_formal = sev in ("High", "Critical") or (sev == "Medium" and random.random() < 0.35)

        # Summary
        summary = random.choice(ct_info["summaries"])

        # Root cause
        root_cause = random.choice(ct_info["root_causes"])

        # Action taken
        action = random.choice(ACTIONS[sev])

        # Resolution
        resolution = random.choices(RESOLUTION_STATUSES, weights=RESOLUTION_WEIGHTS, k=1)[0]
        if sev in ("High", "Critical"):
            resolution = random.choice(["Resolved with Monitoring", "Under Investigation"])

        # Redaction
        redact = requires_redaction(sev, confidentiality, is_formal)

        # Linked project
        linked_project = ""
        if mistake_projects and random.random() < 0.7:
            linked_project = random.choice(mistake_projects)
        elif all_projects and random.random() < 0.4:
            linked_project = random.choice(all_projects)

        # Linked training
        linked_training = ""
        if sev in ("Low", "Medium") and random.random() < 0.5:
            linked_training = random.choice(TRAINING_IDS)

        # Case date — spread across career
        if career_tenure >= 12:
            days_range = max(90, career_tenure * 30)
            case_date = career_join + timedelta(days=random.randint(30, days_range))
        else:
            case_date = career_join + timedelta(days=random.randint(15, career_tenure * 30 - 5))
        if case_date > datetime(2026, 6, 26):
            case_date = datetime(2026, 6, 26) - timedelta(days=random.randint(1, 60))

        case_id_counter += 1
        case_id = f"CASE{case_id_counter:04d}"

        generated_cases.append({
            "caseId": case_id,
            "employeeId": pk,
            "caseDate": case_date.strftime("%Y-%m-%d"),
            "caseType": case_type,
            "severity": sev,
            "formalWarning": is_formal,
            "summary": summary,
            "rootCause": root_cause,
            "actionTaken": action,
            "resolutionStatus": resolution,
            "managerInvolved": manager_code,
            "hrConfidentialityLevel": confidentiality,
            "redactionRequired": redact,
            "linkedProjectId": linked_project,
            "linkedTrainingId": linked_training,
        })
        all_severities.append(sev)

    warning_records.extend(generated_cases)

# ---------------------------------------------------------------------------
# Post-process: enforce severity target distribution globally
# ---------------------------------------------------------------------------
print("Applying severity distribution targets...")
total = len(warning_records)
targets = {
    "Low": int(total * 0.60),
    "Medium": int(total * 0.30),
    "High": int(total * 0.08),
    "Critical": int(total * 0.02),
}

# Count current
current_counts = Counter(all_severities)
print(f"  Before adjustment: {dict(current_counts)}")

# Adjust
for sev, target in targets.items():
    diff = target - current_counts.get(sev, 0)
    if diff > 0:
        # Need more of this severity — upgrade from lower severity
        upgradeable = [r for r in warning_records if r["severity"] in ("Low", "Medium") and r["severity"] != sev and r["severity"] < sev]
        random.shuffle(upgradeable)
        for r in upgradeable[:diff]:
            old_sev = r["severity"]
            r["severity"] = sev
            # Also update action and formal warning flag
            r["actionTaken"] = random.choice(ACTIONS[sev])
            r["formalWarning"] = sev in ("High", "Critical") or (sev == "Medium" and random.random() < 0.35)
            if sev in ("High", "Critical"):
                r["resolutionStatus"] = random.choice(["Resolved with Monitoring", "Under Investigation"])
            all_severities.append(sev)
            all_severities.remove(old_sev)
    elif diff < 0:
        # Too many — downgrade some
        downgradeable = [r for r in warning_records if r["severity"] == sev]
        random.shuffle(downgradeable)
        for r in downgradeable[:abs(diff)]:
            old_sev = r["severity"]
            new_sev = "Medium" if sev in ("High", "Critical") else "Low"
            r["severity"] = new_sev
            r["actionTaken"] = random.choice(ACTIONS[new_sev])
            r["formalWarning"] = new_sev in ("High", "Critical") or (new_sev == "Medium" and random.random() < 0.15)
            if new_sev == "Low":
                r["resolutionStatus"] = random.choice(["Resolved", "Closed — No Further Action"])
            all_severities.append(new_sev)
            all_severities.remove(old_sev)

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
print("\n" + "=" * 80)
print("WARNING / DISCIPLINARY HISTORY VALIDATION")
print("=" * 80)

# V1: Total records
print(f"\nTotal warning records: {len(warning_records)}")

# V2: Records per employee
records_per_emp = Counter(r["employeeId"] for r in warning_records)
counts = [records_per_emp.get(pk, 0) for pk in range(1, 151)]
no_record = [pk for pk in range(1, 151) if records_per_emp.get(pk, 0) == 0]
print(f"Records per employee: Min={min(counts)}, Max={max(counts)}, Mean={sum(counts)/150:.1f}")
print(f"Employees with ZERO records: {len(no_record)}")
if no_record:
    print(f"  PKs: {no_record}")

# V3: Severity distribution
final_counts = Counter(r["severity"] for r in warning_records)
print(f"\nSeverity Distribution (target):")
for sev in SEVERITY_LEVELS:
    cnt = final_counts.get(sev, 0)
    pct = cnt / len(warning_records) * 100
    target_pct = SEVERITY_TARGET[SEVERITY_LEVELS.index(sev)] * 100
    status = "✓" if abs(pct - target_pct) < 5 else "⚠"
    bar = "█" * int(pct / 2)
    print(f"  {sev:10s}: {cnt:>4d} ({pct:5.1f}%) target={target_pct:.0f}%  {bar}  {status}")

# V4: Formal warnings
formal_count = sum(1 for r in warning_records if r["formalWarning"])
print(f"\nFormal warnings: {formal_count} / {len(warning_records)} ({formal_count/len(warning_records)*100:.1f}%)")

# V5: Case type distribution
case_type_dist = Counter(r["caseType"] for r in warning_records)
print(f"\nCase Type Distribution:")
for ct, cnt in case_type_dist.most_common():
    print(f"  {ct}: {cnt}")

# V6: All manager codes valid
invalid_managers = 0
for r in warning_records:
    if r["managerInvolved"]:
        # Check if this manager code exists
        found = any(e["code"] == r["managerInvolved"] for e in idents)
        if not found:
            invalid_managers += 1
print(f"\nRecords with invalid manager code: {invalid_managers}")

# V7: All employee IDs valid
invalid_emp = [r for r in warning_records if r["employeeId"] not in employees_by_pk]
print(f"Records with invalid employee ID: {len(invalid_emp)}")

# V8: Confidentiality levels
conf_dist = Counter(r["hrConfidentialityLevel"] for r in warning_records)
print(f"\nConfidentiality Level Distribution:")
for c, cnt in sorted(conf_dist.items()):
    print(f"  {c}: {cnt}")

# V9: Redaction requirements
redact_count = sum(1 for r in warning_records if r["redactionRequired"])
print(f"\nRecords requiring redaction: {redact_count} / {len(warning_records)} ({redact_count/len(warning_records)*100:.1f}%)")

# V10: Resolution status
res_dist = Counter(r["resolutionStatus"] for r in warning_records)
print(f"\nResolution Status Distribution:")
for s, c in sorted(res_dist.items()):
    print(f"  {s}: {c}")

# V11: Project links
has_project = sum(1 for r in warning_records if r["linkedProjectId"])
print(f"\nRecords linked to project: {has_project} / {len(warning_records)} ({has_project/len(warning_records)*100:.1f}%)")

# V12: Training links
has_training = sum(1 for r in warning_records if r["linkedTrainingId"])
print(f"Records linked to training: {has_training} / {len(warning_records)} ({has_training/len(warning_records)*100:.1f}%)")

# ---------------------------------------------------------------------------
# Write output
# ---------------------------------------------------------------------------
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(warning_records, ensure_ascii=False, indent=2), encoding="utf-8")

print(f"\nOutput written to: {OUTPUT}")

# Print samples
print(f"\n{'='*80}")
print("SAMPLE WARNING RECORDS (Employee PK=1, CEO)")
print(f"{'='*80}")
ceo_warnings = sorted([r for r in warning_records if r["employeeId"] == 1], key=lambda x: x["caseDate"])
for r in ceo_warnings:
    print(f"  {r['caseId']} | {r['caseDate']} | {r['caseType']} | {r['severity']} | Formal={r['formalWarning']}")
    print(f"    Summary: {r['summary']}")
    print(f"    Root Cause: {r['rootCause']}")
    print(f"    Action: {r['actionTaken']}")
    print(f"    Confidentiality: {r['hrConfidentialityLevel']} | Redact: {r['redactionRequired']}")
    print(f"    Manager: {r['managerInvolved']} | Project: {r['linkedProjectId']} | Training: {r['linkedTrainingId']}")

print(f"\n{'='*80}")
print("SAMPLE WARNING RECORDS (Employee PK=12, Junior Sales)")
print(f"{'='*80}")
jr_warnings = sorted([r for r in warning_records if r["employeeId"] == 12], key=lambda x: x["caseDate"])
for r in jr_warnings:
    print(f"  {r['caseId']} | {r['caseDate']} | {r['caseType']} | {r['severity']} | Formal={r['formalWarning']}")
    print(f"    Summary: {r['summary']}")
    print(f"    Action: {r['actionTaken']}")

print(f"\n{'='*80}")
print("LOOP 7 COMPLETE")
print(f"{'='*80}")