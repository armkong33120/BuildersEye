# tools/upgrade_360/cli.py
"""CLI ของ 360-Upgrade pipeline — ใช้ typer + rich.

รันเบื้องต้น:
    .venv/bin/python cli.py run --no-api --limit 2 --phase 2
    .venv/bin/python cli.py run --api-key $DEEPSEEK_API_KEY --phase all
    .venv/bin/python cli.py run --resume --phase 2          # ต่อจาก checkpoint

API key: --api-key ชนะ env DEEPSEEK_API_KEY — ไม่ print ไม่ commit
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer
from rich.console import Console

import config
import main as pipeline
from config import DEFAULT_INPUT_DIR, DEFAULT_OUTPUT_DIR

app = typer.Typer(
    name="upgrade-360",
    help="360-Degree Digital Twin & Time-Series Logs generator",
    no_args_is_help=True,
    add_completion=False,
)
console = Console()


def _phase_callback(value: str) -> str:
    allowed = {"1", "2", "3", "all"}
    parts = [p.strip() for p in value.split(",")]
    if not all(p in allowed for p in parts):
        raise typer.BadParameter("--phase ใช้ได้: 1 | 2 | 3 | all (หรือคั่นด้วย ,)")
    return value


@app.command("run")
def run(
    api_key: Optional[str] = typer.Option(
        None,
        "--api-key",
        envvar="DEEPSEEK_API_KEY",  # fallback: env var — ไม่แสดงค่าใน help/log
        help="DeepSeek API key (fallback: env DEEPSEEK_API_KEY)",
        show_default=False,
    ),
    input_dir: Path = typer.Option(
        DEFAULT_INPUT_DIR,
        "--input-dir",
        help="โฟลเดอร์ Excel ต้นฉบับ (23 sheets ต่อคน)",
        exists=True,
        file_okay=False,
        dir_okay=True,
        resolve_path=True,
    ),
    output_dir: Path = typer.Option(
        DEFAULT_OUTPUT_DIR,
        "--output-dir",
        help="โฟลเดอร์ output (default ใหม่ ไม่ทับต้นฉบับ)",
        file_okay=False,
        dir_okay=True,
        resolve_path=True,
    ),
    resume: bool = typer.Option(
        False,
        "--resume",
        help="ต่อจาก checkpoint.json — ข้ามคนที่ completed แล้ว",
    ),
    limit: Optional[int] = typer.Option(
        None,
        "--limit",
        help="ทดสอบทีละ N คนแรก (Phase 1 เลือก scope คนให้เฟส 2/3)",
        min=1,
    ),
    no_api: bool = typer.Option(
        False,
        "--no-api",
        help="โหมด offline — ไม่ยิง API ใช้ template แทน",
    ),
    workers: int = typer.Option(
        1,
        "--workers",
        help="จำนวน worker สำหรับ Phase 2 (gen รองรับ parallel threads)",
        min=1,
    ),
    phase: str = typer.Option(
        "all",
        "--phase",
        help="รันเฟสไหน: 1 | 2 | 3 | all (คั่น , ได้)",
        callback=_phase_callback,
    ),
    inplace: bool = typer.Option(
        False,
        "--inplace",
        help="เขียนทับไฟล์ต้นฉบับ (default: output ไป --output-dir ใหม่)",
    ),
    repair: bool = typer.Option(
        True,
        "--repair/--no-repair",
        help=(
            "Phase 3: ซ่อมอัตโนมัติ mismatch ที่เจอ (inject mirror log ฝั่งที่ขาด) "
            "— default: on (ตาม spec DESIGN.md)"
        ),
    ),
) -> None:
    """รัน pipeline 3 เฟส (global graph → gen ต่อคน → validate)."""
    # ── ตรวจ API key (เฉพาะเมื่อต้องยิง API) ──
    key = config.get_api_key(api_key)
    if not no_api and not key:
        console.print(
            "[bold yellow]⚠ ไม่มี API key[/bold yellow]\n"
            "  ใส่ --api-key หรือตั้ง env DEEPSEEK_API_KEY\n"
            "  หรือรันด้วย --no-api เพื่อทดสอบ offline (ใช้ template แทน)"
        )
        raise typer.Exit(code=2)

    # ── --inplace ต้องยืนยัน (กันเผลอเขียนทับต้นฉบับ 150 ไฟล์) ──
    if inplace:
        console.print(
            f"[bold red]⚠ --inplace จะเขียนทับไฟล์ต้นฉบับใน: {input_dir}[/bold red]"
        )
        if not typer.confirm("ยืนยันที่จะเขียนทับใช่ไหม?", default=False):
            console.print("[yellow]ยกเลิก — ใช้ --output-dir ใหม่แทน[/yellow]")
            raise typer.Exit(code=1)

    # ── สร้าง context + รัน ──
    ctx = pipeline.build_context(
        input_dir=input_dir,
        output_dir=output_dir if not inplace else input_dir,
        api_key=key,
        no_api=no_api,
        workers=workers,
        limit=limit,
        resume=resume,
        phase=phase,
        inplace=inplace,
        repair=repair,
    )
    pipeline.run_pipeline(ctx)


@app.command("status")
def status(
    output_dir: Path = typer.Option(
        DEFAULT_OUTPUT_DIR,
        "--output-dir",
        help="โฟลเดอร์ output ที่มี checkpoint.json",
        file_okay=False,
        dir_okay=True,
        resolve_path=True,
    ),
) -> None:
    """ดูสถานะ checkpoint (completed / failed) โดยไม่ต้องรัน."""
    import checkpoint as ck

    state = ck.load_progress(output_dir)
    if state is None:
        console.print(f"[yellow]ไม่มี checkpoint ที่ {output_dir}[/yellow]")
        raise typer.Exit(code=1)
    stats = state.get("stats", {})
    console.print(f"[cyan]checkpoint: {ck.checkpoint_path(output_dir)}[/cyan]")
    console.print(f"completed: {len(state.get('completed', []))} / {stats.get('total', '?')}")
    console.print(f"failed   : {stats.get('failed', [])}")
    cur = state.get("current")
    if cur:
        console.print(f"กำลังทำ (ค้าง) : {cur}")


if __name__ == "__main__":
    app()
