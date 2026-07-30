#!/usr/bin/env python3
"""Generate 150-row Career Story Plan for all employees."""
import json
import random
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

random.seed(20260707)

APP_ROOT = Path(__file__).resolve().parents[1]
SOURCE = APP_ROOT / "src" / "data" / "identity-graph.json"
OUTPUT = APP_ROOT / "src" / "data" / "career-story-plan.json"

g = json.loads(SOURCE.read_text(encoding="utf-8"))
idents = g["identities"]
ceo_pk = g["ceoPk"]
REF_DATE = datetime(2026, 6, 26)

# ---------------------------------------------------------------------------
# Base join date rules by hierarchy depth
# ---------------------------------------------------------------------------
# CEO: 2015-01-15 (fixed)
# Depth 1: 2016-2019
# Depth 2: 2017-2020
# Depth 3: 2019-2022
# Depth 4: 2020-2024
# Depth 5: 2021-2025
# Depth 6: 2022-2025
JOIN_BANDS = {
    0: (datetime(2015, 1, 15), datetime(2015, 1, 15)),  # CEO fixed
    1: (datetime(2016, 1, 1), datetime(2019, 6, 30)),
    2: (datetime(2017, 1, 1), datetime(2020, 12, 31)),
    3: (datetime(2019, 1, 1), datetime(2022, 12, 31)),
    4: (datetime(2020, 1, 1), datetime(2024, 6, 30)),
    5: (datetime(2021, 1, 1), datetime(2025, 6, 30)),
    6: (datetime(2022, 1, 1), datetime(2025, 12, 31)),
}

# Promotion counts by hierarchy depth (expected)
PROMO_COUNTS = {
    0: (3, 4),  # CEO: 3-4 promotions
    1: (2, 3),
    2: (1, 3),
    3: (1, 2),
    4: (0, 1),
    5: (0, 1),
    6: (0, 0),
}

# Starting position templates by department
STARTING_POSITIONS = {
    "Executive": ["Management Trainee", "Operations Manager", "Finance Manager", "Sales Executive", "Project Director"],
    "Engineering & Construction": ["Site Engineer", "Junior Engineer", "Civil Engineer", "Foreman", "Project Coordinator"],
    "Design & Architecture": ["Junior Architect", "Draftsman", "Interior Designer Trainee", "Architectural Intern"],
    "Sales": ["Sales Representative", "Sales Coordinator", "Account Executive", "Telesales"],
    "Procurement & Warehouse": ["Purchasing Officer", "Warehouse Clerk", "Logistics Coordinator", "Inventory Assistant"],
    "Finance & Accounting": ["Accountant", "Accounts Payable Clerk", "Financial Analyst Trainee", "Audit Assistant"],
    "HR & Admin": ["HR Assistant", "Admin Officer", "Recruitment Coordinator", "Payroll Clerk"],
    "IT": ["IT Support Technician", "Junior Developer", "Network Administrator Trainee", "Help Desk"],
    "Legal": ["Legal Assistant", "Paralegal", "Compliance Officer Trainee"],
    "Marketing": ["Marketing Coordinator", "Content Writer", "Graphic Designer", "Marketing Assistant"],
    "Customer Service & Warranty": ["Customer Service Representative", "Warranty Clerk", "Call Center Agent"],
    "Office Support": ["Administrative Assistant", "Office Clerk", "Receptionist"],
}

# Strengths by department
STRENGTHS_BY_DEPT = {
    "Executive": ["Strategic Vision", "Stakeholder Management", "Crisis Leadership", "Board Communication", "M&A Execution"],
    "Engineering & Construction": ["Site Management", "Structural Analysis", "Quality Control", "Vendor Coordination", "Cost Estimation"],
    "Design & Architecture": ["Creative Design", "BIM Proficiency", "Client Presentation", "Sustainable Design", "Space Planning"],
    "Sales": ["Client Negotiation", "Pipeline Management", "Relationship Building", "Tender Preparation", "Market Analysis"],
    "Procurement & Warehouse": ["Supplier Negotiation", "Inventory Optimization", "Contract Management", "Logistics Planning", "Cost Reduction"],
    "Finance & Accounting": ["Financial Modeling", "Tax Compliance", "Audit Preparation", "Budget Forecasting", "Cash Flow Management"],
    "HR & Admin": ["Talent Acquisition", "Employee Relations", "Policy Development", "Training Design", "Compensation Planning"],
    "IT": ["System Architecture", "Cybersecurity", "Cloud Migration", "Vendor Management", "Incident Response"],
    "Legal": ["Contract Drafting", "Regulatory Compliance", "Litigation Support", "Risk Assessment", "Policy Writing"],
    "Marketing": ["Brand Strategy", "Digital Campaigns", "Content Marketing", "SEO/SEM", "Event Management"],
    "Customer Service & Warranty": ["Complaint Resolution", "Customer Retention", "Service Recovery", "Warranty Processing", "SLA Management"],
    "Office Support": ["Facility Management", "Event Coordination", "Vendor Liaison", "Office Administration", "Process Improvement"],
}

# Weaknesses by department
WEAKNESSES_BY_DEPT = {
    "Executive": ["Over-delegation", "Too hands-off with operations", "Impatient with slow results", "Over-optimistic on timelines"],
    "Engineering & Construction": ["Perfectionism causing delays", "Reluctance to escalate early", "Underestimating soft costs", "Poor documentation habits"],
    "Design & Architecture": ["Scope creep from creativity", "Late-night work culture", "Conflict avoidance with clients", "Over-reliance on single tool"],
    "Sales": ["Over-promising to clients", "Undocumented verbal agreements", "Skip internal approval steps", "Pressure-driven shortcuts"],
    "Procurement & Warehouse": ["Single-source supplier dependency", "Delayed inventory updates", "Informal vendor agreements", "Stockpile without demand signal"],
    "Finance & Accounting": ["Over-cautious on spending", "Delayed month-end close", "Manual processes not automated", "Resistance to new software"],
    "HR & Admin": ["Slow policy rollout", "Avoids difficult conversations", "Paper-heavy processes", "Reactive rather than proactive"],
    "IT": ["Firefighting over planning", "Tech debt accumulation", "Poor user communication", "Under-documented configurations"],
    "Legal": ["Over-lawyering simple matters", "Slow contract turnaround", "Jargon-heavy communication", "Perfectionism on low-risk items"],
    "Marketing": ["Chasing trends over strategy", "Budget overruns on campaigns", "Inconsistent brand voice", "Over-reliance on agencies"],
    "Customer Service & Warranty": ["Burnout from emotional load", "Inconsistent case documentation", "Delay in escalation", "Over-promise resolution timeline"],
    "Office Support": ["Taken for granted by other depts", "Under-reported workload", "Ad-hoc rather than scheduled", "Lack of career development focus"],
}

# Mistake theme mapping (from LOOP 2 taxonomy) — 1-2 per employee
MISTAKE_THEMES = {
    "M01": {"theme": "Unauthorized Data Sharing", "severity_range": (2, 4), "depts": "ALL", "levels": "ALL"},
    "M02": {"theme": "Missed Regulatory Deadline", "severity_range": (3, 4), "depts": ["Legal", "Finance & Accounting", "HR & Admin"], "levels": "mid"},
    "M03": {"theme": "Budget Overrun (Project)", "severity_range": (2, 3), "depts": ["Engineering & Construction", "Procurement & Warehouse"], "levels": "mid"},
    "M04": {"theme": "Design Error / Rework", "severity_range": (2, 3), "depts": ["Design & Architecture", "Engineering & Construction"], "levels": "ALL"},
    "M05": {"theme": "Vendor / Supplier Dispute", "severity_range": (1, 2), "depts": ["Procurement & Warehouse", "Legal"], "levels": "mid"},
    "M06": {"theme": "Customer Complaint Escalation", "severity_range": (1, 2), "depts": ["Customer Service & Warranty", "Sales"], "levels": "ALL"},
    "M07": {"theme": "Security Incident (Minor)", "severity_range": (2, 3), "depts": ["IT"], "levels": "ALL"},
    "M09": {"theme": "Hiring / HR Process Error", "severity_range": (1, 2), "depts": ["HR & Admin"], "levels": "mid"},
    "M11": {"theme": "Communication / Stakeholder Misalignment", "severity_range": (1, 2), "depts": "ALL", "levels": "ALL"},
    "M13": {"theme": "KPI / Performance Data Error", "severity_range": (1, 1), "depts": "ALL", "levels": "junior"},
    "M14": {"theme": "OneDrive Quota Exceeded", "severity_range": (1, 1), "depts": "ALL", "levels": "ALL"},
    "M15": {"theme": "Wrong Sensitivity Label Applied", "severity_range": (2, 3), "depts": ["IT", "Legal", "Finance & Accounting", "Executive"], "levels": "ALL"},
    "M16": {"theme": "Process Bypass (Shortcut)", "severity_range": (1, 2), "depts": "ALL", "levels": "ALL"},
}

# Learning themes
LEARNING_THEMES = [
    "จากความผิดพลาดสู่การปรับปรุงกระบวนการทำงาน",
    "การเรียนรู้ผ่านการทำงานข้ามแผนก",
    "การพัฒนาทักษะการสื่อสารกับผู้มีส่วนได้ส่วนเสีย",
    "การยอมรับ feedback และปรับตัวอย่างต่อเนื่อง",
    "จาก technical expert สู่ people leader",
    "การเรียนรู้จาก mentor และ senior ในองค์กร",
    "การจัดการความเสี่ยงและการตัดสินใจภายใต้ความไม่แน่นอน",
    "การพัฒนาความฉลาดทางอารมณ์ในที่ทำงาน",
    "จากปัญหาซ้ำซากสู่ root cause analysis",
    "การเรียนรู้ผ่านความล้มเหลวของโครงการ",
    "การปรับตัวกับเทคโนโลยีและเครื่องมือใหม่",
    "การสร้างความไว้วางใจกับทีมและลูกค้า",
    "จาก silo thinking สู่ holistic business view",
    "การพัฒนาทักษะการนำเสนอและการโน้มน้าว",
    "การเรียนรู้การจัดการเวลาและ priority",
]

# Retention risk factors
RETENTION_RISKS = ["Low", "Medium", "High"]
RETENTION_WEIGHTS = [0.60, 0.30, 0.10]

# Succession potential
SUCCESSION_POTENTIAL = ["Ready Now", "1-2 Years", "3-5 Years", "Not Identified"]
SUCCESSION_WEIGHTS_BY_DEPTH = {
    0: [0.50, 0.50, 0.00, 0.00],
    1: [0.30, 0.50, 0.20, 0.00],
    2: [0.10, 0.40, 0.40, 0.10],
    3: [0.05, 0.20, 0.45, 0.30],
    4: [0.00, 0.10, 0.40, 0.50],
    5: [0.00, 0.05, 0.25, 0.70],
    6: [0.00, 0.00, 0.15, 0.85],
}

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------
def random_date(start, end):
    delta = (end - start).days
    return start + timedelta(days=random.randint(0, max(0, delta)))

def months_between(d1, d2):
    return max(1, round((d2 - d1).days / 30.44))

def select_weighted(options, weights):
    return random.choices(options, weights=weights, k=1)[0]

# ---------------------------------------------------------------------------
# Generate career stories
# ---------------------------------------------------------------------------
print("Generating 150 career stories...")

stories = []
employees_by_pk = {e["pk"]: e for e in idents}
dept_all = defaultdict(list)
for e in idents:
    dept_all[e["department"]].append(e["pk"])

for e in sorted(idents, key=lambda x: x["pk"]):
    pk = e["pk"]
    depth = e["hierarchyDepth"]
    dept = e["department"]
    title = e["jobTitle"]
    code = e["code"]
    name = e["name"]
    risk = e["accountRisk"]
    is_manager = e.get("directReportCount", 0) > 0
    is_exec = dept == "Executive"

    # --- Join Date ---
    band = JOIN_BANDS.get(depth, JOIN_BANDS[6])
    if pk == ceo_pk:
        join_date = band[0]
    else:
        join_date = random_date(band[0], band[1])

    tenure_months = months_between(join_date, REF_DATE)

    # --- Starting Position ---
    starting_positions = STARTING_POSITIONS.get(dept, ["Junior Staff"])
    start_pos = starting_positions[0] if depth <= 1 else random.choice(starting_positions[1:] if len(starting_positions) > 1 else starting_positions)

    # --- Current Position Start Date ---
    # Assume current position started 6-36 months after last promotion
    min_months_ago = min(tenure_months // (depth + 2) + 6, tenure_months - 3)
    max_months_ago = min(tenure_months // 2 + 12, tenure_months - 1)
    if depth <= 1:
        cur_start = join_date + timedelta(days=random.randint(365, 730))  # 1-2 years to reach current
    else:
        months_in_current = random.randint(max(6, min_months_ago), max(12, max_months_ago))
        cur_start = REF_DATE - timedelta(days=months_in_current * 30)
    if cur_start < join_date:
        cur_start = join_date + timedelta(days=90)

    # --- Promotion Count ---
    promo_range = PROMO_COUNTS.get(depth, (0, 1))
    if depth <= 2 and tenure_months < 24:
        promo_range = (0, 1)
    promo_count = random.randint(promo_range[0], promo_range[1])
    # Cap: can't have more promotions than years/2
    promo_count = min(promo_count, max(0, tenure_months // 18))
    # Execs at depth 0-1 with long tenure get more
    if is_exec and tenure_months > 96:
        promo_count = max(promo_count, 2)

    # --- Career Arc Summary ---
    if depth <= 1:
        arc_templates = [
            f"เริ่มจาก{start_pos} เติบโตผ่าน {promo_count} การเลื่อนตำแหน่ง สู่ {title}",
            f"เส้นทางจาก{start_pos} สร้างผลงานสำคัญใน{dept} จนถึง{title}",
            f"ร่วมก่อตั้งและพัฒนาองค์กรจาก{start_pos} สู่บทบาท{title}",
        ]
    elif depth <= 3:
        arc_templates = [
            f"จาก{start_pos} พัฒนาสู่ {title} ผ่านผลงาน{dept} ที่โดดเด่น",
            f"เส้นทาง{dept} จาก{start_pos} เติบโตอย่างมั่นคงด้วย {promo_count} การเลื่อนขั้น",
        ]
    else:
        arc_templates = [
            f"เริ่มต้น{dept} ในตำแหน่ง{start_pos} กำลังพัฒนาสู่{title}",
            f"เส้นทาง{dept} จาก{start_pos} สั่งสมประสบการณ์อย่างต่อเนื่อง",
            f"กำลังเรียนรู้และเติบโตในสาย{dept} จากพื้นฐาน{start_pos}",
        ]
    arc = random.choice(arc_templates)

    # --- Main Strength ---
    strengths = STRENGTHS_BY_DEPT.get(dept, ["General Competence"])
    if is_manager:
        leadership_strengths = ["Team Leadership", "People Development", "Decision Making", "Cross-functional Collaboration"]
        strengths = strengths + [s for s in leadership_strengths if s not in strengths]
    main_strength = random.choice(strengths)

    # --- Main Weakness ---
    weaknesses = WEAKNESSES_BY_DEPT.get(dept, ["Time Management"])
    if is_exec:
        weaknesses = [w for w in weaknesses if "over" in w.lower() or "too" in w.lower()]
    main_weakness = random.choice(weaknesses)

    # --- Mistake Theme ---
    eligible_mistakes = []
    for code, info in MISTAKE_THEMES.items():
        dept_match = info["depts"] == "ALL" or dept in info["depts"]
        level_match = True
        if info["levels"] == "mid" and depth < 2:
            level_match = False
        if info["levels"] == "junior" and depth < 3:
            level_match = False
        if dept_match and level_match:
            eligible_mistakes.append((code, info))

    if not eligible_mistakes:
        eligible_mistakes = [("M11", MISTAKE_THEMES["M11"]), ("M16", MISTAKE_THEMES["M16"])]

    num_mistakes = random.randint(1, min(2, len(eligible_mistakes)))
    chosen_mistakes = random.sample(eligible_mistakes, num_mistakes) if num_mistakes <= len(eligible_mistakes) else eligible_mistakes
    mistake_themes = [m[1]["theme"] for m in chosen_mistakes]
    mistake_codes = [m[0] for m in chosen_mistakes]

    # --- Learning Theme ---
    learning = random.choice(LEARNING_THEMES)
    # Bias toward relevant learning based on dept
    if depth <= 1:
        learning = random.choice([t for t in LEARNING_THEMES if "leader" in t or "holistic" in t or "ตัดสินใจ" in t] + LEARNING_THEMES)
    elif is_manager:
        learning = random.choice([t for t in LEARNING_THEMES if "ทีม" in t or "people" in t or "leader" in t] + LEARNING_THEMES)

    # --- Retention Risk ---
    # High risk: probation employees, very low tenure, or low performance band proxy
    if tenure_months < 12:
        ret_risk = select_weighted(["Low", "Medium", "High"], [0.20, 0.40, 0.40])
    elif depth >= 5 and tenure_months < 24:
        ret_risk = select_weighted(["Low", "Medium", "High"], [0.30, 0.40, 0.30])
    elif risk == "Privileged":
        ret_risk = "Low"  # Executives are retained
    else:
        ret_risk = select_weighted(RETENTION_RISKS, RETENTION_WEIGHTS)

    # --- Succession Potential ---
    weights = SUCCESSION_WEIGHTS_BY_DEPTH.get(depth, [0, 0, 0.15, 0.85])
    # Boost for managers
    if is_manager:
        weights = [max(0.15, w) for w in weights]
        weights[2] = max(0.10, weights[2])
    if is_exec and depth <= 1:
        weights = [0.40, 0.40, 0.20, 0.00]
    succ = select_weighted(SUCCESSION_POTENTIAL, weights)

    stories.append({
        "employeeId": pk,
        "code": code,
        "name": name,
        "department": dept,
        "jobTitle": title,
        "hierarchyDepth": depth,
        "joinDate": join_date.strftime("%Y-%m-%d"),
        "tenureMonths": tenure_months,
        "startingPosition": start_pos,
        "currentPositionStartDate": cur_start.strftime("%Y-%m-%d"),
        "promotionCount": promo_count,
        "careerArcSummary": arc,
        "mainStrength": main_strength,
        "mainWeakness": main_weakness,
        "mistakeThemeCodes": mistake_codes,
        "mistakeThemes": mistake_themes,
        "learningTheme": learning,
        "retentionRisk": ret_risk,
        "successionPotential": succ,
    })

# ---------------------------------------------------------------------------
# Write output
# ---------------------------------------------------------------------------
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(stories, ensure_ascii=False, indent=2), encoding="utf-8")

# ---------------------------------------------------------------------------
# Distribution summaries
# ---------------------------------------------------------------------------
print(f"\n{'='*80}")
print("DISTRIBUTION SUMMARY")
print(f"{'='*80}")

# --- By Level ---
depth_dist = Counter(s["hierarchyDepth"] for s in stories)
print(f"\nCareer Stories by Hierarchy Depth:")
for d in sorted(depth_dist.keys()):
    print(f"  Level {d}: {depth_dist[d]} stories")

# --- Promotion Distribution ---
promo_dist = Counter(s["promotionCount"] for s in stories)
print(f"\nPromotion Count Distribution:")
for p in sorted(promo_dist.keys()):
    print(f"  {p} promotions: {promo_dist[p]} employees")

# --- Mistake Theme Distribution ---
mistake_counter = Counter()
for s in stories:
    for theme in s["mistakeThemes"]:
        mistake_counter[theme] += 1
print(f"\nMistake Theme Distribution:")
for theme, count in mistake_counter.most_common():
    print(f"  {theme}: {count}")

# --- Retention Risk ---
ret_counter = Counter(s["retentionRisk"] for s in stories)
print(f"\nRetention Risk Distribution:")
for r in sorted(ret_counter.keys()):
    print(f"  {r}: {ret_counter[r]}")

# --- Succession Potential ---
succ_counter = Counter(s["successionPotential"] for s in stories)
print(f"\nSuccession Potential Distribution:")
for sp in SUCCESSION_POTENTIAL:
    print(f"  {sp}: {succ_counter.get(sp, 0)}")

# --- Tenure stats ---
tenures = [s["tenureMonths"] for s in stories]
print(f"\nTenure Distribution (months):")
print(f"  Min: {min(tenures)}, Max: {max(tenures)}, Mean: {sum(tenures)/len(tenures):.1f}")
tenure_bands = Counter()
for t in tenures:
    if t < 12:
        tenure_bands["< 1 yr"] += 1
    elif t < 24:
        tenure_bands["1-2 yr"] += 1
    elif t < 48:
        tenure_bands["2-4 yr"] += 1
    elif t < 72:
        tenure_bands["4-6 yr"] += 1
    elif t < 96:
        tenure_bands["6-8 yr"] += 1
    else:
        tenure_bands["8+ yr"] += 1
for band in ["< 1 yr", "1-2 yr", "2-4 yr", "4-6 yr", "6-8 yr", "8+ yr"]:
    print(f"  {band}: {tenure_bands.get(band, 0)}")

# --- Starting position diversity ---
start_counter = Counter(s["startingPosition"] for s in stories)
print(f"\nStarting Position Diversity: {len(start_counter)} unique positions")

# --- Learning theme diversity ---
learn_counter = Counter(s["learningTheme"] for s in stories)
print(f"\nLearning Theme Diversity: {len(learn_counter)} unique themes")

# ---------------------------------------------------------------------------
# UNREALISTIC PATTERNS CHECK
# ---------------------------------------------------------------------------
print(f"\n{'='*80}")
print("UNREALISTIC PATTERNS CHECK")
print(f"{'='*80}")

issues_found = []

# Check 1: CEO must have longest tenure
ceo_story = next(s for s in stories if s["employeeId"] == ceo_pk)
max_tenure = max(tenures)
if ceo_story["tenureMonths"] < max_tenure:
    issues_found.append(f"CEO tenure ({ceo_story['tenureMonths']}m) < max ({max_tenure}m)")

# Check 2: Depth 0-1 should have tenure > 48 months on average
d01_tenures = [s["tenureMonths"] for s in stories if s["hierarchyDepth"] <= 1]
avg_d01 = sum(d01_tenures) / len(d01_tenures) if d01_tenures else 0
print(f"  Avg tenure depth 0-1: {avg_d01:.0f} months")
if avg_d01 < 36:
    issues_found.append(f"Senior leaders (depth 0-1) avg tenure too low: {avg_d01:.0f}m < 36m")

# Check 3: Depth 5-6 should have tenure < 60 months on average
d56_tenures = [s["tenureMonths"] for s in stories if s["hierarchyDepth"] >= 5]
avg_d56 = sum(d56_tenures) / len(d56_tenures) if d56_tenures else 0
print(f"  Avg tenure depth 5-6: {avg_d56:.0f} months")
if avg_d56 > 48:
    issues_found.append(f"Junior employees (depth 5-6) avg tenure too high: {avg_d56:.0f}m > 48m")

# Check 4: No employee has promotion count > tenure years
over_promo = [s for s in stories if s["promotionCount"] > s["tenureMonths"] / 12 + 2]
print(f"  Employees with unrealistic promotion count: {len(over_promo)}")
if over_promo:
    issues_found.append(f"{len(over_promo)} employees have too many promotions for tenure")
    for s in over_promo[:5]:
        print(f"    PK={s['employeeId']} tenure={s['tenureMonths']}m promos={s['promotionCount']}")

# Check 5: Every employee has at least 1 mistake theme
no_mistake = [s for s in stories if not s["mistakeThemes"]]
print(f"  Employees with no mistake theme: {len(no_mistake)}")
if no_mistake:
    issues_found.append(f"{len(no_mistake)} employees have no mistake theme")

# Check 6: Executives (depth 0-1, depth 2 for Head_of_*) should not have "Not Identified" succession
exec_not_identified = [s for s in stories if s["hierarchyDepth"] <= 1 and s["successionPotential"] == "Not Identified"]
print(f"  Executives with 'Not Identified' succession: {len(exec_not_identified)}")
if exec_not_identified:
    issues_found.append(f"{len(exec_not_identified)} executives have 'Not Identified' succession potential")
    for s in exec_not_identified:
        print(f"    PK={s['employeeId']} {s['name']}")

# Check 7: Probation employees (< 6 months) should have 0 promotions
probation_over_promo = [s for s in stories if s["tenureMonths"] < 6 and s["promotionCount"] > 0]
print(f"  New hires (< 6m) with promotions: {len(probation_over_promo)}")
if probation_over_promo:
    issues_found.append(f"{len(probation_over_promo)} new hires have promotions")

# Check 8: Retention risk "High" for > 30% would be unrealistic
high_ret = ret_counter.get("High", 0)
high_ret_pct = high_ret / 150 * 100
print(f"  High retention risk: {high_ret} ({high_ret_pct:.1f}%)")
if high_ret_pct > 30:
    issues_found.append(f"High retention risk too common: {high_ret_pct:.1f}% > 30%")

# Check 9: Tenure monotonicity (higher depth = lower tenure on average)
depth_avg_tenure = {}
for d in sorted(depth_dist.keys()):
    d_tenures = [s["tenureMonths"] for s in stories if s["hierarchyDepth"] == d]
    depth_avg_tenure[d] = sum(d_tenures) / len(d_tenures) if d_tenures else 0
print(f"\n  Avg tenure by depth:")
for d, avg in sorted(depth_avg_tenure.items()):
    print(f"    Level {d}: {avg:.0f} months")
# Check if monotonic decreasing
prev = float("inf")
non_mono = False
for d in sorted(depth_avg_tenure.keys()):
    if depth_avg_tenure[d] > prev + 1:
        non_mono = True
    prev = depth_avg_tenure[d]
if non_mono:
    issues_found.append("Tenure not monotonically decreasing with depth")

# Check 10: Every dept has diversity in starting positions
dept_start_diversity = defaultdict(set)
for s in stories:
    dept_start_diversity[s["department"]].add(s["startingPosition"])
low_diversity_depts = [d for d, starts in dept_start_diversity.items() if len(starts) < 2]
print(f"\n  Departments with < 2 unique starting positions: {len(low_diversity_depts)}")
for d in low_diversity_depts:
    print(f"    {d}: {dept_start_diversity[d]}")

# --- Print sample stories ---
print(f"\n{'='*80}")
print("SAMPLE STORIES (first 12 employees)")
print(f"{'='*80}")
for s in stories[:12]:
    print(f"\n  PK={s['employeeId']:03d} | {s['name']} | {s['jobTitle']}")
    print(f"    Dept: {s['department']} | LV={s['hierarchyDepth']}")
    print(f"    Join: {s['joinDate']} | Tenure: {s['tenureMonths']}m")
    print(f"    Start: {s['startingPosition']} → {s['jobTitle']} (since {s['currentPositionStartDate']})")
    print(f"    Promotions: {s['promotionCount']}")
    print(f"    Arc: {s['careerArcSummary']}")
    print(f"    Strength: {s['mainStrength']} | Weakness: {s['mainWeakness']}")
    print(f"    Mistake: {', '.join(s['mistakeThemes'])}")
    print(f"    Learning: {s['learningTheme']}")
    print(f"    Retention: {s['retentionRisk']} | Succession: {s['successionPotential']}")

# --- Final verdict ---
print(f"\n{'='*80}")
print("FINAL VERDICT")
print(f"{'='*80}")
if issues_found:
    print(f"⚠ {len(issues_found)} UNREALISTIC PATTERNS DETECTED:")
    for i, iss in enumerate(issues_found, 1):
        print(f"  {i}. {iss}")
else:
    print("✓ ALL PATTERNS REALISTIC — No issues detected")

print(f"\nOutput written to: {OUTPUT}")
print(f"{'='*80}")