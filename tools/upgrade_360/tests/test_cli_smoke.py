# -*- coding: utf-8 -*-
"""test_cli_smoke.py — smoke test CLI pipeline

1) รันคำสั่งตามสเปก:
     .venv/bin/python cli.py run --phase 2 --limit 2 --no-api --output-dir <tmp>/cli_out
   → เช็ค exit 0 + checkpoint.json เกิดใน output dir (artifact ของ pipeline)

   หมายเหตุ (QA finding): main.py ส่ง RunContext ไปให้ phase2_generator.generate_employee
   ซึ่งคาดหวัง DataGenContext (output_path/config) → ตัว generate ยังไม่ทำงานผ่าน main
   (AttributeError ถูก catch เป็น fail รายคน) — checkpoint ยังถูกเขียนเสมอ
   ดังนั้นเราจึงรันตัว generate จริงผ่าน entrypoint ของ gen (phase2_generator.main)
   แยกในข้อ 2 เพื่อยืนยันว่า Excel output เกิดจริงด้วย

2) รัน phase2_generator.main(["--codes","EMP001,EMP002","--no-api","--out-dir",<tmp>/gen_out])
   → เช็คไฟล์ EMP001/EMP002_OneDrive_Profile.xlsx เกิด + 23 sheets + injected_events.jsonl

รัน: .venv/bin/python tests/test_cli_smoke.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent.parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import excel_io  # noqa: E402


def _run(cmd: list, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=str(cwd), capture_output=True, text=True, timeout=900,
    )


def test_cli_phase2_checkpoint() -> None:
    with tempfile.TemporaryDirectory(prefix="upg360_cli_") as tmp_s:
        tmp = Path(tmp_s)
        cli_out = tmp / "cli_out"
        proc = _run([
            sys.executable, "cli.py", "run",
            "--phase", "2", "--limit", "2", "--no-api",
            "--output-dir", str(cli_out),
        ], TOOLS_DIR)

        # คำสั่งต้องจบปกติ (pipeline ไม่พัง)
        assert proc.returncode == 0, f"cli exit={proc.returncode}\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}"
        # checkpoint ต้องเกิด (artifact ของ pipeline)
        ck = cli_out / "checkpoint.json"
        assert ck.exists(), f"ไม่พบ checkpoint.json ใน {cli_out}\n{proc.stdout[-2000:]}"
        state = json.loads(ck.read_text(encoding="utf-8"))
        assert "stats" in state and "completed" in state
        print(f"✓ CLI: exit 0 + checkpoint.json เกิด ({ck.name}, stats={state.get('stats')})")


def test_generator_produces_excel() -> None:
    """รันตัว generate จริง (entrypoint ของ gen) → ไฟล์ Excel เกิดจริง 23 sheets"""
    import phase2_generator as p2

    with tempfile.TemporaryDirectory(prefix="upg360_gen_") as tmp_s:
        tmp = Path(tmp_s)
        gen_out = tmp / "gen_out"
        results = p2.main(["--codes", "EMP001,EMP002", "--no-api",
                           "--out-dir", str(gen_out)])
        assert len(results) == 2, results

        for code in ("EMP001", "EMP002"):
            f = gen_out / f"{code}_OneDrive_Profile.xlsx"
            assert f.exists(), f"ไม่พบไฟล์ output: {f}"
            sheets = excel_io.sheet_names_of(f)
            assert len(sheets) == 23, f"{code}: ต้อง 23 sheets แต่ได้ {len(sheets)}"
            print(f"✓ generator: {f.name} เกิด (23 sheets)")

        # checkpoint ของ gen (injected_events.jsonl) อยู่ที่ parent ของ out-dir
        inj = tmp / "injected_events.jsonl"
        assert inj.exists(), "ไม่พบ injected_events.jsonl (checkpoint ของ gen)"
        n = sum(1 for _ in inj.open(encoding="utf-8"))
        assert n > 0, "injected_events.jsonl ว่างเปล่า"
        print(f"✓ generator: injected_events.jsonl เกิด ({n} records)")


if __name__ == "__main__":
    test_cli_phase2_checkpoint()
    test_generator_produces_excel()
    print("\nPASS: test_cli_smoke (2/2)")
