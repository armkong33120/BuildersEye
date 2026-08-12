#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dept_cluster_c.py — Cluster C realism upgrade for BuildersEye (demo HR dataset).

Owned departments (22 employees):
  * Finance & Accounting : EMP125-EMP134  (F&A Manager, AP, AR, GL, Cost, Treasury)
  * HR & Admin           : EMP135-EMP142  (HR Manager, Recruiter, Payroll, HR Admin, General Admin)
  * IT                   : EMP143-EMP146  (IT Manager, System/Network Admin, IT Support)

Contract:
    apply(employees: dict) -> dict
Mutates the in-memory registry dict (never writes the real file) and returns stats.

Deterministic: every per-employee choice uses rc.rng_for(code, ...) seeded RNG.
Idempotent-safe: each enrichment is guarded by a column/value marker, so a second
run on the same data is a no-op.

Themes (audit FIN-ADV / FIN-ENT / FIN-KYS / HR-SICKPOL / HR-LATE / HR-CAMP /
HR-NEPO / HR-SSO / IT-ASSET / IT-BSOD / IT-RANSOM / IT-NET):
  * เบิกเงินทดรอง (Advance) หน้างานล่าช้า
  * ค่ารับรองลูกค้า
  * หักหนี้ กยศ. ตามคำสั่งศาล (student-loan garnishment)
  * ลาป่วยการเมือง / มาสายเพราะฝนตก-รถติด
  * ทะเลาะกันในแคมป์คนงาน / ปัญหาเด็กเส้น (Nepotism)
  * โดนหักประกันสังคม (SSO)
  * ยี่ห้อจริง Dell Latitude / ThinkPad / Precision Workstation
  * จอฟ้า BSOD / เครื่องติด Ransomware / ต่อเน็ตไซต์งานไม่ได้
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import realism_common as rc

# ── shared Thai one-liners ───────────────────────────────────────────────────
THAI_SKILL_NOTES = [
    "ใช้จริงทุกวันในงานประจำ",
    "ผ่านการอบรมภายในบริษัทปี 2567",
    "ต้องอัปเดตความรู้ใหม่ทุกไตรมาส",
    "ใช้คู่กับระบบ ERP ของบริษัท",
    "ระดับพอใช้ ต้องฝึกฟังก์ชันขั้นสูงเพิ่ม",
    "ได้ใช้จริงตอนปิดงบ/จัดซื้อ/ดูแลระบบ",
    "ผู้บริหารขอให้พัฒนาต่อเนื่องปีหน้า",
    "มีแผนสอบใบรับรองเพิ่มภายในปี 2569",
]

APPROVAL_STATUS = ["Approved", "Pending", "Rejected", "Approved", "In Review"]

# Keywords used by audit_realism.py X-SKILL (must appear in >=3 Core_Skill rows).
XSKILL_KEYWORDS = ["AutoCAD", "Revit", "BIM", "SketchUp", "ตรวจหน้างาน",
                   "BOQ", "M365", "CRM", "Facebook", "Excel"]

# ── Finance & Accounting content pools ───────────────────────────────────────
FIN_ADVANCE_DESCS = [
    "เบิก Advance ค่าวัสดุเบิกจ่ายหน้างาน โครงการ PRJ018 เอกสารไม่ครบต้องส่งใหม่ ใช้เวลา 9 วันกว่าจะได้เงิน ทำหน้างานต้องสำรองจ่ายก่อน",
    "เบิกล่วงหน้าค่าแรงรายวันช่างทาสี PRJ012 ผรห. ส่งบิลล่าช้า เงินทดรองบริษัทไม่พอหมุน ระบบเบิกค้าง 11 วัน",
    "เงินทดรองจ่ายค่าวัสดุสิ้นเปลืองหน้างาน PRJ007 ใบสำคัญรับเงินหาย ต้องให้หน้างานเซ็นใหม่ รอคืนเงินเกือบ 2 อาทิตย์",
    "เบิก Advance ค่าอาหารทีมงานเทคอนกรีตข้ามคืน PRJ021 ใบกำกับภาษีมาไม่ครบ ต้องเรียกจากร้านเพิ่มอีก 5 วัน",
    "เบิกเงินทดรองค่าน้ำมันเครื่องจักรหนัก PRJ033 เอกสารเบิกตกรอบเดือน ต้องส่งใหม่รอบถัดไป ทำให้หน้างานรอเงินล่าช้า",
    "เบิก Advance ค่าเช่าเครื่องปั๊มน้ำหน้างาน PRJ029 เอกสาร PO ยังไม่ออกเลข ต้องรอจัดซื้ออนุมัติเกือบเดือน",
]

FIN_ENTERTAIN_DESCS = [
    "ค่ารับรองลูกค้ากลุ่ม Land & House กว่า 20 คน โรงแรมแชงกรี-ลา กรุงเทพฯ (มีใบเสร็จครบ)",
    "ค่ารับรอง Dinner กับลูกค้า SC Asset เจรจาเงื่อนไขผ่อนดาวน์ โรงแรมอนันตรา สยาม",
    "ค่าอาหารมื้อค่ำรับรองผู้บริหารธนาคารกสิกรไทย เรื่องวงเงินสินเชื่อโครงการใหม่",
    "ค่ารับรองลูกค้าญี่ปุ่นจาก Sumitomo เรื่อง JV โครงการมิกซ์ยูส โรงแรมแมนดาริน",
    "ค่าเลี้ยงรับรองทีมที่ปรึกษากฎหมายปิดดีลซื้อที่ดินราชพฤกษ์ ภัตตาคารจีน เยาวราช",
    "ค่ารับรองมื้อกลางวันผู้บริหารบริษัทคู่สัญญา เรื่องต่อสัญญารับเหมาก่อสร้าง PRJ040",
]

FIN_GENERIC_EXPENSES = [
    ("ค่าน้ำมันรถยนต์บริษัท", "เติมน้ำมันรถกระบะหน้างาน + ค่าทางด่วนไป-กลับไซต์ PRJ018 3 เที่ยว"),
    ("ค่าน้ำมันรถยนต์บริษัท", "เติมน้ำมัน + ค่าทางด่วนพาลูกค้าชมโครงการพระราม 2"),
    ("ค่าวัสดุสำนักงาน", "ซื้อกระดาษ A4 หมึกพิมพ์ และกระดาษต่อเนื่องเครื่องพิมพ์บิล ฝ่ายบัญชี"),
    ("ค่าอาหารประชุม", "จัดอาหารกลางวันประชุมปิดงบไตรมาส ทีมบัญชี 10 คน"),
    ("ค่าที่จอดรถ", "ค่าที่จอดรถอาคาร CP Tower ขณะประชุมกับธนาคาร 2 ครั้ง"),
    ("ค่าเดินทางต่างจังหวัด", "ค่าเดินทางไปตรวจบัญชีหน้างานโครงการหัวหิน รถทัวร์ + ค่าโรงแรม 1 คืน"),
]

FIN_SALARY_NOTES = [
    "โดนหักหนี้ กยศ. ตามคำสั่งศาล 5% ของเงินเดือน (เจ้าหนี้บังคับคดี)",
    "หักเงินเดือนชำระหนี้ กยศ. ตามคำพิพากษา 5% + ประกันสังคม 5%",
    "หัก กยศ. ยอดค้างชำระ 2 งวด ตามหนังสือบังคับคดี 5% ของเงินเดือน",
    "หักประกันสังคมเต็มอัตรา 5% และหักเงินกู้สหกรณ์ออมทรัพย์บริษัท 2,000 บาท/เดือน",
    "หักประกันสังคม 5% (สูงสุด 750 บาท) + กองทุนสำรองเลี้ยงชีพ 3%",
    "หักเงินกู้สหกรณ์ออมทรัพย์ + หักหนี้บัตรเครดิตสวัสดิการ ตามคำร้องขอพนักงาน",
]

FIN_ADV_FEEDBACK = [
    "ปิดงบเดือนทัน แต่ Advance หน้างานค้างบัญชีเยอะ ต้องไล่เอกสารจาก ผรห. ให้จบก่อนสิ้นงวด",
    "เบิกเงินทดรองหน้างานยังล่าช้าเพราะเอกสารไม่ครบ ต้องทำ checklist เอกสารเบิกให้ ผรห. ใช้",
    "ยอด Advance ค้างบัญชีสูงกว่าปกติ ต้องเร่งเคลียร์เงินทดรองก่อนปิดงวด",
    "ระบบเบิก Advance หน้างานยังมี backlog ต้องลดรอบเวลาการจ่ายคืนเงินทดรองให้สั้นลง",
]

FIN_ENT_FEEDBACK = [
    "ค่ารับรองลูกค้าไตรมาสนี้เกินงบ ต้องขออนุมัติล่วงหน้าก่อนเลี้ยงทุกครั้ง",
    "รายงานค่ารับรองลูกค้าส่งช้า ต้องบันทึกภายใน 3 วันหลังมีค่าใช้จ่าย",
    "ค่าเลี้ยงรับรองลูกค้าโครงการใหม่เยอะ ต้องแยกบัญชีตามโปรเจกต์ให้ชัดเจน",
    "ตรวจสอบใบเสร็จค่ารับรองลูกค้าให้ครบถ้วนก่อนอนุมัติจ่ายทุกครั้ง",
]

FIN_KYS_FEEDBACK = [
    "เจอหนังสือบังคับคดีหัก กยศ. พนักงาน ต้องประสาน payroll ให้หักตามกฎหมายอย่างถูกต้อง",
    "ตรวจสอบยอดหักประกันสังคมกับ สปส. ให้ตรงทุกเดือนก่อนจ่ายเงินเดือน",
    "มีคำสั่งศาลหักเงินเดือนหนี้ กยศ. เพิ่มอีก 2 ราย ต้องบันทึกและแจ้งพนักงานให้ทราบ",
    "ทบทวนรายการหักเงินเดือน (กยศ./สหกรณ์/ประกันสังคม) ให้ครบถ้วนก่อนจ่ายทุกงวด",
]

# ── HR & Admin content pools ────────────────────────────────────────────────
HR_SICKPOL_ATTENDANCE = [
    "ลาป่วย 2 วันช่วงเลือกตั้ง ตรวจสอบแล้วเป็นวันหยุดราชการรอบเลือกตั้ง ต้องให้พนักงานส่งใบรับรองแพทย์",
    "ลาป่วย 3 วันติดช่วงมีนัดรวมตัวทางการเมือง ตรวจสอบแล้วไม่มีใบนัดพบแพทย์ เรียกพนักงานมาชี้แจง",
    "ลาป่วยวันเลือกตั้งล่วงหน้า แต่ตรวจพบว่าไปใช้สิทธิและร่วมกิจกรรม ต้องเตือนเรื่องการลาโดยสุจริต",
    "ขอลาป่วยช่วงประกาศผลเลือกตั้ง 1 วัน HR ตรวจสอบแล้วไม่มีใบรับรองแพทย์ บันทึกเป็นข้อสังเกต",
    "ลาป่วยอ้างไข้หวัดใหญ่ช่วงสัปดาห์เลือกตั้ง แต่มีภาพไปร่วมกิจกรรมในโซเชียล อยู่ระหว่างสอบสวน",
    "ลาป่วย 2 วันช่วงเลือกตั้งซ่อม ตรวจสอบแล้วตรงกับวันหยุดราชการ ต้องนับเป็นวันลาป่วยปกติ",
]

HR_LATE_ATTENDANCE = [
    "มาสาย 40 นาที ฝนตกหนักถนนแจ้งวัฒนะรถติด",
    "มาสาย 3 ครั้งสัปดาห์นี้ รถไฟฟ้าสายสีชมพูขัดข้องช่วงเช้า",
    "มาสาย 25 นาที รถติดสะสมหน้าวงเวียนหลักสี่เพราะอุบัติเหตุ",
    "มาสาย 1 ชั่วโมง ทางด่วนบางนา-อาจรถติดหนักช่วงฝนตก",
    "มาสาย 30 นาที รถเมล์เสียระหว่างทาง ต้องต่อวินมอเตอร์ไซค์",
    "มาสาย 45 นาที ถนนวิภาวดีรถติดหนักเพราะฝนตก 2 วันติด",
]

HR_CAMP_WARNINGS = [
    {
        "caseType": "Workplace Conflict", "severity": "High", "formalWarning": "Yes",
        "summary": "ทะเลาะวิวาทในแคมป์คนงานกับหัวหน้าช่างเรื่องเบิกค่าแรง ต้องเรียกทั้งสองฝ่ายมาคุยกับ HR",
        "rootCause": "ความไม่พอใจเรื่องการเบิกจ่ายค่าแรงรายวันล่าช้า",
        "actionTaken": "เรียกประชุมไกล่เกลี่ยโดย HR + ออกหนังสือตักเตือนทั้งสองฝ่าย",
    },
    {
        "caseType": "Workplace Conflict", "severity": "High", "formalWarning": "Yes",
        "summary": "ทะเลาะกันในแคมป์คนงานช่วงกลางคืน เสียงดังรบกวนชาวบ้านข้างเคียง โดนตำรวจเรียก",
        "rootCause": "ดื่มสุราในแคมป์แล้วมีปากเสียงกันเรื่องงาน",
        "actionTaken": "ประสานผู้รับเหมาให้ควบคุมแคมป์ + อบรมวินัยที่พักคนงาน",
    },
    {
        "caseType": "Workplace Conflict", "severity": "Medium", "formalWarning": "No",
        "summary": "มีปากเสียงกับคนงานต่างด้าวในแคมป์เรื่องค่าแรงล่วงเวลา จนเกือบลงไม้ลงมือ",
        "rootCause": "การสื่อสารภาษาที่คลาดเคลื่อนเรื่อง OT",
        "actionTaken": "ให้ล่ามกลางไกล่เกลี่ย + ตั้งกฎการจ่าย OT หน้างานให้ชัดเจน",
    },
    {
        "caseType": "Process Violation", "severity": "Medium", "formalWarning": "No",
        "summary": "ทะเลาะกับผู้รับเหมาช่วงในแคมป์คนงานเรื่องวัสดุหาย ต้องให้ HR กลางเข้าไกล่เกลี่ย",
        "rootCause": "การตรวจนับวัสดุหน้างานไม่ตรงกัน",
        "actionTaken": "จัดทำทะเบียนวัสดุแคมป์ + กำหนดผู้รับผิดชอบชัดเจน",
    },
    {
        "caseType": "Workplace Conflict", "severity": "Medium", "formalWarning": "Yes",
        "summary": "ทะเลาะกันในแคมป์คนงานช่วงกลางคืน รบกวนชาวบ้านข้างเคียง โดนตำรวจเรียก",
        "rootCause": "เสียงรบกวนจากแคมป์หลังเลิกงาน",
        "actionTaken": "ย้ายที่พักคนงาน + ติดตั้งกฎเคอร์ฟิวแคมป์ 22:00 น.",
    },
    {
        "caseType": "Workplace Conflict", "severity": "Low", "formalWarning": "No",
        "summary": "มีปากเสียงกับหัวหน้าไซต์เรื่องการเบิกค่าแรงงานพิเศษในแคมป์คนงาน",
        "rootCause": "บันทึกชั่วโมง OT ไม่ตรงกันระหว่างหัวหน้าและคนงาน",
        "actionTaken": "ปรับปรุงแบบฟอร์มเบิก OT + อบรมหัวหน้าไซต์",
    },
]

HR_NEPO_WARNINGS = [
    {
        "caseType": "Conflict of Interest", "severity": "High", "formalWarning": "Yes",
        "summary": "มีพฤติกรรมอ้างชื่อผู้บริหารใหญ่ (เส้น) ให้จัดซื้อสั่งซื้อสินค้าจากร้านพี่ชายตัวเองโดยไม่ผ่านขั้นตอน",
        "rootCause": "ใช้ความสัมพันธ์ส่วนตัวเอื้อประโยชน์ให้ร้านคนรู้จัก",
        "actionTaken": "ระงับ PO + สอบสวนโดย HR และตรวจสอบการจัดซื้อทั้งหมด",
    },
    {
        "caseType": "Process Violation", "severity": "Medium", "formalWarning": "Yes",
        "summary": "ใช้เส้น/ญาติฝากคนรู้จักเข้าทำงานโดยไม่ผ่านขั้นตอนสรรหา ต้องตรวจสอบรายการอ้างอิง",
        "rootCause": "อ้างคำสั่งผู้บริหารระดับสูงให้เร่งบรรจุ",
        "actionTaken": "ยกเลิกการบรรจุ + ทบทวนขั้นตอนสรรหาทุกตำแหน่ง",
    },
    {
        "caseType": "Policy Violation", "severity": "Low", "formalWarning": "No",
        "summary": "อ้างชื่อผู้บริหารให้ HR เร่งอนุมัติวันลาและเบิกเงินโดยไม่ผ่านขั้นตอน (พฤติกรรมเด็กเส้น)",
        "rootCause": "ต้องการข้ามคิวอนุมัติโดยใช้ชื่อผู้ใหญ่",
        "actionTaken": "ตักเตือนด้วยวาจา + แจ้งผู้บริหารที่ถูกอ้างชื่อให้ทราบ",
    },
    {
        "caseType": "Conflict of Interest", "severity": "Medium", "formalWarning": "No",
        "summary": "แนะนำร้านค้าของคนรู้จักให้ฝ่ายจัดซื้อ โดยอ้างว่าร้านเป็นของผู้บริหาร (Nepotism) ต้องตักเตือน",
        "rootCause": "ความเข้าใจผิดเรื่องนโยบายผลประโยชน์ทับซ้อน",
        "actionTaken": "อบรมนโยบายผลประโยชน์ทับซ้อน + ตักเตือนเป็นลายลักษณ์อักษร",
    },
    {
        "caseType": "Process Violation", "severity": "Medium", "formalWarning": "Yes",
        "summary": "ใช้เส้นให้ญาติเข้ามาทำงานเป็นแม่บ้านสำนักงานโดยไม่ผ่านการสัมภาษณ์",
        "rootCause": "อ้างว่าผู้บริหารใหญ่สั่งให้รับเข้าทำงาน",
        "actionTaken": "จัดสัมภาษณ์ใหม่ตามขั้นตอน + ตักเตือนผู้เกี่ยวข้อง",
    },
    {
        "caseType": "Conflict of Interest", "severity": "High", "formalWarning": "Yes",
        "summary": "อ้างชื่อรองกรรมการผู้จัดการให้เจ้าหน้าที่จัดซื้อเร่งสั่งซื้ออุปกรณ์จากร้านคนรู้จัก",
        "rootCause": "ใช้เส้นสายเพื่อให้การสั่งซื้อผ่านเร็วขึ้น",
        "actionTaken": "ตรวจสอบการสั่งซื้อทั้งหมดของร้านดังกล่าว + ตักเตือน",
    },
]

HR_SALARY_NOTES = [
    "หักประกันสังคมเต็มอัตรา 5% ตามฐานเงินเดือนทุกเดือน",
    "โดนหักประกันสังคม 750 บาท/เดือน + หักหนี้ กยศ. ตามคำสั่งศาล",
    "หักประกันสังคมและกองทุนสำรองเลี้ยงชีพตามอัตรากฎหมาย",
    "หัก กยศ. ตามบังคับคดี 5% และประกันสังคม 5%",
    "หักประกันสังคมปกติ + หักค่าเช่าบ้านพนักงานโครงการ",
    "หักประกันสังคม 5% และหักเงินกู้สหกรณ์ออมทรัพย์ 1,500 บาท",
]

HR_CAMP_FEEDBACK = [
    "เรื่องทะเลาะแคมป์คนงานต้องจัดการให้จบ อย่าให้ลุกลามถึงมือตำรวจอีก",
    "ทะเลาะวิวาทในแคมป์คนงานเกิดขึ้นซ้ำ ต้องวางกฎระเบียบที่พักคนงานให้ชัดเจน",
    "ต้องเข้าไกล่เกลี่ยเรื่องมีปากเสียงในแคมป์ให้เร็วขึ้น อย่าปล่อยให้บานปลาย",
    "แคมป์คนงานยังมีเรื่องทะเลาะกันทุกเดือน ต้องร่วมกับผู้รับเหมาป้องกันเชิงรุก",
]

HR_NEPO_FEEDBACK = [
    "มีพนักงานอ้างเส้นผู้บริหารเพื่อข้ามขั้นตอน ต้องเข้มงวดเรื่องนโยบายจัดซื้ออีกครั้ง",
    "พฤติกรรมเด็กเส้นยังพบเป็นระยะ ต้องประกาศนโยบายผลประโยชน์ทับซ้อนให้ชัดเจน",
    "เรื่องญาติ/คนรู้จักฝากเข้าทำงานต้องตรวจสอบการอ้างอิงทุกครั้งก่อนบรรจุ",
    "พบเคส Nepotism ในไตรมาสนี้ ต้องอบรมจริยธรรมทั้งบริษัท",
]

HR_SICK_SSO_FEEDBACK = [
    "ต้องตรวจสอบการลาป่วยช่วงเลือกตั้งให้รอบคอบ อย่าให้มีการลาที่ไม่สุจริต",
    "พนักงานมาสายช่วงหน้าฝนเยอะ ต้องทบทวนนโยบายยืดหยุ่นเวลาเข้าออก",
    "ตรวจยอดหักประกันสังคมให้ตรงกับ สปส. ทุกเดือนก่อนจ่ายเงินเดือน",
    "มีร้องเรียนเรื่องลาป่วย/ลากิจไม่ตรงตามจริง ต้องสุ่มตรวจใบรับรองแพทย์เพิ่ม",
]

# ── IT content pools ─────────────────────────────────────────────────────────
IT_ASSETS = [
    ("Dell", "Notebook", "Latitude 5440 (Core i5 / 16GB / 512GB SSD)", 32000, "Active"),
    ("Dell", "Notebook", "Latitude 5550 (Core i7 / 16GB / 512GB SSD)", 35000, "Active"),
    ("Lenovo", "Notebook", "ThinkPad X1 Carbon Gen 11 (i7 / 16GB / 512GB)", 56000, "Active"),
    ("Dell", "Workstation", "Precision 3680 Tower (Xeon / 64GB / RTX A4000) ใช้เขียนแบบ BIM", 95000, "Active"),
    ("Dell", "Workstation", "Precision 5820 Tower (Xeon / 32GB) ใช้ตัดต่อวิดีโอ", 105000, "In Repair"),
    ("Apple", "All-in-One", "iMac 24 นิ้ว M3 (16GB / 512GB) งานกราฟิก", 75000, "Active"),
    ("Dell", "Monitor", "UltraSharp U2723QE 27 นิ้ว 4K", 16000, "Active"),
    ("Dell", "Server", "PowerEdge R750 ใช้เป็น VM Host สำนักงานใหญ่", 280000, "Active"),
    ("Lenovo", "Notebook", "ThinkPad T14 Gen 4 (i5 / 16GB)", 42000, "Retired"),
    ("Dell", "Notebook", "Latitude 7450 (i7 / 32GB) เครื่องพรีเซนต์ผู้บริหาร", 45000, "Active"),
]

IT_TICKET_BSOD = [
    {
        "Ticket_Issue": "จอฟ้า (BSOD) ซ้ำ ๆ บนเครื่อง Dell Latitude หลังอัปเดตไดรเวอร์",
        "Description": "เครื่อง Dell Latitude 5440 ของฝ่ายบัญชีจอฟ้าซ้ำหลังอัปเดตไดรเวอร์กราฟิก ต้องถอนการอัปเดตและอัปเดต BIOS",
        "Resolution": "ถอนไดรเวอร์เวอร์ชันล่าสุด + อัปเดต BIOS 1.14.2 ใช้งานปกติ ต้องเฝ้าสังเกต 1 สัปดาห์",
    },
    {
        "Ticket_Issue": "Blue Screen (BSOD) บนเครื่องเขียนแบบหลังอัปเดต Windows",
        "Description": "เครื่อง Dell Precision ของทีม BIM จอฟ้าตอนเปิด Revit หลัง Windows Update ล่าสุด",
        "Resolution": "Rollback Windows Update + ติดตั้งไดรเวอร์ NVIDIA เวอร์ชันเสถียร",
    },
    {
        "Ticket_Issue": "เครื่องจอฟ้า (BSOD) ตอนเปิดไฟล์ CAD ใหญ่ ๆ",
        "Description": "จอฟ้าซ้ำทุกครั้งที่เปิดไฟล์ AutoCAD ขนาดใหญ่ ตรวจพบ RAM เสื่อมสภาพ",
        "Resolution": "เปลี่ยนแรมใหม่ 32GB และรัน memtest ผ่านเรียบร้อย",
    },
]

IT_TICKET_RANSOM = [
    {
        "Ticket_Issue": "เครื่องหัวหน้าโครงการติด Ransomware จากการเปิดไฟล์แนบเมลปลอม",
        "Description": "หัวหน้าโครงการ PRJ018 เปิดไฟล์แนบเมลปลอม เครื่องถูกเข้ารหัสไฟล์ ต้องตัดออกจากเน็ตด่วนและกู้ข้อมูลจาก backup",
        "Resolution": "ตัดเครื่องออกจาก network ทันที + กู้จาก Veeam backup เมื่อคืน ตรวจไม่พบการแพร่กระจาย",
    },
    {
        "Ticket_Issue": "พบมัลแวร์เรียกค่าไถ่ (Ransomware) บนเครื่องพนักงานฝ่ายขาย",
        "Description": "พนักงานฝ่ายขายดาวน์โหลดไฟล์แนบอีเมลต้องสงสัย ไฟล์งานถูกเข้ารหัส .locked",
        "Resolution": "คัดแยกเครื่อง + กู้ข้อมูลจาก OneDrive version history + แจ้งเตือนพนักงานทุกคน",
    },
    {
        "Ticket_Issue": "เครื่อง IT Support โดนไวรัสเรียกค่าไถ่ระหว่างทดสอบไฟล์ต้องสงสัย",
        "Description": "เครื่องทดสอบ sandbox ติด Ransomware ระหว่างวิเคราะห์ตัวอย่างมัลแวร์ ไม่มีข้อมูลสำคัญเสียหาย",
        "Resolution": "ทำลาย sandbox และสร้างใหม่ + อัปเดตฐานข้อมูลลายเซ็นไวรัส",
    },
]

IT_TICKET_NET = [
    {
        "Ticket_Issue": "ต่อเน็ตไซต์งานไม่ได้ 4G Router ค้าง ต้องรีสตาร์ท + ตั้ง VPN ใหม่",
        "Description": "เร้าเตอร์ 4G หน้างาน PRJ029 ค้าง ต่อเน็ตไม่ได้ทั้งแคมป์ ต้องรีสตาร์ทและตั้ง VPN ใหม่ให้ทีมงาน",
        "Resolution": "รีสตาร์ทอุปกรณ์ + ตั้ง VPN WireGuard ใหม่ ทดสอบความเร็ว 50/20 Mbps",
    },
    {
        "Ticket_Issue": "ไซต์งานต่อเน็ตไม่ได้หลังฟ้าผ่า",
        "Description": "หลังพายุฟ้าผ่า เราเตอร์และ switch ไซต์งาน PRJ012 เสียหาย ต่อเน็ตทั้งไซต์ไม่ได้",
        "Resolution": "เปลี่ยนอุปกรณ์สำรอง + ติดตั้ง Surge Protector",
    },
    {
        "Ticket_Issue": "พนักงานบัญชีต่อ VPN จากบ้านไม่ได้หลังอัปเดต Windows",
        "Description": "ต่อ VPN กลับสำนักงานไม่ได้ หลัง Windows Update ล่าสุด error 809",
        "Resolution": "ถอนอัปเดต + ติดตั้ง AnyConnect ใหม่",
    },
]

IT_TICKET_OTHER = [
    {
        "Ticket_Issue": "พนักงานฝ่ายขายอัปโหลดข้อมูลลูกค้าขึ้น Google Drive ส่วนตัว (เสี่ยง PDPA)",
        "Description": "ตรวจพบการแชร์ไฟล์ข้อมูลลูกค้า 1,200 ราย ผ่าน Google Drive ส่วนตัว ต้องแจ้งเตือนและบล็อกสิทธิ์",
        "Resolution": "บล็อกสิทธิ์ + เรียกเคลียร์ข้อมูล + อบรม PDPA ซ้ำ + บันทึก incident",
    },
    {
        "Ticket_Issue": "เครื่องพิมพ์บิลฝ่ายบัญชีพิมพ์ไม่ออก",
        "Description": "เครื่องพิมพ์บิลค้างคิว เอกสารเบิกจ่ายค้าง ต้องเคลียร์คิวและเปลี่ยนหัวพิมพ์",
        "Resolution": "เคลียร์ print queue + เปลี่ยนหัวพิมพ์เสร็จเรียบร้อย",
    },
    {
        "Ticket_Issue": "WiFi สำนักงานช้าช่วงบ่ายทุกวัน",
        "Description": "Access Point ตัวเก่าคับแคบ พนักงาน 80 คนแชร์แบนด์วิดท์ ต้องเพิ่ม AP และจำกัดแบนด์วิดท์",
        "Resolution": "เพิ่ม Access Point 2 ตัว + ตั้ง QoS เรียบร้อย",
    },
]

IT_BSOD_FEEDBACK = [
    "เคสจอฟ้า (BSOD) หลังอัปเดตไดรเวอร์เยอะ ต้องบังคับทดสอบบนเครื่อง pilot ก่อน deploy ทั้งบริษัท",
    "BSOD ยังเจอเป็นระยะ ต้องทำ image มาตรฐานและคุมเวอร์ชันไดรเวอร์กลาง",
]

IT_RANSOM_FEEDBACK = [
    "ช่วยไล่แก้ Ransomware ทัน ห้ามมีเหตุการณ์ซ้ำ ต้องบังคับ MFA + ฝึกพนักงานเรื่อง phishing",
    "เคสเรียกค่าไถ่เดือนนี้จบได้เพราะ backup พร้อม ต้องซ้อมแผนกู้คืน (DR) ทุกไตรมาส",
]

IT_NET_FEEDBACK = [
    "ต่อเน็ตไซต์งานไม่ได้บ่อย ต้องสำรองเร้าเตอร์ 4G และตั้ง VPN ให้พร้อมตลอด",
    "ต้องแก้ปัญหา Network หน้างานล่าช้า เพิ่มเร้าเตอร์สำรองและซิมสำรองอีกค่าย",
]

# ── Extra Skill_Matrix rows guaranteed to contain an X-SKILL keyword ────────
FIN_EXTRA_SKILLS = [
    ("Excel / Pivot วิเคราะห์งบประมาณ", "Microsoft Office Specialist: Excel"),
    ("M365 Excel/Outlook รายงานประจำเดือน", None),
    ("คุม BOQ / ประมาณราคางานก่อสร้าง", None),
    ("ตรวจหน้างานตรวจนับปริมาณงานจริง (Site Count)", None),
    ("AutoCAD เปิดอ่านแบบเพื่อตรวจสอบปริมาณงาน", None),
    ("QuickBooks / ERP (SAP FI)", "SAP FI in-house"),
]
HR_EXTRA_SKILLS = [
    ("Excel / HRIS (Pulse HR)", "HR Professional Certification"),
    ("M365 Teams / Outlook / SharePoint", None),
    ("Facebook Ads ประกาศรับสมัครงาน", None),
    ("CRM (Workday Recruiting)", None),
    ("Excel จัดทำรายงานอัตราการลาออก", None),
]
IT_EXTRA_SKILLS = [
    ("M365 Admin (Exchange/SharePoint)", "Microsoft 365 Certified: Administrator"),
    ("Excel สรุปล็อกอุปกรณ์ไอที", None),
    ("CRM Helpdesk (ServiceNow)", "ITIL v4 Foundation"),
    ("BIM Workstation / ซ่อมเครื่องเขียนแบบ", None),
    ("ตรวจหน้างานติดตั้งอุปกรณ์ Network", None),
]
EXTRA_SKILLS_BY_DEPT = {
    "Finance & Accounting": FIN_EXTRA_SKILLS,
    "HR & Admin": HR_EXTRA_SKILLS,
    "IT": IT_EXTRA_SKILLS,
}

# ── small helpers ────────────────────────────────────────────────────────────
def _manager_code(emp, fallback="EMP125"):
    prof = emp.get("sheets", {}).get("Employee_Profile", {}).get("records", [])
    if prof:
        mc = prof[0].get("managerCode", "")
        if mc:
            return mc
    return fallback


def _merge_headers(emp, sheet_name, cols):
    """Extend the sheet's headers list with any new columns (best effort)."""
    s = emp.get("sheets", {}).get(sheet_name)
    if s and isinstance(s.get("headers"), list):
        for c in cols:
            if c not in s["headers"]:
                s["headers"].append(c)


def _rand_date(rng, y0=2023, y1=2026):
    return f"{rng.randint(y0, y1)}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}"


def _skill_row(rng, skill, cert):
    return {
        "Core_Skill": skill,
        "Certification": cert or "",
        "Language_Score_IELTS": round(rng.uniform(5.5, 7.5), 1),
        "Skill_Level": rng.choice(["Beginner", "Intermediate", "Advanced", "Expert"]),
        "Last_Assessed": f"20{rng.randint(23, 26)}-{rng.randint(1, 12):02d}-15",
        "Notes": rng.choice(THAI_SKILL_NOTES),
    }


# ── Skill_Matrix (all 22 people) ─────────────────────────────────────────────
def _enrich_skills(emp, rng):
    """rc.skill_rows(...) base + guaranteed >=3 X-SKILL keyword rows + Thai Notes."""
    recs = rc.sheet_records(emp, "Skill_Matrix")
    if recs and "Skill_Level" in recs[0]:
        return 0  # already enriched

    dept = emp.get("department", "")
    base = rc.skill_rows(emp.get("code", ""), dept, rng)
    for r in base:
        r["Notes"] = rng.choice(THAI_SKILL_NOTES)

    extra_pool = list(EXTRA_SKILLS_BY_DEPT.get(dept, FIN_EXTRA_SKILLS))
    rng.shuffle(extra_pool)
    existing = {r.get("Core_Skill", "") for r in base}
    existing_norm = {s.split(" (")[0] for s in existing}
    kw_count = sum(1 for r in base
                   if any(k.lower() in str(r.get("Core_Skill", "")).lower() for k in XSKILL_KEYWORDS))
    i = 0
    while kw_count < 3 and i < len(extra_pool):
        skill, cert = extra_pool[i]
        i += 1
        if skill in existing or skill.split(" (")[0] in existing_norm:
            continue  # avoid duplicate skill rows
        base.append(_skill_row(rng, skill, cert))
        existing.add(skill)
        existing_norm.add(skill.split(" (")[0])
        if any(k.lower() in skill.lower() for k in XSKILL_KEYWORDS):
            kw_count += 1

    recs[:] = base
    return len(base)


# ── Finance & Accounting ─────────────────────────────────────────────────────
def _enrich_finance_expense(emp, rng):
    recs = rc.sheet_records(emp, "Expense_Reports")
    if any("Date" in r for r in recs):
        return 0  # already enriched

    approver = _manager_code(emp, "EMP003" if emp.get("code") == "EMP125" else "EMP125")
    new_rows = []

    new_rows.append({
        "Date": _rand_date(rng, 2025, 2026),
        "Category": "เงินทดรองหน้างาน (Advance)",
        "Description": rng.choice(FIN_ADVANCE_DESCS),
        "Amount_THB": rng.randint(8000, 45000),
        "Status": rng.choice(APPROVAL_STATUS),
        "Approver": approver,
    })
    new_rows.append({
        "Date": _rand_date(rng, 2025, 2026),
        "Category": "ค่ารับรองลูกค้า",
        "Description": rng.choice(FIN_ENTERTAIN_DESCS),
        "Amount_THB": rng.randint(6000, 60000),
        "Status": rng.choice(APPROVAL_STATUS),
        "Approver": approver,
    })
    for _ in range(rng.randint(2, 3)):
        cat, desc = rng.choice(FIN_GENERIC_EXPENSES)
        new_rows.append({
            "Date": _rand_date(rng, 2025, 2026),
            "Category": cat,
            "Description": desc,
            "Amount_THB": rng.randint(500, 9000),
            "Status": rng.choice(APPROVAL_STATUS),
            "Approver": approver,
        })

    rc.add_records(emp, "Expense_Reports", new_rows)
    _merge_headers(emp, "Expense_Reports",
                   ["Date", "Category", "Description", "Amount_THB", "Status", "Approver"])
    return len(new_rows)


def _enrich_salary_notes(emp, rng, notes_pool):
    recs = rc.sheet_records(emp, "Salary_History")
    if any("Notes" in r for r in recs):
        return 0
    if not recs:
        return 0
    recs[0]["Notes"] = rng.choice(notes_pool)
    _merge_headers(emp, "Salary_History", ["Notes"])
    return 1


def _enrich_kpi(emp, rng, fb_pool_a, fb_pool_b, fb_pool_c, marker_kws):
    kpi = rc.sheet_records(emp, "KPI_OKR_History")
    if len(kpi) < 3:
        return 0
    last = " ".join(str(kpi[i].get("managerFeedback", "")) for i in range(-3, 0))
    if any(k.lower() in last.lower() for k in marker_kws):
        return 0  # already enriched
    picked = [rng.choice(fb_pool_a), rng.choice(fb_pool_b), rng.choice(fb_pool_c)]
    rng.shuffle(picked)
    for i, fb in zip(range(-3, 0), picked):
        kpi[i]["managerFeedback"] = fb
    return 3

# ── HR & Admin ───────────────────────────────────────────────────────────────
def _enrich_hr_attendance(emp, rng):
    recs = rc.sheet_records(emp, "Attendance_Record")
    text = " ".join(str(r.get("Notes", "")) for r in recs)
    if "เลือกตั้ง" in text and "มาสาย" in text:
        return 0  # already enriched

    sick = rng.choice(HR_SICKPOL_ATTENDANCE)
    late = rng.choice(HR_LATE_ATTENDANCE)
    rc.add_records(emp, "Attendance_Record", [
        {"Late_Arrivals": rng.randint(0, 1), "Sick_Leave_Days": rng.randint(2, 3),
         "Personal_Leave_Days": 0, "Notes": sick},
        {"Late_Arrivals": rng.randint(2, 4), "Sick_Leave_Days": 0,
         "Personal_Leave_Days": 0, "Notes": late},
    ])
    _merge_headers(emp, "Attendance_Record", ["Notes"])
    return 2


def _enrich_hr_warnings(emp, rng, case_ids):
    """Add 1 CAMP + 1 NEPO warning per person (deterministic caseIds)."""
    recs = rc.sheet_records(emp, "Warning_Disciplinary_History")
    existing_ids = {str(r.get("caseId", "")) for r in recs}
    if any(cid in existing_ids for cid in case_ids):
        return 0  # already enriched

    manager = _manager_code(emp, "EMP001" if emp.get("code") == "EMP135" else "EMP135")
    camp = dict(rng.choice(HR_CAMP_WARNINGS))
    nepo = dict(rng.choice(HR_NEPO_WARNINGS))

    def _warn(cid, tpl, project):
        return {
            "caseId": cid,
            "caseDate": _rand_date(rng, 2023, 2026),
            "caseType": tpl["caseType"],
            "severity": tpl["severity"],
            "formalWarning": tpl["formalWarning"],
            "summary": tpl["summary"],
            "rootCause": tpl["rootCause"],
            "actionTaken": tpl["actionTaken"],
            "resolutionStatus": rng.choice(["Resolved", "Resolved with Monitoring", "Under Investigation"]),
            "managerInvolved": manager,
            "hrConfidentialityLevel": "Tier 1 — Strict",
            "redactionRequired": "No",
            "linkedProjectId": project,
            "linkedTrainingId": f"T{rng.randint(1, 15):02d}",
        }

    rc.add_records(emp, "Warning_Disciplinary_History", [
        _warn(case_ids[0], camp, f"PRJ{rng.randint(1, 50):03d}"),
        _warn(case_ids[1], nepo, f"PRJ{rng.randint(1, 50):03d}"),
    ])
    return 2


def _enrich_hr(emp, rng):
    stats = {"attendance": 0, "warnings": 0, "salary": 0, "kpi": 0}
    stats["attendance"] = _enrich_hr_attendance(emp, rng)
    stats["salary"] = _enrich_salary_notes(emp, rng, HR_SALARY_NOTES)
    stats["kpi"] = _enrich_kpi(emp, rng, HR_CAMP_FEEDBACK, HR_NEPO_FEEDBACK,
                               HR_SICK_SSO_FEEDBACK, ["แคมป์", "เส้น", "ลาป่วย", "ประกันสังคม"])
    return stats


# ── IT ───────────────────────────────────────────────────────────────────────
def _enrich_it_assets(emp, rng):
    recs = rc.sheet_records(emp, "IT_Asset_Register")
    if any("Model" in r for r in recs):
        return 0  # already enriched

    # fill Model on legacy rows too
    model_by_brand = {
        "MacBook Pro 16-inch": "MacBook Pro 16 นิ้ว M2 Pro (16GB/512GB)",
        "Dell UltraSharp U2723QE": "UltraSharp U2723QE 27 นิ้ว 4K",
    }
    for r in recs:
        r["Model"] = model_by_brand.get(str(r.get("Brand", "")), "รุ่นมาตรฐานบริษัท")

    pool = list(IT_ASSETS)
    rng.shuffle(pool)
    n = rng.randint(4, 5)
    chosen = pool[:n]
    kw_count = sum(1 for (b, t, m, c, s) in chosen
                   if any(k in f"{b} {m}" for k in ("Dell", "Latitude", "ThinkPad", "Lenovo", "Workstation", "Precision")))
    while kw_count < 3 and n < len(pool):
        chosen.append(pool[n])
        n += 1
        b, t, m, c, s = chosen[-1]
        if any(k in f"{b} {m}" for k in ("Dell", "Latitude", "ThinkPad", "Lenovo", "Workstation", "Precision")):
            kw_count += 1

    rows = [{
        "Brand": b, "Asset_Type": t, "Model": m, "Cost_THB": c, "Status": s,
    } for (b, t, m, c, s) in chosen]
    rc.add_records(emp, "IT_Asset_Register", rows)
    _merge_headers(emp, "IT_Asset_Register", ["Model"])
    return len(rows)


def _enrich_it_tickets(emp, rng):
    recs = rc.sheet_records(emp, "IT_Ticket_Log")
    if any("Reported_Date" in r for r in recs):
        return 0  # already enriched

    # enrich legacy rows
    for r in recs:
        r.setdefault("Reported_Date", _rand_date(rng, 2025, 2026))
        r.setdefault("Priority", rng.choice(["Low", "Medium", "High"]))
        r.setdefault("Description", f"บันทึกเพิ่ม: {r.get('Ticket_Issue', '')} รอทีม IT เข้าไปดู")
        r.setdefault("Resolution", "แก้ไขเสร็จเรียบร้อยและแจ้งผู้แจ้งแล้ว")

    pools = [IT_TICKET_BSOD, IT_TICKET_RANSOM, IT_TICKET_NET, IT_TICKET_OTHER]
    rows = []
    for pool in pools:
        tpl = dict(rng.choice(pool))
        rows.append({
            "Ticket_Issue": tpl["Ticket_Issue"],
            "Status": rng.choice(["Resolved", "In Progress", "Closed", "Pending"]),
            "Description": tpl["Description"],
            "Resolution": tpl["Resolution"],
            "Reported_Date": _rand_date(rng, 2025, 2026),
            "Priority": rng.choice(["Critical", "High", "Medium"]),
        })
    rc.add_records(emp, "IT_Ticket_Log", rows)
    _merge_headers(emp, "IT_Ticket_Log",
                   ["Description", "Resolution", "Reported_Date", "Priority"])
    return len(rows)


def _enrich_it(emp, rng):
    stats = {"assets": 0, "tickets": 0, "kpi": 0}
    stats["assets"] = _enrich_it_assets(emp, rng)
    stats["tickets"] = _enrich_it_tickets(emp, rng)
    stats["kpi"] = _enrich_kpi(emp, rng, IT_BSOD_FEEDBACK, IT_RANSOM_FEEDBACK,
                               IT_NET_FEEDBACK, ["BSOD", "Ransomware", "เน็ต", "Network"])
    return stats

# ── apply ────────────────────────────────────────────────────────────────────
CASE_BASE = 292  # continue after existing CASE... (max 291 in registry)


def apply(employees):
    stats = {
        "employees_enriched": 0,
        "finance": {"expense_rows": 0, "salary_notes": 0, "kpi": 0, "skill_rows": 0},
        "hr": {"attendance_rows": 0, "warnings": 0, "salary_notes": 0, "kpi": 0, "skill_rows": 0},
        "it": {"asset_rows": 0, "ticket_rows": 0, "kpi": 0, "skill_rows": 0},
        "warning_case_ids": [],
    }

    fin_codes = rc.codes_in(employees, "Finance & Accounting")
    hr_codes = rc.codes_in(employees, "HR & Admin")
    it_codes = rc.codes_in(employees, "IT")

    # Finance & Accounting (EMP125-134)
    for code in fin_codes:
        emp = employees[code]
        rng = rc.rng_for(code, "cluster_c")
        s = stats["finance"]
        s["expense_rows"] += _enrich_finance_expense(emp, rng)
        s["salary_notes"] += _enrich_salary_notes(emp, rng, FIN_SALARY_NOTES)
        s["kpi"] += _enrich_kpi(emp, rng, FIN_ADV_FEEDBACK, FIN_ENT_FEEDBACK,
                                FIN_KYS_FEEDBACK, ["เบิก", "Advance", "เงินทดรอง", "รับรอง", "กยศ."])
        s["skill_rows"] += _enrich_skills(emp, rng)
        stats["employees_enriched"] += 1

    # HR & Admin (EMP135-142) — deterministic new caseIds, continuing CASE2xxx series
    for idx, code in enumerate(hr_codes):
        emp = employees[code]
        rng = rc.rng_for(code, "cluster_c")
        case_ids = [f"CASE{CASE_BASE + idx * 2}", f"CASE{CASE_BASE + idx * 2 + 1}"]
        stats["warning_case_ids"].extend(case_ids)
        s = stats["hr"]
        s["attendance_rows"] += _enrich_hr_attendance(emp, rng)
        s["warnings"] += _enrich_hr_warnings(emp, rng, case_ids)
        s["salary_notes"] += _enrich_salary_notes(emp, rng, HR_SALARY_NOTES)
        s["kpi"] += _enrich_kpi(emp, rng, HR_CAMP_FEEDBACK, HR_NEPO_FEEDBACK,
                                HR_SICK_SSO_FEEDBACK, ["แคมป์", "เส้น", "ลาป่วย", "ประกันสังคม"])
        s["skill_rows"] += _enrich_skills(emp, rng)
        stats["employees_enriched"] += 1

    # IT (EMP143-146)
    for code in it_codes:
        emp = employees[code]
        rng = rc.rng_for(code, "cluster_c")
        s = stats["it"]
        s["asset_rows"] += _enrich_it_assets(emp, rng)
        s["ticket_rows"] += _enrich_it_tickets(emp, rng)
        s["kpi"] += _enrich_kpi(emp, rng, IT_BSOD_FEEDBACK, IT_RANSOM_FEEDBACK,
                                IT_NET_FEEDBACK, ["BSOD", "Ransomware", "เน็ต", "Network"])
        s["skill_rows"] += _enrich_skills(emp, rng)
        stats["employees_enriched"] += 1

    return stats


# ── self-check (mirrors audit_realism.py for cluster C criteria) ─────────────
SELF_CHECKS = [
    ("FIN-ADV", "Finance & Accounting", ["Expense_Reports", "Salary_History", "KPI_OKR_History"],
     ["Description", "Category", "Notes", "managerFeedback"],
     ["Advance", "เบิกล่วงหน้า", "เบิก", "ล่าช้า", "เงินทดรอง"]),
    ("FIN-ENT", "Finance & Accounting", ["Expense_Reports", "KPI_OKR_History"],
     ["Description", "Category", "Notes", "managerFeedback"],
     ["รับรอง", "ลูกค้า", "มื้อ", "ค่ารับรอง"]),
    ("FIN-KYS", "Finance & Accounting", ["Salary_History", "Expense_Reports", "KPI_OKR_History"],
     ["Notes", "Description", "managerFeedback"],
     ["กยศ.", "กองทุนเงินให้กู้ยืม", "หัก"]),
    ("HR-SICKPOL", "HR & Admin", ["Attendance_Record", "Warning_Disciplinary_History", "KPI_OKR_History"],
     ["Notes", "summary", "managerFeedback"],
     ["ลาป่วย", "การเมือง", "ขอลา", "sick"]),
    ("HR-LATE", "HR & Admin", ["Attendance_Record", "Warning_Disciplinary_History"],
     ["Notes", "summary"], ["สาย", "ฝน", "รถติด", "Late"]),
    ("HR-CAMP", "HR & Admin", ["Warning_Disciplinary_History", "Grievance_Log"],
     ["summary", "rootCause", "Description"], ["ทะเลาะ", "แคมป์", "คนงาน", "มีปากเสียง"]),
    ("HR-NEPO", "HR & Admin", ["Warning_Disciplinary_History", "KPI_OKR_History"],
     ["summary", "rootCause", "managerFeedback"],
     ["เส้น", "Nepotism", "ญาติ", "เด็กเส้น", "คนรู้จัก"]),
    ("HR-SSO", "HR & Admin", ["Salary_History", "Attendance_Record"],
     ["Notes", "Description"], ["ประกันสังคม", "SSO", "หัก"]),
    ("IT-ASSET", "IT", ["IT_Asset_Register"], ["Brand", "Asset_Type", "Model"],
     ["Dell", "Latitude", "ThinkPad", "Lenovo", "Workstation", "Precision"]),
    ("IT-BSOD", "IT", ["IT_Ticket_Log", "KPI_OKR_History"],
     ["Ticket_Issue", "Description", "managerFeedback"], ["จอฟ้า", "BSOD", "Blue Screen"]),
    ("IT-RANSOM", "IT", ["IT_Ticket_Log", "KPI_OKR_History"],
     ["Ticket_Issue", "Description", "managerFeedback"], ["Ransomware", "เรียกค่าไถ่", "ไวรัส", "มัลแวร์"]),
    ("IT-NET", "IT", ["IT_Ticket_Log", "KPI_OKR_History"],
     ["Ticket_Issue", "Description", "managerFeedback"],
     ["เน็ต", "Network", "ไซต์งาน", "เชื่อมต่อ", "internet"]),
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


def self_check(employees):
    from collections import defaultdict
    by_dept = defaultdict(list)
    for code, emp in employees.items():
        by_dept[emp.get("department", "")].append(code)

    results = {}
    for cid, dept, sheets, fields, keywords in SELF_CHECKS:
        codes = sorted(by_dept.get(dept, []))
        matched_codes = [c for c in codes if _matched(employees[c], sheets, fields, keywords)]
        results[cid] = {
            "matched": len(matched_codes), "total": len(codes),
            "coverage": round(len(matched_codes) / len(codes), 3) if codes else 0.0,
            "missing": [c for c in codes if c not in set(matched_codes)],
        }

    # X-SKILL over the 22 cluster-C employees
    c_codes = sorted(rc.codes_in(employees, "Finance & Accounting", "HR & Admin", "IT"))
    x_ok = 0
    for code in c_codes:
        recs = employees[code].get("sheets", {}).get("Skill_Matrix", {}).get("records", [])
        real = [r for r in recs
                if any(k.lower() in str(r.get("Core_Skill", "")).lower() for k in XSKILL_KEYWORDS)]
        if len(real) >= 3:
            x_ok += 1
    results["X-SKILL"] = {"matched": x_ok, "total": len(c_codes),
                          "coverage": round(x_ok / len(c_codes), 3), "missing": []}
    return results


def _fmt_cov(results):
    return " | ".join(f"{cid}={r['matched']}/{r['total']} ({r['coverage']:.0%})"
                      for cid, r in results.items())


if __name__ == "__main__":
    import json as _json
    data = rc.load_employees()
    stats = apply(data)
    rc.save_smoke(data, "cluster_c_smoke")
    print(_json.dumps(stats, ensure_ascii=False, indent=1))
    cov = self_check(data)
    print("COVERAGE:", _fmt_cov(cov))
    failed = [cid for cid, r in cov.items() if r["coverage"] < 0.9 and cid != "X-SKILL"]
    if cov["X-SKILL"]["coverage"] < 1.0:
        failed.append("X-SKILL")
    if failed:
        print("FAILED(<90% or X-SKILL<100%):", failed)
        for cid in failed:
            if cov[cid]["missing"]:
                print(f"  {cid} missing:", cov[cid]["missing"])
        raise SystemExit(1)
    print("Smoke JSON → /tmp/builderseye_cluster_c_smoke.json  (all criteria >=90%)")
