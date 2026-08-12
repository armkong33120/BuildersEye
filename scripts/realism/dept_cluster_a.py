#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dept_cluster_a.py — Cluster A realism: Executive (6), Sales (28),
Marketing (10), Design & Architecture (18) = 62 employees.

Owns (mutates the in-memory dict only; coordinator persists):
  * KPI_OKR_History  — all 62: managerFeedback/improvementPlan/strongArea of
                        the last 3 rows rewritten in department-flavored Thai
                        (ลด CAC + ยอดโอนกรรมสิทธิ์ / Site Visit + กู้แบงก์ /
                        ROAS + lead ต่อ 1 บาท / คุณภาพแบบ + ดีเลย์), topped up
                        to 6 rows.
  * Project_History  — Sales: 2-4 mortgage-rejection + ทิ้งดาวน์ mistake rows;
                        Design: 2-4 Shop Drawing / BOQ / แก้แบบ mistake rows.
  * Expense_Reports  — Marketing: 4-6 line-item rows (Date/Category/Description/
                        Amount_THB/Status/Approver): Facebook Ads, TikTok Ads,
                        ค่าออกบูธมหกรรมบ้านและคอนโด, อินฟลูเอนเซอร์, ถ่ายโดรน.
  * Collaboration_Network — Sales: conflictSummary rows ต่อยอดประเด็นกู้แบงก์.
  * Skill_Matrix     — all 62: rc.skill_rows + guaranteed >=3 X-SKILL keyword
                        rows + Thai Notes.

Deterministic (seeded per-employee rng) and idempotent (marker-based skips).
Never writes server/.data/registry/employees.json — smoke copies go to /tmp.
"""
import datetime
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import realism_common as rc

X_SKILL_KEYWORDS = ["AutoCAD", "Revit", "BIM", "SketchUp", "ตรวจหน้างาน",
                    "BOQ", "M365", "CRM", "Facebook", "Excel"]
PRJ_FALLBACK = [f"PRJ{i:03d}" for i in range(1, 70)]
KPI_TOPUP_PERIODS = ["2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"]

ROLE_BY_TITLE = {
    "CEO / Managing Director": "Executive Sponsor",
    "COO / Operations Director": "Executive Sponsor",
    "CFO / Finance Director": "Executive Sponsor",
    "Head of Sales": "Executive Sponsor",
    "Head of Construction": "Executive Sponsor",
    "Executive Secretary": "Executive Support",
    "Sales Manager": "Sales Manager",
    "Branch Manager": "Branch Manager",
    "Sales Consultant": "Sales Consultant",
    "Sales Coordinator": "Sales Coordinator",
    "Marketing Manager": "Marketing Lead",
    "Digital Marketing Officer": "Digital Marketing",
    "Content Creator": "Content Creator",
    "Graphic Designer": "Graphic Designer",
    "CRM / Event Officer": "CRM / Event",
    "Design Manager": "Design Manager",
    "Architect": "Architect",
    "Interior Designer": "Interior Designer",
    "Draftsman": "Draftsman",
    "BOQ / Estimator": "BOQ / Estimator",
}


def _rand_date(rng, y0, y1):
    return datetime.date(rng.randint(y0, y1), rng.randint(1, 12),
                         rng.randint(1, 28)).isoformat()


def _set_headers(emp, sheet, headers):
    emp.setdefault("sheets", {}).setdefault(sheet, {})["headers"] = list(headers)


def _own_projects(emp, fallback=None):
    ids = [r.get("projectId") for r in emp.get("sheets", {}).get("Project_History", {}).get("records", [])
           if r.get("projectId")]
    ids = [p for p in ids if str(p).startswith("PRJ") and str(p)[3:].isdigit()]
    return ids or (fallback or PRJ_FALLBACK)


def _pick_proj(rng, emp, fallback=None):
    return rng.choice(_own_projects(emp, fallback))


def _role_for(job_title):
    return ROLE_BY_TITLE.get(job_title, job_title or "Contributor")


# ── Executive content (boardroom-level: ลด CAC + เป้ายอดโอนกรรมสิทธิ์) ────
EXEC_FEEDBACK = [
    "เป้า Q4 ต้องปิดยอดโอนกรรมสิทธิ์ให้ได้ 180 ยูนิต ทำทุกช่องทางลด CAC ให้เหลือต่ำกว่า 8% ของราคาขาย ไม่งั้นงบบ้านตัวอย่างเกิน",
    "ผลักดันยอดโอนกรรมสิทธิ์ครึ่งปีหลังให้ทันแผน ต้องลุยลด CAC ด้วยการรุกช่องทางออนไลน์แทนโบรกเกอร์แพง ๆ",
    "CAC ไตรมาสนี้สูงเกินงบ (12.4%) กระทบมาร์จิ้น สั่งตั้ง war room ลดค่าหาลูกค้าและเร่งปิดยอดโอน Q3 อย่ารอให้สะสม",
    "ตัวเลขยอดโอนกรรมสิทธิ์สะสมยังห่างเป้า 14% ต้องทบทวนแคมเปญลด CAC ทั้งระบบ ทั้งฝ่ายขาย-มาร์เก็ตติ้ง-ไฟแนนซ์",
    "กรรมการให้ความเห็นตรงกันว่า ลด CAC คือวาระหลักของปี ก่อนประกาศเป้ายอดโอนกรรมสิทธิ์ Q4 ต้องมีแผนชัดเจน",
    "อัตราส่วนหนี้สิน D/E เริ่มสูง (2.1 เท่า) ต้องเร่งเก็บเงินจากยอดโอนกรรมสิทธิ์ และควบคุมค่าใช้จ่ายหาลูกค้า (CAC) ทุกโครงการ",
    "มองภาพรวมแล้ว CAC ของฝ่ายการตลาดพุ่ง แต่ยอดโอนกรรมสิทธิ์ยังนิ่ง ต้องรีบปรับช่องทางและเป้าให้สอดคล้องกัน",
    "กำชับให้ทุกโครงการรายงานยอดโอนกรรมสิทธิ์รายสัปดาห์ และลด CAC จากการพึ่งพาเอเยนต์ภายนอกให้เหลือ 30%",
    "ผลงานล็อกงบเป็นที่น่าพอใจ แต่ต้องระวังต้นทุนหาลูกค้า (CAC) หลังเปิดตัวโครงการใหม่ ถ้ายอดโอนไม่ทันเป้า",
    "ย้ำกับทีมบริหารว่าเป้ายอดโอนกรรมสิทธิ์ Q3-Q4 คือโจทย์หลัก งบ Customer Acquisition ต้องชี้แจงทุกบาท",
    "CEO สั่งให้ทุกแผนกช่วยลด CAC กันคนละไม้คนละมือ ยอดโอนกรรมสิทธิ์สะสมยังต่ำกว่าแผนถึง 22 ยูนิต",
    "บริหารความเสี่ยงสภาพคล่องดี แต่การเร่งยอดโอนกรรมสิทธิ์และลด CAC ต้องทำควบคู่กัน อย่าแลกกันคนละด้าน",
    "รอบหน้าขอตัวเลขยอดโอนกรรมสิทธิ์แยกรายโครงการ และแผนลด CAC แบบมี owner ชัดเจน ไม่ใช่แค่สไลด์ประชุม",
    "ให้ความเห็นในบอร์ดเรื่องงบ 2026 ว่าต้องกันงบลด CAC ไว้ก่อน แล้วค่อยขยายตามยอดโอนกรรมสิทธิ์จริง",
]
EXEC_IMPROVE = [
    "จัดตั้ง war room ลด CAC ร่วมฝ่ายขาย-มาร์เก็ตติ้ง ตั้งเป้ายอดโอนกรรมสิทธิ์ Q4",
    "ทบทวนงบ Customer Acquisition รายเดือน + ติดตามยอดโอนกรรมสิทธิ์รายสัปดาห์",
    "ทำแผนลดค่าหาลูกค้า (CAC) และเร่งปิดยอดโอนกรรมสิทธิ์ก่อนสิ้นปี",
    "ล็อกเป้ายอดโอนกรรมสิทธิ์ Q3-Q4 กับทุกสาขาและลด CAC จากการตลาดดิจิทัล",
    "จัดประชุมบอร์ดติดตามอัตราส่วนหนี้สินและยอดโอนกรรมสิทธิ์ทุกไตรมาส",
]
EXEC_STRONG = [
    "ผลักดันเป้ายอดโอนกรรมสิทธิ์ให้ทีมงานทุกฝ่าย",
    "กำหนดกลยุทธ์ลด CAC อย่างเป็นรูปธรรม",
    "สื่อสารเป้ายอดโอนกรรมสิทธิ์กับทีมบริหารชัดเจน",
    "ควบคุมงบ Customer Acquisition และติดตามยอดโอน",
]
EXEC_WEAK = [
    "ควบคุมต้นทุนหาลูกค้า (CAC) ยังไม่นิ่ง",
    "ติดตามยอดโอนกรรมสิทธิ์รายโครงการไม่สม่ำเสมอ",
    "การสั่งการข้ามสายงานยังช้า กระทบเป้ายอดโอน",
    "รายงานตัวเลขการเงินให้บอร์ดล่าช้า",
]


# ── Sales content (Site Visit + กู้แบงก์ไม่ผ่าน + ทิ้งดาวน์) ───────────────
SALES_FEEDBACK = [
    "ทำยอด Site Visit ดี 72 ทริปในไตรมาส แต่ลูกค้ากู้แบงก์ไม่ผ่านเยอะ (12 ราย) ต้องสกรีนลูกค้าก่อนจองจริงจัง",
    "Site Visit เกินเป้า 15% แต่ยอดปิดต่ำเพราะลูกค้ากู้ไม่ผ่าน ต้องประสานแบงก์พันธมิตรและคัดกรองรายได้ให้ดีขึ้น",
    "พาลูกค้าชมโครงการเยอะ แต่โดน Reject เงินกู้บ่อย ต้องเช็คเครดิตบูโรก่อนนัดเข้าชม",
    "ตัวเลข Site Visit ไตรมาสนี้ 64 ทริป ดี แต่สัดส่วนกู้ไม่ผ่าน 18% สูงเกินไป ต้องสกรีนก่อนรับจอง",
    "บริหาร pipeline ดีขึ้น แต่แบงก์ Reject ลูกค้า 9 รายในไตรมาส เสียยอดจองไป สกรีนให้เข้มกว่านี้",
    "Site Visit ดีต่อเนื่อง แต่เจอเคสลูกค้าจองแล้วกู้แบงก์ไม่ผ่าน ต้องมี pre-approve จากธนาคารก่อนจอง",
    "ยอด Site Visit ตามเป้า แต่คุณภาพลีดยังไม่ดี ลูกค้ากู้ไม่ผ่านเยอะ ต้องร่วมกับมาร์เก็ตติ้งสกรีนลีดก่อน",
    "พาลูกค้าเข้าชมโครงการได้ 88 ทริป แต่ปิดการขายได้น้อย เพราะลูกค้ากู้สินเชื่อไม่ผ่าน ต้องปรึกษาไฟแนนซ์ก่อนเสนอโปรเจกต์",
    "Site Visit กระจายทุกสาขาดี แต่ต้องระวังเคสกู้ไม่ผ่านซ้ำ ๆ ให้แบงก์ตรวจเครดิตก่อนรับจอง",
    "ติดตามลูกค้าหลัง Site Visit ดี แต่ Reject เงินกู้ยังเยอะ ต้องมีเกณฑ์สกรีนรายได้-อาชีพร่วมกับแบงก์",
    "พาลูกค้าชมโครงการและเก็บข้อมูล pipeline ดี แต่ลูกค้ากู้แบงก์ไม่ผ่าน 10 ราย เสียเวลาทีมงาน ต้องสกรีนล่วงหน้า",
    "ยอด Site Visit โอเค แต่จองแล้วกู้ไม่ผ่านเยอะ ต้องลดความเสี่ยงด้วยการตรวจเอกสารรายได้ก่อนรับจอง",
]
SALES_IMPROVE = [
    "เพิ่มยอด Site Visit 15% พร้อมสกรีนลูกค้าก่อนนัดเข้าชม",
    "จัดโปรแกรมพาลูกค้าชมโครงการทุกเสาร์-อาทิตย์ และเช็คเครดิตลูกค้าก่อนจอง",
    "ตั้งเป้า Site Visit 80 ทริป/ไตรมาส + ตรวจเอกสารกู้แบงก์ก่อนรับจอง",
    "ร่วมกับแบงก์พันธมิตรทำ pre-approve ลูกค้าก่อนพาชมโครงการ",
    "ปรับเกณฑ์สกรีนลูกค้าและติดตามยอด Site Visit รายสัปดาห์",
]
SALES_STRONG = [
    "พาลูกค้าชมโครงการได้ตามเป้า (Site Visit)",
    "บริหาร pipeline และนัดหมาย Site Visit ได้ดี",
    "ติดตามลูกค้าหลังเข้าชมโครงการอย่างใกล้ชิด",
    "สร้างสัมพันธ์กับแบงก์พันธมิตรเพื่อช่วยลูกค้ากู้ผ่าน",
]
SALES_WEAK = [
    "สกรีนลูกค้าก่อนจองยังหลวม โดน Reject เงินกู้บ่อย",
    "ติดตามยอด Site Visit ตามสาขาไม่สม่ำเสมอ",
    "จัดการเคสลูกค้ากู้แบงก์ไม่ผ่านช้า",
    "บริหารลีดหลังเข้าชมโครงการยังไม่เป็นระบบ",
]

# ── Marketing content (ROAS + lead ต่อ 1 บาท) ────────────────────────────
MKT_FEEDBACK = [
    "ROAS Facebook Ads ไตรมาสนี้ 3.8 เท่า ดี แต่ CPC สูงขึ้น ต้องปรับ creatives กันงบเปลือง",
    "lead ต่อ 1 บาท ดีขึ้นจาก 0.9 เป็น 1.4 แต่ ROAS ยังไม่ถึงเป้า 4 เท่า ต้องยิง Meta Ads ให้ตรงกลุ่ม",
    "Facebook Ads ทำ ROAS 3.2 เท่า ผ่านเป้า แต่ยอดขายต่อลีดลดลง ต้องสกรีนลีดกับฝ่ายขาย",
    "แคมเปญ TikTok เริ่มให้ผล lead ต่อ 1 บาท 1.2 แต่ต้องดัน ROAS รวมให้เกิน 3.5 เท่า",
    "ROAS โดยรวม 3.9 เท่า ดีที่สุดในรอบปี แต่ค่าโฆษณา Facebook พุ่ง ต้องรีบปรับกลยุทธ์ Meta Ads",
    "lead ต่อ 1 บาท ของมหกรรมบ้านและคอนโดต่ำ (0.8) ต้องปรับบูธและแคมเปญให้คุ้มค่า",
    "Facebook Ads มี ROAS ดี แต่ยังพึ่งพาเพจเดียว ต้องกระจายงบไป TikTok และ Google ให้สมดุล",
    "lead ต่อ 1 บาท ยังไม่ถึงเป้า ต้องเพิ่มคอนเทนต์รีวิวโครงการและลดงบโฆษณาที่ ROAS ต่ำ",
    "ROAS ของแคมเปญเปิดตัวโครงการใหม่ 2.9 เท่า ต่ำกว่าเป้า ต้องเจรจา Media ราคาใหม่",
    "บริหารงบ Meta Ads ได้ดี ROAS 4.1 เท่า แต่อย่าลืมเก็บ data lead เพื่อยิงซ้ำ",
]
MKT_IMPROVE = [
    "ตั้งเป้า ROAS 4.0 เท่า และ lead ต่อ 1 บาท ≥ 1.2 ราย",
    "รีวิวแคมเปญ Facebook/Meta Ads รายสัปดาห์ ตัดงบโฆษณา ROAS ต่ำ",
    "เพิ่มคอนเทนต์วิดีโอ TikTok เพื่อลดต้นทุนต่อลีด",
    "เจรจาอัตราค่าโฆษณา Meta กับเอเจนซี่ใหม่ ลด CAC",
    "ทำ A/B test creatives ทุกแคมเปญ หาวัสดุที่ให้ lead ต่อ 1 บาทดีสุด",
]
MKT_STRONG = [
    "บริหาร ROAS ของแคมเปญ Facebook Ads ได้ดี",
    "วางแผนงบโฆษณา Meta/TikTok คุ้มค่า",
    "สร้างคอนเทนต์ที่ให้ lead ต่อ 1 บาทดี",
    "ติดตามผลแคมเปญรายวัน แก้ไขได้ไว",
]
MKT_WEAK = [
    "ติดตาม ROAS รายแคมเปญไม่ทัน",
    "พึ่งพา Facebook Ads มากไป ขาดการกระจายช่องทาง",
    "วิเคราะห์ lead ต่อ 1 บาท ยังไม่ละเอียด",
    "คอนเทนต์วิดีโอ TikTok ยังออกไม่สม่ำเสมอ",
]


# ── Design content (คุณภาพแบบ + ประสานงาน + ดีเลย์) ──────────────────────
DES_FEEDBACK = [
    "คุณภาพแบบดีขึ้น แต่ยังมี Shop Drawing ไม่ตรงดิ่งกับโครงสร้าง ต้องตรวจก่อนส่งหน้างาน",
    "ประสานงานกับทีมวิศวกรดี แต่ BOQ ยังพลาดปริมาณวัสดุ ต้องมี double check",
    "ลูกค้าขอแก้แบบบ่อยจนงานดีเลย์ ต้องตั้ง meeting scope กับลูกค้าก่อนเริ่มออกแบบ",
    "แบบส่งช้าทำให้หน้างานรอ ดีเลย์ 2 สัปดาห์ ต้องวางแผนคิวเขียนแบบให้แน่น",
    "คุณภาพแบบและรายละเอียดดี แต่การแก้แบบกลางงานยังเยอะ ต้องล็อกสเปกกับลูกค้าให้จบก่อน",
    "คุมทีม Draftsman ดีขึ้น แต่ต้องตรวจดิ่งและระนาบเพดานใน Shop Drawing ทุกชุด",
    "ประสาน MEP ได้ดี แต่ BOQ คลาดเคลื่อนเรื่องปริมาณเหล็ก ต้องให้คนที่สองตรวจทาน",
    "ลูกค้าขอเพิ่มห้องทำงานกลางงาน แบบดีเลย์ ต้องเจรจา scope และค่าใช้จ่ายให้ชัด",
    "งานเขียนแบบแปลนอาคารชุดดี แต่ delay จากการรอ decision ลูกค้า ต้องบังคับ deadline",
    "คุณภาพแบบก่อสร้างดี แต่การแก้แบบหลังส่งหน้างานบ่อย กระทบงาน ผรห. ต้องลดให้ได้",
    "ประสานกับฝ่ายขายเรื่องสเปกห้องตัวอย่างดี แต่ BOQ ห้องตัวอย่างพลาด ต้องตรวจทานก่อนส่งจัดซื้อ",
    "แบบตกแต่งภายในสวย แต่ Shop Drawing ชุดเฟอร์นิเจอร์ไม่ตรงดิ่ง ต้อง recheck กับสถาปนิก",
]
DES_IMPROVE = [
    "ตั้งระบบตรวจทาน Shop Drawing (ดิ่ง/ระนาบ) ก่อนส่งหน้างาน 2 ชั้น",
    "ทำ BOQ 2 รอบ (designer + estimator) กันปริมาณคลาดเคลื่อน",
    "จัด meeting ล็อกสเปกกับลูกค้าก่อนเขียนแบบ ลดการแก้แบบกลางงาน",
    "วางแผนคิวเขียนแบบร่วมกับ PM กันงานดีเลย์",
    "บันทึกคำขอแก้แบบลูกค้าทุกครั้ง กัน scope creep",
]
DES_STRONG = [
    "ควบคุมคุณภาพแบบ Shop Drawing ได้ดี",
    "ประสานงานข้ามทีม (MEP/โครงสร้าง) รอบด้าน",
    "บริหารคิวงานเขียนแบบให้ตรงกำหนด",
    "ออกแบบแปลนตอบโจทย์ลูกค้าและงบ",
]
DES_WEAK = [
    "ตรวจทาน BOQ ยังพลาดเรื่องปริมาณวัสดุ",
    "รับมือคำขอแก้แบบลูกค้าไม่ทัน งานดีเลย์",
    "ประสานข้อมูลแบบกับหน้างานล่าช้า",
    "คุมคิว Draftsman ไม่แน่น",
]

KPI_CFG = {
    "Executive": {"feedback": EXEC_FEEDBACK, "improve": EXEC_IMPROVE,
                  "strong": EXEC_STRONG, "weak": EXEC_WEAK,
                  "marker": ["CAC", "ยอดโอน", "กรรมสิทธิ์", "Customer Acquisition"]},
    "Sales": {"feedback": SALES_FEEDBACK, "improve": SALES_IMPROVE,
              "strong": SALES_STRONG, "weak": SALES_WEAK,
              "marker": ["Site Visit", "กู้", "แบงก์", "สกรีน"]},
    "Marketing": {"feedback": MKT_FEEDBACK, "improve": MKT_IMPROVE,
                  "strong": MKT_STRONG, "weak": MKT_WEAK,
                  "marker": ["ROAS", "lead ต่อ 1 บาท", "Facebook", "Meta"]},
    "Design & Architecture": {"feedback": DES_FEEDBACK, "improve": DES_IMPROVE,
                              "strong": DES_STRONG, "weak": DES_WEAK,
                              "marker": ["Shop Drawing", "BOQ", "แก้แบบ", "ดีเลย์", "delay"]},
}


def _enrich_kpi(emp, code, rng, dept, stats):
    recs = rc.sheet_records(emp, "KPI_OKR_History")
    cfg = KPI_CFG.get(dept, KPI_CFG["Executive"])
    if len(recs) >= 3:
        last3 = " ".join(str(r.get("managerFeedback", "")) for r in recs[-3:])
        if any(mk.lower() in last3.lower() for mk in cfg["marker"]):
            return  # already enriched (idempotent)
    start = max(0, len(recs) - 3)
    picks = rc.pick(rng, cfg["feedback"], min(3, len(cfg["feedback"])))
    for idx, txt in zip(range(start, len(recs)), picks):
        recs[idx]["managerFeedback"] = txt
        recs[idx]["improvementPlan"] = rng.choice(cfg["improve"])
        recs[idx]["strongArea"] = rng.choice(cfg["strong"])
        recs[idx]["weakArea"] = rng.choice(cfg["weak"])
        stats["kpi_updated"] += 1
    if len(recs) < 6:
        used = [recs[i].get("managerFeedback", "") for i in range(start, len(recs))]
        pool_avail = [f for f in cfg["feedback"] if f not in used]
        while len(recs) < 6:
            if not pool_avail:
                pool_avail = list(cfg["feedback"])
            fb = rng.choice(pool_avail)
            pool_avail.remove(fb)
            recs.append({
                "kpiScore": round(rng.uniform(2.4, 4.2), 1),
                "okrScore": round(rng.uniform(2.2, 4.0), 1),
                "weakArea": rng.choice(cfg["weak"]),
                "strongArea": rng.choice(cfg["strong"]),
                "reviewPeriod": rng.choice(KPI_TOPUP_PERIODS),
                "followUpStatus": rng.choice(["Completed", "In Progress", "Under Review"]),
                "improvementPlan": rng.choice(cfg["improve"]),
                "managerFeedback": fb,
                "performanceBand": rng.choice(["Meets (C)", "Meets (C)", "Exceeds (B)", "Below (D)"]),
            })
            stats["kpi_rows_added"] += 1
    _set_headers(emp, "KPI_OKR_History",
                 ["reviewPeriod", "kpiScore", "okrScore", "performanceBand", "strongArea",
                  "weakArea", "managerFeedback", "improvementPlan", "followUpStatus"])


# ── Sales Project_History (mortgage rejection + ทิ้งดาวน์) ─────────────────
# (mistakeIssue, recoveryAction) — reject-type rows carry กู้/แบงก์/Reject/สกรีน
SALES_REJECT_MISTAKES = [
    ("ลูกค้ากู้สินเชื่อแบงก์ไม่ผ่าน ต้องคืนเงินจองและดาวน์ 5 หมื่นบาท",
     "ปรับเกณฑ์คัดกรองรายได้/เครดิตบูโรก่อนรับจอง"),
    ("ลูกค้าจองบ้าน 2 หลังแต่กู้แบงก์ไม่ผ่าน ต้องพักจองไว้ก่อน",
     "ประสานแบงก์พันธมิตรให้ pre-approve ลูกค้าก่อนรับจอง"),
    ("ลูกค้าโดน Reject เงินกู้จากแบงก์หลัก ต้องยื่นแบงก์สำรอง เสียเวลา 3 สัปดาห์",
     "เช็คเครดิตบูโร + เอกสารรายได้ให้ครบก่อนนัดจอง"),
    ("ลูกค้ากู้ไม่ผ่านเพราะติดเครดิตบูโร เงินจองต้องคืน",
     "ตั้ง checklist ตรวจเครดิตบูโรลูกค้าก่อนรับจองทุกเคส"),
    ("ลูกค้าขอพักจองหลังแบงก์อนุมัติช้า งานขายสะดุด",
     "ทำตารางติดตามสถานะสินเชื่อรายสัปดาห์ร่วมกับฝ่ายสินเชื่อ"),
    ("ลูกค้า Mortgage ถูกปฎิเสธจากแบงก์ 2 แห่ง ต้องคืนดาวน์เต็มจำนวน",
     "สกรีนความสามารถกู้ด้วยเอกสารรายได้-ภาระหนี้ก่อนรับจอง"),
]
SALES_DROP_MISTAKES = [
    ("ลูกค้าทิ้งดาวน์กลางคัน หลังเปลี่ยนใจไปโครงการคู่แข่ง",
     "ติดตามลูกค้าหลังจองทุกสัปดาห์ + เก็บรายงานเหตุผลยกเลิก"),
    ("ลูกค้าทิ้งดาวน์กลางคันหลังจองแล้ว 4 เดือน ยอดขายหด",
     "กำหนดเงื่อนไขการคืนดาวน์ให้ชัด + สกรีนกำลังซื้อลูกค้า"),
    ("ลูกค้าทิ้งดาวน์เพราะย้ายงานต่างจังหวัด ต้องยกเลิกสัญญา",
     "เจรจาเก็บค่าปรับตามสัญญาและนำยูนิตกลับขายใหม่"),
    ("ลูกค้ายกเลิกการจองหลังผ่อนดาวน์ 6 งวด เพราะเปลี่ยนใจ",
     "เสนอสลับยูนิต/โปรเจกต์แทนการคืนเงิน และรีบปิดยอดใหม่"),
    ("ลูกค้าจองบ้านตัวอย่างแล้วทิ้งดาวน์ กระทบยอดปิดไตรมาส",
     "กันยูนิตห้องตัวอย่างออกจากโปรโมชันทิ้งดาวน์"),
]
SALES_CONTRIB = [
    "ปิดการขายบ้านเดี่ยว 6 ยูนิต มูลค่า 28 ล้านบาทในไตรมาส",
    "พาลูกค้า Site Visit 42 ทริป และปิดยอดจอง 8 ยูนิต",
    "บริหาร pipeline ลูกค้า 60 รายใน CRM และติดตามหลังเข้าชมทุกเคส",
    "เจรจาส่วนลดและเงื่อนไขผ่อนกับลูกค้าให้ปิดยอดได้ตามกรอบราคา",
    "ประสานฝ่ายสินเชื่อช่วยลูกค้าเตรียมเอกสารกู้แบงก์จนอนุมัติ",
]
SALES_OUTCOME = [
    "ได้เรียนรู้การสกรีนลูกค้าก่อนจองให้เข้มขึ้น",
    "รู้จักจัดการเคสลูกค้ากู้ไม่ผ่านโดยไม่เสียสัมพันธ์ลูกค้า",
    "พัฒนาทักษะการเจรจาเงื่อนไขกับแบงก์พันธมิตร",
    "เห็นความสำคัญของการติดตามลูกค้าหลังจองอย่างต่อเนื่อง",
]
SALES_COLLAB_CONFLICTS = [
    ("ขัดแย้งกับฝ่ายสินเชื่อเรื่องลูกค้ากู้แบงก์ไม่ผ่าน ต้องหาแบงก์ใหม่กลางคัน",
     "ตั้งเกณฑ์สกรีนลูกค้าร่วมกันก่อนรับจอง"),
    ("เถียงกับลูกค้าที่โดน Reject เงินกู้ เรื่องการคืนเงินจอง",
     "ประสานแบงก์พันธมิตรช่วยลูกค้า Refinance ยื่นใหม่"),
    ("ไม่พอใจที่มาร์เก็ตติ้งส่งลีดคุณภาพต่ำ ลูกค้ากู้ไม่ผ่านหลายราย",
     "จัดประชุมสกรีนลีดร่วมกับมาร์เก็ตติ้งทุกสัปดาห์"),
    ("มีปากเสียงกับฝ่ายกฎหมายเรื่องสัญญาเงินดาวน์ตอนลูกค้าทิ้งดาวน์",
     "ทบทวนเงื่อนไขการคืนดาวน์ในสัญญาให้ชัดเจน"),
]


def _enrich_sales_projects(emp, code, rng, stats):
    recs = rc.sheet_records(emp, "Project_History")
    mark = ["กู้", "แบงก์", "Reject", "สกรีน", "ทิ้งดาวน์", "ดาวน์", "จอง", "พักจอง"]
    existing = sum(1 for r in recs if r.get("hasMistake") == "Yes"
                   and any(m in str(r.get("mistakeIssue", "")) for m in mark))
    if existing >= 2:
        return  # already enriched (idempotent)
    role = _role_for(emp.get("jobTitle", ""))
    target = rng.randint(2, 4)
    rows = []
    while existing + len(rows) < target:
        has_reject = any(any(m in str(r.get("mistakeIssue", ""))
                             for m in ["กู้", "แบงก์", "Reject", "สกรีน"]) for r in rows)
        has_drop = any(any(m in str(r.get("mistakeIssue", ""))
                           for m in ["ทิ้งดาวน์", "ดาวน์", "จอง", "พักจอง"]) for r in rows)
        if not has_reject:
            mi, rec = rng.choice(SALES_REJECT_MISTAKES)
        elif not has_drop:
            mi, rec = rng.choice(SALES_DROP_MISTAKES)
        else:
            mi, rec = rng.choice(SALES_REJECT_MISTAKES if rng.random() < 0.5
                                 else SALES_DROP_MISTAKES)
        rows.append({
            "role": role,
            "projectId": _pick_proj(rng, emp),
            "hasMistake": "Yes",
            "mistakeIssue": mi,
            "recoveryAction": rec,
            "individualOutcome": rng.choice(SALES_OUTCOME),
            "contributionSummary": rng.choice(SALES_CONTRIB),
        })
    rc.add_records(emp, "Project_History", rows)
    _set_headers(emp, "Project_History",
                 ["projectId", "role", "contributionSummary", "individualOutcome",
                  "hasMistake", "mistakeIssue", "recoveryAction"])
    stats["sales_proj_rows_added"] += len(rows)


def _enrich_sales_collab(emp, code, rng, stats):
    recs = rc.sheet_records(emp, "Collaboration_Network")
    conflicts = [r for r in recs if r.get("hasConflict") == "Yes"]
    done = 0
    for r in conflicts:
        if done >= 2:
            break
        txt = str(r.get("conflictSummary", ""))
        if any(m in txt for m in ["กู้", "แบงก์", "ดาวน์", "สกรีน"]):
            continue
        summary, resolution = rng.choice(SALES_COLLAB_CONFLICTS)
        r["conflictSummary"] = summary
        r["resolutionSummary"] = resolution
        stats["sales_collab_updated"] += 1
        done += 1


# ── Design Project_History (Shop Drawing / BOQ / แก้แบบ ดีเลย์) ────────────
# Each mistake row tags one or more audit themes:
#   SHOPDRAW: Shop Drawing / ดิ่ง / ไม่ตรง   BOQ: BOQ / ปริมาณ / พลาด / คลาดเคลื่อน
#   CHANGE: แก้แบบ / แปลน / ดีเลย์ / delay / ลูกค้าขอ
DES_SHOP_MISTAKES = [
    ("แบบ Shop Drawing ระนาบเพดานไม่ตรงดิ่งกับแกนโครงสร้าง ต้องแก้แบบหน้างาน",
     "ตรวจ clash ระหว่างแบบสถาปัตย์-โครงสร้างก่อนส่งหน้างาน"),
    ("แบบ Shop Drawing บันไดไม่ตรงดิ่งกับคาน หน้างานต้องรื้อแก้",
     "recheck ดิ่ง-ระนาบทุกชุดแบบก่อนออกเลขแบบ"),
    ("แบบ Shop Drawing ชุดห้องน้ำไม่ตรงกับแบบโครงสร้าง งานเดินท่อผิด",
     "ให้สถาปนิกตรวจทานแบบคู่กับแบบโครงสร้างทุกชุด"),
]
DES_BOQ_MISTAKES = [
    ("คำนวณ BOQ พลาดปริมาณกระเบื้อง เกินงบ 2.1 ล้าน ต้องทำ VE (Value Engineering)",
     "ทำ BOQ 2 รอบ ใช้คนตรวจทานอิสระก่อนส่งจัดซื้อ"),
    ("BOQ ปริมาณเหล็กคลาดเคลื่อน 15% ต้องขออนุมัติงบเพิ่ม",
     "เทียบ BOQ กับแบบจริงรายห้องก่อนส่งประมาณราคา"),
    ("คำนวณ BOQ พลาดปริมาณสีและฝ้า ต้องเบิกงบเพิ่ม 0.9 ล้าน",
     "ใช้สูตรคำนวณปริมาณมาตรฐาน + ให้คนที่สองตรวจทาน"),
    ("BOQ วัสดุตกแต่งพลาดปริมาณ ต้องทำ VE กับทีมจัดซื้อกลางทาง",
     "ล็อก spec วัสดุกับลูกค้าให้จบก่อนคิด BOQ"),
]
DES_CHANGE_MISTAKES = [
    ("ลูกค้าขอแก้แบบแปลนห้องนอนชั้น 2 กลางงาน งานดีเลย์ไป 3 สัปดาห์",
     "ตั้ง meeting ล็อกสเปกกับลูกค้าก่อนเริ่มเขียนแบบ"),
    ("ลูกค้าขอเพิ่มห้องทำงานกลางงาน ดีเลย์การส่งแบบ MEP 2 สัปดาห์",
     "บันทึกคำขอแก้แบบลูกค้าทุกครั้งและแจ้งผลกระทบ timeline"),
    ("ลูกค้าขอเปลี่ยนวัสดุพื้นกลางงาน แบบและ BOQ ต้องแก้ใหม่ delay 10 วัน",
     "ล็อก spec วัสดุกับลูกค้าให้จบก่อนส่ง BOQ"),
    ("ลูกค้าขอแก้แบบระเบียงห้องครัว งานดีเลย์เพราะรอ decision",
     "บังคับ deadline การตัดสินใจลูกค้าในสัญญาแบบ"),
]
DES_CONTRIB = [
    "ออกแบบแปลนบ้านเดี่ยว 3 แบบส่งให้ฝ่ายขายใช้เปิดตัวโครงการ",
    "เขียนแบบ Shop Drawing ชุดอาคารชุด 8 ชั้น ครบทุกระบบ",
    "ทำ BOQ และประมาณราคาโครงการ townhome ให้ฝ่ายจัดซื้อ",
    "ปรับแบบตาม Feedback ลูกค้าและส่งมอบแบบก่อสร้างตรงกำหนด",
    "ประสานทีม MEP รวมแบบให้ตรงก่อนส่งหน้างาน",
]
DES_OUTCOME = [
    "ได้เรียนรู้การตรวจแบบก่อนส่งหน้างานให้ละเอียดขึ้น",
    "เห็นผลกระทบของ BOQ พลาดต่องบโครงการโดยตรง",
    "พัฒนาทักษะการเจรจา scope กับลูกค้าให้จบไว",
    "รู้จักวางคิวงานเขียนแบบไม่ให้งานดีเลย์",
]


def _enrich_design_projects(emp, code, rng, stats):
    recs = rc.sheet_records(emp, "Project_History")
    mark = ["Shop Drawing", "ดิ่ง", "BOQ", "ปริมาณ", "แก้แบบ", "แปลน", "ดีเลย์", "delay", "ลูกค้าขอ"]
    existing = sum(1 for r in recs if r.get("hasMistake") == "Yes"
                   and any(m in str(r.get("mistakeIssue", "")) for m in mark))
    if existing >= 3:
        return  # already enriched (idempotent)
    role = _role_for(emp.get("jobTitle", ""))
    target = rng.randint(3, 4)
    # always cover all 3 themes first, then pad with rng picks
    picks = [rng.choice(DES_SHOP_MISTAKES), rng.choice(DES_BOQ_MISTAKES),
             rng.choice(DES_CHANGE_MISTAKES)]
    while len(picks) < target:
        pool = rng.choice([DES_SHOP_MISTAKES, DES_BOQ_MISTAKES, DES_CHANGE_MISTAKES])
        picks.append(rng.choice(pool))
    rows = []
    for mi, rec in picks:
        rows.append({
            "role": role,
            "projectId": _pick_proj(rng, emp),
            "hasMistake": "Yes",
            "mistakeIssue": mi,
            "recoveryAction": rec,
            "individualOutcome": rng.choice(DES_OUTCOME),
            "contributionSummary": rng.choice(DES_CONTRIB),
        })
    rc.add_records(emp, "Project_History", rows)
    _set_headers(emp, "Project_History",
                 ["projectId", "role", "contributionSummary", "individualOutcome",
                  "hasMistake", "mistakeIssue", "recoveryAction"])
    stats["design_proj_rows_added"] += len(rows)


# ── Marketing Expense_Reports line items ──────────────────────────────────
# (Category, Description template, min_THB, max_THB)
EXPENSE_TEMPLATES = [
    ("Facebook Ads", "ค่าโฆษณา Facebook Ads (Meta Ads Manager) แคมเปญเปิดตัวโครงการ {proj}", 18000, 85000),
    ("TikTok Ads", "ค่าโฆษณา TikTok Ads คอนเทนต์รีวิวโครงการ {proj}", 12000, 60000),
    ("Exhibition / Expo", "ค่าออกบูธงานมหกรรมบ้านและคอนโด (ค่าสแตนด์ ค่าไฟ ค่าพนักงานประจำบูธ) {proj}", 150000, 450000),
    ("Influencer Marketing", "ค่าอินฟลูเอนเซอร์รีวิวโครงการบ้านตัวอย่าง {proj}", 30000, 120000),
    ("Photography / Drone", "ค่าถ่ายภาพโดรนมุมสูงและ 360 องศาโครงการ {proj}", 12000, 40000),
    ("Google Ads", "ค่าโฆษณา Google Ads คีย์เวิร์ดบ้าน/คอนโดรอบโครงการ {proj}", 15000, 45000),
    ("Event Materials", "ค่าพริ้นท์โบรชัวร์-ป้ายประชาสัมพันธ์งานเปิดตัวโครงการ {proj}", 20000, 90000),
    ("Media / PR", "ค่าวางสื่อออนไลน์รีวิวโครงการ {proj} รอบเปิดตัว", 25000, 80000),
]
EXPENSE_DESCS = {
    "Facebook Ads": ["ค่าโฆษณา Facebook Ads (Meta Ads Manager) แคมเปญเปิดตัวโครงการ {proj}",
                     "ค่า Boost เพจ Facebook แคมเปญโปรโมชันบ้านตัวอย่าง {proj}"],
    "TikTok Ads": ["ค่าโฆษณา TikTok Ads คอนเทนต์รีวิวโครงการ {proj}",
                   "ค่าโฆษณา TikTok Ads แคมเปญพาลูกค้าชมโครงการ {proj}"],
    "Exhibition / Expo": ["ค่าออกบูธงานมหกรรมบ้านและคอนโด (ค่าสแตนด์ ค่าไฟ ค่าพนักงานประจำบูธ) {proj}",
                          "ค่าบูธงาน Home & Condo Expo พร้อมค่าจัดนิทรรศการ {proj}"],
}
EXPENSE_STATUS = ["Approved", "Approved", "Approved", "Pending", "Rejected"]
EXPENSE_APPROVERS = ["ฝ่ายการเงิน (AP)", "ฝ่ายการเงิน (AP)", "ผู้อำนวยการฝ่ายการเงิน"]


def _enrich_expenses(emp, code, rng, stats):
    recs = rc.sheet_records(emp, "Expense_Reports")
    if any("Date" in r for r in recs):
        return  # already enriched (idempotent marker = line-item columns exist)
    proj = _pick_proj(rng, emp)
    manager = emp.get("managerName") or "ฝ่ายการเงิน (AP)"
    rows = []
    # guarantee FB + TikTok + Expo rows first
    for cat in ["Facebook Ads", "TikTok Ads", "Exhibition / Expo"]:
        desc_tpl = rng.choice(EXPENSE_DESCS[cat])
        lo, hi = next((t[2], t[3]) for t in EXPENSE_TEMPLATES if t[0] == cat)
        rows.append({
            "Date": _rand_date(rng, 2024, 2026),
            "Category": cat,
            "Description": desc_tpl.format(proj=proj),
            "Amount_THB": rng.randint(lo, hi),
            "Status": rng.choice(EXPENSE_STATUS),
            "Approver": manager if rng.random() < 0.6 else rng.choice(EXPENSE_APPROVERS),
        })
    extras = rng.randint(1, 3)
    pool = [t for t in EXPENSE_TEMPLATES if t[0] not in EXPENSE_DESCS]
    for t in rng.sample(pool, min(extras, len(pool))):
        cat, tpl, lo, hi = t
        rows.append({
            "Date": _rand_date(rng, 2024, 2026),
            "Category": cat,
            "Description": tpl.format(proj=proj),
            "Amount_THB": rng.randint(lo, hi),
            "Status": rng.choice(EXPENSE_STATUS),
            "Approver": manager if rng.random() < 0.6 else rng.choice(EXPENSE_APPROVERS),
        })
    rc.add_records(emp, "Expense_Reports", rows)
    _set_headers(emp, "Expense_Reports",
                 ["Date", "Category", "Description", "Amount_THB", "Status", "Approver"])
    stats["expense_rows_added"] += len(rows)


# ── Skill_Matrix augmentation (guarantee >=3 X-SKILL keyword rows) ────────
SKILL_EXTRA_BY_DEPT = {
    "Executive": [
        ("Excel / Pivot วิเคราะห์ P&L งบโครงการ", None),
        ("M365 (Teams/Outlook ประชุมบอร์ด)", None),
        ("CRM ติดตามยอดโอน (in-house)", None),
        ("ตรวจหน้างานเยี่ยมโครงการ (Site Visit)", None),
    ],
    "Sales": [
        ("Facebook Ads / ดูแลเพจขายบ้าน", None),
        ("M365 Outlook ติดตามลูกค้า", None),
        ("ตรวจหน้างาน/นัดลูกค้าเข้าชมโครงการ", None),
    ],
    "Marketing": [
        ("CRM (HubSpot) จัดการ Lead", None),
        ("Excel / Pivot วิเคราะห์ ROAS", None),
        ("ตรวจหน้างานถ่ายคอนเทนต์โครงการ", None),
    ],
    "Design & Architecture": [
        ("ตรวจหน้างาน QC แบบ-As Built", None),
        ("Excel / Pivot คุม BOQ", None),
        ("BIM 360 / Navisworks Clash Detection", None),
    ],
}
SKILL_NOTES_BY_DEPT = {
    "Executive": [
        "ใช้จริงทุกวันในการประชุมบอร์ดและติดตามยอดโอน",
        "ต้องอัปเดตเทรนด์การเงินอสังหาฯ ต่อเนื่อง",
        "ใช้ติดตามผลงานทีมบริหารรายเดือน",
        "ยังต้องพัฒนาทักษะดิจิทัลเพิ่ม",
    ],
    "Sales": [
        "ใช้ในงานจริงทุกวัน ปิดการขายทุกเคส",
        "ต้องพัฒนาต่อ เรื่องสกรีนลูกค้าก่อนจอง",
        "ใช้ติดตาม pipeline รายสัปดาห์",
        "ใช้คู่กับ CRM ในการติดตามลูกค้าหลังเข้าชม",
    ],
    "Marketing": [
        "ใช้จริงทุกวัน ยิงแคมเปญรายสัปดาห์",
        "ต้องพัฒนาต่อเรื่อง data analytics",
        "ใช้วิเคราะห์ ROAS ทุกแคมเปญ",
        "ใช้คู่กับ Meta Ads Manager ในการยิงโฆษณา",
    ],
    "Design & Architecture": [
        "ใช้ในงานจริงทุกวัน เขียนแบบส่งหน้างาน",
        "ต้องพัฒนาต่อเรื่อง BIM เวอร์ชันใหม่",
        "ใช้คู่กับ BOQ ตรวจปริมาณวัสดุ",
        "ยังต้องฝึกเรื่องการประสาน MEP ให้แน่นขึ้น",
    ],
}


def _fill_skill_matrix(emp, code, rng, stats):
    dept = emp.get("department", "")
    recs = emp.get("sheets", {}).get("Skill_Matrix", {}).get("records", [])
    if recs and all("Skill_Level" in r for r in recs) and all(r.get("Notes") for r in recs):
        stats["skill_rows"] += len(recs)
        return  # already enriched (idempotent)
    rows = rc.skill_rows(code, dept, rng)
    have = {r["Core_Skill"] for r in rows}
    notes_pool = SKILL_NOTES_BY_DEPT.get(dept, SKILL_NOTES_BY_DEPT["Executive"])
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
        "headers": ["Core_Skill", "Certification", "Language_Score_IELTS",
                    "Skill_Level", "Last_Assessed", "Notes"],
        "records": rows,
    }
    stats["skill_rows"] += len(rows)


# ── public API ────────────────────────────────────────────────────────────
def apply(employees):
    stats = {"employees_enriched": 0, "kpi_updated": 0, "kpi_rows_added": 0,
             "sales_proj_rows_added": 0, "design_proj_rows_added": 0,
             "expense_rows_added": 0, "sales_collab_updated": 0, "skill_rows": 0,
             "departments": {}}
    for dept in ["Executive", "Sales", "Marketing", "Design & Architecture"]:
        for code in rc.codes_in(employees, dept):
            emp = employees[code]
            rng = rc.rng_for(code, "cluster_a")
            stats["employees_enriched"] += 1
            stats["departments"][dept] = stats["departments"].get(dept, 0) + 1
            _fill_skill_matrix(emp, code, rng, stats)
            _enrich_kpi(emp, code, rng, dept, stats)
            if dept == "Sales":
                _enrich_sales_projects(emp, code, rng, stats)
                _enrich_sales_collab(emp, code, rng, stats)
            elif dept == "Design & Architecture":
                _enrich_design_projects(emp, code, rng, stats)
            elif dept == "Marketing":
                _enrich_expenses(emp, code, rng, stats)
    return stats


# ── self-check coverage (mirrors audit_realism.py CHECKS for Cluster A) ───
SELF_CHECKS = [
    ("EXEC-CAC", "Executive",
     ["KPI_OKR_History"], ["managerFeedback", "improvementPlan", "strongArea"],
     ["CAC", "Customer Acquisition", "ค่าหาลูกค้า", "กรรมสิทธิ์", "ยอดโอน", "โอน"], 0.8),
    ("EXEC-TRANSFER", "Executive",
     ["KPI_OKR_History", "Project_History"], ["managerFeedback", "contributionSummary"],
     ["โอน", "กรรมสิทธิ์", "ส่งมอบ", "ยอดปิดการขาย"], 0.8),
    ("SALES-REJECT", "Sales",
     ["KPI_OKR_History", "Project_History", "Collaboration_Network"],
     ["managerFeedback", "mistakeIssue", "recoveryAction", "individualOutcome", "conflictSummary"],
     ["กู้", "ไม่ผ่าน", "Reject", "แบงก์", "Mortgage", "สกรีน"], 0.7),
    ("SALES-DROP", "Sales",
     ["KPI_OKR_History", "Project_History", "Collaboration_Network"],
     ["managerFeedback", "mistakeIssue", "conflictSummary"],
     ["ทิ้งดาวน์", "ดาวน์", "จอง", "พักจอง"], 0.5),
    ("SALES-SITEVISIT", "Sales", ["KPI_OKR_History"],
     ["managerFeedback", "improvementPlan", "strongArea"],
     ["Site Visit", "ชมโครงการ", "พาลูกค้า", "เข้าชม"], 0.8),
    ("MKT-FB", "Marketing", ["Expense_Reports", "KPI_OKR_History"],
     ["Description", "Category", "Notes", "managerFeedback"], ["Facebook", "Meta", "Ads"], 0.7),
    ("MKT-TIKTOK", "Marketing", ["Expense_Reports", "KPI_OKR_History"],
     ["Description", "Category", "Notes", "managerFeedback"], ["TikTok", "TikTok Ads"], 0.6),
    ("MKT-EXPO", "Marketing", ["Expense_Reports", "KPI_OKR_History"],
     ["Description", "Category", "Notes", "managerFeedback"],
     ["มหกรรม", "บูธ", "งานบ้านและคอนโด", "Home & Condo", "Expo"], 0.6),
    ("DES-SHOPDRAW", "Design & Architecture", ["Project_History", "KPI_OKR_History"],
     ["mistakeIssue", "managerFeedback", "recoveryAction"], ["Shop Drawing", "ดิ่ง", "ไม่ตรง"], 0.6),
    ("DES-BOQ", "Design & Architecture", ["Project_History", "KPI_OKR_History"],
     ["mistakeIssue", "managerFeedback", "recoveryAction"],
     ["BOQ", "ปริมาณ", "พลาด", "คลาดเคลื่อน"], 0.6),
    ("DES-CHANGE", "Design & Architecture", ["Project_History", "KPI_OKR_History"],
     ["mistakeIssue", "managerFeedback", "recoveryAction"],
     ["แก้แบบ", "แปลน", "ดีเลย์", "delay", "ลูกค้าขอ"], 0.6),
]


def _collect_text(emp, sheets, fields):
    parts = []
    for sname in sheets:
        for rec in emp.get("sheets", {}).get(sname, {}).get("records", []):
            for k, v in rec.items():
                if k in fields:
                    parts.append(f"{k}: {v}")
    return "\n".join(str(x) for x in parts)


def _coverage(employees):
    out = {}
    cluster_a_codes = set()
    for dept in ["Executive", "Sales", "Marketing", "Design & Architecture"]:
        cluster_a_codes.update(rc.codes_in(employees, dept))
    for cid, dept, sheets, fields, keywords, thr in SELF_CHECKS:
        codes = rc.codes_in(employees, dept)
        matched = [c for c in codes
                   if any(k.lower() in _collect_text(employees[c], sheets, fields).lower()
                          for k in keywords)]
        out[cid] = (len(matched), len(codes), len(matched) / len(codes) if codes else 0.0)
    # X-SKILL scoped to the 62 employees this cluster owns; the coordinator's
    # full audit (A+B+C+D+perfection) validates all 150 → 150/150 (see report).
    skill_ok = 0
    for c in sorted(cluster_a_codes):
        recs = employees[c].get("sheets", {}).get("Skill_Matrix", {}).get("records", [])
        real = [r for r in recs
                if any(k.lower() in str(r.get("Core_Skill", "")).lower() for k in X_SKILL_KEYWORDS)]
        if len(real) >= 3:
            skill_ok += 1
    out["X-SKILL(cluster A)"] = (skill_ok, len(cluster_a_codes),
                                 skill_ok / len(cluster_a_codes) if cluster_a_codes else 0.0)
    return out


def _sheet_row_counts(employees, names):
    return {n: sum(len(e.get("sheets", {}).get(n, {}).get("records", []))
                   for e in employees.values()) for n in names}


def main(argv=None):
    employees = rc.load_employees()
    stats = apply(employees)
    smoke = rc.save_smoke(employees, "cluster_a_smoke")
    print(f"Cluster A applied → {stats['employees_enriched']} employees enriched")
    print(f"  stats: {json.dumps(stats, ensure_ascii=False)}")
    print(f"  smoke saved → {smoke}")
    cov = _coverage(employees)
    all_pass = True
    for cid, (m, t, pct) in cov.items():
        thr = next((c[5] for c in SELF_CHECKS if c[0] == cid), 1.0)
        ok = pct >= thr
        all_pass = all_pass and ok
        flag = "PASS" if ok else "FAIL"
        print(f"  {cid:16s} {m:3d}/{t:<3d} {pct:5.1%}  (threshold {thr:.0%})  {flag}")
    # idempotency: second apply must not grow row counts
    names = ["KPI_OKR_History", "Project_History", "Expense_Reports", "Skill_Matrix"]
    before = _sheet_row_counts(employees, names)
    stats2 = apply(employees)
    after = _sheet_row_counts(employees, names)
    grew = {n for n in names if after[n] != before[n]}
    print(f"  idempotency: {before} → {after}  {'OK (no growth)' if not grew else f'GROWTH in {grew}'}")
    print(f"  OVERALL: {'ALL PASS' if all_pass else 'HAS FAILURES'}")
    return 0 if all_pass and not grew else 1


if __name__ == "__main__":
    sys.exit(main())

