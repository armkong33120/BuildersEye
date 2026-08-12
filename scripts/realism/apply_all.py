#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""apply_all.py — master runner for the BuildersEye 150-employee realism upgrade.

Pipeline (single-threaded, deterministic order → conflict-free writes):
    1. dept_cluster_a  (Executive, Sales, Marketing, Design & Architecture)
    2. dept_cluster_b  (Engineering & Construction, Procurement & Warehouse, Customer Service)
    3. dept_cluster_c  (Finance & Accounting, HR & Admin, IT)
    4. dept_cluster_d  (Legal, Office Support)
    5. perfection_pass (anti-perfect: C/D bands, imperfect timesheets, human errors)

Writes:
    * server/.data/registry/employees.json   ← THE live database (150 people / 23 sheets)
    * server/.data/registry/schema.json      ← refreshed columns from actual records
    * .data/data_realism_apply_stats.json    ← changelog consumed by the gap report

After apply:  python3 scripts/realism/audit_realism.py --report
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import realism_common as rc
from dept_cluster_a import apply as apply_a
from dept_cluster_b import apply as apply_b
from dept_cluster_c import apply as apply_c
from dept_cluster_d import apply as apply_d
import perfection_pass


def main(argv=None):
    t0 = time.time()
    employees = rc.load_employees()
    before = rc.row_count(employees)

    stages = []
    pipeline = [
        ("cluster_a", apply_a, "Executive + Sales + Marketing + Design & Architecture"),
        ("cluster_b", apply_b, "Engineering & Construction + Procurement & Warehouse + Customer Service"),
        ("cluster_c", apply_c, "Finance & Accounting + HR & Admin + IT"),
        ("cluster_d", apply_d, "Legal + Office Support"),
        ("perfection_pass", perfection_pass.apply, "Anti-perfect: C/D bands + imperfect timesheets (all 150)"),
    ]
    for name, fn, desc in pipeline:
        s = time.time()
        try:
            stats = fn(employees) or {}
            elapsed = round(time.time() - s, 2)
            stages.append({"stage": name, "description": desc, "elapsed_s": elapsed, "stats": stats})
            print(f"✅ {name:14s} ({desc}) done in {elapsed}s")
        except Exception as e:
            print(f"❌ {name} FAILED: {e}", file=sys.stderr)
            raise

    # ── single authoritative write ─────────────────────────────────────────
    rc.save_employees(employees)
    rc.refresh_schema(employees)

    after = rc.row_count(employees)
    per_sheet_after = {s: rc.sheet_count(employees, s) for s in _all_sheets(employees)}
    stats_out = {
        "applied_at": _now(),
        "employees": len(employees),
        "rows_before": before,
        "rows_after": after,
        "rows_added": after - before,
        "sheets": per_sheet_after,
        "stages": stages,
    }
    rc.REPORT_DIR.mkdir(parents=True, exist_ok=True)
    with open(rc.REPORT_DIR / "data_realism_apply_stats.json", "w", encoding="utf-8") as f:
        json.dump(stats_out, f, ensure_ascii=False, indent=1)

    print("━" * 60)
    print(f"✔ Registry saved: {rc.REGISTRY_FILE}")
    print(f"✔ Schema refreshed: {rc.SCHEMA_FILE}")
    print(f"✔ Rows: {before} → {after}  (+{after - before})  across {len(employees)} employees")
    print(f"✔ Changelog: {rc.REPORT_DIR / 'data_realism_apply_stats.json'}")
    print(f"Total elapsed: {time.time() - t0:.2f}s")
    return 0


def _all_sheets(employees):
    out = set()
    for e in employees.values():
        out.update(e.get("sheets", {}).keys())
    return sorted(out)


def _now():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    sys.exit(main())
