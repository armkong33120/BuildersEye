# -*- coding: utf-8 -*-
"""deepseek_client.py — DeepSeek OpenAI-compatible client สำหรับ Phase 2

- base_url : https://api.deepseek.com
- model    : deepseek-v4-flash (DeepSeek OpenAI-compatible)
- ฟังก์ชันหลัก: :func:`DeepSeekDramaClient.generate_drama_event(prompt_spec)`
  เรียก ``chat.completions`` แล้ว validate JSON ด้วย ``DramaEventInjection``
- fallback : :func:`template_offline` — ใช้เมื่อ ``--no-api`` หรือไม่มี key
  template เขียนภาษาไทยสมจริง หลากหลาย (random สำนวน ตาม category/riskLevel)
  ให้ผลคล้าย API พอใช้ทดสอบ/offline ได้

⚠️ ห้าม print / commit API key เด็ดขาด — key อ่านจาก env ``DEEPSEEK_API_KEY``
เจ้าของไฟล์: Data Generation (Phase 2)
"""

from __future__ import annotations

import hashlib
import json
import os
import random
from typing import Any, Dict, List, Optional

from pydantic import ValidationError

try:  # รันแบบ package (python -m tools.upgrade_360...)
    from .cost_tracker import CostTracker
    from .pydantic_models import DramaEventInjection
except ImportError:  # รันแบบ script ตรง (python tools/upgrade_360/deepseek_client.py)
    from cost_tracker import CostTracker
    from pydantic_models import DramaEventInjection

DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-v4-flash"

SYSTEM_PROMPT = (
    "คุณคือผู้ช่วยเขียนบันทึกเหตุการณ์บุคลากร (HR event log) ของบริษัทอสังหาริมทรัพย์ไทย "
    "BuildersEye คุณตอบเป็นภาษาไทยเท่านั้น สไตล์การเขียนเหมือนเจ้าหน้าที่ HR/ผู้ตรวจสอบภายใน "
    "ที่บันทึกรายละเอียดรอบด้าน เป็นกลาง ไม่กล่าวหา แต่ชี้ข้อเท็จจริงพร้อมหลักฐาน "
    "ตอบเป็น JSON object เท่านั้น โดยไม่มี markdown และไม่มีข้อความอื่นนอก JSON"
)

# ---------------------------------------------------------------------------
# Sentence pools สำหรับ template_offline (random เลือกสำนวน)
# ---------------------------------------------------------------------------
_FLAVOR_BY_CATEGORY: Dict[str, List[str]] = {
    "crisis": [
        "เหตุการณ์นี้ถูกบันทึกเป็นประวัติศาสตร์องค์กรที่ยังถูกหยิบยกอ้างถึงในการประชุมใหญ่จนถึงปัจจุบัน",
        "ผลกระทบสั่นสะเทือนยาวมาถึงนโยบายการเงิน การบริหารความเสี่ยง และสายสัมพันธ์ระหว่างรุ่นพี่รุ่นน้อง",
        "เป็นบทเรียนที่ทำให้บริษัทต้องทบทวนกระบวนการบริหารวิกฤตทั้งระบบ",
    ],
    "politics": [
        "ในการประชุมมีการตั้งคำถามถึงความโปร่งใสและวาระแอบแฝงของแต่ละฝ่ายอย่างตรงไปตรงมา",
        "ทั้งสองขั้วต่างยืนยันจุดยืนของตนเองและไม่ยอมถอย ส่งผลให้บรรยากาศการประชุมตึงเครียด",
        "เรื่องนี้ถูกมองว่าเป็นสัญญาณการแย่งชิงอำนาจที่เริ่มปะทุขึ้นภายในองค์กร",
    ],
    "grey_area_collusion": [
        "หลักฐานเบื้องต้นชี้ว่ามีการประสานข้อมูลกันก่อนการประกาศผล ยังอยู่ระหว่างการตรวจสอบเชิงลึก",
        "เรื่องถูกส่งต่อไปยังคณะกรรมการตรวจสอบภายในโดยไม่มีการเปิดเผยต่อสาธารณะ เพื่อรอผลสอบข้อเท็จจริง",
        "มีบันทึกการเข้าถึงเอกสารก่อนเวลาอันควรและอีเมลส่วนตัวที่เชื่อมโยงกับเหตุการณ์นี้",
    ],
    "cross_dept_conflict": [
        "มีการแลกเปลี่ยนวาจาที่รุนแรงและส่งอีเมลตำหนิถึงผู้บริหารระดับสูง สร้างความแตกแยกระหว่างทีม",
        "ทั้งสองฝ่ายต่างกล่าวหากันเรื่องความรับผิดชอบ ส่งผลให้งานในส่วนที่เกี่ยวข้องล่าช้าตามไปด้วย",
        "ฝ่ายบริหารต้องเรียกประชุมไกล่เกลี่ยเพื่อหาข้อสรุปร่วมกันระหว่างแผนก",
    ],
    "dept_negative": [
        "ผู้เกี่ยวข้องถูกเรียกสอบข้อเท็จจริงและถูกติดตามพฤติกรรมอย่างใกล้ชิดโดยหัวหน้าสายงาน",
        "เหตุการณ์นี้ส่งผลกระทบต่อความเชื่อมั่นภายในทีม และถูกบันทึกไว้ในแฟ้มประวัติพนักงาน",
        "มีการตั้งคณะทำงานเฉพาะกิจเพื่อตรวจสอบสาเหตุและวางมาตรการป้องกันไม่ให้เกิดซ้ำ",
    ],
    "positive": [
        "ทีมได้รับคำชื่นชมจากผู้บริหาร และผลงานนี้ถูกยกเป็นแบบอย่างให้แผนกอื่นนำไปปรับใช้",
        "ความสำเร็จครั้งนี้ช่วยสร้างขวัญกำลังใจให้กับทีมและสะท้อนวัฒนธรรมการทำงานร่วมกันที่ดี",
        "ผู้บริหารประกาศยกย่องต่อสาธารณะ และนำเรื่องนี้เข้าร่วมพิจารณาโบนัสประจำปี",
    ],
    "routine": [
        "กิจกรรมดำเนินไปตามปกติโดยไม่มีเหตุการณ์ผิดปกติ ตรงตามแผนที่วางไว้",
        "ผู้เข้าร่วมทุกฝ่ายให้ความร่วมมือเป็นอย่างดีและสรุปประเด็นได้ครบถ้วน",
        "บันทึกนี้เป็นหลักฐานการทำงานตามกระบวนการมาตรฐานขององค์กร",
    ],
    "family": [
        "ความสัมพันธ์ทางครอบครัวถูกอ้างถึงในการพิจารณาครั้งนี้ ทำให้ต้องใช้ความระมัดระวังเรื่องผลประโยชน์ทับซ้อน",
        "ฝ่าย HR บันทึกเรื่องเครือญาติไว้เป็นพิเศษเพื่อเฝ้าระวังการเอื้อประโยชน์ภายในองค์กร",
    ],
}

_RISK_CLOSING: Dict[str, List[str]] = {
    "critical": [
        "เรื่องนี้ถูกยกระดับเป็นวาระเร่งด่วนของคณะกรรมการบริหาร และสั่งการให้รายงานความคืบหน้าทุกสัปดาห์",
        "มีความเสี่ยงระดับวิกฤตต่อชื่อเสียงและสถานะทางการเงิน บอร์ดสั่งตั้งกรรมการสอบสวนอิสระ",
    ],
    "high": [
        "ผู้บริหารระดับสูงรับทราบและสั่งการให้ติดตามอย่างใกล้ชิด พร้อมกำหนดกรอบเวลาในการแก้ไข",
        "เรื่องถูกแจ้งเวียนให้หัวหน้าสายงานที่เกี่ยวข้องรับทราบ เพื่อป้องกันไม่ให้บานปลาย",
    ],
    "medium": [
        "หัวหน้าสายงานรับทราบและมอบหมายให้ผู้เกี่ยวข้องติดตามแก้ไขภายใน 30 วัน",
        "เหตุการณ์ถูกบันทึกเฝ้าระวังไว้ในระดับแผนก และนัดติดตามผลในรอบถัดไป",
    ],
    "low": [
        "เป็นเหตุการณ์ระดับเบา ยุติได้ด้วยการพูดคุยทำความเข้าใจร่วมกัน ไม่มีการดำเนินการทางวินัย",
        "บันทึกไว้เพื่อเป็นข้อมูลอ้างอิงเท่านั้น ไม่กระทบการประเมินผลงาน",
    ],
}


def _stable_seed(*parts: str) -> int:
    """seed ที่เสถียรข้าม process/run (ไม่ใช้ hash() ของ Python ที่ random ต่อ run)."""
    key = "|".join(parts)
    return int(hashlib.md5(key.encode("utf-8")).hexdigest()[:8], 16)


def build_user_prompt(spec: Dict[str, Any]) -> str:
    """สร้าง prompt สำหรับ API ให้ตอบ JSON ตาม schema ของ DramaEventInjection."""
    emp_name = spec.get("employeeName", "")
    cp_names = spec.get("counterpartyNames", "")
    lines = [
        "กรุณาเขียนบันทึกเหตุการณ์บุคลากร 1 เหตุการณ์ โดยตอบเป็น JSON object ที่มีฟิลด์:",
        '{"eventId": "...", "logDateTime": "...", "sheet": "...", "subject": "...",',
        ' "descriptionTH": "...", "counterpartyEmployeeCode": "...", "location": "...", "riskLevel": "..."}',
        "",
        "ข้อมูลเหตุการณ์:",
        f"- eventId: {spec.get('eventId','')}",
        f"- ชื่อเรื่อง: {spec.get('titleTH','')}",
        f"- รายละเอียด: {spec.get('descriptionTH','')}",
        f"- ประเภท: {spec.get('category','')} / ระดับความเสี่ยง: {spec.get('riskLevel','')}",
        f"- บันทึกลง sheet: {spec.get('sheet','')}",
        f"- พนักงานเจ้าของบันทึก: {spec.get('employeeCode','')} ({emp_name})",
    ]
    if cp_names:
        lines.append(f"- ฝ่ายที่เกี่ยวข้อง: {cp_names}")
    if spec.get("location"):
        lines.append(f"- สถานที่: {spec.get('location','')}")
    lines.append(
        "- ข้อกำหนด: subject สั้นไม่เกิน 15 คำ; descriptionTH ยาว 3-5 ประโยคภาษาไทย "
        "สไตล์ HR/ผู้ตรวจสอบภายใน เป็นกลาง มีรายละเอียดพอให้ RAG ใช้ค้นได้; "
        f"logDateTime ใช้ค่านี้ตรง ๆ: {spec.get('logDateTime','')}; "
        "counterpartyEmployeeCode ใช้รหัส EMP ที่ให้มา (คั่น ';' ถ้ามีหลายคน); riskLevel ใช้ค่าที่ให้มา"
    )
    return "\\n".join(lines)


def build_batch_user_prompt(specs: List[Dict[str, Any]]) -> str:
    """สร้าง prompt แบบ batch — หลายเหตุการณ์ใน 1 call → ตอบ JSON array ตาม eventId.

    ประหยัด token: system prompt + คำสั่งซ้ำๆ ส่งครั้งเดียวต่อกลุ่ม (ตัด overhead
    ต่อ event เดิม ~30-40% ของ prompt tokens)
    """
    parts = [
        "จงเขียนบันทึกเหตุการณ์บุคลากรจำนวน %d เหตุการณ์ โดยตอบเป็น JSON object: "
        '{"events": [ <object 1>, <object 2>, ... ]} ตามลำดับที่ให้' % len(specs),
        "แต่ละ object มีฟิลด์:",
        '{"eventId": "...", "subject": "...", "descriptionTH": "...", "counterpartyEmployeeCode": "...", "location": "...", "riskLevel": "..."}',
        "",
        "ข้อมูลเหตุการณ์ (เรียงตามลำดับ):",
    ]
    for i, spec in enumerate(specs, 1):
        emp_name = spec.get("employeeName", "")
        cp_names = spec.get("counterpartyNames", "")
        parts.append(f"[{i}] eventId={spec.get('eventId','')} | ชื่อเรื่อง: {spec.get('titleTH','')}")
        parts.append(f"    รายละเอียด: {spec.get('descriptionTH','')}")
        parts.append(f"    ประเภท: {spec.get('category','')} / ระดับความเสี่ยง: {spec.get('riskLevel','')}")
        parts.append(f"    บันทึกลง sheet: {spec.get('sheet','')}")
        parts.append(f"    พนักงานเจ้าของบันทึก: {spec.get('employeeCode','')} ({emp_name})")
        if cp_names:
            parts.append(f"    ฝ่ายที่เกี่ยวข้อง: {cp_names}")
        if spec.get("location"):
            parts.append(f"    สถานที่: {spec.get('location','')}")
        parts.append(f"    logDateTime (ใช้ตรง ๆ): {spec.get('logDateTime','')}")
        parts.append(
            "    ข้อกำหนด: subject สั้นไม่เกิน 15 คำ; descriptionTH ยาว 3-5 ประโยคภาษาไทย "
            "สไตล์ HR/ผู้ตรวจสอบภายใน เป็นกลาง มีรายละเอียดพอให้ RAG ใช้ค้นได้; "
            "counterpartyEmployeeCode ใช้รหัส EMP ที่ให้มา (คั่น ';'); riskLevel ใช้ค่าที่ให้มา"
        )
    parts.append(
        'ตอบเฉพาะ JSON {"events": [...]} เท่านั้น ไม่มี markdown ไม่มีข้อความอื่นนอก JSON'
    )
    return "\\n".join(parts)


def template_offline(spec: Dict[str, Any], rng: Optional[random.Random] = None) -> Dict[str, Any]:
    """Fallback template — เขียนภาษาไทยสมจริง หลากหลายตาม category/riskLevel.

    Deterministic ต่อ (eventId, sheet) เพื่อให้ทั้ง 2 ฝั่งได้ข้อความเดียวกัน
    (ใช้ได้ทั้งโหมด offline และเมื่อ API ล้มเหลว)
    """
    r = rng or random.Random()
    # seed ให้ deterministic ต่อ (eventId, sheet) — ทั้งสองฝั่งได้คำอธิบายเดียวกัน
    r.seed(_stable_seed(str(spec.get("eventId", "")), str(spec.get("sheet", ""))))

    category = spec.get("category", "")
    risk_level = spec.get("riskLevel", "medium")
    title = spec.get("titleTH", "")
    desc = spec.get("descriptionTH", "") or title
    emp_name = spec.get("employeeName", "")
    cp_names = spec.get("counterpartyNames", "") or spec.get("counterpartyEmployeeCode", "")

    flavor_pool = _FLAVOR_BY_CATEGORY.get(category, _FLAVOR_BY_CATEGORY["routine"])
    flavor = r.choice(flavor_pool)
    closing_pool = _RISK_CLOSING.get(risk_level, _RISK_CLOSING["medium"])
    closing = r.choice(closing_pool)

    subject = (title[:60] + ("…" if len(title) > 60 else "")) if title else spec.get("subject", "")

    parts = [desc.strip()]
    if emp_name and cp_names:
        parts.append(f"ฝ่ายที่เกี่ยวข้อง: {emp_name} และ {cp_names}")
    elif emp_name:
        parts.append(f"ผู้ที่เกี่ยวข้องหลัก: {emp_name}")
    parts.append(flavor)
    parts.append(closing)
    descriptionTH = " ".join(parts)

    data: Dict[str, Any] = {
        "eventId": spec.get("eventId", ""),
        "logDateTime": spec.get("logDateTime", ""),
        "sheet": spec.get("sheet", ""),
        "subject": subject,
        "descriptionTH": descriptionTH,
        "counterpartyEmployeeCode": spec.get("counterpartyEmployeeCode", ""),
        "location": spec.get("location", ""),
        "riskLevel": risk_level,
    }
    # ฟิลด์เสริมจาก spec (ถ้ามี) — เติมให้ครบ schema
    for k in ("employeeCode", "category", "logType", "source", "notes",
              "relationship", "faction", "financialImpactTHB", "resolutionStatus", "expansion"):
        if spec.get(k) not in (None, ""):
            data[k] = spec[k]
    return data


class DeepSeekDramaClient:
    """Client สำหรับ generate บันทึกดราม่า — API จริง หรือ fallback template."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        no_api: bool = False,
        timeout: int = 60,
        rng: Optional[random.Random] = None,
        cost_output_dir: Optional[str] = None,
    ):
        api_key = api_key or os.environ.get("DEEPSEEK_API_KEY", "")
        self.no_api = bool(no_api) or not api_key
        self.api_key = ""  # ไม่เก็บ key ไว้ใน attribute ที่อาจถูก print
        self.rng = rng or random.Random()
        # ติดตามค่าใช้จ่าย API (ใช้งานได้ทั้งโหมด online/offline)
        self.cost_tracker = CostTracker(output_dir=cost_output_dir)
        if not self.no_api:
            from openai import OpenAI  # import ข้างใน เพื่อให้ offline mode ไม่ต้องมี openai

            self._client = OpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL, timeout=timeout)
            self.model = DEEPSEEK_MODEL
        else:
            self._client = None
            self.model = DEEPSEEK_MODEL

    @property
    def using_api(self) -> bool:
        return self._client is not None

    def generate_drama_event(self, prompt_spec: Dict[str, Any]) -> Dict[str, Any]:
        """เรียก API (หรือ fallback) → validate → dict ของ DramaEventInjection.

        - ไม่ยิง API ซ้ำ: phase2_generator เก็บ cache ต่อ (eventId, sheet) ไว้ที่ ctx
        - ถ้า API ล้มเหลว/ไม่มี key → template_offline ทันที (ไม่ raise)
        """
        if self._client is None:
            return self._validate(template_offline(prompt_spec, self.rng))
        try:
            return self._call_api(prompt_spec)
        except Exception:
            # fallback เงียบ — offline resilience
            return self._validate(template_offline(prompt_spec, self.rng))

    # ------------------------------------------------------------------
    # Batch mode — group หลาย events ต่อ 1 API call (ตัด token overhead)
    # ------------------------------------------------------------------
    def generate_drama_events(self, specs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Generate หลายเหตุการณ์ใน 1 call — ส่งเป็น JSON array ตามลำดับ spec.

        - offline / ไม่มี key → template_offline ต่อ spec (deterministic เดิม)
        - API ล้มเหลวทั้ง batch → fallback template ต่อ spec (ไม่ raise)
        - ใช้ eventId map ผลลัพธ์กลับ → ลำดับจาก API ไม่ต้องตรงก็ได้
        """
        if not specs:
            return []
        if self._client is None:
            return [self._validate(template_offline(s, self.rng)) for s in specs]
        try:
            return self._call_api_batch(specs)
        except Exception:
            return [self._validate(template_offline(s, self.rng)) for s in specs]

    def _call_api_batch(self, specs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        batch_size = len(specs)
        kwargs: Dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_batch_user_prompt(specs)},
            ],
            "temperature": 0.9,
            # ต่อ event ~500-600 tokens ก็พอ (subject + descriptionTH 3-5 ประโยค)
            "max_tokens": min(6000, 600 * batch_size),
        }
        if os.environ.get("DEEPSEEK_THINKING", "disabled") == "disabled":
            kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
        try:
            kwargs["response_format"] = {"type": "json_object"}
            resp = self._client.chat.completions.create(**kwargs)
        except Exception:
            kwargs.pop("response_format", None)
            resp = self._client.chat.completions.create(**kwargs)

        text = (resp.choices[0].message.content or "").strip()
        data = json.loads(text)
        # รองรับทั้ง {"events": [...]} และ [...] ตรง ๆ
        if isinstance(data, dict):
            data = data.get("events") or data.get("data") or []
        if not isinstance(data, list):
            raise ValueError(f"batch response is not a list: {type(data).__name__}")

        # บันทึก token usage → cost tracker (1 record ต่อ batch call)
        try:
            usage = getattr(resp, "usage", None)
            if usage is not None:
                self.cost_tracker.record(
                    prompt_tokens=getattr(usage, "prompt_tokens", 0),
                    completion_tokens=getattr(usage, "completion_tokens", 0),
                    cache_read_tokens=getattr(usage, "prompt_tokens_details", None)
                    and getattr(usage.prompt_tokens_details, "cached_tokens", 0) or 0,
                    model=getattr(self, "model", ""),
                    extra={"batch": batch_size,
                           "eventIds": ",".join(s.get("eventId", "") for s in specs)},
                )
        except Exception:
            pass  # tracking ล้มเหลวต้องไม่พังการ generate

        # map ผลลัพธ์ด้วย eventId (กันลำดับจาก API สลับ)
        by_eid: Dict[str, Dict[str, Any]] = {}
        for item in data:
            if isinstance(item, dict) and item.get("eventId"):
                by_eid[str(item["eventId"])] = item

        results: List[Dict[str, Any]] = []
        for spec in specs:
            item = by_eid.get(str(spec.get("eventId", "")))
            if item is None:
                results.append(self._validate(template_offline(spec, self.rng)))
                continue
            merged = dict(item)
            # ค่าที่ phase2 กำหนด (eventId/logDateTime/...) ชนะค่าจาก API เสมอ
            for k in ("eventId", "logDateTime", "sheet", "employeeCode",
                      "counterpartyEmployeeCode", "location", "riskLevel", "category",
                      "logType", "source", "relationship", "faction"):
                if spec.get(k) not in (None, ""):
                    merged[k] = spec[k]
            results.append(self._validate(merged))
        return results

    def _call_api(self, spec: Dict[str, Any]) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_prompt(spec)},
            ],
            "temperature": 0.9,
            "max_tokens": 600,
        }
        # ประหยัด tokens: งานนี้ generate JSON ตรงๆ ไม่ต้องใช้ chain-of-thought
        # (DeepSeek v4-flash เปิด thinking เป็นค่าเริ่มต้น = เบิร์น output tokens กับ reasoning)
        # ปิดได้ผ่าน env DEEPSEEK_THINKING=disabled (default) / enabled (เมื่ออยากได้ reasoning)
        if os.environ.get("DEEPSEEK_THINKING", "disabled") == "disabled":
            kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
        try:
            kwargs["response_format"] = {"type": "json_object"}
            resp = self._client.chat.completions.create(**kwargs)
        except Exception:
            # provider บางรายไม่รองรับ response_format → ลองใหม่แบบธรรมดา
            kwargs.pop("response_format", None)
            resp = self._client.chat.completions.create(**kwargs)

        text = (resp.choices[0].message.content or "").strip()
        data = json.loads(text)
        # บันทึก token usage → cost tracker (resp.usage จาก OpenAI-compatible API)
        try:
            usage = getattr(resp, "usage", None)
            if usage is not None:
                self.cost_tracker.record(
                    prompt_tokens=getattr(usage, "prompt_tokens", 0),
                    completion_tokens=getattr(usage, "completion_tokens", 0),
                    cache_read_tokens=getattr(usage, "prompt_tokens_details", None)
                    and getattr(usage.prompt_tokens_details, "cached_tokens", 0) or 0,
                    model=getattr(self, "model", ""),
                    extra={"eventId": spec.get("eventId", "")},
                )
        except Exception:
            pass  # tracking ล้มเหลวต้องไม่พังการ generate
        # ค่าที่ phase2 กำหนด (eventId/logDateTime/...) ชนะค่าจาก API เสมอ
        for k in ("eventId", "logDateTime", "sheet", "employeeCode",
                  "counterpartyEmployeeCode", "location", "riskLevel", "category",
                  "logType", "source", "relationship", "faction"):
            if spec.get(k) not in (None, ""):
                data[k] = spec[k]
        return self._validate(data)

    @staticmethod
    def _validate(data: Dict[str, Any]) -> Dict[str, Any]:
        try:
            return DramaEventInjection(**data).model_dump()
        except ValidationError:
            # ตัดฟิลด์ที่ไม่รู้จักออกแล้วลองใหม่
            known = set(DramaEventInjection.model_fields)
            clean = {k: v for k, v in data.items() if k in known}
            return DramaEventInjection(**clean).model_dump()
