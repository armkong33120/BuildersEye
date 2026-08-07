# -*- coding: utf-8 -*-
"""pydantic_models.py — Phase 2 Data Generation Engine

Models ใช้ validate JSON ที่ได้จาก DeepSeek API (structured outputs) และ
แปลงเป็น dict สำหรับ pandas / openpyxl ผ่าน ``to_row()``

เจ้าของไฟล์: Data Generation (Phase 2)
ไม่อนุญาตให้แก้ไฟล์นี้โดยทีมอื่นโดยไม่ประสานงาน
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ---------------------------------------------------------------------------
# คอลัมน์ร่วม (Common columns) ตาม DESIGN.md §5.1 — เพิ่มทุก sheet ที่เป็น log
# ---------------------------------------------------------------------------
COMMON_COLS: List[str] = [
    "logDateTime",
    "logType",
    "subject",
    "counterpartyEmployeeCode",
    "eventId",
    "location",
    "source",
    "notes",
]

LOG_TYPES = {
    "incident",
    "warning",
    "grievance",
    "expense_irregularity",
    "praise",
    "routine",
    "access",
    "legacy_context",
}


class _BaseLog(BaseModel):
    """Base: ยอมรับ field พิเศษจาก API (extra='ignore') และ strip whitespace."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    @field_validator("logDateTime", mode="before", check_fields=False)
    @classmethod
    def _normalize_dt(cls, v: Any) -> str:
        if v is None:
            return ""
        s = str(v).strip()
        # ตัดท้าย microsecond ที่ไม่จำเป็น เช่น 2023-11-05T09:14:00.123456+07:00
        if "." in s and "+" in s:
            head, _, tz = s.partition("+")
            s = head.split(".")[0] + "+" + tz
        return s


class DramaEventInjection(_BaseLog):
    """แถว log ที่ได้จาก API / template สำหรับเหตุการณ์ดราม่า (20% ของแถว).

    ฟิลด์บังคับ (สัญญากับ deepseek_client / phase2_generator):
      eventId, logDateTime, sheet, subject, descriptionTH,
      counterpartyEmployeeCode, location, riskLevel

    ฟิลด์เสริม (generator เติมให้เอง ไม่ต้องให้ API ส่ง):
      employeeCode, category, logType, source, notes, relationship, faction,
      financialImpactTHB, resolutionStatus, expansion
    """

    eventId: str = Field(default="", description="FK → storyline_catalog.json")
    logDateTime: str = Field(default="", description="ISO 8601 +07:00 — ต้องเหมือนกันทุกฝั่ง")
    sheet: str = Field(default="", description="ชื่อ sheet ปลายทาง (23 sheets)")
    subject: str = Field(default="", description="สรุปสั้นภาษาไทย")
    descriptionTH: str = Field(default="", description="รายละเอียดยาวภาษาไทย สำหรับ RAG chunking")
    counterpartyEmployeeCode: str = Field(default="", description="รหัสคนเกี่ยวข้อง คั่น ';'")
    location: str = Field(default="", description="PRJxxx / site-xxx / HQ")
    riskLevel: str = Field(default="medium", description="low/medium/high/critical")

    # --- ฟิลด์เสริม (generator เติม) ---
    employeeCode: str = Field(default="", description="พนักงานเจ้าของไฟล์ฝั่งนี้")
    category: str = Field(default="", description="crisis/politics/grey_area_collusion/...")
    logType: str = Field(default="incident", description="enum ใน LOG_TYPES")
    source: str = Field(default="", description="HRIS/ITSM/Expense/Badge/360/CRM")
    notes: str = Field(default="", description="ข้อความเพิ่มเติม")
    relationship: str = Field(default="", description="conflict/collusion/friendship/...")
    faction: str = Field(default="", description="old_guard/new_guard/neutral")
    financialImpactTHB: Optional[float] = Field(default=None)
    resolutionStatus: str = Field(default="")
    expansion: int = Field(default=1, description="จำนวนแถวที่เหตุการณ์นี้ขยายได้")

    @field_validator("logType", mode="before")
    @classmethod
    def _norm_log_type(cls, v: Any) -> str:
        if v is None:
            return "incident"
        s = str(v).strip().lower()
        return s if s in LOG_TYPES else "incident"

    def to_row(self) -> Dict[str, Any]:
        """แปลงเป็น dict สำหรับ pandas (drop ค่าว่างเพื่อให้ DataFrame ดูสะอาด)."""
        return {
            k: ("" if v is None else v)
            for k, v in self.model_dump().items()
            if v not in (None, "", [])
        }


class RoutineLogRow(_BaseLog):
    """แถว Routine Log (80% ของแถว) — Faker(th_TH) + template กิจกรรมรายวัน/สัปดาห์."""

    logDateTime: str = Field(default="")
    sheet: str = Field(default="")
    activityTH: str = Field(default="", description="กิจกรรมภาษาไทย (ใช้เป็น subject ด้วย)")
    logType: str = Field(default="routine")
    subject: str = Field(default="")
    counterpartyEmployeeCode: str = Field(default="")
    eventId: str = Field(default="", description="เว้นว่างสำหรับ routine; เติมได้ถ้าเป็น routine จาก catalog")
    location: str = Field(default="")
    source: str = Field(default="")
    notes: str = Field(default="")
    originalCols: Dict[str, Any] = Field(
        default_factory=dict, description="ค่าเติมสำหรับคอลัมน์เดิมของ sheet"
    )
    # metadata สำหรับ pair-link (routine ประชุมกับเพื่อนร่วมทีม) — ใช้ใน phase2 เท่านั้น
    pairWith: str = Field(default="", description="รหัสคู่สนทนา (ถ้ามี) — low-key link")

    def to_row(self) -> Dict[str, Any]:
        d = {
            "logDateTime": self.logDateTime,
            "sheet": self.sheet,
            "activityTH": self.activityTH,
            "logType": self.logType,
            "subject": self.subject or self.activityTH,
            "counterpartyEmployeeCode": self.counterpartyEmployeeCode,
            "eventId": self.eventId,
            "location": self.location,
            "source": self.source,
            "notes": self.notes,
        }
        return {k: v for k, v in d.items() if v not in (None, "")}


class TimelineRow(_BaseLog):
    """แถว Timeline รวม (ต่อคน ต่อเหตุการณ์) — ใช้สำหรับ checkpoint / progress
    และเป็นสัญญาให้ Phase 3 ตรวจข้ามไฟล์ (eventId + logDateTime เดียวกันทั้ง 2 ฝั่ง)."""

    logDateTime: str = Field(default="")
    eventId: str = Field(default="")
    sheet: str = Field(default="")
    employeeCode: str = Field(default="")
    subject: str = Field(default="")
    descriptionTH: str = Field(default="")
    counterpartyEmployeeCode: str = Field(default="")
    logType: str = Field(default="incident")
    riskLevel: str = Field(default="")
    category: str = Field(default="")
    source: str = Field(default="")
    location: str = Field(default="")
    relationship: str = Field(default="")
    faction: str = Field(default="")
    notes: str = Field(default="")

    def to_row(self) -> Dict[str, Any]:
        return {
            k: ("" if v is None else v)
            for k, v in self.model_dump().items()
            if v not in (None, "")
        }
