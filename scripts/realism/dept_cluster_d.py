#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dept_cluster_d.py — Cluster D realism: Legal (2) + Office Support (2) = 4 employees.

Owns (mutates the in-memory dict only; the coordinator persists):
  * Compliance_Mandates       — Legal: ADD a Details column on every row + 3 new
                                mandate rows (สัญญาจ้างเหมา Turnkey ผิดนัดส่งมอบ /
                                การขอ EIA / คดี สคบ.) covering LEGAL-TURNKEY,
                                LEGAL-EIA, LEGAL-SKB.
  * KPI_OKR_History           — all 4: managerFeedback of the last 3 rows rewritten
                                in department-flavored Thai (legal-view / office-view).
  * Physical_Security         — all 4: ADD Badge_Swipes_Week, Fingerprint_Scans_Week,
                                Notes, refreshed Last_Badge_Swipe. Office Support
                                Notes carry สถิติทาบบัตร/สแกนนิ้วมือ + กุญแจรถบริษัทหาย
                                (OFF-BADGE / OFF-KEY).
  * Grievance_Log             — EMP149: create (housekeeper/customer complaint).
                                EMP150: enrich existing row + 1 new row.
  * Warning_Disciplinary_History — EMP150: new case "ขับรถบริษัทเกินกำหนดในชั่วโมงทำงาน".
  * Skill_Matrix              — all 4: rc.skill_rows + guaranteed >=3 X-SKILL
                                keyword rows + Thai Notes (per-code).

Deterministic (seeded per-employee rng via rc.rng_for) and idempotent
(marker-based skips). Never writes server/.data/registry/employees.json —
smoke-test copies go to /tmp via rc.save_smoke.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import realism_common as rc

# ── shared constants ──────────────────────────────────────────────────────
X_SKILL_KEYWORDS = ["AutoCAD", "Revit", "BIM", "SketchUp", "ตรวจหน้างาน",
                    "BOQ", "M365", "CRM", "Facebook", "Excel"]

PHYS_HEADERS = ["Access_Zone", "Parking_Slot", "Last_Badge_Swipe",
                "Badge_Swipes_Week", "Fingerprint_Scans_Week", "Notes"]
GRIEVANCE_HEADERS = ["Status", "Complaint_Type", "Description",
                     "Filed_Date", "Resolution", "Filed_By", "Against"]
SKILL_HEADERS = ["Core_Skill", "Certification", "Language_Score_IELTS",
                 "Skill_Level", "Last_Assessed", "Notes"]

# ── Compliance_Mandates: Details on existing rows (Legal) ─────────────────
MANDATE_DETAILS = {
    "PDPA": "ผ่านการอบรม PDPA รอบปี ใช้กำกับดูแลการจัดเก็บเอกสารสัญญาลูกค้าและข้อมูลส่วนบุคคลผู้รับเหมา",
    "Cybersecurity Awareness": "อบรมตระหนักรู้ไซเบอร์ประจำปี ผ่านเกณฑ์ ต้องระวังอีเมลหลอกลวงที่แอบอ้างเป็นคู่สัญญา",
    "Code of Conduct": "ทบทวนจริยธรรมองค์กรประจำปี ไม่พบการฝ่าฝืนนโยบายต่อต้านคอร์รัปชัน",
    "Anti-Bribery": "เข้าร่วมอบรมการต่อต้านการติดสินบนกับคู่ค้า/ผู้รับเหมา ต้องรายงานของขวัญมูลค่าเกินเกณฑ์",
    "Health & Safety": "ผ่านการอบรมความปลอดภัยในสำนักงานและหน้างาน (จป.) ตามข้อกำหนดบริษัท",
}

# New mandate rows per person: (Mandate, Status, Details)
LEGAL_MANDATE_ROWS_147 = [
    ("สัญญาจ้างเหมา Turnkey — ผิดนัดส่งมอบ (PRJ044)", "In Progress",
     "สัญญาจ้างเหมา Turnkey โครงการ PRJ044 — ผู้รับเหมาผิดนัดส่งมอบงาน 90 วัน "
     "อยู่ระหว่างคิดค่าปรับ (Liquidated Damages) 0.1%/วัน"),
    ("การขอ EIA โครงการคอนโด PRJ050", "In Progress",
     "การขอ EIA โครงการคอนโด PRJ050 ติดขัดต้องส่งข้อมูลเพิ่ม สผ. 2 ชุด "
     "จ้างที่ปรึกษาด้านสิ่งแวดล้อมเพิ่ม"),
    ("คดี สคบ. ลูกบ้าน 12 ราย", "Open",
     "ลูกบ้าน 12 รายยื่นฟ้อง สคบ. เรื่องสัญญาไม่เป็นธรรม (ค่าธรรมเนียมโอนไม่ตรงกับที่โฆษณา) "
     "อยู่ระหว่างไกล่เกลี่ย"),
]
LEGAL_MANDATE_ROWS_148 = [
    ("สัญญาเหมา Turnkey — ผิดนัดส่งมอบ (PRJ044)", "In Progress",
     "ผู้รับเหมาเทิร์นคีย์โครงการ PRJ044 ผิดนัดส่งมอบงาน 90 วัน อยู่ระหว่างคำนวณค่าปรับ "
     "ตามสัญญา (Liquidated Damages) 0.1%/วัน"),
    ("การขอ EIA โครงการคอนโด PRJ050", "Pending",
     "โครงการคอนโด PRJ050 ติดขัดการขอ EIA ต้องส่งข้อมูลเพิ่มให้ สผ. 2 ชุด "
     "และจ้างที่ปรึกษาด้านสิ่งแวดล้อมเพิ่ม"),
    ("คดี สคบ. ลูกบ้าน 12 ราย", "In Progress",
     "ลูกบ้าน 12 รายยื่นฟ้องร้อง สคบ. เรื่องข้อกำหนดสัญญาไม่เป็นธรรม "
     "(ค่าธรรมเนียมโอนไม่ตรงกับโฆษณา) อยู่ระหว่างไกล่เกลี่ย"),
]

# ── KPI_OKR_History managerFeedback (last 3 rows) ─────────────────────────
KPI_FEEDBACK = {
    "EMP147": [  # วริศ ไชยรัตน์ — Legal Manager
        "ช่วยไล่สัญญา Turnkey ผิดนัดส่งมอบ PRJ044 ได้ทัน ต้องตั้ง clause ค่าปรับ "
        "Liquidated Damages 0.1%/วัน ให้ชัดเจนในสัญญาใหม่",
        "คดี สคบ. ลูกบ้าน 12 รายต้องปิดให้จบไตรมาสนี้ ไม่งั้นกระทบชื่อเสียงการโอนบ้านหลังใหม่ "
        "อยู่ระหว่างไกล่เกลี่ย",
        "การขอ EIA โครงการ PRJ050 ติดขัดที่ สผ. ต้องเร่งจ้างที่ปรึกษาสิ่งแวดล้อมเพิ่ม "
        "ส่งข้อมูลชุดที่ 2 ให้ทันกำหนด",
    ],
    "EMP148": [  # ชลธิชา เกตุแก้ว — Legal Officer
        "จัดทำหนังสือเรียกร้องค่าปรับผู้รับเหมาเทิร์นคีย์ผิดนัดส่งมอบ PRJ044 ได้ทันกำหนด "
        "ต้องตรวจ clause ค่าปรับให้รอบคอบก่อนออกหนังสือ",
        "คดีฟ้องร้อง สคบ. ของลูกบ้านต้องช่วยปิดให้จบไตรมาสนี้ ติดตามความคืบหน้าการไกล่เกลี่ยทุกสัปดาห์",
        "การขอ EIA โครงการ PRJ050 ต้องไล่ส่งข้อมูลเพิ่ม สผ. 2 ชุด และจ้างที่ปรึกษาสิ่งแวดล้อม "
        "ช่วยลดความเสี่ยงการอนุมัติล่าช้า",
    ],
    "EMP149": [  # ปวีณา ตั้งเจริญ — Housekeeper
        "ดูแลห้องตัวอย่างและพื้นที่ส่วนกลางดีขึ้น แต่เหตุการณ์กุญแจรถบริษัทหายต้องเป็นบทเรียน "
        "ทำทะเบียนคุมกุญแจให้ชัดเจน",
        "สถิติทาบบัตรเข้าไซต์งานครบทุกวัน แต่ต้องระวังการลืมบัตร ควรพกบัตรสำรองไว้ที่ล็อกเกอร์",
        "ถูกลูกค้าโครงการต่อว่าเรื่องห้องตัวอย่างสกปรกช่วงเปิดขาย ต้องทำเช็กลิสต์ทำความสะอาดก่อนเปิดทุกครั้ง",
    ],
    "EMP150": [  # มนัสนันท์ อินทรักษา — Executive Driver
        "ดูแลรถบริษัทดี แต่กุญแจรถบริษัทหายต้องระวังเป็นบทเรียน ทำทะเบียนคุมกุญแจ "
        "และติดตั้งกล้องวงจรปิดเพิ่ม",
        "เหตุการณ์ขับรถเกินกำหนดในชั่วโมงทำงานโดนตักเตือนแล้ว ต้องรายงานเส้นทางและเวลากลับรถ "
        "ล่วงหน้าทุกเที่ยว",
        "สถิติสแกนนิ้วมือเข้าออกครบ ต้องส่งตารางทาบบัตรรายสัปดาห์ให้ฝ่ายอาคารตามระเบียบ",
    ],
}
KPI_MARKERS = {"EMP147": "Liquidated Damages", "EMP148": "Liquidated Damages",
               "EMP149": "กุญแจรถบริษัท", "EMP150": "กุญแจรถบริษัท"}

# ── Physical_Security enrichment (1 row/person) ───────────────────────────
PHYS_ENRICH = {
    "EMP147": {
        "Last_Badge_Swipe": "17:42",
        "Badge_Swipes_Week": "5 ครั้ง/สัปดาห์",
        "Fingerprint_Scans_Week": "10 ครั้ง/สัปดาห์",
        "Notes": "ทาบบัตรเข้าอาคารทุกวันทำการ สแกนนิ้วมือเข้างานเช้า-เย็นครบ "
                 "ไม่มีเหตุการณ์ผิดปกติด้านการเข้าออกสำนักงาน",
    },
    "EMP148": {
        "Last_Badge_Swipe": "18:05",
        "Badge_Swipes_Week": "6 ครั้ง/สัปดาห์",
        "Fingerprint_Scans_Week": "12 ครั้ง/สัปดาห์",
        "Notes": "สแกนนิ้วมือเข้า-ออกสำนักงานครบทุกวัน ทาบบัตร 6 ครั้ง/สัปดาห์ "
                 "วันที่ไปเยี่ยมลูกค้าที่โครงการต้องลงทะเบียนเยี่ยมเยียนที่ gate",
    },
    "EMP149": {
        "Last_Badge_Swipe": "17:58",
        "Badge_Swipes_Week": "6 ครั้ง/สัปดาห์",
        "Fingerprint_Scans_Week": "12 ครั้ง/สัปดาห์",
        "Notes": "สถิติทาบบัตรเข้าไซต์งาน 6 วัน/สัปดาห์ สแกนนิ้วมือครบ แต่วันที่ 3 ลืมบัตร "
                 "ต้องลงทะเบียนเยี่ยมเยียนหน้า gate — หลังเหตุการณ์กุญแจรถบริษัทหาย "
                 "รปภ. เพิ่มการสแกนบัตรเข้มขึ้น",
    },
    "EMP150": {
        "Last_Badge_Swipe": "19:12",
        "Badge_Swipes_Week": "7 ครั้ง/สัปดาห์",
        "Fingerprint_Scans_Week": "14 ครั้ง/สัปดาห์",
        "Notes": "กุญแจรถบริษัท (Toyota Hilux Revo ทะเบียน 1กฬ 8899) หายจากตู้กุญแจ "
                 "เมื่อสัปดาห์ก่อน ต้องเปลี่ยนกุญแจและติดตั้งกล้องวงจรปิดใหม่ทั้งหมด — "
                 "สถิติทาบบัตรเข้าไซต์งาน 6 วัน/สัปดาห์ สแกนนิ้วมือครบ",
    },
}


# ── Grievance_Log ─────────────────────────────────────────────────────────
GRIEVANCE_149 = [
    {"Status": "In Progress", "Complaint_Type": "Customer Complaint",
     "Description": "พนักงานทำความสะอาดถูกลูกค้าโครงการต่อว่าเรื่องห้องตัวอย่างสกปรกช่วงเปิดขาย "
                    "weekend และถูกกล่าวหาว่าทำกุญแจห้องตัวอย่างหายระหว่างจัดงาน",
     "Filed_Date": "2026-03-18", "Resolution": "หัวหน้า Housekeeping ชี้แจงมาตรฐานการทำความสะอาด "
                    "และปรับเช็กลิสต์ก่อนเปิดห้องตัวอย่างทุกครั้ง",
     "Filed_By": "ปวีณา ตั้งเจริญ", "Against": "ลูกค้าโครงการ PRJ052"},
]
GRIEVANCE_150_FILL = {
    "Description": "มีปากเสียงกับหัวหน้าเรื่องการถูกตำหนิกรณีกุญแจรถบริษัทหายจากตู้กุญแจ "
                   "รู้สึกว่าโดนลงโทษก่อนสอบสวนข้อเท็จจริง",
    "Filed_Date": "2026-02-15", "Resolution": "หัวหน้างานและ HR ประชุมร่วมสอบสวนข้อเท็จจริง "
                   "และกำหนดมาตรการคุมกุญแจใหม่",
    "Filed_By": "มนัสนันท์ อินทรักษา", "Against": "หัวหน้างานโดยตรง",
}
GRIEVANCE_150_ADD = [
    {"Status": "Resolved", "Complaint_Type": "Workload Issue",
     "Description": "งานขับรถนอกเวลาและงานธุรการทับซ้อนช่วงโครงการเปิดตัว ต้องขับรถรับ-ส่งลูกค้า "
                    "ด้วยตารางกะทันหันโดยไม่มีการแจ้งล่วงหน้า",
     "Filed_Date": "2025-11-06", "Resolution": "หัวหน้างานจัดตารางขับรถล่วงหน้า "
                    "และแบ่งงานธุรการให้พนักงานอื่นช่วย",
     "Filed_By": "มนัสนันท์ อินทรักษา", "Against": "ฝ่ายบริหารสำนักงาน"},
]

# ── Warning_Disciplinary_History (EMP150 new case) ────────────────────────
WARNING_150 = {
    "caseId": "CASE0292", "caseDate": "2026-02-12", "caseType": "Policy Violation",
    "severity": "Low", "formalWarning": "Yes",
    "summary": "ขับรถบริษัทเกินกำหนดในชั่วโมงทำงาน ใช้รถรับส่งส่วนตัวข้ามเขตกรุงเทพฯ "
               "โดยไม่แจ้งหัวหน้า",
    "rootCause": "ประเมินเวลาเดินทางผิดพลาดและไม่รายงานเส้นทางล่วงหน้า",
    "actionTaken": "ตักเตือนเป็นลายลักษณ์อักษร + กำหนดให้รายงานเส้นทางและเวลากลับรถทุกเที่ยว",
    "resolutionStatus": "Resolved", "managerInvolved": "EMP135",
    "hrConfidentialityLevel": "Tier 1 — Strict", "redactionRequired": "No",
    "linkedProjectId": "", "linkedTrainingId": "T06",
}

# ── Skill_Matrix extras (guarantee >=3 X-SKILL keyword rows) ──────────────
SKILL_EXTRA_BY_DEPT = {
    "Legal": [
        ("M365 (Outlook/Teams/SharePoint)", None),
        ("Excel / Pivot สรุปสัญญาและคดีความ", None),
        ("ตรวจหน้างานร่วมทีมกฎหมาย (Site Compliance)", None),
    ],
    "Office Support": [
        ("Excel / Pivot ทะเบียนคุมกุญแจและยานพาหนะ", None),
        ("M365 (Outlook/Teams)", None),
        ("CRM จองรถบริษัท (in-house)", None),
    ],
}
SKILL_NOTES_BY_CODE = {
    "EMP147": [
        "ใช้จริงทุกวัน ร่างและตรวจสัญญาจ้างเหมากับฝ่ายก่อสร้าง",
        "ใช้กำกับเอกสารการขอ EIA โครงการ PRJ050 กับที่ปรึกษาสิ่งแวดล้อม",
        "ใช้ติดตามคดีฟ้องร้อง สคบ. ของลูกบ้านและบันทึกการไกล่เกลี่ย",
        "ต้องอัปเดตข้อกฎหมายอสังหาริมทรัพย์ที่ประกาศใหม่ทุกไตรมาส",
    ],
    "EMP148": [
        "ใช้ตรวจ clause ค่าปรับในสัญญา Turnkey ก่อนออกหนังสือเรียกร้อง",
        "ใช้ทำตารางนัดหมายไกล่เกลี่ยคดี สคบ. ของลูกบ้าน",
        "ใช้ประสาน สผ. เรื่องการขอ EIA ผ่านอีเมลและ SharePoint",
        "ต้องทบทวนสัญญาจ้างเหมาเดิมที่ใกล้หมดอายุทุกเดือน",
    ],
    "EMP149": [
        "ใช้ทำทะเบียนคุมกุญแจห้องตัวอย่างและพื้นที่ส่วนกลาง",
        "ใช้บันทึกสถิติทาบบัตรเข้าไซต์งานและสแกนนิ้วมือรายสัปดาห์",
        "ใช้ทำเช็กลิสต์ทำความสะอาดห้องตัวอย่างก่อนเปิดขายทุกครั้ง",
        "ต้องรายงานสถานะกุญแจและวัสดุทำความสะอาดให้หัวหน้าทุกสัปดาห์",
    ],
    "EMP150": [
        "ใช้ทำทะเบียนคุมกุญแจรถบริษัทและตารางยานพาหนะ",
        "ใช้บันทึกสถิติทาบบัตรและสแกนนิ้วมือเข้าออกไซต์งาน",
        "ใช้จองรถบริษัทและวางตารางรับ-ส่งผู้บริหาร",
        "ต้องอัปเดตเส้นทางและสภาพรถหลังกลับจากนอกสถานที่ทุกครั้ง",
    ],
}


# ── small helpers ─────────────────────────────────────────────────────────
def _set_headers(emp, sheet, headers):
    emp.setdefault("sheets", {}).setdefault(sheet, {})["headers"] = list(headers)


# ── enrichment functions ──────────────────────────────────────────────────
def _fill_skill_matrix(emp, code, rng, stats):
    recs = rc.sheet_records(emp, "Skill_Matrix")
    if recs and all("Skill_Level" in r and "Notes" in r for r in recs):
        return  # already enriched (idempotent)
    dept = emp.get("department", "")
    rows = rc.skill_rows(code, dept, rng)
    have = {r["Core_Skill"] for r in rows}
    notes_pool = SKILL_NOTES_BY_CODE.get(code, ["ใช้จริงในงานประจำ"])
    for skill, cert in SKILL_EXTRA_BY_DEPT.get(dept, []):
        kw_count = sum(1 for r in rows
                       if any(k.lower() in r["Core_Skill"].lower() for k in X_SKILL_KEYWORDS))
        if kw_count >= 3:
            break
        if skill not in have:
            rows.append({
                "Core_Skill": skill,
                "Certification": cert or "",
                "Language_Score_IELTS": round(rng.uniform(5.5, 7.5), 1),
                "Skill_Level": rng.choice(["Intermediate", "Advanced", "Expert"]),
                "Last_Assessed": f"20{rng.randint(23, 26)}-{rng.randint(1, 12):02d}-15",
                "Notes": "",
            })
            have.add(skill)
    for r in rows:
        r["Notes"] = rng.choice(notes_pool)
    emp.setdefault("sheets", {})["Skill_Matrix"] = {
        "headers": list(SKILL_HEADERS), "records": rows,
    }
    stats["skill_rows"] += len(rows)


def _enrich_compliance(emp, code, rows_pool, stats):
    recs = rc.sheet_records(emp, "Compliance_Mandates")
    if any("Details" in r for r in recs):
        return  # already enriched (idempotent)
    for r in recs:
        r["Details"] = MANDATE_DETAILS.get(r.get("Mandate", ""), "ผ่านการอบรมตามข้อกำหนดประจำปี")
        stats["mandate_rows_filled"] += 1
    for mandate, status, details in rows_pool:
        rc.add_records(emp, "Compliance_Mandates", [{
            "Mandate": mandate, "Status": status, "Details": details,
        }])
        stats["mandate_rows_added"] += 1
    _set_headers(emp, "Compliance_Mandates", ["Mandate", "Status", "Details"])


def _enrich_kpi(emp, code, stats):
    recs = rc.sheet_records(emp, "KPI_OKR_History")
    marker = KPI_MARKERS[code]
    last3 = [str(r.get("managerFeedback", "")) for r in recs[-3:]]
    if any(marker in t for t in last3):
        return  # already enriched (idempotent)
    start = max(0, len(recs) - 3)
    for idx, txt in zip(range(start, len(recs)), KPI_FEEDBACK[code]):
        recs[idx]["managerFeedback"] = txt
        stats["kpi_feedback_updated"] += 1


def _enrich_physical(emp, code, cfg, stats):
    recs = rc.sheet_records(emp, "Physical_Security")
    if recs and any("Badge_Swipes_Week" in r for r in recs):
        return  # already enriched (idempotent)
    for r in recs:
        r["Last_Badge_Swipe"] = cfg["Last_Badge_Swipe"]
        r["Badge_Swipes_Week"] = cfg["Badge_Swipes_Week"]
        r["Fingerprint_Scans_Week"] = cfg["Fingerprint_Scans_Week"]
        r["Notes"] = cfg["Notes"]
        stats["physical_rows_updated"] += 1
    _set_headers(emp, "Physical_Security", PHYS_HEADERS)


def _enrich_grievance(emp, code, stats):
    recs = rc.sheet_records(emp, "Grievance_Log")
    if code == "EMP149":
        if recs and any("Description" in r for r in recs):
            return  # already enriched (idempotent)
        rc.add_records(emp, "Grievance_Log", GRIEVANCE_149)
        stats["grievance_rows_added"] += len(GRIEVANCE_149)
    elif code == "EMP150":
        if recs and any("Description" in r for r in recs):
            return  # already enriched (idempotent)
        for r in recs:
            r["Description"] = GRIEVANCE_150_FILL["Description"]
            r["Filed_Date"] = GRIEVANCE_150_FILL["Filed_Date"]
            r["Resolution"] = GRIEVANCE_150_FILL["Resolution"]
            r["Filed_By"] = GRIEVANCE_150_FILL["Filed_By"]
            r["Against"] = GRIEVANCE_150_FILL["Against"]
            stats["grievance_rows_filled"] += 1
        rc.add_records(emp, "Grievance_Log", GRIEVANCE_150_ADD)
        stats["grievance_rows_added"] += len(GRIEVANCE_150_ADD)
    _set_headers(emp, "Grievance_Log", GRIEVANCE_HEADERS)


def _enrich_warning(emp, stats):
    recs = rc.sheet_records(emp, "Warning_Disciplinary_History")
    if any("เกินกำหนด" in str(r.get("summary", "")) for r in recs):
        return  # already enriched (idempotent)
    rc.add_records(emp, "Warning_Disciplinary_History", [WARNING_150])
    stats["warning_rows_added"] += 1


# ── public API ────────────────────────────────────────────────────────────
def apply(employees):
    """Enrich Cluster D (Legal + Office Support, 4 employees) in place."""
    stats = {
        "cluster": "D",
        "employees_enriched": 0,
        "skill_rows": 0,
        "mandate_rows_filled": 0,
        "mandate_rows_added": 0,
        "kpi_feedback_updated": 0,
        "physical_rows_updated": 0,
        "grievance_rows_added": 0,
        "grievance_rows_filled": 0,
        "warning_rows_added": 0,
        "departments": {},
    }
    codes = rc.codes_in(employees, "Legal", "Office Support")
    for code in codes:
        emp = employees[code]
        rng = rc.rng_for(code, "cluster_d")
        dept = emp.get("department", "")
        stats["employees_enriched"] += 1
        stats["departments"][dept] = stats["departments"].get(dept, 0) + 1
        _fill_skill_matrix(emp, code, rng, stats)
        _enrich_kpi(emp, code, stats)
        _enrich_physical(emp, code, PHYS_ENRICH[code], stats)
        if dept == "Legal":
            pool = LEGAL_MANDATE_ROWS_147 if code == "EMP147" else LEGAL_MANDATE_ROWS_148
            _enrich_compliance(emp, code, pool, stats)
        else:
            _enrich_grievance(emp, code, stats)
            if code == "EMP150":
                _enrich_warning(emp, stats)
    return stats


# ── self-check (mirrors audit_realism.py criteria for Cluster D) ──────────
SELF_CHECKS = [
    ("LEGAL-TURNKEY", "Legal",
     ["Compliance_Mandates", "KPI_OKR_History"],
     ["Details", "Mandate", "Status", "managerFeedback"],
     ["Turnkey", "เทิร์นคีย์", "สัญญาเหมา", "ผิดนัด", "ส่งมอบ"], 0.5),
    ("LEGAL-EIA", "Legal",
     ["Compliance_Mandates", "KPI_OKR_History"],
     ["Details", "Mandate", "managerFeedback"],
     ["EIA", "รายงานผลกระทบ", "สิ่งแวดล้อม"], 0.5),
    ("LEGAL-SKB", "Legal",
     ["Compliance_Mandates", "KPI_OKR_History"],
     ["Details", "Mandate", "managerFeedback"],
     ["สคบ.", "ผู้บริโภค", "ฟ้อง", "คุ้มครอง"], 0.5),
    ("OFF-BADGE", "Office Support",
     ["Physical_Security"],
     ["Badge_Swipes_Week", "Notes", "Last_Badge_Swipe", "Access_Zone"],
     ["บัตร", "สแกน", "Badge", "ทาบ"], 0.5),
    ("OFF-KEY", "Office Support",
     ["Physical_Security", "Grievance_Log"],
     ["Notes", "Description"],
     ["กุญแจ", "รถบริษัท", "หาย"], 0.5),
]


def _collect_text(emp, sheets, fields):
    parts = []
    for sname in sheets:
        for rec in emp.get("sheets", {}).get(sname, {}).get("records", []):
            for k, v in rec.items():
                if k in fields:
                    parts.append(f"{k}: {v}")
    return "\n".join(str(x) for x in parts)


def _matched(emp, sheets, fields, keywords):
    text = _collect_text(emp, sheets, fields).lower()
    return any(kw.lower() in text for kw in keywords)


def _run_self_check(employees):
    by_dept = rc.employees_by_dept(employees)
    print("\nSelf-check coverage (Cluster D):")
    all_ok = True
    for cid, dept, sheets, fields, keywords, threshold in SELF_CHECKS:
        codes = by_dept.get(dept, [])
        matched = [c for c in codes if _matched(employees[c], sheets, fields, keywords)]
        cov = len(matched) / len(codes) if codes else 0.0
        ok = cov >= threshold
        all_ok = all_ok and ok
        print(f"  {cid:14s} {len(matched):3d}/{len(codes):3d}  {cov*100:5.1f}%  "
              f"{'PASS' if ok else 'FAIL'}")
    d_codes = rc.codes_in(employees, "Legal", "Office Support")
    ok_skill = 0
    for c in d_codes:
        recs = employees[c].get("sheets", {}).get("Skill_Matrix", {}).get("records", [])
        real = [r for r in recs
                if any(k.lower() in str(r.get("Core_Skill", "")).lower() for k in X_SKILL_KEYWORDS)]
        if len(real) >= 3:
            ok_skill += 1
    print(f"  {'X-SKILL':14s} {ok_skill:3d}/{len(d_codes):3d}  "
          f"{ok_skill/len(d_codes)*100:5.1f}%  "
          f"{'PASS' if ok_skill == len(d_codes) else 'FAIL'}")
    return all_ok and ok_skill == len(d_codes)


if __name__ == "__main__":
    data = rc.load_employees()
    stats = apply(data)
    smoke_path = rc.save_smoke(data, "cluster_d_smoke")
    print("STATS:")
    print(json.dumps(stats, ensure_ascii=False, indent=1))
    print(f"\nSmoke JSON → {smoke_path}")
    smoke = rc.load_employees(smoke_path)
    ok_all = _run_self_check(smoke)
    print(f"\nOverall self-check: {'ALL PASS' if ok_all else 'SOME FAIL'}")
    sys.exit(0 if ok_all else 1)

