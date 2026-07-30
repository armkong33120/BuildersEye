#!/usr/bin/env python3
"""Generate IT Asset, Ticket, License, Salary, Attendance AND 11 HCM datasets + LOOP 24 Company Data for 150 employees."""
import json, random, os
from pathlib import Path

random.seed(20260707)
APP_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = APP_ROOT / "src" / "data"

identity = json.loads((DATA_DIR / "identity-graph.json").read_text("utf-8"))
employees = identity["identities"]

EXECUTIVE_PKS = set()
MANAGER_PKS = set()
IT_PKS = set()
DESIGNER_PKS = set()
ENGINEERING_PKS = set()
SALES_PKS = set()
for e in employees:
    pk = e["pk"]
    dept = e.get("department", "")
    title = e.get("jobTitle", "")
    if dept == "Executive": EXECUTIVE_PKS.add(pk)
    if "Manager" in title or "Head" in title or "Director" in title or "Chief" in title: MANAGER_PKS.add(pk)
    if dept == "IT": IT_PKS.add(pk)
    if dept == "Design & Architecture" or "Design" in title: DESIGNER_PKS.add(pk)
    if dept == "Engineering & Construction": ENGINEERING_PKS.add(pk)
    if dept == "Sales": SALES_PKS.add(pk)

# ──────── IT Assets ────────
it_assets = []
for e in employees:
    pk = e["pk"]
    if pk in EXECUTIVE_PKS:
        it_assets.append({"employeeId": pk, "Asset_Type": "Notebook", "Brand": "Dell Latitude 9450", "Cost_THB": 60000, "Status": "Active"})
        it_assets.append({"employeeId": pk, "Asset_Type": "Tablet", "Brand": "iPad Pro 13-inch", "Cost_THB": 30000, "Status": "Active"})
        it_assets.append({"employeeId": pk, "Asset_Type": "Mobile Phone", "Brand": "iPhone 16 Pro Max", "Cost_THB": 40000, "Status": "Active"})
    elif pk in IT_PKS:
        it_assets.append({"employeeId": pk, "Asset_Type": "Notebook", "Brand": "MacBook Pro 16-inch", "Cost_THB": 60000, "Status": "Active"})
        it_assets.append({"employeeId": pk, "Asset_Type": "Monitor 1", "Brand": "Dell UltraSharp U2723QE", "Cost_THB": 5000, "Status": "Active"})
        it_assets.append({"employeeId": pk, "Asset_Type": "Monitor 2", "Brand": "Dell UltraSharp U2723QE", "Cost_THB": 5000, "Status": "Active"})
    else:
        it_assets.append({"employeeId": pk, "Asset_Type": "Notebook", "Brand": "Dell Latitude 5450", "Cost_THB": 25000, "Status": "Active"})

# ──────── LOOP 24 PATCH 1: Software Licenses with Real Thai Pricing ────────
LICENSE_COSTS = {
    "Microsoft 365 Business Standard": 448,
    "Adobe Creative Cloud": 4080,
    "GitHub Copilot": 665,
    "AutoCAD": 4750,
    "AutoCAD LT": 1340,
}
sw_licenses = []
for e in employees:
    pk = e["pk"]
    dept = e.get("department", "")
    sw_licenses.append({"employeeId": pk, "License_Name": "Microsoft 365 Business Standard", "Status": "Active", "Cost_Per_Seat_THB": LICENSE_COSTS["Microsoft 365 Business Standard"]})
    if pk in DESIGNER_PKS:
        sw_licenses.append({"employeeId": pk, "License_Name": "Adobe Creative Cloud", "Status": "Active", "Cost_Per_Seat_THB": LICENSE_COSTS["Adobe Creative Cloud"]})
        sw_licenses.append({"employeeId": pk, "License_Name": "AutoCAD LT", "Status": "Active", "Cost_Per_Seat_THB": LICENSE_COSTS["AutoCAD LT"]})
    if pk in IT_PKS:
        sw_licenses.append({"employeeId": pk, "License_Name": "GitHub Copilot", "Status": "Active", "Cost_Per_Seat_THB": LICENSE_COSTS["GitHub Copilot"]})
    if pk in ENGINEERING_PKS:
        sw_licenses.append({"employeeId": pk, "License_Name": "AutoCAD", "Status": "Active", "Cost_Per_Seat_THB": LICENSE_COSTS["AutoCAD"]})

# ──────── IT Tickets ────────
TICKET_ISSUES = ["Forgot Password / Account Locked", "Broken Mouse / Keyboard", "Monitor Not Displaying", "WiFi Connection Issue", "Printer Not Working", "Software Installation Request", "VPN Connection Failed", "Email Not Syncing", "Laptop Overheating", "File Share Access Denied"]
TICKET_STATUSES = ["Resolved", "Resolved", "Resolved", "In Progress", "Pending"]
it_tickets = []
for e in employees:
    pk = e["pk"]
    num_tickets = random.choices([0, 1, 2, 3], weights=[30, 40, 20, 10])[0]
    for _ in range(num_tickets):
        it_tickets.append({"employeeId": pk, "Ticket_Issue": random.choice(TICKET_ISSUES), "Status": random.choice(TICKET_STATUSES)})

# ──────── Salary ────────
salary_history = []
for e in employees:
    pk = e["pk"]
    if pk in EXECUTIVE_PKS: base = random.randint(150000, 300000)
    elif pk in MANAGER_PKS: base = random.randint(80000, 120000)
    elif pk in IT_PKS: base = random.randint(50000, 100000)
    else: base = random.randint(20000, 40000)
    salary_history.append({"employeeId": pk, "Base_Salary": base, "Bonus_Months": random.randint(1, 3), "Increase_Percent": random.randint(2, 7)})

# ──────── Attendance ────────
attendance = []
for e in employees:
    pk = e["pk"]
    attendance.append({"employeeId": pk, "Sick_Leave_Days": random.randint(0, 10), "Personal_Leave_Days": random.randint(0, 5), "Late_Arrivals": random.randint(0, 20)})

# ──────── 360 Feedback ────────
FEEDBACK_TEMPLATES = {
    "Manager": ["Excellent leadership. Drives results consistently.", "Needs to improve communication with cross-functional teams.", "Very strategic thinker. Great at mentoring juniors.", "Sometimes micromanages — should delegate more."],
    "Peer": ["Great collaborator, always willing to help.", "Sometimes misses deadlines due to overcommitting.", "Very reliable and detail-oriented.", "Could improve on giving constructive feedback."],
    "Subordinate": ["Supportive manager, empowers the team.", "Too hands-off — needs more guidance on complex tasks.", "Fair and transparent in performance reviews.", "Great mentor, always has time for 1-on-1s."],
}
feedback_360 = []
for e in employees:
    pk = e["pk"]
    cat = "Subordinate" if pk in MANAGER_PKS else ("Manager" if pk in EXECUTIVE_PKS else random.choice(["Manager", "Peer", "Subordinate"]))
    feedback_360.append({"employeeId": pk, "Reviewer_Type": cat, "Comment": random.choice(FEEDBACK_TEMPLATES[cat])})

# ──────── Skill Matrix ────────
CORE_SKILLS = ["Project Management", "Data Analysis", "Communication", "Python", "AutoCAD", "Excel", "Negotiation", "Public Speaking", "SQL", "Leadership"]
CERTS = ["PMP", "CPA", "CFA", "AWS Solutions Architect", "ITIL", "Six Sigma Green Belt", "LEED AP", "None", "CISSP", "Google Data Analytics"]
skill_matrix = []
for e in employees:
    pk = e["pk"]
    skill_matrix.append({"employeeId": pk, "Core_Skill": random.choice(CORE_SKILLS), "Language_Score_IELTS": round(random.uniform(4.0, 9.0), 1), "Certification": random.choice(CERTS)})

# ──────── Succession ────────
succession = []
for e in employees:
    pk = e["pk"]
    if pk in EXECUTIVE_PKS: flight_risk = random.randint(1, 5); readiness = "Ready Now"
    elif pk in MANAGER_PKS: flight_risk = random.randint(3, 8); readiness = random.choice(["Ready in 1-2 Yrs", "Ready Now"])
    else: flight_risk = random.randint(4, 10); readiness = random.choice(["Ready in 3-5 Yrs", "Ready in 1-2 Yrs", "Not Assessed"])
    succession.append({"employeeId": pk, "Flight_Risk_Pct": flight_risk * 10, "Impact_of_Loss": random.choice(["High", "Medium", "Low"]), "Readiness": readiness})

# ──────── Benefits ────────
benefits = []
for e in employees: benefits.append({"employeeId": e["pk"], "Medical_THB": random.randint(500, 25000), "Dental_THB": random.randint(0, 8000), "Wellness_THB": random.randint(0, 5000)})

# ──────── Expenses ────────
expenses = []
for e in employees:
    pk = e["pk"]
    if pk in EXECUTIVE_PKS: travel = random.randint(20000, 120000); entertain = random.randint(5000, 50000)
    elif pk in MANAGER_PKS: travel = random.randint(5000, 50000); entertain = random.randint(2000, 20000)
    else: travel = random.randint(0, 15000); entertain = random.randint(0, 5000)
    expenses.append({"employeeId": pk, "Travel_THB": travel, "Entertainment_THB": entertain, "Office_Supplies_THB": random.randint(200, 5000)})

# ──────── Grievances ────────
grievances = []
gripe_reasons = ["Discrimination complaint", "Harassment report", "Unfair workload distribution", "Conflict with manager", "Pay dispute"]
for e in employees:
    if random.random() < 0.06: grievances.append({"employeeId": e["pk"], "Complaint_Type": random.choice(gripe_reasons), "Status": random.choice(["Investigated", "Pending", "Resolved"])})

# ──────── Compliance ────────
COMPLIANCE_ITEMS = ["PDPA", "Cybersecurity Awareness", "Code of Conduct", "Anti-Bribery", "Health & Safety"]
compliance = []
for e in employees:
    for item in COMPLIANCE_ITEMS: compliance.append({"employeeId": e["pk"], "Mandate": item, "Status": random.choice(["Passed", "Passed", "Passed", "Pending"])})

# ──────── Onboarding ────────
BUDDY_NAMES = ["Alice Wong", "Bob Tan", "Charlie Lim", "Diana Chen", "Evan Lee", "Fiona Ng", "George Teo", "Hannah Koh"]
onboarding = []; engagement = []; security = []; timesheet = []
ZONES = ["Zone A - Executive Wing", "Zone B - Office", "Zone C - Operations", "Zone D - Warehouse"]
for e in employees:
    pk = e["pk"]
    onboarding.append({"employeeId": pk, "Culture_Fit_Score": random.randint(3, 5), "Interview_Score": random.randint(65, 98), "Buddy_Name": random.choice(BUDDY_NAMES)})
    engagement.append({"employeeId": pk, "eNPS": random.randint(1, 10), "Burnout_Risk": random.choice(["Low", "Low", "Low", "Medium", "Medium", "High"])})
    security.append({"employeeId": pk, "Access_Zone": random.choice(ZONES), "Parking_Slot": f"P-{random.randint(1, 200)}", "Last_Badge_Swipe": f"{random.randint(6,10):02d}:{random.randint(0,59):02d}"})
    timesheet.append({"employeeId": pk, "Billable_Hours_Pct": random.randint(60, 95), "Admin_Hours_Pct": 0})
for t in timesheet: t["Admin_Hours_Pct"] = 100 - t["Billable_Hours_Pct"]

# ════════════════════════════════════════════════════════════
# LOOP 24 PART B: COMPANY-LEVEL DATA (5 new company files)
# ════════════════════════════════════════════════════════════

# ────── FILE 1: Product Catalog (20 records) ──────
product_catalog = [
    {"product_id": "PRD001", "product_name": "งานออกแบบสถาปัตยกรรม", "category": "Design Service", "owner_department": "Design & Architecture", "unit_price_thb": 800000, "unit": "โครงการ", "cost_rate_pct": 5.0, "is_active": True},
    {"product_id": "PRD002", "product_name": "งานออกแบบตกแต่งภายใน (Interior Design)", "category": "Design Service", "owner_department": "Design & Architecture", "unit_price_thb": 350000, "unit": "โครงการ", "cost_rate_pct": 5.5, "is_active": True},
    {"product_id": "PRD003", "product_name": "งานออกแบบโครงสร้าง (Structural Design)", "category": "Design Service", "owner_department": "Design & Architecture", "unit_price_thb": 600000, "unit": "โครงการ", "cost_rate_pct": 4.5, "is_active": True},
    {"product_id": "PRD004", "product_name": "BIM Consulting & Modeling", "category": "Consulting", "owner_department": "Design & Architecture", "unit_price_thb": 450000, "unit": "โครงการ", "cost_rate_pct": 6.0, "is_active": True},
    {"product_id": "PRD005", "product_name": "งานก่อสร้างบ้านพักอาศัย", "category": "Construction", "owner_department": "Engineering & Construction", "unit_price_thb": 25000, "unit": "ตร.ม.", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD006", "product_name": "งานก่อสร้างอาคารพาณิชย์", "category": "Construction", "owner_department": "Engineering & Construction", "unit_price_thb": 30000, "unit": "ตร.ม.", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD007", "product_name": "งานรีโนเวท/ปรับปรุงอาคาร", "category": "Construction", "owner_department": "Engineering & Construction", "unit_price_thb": 15000, "unit": "ตร.ม.", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD008", "product_name": "งานระบบ MEP (ไฟฟ้า/ประปา/แอร์)", "category": "Construction", "owner_department": "Engineering & Construction", "unit_price_thb": 5000000, "unit": "โครงการ", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD009", "product_name": "งาน Fit-out สำนักงาน", "category": "Construction", "owner_department": "Engineering & Construction", "unit_price_thb": 12000, "unit": "ตร.ม.", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD010", "product_name": "ตรวจสอบรับประกัน (Warranty Inspection)", "category": "Warranty", "owner_department": "Customer Service & Warranty", "unit_price_thb": 25000, "unit": "ครั้ง", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD011", "product_name": "ซ่อมแซมฉุกเฉิน (Emergency Repair)", "category": "Warranty", "owner_department": "Customer Service & Warranty", "unit_price_thb": 80000, "unit": "ครั้ง", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD012", "product_name": "สัญญาบำรุงรักษารายปี (Maintenance Contract)", "category": "Maintenance", "owner_department": "Customer Service & Warranty", "unit_price_thb": 300000, "unit": "ปี", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD013", "product_name": "จัดหาวัสดุก่อสร้าง (Material Sourcing)", "category": "Procurement", "owner_department": "Procurement & Warehouse", "unit_price_thb": 0, "unit": "ตามสัญญา", "cost_rate_pct": 8.0, "is_active": True},
    {"product_id": "PRD014", "product_name": "บริการให้เช่าเครื่องจักร/นั่งร้าน", "category": "Rental", "owner_department": "Procurement & Warehouse", "unit_price_thb": 150000, "unit": "เดือน", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD015", "product_name": "ระบบ Smart Home & IoT", "category": "IT Solution", "owner_department": "IT", "unit_price_thb": 1500000, "unit": "โครงการ", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD016", "product_name": "ระบบบริหารอาคาร (BMS)", "category": "IT Solution", "owner_department": "IT", "unit_price_thb": 2500000, "unit": "โครงการ", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD017", "product_name": "ที่ปรึกษาบริหารโครงการ (PM Consulting)", "category": "Consulting", "owner_department": "Engineering & Construction", "unit_price_thb": 200000, "unit": "เดือน", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD018", "product_name": "ประเมินราคา/ถอดแบบ (Cost Estimation)", "category": "Consulting", "owner_department": "Finance & Accounting", "unit_price_thb": 150000, "unit": "โครงการ", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD019", "product_name": "ตรวจสอบความปลอดภัย (Safety Audit)", "category": "Compliance", "owner_department": "Engineering & Construction", "unit_price_thb": 120000, "unit": "ครั้ง", "cost_rate_pct": 0, "is_active": True},
    {"product_id": "PRD020", "product_name": "ขอรับรองอาคารเขียว (Green Building Certification)", "category": "Compliance", "owner_department": "Design & Architecture", "unit_price_thb": 500000, "unit": "โครงการ", "cost_rate_pct": 0, "is_active": True},
]

# ────── FILE 2: Revenue by Product (240 records) ──────
QUARTERS = [f"{y}-Q{q}" for y in [2023, 2024, 2025] for q in [1, 2, 3, 4]]
PROD_REVENUE_PROFILE = {
    "PRD001": (2, 8, 800000, 5000000), "PRD002": (3, 10, 350000, 2000000),
    "PRD003": (1, 6, 600000, 4000000), "PRD004": (1, 5, 450000, 2500000),
    "PRD005": (1, 5, 500000, 40000000), "PRD006": (1, 4, 500000, 35000000),
    "PRD007": (1, 5, 300000, 20000000), "PRD008": (0, 2, 2000000, 10000000),
    "PRD009": (1, 4, 200000, 8000000), "PRD010": (5, 20, 25000, 500000),
    "PRD011": (3, 15, 80000, 1200000), "PRD012": (2, 8, 300000, 3000000),
    "PRD013": (1, 5, 200000, 5000000), "PRD014": (1, 4, 150000, 2500000),
    "PRD015": (0, 2, 1500000, 5000000), "PRD016": (0, 1, 2500000, 5000000),
    "PRD017": (1, 5, 200000, 1500000), "PRD018": (1, 4, 150000, 750000),
    "PRD019": (2, 6, 120000, 750000), "PRD020": (0, 2, 500000, 1500000),
}
revenue_by_product = []
for prod_id in sorted(PROD_REVENUE_PROFILE.keys()):
    min_u, max_u, min_rev, max_rev = PROD_REVENUE_PROFILE[prod_id]
    for q in QUARTERS:
        year = int(q.split("-")[0])
        growth = 1.0 + (year - 2023) * 0.06
        units = random.randint(min_u, max_u)
        revenue = int(random.uniform(min_rev, max_rev) * growth)
        cost_pct = next((p["cost_rate_pct"] for p in product_catalog if p["product_id"] == prod_id), 0) / 100
        cost = int(revenue * cost_pct) if cost_pct > 0 else int(revenue * (0.55 + random.uniform(0, 0.20)))
        margin = round((revenue - cost) / revenue * 100, 1) if revenue > 0 else 0
        revenue_by_product.append({"product_id": prod_id, "quarter": q, "units_sold": units, "revenue_thb": revenue, "cost_thb": cost, "profit_margin_pct": margin})

# ────── Get Sales department employees ──────
sales_emps = [e for e in employees if e["department"] == "Sales"]
sales_emp_ids = [e["pk"] for e in sales_emps]
sales_emp_codes = [e["code"] for e in sales_emps]

# ────── FILE 3: Customer Portfolio (40 records) ──────
CUSTOMER_DATA = [
    ("CUS001", "บริษัท แสนสิริ จำกัด (มหาชน)", "Real Estate Developer", 2014),
    ("CUS002", "บริษัท อนันดา ดีเวลลอปเม้นท์ จำกัด", "Real Estate Developer", 2015),
    ("CUS003", "บริษัท แลนด์ แอนด์ เฮ้าส์ จำกัด (มหาชน)", "Real Estate Developer", 2013),
    ("CUS004", "บริษัท พฤกษา เรียลเอสเตท จำกัด (มหาชน)", "Real Estate Developer", 2016),
    ("CUS005", "บริษัท เอพี ไทยแลนด์ จำกัด (มหาชน)", "Real Estate Developer", 2017),
    ("CUS006", "การเคหะแห่งชาติ", "Government", 2012),
    ("CUS007", "กรมโยธาธิการและผังเมือง", "Government", 2012),
    ("CUS008", "กระทรวงสาธารณสุข", "Government", 2014),
    ("CUS009", "องค์การบริหารส่วนจังหวัดชลบุรี", "Government", 2018),
    ("CUS010", "โรงพยาบาลบำรุงราษฎร์", "Healthcare", 2015),
    ("CUS011", "โรงพยาบาลกรุงเทพ", "Healthcare", 2016),
    ("CUS012", "โรงพยาบาลสมิติเวช", "Healthcare", 2019),
    ("CUS013", "โรงแรมดุสิตธานี", "Hospitality", 2014),
    ("CUS014", "โรงแรมเซ็นทารา แกรนด์", "Hospitality", 2017),
    ("CUS015", "โรงแรมอนันตรา", "Hospitality", 2020),
    ("CUS016", "บริษัท ปตท. จำกัด (มหาชน)", "Industrial", 2013),
    ("CUS017", "บริษัท ปูนซิเมนต์ไทย จำกัด (มหาชน)", "Industrial", 2013),
    ("CUS018", "บริษัท โตโยต้า มอเตอร์ ประเทศไทย จำกัด", "Industrial", 2015),
    ("CUS019", "บริษัท ซีพี ออลล์ จำกัด (มหาชน)", "Retail", 2014),
    ("CUS020", "เซ็นทรัลพัฒนา จำกัด (มหาชน)", "Retail", 2013),
    ("CUS021", "บริษัท เดอะมอลล์ กรุ๊ป จำกัด", "Retail", 2016),
    ("CUS022", "มหาวิทยาลัยอุบลราชธานี", "Education", 2015),
    ("CUS023", "จุฬาลงกรณ์มหาวิทยาลัย", "Education", 2014),
    ("CUS024", "มหาวิทยาลัยธรรมศาสตร์", "Education", 2017),
    ("CUS025", "บริษัท ศุภาลัย จำกัด (มหาชน)", "Real Estate Developer", 2015),
    ("CUS026", "เทศบาลนครเชียงใหม่", "Government", 2018),
    ("CUS027", "โรงแรม แมริออท มาร์คีส์ ควีนส์ พาร์ค", "Hospitality", 2019),
    ("CUS028", "บริษัท ทรู คอร์ปอเรชั่น จำกัด (มหาชน)", "Industrial", 2016),
    ("CUS029", "บริษัท ทางด่วนและรถไฟฟ้ากรุงเทพ จำกัด (มหาชน)", "Industrial", 2014),
    ("CUS030", "โรงพยาบาลศิริราช", "Healthcare", 2013),
    ("CUS031", "บริษัท อมตะ คอร์ปอเรชั่น จำกัด (มหาชน)", "Industrial", 2017),
    ("CUS032", "บริษัท วิศวกรรมธรณีและฐานราก จำกัด", "Industrial", 2021),
    ("CUS033", "โครงการพัฒนาที่อยู่อาศัยชุมชนคลองเตย", "Government", 2020),
    ("CUS034", "สนามบินสุวรรณภูมิ (ทอท.)", "Government", 2016),
    ("CUS035", "โรงแรม ดับเบิ้ลยู กรุงเทพ", "Hospitality", 2021),
    ("CUS036", "พาราไดซ์ พาร์ค - เอ็ม บี เค", "Retail", 2018),
    ("CUS037", "มหาวิทยาลัยเกษตรศาสตร์", "Education", 2019),
    ("CUS038", "โรงพยาบาลปิยะเวท", "Healthcare", 2020),
    ("CUS039", "บริษัท อิตาเลียนไทย ดีเวล๊อปเมนต์ จำกัด (มหาชน)", "Industrial", 2013),
    ("CUS040", "การทางพิเศษแห่งประเทศไทย", "Government", 2015),
]
customer_portfolio = []
for cid, cname, industry, since in CUSTOMER_DATA:
    am_pk = random.choice(sales_emp_ids)
    num_prods = random.randint(2, 5)
    prods = [p["product_id"] for p in random.sample(product_catalog, num_prods)]
    contract_val = random.randint(500000, 120000000)
    status = random.choice(["Active", "Active", "Active", "Completed", "On Hold"])
    customer_portfolio.append({
        "customer_id": cid, "customer_name": cname, "industry": industry,
        "contract_value_thb": contract_val, "status": status,
        "account_manager_emp_id": am_pk,
        "products_purchased": prods,
        "relationship_since_year": since,
        "project_ids": []
    })

# ────── FILE 4: Department P&L (36 records) ──────
# Calculate real headcount costs from salary data
dept_headcount_cost = {}
for e in employees:
    pk = e["pk"]
    dept = e["department"]
    for s in salary_history:
        if s["employeeId"] == pk:
            dept_headcount_cost[dept] = dept_headcount_cost.get(dept, 0) + s["Base_Salary"] * 12 + s["Base_Salary"] * s["Bonus_Months"]
            break

REVENUE_DEPTS = {
    "Engineering & Construction": (60000000, 80000000, 0.70, 3000000, 5000000, 0.05, 0.12),
    "Design & Architecture": (10000000, 18000000, 0.15, 1000000, 2000000, 0.20, 0.35),
    "Customer Service & Warranty": (5000000, 10000000, 0.30, 1000000, 2000000, 0.10, 0.20),
    "IT": (3000000, 6000000, 0.25, 1000000, 2000000, 0.10, 0.20),
    "Procurement & Warehouse": (8000000, 15000000, 0.75, 1000000, 2000000, 0.05, 0.10),
    "Finance & Accounting": (2000000, 4000000, 0.05, 500000, 1000000, 0.15, 0.25),
}
COST_CENTER_DEPTS = {
    "Executive": (3000000, 5000000), "Sales": (4000000, 7000000),
    "Marketing": (2000000, 4000000), "HR & Admin": (1000000, 2000000),
    "Legal": (500000, 800000), "Office Support": (300000, 500000),
}

dept_pnl = []
for dept_name in sorted(set(e["department"] for e in employees)):
    for year in [2023, 2024, 2025]:
        growth = 1.0 + (year - 2023) * 0.05
        hc = int(dept_headcount_cost.get(dept_name, 0))
        if dept_name in REVENUE_DEPTS:
            rev_low, rev_high, cogs_pct, op_low, op_high, marg_low, marg_high = REVENUE_DEPTS[dept_name]
            revenue = int(random.randint(rev_low, rev_high) * growth)
            cogs = int(revenue * cogs_pct)
            operating = int(random.randint(op_low, op_high) * growth)
            net = revenue - cogs - hc - operating
            margin = round(net / revenue * 100, 1) if revenue > 0 else 0
            budget = int((hc + cogs + operating) * random.uniform(1.10, 1.15))
        else:
            op_low, op_high = COST_CENTER_DEPTS.get(dept_name, (300000, 500000))
            revenue = 0; cogs = 0
            operating = int(random.randint(op_low, op_high) * growth)
            net = -hc - operating
            margin = 0
            budget = int((hc + operating) * random.uniform(1.10, 1.15))
        dept_pnl.append({"department": dept_name, "year": year, "allocated_budget_thb": budget, "revenue_thb": revenue, "headcount_cost_thb": hc, "cogs_thb": cogs, "operating_cost_thb": operating, "net_profit_thb": net, "profit_margin_pct": margin})

# ────── FILE 5: Sales Pipeline (30 records) ──────
DEAL_NAMES = [
    "โครงการ Condo ริมแม่น้ำ เจ้าพระยา", "รีโนเวทโรงแรม พัทยา Phase 2", "ก่อสร้างโรงพยาบาลเอกชน ระยอง",
    "ออกแบบ-สร้าง อาคารสำนักงาน 15 ชั้น", "ปรับปรุงระบบ MEP โรงแรม ภูเก็ต", "พัฒนา Smart Factory อมตะนคร",
    "Fit-out สำนักงานใหญ่ SCG", "ก่อสร้างโกดังสินค้า ลาดกระบัง", "ออกแบบ Interior โรงแรม เชียงใหม่",
    "วางระบบ BMS อาคารจอดรถ สุวรรณภูมิ", "ก่อสร้างหอพักนักศึกษา ม.อุบลฯ",
    "รีโนเวทศูนย์การค้า Central Rama 9", "ขยายโรงงานผลิตชิ้นส่วนยานยนต์", "ก่อสร้างอาคารเรียน มหาวิทยาลัยธรรมศาสตร์",
    "ออกแบบสวนสาธารณะชุมชนคลองเตย", "ก่อสร้าง Data Center บางนา", "Fit-out Co-Working Space 5 สาขา",
    "ประมูลสร้างสะพานข้ามแม่น้ำท่าจีน", "ระบบ BIM สำหรับโครงการรถไฟฟ้าสายสีส้ม", "ก่อสร้างสถานีดับเพลิง 3 แห่ง",
    "ปรับปรุงระบบประปาเทศบาลนครเชียงใหม่", "ก่อสร้าง Resort 5 ดาว เกาะสมุย", "ระบบ Solar Rooftop สำหรับโรงงาน",
    "รีโนเวทอาคารจอดรถ โรงพยาบาลศิริราช", "ออกแบบ-สร้าง Premium Villa เขาใหญ่", "ประมูลก่อสร้างสนามบินเบตง",
    "ระบบ Smart Building อาคารรัฐสภาใหม่", "Fit-out Flagship Store เซ็นทรัลเวิลด์", "ตรวจสอบโครงสร้างสะพานพระราม 8",
    "Green Building Certification อาคาร SET",
]
sales_pipeline = []
for i in range(30):
    cid = f"CUS{random.randint(1,40):03d}"
    stage = random.choice(["Prospecting", "Qualified", "Proposal", "Negotiation"])
    prob_map = {"Prospecting": 10, "Qualified": 30, "Proposal": 50, "Negotiation": 70}
    sales_pipeline.append({
        "deal_id": f"DEAL{i+1:03d}", "deal_name": random.choice(DEAL_NAMES), "customer_id": cid,
        "owner_emp_id": random.choice(sales_emp_ids),
        "products": [p["product_id"] for p in random.sample(product_catalog, random.randint(1, 3))],
        "deal_value_thb": random.randint(1000000, 50000000), "stage": stage,
        "probability_pct": prob_map[stage],
        "expected_close_date": f"2025-{random.randint(1,12):02d}-{random.randint(1,28):02d}",
        "created_date": f"2024-{random.randint(1,12):02d}-{random.randint(1,28):02d}",
    })

# ────── FILE 6: Company Operating Expenses (648 records) ──────
MONTHS = [f"{y}-{m:02d}" for y in [2023, 2024, 2025] for m in range(1, 13)]
FIXED_COSTS = [
    ("ค่าเช่าสำนักงาน", "Shared", 350000, "บริษัท ศุภาลัย จำกัด (มหาชน)"),
    ("ค่าเช่าที่จอดรถ", "Shared", 45000, "บริษัท ศุภาลัย จำกัด (มหาชน)"),
    ("ค่าอินเทอร์เน็ต (Leased Line + WiFi)", "Shared", 25000, "บริษัท ทรู อินเทอร์เน็ต จำกัด"),
    ("ค่าประกันอาคาร/ทรัพย์สิน", "Shared", 18000, "บริษัท เอไอเอ จำกัด (มหาชน)"),
    ("ค่าบริการรักษาความปลอดภัย (รปภ.)", "Shared", 60000, "บริษัท การ์ดฟอร์ซ ซีเคียวริตี้ จำกัด"),
    ("ค่าทำความสะอาด", "Shared", 35000, "บริษัท พีเอส คลีนนิ่ง จำกัด"),
]
VARIABLE_COSTS = [
    ("ค่าไฟฟ้า", "Shared", 85000, 120000), ("ค่าน้ำประปา", "Shared", 8000, 15000),
    ("ค่าน้ำมันรถบริษัท", "Shared", 40000, 80000), ("ค่าโทรศัพท์/มือถือองค์กร", "Shared", 15000, 25000),
    ("ค่าขนส่ง/Messenger", "Shared", 10000, 20000),
]
DEPT_COSTS = [
    ("ค่ายิง Ad ดิจิทัล (Google/Facebook/LINE)", "Marketing", 80000, 200000, False),
    ("ค่าจัดอีเวนต์/นิทรรศการ", "Marketing", 0, 150000, True),
    ("ค่าลิขสิทธิ์/สมาชิกระบบ Cloud (AWS/Azure)", "IT", 30000, 50000, False),
    ("ค่าบำรุงรักษาเครื่องจักร/เครื่องมือช่าง", "Engineering & Construction", 20000, 60000, False),
    ("ค่าตรวจสอบบัญชี/ที่ปรึกษากฎหมาย", "Finance & Accounting", 50000, 80000, False),
    ("ค่าฝึกอบรมพนักงาน", "HR & Admin", 15000, 40000, False),
]
operating_expenses = []
for month in MONTHS:
    m = int(month.split("-")[1])
    for cat, dept, amt, vendor in FIXED_COSTS:
        operating_expenses.append({"month": month, "category": cat, "department": dept, "amount_thb": amt, "vendor": vendor, "payment_status": "Paid"})
    for cat, dept, lo, hi in VARIABLE_COSTS:
        amt = int(random.uniform(lo, hi))
        operating_expenses.append({"month": month, "category": cat, "department": dept, "amount_thb": amt, "vendor": "Various", "payment_status": random.choice(["Paid", "Paid", "Paid", "Pending"])})
    for cat, dept, lo, hi, seasonal in DEPT_COSTS:
        if seasonal and m not in [3, 6, 9, 11]:
            amt = 0
        else:
            amt = int(random.uniform(lo, hi))
        if amt > 0:
            operating_expenses.append({"month": month, "category": cat, "department": dept, "amount_thb": amt, "vendor": "Various", "payment_status": random.choice(["Paid", "Paid", "Paid", "Pending"])})

# ────────────────────────────────────────────────
# Write ALL output files
# ────────────────────────────────────────────────
outputs = {
    "it-assets.json": it_assets,
    "it-tickets.json": it_tickets,
    "software-licenses.json": sw_licenses,
    "salary-history.json": salary_history,
    "attendance-record.json": attendance,
    "feedback-360.json": feedback_360,
    "skill-matrix.json": skill_matrix,
    "succession-planning.json": succession,
    "benefit-claims.json": benefits,
    "expense-reports.json": expenses,
    "grievance-log.json": grievances,
    "compliance-mandates.json": compliance,
    "onboarding-journey.json": onboarding,
    "employee-engagement.json": engagement,
    "physical-security.json": security,
    "timesheet-log.json": timesheet,
    "product-catalog.json": product_catalog,
    "revenue-by-product.json": revenue_by_product,
    "customer-portfolio.json": customer_portfolio,
    "department-pnl.json": dept_pnl,
    "sales-pipeline.json": sales_pipeline,
    "company-operating-expenses.json": operating_expenses,
}

for fname, data in outputs.items():
    path = DATA_DIR / fname
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  Wrote {fname} ({len(data)} records)")

print("\nAdvanced data generation complete! (22 datasets)")