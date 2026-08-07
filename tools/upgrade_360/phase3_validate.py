# -*- coding: utf-8 -*-
"""phase3_validate.py — Phase 3 Cross-Validation Engine (QA / Validation)

หัวใจของงาน: **150×150 Cross-Validation**
  ถ้า EMP_A มี log event (eventId, logDateTime) อ้างถึง EMP_B ในไฟล์ของ A
  แล้วไฟล์ของ EMP_B ต้องมี log เดียวกัน (eventId + logDateTime เดียวกัน) ระบุ EMP_A ด้วย

Driver (sparse — ใช้ matrix เป็นตัวกำหนด ไม่ใช่ 150×150 เต็ม):
  - design/relationship_matrix.json  — 2,194 คู่ (19.6% ของ 11,175 คู่ที่เป็นไปได้)
  - ctx.injected_events (metadata จาก phase2_generator; fallback อ่าน injected_events.jsonl)

ตรวจจาก 2 แหล่ง แล้ว merge เป็นชุด claims เดียวกัน:
  1) injected_events metadata  — record ที่ gen บันทึกตอน inject แถว
  2) เนื้อหา Excel จริง         — scan ทุก sheet ทุกไฟล์ (eventId + counterpartyEmployeeCode)

ฟังก์ชันหลัก:
  cross_validate_relationships(ctx, *, repair=False, ...) -> report dict
  repair_inconsistency(ctx, a, b, event, missing_side, *, excel_dir=None) -> record

สัญญากับ main.py (core-dev): phase3 เรียก cross_validate_relationships(ctx) —
  รับ RunContext (หรือ object ใดๆ ที่มี input_dir/output_dir/no_api/console) ได้เลย

รายงาน: {status, scope, source, summary, failed[], repaired[], coverage, examples}
  - failed:   [{a, b, eventId, logDateTime, sheetA, sheetB, missingSide, reason, source}]
  - repaired: [{a, b, eventId, logDateTime, sheet, side, method, repairedAt}]

เจ้าของไฟล์: QA / Validation (Phase 3)
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, Union

import pandas as pd
from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    Progress,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table

# ── import lenient (รันแบบ package หรือ script ตรง) ──────────────────────
try:  # รันแบบ package (python -m ...)
    from . import config as cfg_mod
    from . import excel_io
except ImportError:  # รันแบบ script ตรงจาก tools/upgrade_360
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import config as cfg_mod
    import excel_io


# ═══════════════════════════════════════════════════════════════════════════
# Helpers ขนาดเล็ก
# ═══════════════════════════════════════════════════════════════════════════

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _norm_dt(v: Any) -> str:
    """normalize ค่าเวลา → ISO string (กัน datetime object จาก Excel)."""
    if v is None:
        return ""
    if isinstance(v, pd.Timestamp):
        return v.isoformat()
    if isinstance(v, datetime):
        return v.isoformat(timespec="seconds")
    return str(v).strip()


def _norm_str(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    return "" if s.lower() in ("nan", "none") else s


def _split_codes(v: Any) -> List[str]:
    """แยก counterpartyEmployeeCode → list ของ EMP### (รองรับ ';' และหลายคน)."""
    s = _norm_str(v)
    if not s:
        return []
    return list(dict.fromkeys(_EMP_RE.findall(s)))  # dedupe รักษาลำดับ


def _is_real_event(eid: Any) -> bool:
    s = _norm_str(eid)
    if not s or s in _SKIP_EVENT_IDS:
        return False
    return bool(_EVENT_ID_RE.match(s))


# ═══════════════════════════════════════════════════════════════════════════
# โหลดข้อมูลอ้างอิง
# ═══════════════════════════════════════════════════════════════════════════

def load_matrix(path: Optional[Union[str, Path]] = None) -> Dict[str, Any]:
    """อ่าน relationship_matrix.json (ของ architect) — sparse graph 2,194 คู่."""
    p = Path(path) if path else Path(cfg_mod.RELATIONSHIP_MATRIX_PATH)
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def load_injected_events(ctx: Any) -> List[Dict[str, Any]]:
    """อ่าน metadata ที่ phase 2 บันทึกไว้ — ลำดับ: ctx.injected_events > output_dir > checkpoint gen.

    คืน list of dict (eventId, logDateTime, sheet, employeeCode,
    counterpartyEmployeeCode, ...) — ถ้าไม่มีที่ไหนเลย คืน []
    """
    # 1) ถ้า ctx มี injected_events (list) — ถือเป็น authoritative (แม้จะเป็น [] ก็ตาม)
    #    เพื่อให้ test/scenario ปิดการอ่านจาก checkpoint ไฟล์จริงได้
    if hasattr(ctx, "injected_events") and isinstance(getattr(ctx, "injected_events", None), list):
        return list(ctx.injected_events)

    # 2) output_dir / injected_events.jsonl (รันผ่าน pipeline จริง)
    out_dir = getattr(ctx, "output_dir", None)
    if out_dir:
        p = Path(out_dir) / "injected_events.jsonl"
        if p.exists():
            return _read_jsonl(p)

    # 3) checkpoint ของ gen (tools/upgrade_360/output/injected_events.jsonl)
    p = GEN_CHECKPOINT_DIR / "injected_events.jsonl"
    if p.exists():
        return _read_jsonl(p)

    return []


def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def resolve_excel_dir(ctx: Any, excel_dir: Optional[Union[str, Path]] = None) -> Path:
    """หาโฟลเดอร์ Excel ที่จะ validate:
       excel_dir (ชัดเจน) > ctx.output_dir (ถ้ามีไฟล์ EMP) > ctx.input_dir > output/hr_onedrive_upgraded
    """
    if excel_dir is not None:
        return Path(excel_dir)

    def _has_emp_files(d: Any) -> bool:
        try:
            return d is not None and len(list(Path(d).glob("EMP*_OneDrive_Profile.xlsx"))) > 0
        except OSError:
            return False

    for attr in ("output_dir", "input_dir"):
        d = getattr(ctx, attr, None)
        if _has_emp_files(d):
            return Path(d)

    # fallback: output ที่ gen generate ไว้จริง
    if DEFAULT_EXCEL_DIR.exists():
        return DEFAULT_EXCEL_DIR

    src = getattr(ctx, "input_dir", None)
    return Path(src) if src else Path(cfg_mod.DEFAULT_INPUT_DIR)


def emp_file_path(excel_dir: Union[str, Path], emp_code: str) -> Path:
    return Path(excel_dir) / f"{emp_code}_OneDrive_Profile.xlsx"

TOOLS_DIR = Path(__file__).resolve().parent
APP_ROOT = TOOLS_DIR.parents[1]
DEFAULT_EXCEL_DIR = APP_ROOT / "tools" / "upgrade_360" / "output" / "hr_onedrive_upgraded"
GEN_CHECKPOINT_DIR = TOOLS_DIR / "output"  # ที่ gen เก็บ injected_events.jsonl / progress.jsonl

# ── รูปแบบ eventId จริงจาก catalog (WORK-08, SVC-01, CRISIS-2020-01, ...) ──
_EVENT_ID_RE = re.compile(r"^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$")
_EMP_RE = re.compile(r"EMP\d{3}")
_SKIP_EVENT_IDS = {"", "ROUTINE", "nan", "None", "N/A"}
_SHEET_FALLBACK = "Collaboration_Network"  # sheet มาตรฐานของคู่คน (DESIGN.md §9)


# ═══════════════════════════════════════════════════════════════════════════
# Scan เนื้อหา Excel — claims ฝั่งคนๆ หนึ่ง
# ═══════════════════════════════════════════════════════════════════════════

def scan_employee(path: Union[str, Path]) -> Dict[str, Any]:
    """อ่านไฟล์ Excel 1 คน (23 sheets) แล้วดึง claims ที่มี eventId + counterparty

    Return:
      {
        "ok": bool, "path": str, "error": str|None,
        "claims_by_cp": {cp: set[(eventId, logDateTime)]},
        "sheet_of":     {(cp, eventId, logDateTime): sheet},
        "rows": [ {sheet, eventId, logDateTime, counterparties, subject, logType, source, location, notes} ],
      }
    """
    p = Path(path)
    result: Dict[str, Any] = {
        "ok": False, "path": str(p), "error": None,
        "claims_by_cp": defaultdict(set), "sheet_of": {}, "rows": [],
    }
    if not p.exists():
        result["error"] = "file_not_found"
        return result
    try:
        book = excel_io.read_employee(p)
    except Exception as exc:  # ไฟล์เสีย — กันทั้ง pipeline พัง
        result["error"] = f"read_failed: {type(exc).__name__}: {exc}"
        return result

    for sheet, df in book.items():
        if not isinstance(df, pd.DataFrame) or "eventId" not in df.columns:
            continue
        for _, row in df.iterrows():
            eid = row.get("eventId")
            if not _is_real_event(eid):
                continue
            dt = _norm_dt(row.get("logDateTime"))
            if not dt:
                continue
            cps = _split_codes(row.get("counterpartyEmployeeCode"))
            if not cps:
                continue
            rec = {
                "sheet": sheet,
                "eventId": _norm_str(eid),
                "logDateTime": dt,
                "counterparties": cps,
                "subject": _norm_str(row.get("subject")),
                "logType": _norm_str(row.get("logType")),
                "source": _norm_str(row.get("source")),
                "location": _norm_str(row.get("location")),
                "notes": _norm_str(row.get("notes")),
            }
            result["rows"].append(rec)
            for cp in cps:
                key = (cp, rec["eventId"], dt)
                result["claims_by_cp"][cp].add((rec["eventId"], dt))
                result["sheet_of"].setdefault(key, sheet)  # sheet แรกที่เจอ
    result["ok"] = True
    return result


def _build_metadata_claims(injected: List[Dict[str, Any]]) -> Tuple[Dict[str, Dict[str, Set[Tuple[str, str]]]], Dict[Any, str], List[Dict[str, Any]]]:
    """สร้าง claims จาก injected_events metadata.

    Return: (claims_by_cp, sheet_of, records)
      claims_by_cp: {emp: {cp: set[(eventId, logDateTime)]}}
      sheet_of:     {(emp, cp, eventId, logDateTime): sheet}
      records:      [{employeeCode, counterpartyEmployeeCode, eventId, logDateTime, sheet, subject, ...}]
    """
    claims: Dict[str, Dict[str, Set[Tuple[str, str]]]] = defaultdict(lambda: defaultdict(set))
    sheet_of: Dict[Any, str] = {}
    records: List[Dict[str, Any]] = []
    for rec in injected:
        emp = _norm_str(rec.get("employeeCode"))
        eid = _norm_str(rec.get("eventId"))
        dt = _norm_dt(rec.get("logDateTime"))
        if not emp or not _is_real_event(eid) or not dt:
            continue
        cps = _split_codes(rec.get("counterpartyEmployeeCode"))
        if not cps:
            continue
        records.append(rec)
        for cp in cps:
            claims[emp][cp].add((eid, dt))
            sheet_of.setdefault((emp, cp, eid, dt), _norm_str(rec.get("sheet")))
    return claims, sheet_of, records

# ═══════════════════════════════════════════════════════════════════════════
# Repair — สร้าง log ฝั่งที่ขาด (API หรือ template ถ้า --no-api)
# ═══════════════════════════════════════════════════════════════════════════

def _template_mirror_row(event: Dict[str, Any], owner: str, counterparty: str, sheet: str) -> Dict[str, Any]:
    """สร้างแถว mirror ฝั่งที่ขาด — ใช้ template (เวลา/eventId ต้องเหมือนเดิม)."""
    return {
        "logDateTime": event.get("logDateTime", ""),
        "eventId": event.get("eventId", ""),
        "counterpartyEmployeeCode": counterparty,
        "logType": event.get("logType") or "incident",
        "subject": event.get("subject") or f"Mirror log — {event.get('eventId', '')}",
        "source": event.get("source") or "OrgGraph",
        "location": event.get("location") or "",
        "notes": event.get("notes") or event.get("descriptionTH") or "",
    }


def repair_inconsistency(
    ctx: Any,
    a: str,
    b: str,
    event: Dict[str, Any],
    missing_side: str,
    *,
    excel_dir: Optional[Union[str, Path]] = None,
) -> Dict[str, Any]:
    """ซ่อมแซม log ฝั่งที่ขาด (missing_side ∈ {'a','b'}).

    - owner        = คนที่ขาดแถว (missing_side=='b' → สร้างในไฟล์ของ b)
    - counterparty = คนที่อีกฝั่งอ้างถึง
    - เวลา/eventId ต้องเหมือนเดิมกับฝั่งต้นทางเสมอ (สัญญา DESIGN.md)
    - โหมด: API (ถ้ามี ctx.client และไม่ใช่ no_api) / template (--no-api)
    - เขียนผ่าน excel_io.write_employee(append_rows_per_sheet=...) แล้ว mark repaired

    Return record: {a, b, eventId, logDateTime, sheet, side, counterparty, method, repairedAt, path}
    """
    excel_dir = resolve_excel_dir(ctx, excel_dir)
    owner = b if missing_side == "b" else a
    counterparty = a if missing_side == "b" else b

    # เลือก sheet: ใช้ sheet ต้นทางถ้ามีในไฟล์ owner ไม่งั้น Collaboration_Network
    sheet = _norm_str(event.get("sheet")) or _SHEET_FALLBACK
    try:
        owner_sheets = excel_io.sheet_names_of(emp_file_path(excel_dir, owner))
        if owner_sheets and sheet not in owner_sheets:
            sheet = _SHEET_FALLBACK if _SHEET_FALLBACK in owner_sheets else owner_sheets[0]
    except Exception:
        sheet = _SHEET_FALLBACK

    method = "template"
    row = _template_mirror_row(event, owner, counterparty, sheet)

    # ── ลองใช้ API (DeepSeek) ถ้ามี client และไม่ใช่โหมด offline ──
    client = getattr(ctx, "client", None)
    no_api = bool(getattr(ctx, "no_api", True))
    if client is not None and not no_api:
        try:
            resp = client.chat.completions.create(
                model=cfg_mod.DEEPSEEK_MODEL,
                messages=[{
                    "role": "user",
                    "content": (
                        f"สร้างคำอธิบายภาษาไทยสั้นๆ (1-2 ประโยค) สำหรับ log mirror "
                        f"ของเหตุการณ์ {event.get('eventId')} ({event.get('subject', '')}) "
                        f"มุมมองของ {owner} กับ {counterparty} — ระบุชื่อทั้งสองฝั่ง"
                    ),
                }],
                max_tokens=120,
                temperature=0.7,
            )
            text = resp.choices[0].message.content.strip()
            if text:
                row["notes"] = text
                method = "api"
        except Exception:
            method = "template"  # API พัง → ใช้ template แทน (ไม่ fail pipeline)

    # ── เขียนลง Excel ฝั่ง owner ──
    dst = emp_file_path(excel_dir, owner)
    template_path = None
    if not dst.exists():
        src = Path(cfg_mod.DEFAULT_INPUT_DIR) / f"{owner}_OneDrive_Profile.xlsx"
        template_path = src if src.exists() else None
    excel_io.write_employee(dst, append_rows_per_sheet={sheet: [row]}, template_path=template_path)

    # ── mark repaired: ลง metadata ให้ phase 3 / rerun เห็นว่าแก้แล้ว ──
    record = {
        "a": a, "b": b, "eventId": event.get("eventId", ""),
        "logDateTime": event.get("logDateTime", ""), "sheet": sheet,
        "side": owner, "counterparty": counterparty, "method": method,
        "repairedAt": _now_iso(), "path": str(dst),
    }
    repaired_meta = dict(record)
    repaired_meta.update({
        "employeeCode": owner, "counterpartyEmployeeCode": counterparty,
        "logType": row.get("logType", "incident"), "subject": row.get("subject", ""),
        "notes": row.get("notes", ""), "source": row.get("source", ""),
        "location": row.get("location", ""), "rowKind": "repaired_mirror",
        "mirrorRequired": True, "mirrorEmployeeCode": counterparty,
    })
    _persist_injected(ctx, repaired_meta)

    return record


def _persist_injected(ctx: Any, record: Dict[str, Any]) -> None:
    """บันทึกแถวที่ repair ลง ctx.injected_events + injected_events.jsonl (best-effort)."""
    injected = getattr(ctx, "injected_events", None)
    if isinstance(injected, list):
        injected.append(record)
    out_dir = getattr(ctx, "output_dir", None)
    if out_dir:
        try:
            p = Path(out_dir) / "injected_events.jsonl"
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            pass


# ═══════════════════════════════════════════════════════════════════════════
# ฟังก์ชันหลัก — 150×150 Cross-Validation
# ═══════════════════════════════════════════════════════════════════════════

def cross_validate_relationships(
    ctx: Any,
    *,
    repair: bool = False,
    excel_dir: Optional[Union[str, Path]] = None,
    limit_pairs: Optional[int] = None,
    report_path: Optional[Union[str, Path]] = None,
    save_report: bool = True,
) -> Dict[str, Any]:
    """วนลูปทุกคู่ใน relationship_matrix (sparse) ตรวจ mirror log ข้ามไฟล์.

    กติกา (DESIGN.md §3.2/§9): ถ้า A มี (eventId, logDateTime) อ้างถึง B
    → B ต้องมี (eventId, logDateTime) เดียวกันอ้างถึง A ด้วย
    ตรวจจาก injected_events metadata ∪ เนื้อหา Excel จริง

    Args:
        ctx: RunContext (main.py) หรือ object ที่มี input_dir/output_dir/no_api/console
        repair: True → ซ่อมอัตโนมัติทุก mismatch ที่เจอ (repair_inconsistency)
        excel_dir: โฟลเดอร์ Excel ที่จะ validate (default: resolve อัตโนมัติ)
        limit_pairs: ทดสอบ N คู่แรก (เรียงตาม matrix) — ใช้ใน test
        report_path: ที่อยู่ของ report JSON (default: output_dir/validation_report.json)
        save_report: เขียน report ลงไฟล์หรือไม่

    Returns:
        report dict {status, scope, source, summary, failed, repaired, coverage, examples}
    """
    console = getattr(ctx, "console", None) or Console()
    out_dir = getattr(ctx, "output_dir", None) or Path(cfg_mod.DEFAULT_OUTPUT_DIR)

    # ── 1) โหลด matrix + metadata ──
    matrix = load_matrix()
    pairs = list(matrix.get("pairs", []))
    possible_pairs = matrix.get("scope", {}).get("possiblePairs", 11175)
    if limit_pairs:
        pairs = pairs[: limit_pairs]

    injected = load_injected_events(ctx)
    meta_claims, meta_sheet_of, _meta_records = _build_metadata_claims(injected)

    # ── 2) หาโฟลเดอร์ Excel ──
    excel_dir = resolve_excel_dir(ctx, excel_dir)
    console.print(
        Panel(
            f"[bold cyan]Phase 3 — 150×150 Cross-Validation[/bold cyan]\n"
            f"พนักงาน 150 × 150 = [bold]{possible_pairs:,}[/bold] คู่ที่เป็นไปได้\n"
            f"relationship_matrix (sparse): [bold]{len(matrix.get('pairs', [])):,}[/bold] คู่ "
            f"({100 * len(matrix.get('pairs', [])) / max(possible_pairs, 1):.1f}%)\n"
            f"excel dir: {excel_dir}\n"
            f"injected_events metadata: {len(injected):,} records "
            f"(real eventId: {sum(1 for r in injected if _is_real_event(r.get('eventId'))):,})",
            border_style="blue",
        )
    )


    # ── 3) scan ไฟล์ Excel ทุกคนที่อยู่ในคู่ที่จะตรวจ ──
    emp_codes = sorted({c for p in pairs for c in (p["a"], p["b"])})
    scans: Dict[str, Dict[str, Any]] = {}
    with Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("[cyan]Scanning Excel files...", total=len(emp_codes))
        for code in emp_codes:
            progress.update(task, description=f"[cyan]scan {code}[/cyan]")
            scans[code] = scan_employee(emp_file_path(excel_dir, code))
            progress.advance(task)
        progress.update(task, description="[green]scan done[/green]")

    files_found = sum(1 for s in scans.values() if s["ok"])
    files_missing = sum(1 for s in scans.values() if not s["ok"] and s.get("error") == "file_not_found")
    console.print(f"[cyan]files ok: {files_found} | missing/error: {files_missing}[/cyan]")

    # ── 4) วนลูปคู่ ตรวจ mirror ──
    failed: List[Dict[str, Any]] = []
    checked_pairs = 0
    skipped_pairs: List[Dict[str, Any]] = []
    coverage_linked = 0
    coverage_no_link: List[Dict[str, Any]] = []

    with Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("[cyan]Validating pairs...", total=len(pairs))

        for pair in pairs:
            a, b = pair["a"], pair["b"]
            progress.update(task, description=f"[cyan]{a}×{b}[/cyan]")

            scan_a, scan_b = scans.get(a, {}), scans.get(b, {})
            if not scan_a.get("ok") or not scan_b.get("ok"):
                skipped_pairs.append({
                    "a": a, "b": b,
                    "reason": (scan_a.get("error") or scan_b.get("error") or "file_missing"),
                })
                progress.advance(task)
                continue

            # claims ทั้ง 2 ทิศ = metadata ∪ excel
            claims_ab: Set[Tuple[str, str]] = set(scan_a["claims_by_cp"].get(b, set()))
            claims_ab |= set(meta_claims.get(a, {}).get(b, set()))
            claims_ba: Set[Tuple[str, str]] = set(scan_b["claims_by_cp"].get(a, set()))
            claims_ba |= set(meta_claims.get(b, {}).get(a, set()))

            checked_pairs += 1
            if claims_ab or claims_ba:
                coverage_linked += 1
            else:
                coverage_no_link.append({"a": a, "b": b, "eventIds": pair.get("eventIds", [])})

            pair_fails: List[Dict[str, Any]] = []
            # A → B ต้องมี mirror ใน B
            for eid, dt in sorted(claims_ab):
                if (eid, dt) in claims_ba:
                    continue
                sheetA = scan_a["sheet_of"].get((b, eid, dt)) or meta_sheet_of.get((a, b, eid, dt)) or ""
                sheetB = scan_b["sheet_of"].get((a, eid, dt)) or meta_sheet_of.get((b, a, eid, dt)) or ""
                src = "excel"
                if (eid, dt) in set(meta_claims.get(a, {}).get(b, set())):
                    src = "both" if _in_excel(scan_a, b, eid, dt) else "meta"
                pair_fails.append({
                    "a": a, "b": b, "eventId": eid, "logDateTime": dt,
                    "sheetA": sheetA, "sheetB": sheetB,
                    "missingSide": "b", "reason": "mirror_missing", "source": src,
                })
            # B → A ต้องมี mirror ใน A
            for eid, dt in sorted(claims_ba):
                if (eid, dt) in claims_ab:
                    continue
                sheetB = scan_b["sheet_of"].get((a, eid, dt)) or meta_sheet_of.get((b, a, eid, dt)) or ""
                sheetA = scan_a["sheet_of"].get((b, eid, dt)) or meta_sheet_of.get((a, b, eid, dt)) or ""
                src = "excel"
                if (eid, dt) in set(meta_claims.get(b, {}).get(a, set())):
                    src = "both" if _in_excel(scan_b, a, eid, dt) else "meta"
                pair_fails.append({
                    "a": a, "b": b, "eventId": eid, "logDateTime": dt,
                    "sheetA": sheetA, "sheetB": sheetB,
                    "missingSide": "a", "reason": "mirror_missing", "source": src,
                })

            # dedupe (event เดียวกันอาจเจอจากหลายแถว)
            seen: Set[Tuple[str, str, str]] = set()
            for f in pair_fails:
                key = (f["eventId"], f["logDateTime"], f["missingSide"])
                if key not in seen:
                    seen.add(key)
                    failed.append(f)
            progress.advance(task)
        progress.update(task, description="[green]validate done[/green]")


    # ── 5) repair (ถ้าต้องการ) ──
    repaired: List[Dict[str, Any]] = []
    if repair and failed:
        console.print(
            f"[yellow]Repairing {len(failed)} mismatches (no_api={getattr(ctx, 'no_api', True)})...[/yellow]"
        )
        for f in failed:
            event = {
                "eventId": f["eventId"], "logDateTime": f["logDateTime"],
                "sheet": f["sheetA"] or f["sheetB"] or _SHEET_FALLBACK,
                "subject": "", "notes": "", "logType": "incident",
            }
            try:
                rec = repair_inconsistency(ctx, f["a"], f["b"], event, f["missingSide"], excel_dir=excel_dir)
                repaired.append({**f, "repaired": True, **rec})
            except Exception as exc:
                repaired.append({**f, "repaired": False, "error": f"{type(exc).__name__}: {exc}"})

    # ── 6) สรุป + รายงาน ──
    failed_pairs_count = len({(f["a"], f["b"]) for f in failed})
    passed_pairs = checked_pairs - failed_pairs_count
    summary = {
        "checkedPairs": checked_pairs,
        "skippedPairs": len(skipped_pairs),
        "passed": passed_pairs,
        "failed": len(failed),
        "failedPairs": failed_pairs_count,
        "repaired": len([r for r in repaired if r.get("repaired")]),
        "repairFailed": len([r for r in repaired if not r.get("repaired")]),
        "passRate": round(100 * passed_pairs / max(checked_pairs, 1), 2),
        "coverageLinkedPairs": coverage_linked,
        "coverageNoLinkPairs": len(coverage_no_link),
    }

    report = {
        "status": "ok",
        "generatedAt": _now_iso(),
        "engine": "phase3_validate.cross_validate_relationships",
        "scope": {
            "totalEmployees": len(emp_codes),
            "possiblePairs": possible_pairs,
            "matrixPairs": len(matrix.get("pairs", [])),
            "sparsityPct": round(100 * len(matrix.get("pairs", [])) / max(possible_pairs, 1), 2),
        },
        "source": {
            "excelDir": str(excel_dir),
            "filesFound": files_found,
            "filesMissing": files_missing,
            "injectedEvents": len(injected),
        },
        "summary": summary,
        "failed": failed[:5000],
        "repaired": repaired[:5000],
        "coverageNoLink": coverage_no_link[:500],
        "examples": failed[:10],
    }

    # ── แสดงสรุป rich ──
    tbl = Table(title="Validation Summary", border_style="green")
    tbl.add_column("Metric", style="cyan")
    tbl.add_column("Value", style="white")
    tbl.add_row("checked pairs", str(summary["checkedPairs"]))
    tbl.add_row("passed", f"[green]{summary['passed']}[/green]")
    tbl.add_row("failed", f"[red]{summary['failed']} (across {summary['failedPairs']} pairs)[/red]")
    tbl.add_row("repaired", f"[yellow]{summary['repaired']}[/yellow]")
    tbl.add_row("pass rate", f"[bold]{summary['passRate']}%[/bold]")
    tbl.add_row("coverage: linked / no-link pairs",
                f"{summary['coverageLinkedPairs']} / {summary['coverageNoLinkPairs']}")
    console.print(tbl)

    if failed:
        ex = Table(title="ตัวอย่าง mismatch (first 5)", border_style="red")
        ex.add_column("A", style="cyan")
        ex.add_column("B", style="cyan")
        ex.add_column("eventId", style="white")
        ex.add_column("logDateTime", style="white")
        ex.add_column("sheetA→sheetB", style="yellow")
        ex.add_column("missing", style="red")
        for f in failed[:5]:
            ex.add_row(f["a"], f["b"], f["eventId"], f["logDateTime"],
                       f"{f['sheetA'] or '-'} → {f['sheetB'] or '-'}", f["missingSide"])
        console.print(ex)

    # ── เขียน report ลงไฟล์ ──
    if save_report:
        rp = Path(report_path) if report_path else Path(out_dir) / "validation_report.json"
        rp.parent.mkdir(parents=True, exist_ok=True)
        with open(rp, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        console.print(f"[green]✓ report saved: {rp}[/green]")

    return report


def _in_excel(scan: Dict[str, Any], cp: str, eid: str, dt: str) -> bool:
    return (eid, dt) in scan.get("claims_by_cp", {}).get(cp, set())


# ═══════════════════════════════════════════════════════════════════════════
# CLI สำหรับรัน standalone (debug)
# ═══════════════════════════════════════════════════════════════════════════

def main(argv: Optional[List[str]] = None) -> Dict[str, Any]:
    import argparse

    ap = argparse.ArgumentParser(description="Phase 3 Cross-Validation Engine")
    ap.add_argument("--excel-dir", default="", help="โฟลเดอร์ Excel ที่จะ validate")
    ap.add_argument("--repair", action="store_true", help="ซ่อมอัตโนมัติ mismatch ที่เจอ")
    ap.add_argument("--limit-pairs", type=int, default=None, help="ตรวจ N คู่แรก (test)")
    ap.add_argument("--report", default="", help="path report JSON")
    args = ap.parse_args(argv)

    class _Ctx:
        pass

    ctx = _Ctx()
    ctx.input_dir = Path(cfg_mod.DEFAULT_INPUT_DIR)
    ctx.output_dir = Path(cfg_mod.DEFAULT_OUTPUT_DIR)
    ctx.no_api = True
    ctx.client = None
    ctx.injected_events = load_injected_events(ctx)

    excel_dir = args.excel_dir or str(DEFAULT_EXCEL_DIR)
    return cross_validate_relationships(
        ctx,
        repair=args.repair,
        excel_dir=excel_dir,
        limit_pairs=args.limit_pairs,
        report_path=args.report or None,
    )


if __name__ == "__main__":
    main()

