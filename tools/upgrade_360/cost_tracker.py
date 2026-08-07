#!/usr/bin/env python3
"""cost_tracker.py — ติดตามค่าใช้จ่าย API (DeepSeek) แบบง่าย

- เก็บ usage จริงจาก response ของ OpenAI-compatible API (prompt/completion tokens)
- คำนวณ cost ประมาณด้วยราคาต่อ 1M tokens (ปรับได้ผ่าน env):
    DS_PRICE_INPUT         default 0.27   USD / 1M (cache miss)
    DS_PRICE_CACHE_INPUT   default 0.07   USD / 1M (cache hit)
    DS_PRICE_OUTPUT        default 1.10   USD / 1M
- เขียน log ราย call ไปที่ <output_dir>/api_cost_usage.jsonl (append)
- ปลอดภัยตอน offline (ไม่มี API call → ไม่มีบันทึก)

ใช้:  from cost_tracker import CostTracker
     tracker = CostTracker(output_dir="out")
     tracker.record(prompt_tokens, completion_tokens, model="deepseek-v4-flash", cache_hit=0, extra=None)
     print(tracker.summary())
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

PRICE_INPUT = float(os.environ.get("DS_PRICE_INPUT", "0.27"))          # USD / 1M tokens
PRICE_CACHE_INPUT = float(os.environ.get("DS_PRICE_CACHE_INPUT", "0.07"))
PRICE_OUTPUT = float(os.environ.get("DS_PRICE_OUTPUT", "1.10"))


class CostTracker:
    def __init__(self, output_dir: Optional[str] = None, log: bool = True):
        self.log = log
        self.output_dir = str(output_dir) if output_dir else "out"
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.cache_read_tokens = 0
        self.calls = 0
        self.by_model: Dict[str, Dict[str, int]] = {}
        self._started = time.time()

    def record(
        self,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        model: str = "",
        cache_read_tokens: int = 0,
        extra: Optional[Dict[str, Any]] = None,
    ) -> None:
        """บันทึก 1 call (tokens มาจาก response.usage)"""
        self.prompt_tokens += int(prompt_tokens or 0)
        self.completion_tokens += int(completion_tokens or 0)
        self.cache_read_tokens += int(cache_read_tokens or 0)
        self.calls += 1
        m = self.by_model.setdefault(model or "unknown", {"prompt": 0, "completion": 0, "calls": 0})
        m["prompt"] += int(prompt_tokens or 0)
        m["completion"] += int(completion_tokens or 0)
        m["calls"] += 1

        if self.log:
            try:
                Path(self.output_dir).mkdir(parents=True, exist_ok=True)
                row = {
                    "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                    "model": model or "unknown",
                    "prompt_tokens": int(prompt_tokens or 0),
                    "completion_tokens": int(completion_tokens or 0),
                    "cache_read_tokens": int(cache_read_tokens or 0),
                    "cost_usd": round(self._cost(int(prompt_tokens or 0), int(completion_tokens or 0), int(cache_read_tokens or 0)), 6),
                    **({} if not extra else extra),
                }
                with open(os.path.join(self.output_dir, "api_cost_usage.jsonl"), "a", encoding="utf-8") as f:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
            except Exception:
                pass  # log ล้มเหลวต้องไม่พัง pipeline

    @staticmethod
    def _cost(prompt: int, completion: int, cache_read: int = 0) -> float:
        return (
            prompt * PRICE_INPUT
            + cache_read * PRICE_CACHE_INPUT
            + completion * PRICE_OUTPUT
        ) / 1_000_000

    def cost_usd(self) -> float:
        return self._cost(self.prompt_tokens, self.completion_tokens, self.cache_read_tokens)

    def summary(self) -> Dict[str, Any]:
        return {
            "calls": self.calls,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "total_tokens": self.prompt_tokens + self.completion_tokens + self.cache_read_tokens,
            "estimated_cost_usd": round(self.cost_usd(), 6),
            "pricing": {
                "input_per_1m": PRICE_INPUT,
                "cache_input_per_1m": PRICE_CACHE_INPUT,
                "output_per_1m": PRICE_OUTPUT,
            },
            "by_model": self.by_model,
            "elapsed_sec": round(time.time() - self._started, 1),
        }

    def __repr__(self) -> str:  # pragma: no cover
        s = self.summary()
        return f"<CostTracker calls={s['calls']} cost≈${s['estimated_cost_usd']}>"
