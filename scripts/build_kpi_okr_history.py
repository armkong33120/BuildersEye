#!/usr/bin/env python3
"""Generate KPI/OKR History for all 150 employees."""
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
OUTPUT = APP_ROOT / "src" / "data" / "kpi-okr-history.json"

# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------
g = json.loads(IDENTITY_FILE.read_text(encoding="utf-8"))
idents = g["identities"]
employees_by_pk = {e["pk"]: e for e in idents}

career_stories = json.loads(CAREER_FILE.read_text(encoding="utf-8"))
career_by_pk = {s["employeeId"]: s for s in career_stories}

assignments = json.loads(ASSIGNMENTS_FILE.read_text(encoding="utf-8"))
assignments_by_pk = defaultdict(list)
for a in assignments:
    assignments_by_pk[a["employeeId"]].append(a)

# Reference date
REF_DATE = datetime(2026, 6, 26)

# ---------------------------------------------------------------------------
# KPI Templates by Level
# ---------------------------------------------------------------------------
SENIOR_KPIS = {
    "Executive": {
        "Leadership": [
            {"name": "Strategic Initiative Completion Rate", "unit": "%", "target_range": (75, 100)},
            {"name": "Board Satisfaction Score", "unit": "/10", "target_range": (7, 10)},
            {"name": "Succession Pipeline Depth", "unit": "ready candidates", "target_range": (2, 5)},
            {"name": "Cross-Department Initiative Alignment", "unit": "%", "target_range": (80, 100)},
            {"name": "Executive Decision Turnaround Time", "unit": "days", "target_range": (1, 5)},
        ],
        "Strategy": [
            {"name": "Revenue Growth vs Target", "unit": "%", "target_range": (5, 25)},
            {"name": "Market Share Change", "unit": "%", "target_range": (0, 8)},
            {"name": "New Business Line Revenue", "unit": "MB", "target_range": (10, 200)},
            {"name": "Strategic Partnership Agreements Signed", "unit": "count", "target_range": (1, 5)},
        ],
        "Budget": [
            {"name": "Budget Variance (Actual vs Plan)", "unit": "%", "target_range": (-5, 5)},
            {"name": "Cost Savings from Optimization", "unit": "%", "target_range": (3, 15)},
            {"name": "ROI on Strategic Investments", "unit": "%", "target_range": (10, 40)},
        ],
        "People": [
            {"name": "Executive Team Retention", "unit": "%", "target_range": (85, 100)},
            {"name": "Leadership Development Program Graduates", "unit": "count", "target_range": (2, 8)},
            {"name": "Employee Engagement Score", "unit": "/100", "target_range": (65, 90)},
        ],
    },
    "mid_manager": {
        "Leadership": [
            {"name": "Team Goal Achievement Rate", "unit": "%", "target_range": (70, 100)},
            {"name": "Direct Report Development Plans Completed", "unit": "%", "target_range": (80, 100)},
            {"name": "Cross-Functional Collaboration Effectiveness", "unit": "/5", "target_range": (3, 5)},
            {"name": "Decision Escalation Accuracy", "unit": "%", "target_range": (75, 95)},
        ],
        "Delivery": [
            {"name": "Project On-Time Delivery Rate", "unit": "%", "target_range": (70, 100)},
            {"name": "Quality Audit Pass Rate", "unit": "%", "target_range": (80, 100)},
            {"name": "Process Improvement Initiatives Implemented", "unit": "count", "target_range": (1, 5)},
            {"name": "Customer Satisfaction Score", "unit": "/5", "target_range": (3.5, 5)},
        ],
        "Budget": [
            {"name": "Department Budget Adherence", "unit": "%", "target_range": (-3, 5)},
            {"name": "Resource Utilization Efficiency", "unit": "%", "target_range": (75, 95)},
        ],
        "People": [
            {"name": "Team Turnover Rate", "unit": "%", "target_range": (0, 10)},
            {"name": "Training Hours per Team Member", "unit": "hours", "target_range": (16, 40)},
            {"name": "Internal Promotion Rate", "unit": "%", "target_range": (5, 20)},
        ],
    },
}

JUNIOR_KPIS = {
    "Execution": [
        {"name": "Task Completion Rate (On-Time)", "unit": "%", "target_range": (70, 100)},
        {"name": "Tasks Completed per Sprint", "unit": "count", "target_range": (5, 20)},
        {"name": "First-Time Approval Rate", "unit": "%", "target_range": (60, 95)},
        {"name": "Overtime Hours (Lower is Better)", "unit": "hours", "target_range": (0, 20)},
    ],
    "Reliability": [
        {"name": "Attendance Rate", "unit": "%", "target_range": (90, 100)},
        {"name": "SLA Compliance Rate", "unit": "%", "target_range": (85, 100)},
        {"name": "Escalation Handling Accuracy", "unit": "%", "target_range": (80, 100)},
        {"name": "Deadline Adherence", "unit": "%", "target_range": (75, 100)},
    ],
    "Documentation": [
        {"name": "Documentation Completeness Score", "unit": "/5", "target_range": (3, 5)},
        {"name": "Knowledge Base Articles Contributed", "unit": "count", "target_range": (1, 8)},
        {"name": "Process Documentation Updates", "unit": "count", "target_range": (0, 5)},
    ],
    "Learning": [
        {"name": "Training Completion Rate", "unit": "%", "target_range": (80, 100)},
        {"name": "New Skills Acquired (Quarterly)", "unit": "count", "target_range": (1, 4)},
        {"name": "Certification Exam Passed", "unit": "boolean", "target_range": (0, 1)},
        {"name": "Mentor Feedback Score", "unit": "/5", "target_range": (3, 5)},
    ],
}

# ---------------------------------------------------------------------------
# Performance band rules (from LOOP 2)
# ---------------------------------------------------------------------------
BANDS = {
    "Exceptional (A)": (4.5, 5.0),
    "Exceeds (B)": (3.5, 4.4),
    "Meets (C)": (2.5, 3.4),
    "Below (D)": (1.5, 2.4),
    "Unsatisfactory (E)": (1.0, 1.4),
}

def band_for_score(score):
    for band, (lo, hi) in BANDS.items():
        if lo <= score <= hi:
            return band
    return "Meets (C)"

# OKR score tends to be lower than KPI (aspirational)
def okr_from_kpi(kpi_score, has_recovery=False):
    base = kpi_score - random.uniform(0.1, 0.6)
    if has_recovery:
        base += random.uniform(0.2, 0.5)
    return round(max(1.0, min(5.0, base)), 1)

# ---------------------------------------------------------------------------
# Feedback templates
# ---------------------------------------------------------------------------
POSITIVE_FEEDBACK_SENIOR = [
    "แสดงความเป็นผู้นำที่แข็งแกร่งในการขับเคลื่อนกลยุทธ์องค์กร",
    "บริหารจัดการ stakeholder ได้อย่างมีประสิทธิภาพ",
    "ตัดสินใจเชิงกลยุทธ์ได้ดีภายใต้สถานการณ์ที่ท้าทาย",
    "พัฒนาทีมผู้บริหารรุ่นต่อไปได้อย่างเป็นรูปธรรม",
    "ควบคุมงบประมาณและทรัพยากรได้อย่างมีประสิทธิภาพ",
    "สร้างความร่วมมือข้ามแผนกได้อย่างโดดเด่น",
    "ผลักดัน initiative ใหม่ที่สร้างมูลค่าให้องค์กร",
]

POSITIVE_FEEDBACK_MID = [
    "บริหารทีมได้ดี ส่งมอบงานตามเป้าหมาย",
    "พัฒนาทักษะทีมงานอย่างต่อเนื่อง",
    "จัดการโครงการได้ตาม timeline และ budget",
    "สื่อสารกับ stakeholder ได้ชัดเจนและมีประสิทธิภาพ",
    "แก้ไขปัญหาเฉพาะหน้าได้ดี",
    "มีความคิดริเริ่มในการปรับปรุงกระบวนการทำงาน",
    "ทำงานร่วมกับแผนกอื่นได้อย่างราบรื่น",
]

POSITIVE_FEEDBACK_JUNIOR = [
    "มีความรับผิดชอบสูง ส่งงานตรงเวลา",
    "เรียนรู้งานได้เร็วและปรับตัวได้ดี",
    "ทำงานเป็นทีมได้อย่างมีประสิทธิภาพ",
    "ใส่ใจในรายละเอียดและคุณภาพของงาน",
    "กระตือรือร้นในการเรียนรู้และพัฒนาตนเอง",
    "มีการจดบันทึกและจัดทำเอกสารอย่างเป็นระบบ",
    "ตอบสนองต่อ feedback และนำไปปรับปรุงได้ดี",
]

NEGATIVE_FEEDBACK_SENIOR = [
    "ควรเพิ่มการสื่อสารกับทีมระดับปฏิบัติการมากขึ้น",
    "ต้องปรับปรุงการบริหารความเสี่ยงในโครงการขนาดใหญ่",
    "ควรเร่งการตัดสินใจในเรื่องที่ต้องการความรวดเร็ว",
    "ต้องการการติดตามผลลัพธ์ที่เป็นรูปธรรมมากขึ้น",
    "ควรให้ความสำคัญกับการพัฒนา talent pipeline",
    "ต้องปรับปรุงการควบคุมต้นทุนในโครงการ",
]

NEGATIVE_FEEDBACK_MID = [
    "ควรปรับปรุงการวางแผนและการจัดลำดับความสำคัญ",
    "ต้องเพิ่มความถี่ในการรายงานความคืบหน้า",
    "ควรพัฒนาเครื่องมือในการติดตาม KPI ของทีม",
    "ต้องการการสื่อสารที่ proactive มากขึ้นกับผู้บริหาร",
    "ควรให้ feedback ทีมงานอย่างสม่ำเสมอมากขึ้น",
    "ต้องปรับปรุงการบริหารเวลาและการ delegate งาน",
]

NEGATIVE_FEEDBACK_JUNIOR = [
    "ควรปรับปรุงความถูกต้องของข้อมูลในรายงาน",
    "ต้องเพิ่มความเร็วในการตอบสนองต่อคำขอ",
    "ควรศึกษาและทำความเข้าใจกระบวนการทำงานให้มากขึ้น",
    "ต้องการการตรวจสอบงานก่อนส่งมอบมากขึ้น",
    "ควรพัฒนาทักษะการสื่อสารและการนำเสนอ",
    "ต้องปรับปรุงการจัดการเวลาและการจัดลำดับความสำคัญ",
]

STRONG_AREAS_SENIOR = [
    "Strategic Thinking", "Executive Communication", "Crisis Management",
    "Board Relationship", "People Development", "Financial Acumen",
    "Stakeholder Management", "Change Leadership",
]
STRONG_AREAS_MID = [
    "Team Management", "Project Delivery", "Quality Control",
    "Cross-Functional Collaboration", "Problem Solving", "Client Relations",
    "Process Improvement", "Vendor Management",
]
STRONG_AREAS_JUNIOR = [
    "Task Execution", "Reliability", "Documentation",
    "Learning Agility", "Teamwork", "Attention to Detail",
    "Following Procedures", "Time Management",
]

WEAK_AREAS_SENIOR = [
    "Operational Detail", "Hands-on Execution", "Work-Life Balance Modeling",
    "Timely Decision Making", "Bottom-Up Communication",
]
WEAK_AREAS_MID = [
    "Delegation", "Strategic Planning", "Data-Driven Decision Making",
    "Conflict Resolution", "Budget Forecasting",
]
WEAK_AREAS_JUNIOR = [
    "Self-Direction", "Presentation Skills", "Process Improvement",
    "Stakeholder Communication", "Technical Depth",
]

IMPROVEMENT_PLANS = [
    "จัดทำ personal development plan และติดตามทุก quarter",
    "เข้าร่วม training program เฉพาะทางและรายงานผล",
    "จับคู่กับ mentor อาวุโสเพื่อเรียนรู้ on-the-job",
    "กำหนด SMART goals ร่วมกับ manager ทุกเดือน",
    "เข้าร่วมโครงการพิเศษเพื่อพัฒนาทักษะที่ขาด",
    "ปรับ workload และเพิ่ม coaching session รายสัปดาห์",
    "มอบหมาย project ที่ท้าทายเพื่อเร่งการเรียนรู้",
    "จัดทำ knowledge sharing session สำหรับทีม",
]

# ---------------------------------------------------------------------------
# Generate review periods based on tenure
# ---------------------------------------------------------------------------
def generate_review_periods(join_date_str, tenure_months):
    join_date = datetime.strptime(join_date_str, "%Y-%m-%d")
    periods = []

    # Reviews happen quarterly: Q1 (Jan-Mar), Q2 (Apr-Jun), Q3 (Jul-Sep), Q4 (Oct-Dec)
    # Start from the first full quarter after join date
    current = join_date
    # Move to next quarter start
    q_months = [1, 4, 7, 10]
    for qm in q_months:
        q_start = datetime(current.year, qm, 1)
        if q_start > current + timedelta(days=60):  # at least 2 months after join
            current = q_start
            break
    else:
        # next year Q1
        current = datetime(current.year + 1, 1, 1)

    count = min(6, max(3, tenure_months // 12 + 1))
    # Cap: at most go up to REF_DATE
    while len(periods) < count:
        if current > REF_DATE:
            break
        q = (current.month - 1) // 3 + 1
        period = f"{current.year}-Q{q}"
        periods.append(period)
        # next quarter
        m = current.month + 3
        y = current.year + (m - 1) // 12
        m = ((m - 1) % 12) + 1
        current = datetime(y, m, 1)

    return periods

# ---------------------------------------------------------------------------
# Generate for each employee
# ---------------------------------------------------------------------------
kpi_records = []
all_scores = []

for e in sorted(idents, key=lambda x: x["pk"]):
    pk = e["pk"]
    depth = e["hierarchyDepth"]
    dept = e["department"]
    is_exec = dept == "Executive"
    is_manager = e.get("directReportCount", 0) > 0
    career = career_by_pk[pk]
    emp_assignments = assignments_by_pk[pk]

    periods = generate_review_periods(career["joinDate"], career["tenureMonths"])

    # Determine employee type
    if depth <= 1 or (depth <= 2 and is_manager):
        emp_type = "senior"
    elif depth >= 4:
        emp_type = "junior"
    else:
        emp_type = "mid"

    # Determine base performance band from career story
    # Promotion count and tenure influence baseline
    promo = career["promotionCount"]
    tenure_mo = career["tenureMonths"]
    retention = career["retentionRisk"]

    # Base score: higher depth (more senior) = higher expected score
    if depth <= 1:
        base_score_range = (3.5, 4.8)
    elif depth == 2:
        base_score_range = (3.0, 4.3)
    elif depth == 3:
        base_score_range = (2.8, 4.0)
    elif depth == 4:
        base_score_range = (2.5, 3.6)
    else:
        base_score_range = (2.0, 3.2)

    # Adjust for promotions (promoted employees tend to perform better)
    if promo >= 3:
        base_score_range = (base_score_range[0] + 0.2, base_score_range[1] + 0.1)
    elif promo == 0 and depth >= 3:
        base_score_range = (base_score_range[0] - 0.2, base_score_range[1] - 0.1)

    # Adjust for retention risk
    if retention == "High":
        base_score_range = (max(1.0, base_score_range[0] - 0.3), base_score_range[1] - 0.1)
    elif retention == "Low" and depth <= 2:
        base_score_range = (base_score_range[0], min(5.0, base_score_range[1] + 0.1))

    # Check if employee has mistakes in assignment records
    has_mistakes = any(a.get("hasMistake", False) for a in emp_assignments)
    mistake_periods = set()  # periods where a mistake impacted score

    # Generate scores with realistic progression
    prev_score = None
    dip_period_idx = -1
    if has_mistakes and len(periods) >= 3:
        # Place mistake dip somewhere in the middle periods
        dip_period_idx = random.randint(1, len(periods) - 2)

    for i, period in enumerate(periods):
        is_dip = (i == dip_period_idx)

        if is_dip:
            # Score drops due to mistake
            if prev_score and prev_score > 2.5:
                kpi_score = round(max(1.5, prev_score - random.uniform(0.5, 1.5)), 1)
            else:
                kpi_score = round(random.uniform(1.5, 2.4), 1)
            mistake_periods.add(period)
        elif i == dip_period_idx + 1 and dip_period_idx >= 0:
            # Recovery: score improves but may not fully recover
            recovery_amount = random.uniform(0.3, 0.9)
            kpi_score = round(min(base_score_range[1], prev_score + recovery_amount), 1)
        elif prev_score is None:
            # First review: start near the lower end of their range (growing)
            kpi_score = round(random.uniform(base_score_range[0], base_score_range[0] + 0.4), 1)
        else:
            # Normal: slight variation around previous
            delta = random.uniform(-0.3, 0.3)
            if prev_score < 3.0:
                delta += 0.15  # upward pressure for low performers
            kpi_score = round(max(1.0, min(5.0, prev_score + delta)), 1)
            # Keep within range
            kpi_score = max(base_score_range[0] - 0.3, min(base_score_range[1] + 0.3, kpi_score))

        prev_score = kpi_score
        band = band_for_score(kpi_score)
        is_recovery = (i == dip_period_idx + 1)
        okr_score = okr_from_kpi(kpi_score, has_recovery=is_recovery)

        # Strong/Weak areas
        if emp_type == "senior":
            strong = random.choice(STRONG_AREAS_SENIOR)
            weak = random.choice(WEAK_AREAS_SENIOR)
        elif emp_type == "mid":
            strong = random.choice(STRONG_AREAS_MID)
            weak = random.choice(WEAK_AREAS_MID)
        else:
            strong = random.choice(STRONG_AREAS_JUNIOR)
            weak = random.choice(WEAK_AREAS_JUNIOR)

        # Manager feedback
        if band in ("Exceptional (A)", "Exceeds (B)"):
            if emp_type == "senior":
                feedback = random.choice(POSITIVE_FEEDBACK_SENIOR)
            elif emp_type == "mid":
                feedback = random.choice(POSITIVE_FEEDBACK_MID)
            else:
                feedback = random.choice(POSITIVE_FEEDBACK_JUNIOR)
        elif band == "Meets (C)":
            pos = POSITIVE_FEEDBACK_MID if emp_type != "junior" else POSITIVE_FEEDBACK_JUNIOR
            neg = NEGATIVE_FEEDBACK_MID if emp_type != "junior" else NEGATIVE_FEEDBACK_JUNIOR
            if emp_type == "senior":
                pos = POSITIVE_FEEDBACK_SENIOR
                neg = NEGATIVE_FEEDBACK_SENIOR
            feedback = random.choice(pos) + " แต่" + random.choice(neg)
        else:
            if emp_type == "senior":
                feedback = random.choice(NEGATIVE_FEEDBACK_SENIOR)
            elif emp_type == "mid":
                feedback = random.choice(NEGATIVE_FEEDBACK_MID)
            else:
                feedback = random.choice(NEGATIVE_FEEDBACK_JUNIOR)

        if is_dip:
            feedback = random.choice(NEGATIVE_FEEDBACK_SENIOR if emp_type == "senior" else
                                    (NEGATIVE_FEEDBACK_MID if emp_type == "mid" else NEGATIVE_FEEDBACK_JUNIOR))
            feedback += " (ได้รับผลกระทบจาก incident ในโครงการ)"

        # Improvement plan
        if band in ("Below (D)", "Unsatisfactory (E)"):
            improvement = random.choice(IMPROVEMENT_PLANS)
        elif band == "Meets (C)" and random.random() < 0.3:
            improvement = random.choice(IMPROVEMENT_PLANS)
        else:
            improvement = ""

        # Follow-up status
        if band in ("Below (D)", "Unsatisfactory (E)"):
            followup = random.choice(["In Progress", "Completed", "Under Review"])
        elif improvement:
            followup = "Completed" if random.random() < 0.6 else "In Progress"
        else:
            followup = "N/A"

        kpi_records.append({
            "employeeId": pk,
            "reviewPeriod": period,
            "kpiScore": kpi_score,
            "okrScore": okr_score,
            "performanceBand": band,
            "strongArea": strong,
            "weakArea": weak,
            "managerFeedback": feedback,
            "improvementPlan": improvement,
            "followUpStatus": followup,
        })
        all_scores.append(kpi_score)

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
print("=" * 80)
print("KPI/OKR HISTORY VALIDATION")
print("=" * 80)

# V1: Total records
print(f"\nTotal KPI records: {len(kpi_records)}")

# V2: Records per employee
records_per_emp = Counter(r["employeeId"] for r in kpi_records)
counts = [records_per_emp.get(pk, 0) for pk in range(1, 151)]
print(f"Records per employee: Min={min(counts)}, Max={max(counts)}, Mean={sum(counts)/150:.1f}")

below_3 = [pk for pk in range(1, 151) if records_per_emp.get(pk, 0) < 3]
above_6 = [pk for pk in range(1, 151) if records_per_emp.get(pk, 0) > 6]
print(f"Below 3 records: {len(below_3)}")
print(f"Above 6 records: {len(above_6)}")

# V3: Score distribution
score_dist = Counter()
for s in all_scores:
    if s >= 4.5:
        score_dist["4.5-5.0 (A)"] += 1
    elif s >= 3.5:
        score_dist["3.5-4.4 (B)"] += 1
    elif s >= 2.5:
        score_dist["2.5-3.4 (C)"] += 1
    elif s >= 1.5:
        score_dist["1.5-2.4 (D)"] += 1
    else:
        score_dist["1.0-1.4 (E)"] += 1

print(f"\nKPI Score Distribution:")
for band_label, cnt in sorted(score_dist.items()):
    pct = cnt / len(all_scores) * 100
    bar = "█" * int(pct / 2)
    print(f"  {band_label}: {cnt} ({pct:.1f}%) {bar}")

# V4: Band distribution
band_dist = Counter(r["performanceBand"] for r in kpi_records)
print(f"\nPerformance Band Distribution:")
for band in sorted(band_dist.keys()):
    cnt = band_dist[band]
    pct = cnt / len(kpi_records) * 100
    print(f"  {band}: {cnt} ({pct:.1f}%)")

# V5: No impossible jumps
print(f"\nImpossible Jump Check (delta > 2.0 in consecutive periods):")
impossible_jumps = 0
for pk in range(1, 151):
    emp_records = sorted([r for r in kpi_records if r["employeeId"] == pk], key=lambda x: x["reviewPeriod"])
    for i in range(1, len(emp_records)):
        delta = abs(emp_records[i]["kpiScore"] - emp_records[i-1]["kpiScore"])
        if delta > 2.0:
            impossible_jumps += 1
            if impossible_jumps <= 3:
                print(f"  PK={pk}: {emp_records[i-1]['reviewPeriod']}={emp_records[i-1]['kpiScore']} → {emp_records[i]['reviewPeriod']}={emp_records[i]['kpiScore']} (Δ={delta:.1f})")
print(f"  Total impossible jumps: {impossible_jumps}")

# V6: Senior leader KPIs different from junior
senior_scores = [r["kpiScore"] for r in kpi_records if employees_by_pk[r["employeeId"]]["hierarchyDepth"] <= 1]
junior_scores = [r["kpiScore"] for r in kpi_records if employees_by_pk[r["employeeId"]]["hierarchyDepth"] >= 4]
print(f"\nAvg KPI Score — Senior (depth≤1): {sum(senior_scores)/len(senior_scores):.2f}")
print(f"Avg KPI Score — Junior (depth≥4): {sum(junior_scores)/len(junior_scores):.2f}")

# V7: OKR scores generally lower than KPI
okr_lower = sum(1 for r in kpi_records if r["okrScore"] < r["kpiScore"])
okr_equal_higher = len(kpi_records) - okr_lower
print(f"\nOKR < KPI: {okr_lower} ({okr_lower/len(kpi_records)*100:.1f}%)")
print(f"OKR >= KPI: {okr_equal_higher} ({okr_equal_higher/len(kpi_records)*100:.1f}%)")

# V8: Employees with dip/mistake in at least one period
emp_has_dip = set()
for r in kpi_records:
    if r["performanceBand"] in ("Below (D)", "Unsatisfactory (E)"):
        emp_has_dip.add(r["employeeId"])
print(f"\nEmployees with at least 1 D/E period: {len(emp_has_dip)} / 150")

# V9: Follow-up status distribution
followup_dist = Counter(r["followUpStatus"] for r in kpi_records)
print(f"\nFollow-up Status Distribution:")
for s, c in sorted(followup_dist.items()):
    print(f"  {s}: {c}")

# V10: Period distribution
period_dist = Counter(r["reviewPeriod"] for r in kpi_records)
print(f"\nRecords by Review Period (top 15):")
for p, c in period_dist.most_common(15):
    print(f"  {p}: {c}")

# ---------------------------------------------------------------------------
# Write output
# ---------------------------------------------------------------------------
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(kpi_records, ensure_ascii=False, indent=2), encoding="utf-8")

print(f"\nOutput written to: {OUTPUT}")

# Print samples
print(f"\n{'='*80}")
print("SAMPLE KPI/OKR RECORDS (PK=1, CEO)")
print(f"{'='*80}")
ceo_records = sorted([r for r in kpi_records if r["employeeId"] == 1], key=lambda x: x["reviewPeriod"])
for r in ceo_records:
    print(f"  {r['reviewPeriod']}: KPI={r['kpiScore']} OKR={r['okrScore']} Band={r['performanceBand']}")
    print(f"    Strong: {r['strongArea']} | Weak: {r['weakArea']}")
    print(f"    Feedback: {r['managerFeedback'][:80]}...")
    print(f"    Plan: {r['improvementPlan'] or 'N/A'} | Follow-up: {r['followUpStatus']}")

print(f"\n{'='*80}")
print("SAMPLE KPI/OKR RECORDS (PK=12, Junior Sales)")
print(f"{'='*80}")
jr_records = sorted([r for r in kpi_records if r["employeeId"] == 12], key=lambda x: x["reviewPeriod"])
for r in jr_records:
    print(f"  {r['reviewPeriod']}: KPI={r['kpiScore']} OKR={r['okrScore']} Band={r['performanceBand']}")
    print(f"    Strong: {r['strongArea']} | Weak: {r['weakArea']}")
    print(f"    Feedback: {r['managerFeedback'][:80]}...")

print(f"\n{'='*80}")
print("LOOP 6 COMPLETE")
print(f"{'='*80}")