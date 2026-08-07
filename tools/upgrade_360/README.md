# upgrade_360 — 360-Degree Digital Twin & Time-Series Logs

CLI อัปเกรด Excel พนักงาน 150 คน (23 sheets/คน) ให้เป็น **log timeline 300–500 rows/คน**
ที่เชื่อมโยงข้ามคนผ่านคีย์ร่วม `eventId` + `logDateTime` เพื่อใช้ทดสอบ RAG / Graph RAG

Pipeline 3 เฟส:
1. **Phase 1 — Global Graph**: โหลด relationship matrix (2,194 คู่) + storyline catalog (101 เหตุการณ์)
2. **Phase 2 — Row Generation ต่อคน**: สร้างแถว log ต่อคน (drama + routine) ให้ครบ 300–500 rows/คน
3. **Phase 3 — Cross-person Validation**: ตรวจ mirror ข้ามไฟล์ — ถ้า A มี `(eventId, logDateTime)` อ้าง B
   แล้ว B ต้องมีแถวเดียวกันอ้าง A กลับ (เขียน `validation_report.json`)

---

## โครงสร้างโฟลเดอร์

```
tools/upgrade_360/
├── requirements.txt      # dependencies
├── config.py             # ค่าคงที่กลาง: paths, DeepSeek config, 23 sheet names
├── excel_io.py           # อ่าน/เขียน Excel 23 sheets (openpyxl) — append ต่อท้าย data rows
├── checkpoint.py         # state JSON (checkpoint.json) + save/load/resume
├── main.py               # orchestration 3 เฟส + RunContext (bridge → DataGenContext)
├── cli.py                # typer CLI: run / status
├── design/               # (ของ architect — อ่านอย่างเดียว)
│   ├── DESIGN.md
│   ├── relationship_matrix.json
│   └── storyline_catalog.json
├── phase2_generator.py   # (ของ gen-engineer) generate_employee(emp, DataGenContext)
├── phase3_validate.py    # (ของ qa-validator) cross_validate_relationships(ctx, excel_dir=...)
├── faker_routines.py / deepseek_client.py / pydantic_models.py   # (ของ gen-engineer)
├── out/                  # output (สร้างอัตโนมัติ) + checkpoint.json
└── .venv/                # virtualenv (Python 3.14)
```

## ติดตั้ง

```bash
cd "tools/upgrade_360"
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

> ใช้ Python 3.14.6 (homebrew) — ติดตั้งผ่านหมด (typer, rich, pandas, faker, openai,
> pydantic, openpyxl, python-dotenv)

---

## วิธีรันจริง

```bash
# ดู help
.venv/bin/python cli.py --help
.venv/bin/python cli.py run --help

# ── E2E ครบ 3 เฟส แบบ offline (ไม่ยิง API) — 3 คนแรก ──
.venv/bin/python cli.py run --phase all --no-api --limit 3 --output-dir out/e2e_test

# ── รันครบ 3 เฟส ด้วย API (DeepSeek) ──
DEEPSEEK_API_KEY=sk-xxx .venv/bin/python cli.py run --phase all
# หรือส่ง key ตรงๆ (--api-key ชนะ env) — ไม่ print ไม่ commit
.venv/bin/python cli.py run --api-key sk-xxx --phase all

# ── รันทีละเฟส ──
.venv/bin/python cli.py run --phase 1 --output-dir out/e2e_test          # global graph
.venv/bin/python cli.py run --phase 2 --no-api --limit 3 --output-dir out/e2e_test   # gen ต่อคน
.venv/bin/python cli.py run --phase 3 --output-dir out/e2e_test          # validate

# ── resume: ข้ามคนที่ completed แล้ว (ไม่เริ่มใหม่) ──
.venv/bin/python cli.py run --phase 2 --no-api --limit 3 --resume --output-dir out/e2e_test

# ── ดูสถานะ checkpoint โดยไม่รัน ──
.venv/bin/python cli.py status --output-dir out/e2e_test
```

> ไฟล์ต้นฉบับใน `src/data/hr_onedrive_demo/` ไม่ถูกแตะ — output ไปที่ `--output-dir`
> เสมอ (มี flag `--inplace` ถ้าต้องการเขียนทับจริง ต้องยืนยัน)

## Arguments ของ `run`

| Arg | Default | ความหมาย |
|---|---|---|
| `--api-key` | env `DEEPSEEK_API_KEY` | DeepSeek API key — ไม่ print ไม่ commit |
| `--input-dir` | `src/data/hr_onedrive_demo` | โฟลเดอร์ Excel ต้นฉบับ (อ่านอย่างเดียว) |
| `--output-dir` | `tools/upgrade_360/out` | โฟลเดอร์ output (ไม่ทับต้นฉบับ) |
| `--resume` | `false` | ต่อจาก checkpoint — ข้ามคนใน `completed` |
| `--limit` | — | scope = N คนแรก (EMP001..EMPN) — เลือกตั้งแต่ build_context ทุกเฟสเห็นชุดเดียวกัน |
| `--no-api` | `false` | โหมด offline ใช้ template แทน API |
| `--workers` | `1` | จำนวน worker สำหรับ Phase 2 (gen รองรับ parallel threads) |
| `--phase` | `all` | `1` (global graph) · `2` (gen ต่อคน) · `3` (validate) · `all` (คั่น `,` ได้) |
| `--inplace` | `false` | เขียนทับต้นฉบับ (ต้องยืนยัน) |

---

## 3 เฟส

1. **Phase 1 — Global Graph**: โหลด `design/relationship_matrix.json` + `design/storyline_catalog.json`
   (import `relationship_graph` แบบ lenient — ถ้ามี module ก็ใช้ module ก่อน)
2. **Phase 2 — Row Generation ต่อคน**: loop ตาม checkpoint เรียก
   `phase2_generator.generate_employee(emp, gen_ctx)` โดย `gen_ctx` เป็น **DataGenContext**
   ที่ main.py สร้าง bridge จาก RunContext (`no_api/api_key/workers/src_dir/output_dir`)
   → ใช้สัญญา ctx ที่เพื่อนร่วมทีมคาดหวังจริง (ไม่ส่ง RunContext ตรงๆ)
   - เขียน Excel ทันทีเมื่อคนนั้นเสร็จ + `mark_completed()` ทันที (กัน rerun ซ้ำ)
   - `injected_events.jsonl` = metadata ทุกแถวที่ inject (Phase 3 ใช้ตรวจข้ามไฟล์)
3. **Phase 3 — Validation**: เรียก `phase3_validate.cross_validate_relationships(ctx, excel_dir=...)`
   โดย `excel_dir` ชี้ไปที่ `<output_dir>/hr_onedrive_upgraded` (ไฟล์ที่ Phase 2 เขียน — ไม่ไป validate ต้นฉบับ)
   → เขียน `validation_report.json`

## Output structure

```
<output_dir>/
├── checkpoint.json                 # state ของ main (resume)
├── injected_events.jsonl           # metadata ที่ gen inject (Phase 3 ใช้)
├── checkpoint_events.json          # checkpoint ของ gen (idempotent ข้าม run)
├── progress.jsonl                  # สรุปต่อคน (rows added / drama / routine)
├── validation_report.json          # report Phase 3
└── hr_onedrive_upgraded/
    └── EMP###_OneDrive_Profile.xlsx   # Excel อัปเกรด (23 sheets, ไม่ทับต้นฉบับ)
```


## CHECKPOINT / RESUME

- state อยู่ที่ `<output-dir>/checkpoint.json`: `{completed: [...], current: {...}, stats}`
- เขียนแบบ atomic (tmp + rename) ทันทีที่คนนั้นเสร็จ
- `--resume` → ข้ามคนใน `completed` (log: `resume: skipped N คนที่ completed แล้ว`) เริ่มจากคนถัดไป
- `status` command ดูสถานะได้โดยไม่รัน
- `--limit` = scope คงที่ (N คนแรก) — resume ใน scope เดิมจะข้ามหมด / เอา `--limit` ออกเพื่อรันต่อให้ครบ 150

## หมายเหตุการออกแบบ Excel (สำคัญ)

- ไฟล์ต้นฉบับทุก sheet: row 1 = title, row 2 = blank/metadata, row 3 = header, row 4+ = data
- `excel_io.write_employee()`: append ต่อท้าย **data rows** เท่านั้น — ไม่ทับ header, ไม่ทำ header ซ้ำ
  คอลัมน์ใหม่ (เช่น `logDateTime`, `eventId`, `counterpartyEmployeeCode`) → ขยาย header ให้อัตโนมัติ

## API

- Base: `https://api.deepseek.com` · Model: `deepseek-v4-flash` (env `DEEPSEEK_BASE_URL`/`DEEPSEEK_MODEL` เปลี่ยนได้)
- ใช้ OpenAI SDK (`openai.OpenAI(api_key=..., base_url=...)`)
- key อ่านจาก `--api-key` > env `DEEPSEEK_API_KEY` เท่านั้น (ห้าม hardcode/print/commit)

## ปัญหาที่รู้ (QA finding — รอ gen-engineer/architect ปรับ)

Phase 3 จับได้ว่า **multi-participant events มี mirror ไม่สมมาตร** เช่น `POL-05`, `CRISIS-1997-05`:
คนที่ถูกเชื่อมผ่าน matrix pair (เช่น EMP001 กับ POL-05) จะเขียน `counterpartyEmployeeCode` ครบทุกคน
ใน suggestedParticipants แต่คนที่เป็น participant จริง (EMP002/EMP003) ไม่ได้อ้างกลับ → Phase 3 flag
`missingSide=b` (5 จุด / 3 คู่ ในการทดสอบ 3 คนแรก)
→ แก้ที่ `_counterparties_for()` / ข้อมูล catalog (ทำให้รายชื่อ participant สมมาตร 2 ทาง)
main.py ส่งต่อถูกต้องแล้ว — ตัว report ชี้จุดให้แก้

## Debug ตรงๆ (ไม่ผ่าน CLI)

```bash
.venv/bin/python main.py --phase 2 --no-api --limit 2 --output-dir out/e2e_test
```

