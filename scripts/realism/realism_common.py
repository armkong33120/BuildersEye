#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""realism_common.py — shared infra for the BuildersEye 150-employee realism upgrade.

Single source of truth for:
  * registry paths (server/.data/registry/employees.json + schema.json)
  * load/save helpers (smoke-test saves go to /tmp — NEVER the real registry)
  * sheet access helpers (records returned by reference -> mutate in place)
  * deterministic per-employee RNG (seeded by EMP code + salt)
  * Thai content building blocks shared across clusters
  * schema.json refresh after apply

Coordination model:
  * Every dept_cluster_*.py exposes:  apply(employees: dict) -> dict  (mutate & return)
  * apply_all.py runs clusters A -> B -> C -> D, then the coordinator's
    perfection_pass, saves employees.json ONCE, and refreshes schema.json.
  * audit_realism.py validates the 12 departments' realism signals and writes
    .data/data_realism_gap_report.md
"""
from __future__ import annotations

import datetime
import json
import random
from collections import defaultdict
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
REGISTRY_FILE = APP_ROOT / "server" / ".data" / "registry" / "employees.json"
SCHEMA_FILE = APP_ROOT / "server" / ".data" / "registry" / "schema.json"
REPORT_DIR = APP_ROOT / ".data"

SENSITIVE_SHEETS = {
    "Salary_History",
    "Warning_Disciplinary_History",
    "Grievance_Log",
    "Expense_Reports",
    "Benefit_Claims",
}


# ── load / save ──────────────────────────────────────────────────────────
def load_employees(path=None):
    with open(path or REGISTRY_FILE, encoding="utf-8") as f:
        return json.load(f)


def save_employees(data, path=None):
    p = Path(path) if path else REGISTRY_FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    return p


def save_smoke(data, tag):
    """Save a scratch copy to /tmp for teammate smoke tests (never touches registry)."""
    out = Path("/tmp") / f"builderseye_{tag}.json"
    return save_employees(data, out)


# ── sheet helpers ────────────────────────────────────────────────────────
def sheet_records(emp, sheet_name):
    """Return the mutable list of records for emp[sheet_name], creating it if missing."""
    sheets = emp.setdefault("sheets", {})
    if sheet_name not in sheets:
        sheets[sheet_name] = {"headers": [], "records": []}
    return sheets[sheet_name]["records"]


def add_records(emp, sheet_name, records):
    recs = sheet_records(emp, sheet_name)
    for r in records:
        recs.append(dict(r))
    return recs


def set_field(emp, sheet_name, row_index, field, value):
    recs = sheet_records(emp, sheet_name)
    if 0 <= row_index < len(recs):
        recs[row_index][field] = value


def rng_for(emp_code, salt=""):
    return random.Random(f"builderseye::realism::{emp_code}::{salt}")


def employees_by_dept(employees):
    m = defaultdict(list)
    for code, emp in employees.items():
        m[emp.get("department", "")].append(code)
    return dict(m)


def codes_in(employees, *departments):
    m = employees_by_dept(employees)
    out = []
    for d in departments:
        out.extend(m.get(d, []))
    return sorted(out)


def row_count(employees):
    return sum(
        len(s.get("records", []))
        for e in employees.values()
        for s in e.get("sheets", {}).values()
    )


def sheet_count(employees, sheet_name):
    return sum(
        len(e.get("sheets", {}).get(sheet_name, {}).get("records", []))
        for e in employees.values()
    )


def pick(rng, seq, k=1):
    return rng.sample(list(seq), k=min(k, len(seq)))


# ── schema refresh ───────────────────────────────────────────────────────
def refresh_schema(employees, schema_file=None):
    """Rebuild schema.json columns from actual record fields (preserve sensitivity + firstSeen)."""
    sf = Path(schema_file) if schema_file else SCHEMA_FILE
    old = {}
    if sf.exists():
        with open(sf, encoding="utf-8") as fh:
            old = json.load(fh).get("sheets", {})
    sheets = {}
    for emp in employees.values():
        for sname, sdata in emp.get("sheets", {}).items():
            entry = sheets.setdefault(sname, {"columns": {}})
            for rec in sdata.get("records", []):
                for col in rec:
                    c = entry["columns"].setdefault(col, {"seenIn": 0})
                    c["seenIn"] += 1
    now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    for sname, entry in sheets.items():
        prev = old.get(sname, {})
        entry["firstSeen"] = prev.get("firstSeen", now)
        entry["sensitivity"] = prev.get(
            "sensitivity", "sensitive" if sname in SENSITIVE_SHEETS else "standard"
        )
        for col in entry["columns"]:
            entry["columns"][col]["firstSeen"] = (
                prev.get("columns", {}).get(col, {}).get("firstSeen", now)
            )
    out = {"sheets": sheets, "updatedAt": now}
    sf.parent.mkdir(parents=True, exist_ok=True)
    with open(sf, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    return out


# ── shared Thai content pools (clusters may extend locally) ─────────────
TOOLS_BY_ROLE = {
    "Engineering & Construction": [
        ("AutoCAD 2D/3D", "AutoCAD Certified Professional"),
        ("Revit/BIM Modeling", "Revit Architecture Certified"),
        ("ตรวจหน้างาน (Site Inspection)", "จป. วิชาชีพ (Safety Officer)"),
        ("คุม BOQ / ประมาณราคา", "BOQ & Estimation (Training in-house)"),
        ("SketchUp", None),
        ("อ่านแบบ Shop Drawing / As-Built", None),
        ("สัญญาเหมาและบันทึกปริมาณงาน (Variation Order)", None),
        ("ทดสอบคุณภาพคอนกรีต (Slump / Cylinder)", "ใบรับรองผู้ทดสอบวัสดุ กรมโยธาฯ"),
    ],
    "Design & Architecture": [
        ("AutoCAD 2D/3D", "AutoCAD Certified Professional"),
        ("Revit/BIM (Architecture)", "Revit Architecture Certified"),
        ("SketchUp + Enscape", None),
        ("คุม BOQ / ประมาณราคา", "BOQ & Estimation (Training in-house)"),
        ("ออกแบบแปลน/แบบก่อสร้าง (Shop Drawing)", "สถาปนิก ก.ส.ท."),
        ("เขียนแบบ MEP ประสานงาน", "BIM Coordination Certified"),
    ],
    "Procurement & Warehouse": [
        ("จัดซื้อจัดจ้าง (Procurement)", "Procurement & Sourcing Certified"),
        ("ระบบคลังสินค้า (WMS)", "SAP MM / ERP in-house"),
        ("เจรจาต่อรองซัพพลายเออร์", None),
        ("ตรวจรับของหน้างาน (QC Receiving)", None),
        ("Excel / Pivot วิเคราะห์ราคา", None),
    ],
    "Sales": [
        ("ขายบ้าน/คอนโด (Consultative Selling)", None),
        ("CRM (Salesforce / Pipedrive)", "Salesforce Admin Certified"),
        ("วิเคราะห์ลูกค้าและสัญญาเงินกู้", None),
        ("พาลูกค้าชมโครงการ (Site Visit)", None),
        ("Excel / Pivot ติดตาม pipeline", None),
    ],
    "Marketing": [
        ("Facebook Ads / Meta Ads", "Meta Blueprint Certified"),
        ("TikTok Content & Ads", "TikTok Ads Certification"),
        ("Google Ads / SEO", "Google Ads Search Certification"),
        ("จัดอีเวนต์/ออกบูธ (มหกรรมบ้าน)", None),
        ("Canva / Adobe Creative", None),
    ],
    "Finance & Accounting": [
        ("บัญชีต้นทุนงานก่อสร้าง", None),
        ("ภาษี (PND/PP/ VAT)", "ผู้ทำบัญชี (กรมพัฒนาธุรกิจการค้า)"),
        ("Excel วิเคราะห์งบประมาณ (Pivot)", None),
        ("ควบคุมค่าใช้จ่ายหน้างาน (Petty Cash)", None),
        ("QuickBooks / ERP", "SAP FI in-house"),
    ],
    "HR & Admin": [
        ("สรรหาและว่าจ้าง (Recruitment)", "HR Professional Certification"),
        ("ประกันสังคม / กฎหมายแรงงาน", None),
        ("จัดอบรมและประเมินผลพนักงาน", None),
        ("Excel / HRIS (Pulse HR)", None),
        ("สวัสดิการและแรงงานสัมพันธ์", None),
    ],
    "Customer Service & Warranty": [
        ("รับแจ้งซ่อม / จัดการ Defect", None),
        ("บริการลูกค้า (Service Mind)", "Service Excellence Training"),
        ("ตรวจสอบหน้างาน (Warranty Inspection)", None),
        ("Excel / CRM จัดการคำร้อง", None),
    ],
    "IT": [
        ("M365 Admin (Exchange/SharePoint)", "Microsoft 365 Certified: Administrator"),
        ("Network / ต่อเน็ตไซต์งาน (VPN)", "CCNA (Cisco)"),
        ("Endpoint / Anti-Ransomware", "Security+"),
        ("Helpdesk / ServiceNow", "ITIL v4 Foundation"),
        ("BIM Workstation / ซ่อมเครื่องเขียนแบบ", None),
    ],
    "Legal": [
        ("ร่างและตรวจสัญญา (Contract Drafting)", "เนติบัณฑิตไทย"),
        ("กฎหมายอสังหาริมทรัพย์/ที่ดิน", None),
        ("กำกับ EIA / Compliance", None),
        ("คดีผู้บริโภค (สคบ.)", None),
    ],
    "Executive": [
        ("Strategic Planning", "Board Director Certification"),
        ("Financial Acumen / P&L", None),
        ("Corporate Governance", None),
        ("Negotiation / M&A", None),
    ],
    "Office Support": [
        ("งานธุรการ/งานสารบรรณ", None),
        ("ดูแลยานพาหนะบริษัท (Logistics)", "ใบขับขี่รถยนต์"),
        ("ต้อนรับ/ดูแลอาคาร (Facility)", None),
        ("Excel / เอกสารสัญญา", None),
    ],
}


def skill_rows(emp_code, department, rng):
    """Return 4-6 realistic Skill_Matrix rows for an employee (deterministic)."""
    pool = TOOLS_BY_ROLE.get(department, TOOLS_BY_ROLE["Office Support"])
    n = rng.randint(4, 6)
    chosen = rng.sample(pool, min(n, len(pool)))
    rows = []
    for skill, cert in chosen:
        ielts = round(rng.uniform(5.5, 7.5), 1)
        rows.append({
            "Core_Skill": skill,
            "Certification": cert or "",
            "Language_Score_IELTS": ielts,
            "Skill_Level": rng.choice(["Beginner", "Intermediate", "Advanced", "Expert"]),
            "Last_Assessed": f"20{rng.randint(23, 26)}-{rng.randint(1, 12):02d}-15",
            "Notes": "",
        })
    return rows
