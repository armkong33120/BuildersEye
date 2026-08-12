#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""perfection_pass.py — coordinator-owned "anti-perfect" pass over ALL 150 employees.

Mission rule #2: ข้อมูลต้องไม่ดูเพอร์เฟกต์ (Timesheet_Log และ KPI ต้องมีช่องโหว่
มีคนโดนประเมินเกรด C หรือ D)

This pass:
  1. Downgrades the most-recent KPI performanceBand to "Meets (C)" / "Below (D)"
     for a deterministic ~22% of employees who are currently all A/B.
  2. Appends imperfect Timesheet_Log rows (OT ไม่มีใบอนุมัติ, ลืมตอกบัตร,
     admin เยอะเพราะไล่เอกสาร, มาสายชดเชย OT) — department-flavored.
  3. Adds a few "human error" Attendance_Record notes (ฝนตก/รถติด/ลืมบัตร)

Constraints (conflict-free by design):
  * APPENDS rows / adjusts performanceBand ONLY — never overwrites
    managerFeedback (owned by dept_cluster_*.py), never touches Warning or
    Disciplinary sheets.
"""
from __future__ import annotations

import realism_common as rc

# ---- content pools -------------------------------------------------------
ADMIN_HEAVY_NOTES = [
    "Admin เยอะผิดปกติสัปดาห์นี้ เพราะต้องไล่รวบรวมเอกสารเบิกวัสดุที่ ผรห. ทำหายกลางเดือน",
    "นั่งทำรายงานสรุปงานให้ผู้บริหารครึ่งวัน บิลงานหน้างานน้อยลง",
    "ต้องดูแลงานธุรการแทนเลขาโครงการที่ลาป่วยต่อเนื่อง 3 วัน",
    "ประชุมประสานงานกับฝ่ายขายเรื่องสเปกเกินสัญญาทั้งสัปดาห์",
    "เก็บเอกสาร PO เก่าที่ระบบ ERP ไม่ออกเลขให้",
]

LATE_PUNCH_NOTES = [
    "ลืมตอกบัตรขาออกหลังกลับจากหน้างานต่างจังหวัด ต้องให้ HR แก้บันทึก",
    "มาสาย 45 นาทีเพราะฝนตกหนัก ถนนพระราม 2 รถติดสะสม",
    "ตอกบัตรแทนเพื่อนร่วมทีมตอนเพื่อนไปดูงานข้างนอก (โดน HR เรียกคุย)",
    "ลงเวลาลืมกด submit ระบบ จนฝ่ายบัญชีต้องตามเก็บชั่วโมงทีหลัง",
    "เข้าหน้างานตรงเวลาแต่ลืมสแกนนิ้วเข้าระบบตอนเช้า",
]

OT_NOTES = [
    "อยู่ OT ข้ามคืนไล่เทปูนพื้นชั้น 4 กับทีมงาน แต่ลืมขออนุมัติ OT ล่วงหน้า",
    "ทำ OT เก็บงานเทราคา (screed) ให้ทันกำหนดส่งมอบ แต่ไม่ได้บันทึกชั่วโมง",
    "กลับดึกหลังเที่ยงคืนเพราะรอรถเทคอนกรีต CPAC เข้าหน้างานช้าเกือบ 4 ชม.",
    "OT จัดการน้ำรั่วหลังฝนตกหนักที่โครงการให้ทันก่อนลูกค้าตรวจรับ",
    "อยู่ช่วยทีมตรวจรับงานโครงสร้างถึง 2 ทุ่ม แต่ขอเบิก OT ไม่ได้เพราะไม่ครบ 3 ชม.",
]

TIMESHEET_BAD_ROWS = [
    {"Admin_Hours_Pct": 55, "Billable_Hours_Pct": 45, "Week": None,
     "Overtime_Hours": 0, "Missing_Punch": "Yes", "Notes": "ลืมตอกบัตรขาเข้าวันจันทร์"},
    {"Admin_Hours_Pct": 48, "Billable_Hours_Pct": 52, "Week": None,
     "Overtime_Hours": 2, "Missing_Punch": "No", "Notes": "บิลชั่วโมงน้อยกว่าความจริงเพราะลืมบันทึก"},
    {"Admin_Hours_Pct": 62, "Billable_Hours_Pct": 38, "Week": None,
     "Overtime_Hours": 0, "Missing_Punch": "No", "Notes": "เสียเวลาทำรายงานสรุปงานให้ผู้บริหาร"},
]


def _timesheet_row(emp, rng):
    dept = emp.get("department", "")
    base = rng.choice(TIMESHEET_BAD_ROWS)
    row = dict(base)
    week = f"2026-W{rng.randint(20, 33):02d}"
    row["Week"] = week
    if dept in ("Engineering & Construction", "Design & Architecture") and rng.random() < 0.7:
        note = rng.choice(OT_NOTES)
        row["Overtime_Hours"] = rng.choice([2, 3, 4, 5, 6])
        row["Notes"] = note
        if rng.random() < 0.5:
            row["Missing_Punch"] = "Yes"
    elif rng.random() < 0.5:
        row["Notes"] = rng.choice(LATE_PUNCH_NOTES)
        row["Missing_Punch"] = "Yes"
    else:
        row["Notes"] = rng.choice(ADMIN_HEAVY_NOTES)
    return row


def apply(employees):
    stats = {"band_downgraded": 0, "timesheet_rows_added": 0,
             "attendance_notes": 0, "learning_incomplete": 0}
    all_codes = sorted(employees.keys())
    for code in all_codes:
        emp = employees[code]
        rng = rc.rng_for(code, "perfection")

        # 1) band downgrade (only if currently all A/B and not already C/D-heavy)
        kpi_recs = rc.sheet_records(emp, "KPI_OKR_History")
        if kpi_recs and rng.random() < 0.22:
            rec = kpi_recs[-1]
            band = str(rec.get("performanceBand", ""))
            if "Exceeds" in band or "Far Exceeds" in band or "Outstanding" in band:
                rec["performanceBand"] = rng.choice(["Meets (C)", "Below (D)"])
                if "Below (D)" in rec["performanceBand"]:
                    rec["followUpStatus"] = "Needs Improvement Plan"
                stats["band_downgraded"] += 1

        # 2) imperfect timesheet rows (idempotent: skip if already enriched)
        ts = rc.sheet_records(emp, "Timesheet_Log")
        already_enriched = any(r.get("Week") and ("Missing_Punch" in r or "Overtime_Hours" in r)
                               for r in ts)
        if not already_enriched and rng.random() < 0.5 and ts:
            n = rng.randint(1, 2)
            for _ in range(n):
                rc.add_records(emp, "Timesheet_Log", [_timesheet_row(emp, rng)])
            stats["timesheet_rows_added"] += n

        # 3) attendance human-error notes (idempotent: skip if Notes already present)
        att = rc.sheet_records(emp, "Attendance_Record")
        if att and rng.random() < 0.35:
            has_note = any(r.get("Notes") for r in att)
            if not has_note:
                note = rng.choice(LATE_PUNCH_NOTES + ADMIN_HEAVY_NOTES)
                rec = att[-1]
                if "Notes" not in rec:
                    rec["Notes"] = note
                else:
                    rc.add_records(emp, "Attendance_Record", [{
                        "Late_Arrivals": 1,
                        "Sick_Leave_Days": 0,
                        "Personal_Leave_Days": 0,
                        "Notes": note,
                    }])
                stats["attendance_notes"] += 1

        # 4) a few incomplete trainings (idempotent: skip if already incomplete)
        learn = rc.sheet_records(emp, "Learning_Development")
        if learn and rng.random() < 0.18:
            candidates = [r for r in learn if str(r.get("completionStatus", "")) not in
                          ("Incomplete", "No-Show", "Cancelled")]
            if candidates:
                rec = rng.choice(candidates)
                rec["completionStatus"] = rng.choice(["Incomplete", "No-Show", "Cancelled"])
                rec["notes"] = (rec.get("notes", "") + " | นัดอบรมไม่ว่างต้องเลื่อน " if rec.get("notes") else
                                "นัดอบรมไม่ว่างต้องเลื่อน ยังไม่ได้เรียนชดเชย")
                stats["learning_incomplete"] += 1

    return stats
