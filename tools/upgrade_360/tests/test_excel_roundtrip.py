# -*- coding: utf-8 -*-
"""test_excel_roundtrip.py — อ่าน → เขียน → อ่าน ไม่พัง (23 sheets, header ไม่ซ้ำ)

ตรวจกับไฟล์ต้นฉบับจริง EMP001_OneDrive_Profile.xlsx (src/data/hr_onedrive_demo/):
  1) อ่านด้วย excel_io.read_employee → 23 sheets
  2) เขียน output (โหมด rewrite ทั้ง workbook) ลง temp
  3) อ่านกลับ → ยัง 23 sheets, ชื่อ sheet เหมือนเดิม
  4) ไม่มี header ซ้ำ (คอลัมน์ non-empty ไม่ซ้ำกัน) และไม่มีการทำ header ซ้ำ 2 แถว
  5) append โหมด incremental (logDateTime/eventId) ก็ไม่ทำ header ซ้ำ

รัน: .venv/bin/python tests/test_excel_roundtrip.py
"""
from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent.parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import excel_io  # noqa: E402

SRC = TOOLS_DIR.parents[1] / "src" / "data" / "hr_onedrive_demo" / "EMP001_OneDrive_Profile.xlsx"
EXPECTED_SHEETS = 23


def _non_empty_header_dupes(df) -> int:
    """จำนวนคอลัมน์ header (non-empty) ที่ซ้ำกัน — ต้องเป็น 0 เสมอ."""
    cols = [c for c in df.columns if str(c).strip() and str(c).strip() != "nan"]
    return len(cols) - len(set(cols))


def _assert_no_header_repeat(raw, sheet: str) -> None:
    """เช็ค raw frame: แถว header (row 3) ต้องไม่ถูก repeat เป็นแถวข้อมูล."""
    import pandas as pd

    df = raw[sheet]
    hdr_idx = excel_io._find_header_row_in_frame(df)
    header = [str(v) for v in df.iloc[hdr_idx].tolist() if v is not None]
    # ดูแถวข้อมูล (หลัง header) — ห้ามมีแถวที่เหมือน header ทั้งแถว (ในส่วน non-empty แรก 8 คอลัมน์)
    probe = [v for v in header[:8] if v.strip()]
    if not probe:
        return
    for i in range(hdr_idx + 1, min(len(df), hdr_idx + 30)):
        row_vals = [str(v) for v in df.iloc[i].tolist()[:8] if v is not None]
        if row_vals == probe:
            raise AssertionError(f"[{sheet}] พบแถวข้อมูลที่ repeat header: row {i + 1}")


def test_roundtrip_23_sheets() -> None:
    if not SRC.exists():
        raise AssertionError(f"ไม่พบไฟล์ต้นฉบับ: {SRC}")

    with tempfile.TemporaryDirectory(prefix="upg360_rt_") as tmp:
        tmp = Path(tmp)
        out = tmp / "EMP001_OneDrive_Profile.xlsx"
        shutil.copyfile(SRC, out)

        # ── 1) อ่านต้นฉบับ ──
        book = excel_io.read_employee(SRC)
        assert len(book) == EXPECTED_SHEETS, f"ต้นฉบับต้องมี {EXPECTED_SHEETS} sheets แต่ได้ {len(book)}"
        orig_names = list(book.keys())

        # ── 2) เขียน (rewrite ทั้ง workbook จาก dict of DataFrames) ──
        excel_io.write_employee(out, sheets=book, template_path=SRC)

        # ── 3) อ่านกลับ ──
        book2 = excel_io.read_employee(out)
        assert len(book2) == EXPECTED_SHEETS, f"อ่านกลับได้ {len(book2)} sheets (ต้อง {EXPECTED_SHEETS})"
        assert list(book2.keys()) == orig_names, "ชื่อ/ลำดับ sheets เปลี่ยนหลัง rewrite"

        for name, df in book2.items():
            assert _non_empty_header_dupes(df) == 0, f"[{name}] พบ header ซ้ำ: {df.columns.tolist()}"

        # ── 4) เช็ค raw ว่าไม่มีการ repeat header แถว ──
        raw = excel_io.read_employee_raw(out)
        for name in book2:
            _assert_no_header_repeat(raw, name)

        print(f"✓ roundtrip: 23 sheets, header ไม่ซ้ำ, rewrite ไม่พัง ({out.name})")


def test_append_keeps_headers() -> None:
    """append แถว log (logDateTime/eventId/counterparty) ต้องไม่ทำ header ซ้ำ"""
    with tempfile.TemporaryDirectory(prefix="upg360_ap_") as tmp:
        tmp = Path(tmp)
        out = tmp / "EMP001_OneDrive_Profile.xlsx"
        shutil.copyfile(SRC, out)

        rows = [{
            "logDateTime": "2024-06-01T09:30:00+07:00",
            "logType": "incident",
            "subject": "ทดสอบ append ไม่ทำ header ซ้ำ",
            "counterpartyEmployeeCode": "EMP002",
            "eventId": "SVC-09",
            "location": "HQ",
            "source": "OrgGraph",
            "notes": "row จาก test_excel_roundtrip",
        }]
        excel_io.write_employee(out, append_rows_per_sheet={"Collaboration_Network": rows})

        book = excel_io.read_employee(out)
        assert len(book) == EXPECTED_SHEETS, f"append แล้ว sheets ต้องยัง {EXPECTED_SHEETS}"
        cn = book["Collaboration_Network"]
        assert _non_empty_header_dupes(cn) == 0, f"Collaboration_Network header ซ้ำ: {cn.columns.tolist()}"
        # eventId ต้องถูก append จริง
        ev = cn["eventId"].astype(str)
        assert (ev == "SVC-09").any(), "ไม่พบแถวที่ append (eventId=SVC-09)"

        # raw เช็ค header ไม่ repeat
        raw = excel_io.read_employee_raw(out)
        _assert_no_header_repeat(raw, "Collaboration_Network")

        print("✓ append: 23 sheets คงเดิม, header ไม่ซ้ำ, แถว log ลงจริง")


if __name__ == "__main__":
    test_roundtrip_23_sheets()
    test_append_keeps_headers()
    print("\nPASS: test_excel_roundtrip (2/2)")
