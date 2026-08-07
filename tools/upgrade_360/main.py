# tools/upgrade_360/main.py
"""Orchestration 3 เฟสของ 360-Upgrade pipeline (เจ้าของ: core-dev / integration).

    Phase 1: Global Graph  — relationship_graph (ของ Lead Data Engineer)
    Phase 2: Row Generation ต่อคน — phase2_generator.generate_employee(emp, gen_ctx)
    Phase 3: Cross-person Validation — phase3_validate.cross_validate_relationships(ctx, excel_dir=...)

สัญญาระหว่างโมดูล (integration contract — สำคัญ):
- ``phase2_generator.generate_employee(emp, ctx)`` คาดหวัง **DataGenContext**
  (มี ``config['src_dir']`` / ``config['output_dir']``, ``output_path()``, ``read_employee()``,
  ``write_employee()``, ``absorb_pending_pairs()``, ``append_injected()``, ``save_checkpoint()``)
  → main.py สร้าง bridge: ``DataGenContext(config)`` จาก ``RunContext`` แล้วส่งต่อ
  (QA finding เดิม: ส่ง RunContext ตรงๆ → generate_employee fail ทุกราย ถูก catch เป็น fail)
- ``phase3_validate.cross_validate_relationships(ctx, *, excel_dir, ...)`` รับ RunContext
  + ``excel_dir`` ชี้ไปที่โฟลเดอร์ Excel ที่ gen เขียนจริง (``<output_dir>/hr_onedrive_upgraded``)
- ``injected_events.jsonl`` อยู่ที่ ``<output_dir>/injected_events.jsonl`` (parent ของ gen output)
  → Phase 3 อ่าน metadata นั้นมาตรวจ mirror ข้ามไฟล์

โครงสร้าง output (ไม่ทับต้นฉบับ):
    <output_dir>/checkpoint.json                 ← state ของ main (resume)
    <output_dir>/injected_events.jsonl           ← metadata ที่ gen inject (Phase 3 ใช้)
    <output_dir>/checkpoint_events.json          ← checkpoint ของ gen (idempotent)
    <output_dir>/progress.jsonl                  ← สรุปต่อคน
    <output_dir>/validation_report.json          ← report Phase 3
    <output_dir>/hr_onedrive_upgraded/EMP###_OneDrive_Profile.xlsx   ← Excel อัปเกรด

สำคัญ:
- import โมดูลเพื่อนร่วมทีมแบบ lenient (try/except ImportError + ข้อความชี้ชัด)
  → pipeline รันได้แม้โมดูลยังไม่เสร็จ แต่จะบอกให้ชัดว่าติดตรงไหน
- import main.py ได้เลยโดยไม่มี side effect (ทุกอย่างอยู่ในฟังก์ชัน)
- API key: ไม่ print ไม่ commit — ผ่าน ctx.client (OpenAI SDK ชี้ DeepSeek)
"""
from __future__ import annotations

import importlib
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd
from rich.console import Console
from rich.panel import Panel

import checkpoint
import config
import excel_io
from config import (
    DEFAULT_INPUT_DIR,
    DEFAULT_OUTPUT_DIR,
    DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL,
    IDENTITY_GRAPH_PATH,
    RELATIONSHIP_MATRIX_PATH,
    STORYLINE_CATALOG_PATH,
)

console = Console()

PHASES = ("1", "2", "3", "all")

# โฟลเดอร์ย่อยใต้ output_dir ที่ Phase 2 เขียน Excel อัปเกรด
# (ต้องเป็น subfolder — checkpoint ของ gen เก็บที่ parent = <output_dir>/ จึงอยู่ร่วม
#  กับ checkpoint.json / injected_events.jsonl ที่ Phase 3 อ่าน)
GEN_SUBDIR = "hr_onedrive_upgraded"


# ── Context กลาง — เพื่อนร่วมทีม phase 2/3 ใช้ตัวนี้ต่อ ──────────────────
@dataclass
class RunContext:
    """ทุกอย่างที่ phase ต้องรู้ — สร้างใน cli.run() แล้วส่งต่อให้ phase 1/2/3."""

    employees: List[Dict[str, Any]] = field(default_factory=list)
    emp_by_code: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    input_dir: Path = DEFAULT_INPUT_DIR
    output_dir: Path = DEFAULT_OUTPUT_DIR
    state: Dict[str, Any] = field(default_factory=dict)
    console: Console = console
    # API
    no_api: bool = False
    api_key: str = ""
    client: Any = None  # OpenAI client (ชี้ DeepSeek) — สร้างเมื่อไม่ใช่ no_api
    base_url: str = DEEPSEEK_BASE_URL
    model: str = DEEPSEEK_MODEL
    # run options
    workers: int = 1
    limit: Optional[int] = None
    resume: bool = False
    phase: str = "all"
    inplace: bool = False
    repair: bool = True  # Phase 3: ซ่อมอัตโนมัติ mismatch (--repair/--no-repair)
    # อ่านจาก design (phase 1 เติมให้)
    design: Dict[str, Any] = field(default_factory=dict)

    # ── helpers ที่ phase 2/3 ใช้บ่อย ──
    def employee_file(self, emp_code: str) -> Path:
        """ไฟล์ต้นฉบับ (อ่านอย่างเดียว)."""
        return self.input_dir / f"{emp_code}_OneDrive_Profile.xlsx"

    def output_file(self, emp_code: str) -> Path:
        """ไฟล์อัปเกรดของคนนี้ — อยู่ใต้ <output_dir>/hr_onedrive_upgraded/ (ไม่ทับต้นฉบับ)."""
        return self.gen_output_dir() / f"{emp_code}_OneDrive_Profile.xlsx"

    def gen_output_dir(self) -> Path:
        """โฟลเดอร์ที่ Phase 2 (phase2_generator) เขียน Excel — subfolder ใต้ output_dir."""
        return self.output_dir / GEN_SUBDIR

    def checkpoint_path(self) -> Path:
        return checkpoint.checkpoint_path(self.output_dir)

    def read_employee(self, emp_code: str) -> Dict[str, pd.DataFrame]:
        return excel_io.read_employee(self.employee_file(emp_code))


# ── โหลดพนักงานจาก identity-graph.json ──────────────────────────────────
def load_employees(path: Path = IDENTITY_GRAPH_PATH) -> List[Dict[str, Any]]:
    """อ่าน identities 150 คน เรียงตาม code EMP001..EMP150."""
    if not path.exists():
        raise FileNotFoundError(
            f"ไม่พบ identity-graph.json: {path}\n"
            "โปรดตรวจว่าโฟลเดอร์ src/data/ ครบถ้วน"
        )
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    identities = data.get("identities", [])
    return sorted(identities, key=lambda e: e.get("code", ""))


# ── DeepSeek client (OpenAI SDK — ไม่ print key) ─────────────────────────
def build_client(api_key: str, base_url: str = DEEPSEEK_BASE_URL, model: str = DEEPSEEK_MODEL):
    """สร้าง OpenAI client ชี้ DeepSeek — คืน None ถ้าไม่มี key (no_api)."""
    if not api_key:
        return None
    try:
        from openai import OpenAI

        return OpenAI(api_key=api_key, base_url=base_url)
    except Exception as exc:  # pragma: no cover
        console.print(f"[yellow]⚠ สร้าง API client ไม่ได้: {exc}[/yellow]")
        return None


# ── Lenient import โมดูลเพื่อนร่วมทีม ────────────────────────────────────
_MODULE_CACHE: Dict[str, Any] = {}


def _try_import(name: str, search_dirs: List[Path]) -> Any:
    """import โมดูลแบบ lenient — ลองจาก sys.path, design dir, upgrade_360 dir."""
    if name in _MODULE_CACHE:
        return _MODULE_CACHE[name]

    # 1) import ปกติ (ถ้าอยู่ใน sys.path แล้ว)
    try:
        mod = importlib.import_module(name)
        _MODULE_CACHE[name] = mod
        return mod
    except ImportError:
        pass

    # 2) ลองจากโฟลเดอร์ที่คาดว่าไฟล์เพื่อนร่วมทีมจะอยู่
    for d in search_dirs:
        d = Path(d)
        if not d.exists():
            continue
        sys.path.insert(0, str(d))
        try:
            mod = importlib.import_module(name)
            _MODULE_CACHE[name] = mod
            return mod
        except ImportError:
            sys.path.remove(str(d))
            continue
    _MODULE_CACHE[name] = None
    return None


def load_phase_module(phase_name: str, search_dirs: Optional[List[Path]] = None) -> Any:
    """โหลดโมดูลของเฟส — คืน None พร้อม log สุภาพ ถ้ายังไม่มี.

    search_dirs: ใช้ default = [design dir, upgrade_360 dir] (module เพื่อนร่วมทีม)
    """
    module_map = {
        "1": "relationship_graph",
        "2": "phase2_generator",
        "3": "phase3_validate",
    }
    mod_name = module_map.get(phase_name)
    if not mod_name:
        return None
    dirs = search_dirs if search_dirs is not None else [config.DESIGN_DIR, config.UPGRADE_360_DIR]
    mod = _try_import(mod_name, dirs)
    if mod is None:
        console.print(
            f"[yellow]ℹ Phase {phase_name}: import '{mod_name}' ไม่ได้ (ยังไม่มีไฟล์) — "
            f"ใช้ fallback ที่มี[/yellow]\n"
            f"   ค้นหา: {[str(d) for d in dirs]}"
        )
    return mod



# ── Phase 1: Global Graph ────────────────────────────────────────────────
def phase1(ctx: RunContext) -> Dict[str, Any]:
    """โหลด global graph (relationship matrix + storyline catalog) + เลือก scope คนตาม --limit.

    - ถ้า relationship_graph module มาแล้ว → เรียก build_global_graph(ctx)
    - ถ้ายังไม่มี module (architect ส่งเป็น design JSON) → อ่าน design JSON ตรงๆ
    - ถ้าไม่มีทั้งคู่ → error สุภาพ ชี้ทางแก้
    """
    console.print(Panel("[bold]Phase 1 — Global Graph[/bold]", border_style="cyan"))

    design: Dict[str, Any] = {"relationship_matrix": None, "storyline_catalog": None}

    # 1) ลองเรียก module เพื่อนร่วมทีม (ถ้ามี)
    mod = load_phase_module("1")
    if mod is not None:
        build = getattr(mod, "build_global_graph", None) or getattr(mod, "build", None)
        try:
            if build is not None:
                result = build(ctx)
                if isinstance(result, dict):
                    design.update(result)
                    console.print("[cyan]relationship_graph.build_global_graph() สำเร็จ[/cyan]")
        except Exception as exc:
            console.print(f"[yellow]⚠ relationship_graph ยังรันไม่สำเร็จ ({exc}) — fallback อ่าน design JSON[/yellow]")

    # 2) fallback: อ่าน design JSON ของ architect (ไฟล์ส่งมอบจริง)
    for key, p in (
        ("relationship_matrix", RELATIONSHIP_MATRIX_PATH),
        ("storyline_catalog", STORYLINE_CATALOG_PATH),
    ):
        if design.get(key) is None and p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    design[key] = json.load(f)
                console.print(f"[cyan]โหลด {p.name} แล้ว[/cyan]")
            except json.JSONDecodeError as exc:
                console.print(f"[red]✗ {p.name} parse ไม่ได้: {exc}[/red]")

    ctx.design = design

    # 3) error สุภาพ ถ้าไม่มี design เลย
    if design["relationship_matrix"] is None or design["storyline_catalog"] is None:
        raise RuntimeError(
            "Phase 1 ติดขัด: ยังไม่มี global graph design\n"
            f"  ค้นหาแล้วไม่พบ: {RELATIONSHIP_MATRIX_PATH.name} / {STORYLINE_CATALOG_PATH.name}\n"
            "  → รอเพื่อนร่วมทีม (Lead Data Engineer) สร้างไฟล์ใน tools/upgrade_360/design/ ก่อน"
        )

    matrix = design["relationship_matrix"]
    pairs = matrix.get("pairs", []) if isinstance(matrix, dict) else []
    console.print(
        f"[cyan]Global graph พร้อม: pairs={len(pairs)} | "
        f"events={len(design['storyline_catalog'].get('catalog', []))}[/cyan]"
    )

    # 4) scope คน (--limit เลือกที่ build_context แล้ว) — แสดงให้ชัดว่าเฟส 2/3 จะทำใคร
    console.print(
        f"[cyan]scope พนักงาน: {len(ctx.employees)} คน "
        f"({', '.join(e['code'] for e in ctx.employees[:10])}"
        f"{'...' if len(ctx.employees) > 10 else ''})[/cyan]"
    )
    return design


# ── Phase 2: Row generation ต่อคน ────────────────────────────────────────
def _fallback_phase2(emp: Dict[str, Any], ctx: RunContext) -> int:
    """Fallback เมื่อยังไม่มี phase2_generator (หรือ import ไม่ได้): สร้างแถว sample.

    เขียนลง <output_dir>/hr_onedrive_upgraded/ เช่นเดียวกับ gen จริง
    เพื่อให้ Phase 3 ตรวจเจอไฟล์ในที่เดียวกัน
    """
    from faker import Faker

    fake = Faker("th_TH")
    code = emp["code"]
    out_path = ctx.output_file(code)
    src_path = ctx.employee_file(code)

    now = datetime.now().isoformat(timespec="minutes")
    rows = {
        "Collaboration_Network": [
            {
                "logDateTime": now,
                "logType": "routine",
                "subject": f"ประชุมประจำเดือน ({fake.company()})",
                "counterpartyEmployeeCode": "",
                "eventId": "",
                "location": "HQ",
                "source": "HRIS",
                "notes": "Template row (no-api / fallback)",
            }
            for _ in range(3)
        ],
        "Expense_Reports": [
            {"logDateTime": now, "logType": "routine", "subject": "ค่าเดินทาง", "eventId": "",
             "Travel_THB": fake.random_int(500, 5000)}
            for _ in range(2)
        ],
        "IT_Ticket_Log": [
            {"logDateTime": now, "logType": "routine", "subject": "แจ้งซ่อมเครื่อง", "eventId": "",
             "Ticket_Issue": "Printer", "Status": "Open"}
        ],
    }
    excel_io.write_employee(
        out_path,
        append_rows_per_sheet=rows,
        template_path=src_path,
    )
    return sum(len(v) for v in rows.values())


def _build_gen_context(ctx: RunContext):
    """Bridge: สร้าง DataGenContext (phase2_generator) จาก RunContext.

    phase2_generator.generate_employee(emp, ctx) คาดหวัง DataGenContext
    (config['src_dir']/['output_dir'] + registries) — main.py ต้องส่ง context
    ที่ถูกสัญญา ไม่ใช่ RunContext (QA finding เดิม: AttributeError ทุกราย)
    """
    mod = load_phase_module("2")
    cls = getattr(mod, "DataGenContext", None) if mod is not None else None
    if cls is None:
        return None
    return cls({
        "no_api": ctx.no_api,
        "api_key": ctx.api_key,
        "workers": ctx.workers,
        "seed": 20260807,
        "as_of": "2026-08-07",
        "target_rows": 420,
        "min_rows": 300,
        "max_rows": 500,
        "drama_ratio": 0.20,
        "routine_pair_ratio": 0.20,
        "src_dir": str(ctx.input_dir),
        "output_dir": str(ctx.gen_output_dir()),
        "force": False,
    })



def phase2(ctx: RunContext) -> int:
    """Loop สร้าง rows ต่อคน ตาม checkpoint (ข้ามคนที่ completed แล้ว).

    เรียก phase2_generator.generate_employee(emp, gen_ctx) — gen_ctx เป็น
    DataGenContext (bridge จาก RunContext) เพื่อให้สัญญา ctx ตรงกับที่เพื่อนร่วมทีมคาดหวัง
    """
    console.print(Panel("[bold]Phase 2 — Row Generation ต่อคน[/bold]", border_style="cyan"))

    mod = load_phase_module("2")
    generator = getattr(mod, "generate_employee", None) if mod is not None else None
    gen_ctx = _build_gen_context(ctx)
    if generator is None:
        console.print(
            "[yellow]⚠ ยังไม่มี phase2_generator.generate_employee() — ใช้ fallback template "
            "(ตัวอย่าง) แทน เพื่อให้ test pipeline ผ่าน[/yellow]"
        )

    # รายชื่อคนที่จะทำ: ข้าม completed ถ้า --resume / มี checkpoint
    all_codes = [e["code"] for e in ctx.employees]
    todo = checkpoint.remaining_codes(ctx.state, all_codes)
    if ctx.limit:
        todo = todo[: ctx.limit]

    # log คนที่ข้ามเพราะ completed แล้ว (resume)
    done_set = checkpoint.completed_set(ctx.state)
    skipped_done = [c for c in all_codes if c in done_set]
    if skipped_done:
        console.print(
            f"[yellow]resume: skipped {len(skipped_done)} คนที่ completed แล้ว "
            f"({', '.join(skipped_done)})[/yellow]"
        )

    total = len(todo)
    if total == 0:
        console.print(
            "[green]✓ ไม่มีคนค้าง — ทุกคน completed แล้ว "
            "(ใช้ --output-dir ใหม่เพื่อเริ่มใหม่)[/green]"
        )
        return 0

    console.print(f"[cyan]ต้องทำ {total} คน (จาก {len(all_codes)}): {todo[:5]}{'...' if total > 5 else ''}[/cyan]")

    from rich.progress import BarColumn, Progress, TaskProgressColumn, TextColumn, TimeElapsedColumn

    done = 0
    failed = []
    with Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console=ctx.console,
    ) as progress:
        task = progress.add_task("[cyan]Generating...", total=total)

        for code in todo:
            emp = ctx.emp_by_code[code]
            progress.update(task, description=f"[cyan]{code} {emp.get('name','')}[/cyan]")
            try:
                checkpoint.start_current(ctx.state, code, 2, ctx.output_dir)
                if generator is not None and gen_ctx is not None:
                    res = generator(emp, gen_ctx)
                    n = res.get("rowsAdded", 0) if isinstance(res, dict) else 0
                    if isinstance(res, dict) and res.get("skipped"):
                        console.print(
                            f"[yellow]  {code}: output มีอยู่แล้ว (generator ข้าม) — นับเป็น completed[/yellow]"
                        )
                else:
                    n = _fallback_phase2(emp, ctx)
                # เขียน Excel ทันทีเมื่อคนนั้นเสร็จ + บันทึก checkpoint
                checkpoint.mark_completed(ctx.state, code, ctx.output_dir, total=len(all_codes))
                progress.advance(task)
                done += 1
                progress.update(task, description=f"[green]✓ {code} (+{n} rows)[/green]")
            except Exception as exc:  # คนนี้ fail — บันทึกไว้ไม่ให้ pipeline ตาย
                failed.append(code)
                checkpoint.mark_failed(ctx.state, code, ctx.output_dir, reason=str(exc))
                ctx.console.print(f"[red]✗ {code} fail: {exc}[/red]")
                progress.advance(task)

    ctx.console.print(f"[bold green]Phase 2 เสร็จ: สำเร็จ {done} / {total} | fail {len(failed)}[/bold green]")
    if failed:
        ctx.console.print(f"[yellow]  fail: {failed}[/yellow]")
    return done


# ── Phase 3: Cross-person validation ─────────────────────────────────────
def phase3(ctx: RunContext) -> Dict[str, Any]:
    """ตรวจความสอดคล้องข้ามคน (eventId/counterparty ทั้ง 2 ฝั่ง ฯลฯ).

    เรียก phase3_validate.cross_validate_relationships(ctx, excel_dir=...)
    — excel_dir ชี้ไปที่ <output_dir>/hr_onedrive_upgraded (ไฟล์ที่ Phase 2 เขียน)
      เพื่อไม่ให้ไป validate ไฟล์ต้นฉบับใน input_dir
    """
    console.print(Panel("[bold]Phase 3 — Cross-person Validation[/bold]", border_style="cyan"))

    mod = load_phase_module("3")
    if mod is None:
        console.print(
            "[yellow]⚠ Phase 3 ข้าม: ยังไม่มี phase3_validate.cross_validate_relationships()[/yellow]\n"
            "   เมื่อพร้อม ให้สร้าง tools/upgrade_360/phase3_validate.py แล้ว rerun --phase 3"
        )
        return {"status": "skipped", "reason": "phase3_validate ยังไม่พร้อม"}

    fn = getattr(mod, "cross_validate_relationships", None)
    if fn is None:
        console.print("[yellow]⚠ phase3_validate มีแต่ไม่มี cross_validate_relationships()[/yellow]")
        return {"status": "skipped", "reason": "missing function"}

    excel_dir = str(ctx.gen_output_dir())
    repair_on = bool(getattr(ctx, "repair", True))
    try:
        import inspect

        sig = inspect.signature(fn)
        kwargs: Dict[str, Any] = {}
        if "excel_dir" in sig.parameters:
            kwargs["excel_dir"] = excel_dir
        if "repair" in sig.parameters:
            kwargs["repair"] = repair_on
        result = fn(ctx, **kwargs)
        ctx.console.print("[green]✓ cross_validate_relationships() สำเร็จ[/green]")
    except TypeError:
        # signature เก่า (ไม่มี excel_dir/repair) — ลองเรียกแบบ ctx อย่างเดียว
        try:
            result = fn(ctx)
            ctx.console.print("[green]✓ cross_validate_relationships(ctx) สำเร็จ (signature เก่า)[/green]")
        except Exception as exc:
            ctx.console.print(f"[yellow]⚠ Phase 3 รันไม่สำเร็จ: {exc}[/yellow]")
            return {"status": "error", "reason": str(exc)}
    except Exception as exc:
        ctx.console.print(f"[yellow]⚠ Phase 3 รันไม่สำเร็จ: {exc}[/yellow]")
        return {"status": "error", "reason": str(exc)}

    # ── repair-adjusted summary (spec DESIGN.md): mismatch ที่ซ่อมแล้วไม่นับ fail ──
    result, adjusted = _apply_repair_to_summary(result, repair_on)
    if adjusted:
        _rewrite_validation_report(ctx, result)
    return {"status": "ok", "result": result}


def _apply_repair_to_summary(result: Any, repair_on: bool) -> tuple[Any, bool]:
    """ปรับ summary ของ Phase 3: repaired mismatch ไม่นับเป็น fail (spec).

    phase3_validate คำนวณ passRate จาก failed ก่อน repair — orchestrator
    (main.py) ปรับให้ตรง spec หลัง repair เสร็จ: นำ (eventId, logDateTime,
    missingSide) ที่ซ่อมสำเร็จออกจาก failed แล้วคำนวณ passed/passRate ใหม่

    Returns: (report, changed) — changed=True ถ้ามีการปรับ summary
    """
    if not repair_on or not isinstance(result, dict):
        return result, False
    summary = result.get("summary")
    repaired = result.get("repaired") or []
    failed = result.get("failed") or []
    if not isinstance(summary, dict) or not repaired:
        return result, False
    repaired_ok = [r for r in repaired if r.get("repaired")]
    if not repaired_ok:
        return result, False
    repaired_keys = {
        (r.get("eventId"), r.get("logDateTime"), r.get("missingSide"))
        for r in repaired_ok
    }
    remaining = [
        f for f in failed
        if (f.get("eventId"), f.get("logDateTime"), f.get("missingSide")) not in repaired_keys
    ]
    if len(remaining) >= len(failed):
        return result, False  # repair ไม่ได้ช่วยอะไร — คง summary เดิม

    new_summary = dict(summary)
    new_summary["failed"] = len(remaining)
    new_summary["failedPairs"] = len({(f.get("a"), f.get("b")) for f in remaining})
    checked = int(new_summary.get("checkedPairs", 0))
    new_summary["passed"] = max(checked - new_summary["failedPairs"], 0)
    new_summary["passRate"] = round(100 * new_summary["passed"] / max(checked, 1), 2)

    result = dict(result)
    result["summary"] = new_summary
    result["failed"] = remaining
    result["examples"] = remaining[:10]
    result["summaryAdjustedByRepair"] = True
    return result, True


def _rewrite_validation_report(ctx: RunContext, report: Dict[str, Any]) -> None:
    """เขียน validation_report.json ใหม่ด้วย summary ที่ปรับตาม repair (best-effort)."""
    rp = Path(ctx.output_dir) / "validation_report.json"
    try:
        rp.parent.mkdir(parents=True, exist_ok=True)
        with open(rp, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        s = report.get("summary", {})
        ctx.console.print(
            Panel(
                f"[bold green]Repair-adjusted summary[/bold green]\n"
                f"passed={s.get('passed')} | failed={s.get('failed')} "
                f"| repaired={s.get('repaired')} | "
                f"passRate=[bold]{s.get('passRate')}%[/bold] "
                f"(mismatch ที่ซ่อมแล้วไม่นับ fail)",
                border_style="green",
            )
        )
        ctx.console.print(f"[green]✓ validation_report.json อัปเดต (repair-adjusted): {rp}[/green]")
    except OSError as exc:
        ctx.console.print(f"[yellow]⚠ เขียน report ใหม่ไม่ได้: {exc}[/yellow]")




# ── Orchestrator ─────────────────────────────────────────────────────────
def run_pipeline(ctx: RunContext, phases: Optional[Iterable[str]] = None) -> Dict[str, Any]:
    """รันเฟสตามลำดับ (1→2→3) — คุม checkpoint + สรุปผล.

    Args:
        ctx: RunContext ที่ cli สร้างให้
        phases: ลำดับเฟสที่จะรัน (default ตาม ctx.phase / "all")
    """
    from rich.table import Table

    if phases is None:
        phases = ("1", "2", "3") if ctx.phase == "all" else tuple(p.strip() for p in ctx.phase.split(","))

    output_dir = excel_io.ensure_output_dir(ctx.output_dir)
    ctx.console.print(
        Panel(
            f"[bold]360-Upgrade Pipeline[/bold]\n"
            f"input : {ctx.input_dir}\n"
            f"output: {output_dir}\n"
            f"workers: {ctx.workers} | no_api: {ctx.no_api} | resume: {ctx.resume} | "
            f"limit: {ctx.limit} | repair: {ctx.repair}",
            border_style="blue",
        )
    )

    results: Dict[str, Any] = {}
    for ph in phases:
        ph = ph.strip()
        if ph == "1":
            results["phase1"] = phase1(ctx)
        elif ph == "2":
            results["phase2"] = phase2(ctx)
        elif ph == "3":
            results["phase3"] = phase3(ctx)
        else:
            ctx.console.print(f"[red]ไม่รู้จักเฟส: {ph} (ใช้ 1|2|3|all)[/red]")

    # สรุป
    stats = ctx.state.get("stats", {})
    table = Table(title="Pipeline Summary", border_style="green")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="white")
    table.add_row("completed", str(stats.get("done", 0)))
    table.add_row("total", str(stats.get("total", len(ctx.employees))))
    table.add_row("failed", str(len(stats.get("failed", []))))
    ctx.console.print(table)
    return results


def build_context(
    *,
    input_dir: Path = DEFAULT_INPUT_DIR,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    api_key: str = "",
    no_api: bool = False,
    workers: int = 1,
    limit: Optional[int] = None,
    resume: bool = False,
    phase: str = "all",
    inplace: bool = False,
    repair: bool = True,
) -> RunContext:
    """สร้าง RunContext จาก args ของ CLI — เพื่อนร่วมทีมเรียกใช้เพื่อ debug ได้."""
    employees = load_employees()
    emp_by_code = {e["code"]: e for e in employees}

    # --limit: เลือก scope คนแรก N คน ตั้งแต่ build_context (ไม่ใช่เฉพาะ Phase 1)
    # → ทุกเฟส (1/2/3 หรือรันเฟสเดียว) เห็นชุดคนเดียวกัน + resume ข้ามใน scope เดิม
    if limit and len(employees) > limit:
        employees = employees[:limit]
        emp_by_code = {e["code"]: e for e in employees}
        console.print(
            f"[cyan]--limit {limit}: scope = {len(employees)} คนแรก "
            f"({', '.join(e['code'] for e in employees)})[/cyan]"
        )

    if inplace:
        output_dir = input_dir  # --inplace: เขียนทับต้นฉบับ (มี confirm ใน cli)

    state = checkpoint.resume_from(output_dir) if resume else checkpoint.empty_state(len(employees))
    if resume:
        done = checkpoint.completed_set(state)
        console.print(
            f"[cyan]Resume: ข้าม {len(done)} คนที่ completed แล้ว "
            f"({sorted(done)[:5]}{'...' if len(done) > 5 else ''})[/cyan]"
        )

    client = None if no_api else build_client(api_key)

    return RunContext(
        employees=employees,
        emp_by_code=emp_by_code,
        input_dir=Path(input_dir),
        output_dir=Path(output_dir),
        state=state,
        console=console,
        no_api=no_api,
        api_key=api_key,
        client=client,
        workers=workers,
        limit=limit,
        resume=resume,
        phase=phase,
        inplace=inplace,
        repair=repair,
    )


if __name__ == "__main__":
    # ใช้สำหรับ debug โดยตรง: python main.py --phase 2 --no-api --limit 2
    import argparse

    ap = argparse.ArgumentParser(description="360-Upgrade pipeline (debug entry)")
    ap.add_argument("--phase", default="all", help="1|2|3|all")
    ap.add_argument("--no-api", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--input-dir", default=str(DEFAULT_INPUT_DIR))
    ap.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    ap.add_argument("--repair", dest="repair", action="store_true", default=True,
                    help="Phase 3: ซ่อมอัตโนมัติ mismatch (default: on)")
    ap.add_argument("--no-repair", dest="repair", action="store_false",
                    help="ปิด repair ของ Phase 3")
    args = ap.parse_args()

    ctx = build_context(
        input_dir=Path(args.input_dir),
        output_dir=Path(args.output_dir),
        no_api=args.no_api,
        limit=args.limit,
        resume=args.resume,
        phase=args.phase,
        repair=args.repair,
    )
    run_pipeline(ctx)

