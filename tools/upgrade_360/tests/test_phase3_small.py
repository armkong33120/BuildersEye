# -*- coding: utf-8 -*-
"""test_phase3_small.py — scenario จำลอง: คู่ EMP001-EMP002 มี event ในฝั่ง A แต่ไม่มีฝั่ง B

ขั้นตอน:
  1) copy ไฟล์ต้นฉบับ EMP001/EMP002 ไป tmp (ยังไม่มีแถว log — เหมือนยังไม่ upgrade)
  2) inject แถว event (SVC-09, logDateTime เดียว) เข้า Collaboration_Network ของ EMP001 (ฝั่ง A) อ้าง EMP002
  3) cross_validate_relationships(repair=False) → ต้องเจอ 1 mismatch (missingSide='b')
  4) cross_validate_relationships(repair=True)  → repair สร้าง mirror ในไฟล์ EMP002 (เวลา/eventId เดิม)
  5) cross_validate_relationships อีกครั้ง    → ผ่าน (failed=0, passed=1)
  6) ตรวจไฟล์ EMP002 มีแถว repaired จริง (eventId + logDateTime เดียวกัน, counterparty=EMP001)

รัน: .venv/bin/python tests/test_phase3_small.py
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

TOOLS_DIR = Path(__file__).resolve().parent.parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import excel_io  # noqa: E402
import phase3_validate as p3  # noqa: E402

SRC_DIR = TOOLS_DIR.parents[1] / "src" / "data" / "hr_onedrive_demo"
EVENT_ID = "SVC-09"                      # eventId จำลอง (มีใน catalog: สเปกเกินสัญญา)
LOG_DT = "2024-01-15T10:00:00+07:00"     # logDateTime เดียวกันทั้ง 2 ฝั่ง (สัญญา DESIGN.md)
SUBJECT = "QA scenario: สเปกเกินสัญญา — ทดสอบ cross-validate"


def _make_ctx(tmp: Path) -> SimpleNamespace:
    return SimpleNamespace(
        input_dir=SRC_DIR,
        output_dir=tmp / "out",
        no_api=True,
        client=None,
        console=None,            # rich fallback
        injected_events=[],      # scenario นี้ไม่พึ่ง metadata — ตรวจจากเนื้อหา Excel
    )


def _inject_event_a(tmp: Path) -> None:
    """เขียนแถว event เข้าไฟล์ EMP001 (ฝั่ง A) เท่านั้น — ฝั่ง B ยังไม่มี"""
    dst = tmp / "EMP001_OneDrive_Profile.xlsx"
    excel_io.write_employee(dst, append_rows_per_sheet={
        "Collaboration_Network": [{
            "logDateTime": LOG_DT,
            "logType": "incident",
            "subject": SUBJECT,
            "counterpartyEmployeeCode": "EMP002",
            "eventId": EVENT_ID,
            "location": "site-bangna",
            "source": "OrgGraph",
            "notes": "QA scenario — มีแค่ฝั่ง A",
        }],
    })


def test_detect_repair_revalidate() -> None:
    if not (SRC_DIR / "EMP001_OneDrive_Profile.xlsx").exists():
        raise AssertionError(f"ไม่พบต้นฉบับ: {SRC_DIR}")

    with tempfile.TemporaryDirectory(prefix="upg360_small_") as tmp_s:
        tmp = Path(tmp_s)
        for code in ("EMP001", "EMP002"):
            shutil.copyfile(SRC_DIR / f"{code}_OneDrive_Profile.xlsx", tmp / f"{code}_OneDrive_Profile.xlsx")

        _inject_event_a(tmp)
        ctx = _make_ctx(tmp)

        # ── 1) validate (ยังไม่ repair) → ต้องเจอ mismatch ฝั่ง b ──
        r1 = p3.cross_validate_relationships(
            ctx, excel_dir=tmp, limit_pairs=1, save_report=False)
        assert r1["summary"]["checkedPairs"] == 1, r1["summary"]
        assert r1["summary"]["failed"] == 1, f"ต้องเจอ 1 mismatch แต่ได้ {r1['summary']}"
        f1 = r1["failed"][0]
        assert f1["a"] == "EMP001" and f1["b"] == "EMP002", f1
        assert f1["eventId"] == EVENT_ID and f1["logDateTime"] == LOG_DT, f1
        assert f1["missingSide"] == "b", f1  # ฝั่งที่ขาด = EMP002
        assert f1["sheetA"] == "Collaboration_Network", f1
        print(f"✓ detect: เจอ mismatch {f1['a']}→{f1['b']} {f1['eventId']} missing={f1['missingSide']}")

        # ── 2) validate + repair ──
        r2 = p3.cross_validate_relationships(
            ctx, excel_dir=tmp, limit_pairs=1, repair=True, save_report=False)
        assert r2["summary"]["repaired"] == 1, r2["summary"]
        rep = r2["repaired"][0]
        assert rep["repaired"] is True and rep["side"] == "EMP002", rep
        assert rep["eventId"] == EVENT_ID and rep["logDateTime"] == LOG_DT, rep  # เวลา/eventId เดิม
        print(f"✓ repair: สร้าง mirror ใน {rep['side']} ({rep['method']}) sheet={rep['sheet']}")

        # ── 3) re-validate → ต้องผ่าน (failed=0) ──
        r3 = p3.cross_validate_relationships(
            ctx, excel_dir=tmp, limit_pairs=1, save_report=False)
        assert r3["summary"]["failed"] == 0, r3["summary"]
        assert r3["summary"]["passed"] == 1, r3["summary"]
        print("✓ re-validate: ผ่าน (failed=0, passed=1)")

        # ── 4) ตรวจเนื้อหา Excel ฝั่ง B มีแถว repaired จริง ──
        book = excel_io.read_employee(tmp / "EMP002_OneDrive_Profile.xlsx")
        cn = book["Collaboration_Network"]
        found = False
        for _, row in cn.iterrows():
            if (str(row.get("eventId", "")).strip() == EVENT_ID
                    and str(row.get("logDateTime", "")).strip() == LOG_DT
                    and "EMP001" in str(row.get("counterpartyEmployeeCode", ""))):
                found = True
                break
        assert found, "ไม่พบแถว repaired ในไฟล์ EMP002 (eventId+logDateTime เดียวกัน, cp=EMP001)"
        print("✓ ยืนยันในไฟล์: EMP002 มี mirror (eventId + logDateTime เดียวกัน ระบุ EMP001)")


if __name__ == "__main__":
    test_detect_repair_revalidate()
    print("\nPASS: test_phase3_small (1/1)")
