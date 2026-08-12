#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""audit_realism.py — 12-department realism audit for the BuildersEye registry.

Usage:
    python3 scripts/realism/audit_realism.py [--report] [--json-out path]

Checks, per the Dev Manager's mission brief, validate each department from the
line-manager's viewpoint, then emit:
    * .data/audit_realism.json           (structured results)
    * .data/data_realism_gap_report.md   (markdown gap report — required deliverable)

Criterion semantics:
    coverage = matched_employees / employees_in_department
    A check PASSES when coverage >= threshold (see CHECKS below).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import realism_common as rc

# ── department → (criterion list) ────────────────────────────────────────
# Each criterion: (id, sheets, fields, keywords, threshold, note)
# text to match = concatenation of the given fields across the given sheets.
CHECKS = {
    "Executive": [
        ("EXEC-CAC", ["KPI_OKR_History"], ["managerFeedback", "improvementPlan", "strongArea"],
         ["CAC", "Customer Acquisition", "ค่าหาลูกค้า", "กรรมสิทธิ์", "ยอดโอน", "โอน"],
         0.8, "KPI/OKR ต้องพูดถึงการลด CAC และเป้ายอดโอนกรรมสิทธิ์"),
        ("EXEC-TRANSFER", ["KPI_OKR_History", "Project_History"], ["managerFeedback", "contributionSummary"],
         ["โอน", "กรรมสิทธิ์", "ส่งมอบ", "ยอดปิดการขาย"], 0.8, "เป้ายอดโอนกรรมสิทธิ์ (transfer target)"),
    ],
    "Sales": [
        ("SALES-REJECT", ["KPI_OKR_History", "Project_History", "Collaboration_Network"],
         ["managerFeedback", "mistakeIssue", "recoveryAction", "individualOutcome", "conflictSummary"],
         ["กู้", "ไม่ผ่าน", "Reject", "แบงก์", "Mortgage", "สกรีน"], 0.7,
         "ปัญหาลูกค้ากู้แบงก์ไม่ผ่าน (Mortgage Rejection)"),
        ("SALES-DROP", ["KPI_OKR_History", "Project_History", "Collaboration_Network"],
         ["managerFeedback", "mistakeIssue", "conflictSummary"],
         ["ทิ้งดาวน์", "ดาวน์", "จอง", "พักจอง"], 0.5, "เคสทิ้งดาวน์ / ยกเลิกการจอง"),
        ("SALES-SITEVISIT", ["KPI_OKR_History"], ["managerFeedback", "improvementPlan", "strongArea"],
         ["Site Visit", "ชมโครงการ", "พาลูกค้า", "เข้าชม"], 0.8, "KPI เรื่องจำนวน Site Visits"),
    ],
    "Marketing": [
        ("MKT-FB", ["Expense_Reports", "KPI_OKR_History"], ["Description", "Category", "Notes", "managerFeedback"],
         ["Facebook", "Meta", "Ads"], 0.7, "เบิกค่า Facebook Ads"),
        ("MKT-TIKTOK", ["Expense_Reports", "KPI_OKR_History"], ["Description", "Category", "Notes", "managerFeedback"],
         ["TikTok", "TikTok Ads"], 0.6, "ยิง TikTok"),
        ("MKT-EXPO", ["Expense_Reports", "KPI_OKR_History"], ["Description", "Category", "Notes", "managerFeedback"],
         ["มหกรรม", "บูธ", "งานบ้านและคอนโด", "Home & Condo", "Expo"], 0.6, "ออกบูธมหกรรมบ้านและคอนโด"),
    ],
    "Design & Architecture": [
        ("DES-SHOPDRAW", ["Project_History", "KPI_OKR_History"], ["mistakeIssue", "managerFeedback", "recoveryAction"],
         ["Shop Drawing", "ดิ่ง", "ไม่ตรง"], 0.6, "แบบ Shop Drawing ไม่ตรงดิ่ง"),
        ("DES-BOQ", ["Project_History", "KPI_OKR_History"], ["mistakeIssue", "managerFeedback", "recoveryAction"],
         ["BOQ", "ปริมาณ", "พลาด", "คลาดเคลื่อน"], 0.6, "คำนวณ BOQ พลาด"),
        ("DES-CHANGE", ["Project_History", "KPI_OKR_History"], ["mistakeIssue", "managerFeedback", "recoveryAction"],
         ["แก้แบบ", "แปลน", "ดีเลย์", "delay", "ลูกค้าขอ"], 0.6, "ลูกค้าขอแก้แบบจนงานดีเลย์"),
    ],
    "Engineering & Construction": [
        ("ENG-OT", ["Timesheet_Log", "KPI_OKR_History"], ["Notes", "Overtime_Hours", "managerFeedback"],
         ["OT", "เทปูน", "ข้ามคืน", "คอนกรีต"], 0.6, "ทำ OT ข้ามคืนเทปูน"),
        ("ENG-SUBCON", ["Project_History", "Collaboration_Network", "KPI_OKR_History"],
         ["mistakeIssue", "conflictSummary", "managerFeedback"],
         ["ผรห.", "ผู้รับเหมา", "ทิ้งงาน", "ซัพคอน"], 0.6, "ผู้รับเหมาช่วงทิ้งงาน"),
        ("ENG-CPAC", ["Project_History", "Collaboration_Network", "KPI_OKR_History"],
         ["mistakeIssue", "conflictSummary", "managerFeedback"],
         ["CPAC", "ปูน", "คอนกรีต", "เข้าหน้างานช้า"], 0.5, "ปูน CPAC เข้าหน้างานช้า"),
        ("ENG-LABOR", ["Project_History", "KPI_OKR_History"], ["mistakeIssue", "managerFeedback", "recoveryAction"],
         ["แรงงาน", "ต่างด้าว", "ขาดแคลน", "แรงงานขาด"], 0.5, "ขาดแคลนแรงงานต่างด้าว"),
    ],
    "Procurement & Warehouse": [
        ("PROC-STEEL", ["Grievance_Log", "Collaboration_Network", "KPI_OKR_History"],
         ["Description", "Complaint_Type", "Summary", "conflictSummary", "managerFeedback"],
         ["เหล็ก", "เส้น", "ช้า", "ล่าช้า", "ซัพพลายเออร์"], 0.7, "ซัพพลายเออร์ส่งเหล็กเส้นช้า"),
        ("PROC-TILE", ["Grievance_Log", "Collaboration_Network", "KPI_OKR_History"],
         ["Description", "Complaint_Type", "Summary", "conflictSummary", "managerFeedback"],
         ["กระเบื้อง", "สีเพี้ยน", "Lot", "ล็อต"], 0.6, "กระเบื้อง Lot สีเพี้ยน"),
    ],
    "Customer Service & Warranty": [
        ("CS-LEAK", ["IT_Ticket_Log", "Project_History", "KPI_OKR_History"],
         ["Ticket_Issue", "Description", "Summary", "mistakeIssue", "managerFeedback"],
         ["น้ำรั่ว", "หน้าต่าง", "อลูมิเนียม", "ซึม"], 0.6, "น้ำรั่วซึมจากขอบหน้าต่างอลูมิเนียม"),
        ("CS-TILE", ["IT_Ticket_Log", "Project_History", "KPI_OKR_History"],
         ["Ticket_Issue", "Description", "Summary", "mistakeIssue", "managerFeedback"],
         ["กระเบื้อง", "ร่อน", "โปร่ง"], 0.5, "กระเบื้องร่อน/โปร่ง"),
        ("CS-CRACK", ["IT_Ticket_Log", "Project_History", "KPI_OKR_History"],
         ["Ticket_Issue", "Description", "Summary", "mistakeIssue", "managerFeedback"],
         ["ผนังร้าว", "ร้าว", "Latent"], 0.6, "ผนังร้าว (Latent Defect)"),
        ("CS-LAMINATE", ["IT_Ticket_Log", "Project_History", "KPI_OKR_History"],
         ["Ticket_Issue", "Description", "Summary", "mistakeIssue", "managerFeedback"],
         ["ลามิเนต", "ยวบ", "พื้น"], 0.4, "พื้นลามิเนตยวบ"),
    ],
    "Finance & Accounting": [
        ("FIN-ADV", ["Expense_Reports", "Salary_History", "KPI_OKR_History"],
         ["Description", "Category", "Notes", "managerFeedback"],
         ["Advance", "เบิกล่วงหน้า", "เบิก", "ล่าช้า", "เงินทดรอง"], 0.7, "ปัญหาเบิก Advance หน้างานล่าช้า"),
        ("FIN-ENT", ["Expense_Reports", "KPI_OKR_History"], ["Description", "Category", "Notes", "managerFeedback"],
         ["รับรอง", "ลูกค้า", "มื้อ", "ค่ารับรอง"], 0.6, "ค่ารับรองลูกค้า"),
        ("FIN-KYS", ["Salary_History", "Expense_Reports", "KPI_OKR_History"],
         ["Notes", "Description", "managerFeedback"],
         ["กยศ.", "กองทุนเงินให้กู้ยืม", "หัก"], 0.5, "หักหนี้ กยศ. (student-loan garnishment)"),
    ],
    "HR & Admin": [
        ("HR-SICKPOL", ["Attendance_Record", "Warning_Disciplinary_History", "KPI_OKR_History"],
         ["Notes", "summary", "managerFeedback"],
         ["ลาป่วย", "การเมือง", "ขอลา", "sick"], 0.5, "ลาป่วยการเมือง (politically-motivated sick leave)"),
        ("HR-LATE", ["Attendance_Record", "Warning_Disciplinary_History"],
         ["Notes", "summary"],
         ["สาย", "ฝน", "รถติด", "Late"], 0.6, "มาสายเพราะฝนตก/รถติด"),
        ("HR-CAMP", ["Warning_Disciplinary_History", "Grievance_Log"],
         ["summary", "rootCause", "Description"],
         ["ทะเลาะ", "แคมป์", "คนงาน", "มีปากเสียง"], 0.5, "ทะเลาะกันในแคมป์คนงาน"),
        ("HR-NEPO", ["Warning_Disciplinary_History", "KPI_OKR_History"],
         ["summary", "rootCause", "managerFeedback"],
         ["เส้น", "Nepotism", "ญาติ", "เด็กเส้น", "คนรู้จัก"], 0.4, "ปัญหาเด็กเส้น (Nepotism)"),
        ("HR-SSO", ["Salary_History", "Attendance_Record"],
         ["Notes", "Description"],
         ["ประกันสังคม", "SSO", "หัก"], 0.5, "โดนหักประกันสังคม (SSO)"),
    ],
    "IT": [
        ("IT-ASSET", ["IT_Asset_Register"], ["Brand", "Asset_Type", "Model"],
         ["Dell", "Latitude", "ThinkPad", "Lenovo", "Workstation", "Precision"], 0.8,
         "ระบุยี่ห้อจริง Dell Latitude/ThinkPad/Workstation"),
        ("IT-BSOD", ["IT_Ticket_Log", "KPI_OKR_History"], ["Ticket_Issue", "Description", "managerFeedback"],
         ["จอฟ้า", "BSOD", "Blue Screen"], 0.6, "เคสจอฟ้า"),
        ("IT-RANSOM", ["IT_Ticket_Log", "KPI_OKR_History"], ["Ticket_Issue", "Description", "managerFeedback"],
         ["Ransomware", "เรียกค่าไถ่", "ไวรัส", "มัลแวร์"], 0.6, "เคสติด Ransomware"),
        ("IT-NET", ["IT_Ticket_Log", "KPI_OKR_History"], ["Ticket_Issue", "Description", "managerFeedback"],
         ["เน็ต", "Network", "ไซต์งาน", "เชื่อมต่อ", "internet"], 0.6, "ต่อเน็ตไซต์งานไม่ได้"),
    ],
    "Legal": [
        ("LEGAL-TURNKEY", ["Compliance_Mandates", "KPI_OKR_History"],
         ["Details", "Mandate", "Status", "managerFeedback"],
         ["Turnkey", "เทิร์นคีย์", "สัญญาเหมา", "ผิดนัด", "ส่งมอบ"], 0.5, "สัญญาจ้างเหมา Turnkey ผิดนัดส่งมอบ"),
        ("LEGAL-EIA", ["Compliance_Mandates", "KPI_OKR_History"], ["Details", "Mandate", "managerFeedback"],
         ["EIA", "รายงานผลกระทบ", "สิ่งแวดล้อม"], 0.5, "ปัญหาการขอ EIA"),
        ("LEGAL-SKB", ["Compliance_Mandates", "KPI_OKR_History"], ["Details", "Mandate", "managerFeedback"],
         ["สคบ.", "ผู้บริโภค", "ฟ้อง", "คุ้มครอง"], 0.5, "ลูกบ้านฟ้องร้อง สคบ."),
    ],
    "Office Support": [
        ("OFF-BADGE", ["Physical_Security"], ["Badge_Swipes_Week", "Notes", "Last_Badge_Swipe", "Access_Zone"],
         ["บัตร", "สแกน", "Badge", "ทาบ"], 0.5, "สถิติทาบบัตร/สแกนนิ้วเข้าไซต์งาน"),
        ("OFF-KEY", ["Physical_Security", "Grievance_Log"], ["Notes", "Description"],
         ["กุญแจ", "รถบริษัท", "หาย"], 0.5, "กุญแจรถบริษัทหาย"),
    ],
}

# Cross-cutting checks applied to ALL 150 employees
CROSS_CHECKS = [
    ("X-SKILL", "ทุกคนมี Skill_Matrix >= 3 แถวพร้อมสกิลจริง (AutoCAD/Revit/BIM/etc.)",
     ["Core_Skill"], ["AutoCAD", "Revit", "BIM", "SketchUp", "ตรวจหน้างาน", "BOQ", "M365", "CRM", "Facebook", "Excel"], 3),
    ("X-BAND", "มีพนักงานเกรด C และ D อยู่ในระบบ (ไม่เพอร์เฟกต์)",
     ["performanceBand"], ["Meets (C)", "Below (D)"], 1),
]


# ── audit engine ─────────────────────────────────────────────────────────
def collect_text(emp, sheets, fields):
    parts = []
    for sname in sheets:
        sdata = emp.get("sheets", {}).get(sname, {})
        for rec in sdata.get("records", []):
            for k, v in rec.items():
                if k in fields:
                    parts.append(f"{k}: {v}")
    return "\n".join(str(x) for x in parts)


def matched(emp, sheets, fields, keywords):
    text = collect_text(emp, sheets, fields).lower()
    return any(kw.lower() in text for kw in keywords)


def run_checks(employees):
    by_dept = rc.employees_by_dept(employees)
    results = {"departments": {}, "cross_cutting": {}, "summary": {}}
    total_pass = total_fail = 0
    for dept, criteria in CHECKS.items():
        codes = by_dept.get(dept, [])
        dept_res = []
        for cid, sheets, fields, keywords, threshold, note in criteria:
            matched_codes = [c for c in codes if matched(employees[c], sheets, fields, keywords)]
            coverage = len(matched_codes) / len(codes) if codes else 0.0
            ok = coverage >= threshold
            total_pass += 1 if ok else 0
            total_fail += 0 if ok else 1
            dept_res.append({
                "id": cid, "note": note, "sheets": sheets, "fields": fields,
                "keywords": keywords, "threshold": threshold,
                "matched": len(matched_codes), "total": len(codes),
                "coverage": round(coverage, 3), "pass": ok,
                "missing_codes": [c for c in codes if c not in set(matched_codes)][:12],
            })
        results["departments"][dept] = dept_res

    # cross-cutting
    all_codes = list(employees.keys())
    # X-SKILL: every employee has >= min_rows skill rows with a real tool keyword
    _cid, _note, _fields, keywords, min_rows = CROSS_CHECKS[0]
    skill_ok = 0
    for c in all_codes:
        recs = employees[c].get("sheets", {}).get("Skill_Matrix", {}).get("records", [])
        real = [r for r in recs if any(kw.lower() in str(r.get("Core_Skill", "")).lower() for kw in keywords)]
        if len(real) >= min_rows:
            skill_ok += 1
    results["cross_cutting"]["X-SKILL"] = {
        "note": CROSS_CHECKS[0][1], "matched": skill_ok, "total": len(all_codes),
        "coverage": round(skill_ok / len(all_codes), 3), "pass": skill_ok == len(all_codes),
    }
    total_pass += 1 if skill_ok == len(all_codes) else 0
    total_fail += 0 if skill_ok == len(all_codes) else 1

    # X-BAND: C and D bands both present somewhere
    band_counts = {"C": 0, "D": 0}
    for c in all_codes:
        for rec in employees[c].get("sheets", {}).get("KPI_OKR_History", {}).get("records", []):
            band = str(rec.get("performanceBand", ""))
            if "Meets (C)" in band or band.endswith("(C)"):
                band_counts["C"] += 1
            if "Below (D)" in band or band.endswith("(D)"):
                band_counts["D"] += 1
    band_ok = band_counts["C"] > 0 and band_counts["D"] > 0
    results["cross_cutting"]["X-BAND"] = {
        "note": CROSS_CHECKS[1][1], "C_count": band_counts["C"], "D_count": band_counts["D"],
        "pass": band_ok,
    }
    total_pass += 1 if band_ok else 0
    total_fail += 0 if band_ok else 1

    results["summary"] = {
        "total_checks": total_pass + total_fail,
        "passed": total_pass,
        "failed": total_fail,
        "all_pass": total_fail == 0,
    }
    return results


def datetime_utc_now():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def write_gap_report(results, employees, path=None):
    p = Path(path) if path else rc.REPORT_DIR / "data_realism_gap_report.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    by_dept = rc.employees_by_dept(employees)
    lines = []
    lines.append("# Data Realism Gap Report — BuildersEye (150 พนักงาน / 23 Sheets)")
    lines.append("")
    lines.append("> รายงานผลการ Audit ความสมจริงของฐานข้อมูลพนักงานตามมุมมองหัวหน้างาน 12 แผนก")
    lines.append("> ไฟล์อ้างอิง: `server/.data/registry/employees.json` (ฐานข้อมูลหลักที่ระบบ BuildersEye อ่าน)")
    lines.append("")
    s = results["summary"]
    lines.append("## สรุปภาพรวม (Summary)")
    lines.append("")
    lines.append(f"- จำนวน Check ทั้งหมด: **{s['total_checks']}**")
    lines.append(f"- ผ่าน (PASS): **{s['passed']}**")
    lines.append(f"- ไม่ผ่าน (GAP): **{s['failed']}**")
    lines.append(f"- สถานะ: **{'✅ ทุก criterion ผ่าน — ข้อมูลสมจริงครบ 12 แผนก' if s['all_pass'] else '❌ ยังมี gap ต้องปิด'}**")
    lines.append("")
    lines.append(f"ข้อมูล ณ วันที่: {datetime_utc_now()}")
    lines.append("")
    lines.append("## ผลตรวจรายแผนก (12 Departments)")
    lines.append("")
    lines.append("| แผนก | Check | เป้า | ครอบคลุม | สถานะ |")
    lines.append("|---|---|---|---|---|")
    for dept, dept_res in results["departments"].items():
        total = len(by_dept.get(dept, []))
        for r in dept_res:
            status = "✅" if r["pass"] else "❌"
            lines.append(f"| {dept} ({total} คน) | {r['id']} — {r['note']} | {r['threshold']:.0%} | {r['matched']}/{r['total']} ({r['coverage']:.0%}) | {status} |")
    lines.append("")
    lines.append("## Cross-cutting Checks (ทุกคนทั้ง 150)")
    lines.append("")
    for cid, cres in results["cross_cutting"].items():
        if cid == "X-SKILL":
            lines.append(f"- **X-SKILL** — {cres['note']}: {cres['matched']}/{cres['total']} (coverage {cres['coverage']:.0%}) {'✅' if cres['pass'] else '❌'}")
        else:
            lines.append(f"- **X-BAND** — {cres['note']}: C={cres['C_count']} / D={cres['D_count']} {'✅' if cres['pass'] else '❌'}")
    lines.append("")
    lines.append("## Gap ที่ต้องปิด (ถ้ามี)")
    lines.append("")
    gaps = []
    for dept, dept_res in results["departments"].items():
        for r in dept_res:
            if not r["pass"]:
                gaps.append(f"- **{dept} / {r['id']}**: ครอบคลุมแค่ {r['matched']}/{r['total']} (ต้อง ≥ {r['threshold']:.0%}) — ตัวอย่างพนักงานที่ยังไม่มี: {', '.join(r['missing_codes'][:8])}")
    for cid, cres in results["cross_cutting"].items():
        if not cres["pass"]:
            gaps.append(f"- **{cid}**: {cres['note']}")
    if gaps:
        lines.extend(gaps)
    else:
        lines.append("ไม่มี gap — ทุก criterion ผ่านเกณฑ์เรียบร้อย")
    lines.append("")
    lines.append("## สิ่งที่ถูกเติม/อัปเดต (Log of changes)")
    lines.append("")
    _append_change_log(lines)
    lines.append("")
    with open(p, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return p


def _append_change_log(lines):
    stats_path = rc.REPORT_DIR / "data_realism_apply_stats.json"
    try:
        with open(stats_path, encoding="utf-8") as f:
            stats = json.load(f)
    except Exception:
        lines.append("_(ไม่มี data_realism_apply_stats.json — ยังไม่มีการรัน apply_all.py)_")
        return
    lines.append(f"- รันเมื่อ: {stats.get('applied_at', 'n/a')}")
    lines.append(f"- พนักงาน: {stats.get('employees', 0)} คน | แถวทั้งหมด: {stats.get('rows_before')} → {stats.get('rows_after')} (+{stats.get('rows_added')})")
    lines.append("")
    lines.append("### แถวต่อ Sheet (หลังอัปเดต)")
    lines.append("")
    sheets = stats.get("sheets", {})
    for sname in sorted(sheets):
        lines.append(f"- {sname}: {sheets[sname]} rows")
    lines.append("")
    lines.append("### ผลแต่ละ Stage")
    lines.append("")
    for st in stats.get("stages", []):
        lines.append(f"- **{st['stage']}** ({st.get('description', '')}) — {json.dumps(st.get('stats', {}), ensure_ascii=False)[:400]}")
    lines.append("")


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    want_report = "--report" in argv
    json_out = None
    if "--json-out" in argv:
        json_out = argv[argv.index("--json-out") + 1]
    employees = rc.load_employees()
    results = run_checks(employees)
    if json_out:
        with open(json_out, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=1)
    else:
        with open(rc.REPORT_DIR / "audit_realism.json", "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=1)
    print(f"Audit: {results['summary']['passed']}/{results['summary']['total_checks']} passed, "
          f"{results['summary']['failed']} failed → all_pass={results['summary']['all_pass']}")
    for dept, dept_res in results["departments"].items():
        fails = [r["id"] for r in dept_res if not r["pass"]]
        flag = "✅" if not fails else f"❌ {fails}"
        print(f"  {dept:28s} {flag}")
    xskill = results["cross_cutting"]["X-SKILL"]
    xband = results["cross_cutting"]["X-BAND"]
    print(f"  X-SKILL {xskill['matched']}/{xskill['total']} | X-BAND C={xband['C_count']} D={xband['D_count']}")
    if want_report:
        p = write_gap_report(results, employees)
        print(f"Gap report written → {p}")
    return 0 if results["summary"]["all_pass"] else 1


if __name__ == "__main__":
    sys.exit(main())

