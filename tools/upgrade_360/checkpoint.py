# tools/upgrade_360/checkpoint.py
"""CHECKPOINT / RESUME — state เป็น JSON ที่ <output_dir>/checkpoint.json.

โครงสร้าง state:
{
  "completed": ["EMP001", "EMP003", ...],   // คนที่ทำเสร็จแล้ว (ข้ามเมื่อ --resume)
  "current":   {"empCode": "EMP005", "phase": 2, "startedAt": "..."},  // คนที่กำลังทำ
  "startedAt": "ISO datetime",
  "updatedAt": "ISO datetime",
  "stats": {"done": 12, "total": 150, "failed": ["EMP009"]}
}

กติกา:
- เขียน Excel ทันทีเมื่อคนนั้นเสร็จ (อยู่ที่ caller/excel_io) แล้ว mark_completed() ทันที
- ถ้า rerun --resume → ข้ามคนที่อยู่ใน completed แล้ว เริ่มจากคนถัดไป
- ถ้าไม่มี checkpoint (รันครั้งแรก) → เริ่มจากคนแรกทั้งหมด
"""
from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

DEFAULT_FILENAME = "checkpoint.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def checkpoint_path(output_dir: Path, filename: str = DEFAULT_FILENAME) -> Path:
    return Path(output_dir) / filename


def empty_state(total: int = 0) -> Dict[str, Any]:
    return {
        "completed": [],
        "current": None,
        "startedAt": _now_iso(),
        "updatedAt": _now_iso(),
        "stats": {"done": 0, "total": total, "failed": []},
    }


# ── I/O ───────────────────────────────────────────────────────────────────

def save_progress(state: Dict[str, Any], output_dir: Path, filename: str = DEFAULT_FILENAME) -> Path:
    """เขียน state ลง checkpoint.json (atomic: เขียน tmp แล้ว rename)."""
    p = checkpoint_path(output_dir, filename)
    p.parent.mkdir(parents=True, exist_ok=True)
    state["updatedAt"] = _now_iso()
    tmp = p.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    tmp.replace(p)  # atomic — ไม่มี checkpoint ครึ่งๆ กลางๆ
    return p


def load_progress(output_dir: Path, filename: str = DEFAULT_FILENAME) -> Optional[Dict[str, Any]]:
    """โหลด state จาก checkpoint.json — คืน None ถ้าไม่มีไฟล์."""
    p = checkpoint_path(output_dir, filename)
    if not p.exists():
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def resume_from(output_dir: Path, filename: str = DEFAULT_FILENAME) -> Dict[str, Any]:
    """คืน state ที่พร้อมใช้ต่อ — ถ้ามี checkpoint ให้โหลด ถ้าไม่มีให้ state ใหม่.

    completed ที่โหลดมา จะถูก normalize เป็น set ผ่าน completed_set() เพื่อเช็คเร็ว
    """
    state = load_progress(output_dir, filename)
    if state is None:
        return empty_state()
    # normalize โครงสร้าง เผื่อ checkpoint เก่า
    state.setdefault("completed", [])
    state.setdefault("current", None)
    state.setdefault("stats", {"done": len(state.get("completed", [])), "total": 0, "failed": []})
    state["stats"]["done"] = len(state.get("completed", []))
    return state


# ── helpers ───────────────────────────────────────────────────────────────

def completed_set(state: Dict[str, Any]) -> set:
    return set(state.get("completed", []))


def is_completed(state: Dict[str, Any], emp_code: str) -> bool:
    return emp_code in completed_set(state)


def mark_completed(state: Dict[str, Any], emp_code: str, output_dir: Path, total: int = 0) -> None:
    """ลงบันทึกว่าคนนี้ทำเสร็จ + เขียน checkpoint ทันที (กัน rerun ซ้ำ)."""
    done = state.setdefault("completed", [])
    if emp_code not in done:
        done.append(emp_code)
    state["current"] = None
    stats = state.setdefault("stats", {})
    stats["done"] = len(done)
    stats["total"] = total or stats.get("total", total)
    failed = stats.setdefault("failed", [])
    if emp_code in failed:
        failed.remove(emp_code)
    save_progress(state, output_dir)


def mark_failed(state: Dict[str, Any], emp_code: str, output_dir: Path, reason: str = "") -> None:
    """บันทึกว่าคนนี้ fail (ไม่นับใน completed — จะลองใหม่ในรอบถัดไป)."""
    failed = state.setdefault("stats", {}).setdefault("failed", [])
    if emp_code not in failed:
        failed.append({"empCode": emp_code, "reason": str(reason)[:500]})
    state["current"] = None
    save_progress(state, output_dir)


def start_current(state: Dict[str, Any], emp_code: str, phase: int, output_dir: Path) -> None:
    """บันทึกว่าเริ่มทำคนนี้ (phase ไหน) — สำหรับ debug ถ้าดับกลางคัน."""
    state["current"] = {"empCode": emp_code, "phase": phase, "startedAt": _now_iso()}
    save_progress(state, output_dir)


def remaining_codes(state: Dict[str, Any], all_codes: List[str]) -> List[str]:
    """คืนรายชื่อคนที่ยังต้องทำ (เรียงตาม all_codes) — ข้าม completed แล้ว."""
    done = completed_set(state)
    return [c for c in all_codes if c not in done]
