# tools/upgrade_360/config.py
"""ค่าคงที่กลางของ 360-Degree Digital Twin & Time-Series Logs pipeline.

ไฟล์นี้เป็น single source of truth สำหรับ path/ค่าเริ่มต้นทั้งหมด
เพื่อให้ phase 1/2/3 (relationship_graph, phase2_generator, phase3_validate)
ใช้ค่าเดียวกัน โดยไม่ต้อง hardcode path ซ้ำในแต่ละโมดูล
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

# ── Path พื้นฐาน ──────────────────────────────────────────────────────────
# APP_ROOT = รากโปรเจกต์ (/Users/arm/AI Test/mail-onedrive-org-graph)
# tools/upgrade_360/config.py -> parents[0]=upgrade_360, parents[1]=tools, parents[2]=root
APP_ROOT = Path(__file__).resolve().parents[2]

TOOLS_DIR = APP_ROOT / "tools"
UPGRADE_360_DIR = TOOLS_DIR / "upgrade_360"

# ── ข้อมูลต้นทาง (อ่านอย่างเดียว — ห้ามเขียนทับ) ─────────────────────────
DEFAULT_INPUT_DIR = APP_ROOT / "src" / "data" / "hr_onedrive_demo"
DEFAULT_OUTPUT_DIR = UPGRADE_360_DIR / "out"
IDENTITY_GRAPH_PATH = APP_ROOT / "src" / "data" / "identity-graph.json"

# design files — ของเพื่อนร่วมทีม (Lead Data Engineer) อ่านอย่างเดียว
DESIGN_DIR = UPGRADE_360_DIR / "design"
RELATIONSHIP_MATRIX_PATH = DESIGN_DIR / "relationship_matrix.json"
STORYLINE_CATALOG_PATH = DESIGN_DIR / "storyline_catalog.json"

# checkpoint / log
CHECKPOINT_FILE = "checkpoint.json"  # อยู่ใต้ output dir ที่กำหนดตอน run

# ── ชื่อ 23 sheets (fallback — ปกติ detect จากไฟล์จริงใน excel_io) ───────
DEFAULT_SHEET_NAMES: tuple[str, ...] = (
    "Employee_Profile",
    "Career_Timeline",
    "KPI_OKR_History",
    "Project_History",
    "Collaboration_Network",
    "Warning_Disciplinary_History",
    "Learning_Development",
    "IT_Asset_Register",
    "IT_Ticket_Log",
    "Software_Licenses",
    "Salary_History",
    "Attendance_Record",
    "360_Feedback",
    "Skill_Matrix",
    "Succession_Planning",
    "Benefit_Claims",
    "Expense_Reports",
    "Grievance_Log",
    "Compliance_Mandates",
    "Onboarding_Journey",
    "Employee_Engagement",
    "Physical_Security",
    "Timesheet_Log",
)

# ── DeepSeek API ──────────────────────────────────────────────────────────
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
# อย่า hardcode key ที่นี่ — อ่านจาก env DEEPSEEK_API_KEY หรือ --api-key เสมอ
_DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()

# ── รูปแบบ output ─────────────────────────────────────────────────────────
ROW_TARGET_PER_EMPLOYEE = (300, 500)  # เป้าหมาย rows/คน (จาก DESIGN.md)


def get_api_key(cli_key: Optional[str] = None) -> str:
    """คืนค่า API key — ลำดับ: --api-key (CLI) > env DEEPSEEK_API_KEY > ''

    ห้าม print/log key นี้เด็ดขาด — ใช้เพื่อสร้าง client เท่านั้น
    """
    if cli_key and cli_key.strip():
        return cli_key.strip()
    return _DEEPSEEK_API_KEY


def has_api_key(cli_key: Optional[str] = None) -> bool:
    return bool(get_api_key(cli_key))
