# -*- coding: utf-8 -*-
"""run_all.py — รัน tests ทั้งหมดของ Phase 3 ด้วย .venv/bin/python (ไม่พึ่ง pytest)

    .venv/bin/python tests/run_all.py

รวม:
  - test_excel_roundtrip.py   (อ่าน-เขียน-อ่าน 23 sheets / header ไม่ซ้ำ)
  - test_phase3_small.py      (detect mismatch → repair → revalidate ผ่าน)
  - test_cli_smoke.py         (CLI phase 2 + generator จริงสร้างไฟล์)
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
PY = sys.executable

TESTS = [
    "test_excel_roundtrip.py",
    "test_phase3_small.py",
    "test_cli_smoke.py",
]


def main() -> int:
    print("=" * 70)
    print("Phase 3 — QA test suite (run_all)")
    print(f"python: {PY}")
    print("=" * 70)
    all_ok = True
    for name in TESTS:
        print(f"\n--- {name} ---")
        proc = subprocess.run(
            [PY, str(TESTS_DIR / name)],
            cwd=str(TESTS_DIR.parent),  # tools/upgrade_360 — import module แบน
            capture_output=True,
            text=True,
            timeout=1200,
        )
        tail = (proc.stdout or "") + (proc.stderr or "")
        ok = proc.returncode == 0 and "PASS" in (proc.stdout or "")
        status = "PASS" if ok else "FAIL"
        all_ok = all_ok and ok
        print(f"[{status}] exit={proc.returncode}")
        if not ok:
            print(tail[-3000:])
    print("\n" + "=" * 70)
    print(f"RESULT: {'ALL TESTS PASSED' if all_ok else 'SOME TESTS FAILED'}")
    print("=" * 70)
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
