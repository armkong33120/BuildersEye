#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dept_cluster_b.py — Cluster B realism: Engineering & Construction (38),
Procurement & Warehouse (12), Customer Service & Warranty (12) = 62 employees.

Owns (mutates the in-memory dict only; coordinator persists):
  * Timesheet_Log     — Engineering: 3-5 OT-heavy rows (OT ข้ามคืนเทปูน, CPAC,
                        แรงงานต่างด้าว, ผรห. ทิ้งงาน) with Week/Date/Overtime/
                        Missing_Punch/Notes.
  * Project_History   — Engineering: 3 mistake rows/person (ผรห. ทิ้งงาน,
                        ปูน CPAC เข้าหน้างานช้า, ขาดแคลนแรงงานต่างด้าว).
  * KPI_OKR_History   — all 62: managerFeedback of last 3 rows rewritten in
                        department-flavored Thai + 1 fresh row (6 total).
  * Grievance_Log     — Procurement: 3 rows/person (เหล็กเส้นช้า, กระเบื้อง
                        สีเพี้ยน, logistics) with Description/Resolution/Against.
  * IT_Ticket_Log     — Customer Service: 4-5 defect tickets/person
                        (น้ำรั่วขอบหน้าต่างอลูมิเนียม, กระเบื้องร่อน/โปร่ง,
                        ผนังร้าว Latent, พื้นลามิเนตยวบ).
  * Collaboration_Network — Engineering bonus: Thai construction conflict rows.
  * Skill_Matrix      — all 62: rc.skill_rows + guaranteed >=3 X-SKILL keyword
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

# ── shared constants ──────────────────────────────────────────────────────
WEEK_NUMBERS = [23, 24, 25, 26, 27, 28, 29, 30]
PRJ_FALLBACK = [f"PRJ{i:03d}" for i in range(1, 70)]
CS_PROJ_POOL = ["PRJ041", "PRJ047", "PRJ052", "PRJ055", "PRJ058", "PRJ061", "PRJ064"]
X_SKILL_KEYWORDS = ["AutoCAD", "Revit", "BIM", "SketchUp", "ตรวจหน้างาน",
                    "BOQ", "M365", "CRM", "Facebook", "Excel"]

ROLE_BY_TITLE = {
    "Construction Manager": "Construction Manager",
    "Project Manager": "Project Manager",
    "Site Engineer": "Site Engineer",
    "Foreman": "Foreman",
    "QA/QC Officer": "QA/QC Officer",
    "Safety Officer (จป.)": "Safety Officer (จป.)",
    "Planning Engineer": "Planning Engineer",
}
# ── Timesheet_Log content (Engineering) ───────────────────────────────────
# Every OT note carries at least one ENG-OT keyword: OT / เทปูน / ข้ามคืน / คอนกรีต
OT_NOTES = [
    "อยู่ OT ข้ามคืนเทปูนพื้นชั้น 4 ถึงตี 2 รถมิกเซอร์ CPAC มาสายเกือบ 4 ชม. รอนานมาก",
    "OT เก็บงานสกรีดพื้นให้ทันกำหนดส่งมอบ แต่ลืมส่งใบขออนุมัติ OT",
    "เทปูนเสาเข็มหน้าฝน งานล่าช้าเพราะแรงงานต่างด้าวกลับบ้านช่วงเทศกาล",
    "อยู่ OT ข้ามคืนเทคอนกรีตเสา-คาน ชั้น 7 กับทีม ผรห. งานดันเพราะมิกเซอร์ติด ๆ ขัด ๆ",
    "อยู่หน้างาน OT ต่อเนื่อง 2 คืน รอเทปูนพื้นลานจอดรถ กำหนดส่งมอบสัปดาห์หน้า",
    "เทปูนกันซึมดาดฟ้า ต้องอยู่ OT เก็บงานให้จบก่อนฝนถล่ม",
    "OT ข้ามคืนตามรถคอนกรีต CPAC ที่เข้าหน้างานช้า สลับกะพักให้ช่าง",
    "คุมเทปูนพื้นชั้น 3 OT ถึงเที่ยงคืน เพราะ ผรห. งานเหล็กส่งมอบช้า",
    "อยู่ OT ตรวจรับงานเทคอนกรีตฐานราก ตรวจพบเหล็กเสริมไม่ตรงแบบ ต้องสั่งหยุดงาน",
    "เทปูนคานชั้นดาดฟ้า อยู่ OT ข้ามคืนเพราะมิกเซอร์ CPAC มา 2 คันสุดท้ายตอน 2 ทุ่ม",
]

REGULAR_NOTES = [
    "เก็บงานบริเวณพื้นทางเดินชั้น 2 ตรวจพบกระเบื้องโปร่ง ต้องรื้อปูใหม่บางจุด",
    "ประสาน ผรห. งานระบบเรื่องท่อน้ำทิ้งตัน ต้องเจียรพื้นเปลี่ยนท่อ ใช้เวลา 2 วัน",
    "ตรวจรับเหล็กเส้นรอบสัปดาห์ เจอเหล็กคละล็อตต้องคัดแยกและติดต่อฝ่ายจัดซื้อ",
    "ประชุม weekly กับฝ่ายขายเรื่องลูกค้าขอเปลี่ยนสเปกกระเบื้องห้องน้ำ",
    "ไล่ตรวจ QC งานฉาบผนัง พบรอยร้าวแนวเสา ต้องเรียก ผรห. กลับมาแก้",
    "ทำตารางเทคอนกรีตเดือนหน้า ประสาน CPAC ล่วงหน้า กันรถมาสาย",
    "ตรวจสอบแบบ Shop Drawing กับทีม Design เรื่องดิ่งบันได ไม่ตรงต้องแก้แบบ",
    "ดูแลงานกันซึมดาดฟ้า เจอจุดรั่วซึมต้องอุดซ้ำกับทีมงาน",
]

# ── Project_History content (Engineering, mistake rows) ───────────────────
# SUBCON rows: ผรห. / ผู้รับเหมา / ทิ้งงาน / ซัพคอน
SUBCON_ROWS = [
    ("ผู้รับเหมาช่วง (ผรห.) งานตกแต่งทิ้งงานกลางคันหลังเบิกเงินล่วงหน้า ต้องเปลี่ยน ผรห. ใหม่กลางโครงการ",
     "เรียกประชุม ผรห. รายสัปดาห์ + ตั้งกองหน้าไว้ที่ไซต์"),
    ("ผรห. งานฉาบปูนทิ้งงานกลางคันหลังเบิกเงินล่วงหน้า ต้องเปลี่ยนตัวใหม่กลางโครงการ",
     "ตั้งกองหน้าไว้ที่ไซต์ + ตรวจสอบสถานะการเงิน ผรห. ทุกเดือนก่อนจ่ายงวด"),
    ("ซัพคอนงานหลังคาเหล็กลักพาคนงานไปอีกไซต์ งานหยุด 3 วัน",
     "ทำสัญญาเจาะจงห้ามย้ายคนงานข้ามไซต์โดยไม่แจ้ง + ปรับเป็นรายงานคนงานรายวัน"),
    ("ผู้รับเหมาช่วงงานไฟฟ้าไม่ส่งคนตามแผน กระทบงานเทปูนเสา ต้องเร่งเบิกงานใหม่",
     "สำรอง ผรห. ตัวสำรองในงานวิกฤต + จ่ายงานเป็นงวดตามผลงาน"),
    ("ผรห. ทาสีทิ้งงาน งานตกแต่งค้าง ส่งมอบบ้านเลื่อน 2 สัปดาห์",
     "ตัดสินใจเปลี่ยน ผรห. ทาสีกลางทาง + เรียกหนี้คืนตามสัญญา"),
]
CPAC_ROWS = [
    ("ปูน CPAC เข้าหน้างานช้า 4 ชม. เทคอนกรีตไม่ทัน ต้องขออนุมัติทำงานล่วงเวลา",
     "ทำตารางเทคอนกรีตล่วงหน้าและสำรอง ผรห. ตัวสำรอง"),
    ("คอนกรีต CPAC มาสาย 3 ชม. คอนกรีตเริ่มเซ็ตตัว ต้องทิ้งของ 1 มิกเซอร์",
     "กันเงินค่าเสียหายจาก supplier + เปลี่ยนรอบเทเป็นเช้ามืด"),
    ("เทคอนกรีตไม่ทันรอบ เพราะ CPAC เข้าหน้างานช้า ต้องขอ OT ข้ามคืนเก็บงาน",
     "ทำตารางเทคอนกรีตล่วงหน้าและสำรอง ผรห. ตัวสำรอง"),
    ("ปูน CPAC รอบเทเสาเข็มมาสาย รถติดช่วงเช้า งานดีเลย์ทั้งวัน",
     "ประสาน CPAC ใช้โรงปูนสาขาใกล้ไซต์ + ล็อกเวลาเข้าหน้างานในสัญญา"),
]
LABOR_ROWS = [
    ("ขาดแคลนแรงงานต่างด้าวช่วงหน้ามรสุม งานโครงสร้างดีเลย์ 2 สัปดาห์",
     "ประสานสำนักงานจัดหางานนำเข้าแรงงาน MOU ล่วงหน้า"),
    ("แรงงานต่างด้าวกลับบ้านช่วงสงกรานต์ งานก่ออิฐ-ฉาบชะลอตัว 2 สัปดาห์",
     "วางแผนวันหยุดแรงงานล่วงหน้า + จ้างแรงงานไทยเสริมช่วง peak"),
    ("ขาดแคลนแรงงานต่างด้าว งานโครงสร้างดีเลย์ ต้องดึงคนจากไซต์อื่นมาช่วย",
     "จัดสรรแรงงานข้ามไซต์ + ขึ้นค่าล่วงเวลาให้จูงใจ"),
    ("แรงงานขาดแคลนช่วงเปิดเทอม แรงงานต่างด้าวย้ายงานบ่อย",
     "ทำสัญญาจ้างรายปีกับนายหน้าแรงงาน + ปรับค่าครองชีพในแคมป์"),
]
CONTRIB_SUMMARY = [
    "คุมงานเทคอนกรีตเสา-คานและประสาน ผรห. งานตกแต่งตามแผน",
    "ดูแลงานโครงสร้างส่วนฐานราก-เสา ตรวจเหล็กเสริมก่อนเทปูนทุกจุด",
    "คุมงานก่ออิฐ-ฉาบ-ปูกระเบื้อง ตรวจรับงาน ผรห. รายสัปดาห์",
    "บริหารตารางเทคอนกรีตและประสาน CPAC/รถมิกเซอร์เข้าไซต์",
    "ตรวจ QC งานโครงสร้าง + จัดทำรายงานความคืบหน้าให้ PM ทุกสัปดาห์",
    "ควบคุมงานระบบกันซึม-ดาดฟ้า และตรวจรับงานส่งมอบกับฝ่ายขาย",
]
INDIV_OUTCOME = [
    "ได้เรียนรู้การจัดการวิกฤตหน้างานและแก้ปัญหาร่วมกับทีม ผรห.",
    "ได้รับคำชมจาก CM เรื่องการควบคุมงานที่รัดกุม",
    "ปรับปรุงกระบวนการตรวจรับงานและลด Defect งานสถาปัตย์ได้",
    "พัฒนาทักษะการเจรจากับ ผรห. และการบริหารความเสี่ยงหน้างาน",
    "ส่งมอบงานตามกำหนดแม้มีปัญหาวัสดุ-แรงงานระหว่างทาง",
]

# ── KPI_OKR_History content (all 62) ──────────────────────────────────────
ENG_KPI_FEEDBACK = [
    "คุมงานดี แต่ OT เยอะเกินงบ ต้องบริหารคนหน้างานให้พอ",
    "สกิลคุม ผรห. (ผู้รับเหมา) ดีมาก แต่อยากให้ลด Defect งานสถาปัตย์ตอนส่งมอบงาน",
    "ปูน CPAC เข้าหน้างานช้าบ่อย ต้องวางแผนสำรองรถมิกเซอร์ล่วงหน้า",
    "ขาดแคลนแรงงานต่างด้าวเป็นโจทย์หลักของทีม ต้องวางแผนสรรหาแรงงานล่วงหน้า",
    "เทคอนกรีตแต่ละรอบต้องมีแผนสำรอง อย่ารอให้ OT ข้ามคืนบ่อย ๆ",
    "บริหาร ผรห. ได้ดีขึ้น แต่ต้องไล่ตามงานทิ้งงานและบันทึกความคืบหน้าให้เป็นระบบ",
    "แรงงานช่วงเทศกาลขาดแคลน ต้องวางแผนล่วงหน้าไม่ให้งานดีเลย์",
    "คุมคุณภาพคอนกรีตได้ดี แต่ให้ระวังเรื่อง CPAC มาสายต้องมีมาตรการรองรับ",
]
PROC_KPI_FEEDBACK = [
    "เจรจาราคาเหล็กเส้นได้ดี แต่ supplier ส่งของช้าต้องมีแผนสำรอง",
    "จัดการปัญหากระเบื้องล็อตสีเพี้ยนได้ทัน ป้องกันลูกค้าปฏิเสธงาน",
    "บริหารของคงคลังดีขึ้น ต้องลดของค้างสต็อกและประสานงานกับหน้างานมากขึ้น",
    "ราคาวัสดุขึ้นทุกเดือน ต้องเจรจา locking price กับ supplier รายหลัก",
    "ติดตาม PO ให้ทัน lead time ไม่งั้นหน้างานหยุดรอเหล็กซ้ำอีก",
    "ตรวจรับของต้องเข้มขึ้น กระเบื้องแตกหักระหว่างขนส่งเจอบ่อย",
    "ประสานงาน logistics ดีขึ้น แต่รถเข้าไซต์ยังล่าช้าต้องปรับตาราง",
    "จัดซื้อต้องมี supplier สำรองเผื่อเจอปัญหาเหล็กล่าช้า",
]
CS_KPI_FEEDBACK = [
    "ปิดงานแจ้งซ่อมน้ำรั่วขอบหน้าต่างได้ภายใน SLA แต่ต้องไล่ตรวจทุกบ้านหลังฝนตก",
    "แก้เคสกระเบื้องร่อน/โปร่งได้ดี ต้องติดตามงานรื้อปูใหม่ให้จบ",
    "เคสผนังร้าว Latent Defect เพิ่มขึ้น ต้องเร่งประสานทีมโครงสร้าง",
    "พื้นลามิเนตยวบหลายหลัง ต้องจัดทีมซ่อมให้ทันและดูแลความพึงพอใจลูกบ้าน",
    "SLA ปิดงานแจ้งซ่อมดีขึ้น แต่ช่วงฝนตกเคสน้ำรั่วพุ่ง ต้องมีทีมสำรอง",
    "บริการดี ลูกบ้านชม แต่ต้องไล่ปิดเคสกระเบื้องร่อนค้างเก่าให้หมด",
    "เจอผนังร้าวต้องแยกให้ชัดว่าสาเหตุทรุดตัวหรือรอยแตกผิว อย่าปิดงานเร็วเกิน",
    "พื้นยวบต้องตรวจ subfloor ก่อนปูลามิเนตใหม่ กันกลับมาเป็นซ้ำ",
]
KPI_CFG = {
    "Engineering & Construction": {
        "weak": ["บริหารเวลา OT และภาระงาน", "การวางแผนกำลังคนหน้างาน",
                 "การเจรจากับ ผรห.", "การควบคุมงบ OT"],
        "strong": ["คุมงานโครงสร้าง", "ตรวจรับงาน QC", "ประสานงานหน้างาน",
                   "อ่านแบบ Shop Drawing"],
        "improvement": ["วางแผนเทคอนกรีตล่วงหน้าพร้อมสำรอง supplier",
                        "จัดทำตาราง OT ล่วงหน้าและเวียนกะให้เป็นธรรม",
                        "ตั้ง meeting รายสัปดาห์กับ ผรห. ทุกสัญญา",
                        "วางแผนสรรหาแรงงานต่างด้าวล่วงหน้า (MOU)"],
        "feedback": ENG_KPI_FEEDBACK,
    },
    "Procurement & Warehouse": {
        "weak": ["การติดตาม lead time ซัพพลายเออร์", "การควบคุมของค้างสต็อก",
                 "การเจรจาราคาวัสดุ"],
        "strong": ["เจรจาต่อรองราคา", "บริหารคลังสินค้า", "ตรวจรับของ QC"],
        "improvement": ["ตั้ง SLA กับ supplier รายหลักและมี supplier สำรอง",
                        "ทำ Pivot ติดตาม PO/ของค้างส่งทุกสัปดาห์",
                        "ปรับระบบตรวจรับของ QC กันของเสียเข้าคลัง"],
        "feedback": PROC_KPI_FEEDBACK,
    },
    "Customer Service & Warranty": {
        "weak": ["การปิดเคสตาม SLA", "การจัดการเคสน้ำรั่วช่วงฝนตก",
                 "การติดตามงานซ่อมค้าง"],
        "strong": ["บริการลูกค้า (Service Mind)", "ตรวจหน้างาน warranty",
                   "จัดลำดับความสำคัญเคส"],
        "improvement": ["จัดทีมซ่อมสำรองช่วงหน้าฝน",
                        "ตั้งระบบนัดหมายและแจ้งความคืบหน้าเคสให้ลูกบ้าน",
                        "ไล่ปิดเคสค้างเก่าและตรวจหน้างานก่อนปิดงาน"],
        "feedback": CS_KPI_FEEDBACK,
    },
}

# ── Grievance_Log content (Procurement) ───────────────────────────────────
STEEL_GRIEVANCE = [
    {"Complaint_Type": "Supplier Late Delivery",
     "Description": "ซัพพลายเออร์ส่งเหล็กเส้น SD40 ล็อต PRJ041 ช้าไป 6 วัน ทำหน้างานหยุดรอ ต้องประสานกู้เหล็กจากสาขาอื่น",
     "Resolution": "กู้เหล็กจากสาขาอื่นก่อน + ตั้งเป้า lead time ใหม่กับ supplier",
     "Against": "บริษัท สหเหล็กกิจ จำกัด (มหาชน)"},
    {"Complaint_Type": "Supplier Late Delivery",
     "Description": "เหล็กเส้นข้ออ้อย RB9 รอบส่งล่าช้า 4 วัน งานคุมกำแพงต้องเลื่อน",
     "Resolution": "ย้ายรอบส่งเป็นเช้ามืด + เก็บค่าเสียหายตามสัญญา",
     "Against": "บริษัท ไทยวิวัฒน์เหล็กกล้า จำกัด"},
    {"Complaint_Type": "Supplier Late Delivery",
     "Description": "ซัพพลายเออร์ส่งเหล็กเส้นคละล็อตกับ PO ต้องคัดแยกใหม่ เสียเวลา 1 วัน",
     "Resolution": "แจ้ง QC เข้มตอนรับของ + ขึ้น blacklist supplier ชั่วคราว",
     "Against": "บริษัท เหล็กสยามรีไซเคิล จำกัด"},
    {"Complaint_Type": "Logistics Delay",
     "Description": "รถขนส่งเหล็กเส้นติดปัญหาขนส่ง ถึงคลังช้า หน้างานรอของ 2 วัน",
     "Resolution": "เปลี่ยนผู้ให้บริการขนส่ง + กำหนดเวลาเข้ารับของที่คลัง",
     "Against": "บริษัท ทรานสปอร์ต อินดัสทรี จำกัด"},
]
TILE_GRIEVANCE = [
    {"Complaint_Type": "Material Quality Issue",
     "Description": "กระเบื้องล็อตใหม่สีเพี้ยนจากตัวอย่าง ลูกค้าตรวจแล้วไม่รับ ต้องส่งคืนโรงงานทั้ง lot",
     "Resolution": "ส่งคืนทั้ง lot + เรียก lot ใหม่จากโรงงาน + ชดเชยค่าแรงรื้อ",
     "Against": "บริษัท กระเบื้องด่านเกวียน จำกัด"},
    {"Complaint_Type": "Material Quality Issue",
     "Description": "กระเบื้องล็อต PRJ047 สีเพี้ยนระหว่างกล่อง ต้องคัดแยก 30% ทิ้ง",
     "Resolution": "เจรจา supplier เปลี่ยน lot + ปรับ QC รับของเข้มขึ้น",
     "Against": "บริษัท ไทย-เยอรมันเซรามิค (TGC)"},
    {"Complaint_Type": "Material Quality Issue",
     "Description": "กระเบื้องห้องน้ำแตกหักระหว่างขนส่ง ตรวจรับพบ 12 กล่องชำรุด",
     "Resolution": "เบิกค่าชดเชยจากขนส่ง + เปลี่ยน lot ส่งใหม่",
     "Against": "บริษัท กระเบื้องถาวรอุตสาหกรรม จำกัด"},
    {"Complaint_Type": "Material Quality Issue",
     "Description": "สีกระเบื้องล็อตใหม่ไม่ตรงตัวอย่าง ต้องหยุดปูหน้างานรอ lot ใหม่",
     "Resolution": "ประสานโรงงานเร่ง lot ใหม่ + ปรับแผนปูกระเบื้องข้ามล็อต",
     "Against": "บริษัท เอสซีจี เซรามิกส์ จำกัด"},
]
OTHER_GRIEVANCE = [
    {"Complaint_Type": "Workload Issue",
     "Description": "งานจัดซื้อเหล็กทับซ้อนหลายโครงการ เอกสาร PO ค้าง ต้องขอคนช่วย",
     "Resolution": "แบ่งงานจัดซื้อรายโครงการใหม่ + จ้างพนักงาน part-time",
     "Against": "ผู้บริหารฝ่ายจัดซื้อ"},
    {"Complaint_Type": "Communication Issue",
     "Description": "ฝ่ายหน้างานไม่แจ้งแผนการใช้เหล็กล่วงหน้า ทำสั่งของไม่ทัน",
     "Resolution": "ตั้งตารางแจ้งความต้องการวัสดุล่วงหน้า 2 สัปดาห์",
     "Against": "ทีมวิศวกรหน้างาน"},
    {"Complaint_Type": "Facility Issue",
     "Description": "พัดลมระบายอากาศคลังสินค้าเสีย 3 ตัว ของร้อนเสียหายระหว่างเก็บ",
     "Resolution": "แจ้งซ่อมด่วน + ติดตั้งพัดลมเสริม",
     "Against": "ฝ่ายอาคารสถานที่"},
    {"Complaint_Type": "Supplier Issue",
     "Description": "Supplier ขึ้นราคาเหล็กเส้นกลางสัญญา ต้องเจรจาขอคงราคาเดิม",
     "Resolution": "ล็อกราคาในสัญญา + หา supplier สำรอง",
     "Against": "บริษัท เหล็กสยามรีไซเคิล จำกัด"},
]

# Existing one-off grievance rows (EMP081/083/099/114) get their missing columns.
ENG_GRIEVANCE_FILL = {
    "EMP081": ("ถูกมอบหมายงานคุม OT เทปูนต่อเนื่องหลายสัปดาห์โดยไม่เวียนกะ รู้สึกไม่เป็นธรรม",
               "หัวหน้างานปรับตารางเวียนกะ OT ให้เท่าเทียมกัน", "หัวหน้างาน Site Engineer"),
    "EMP083": ("รู้สึกถูกเลือกปฏิบัติเรื่องการจัดสรรงาน OT และโบนัส เมื่อเทียบกับเพื่อนร่วมทีม",
               "HR ตรวจสอบข้อเท็จจริงและปรับหลักเกณฑ์การจัดสรรงาน", "หัวหน้างาน"),
    "EMP099": ("เบิกค่าล่วงเวลา OT เทปูน 2 คืนไม่ได้รับอนุมัติ อ้างว่าลืมส่งใบขอล่วงหน้า",
               "รับรองชั่วโมง OT ย้อนหลังและออกประกาศแนวปฏิบัติการขอ OT", "ฝ่ายบัญชี Payroll"),
    "EMP114": ("มีปากเสียงกับหัวหน้าเรื่องการจัดคิวปิดเคสแจ้งซ่อมน้ำรั่วช่วงฝนตก",
               "หัวหน้าปรับระบบจัดคิวเคสและเปิดช่องทางคุยรายสัปดาห์", "Customer Service Manager"),
}

# ── IT_Ticket_Log content (Customer Service = แจ้งซ่อมลูกบ้าน) ─────────────
# Templates: desc supports {house} / {proj}; Location built at runtime.
LEAK_TICKETS = [
    {"issue": "น้ำรั่วซึมจากขอบหน้าต่างอลูมิเนียมหลังฝนตกหนัก",
     "desc": "ลูกบ้าน {house} แจ้งน้ำรั่วซึมจากขอบหน้าต่างอลูมิเนียมห้องนอนหลังฝนตกหนัก ต้องอุดซิลิโคนใหม่ โครงการ {proj}",
     "priority": "High",
     "resolution": "ซิลิโคนขอบวงกบใหม่ + ตรวจน้ำรั่วซ้ำหลังฝน 2 รอบ"},
    {"issue": "น้ำซึมขอบหน้าต่างอลูมิเนียมชั้น 2",
     "desc": "น้ำซึมจากขอบหน้าต่างอลูมิเนียมห้องครัวชั้น 2 บ้าน {house} พื้นไม้เปียกชื้น โครงการ {proj}",
     "priority": "High",
     "resolution": "รื้อขอบหน้าต่าง อุดโฟม+ซิลิโคน แล้วปูพื้นใหม่บางส่วน"},
    {"issue": "น้ำรั่วขอบหน้าต่างหลังฝนตกทุกครั้ง",
     "desc": "น้ำรั่วขอบหน้าต่างอลูมิเนียมบานเลื่อนห้องนั่งเล่น {house} หลังฝนตกหนักทุกครั้ง โครงการ {proj}",
     "priority": "Medium",
     "resolution": "ปรับระดับรางน้ำ + อุดซิลิโคนแนววงกบ"},
    {"issue": "น้ำซึมจากวงกบหน้าต่างห้องน้ำ",
     "desc": "น้ำซึมจากวงกบหน้าต่างอลูมิเนียมห้องน้ำ {house} มีคราบดำขึ้นที่ผนัง โครงการ {proj}",
     "priority": "Medium",
     "resolution": "อุดซิลิโคน + ทาสีกันเชื้อรา"},
]
TILE_TICKETS = [
    {"issue": "กระเบื้องห้องน้ำร่อน/โปร่ง",
     "desc": "กระเบื้องห้องน้ำ {house} ร่อน/โปร่ง หลังเข้าอยู่ 8 เดือน ต้องรื้อปูกระเบื้องใหม่ โครงการ {proj}",
     "priority": "High",
     "resolution": "รื้อปูกระเบื้องใหม่ทั้งห้อง + กันซึมรองพื้น"},
    {"issue": "กระเบื้องพื้นห้องนั่งเล่นโปร่ง",
     "desc": "กระเบื้องพื้นห้องนั่งเล่น {house} โปร่งเสียงก้อง เดินแล้วสะเทือน โครงการ {proj}",
     "priority": "Medium",
     "resolution": "ฉีดกาวยาแนวใต้กระเบื้อง + ติดตาม 1 เดือน"},
    {"issue": "กระเบื้องผนังห้องครัวร่อน",
     "desc": "กระเบื้องผนังห้องครัว {house} ร่อนหลุด 2 แผ่น ลูกบ้านกลัวหล่นใส่เด็ก โครงการ {proj}",
     "priority": "High",
     "resolution": "รื้อกระเบื้องหลุดแล้วปูใหม่ทั้งแผง"},
    {"issue": "กระเบื้องระเบียงโปร่ง",
     "desc": "กระเบื้องระเบียง {house} โปร่งหลายจุด หลังปูได้ 1 ปี โครงการ {proj}",
     "priority": "Medium",
     "resolution": "ตรวจยิงเสียง + ฉีดกาวจุดโปร่ง"},
]
CRACK_TICKETS = [
    {"issue": "ผนังร้าว (Latent Defect)",
     "desc": "ผนังร้าวบริเวณรอยต่อห้องนั่งเล่น-ระเบียง {house} สงสัยทรุดตัว ต้องตรวจโครงสร้าง โครงการ {proj}",
     "priority": "High",
     "resolution": "ส่งทีมโครงสร้างตรวจ + อุดร้าวด้วยปูนอีพ็อกซีแล้วเก็บผิว"},
    {"issue": "ผนังร้าวแนวเสา",
     "desc": "ผนังร้าวแนวเสาห้องนอนชั้น 2 {house} รอยกว้าง 2 มม. โครงการ {proj}",
     "priority": "Medium",
     "resolution": "เจียรอุดร้าว + ติดตาม 3 เดือน"},
    {"issue": "รอยร้าว Latent หลังย้ายเข้า",
     "desc": "รอยร้าว Latent บริเวณรอยต่อผนัง-ฝ้า {house} หลังย้ายเข้า 5 เดือน โครงการ {proj}",
     "priority": "Low",
     "resolution": "อุดรอยร้าว + ทาสีเก็บงาน"},
    {"issue": "ผนังร้าวบริเวณวงกบประตู",
     "desc": "ผนังร้าวบริเวณวงกบประตูห้องน้ำ {house} ร้าวขึ้นจากพื้น โครงการ {proj}",
     "priority": "Medium",
     "resolution": "ตรวจฐานราก + อุดร้าวและเก็บผิว"},
]
LAMINATE_TICKETS = [
    {"issue": "พื้นลามิเนตยวบ",
     "desc": "พื้นลามิเนตยวบตรงรอยต่อห้องนอน {house} ลูกบ้านกลัวเด็กสะดุด โครงการ {proj}",
     "priority": "Medium",
     "resolution": "รื้อลามิเนต ตรวจ subfloor ปรับระดับแล้วปูใหม่"},
    {"issue": "พื้นลามิเนตยวบและลั่น",
     "desc": "พื้นลามิเนตยวบและลั่นเวลาเดิน {house} บริเวณทางเดินชั้น 2 โครงการ {proj}",
     "priority": "Medium",
     "resolution": "เสริมแผ่นรองใต้ลามิเนต + ปรับระดับ"},
    {"issue": "พื้นลามิเนตห้องนอนยวบ",
     "desc": "พื้นลามิเนตห้องนอน {house} ยวบตรงรอยต่อ แผ่นเริ่มงอ โครงการ {proj}",
     "priority": "Low",
     "resolution": "เปลี่ยนแผ่นลามิเนตช่วงที่ยวบ"},
    {"issue": "ลามิเนตยวบใกล้ห้องน้ำ",
     "desc": "พื้นลามิเนตยวบใกล้ห้องน้ำ {house} สงสัยความชื้นซึมใต้พื้น โครงการ {proj}",
     "priority": "High",
     "resolution": "รื้อตรวจใต้พื้น + เปลี่ยนแผ่นกันชื้น"},
]
EXTRA_TICKETS = [
    {"issue": "บานประตูห้องน้ำฝืด",
     "desc": "บานประตูห้องน้ำ {house} ฝืด ปรับบานพับและเปลี่ยนรางเลื่อน โครงการ {proj}",
     "priority": "Low",
     "resolution": "ปรับบานพับ + หล่อลื่นรางให้เรียบร้อย"},
    {"issue": "ก๊อกน้ำห้องครัวหยด",
     "desc": "ก๊อกน้ำห้องครัว {house} หยดตลอดเวลา ต้องเปลี่ยนโอริง โครงการ {proj}",
     "priority": "Low",
     "resolution": "เปลี่ยนโอริงและซีลภายในก๊อก"},
    {"issue": "สีผนังห้องนั่งเล่นลอกเป็นจุด",
     "desc": "สีผนังห้องนั่งเล่น {house} ลอกเป็นจุด ต้องเก็บสีใหม่ โครงการ {proj}",
     "priority": "Low",
     "resolution": "ขัดผิว + ทาสีใหม่ 2 รอบ"},
    {"issue": "ราวบันไดโยก",
     "desc": "ราวบันไดชั้น 2 {house} โยก ขันน็อตยึดให้แน่น โครงการ {proj}",
     "priority": "Medium",
     "resolution": "ขันน็อต + ตรวจจุดยึดทั้งหมด"},
    {"issue": "กลอนประตูรั้วหลังบ้านติด",
     "desc": "กลอนประตูรั้วหลังบ้าน {house} หมุนติด ต้องเปลี่ยนกลอนใหม่ โครงการ {proj}",
     "priority": "Low",
     "resolution": "เปลี่ยนกลอนใหม่ + หล่อลื่นบานพับ"},
]

# Existing generic IT rows (Laptop Overheating etc.) get Thai context.
IT_TICKET_DESC = {
    "Laptop Overheating": "เครื่องโน๊ตบุ๊คหน้างานร้อนจัด พัดลมดัง ค้างบ่อย ต้องส่งซ่อม",
    "Software Installation Request": "ขอติดตั้งโปรแกรม Office/CRM ลงเครื่องใหม่ หลังลง Windows ใหม่",
    "Printer Not Working": "ปริ้นเตอร์สำนักงานไม่ทำงาน ขึ้น error กระดาษติด",
    "File Share Access Denied": "เข้าแชร์ไฟล์ SharePoint ไม่ได้ ต้องขอสิทธิ์ใหม่",
    "Email Not Syncing": "เมลไม่ซิงก์บนมือถือ ตั้งค่า Exchange ใหม่",
    "WiFi Connection Issue": "WiFi อาคารหลุดบ่อย ต้องรีสตาร์ท Access Point",
    "Forgot Password / Account Locked": "ลืมรหัสผ่าน โดนล็อกบัญชี ต้องรีเซ็ต MFA",
    "Broken Mouse / Keyboard": "เมาส์/คีย์บอร์ดเสีย ต้องเปลี่ยนอุปกรณ์ใหม่",
}
# ── Collaboration_Network content (Engineering bonus) ─────────────────────
# kind: procurement / design / peer → picks a real collaborator at apply time.
COLLAB_CONFLICTS = [
    {"summary": "ทะเลาะกับฝ่ายจัดซื้อเรื่องเหล็กเส้นเข้าไซต์ช้า ทำหน้างานหยุดรอ 2 วัน",
     "resolution": "จัดประชุม weekly ระหว่างจัดซื้อ-หน้างาน กำหนด lead time วัสดุร่วมกัน",
     "rel": "Cross-Functional — Project Team", "kind": "procurement"},
    {"summary": "มีปากเสียงกับ ผรห. งานตกแต่งเรื่องคุณภาพงานฉาบ ต้องสั่งให้รื้อแก้ใหม่",
     "resolution": "ตั้ง checklist ตรวจรับงาน + เรียก ผรห. มาประชุมทุกสัปดาห์",
     "rel": "Cross-Functional — Vendor/Subcontractor", "kind": "peer"},
    {"summary": "ขัดแย้งกับทีม Design เรื่องแบบ Shop Drawing ไม่ตรงดิ่ง ต้องแก้แบบกลางทาง",
     "resolution": "นัด Recheck แบบร่วมกับสถาปนิกก่อนส่งหน้างาน",
     "rel": "Cross-Functional — Project Team", "kind": "design"},
    {"summary": "ไม่พอใจ CPAC รถเทคอนกรีตเข้าหน้างานช้า ต้องแจ้ง supplier ทุกครั้ง",
     "resolution": "ล็อกเวลารอบเทในสัญญา + สำรองโรงปูนสาขาใกล้",
     "rel": "Cross-Functional — Vendor/Subcontractor", "kind": "peer"},
    {"summary": "ขัดแย้งกับหัวหน้าช่างเรื่องสลับกะ OT เทปูน งานไม่พอดี",
     "resolution": "จัดตาราง OT ล่วงหน้าและเวียนกะให้เป็นธรรม",
     "rel": "Peer — Same Dept", "kind": "peer"},
    {"summary": "แรงงานต่างด้าวไม่พอ งานดีเลย์ เถียงกับฝ่าย HR เรื่องการสรรหา",
     "resolution": "ประชุมร่วม HR-หน้างาน วางแผนนำเข้าแรงงาน MOU",
     "rel": "Cross-Functional — Project Team", "kind": "peer"},
]

# ── Skill_Matrix augmentation ──────────────────────────────────────────────
# Extra rows guarantee >=3 X-SKILL keyword rows even when rc.skill_rows draws few.
SKILL_EXTRA_BY_DEPT = {
    "Engineering & Construction": [
        ("AutoCAD 2D/3D — Quantity Takeoff", None),
        ("BIM 360 / Navisworks Clash Detection", None),
        ("ตรวจหน้างาน QC โครงสร้าง (Site QC)", None),
        ("Excel / Pivot คุมงบงานก่อสร้าง", None),
    ],
    "Procurement & Warehouse": [
        ("ตรวจหน้างาน QC รับวัสดุ (Site QC)", None),
        ("CRM / ERP จัดซื้อ (SAP MM)", None),
        ("Excel Dashboard ติดตาม PO", None),
    ],
    "Customer Service & Warranty": [
        ("Excel / Pivot รายงาน SLA", None),
        ("CRM จัดการ Defect (in-house)", None),
        ("ตรวจหน้างาน (Warranty Inspection)", None),
    ],
}
SKILL_NOTES_BY_DEPT = {
    "Engineering & Construction": [
        "ใช้จริงทุกวัน คุมงานเทปูนและตรวจรับ ผรห. หน้างาน",
        "สอบใบรับรองล่าสุดปี 2025 ใช้จริงในโครงการ PRJ041",
        "ต้องอัปเดตเวอร์ชันใหม่ เพราะแบบลูกค้าเปลี่ยนบ่อย",
        "ใช้คู่กับ BIM 360 ในการส่ง As-Built ให้ฝ่ายขาย",
        "ฝึกฝนกับทีม Design สัปดาห์ละครั้ง เรื่อง clash detection",
    ],
    "Procurement & Warehouse": [
        "ใช้เจรจาราคากับ supplier รายหลักทุกเดือน",
        "ใช้ตรวจรับของที่คลังประจำ ต้องแม่นเรื่อง spec",
        "ทำ Pivot สรุปราคาเหล็กเส้นให้ผู้บริหารทุกสัปดาห์",
        "ใช้ระบบ ERP ในการออก PO และติดตามของ",
    ],
    "Customer Service & Warranty": [
        "ใช้ปิดเคสแจ้งซ่อมลูกบ้านประจำ ต้องรีบปิดให้ทัน SLA",
        "ใช้คู่กับ CRM ในการติดตาม defect รอบรับประกัน",
        "ใช้ตรวจหน้างานก่อนเซ็นปิดงานกับลูกบ้าน",
        "อัปเดตคู่มือขั้นตอนการแจ้งซ่อมให้ทีมใหม่อยู่เสมอ",
    ],
}

# ── small helpers ─────────────────────────────────────────────────────────
def _role_for(job_title):
    return ROLE_BY_TITLE.get(job_title, job_title or "Site Engineer")


def _own_projects(emp, fallback):
    ids = [r.get("projectId") for r in emp.get("sheets", {}).get("Project_History", {}).get("records", [])
           if r.get("projectId")]
    ids = [p for p in ids if str(p).startswith("PRJ") and str(p)[3:].isdigit()]
    return ids or fallback


def _pick_proj(rng, emp, fallback):
    return rng.choice(_own_projects(emp, fallback))


def _rand_date(rng, y0, y1):
    return datetime.date(rng.randint(y0, y1), rng.randint(1, 12), rng.randint(1, 28)).isoformat()


def _set_headers(emp, sheet, headers):
    emp.setdefault("sheets", {}).setdefault(sheet, {})["headers"] = list(headers)
# ── enrichment functions ──────────────────────────────────────────────────
def _fill_skill_matrix(emp, code, rng, stats):
    dept = emp.get("department", "")
    rows = rc.skill_rows(code, dept, rng)
    have = {r["Core_Skill"] for r in rows}
    extra = SKILL_EXTRA_BY_DEPT.get(dept, [])
    notes_pool = SKILL_NOTES_BY_DEPT.get(dept, [])
    for skill, cert in extra:
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


def _enrich_timesheet(emp, code, rng, stats):
    recs = rc.sheet_records(emp, "Timesheet_Log")
    if any("Week" in r for r in recs):
        return  # already enriched (idempotent)
    n = rng.randint(3, 5)
    ot_notes = rc.pick(rng, OT_NOTES, min(3, n))
    reg_notes = rc.pick(rng, REGULAR_NOTES, n - len(ot_notes)) if n - len(ot_notes) else []
    notes = ot_notes + reg_notes
    weeks = rng.sample(WEEK_NUMBERS, n)
    rows = []
    for i, note in enumerate(notes):
        is_ot = i < len(ot_notes)
        wk = weeks[i]
        d = datetime.date.fromisocalendar(2026, wk, rng.randint(1, 3))
        admin = rng.randint(45, 65) if (not is_ot or rng.random() < 0.4) else rng.randint(25, 44)
        rows.append({
            "Week": f"2026-W{wk:02d}",
            "Date": d.isoformat(),
            "Admin_Hours_Pct": admin,
            "Billable_Hours_Pct": 100 - admin,
            "Overtime_Hours": rng.randint(2, 6) if is_ot else 0,
            "Missing_Punch": rng.choice(["Yes", "No"]),
            "Notes": note,
        })
    rc.add_records(emp, "Timesheet_Log", rows)
    _set_headers(emp, "Timesheet_Log", ["Week", "Date", "Admin_Hours_Pct",
                                        "Billable_Hours_Pct", "Overtime_Hours",
                                        "Missing_Punch", "Notes"])
    stats["timesheet_rows_added"] += len(rows)


def _enrich_project_history(emp, code, rng, stats):
    recs = rc.sheet_records(emp, "Project_History")
    joined = " ".join(str(r.get("mistakeIssue", "")) for r in recs)
    if "ผรห." in joined or "CPAC" in joined or "ต่างด้าว" in joined:
        return  # already enriched
    role = _role_for(emp.get("jobTitle", ""))
    rows = []
    for pool in (SUBCON_ROWS, CPAC_ROWS, LABOR_ROWS):
        issue, recovery = rng.choice(pool)
        rows.append({
            "role": role,
            "projectId": _pick_proj(rng, emp, PRJ_FALLBACK),
            "hasMistake": "Yes",
            "mistakeIssue": issue,
            "recoveryAction": recovery,
            "individualOutcome": rng.choice(INDIV_OUTCOME),
            "contributionSummary": rng.choice(CONTRIB_SUMMARY),
        })
    rc.add_records(emp, "Project_History", rows)
    stats["project_rows_added"] += len(rows)


def _enrich_kpi(emp, code, rng, dept, stats):
    recs = rc.sheet_records(emp, "KPI_OKR_History")
    cfg = KPI_CFG.get(dept, KPI_CFG["Engineering & Construction"])
    fb = rc.pick(rng, cfg["feedback"], min(3, len(cfg["feedback"])))
    start = max(0, len(recs) - 3)
    for idx, txt in zip(range(start, len(recs)), fb):
        recs[idx]["managerFeedback"] = txt
        stats["kpi_feedback_updated"] += 1
    if len(recs) < 6:
        while len(recs) < 6:
            recs.append({
                "kpiScore": round(rng.uniform(2.2, 3.6), 1),
                "okrScore": round(rng.uniform(2.0, 3.4), 1),
                "weakArea": rng.choice(cfg["weak"]),
                "strongArea": rng.choice(cfg["strong"]),
                "reviewPeriod": rng.choice(["2025-Q4", "2026-Q1", "2026-Q2"]),
                "followUpStatus": rng.choice(["Completed", "In Progress", "Under Review"]),
                "improvementPlan": rng.choice(cfg["improvement"]),
                "managerFeedback": rng.choice(cfg["feedback"]),
                "performanceBand": rng.choice(["Meets (C)", "Meets (C)", "Below (D)", "Exceeds (B)"]),
            })
            stats["kpi_rows_added"] += 1
def _enrich_grievance(emp, code, rng, stats):
    recs = rc.sheet_records(emp, "Grievance_Log")
    if any("Description" in r for r in recs):
        return  # already enriched
    proj = _pick_proj(rng, emp, PRJ_FALLBACK)
    rows = []
    for base in (rng.choice(STEEL_GRIEVANCE), rng.choice(TILE_GRIEVANCE), rng.choice(OTHER_GRIEVANCE)):
        row = dict(base)
        row["Status"] = rng.choice(["Open", "In Progress", "Resolved", "Closed"])
        row["Filed_Date"] = _rand_date(rng, 2025, 2026)
        row["Filed_By"] = emp.get("name", code)
        row["Description"] = f"{base['Description']} (โครงการ {proj})"
        rows.append(row)
    rc.add_records(emp, "Grievance_Log", rows)
    _set_headers(emp, "Grievance_Log", ["Status", "Complaint_Type", "Description",
                                        "Filed_Date", "Resolution", "Filed_By", "Against"])
    stats["grievance_rows_added"] += len(rows)


def _fill_existing_grievance(emp, code, rng, stats):
    if code not in ENG_GRIEVANCE_FILL:
        return
    recs = rc.sheet_records(emp, "Grievance_Log")
    desc, res, against = ENG_GRIEVANCE_FILL[code]
    for r in recs:
        if "Description" not in r:
            r["Description"] = desc
            r["Filed_Date"] = _rand_date(rng, 2025, 2026)
            r["Resolution"] = res
            r["Filed_By"] = emp.get("name", code)
            r["Against"] = against
            stats["grievance_rows_filled"] += 1


def _enrich_it_tickets(emp, code, rng, stats):
    recs = rc.sheet_records(emp, "IT_Ticket_Log")
    if any("Priority" in r for r in recs):
        return  # already enriched
    # give the pre-existing generic IT rows Thai context
    for r in recs:
        if "Priority" not in r:
            r["Description"] = IT_TICKET_DESC.get(
                r.get("Ticket_Issue", ""), "แจ้งปัญหาอุปกรณ์ไอทีให้ทีม IT ตรวจสอบและแก้ไข")
            r["Location"] = "สำนักงานใหญ่ (อาคาร B)"
            r["Reported_Date"] = _rand_date(rng, 2025, 2026)
            r["Resolution"] = "ทีม IT ดำเนินการแก้ไขและปิดเคสเรียบร้อย"
            r["Priority"] = rng.choice(["Low", "Medium"])
            stats["ticket_rows_filled"] += 1
    house = f"{rng.choice(list('SMDTB'))}-{rng.randint(1, 20):02d}"
    proj = _pick_proj(rng, emp, CS_PROJ_POOL)
    rows = []
    pools = [LEAK_TICKETS, TILE_TICKETS, CRACK_TICKETS, LAMINATE_TICKETS]
    if rng.random() < 0.6:
        pools = pools + [EXTRA_TICKETS]
    for pool in pools:
        t = rng.choice(pool)
        rows.append({
            "Status": rng.choice(["Open", "In Progress", "Resolved", "Closed"]),
            "Ticket_Issue": t["issue"],
            "Description": t["desc"].format(house=house, proj=proj),
            "Location": f"บ้าน {house} โครงการ {proj}",
            "Reported_Date": _rand_date(rng, 2025, 2026),
            "Resolution": t["resolution"],
            "Priority": t["priority"],
        })
    rc.add_records(emp, "IT_Ticket_Log", rows)
    _set_headers(emp, "IT_Ticket_Log", ["Status", "Ticket_Issue", "Description",
                                        "Location", "Reported_Date", "Resolution", "Priority"])
    stats["ticket_rows_added"] += len(rows)


def _pick_collab(kind, employees, rng):
    if kind == "procurement":
        dept = "Procurement & Warehouse"
    elif kind == "design":
        dept = "Design & Architecture"
    else:
        dept = "Engineering & Construction"
    names = [(e["name"], e.get("pk", 0)) for e in employees.values()
             if e.get("department") == dept and e.get("name")]
    if not names:
        names = [("เพื่อนร่วมงาน", 0)]
    return dept, rng.choice(names)


def _enrich_collab(emp, code, rng, employees, stats):
    recs = rc.sheet_records(emp, "Collaboration_Network")
    conflict_rows = [r for r in recs if r.get("hasConflict") == "Yes"]
    for r in conflict_rows[:2]:
        c = rng.choice(COLLAB_CONFLICTS)
        r["conflictSummary"] = c["summary"]
        r["resolutionSummary"] = c["resolution"]
        stats["collab_rows_updated"] += 1
    while sum(1 for r in recs if r.get("hasConflict") == "Yes") < 2:
        c = rng.choice(COLLAB_CONFLICTS)
        dept, (cname, cid) = _pick_collab(c["kind"], employees, rng)
        recs.append({
            "projectId": _pick_proj(rng, emp, PRJ_FALLBACK),
            "hasConflict": "Yes",
            "conflictSummary": c["summary"],
            "collaboratorDept": dept,
            "collaboratorName": cname,
            "relationshipType": c["rel"],
            "resolutionSummary": c["resolution"],
            "collaborationQuality": rng.choice(["Fair", "Good"]),
            "collaboratorEmployeeId": cid,
        })
        stats["collab_rows_added"] += 1
# ── public API ────────────────────────────────────────────────────────────
def apply(employees):
    """Enrich Cluster B (62 employees) in place. Returns a stats dict."""
    stats = {
        "cluster": "B",
        "employees_enriched": 0,
        "skill_rows": 0,
        "timesheet_rows_added": 0,
        "project_rows_added": 0,
        "kpi_rows_added": 0,
        "kpi_feedback_updated": 0,
        "grievance_rows_added": 0,
        "grievance_rows_filled": 0,
        "ticket_rows_added": 0,
        "ticket_rows_filled": 0,
        "collab_rows_added": 0,
        "collab_rows_updated": 0,
        "departments": {},
    }
    eng = rc.codes_in(employees, "Engineering & Construction")
    proc = rc.codes_in(employees, "Procurement & Warehouse")
    cs = rc.codes_in(employees, "Customer Service & Warranty")
    for code in eng + proc + cs:
        emp = employees[code]
        rng = rc.rng_for(code, "cluster_b")
        dept = emp.get("department", "")
        stats["employees_enriched"] += 1
        stats["departments"][dept] = stats["departments"].get(dept, 0) + 1
        _fill_skill_matrix(emp, code, rng, stats)
        _enrich_kpi(emp, code, rng, dept, stats)
        if dept == "Engineering & Construction":
            _enrich_timesheet(emp, code, rng, stats)
            _enrich_project_history(emp, code, rng, stats)
            _enrich_collab(emp, code, rng, employees, stats)
            _fill_existing_grievance(emp, code, rng, stats)
        elif dept == "Procurement & Warehouse":
            _enrich_grievance(emp, code, rng, stats)
        elif dept == "Customer Service & Warranty":
            _enrich_it_tickets(emp, code, rng, stats)
            _fill_existing_grievance(emp, code, rng, stats)
    return stats


# ── smoke test / self-check ───────────────────────────────────────────────
# Mirrors audit_realism.py CHECKS for the 10 Cluster-B criteria.
SELF_CHECKS = [
    ("ENG-OT", "Engineering & Construction",
     ["Timesheet_Log", "KPI_OKR_History"], ["Notes", "Overtime_Hours", "managerFeedback"],
     ["OT", "เทปูน", "ข้ามคืน", "คอนกรีต"], 0.6),
    ("ENG-SUBCON", "Engineering & Construction",
     ["Project_History", "Collaboration_Network", "KPI_OKR_History"],
     ["mistakeIssue", "conflictSummary", "managerFeedback"],
     ["ผรห.", "ผู้รับเหมา", "ทิ้งงาน", "ซัพคอน"], 0.6),
    ("ENG-CPAC", "Engineering & Construction",
     ["Project_History", "Collaboration_Network", "KPI_OKR_History"],
     ["mistakeIssue", "conflictSummary", "managerFeedback"],
     ["CPAC", "ปูน", "คอนกรีต", "เข้าหน้างานช้า"], 0.5),
    ("ENG-LABOR", "Engineering & Construction",
     ["Project_History", "KPI_OKR_History"], ["mistakeIssue", "managerFeedback", "recoveryAction"],
     ["แรงงาน", "ต่างด้าว", "ขาดแคลน", "แรงงานขาด"], 0.5),
    ("PROC-STEEL", "Procurement & Warehouse",
     ["Grievance_Log", "Collaboration_Network", "KPI_OKR_History"],
     ["Description", "Complaint_Type", "Summary", "conflictSummary", "managerFeedback"],
     ["เหล็ก", "เส้น", "ช้า", "ล่าช้า", "ซัพพลายเออร์"], 0.7),
    ("PROC-TILE", "Procurement & Warehouse",
     ["Grievance_Log", "Collaboration_Network", "KPI_OKR_History"],
     ["Description", "Complaint_Type", "Summary", "conflictSummary", "managerFeedback"],
     ["กระเบื้อง", "สีเพี้ยน", "Lot", "ล็อต"], 0.6),
    ("CS-LEAK", "Customer Service & Warranty",
     ["IT_Ticket_Log", "Project_History", "KPI_OKR_History"],
     ["Ticket_Issue", "Description", "Summary", "mistakeIssue", "managerFeedback"],
     ["น้ำรั่ว", "หน้าต่าง", "อลูมิเนียม", "ซึม"], 0.6),
    ("CS-TILE", "Customer Service & Warranty",
     ["IT_Ticket_Log", "Project_History", "KPI_OKR_History"],
     ["Ticket_Issue", "Description", "Summary", "mistakeIssue", "managerFeedback"],
     ["กระเบื้อง", "ร่อน", "โปร่ง"], 0.5),
    ("CS-CRACK", "Customer Service & Warranty",
     ["IT_Ticket_Log", "Project_History", "KPI_OKR_History"],
     ["Ticket_Issue", "Description", "Summary", "mistakeIssue", "managerFeedback"],
     ["ผนังร้าว", "ร้าว", "Latent"], 0.6),
    ("CS-LAMINATE", "Customer Service & Warranty",
     ["IT_Ticket_Log", "Project_History", "KPI_OKR_History"],
     ["Ticket_Issue", "Description", "Summary", "mistakeIssue", "managerFeedback"],
     ["ลามิเนต", "ยวบ", "พื้น"], 0.4),
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
    print("\nSelf-check coverage (Cluster B):")
    all_ok = True
    for cid, dept, sheets, fields, keywords, threshold in SELF_CHECKS:
        codes = by_dept.get(dept, [])
        matched = [c for c in codes if _matched(employees[c], sheets, fields, keywords)]
        cov = len(matched) / len(codes) if codes else 0.0
        ok = cov >= threshold
        all_ok = all_ok and ok
        print(f"  {cid:14s} {len(matched):3d}/{len(codes):3d}  {cov*100:5.1f}%  {'PASS' if ok else 'FAIL'}")
    # X-SKILL for the 62
    b_codes = rc.codes_in(employees, "Engineering & Construction",
                          "Procurement & Warehouse", "Customer Service & Warranty")
    ok_skill = 0
    for c in b_codes:
        recs = employees[c].get("sheets", {}).get("Skill_Matrix", {}).get("records", [])
        real = [r for r in recs
                if any(k.lower() in str(r.get("Core_Skill", "")).lower() for k in X_SKILL_KEYWORDS)]
        if len(real) >= 3:
            ok_skill += 1
    print(f"  {'X-SKILL':14s} {ok_skill:3d}/{len(b_codes):3d}  {ok_skill/len(b_codes)*100:5.1f}%  "
          f"{'PASS' if ok_skill == len(b_codes) else 'FAIL'}")
    return all_ok and ok_skill == len(b_codes)


if __name__ == "__main__":
    data = rc.load_employees()
    stats = apply(data)
    smoke_path = rc.save_smoke(data, "cluster_b_smoke")
    print("STATS:")
    print(json.dumps(stats, ensure_ascii=False, indent=1))
    print(f"\nSmoke JSON → {smoke_path}")
    smoke = rc.load_employees(smoke_path)
    ok_all = _run_self_check(smoke)
    print(f"\nOverall self-check: {'ALL PASS' if ok_all else 'SOME FAIL'}")
    sys.exit(0 if ok_all else 1)

