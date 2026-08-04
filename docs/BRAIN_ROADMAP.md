# BuildersEye — สมอง 3 ชั้น & ระบบ Automation Training (Roadmap)

> **สถานะ:** วางแผน / ยังไม่ได้ implement
> **วันที่:** 2026-08-04
> **โปรเจกต์:** `/Users/arm/AI Test/mail-onedrive-org-graph/`

---

## 🎯 เป้าหมายสมอง (Brain) 3 ชั้น

```
   ┌─────────────────────────────────────────────────────┐
   │ 1. API Frontier Model (GPT-4o-mini)  ←─ หลักก่อน     │
   │ 2. Cloud GPU (Colab: QLoRA / vLLM)  ←─ ฝึก+ทดสอบ    │
   │ 3. Local Model (Ollama)            ←─ เป้าหมายสุดท้าย│
   └─────────────────────────────────────────────────────┘
         + ระบบ Automation Training ให้ model เก่งขึ้นเอง
```

| ชั้น | บทบาท | เมื่อไหร่ | สถานะ |
|---|---|---|---|
| 1. API Frontier | สมองหลัก (serve) | ตอนนี้ | ✅ มีแล้ว (`llmClient.js` → OpenAI) |
| 2. Cloud GPU | Training farm + test model ใหญ่ | หลัง Cloud ขึ้น | ⏳ ต้องทำ |
| 3. Local Model | Serve ข้อมูลส่วนตัว (ไม่รั่ว) | สุดท้าย | ⏳ ต้องทำ |
| Automation Training | ทำให้ Layer 3 เก่งขึ้น | สุดท้าย | ⏳ ไม่มี (ยังไม่สร้าง) |

---

## 🚀 Next Step: ขึ้น Cloud (ทำก่อน) — Phase CLOUD

> **เหตุผล:** แผนฝึก local model ต้องพึ่ง "ระบบที่ผลิตข้อมูล" ขึ้นมาก่อน เริ่มที่ deploy ระบบ RAG ขึ้น cloud (โดยใช้ API เป็นสมองหลัก) → ได้ผู้ใช้งานจริง → สะสม data ฝึกคุณภาพจริง

### C-1. เตรียมโค้ดให้ deploy ได้ ✅ (โค้ดเสร็จแล้ว + ทดสอบผ่าน)
- [x] คัดลอกข้อมูล demo จาก OneDrive path → เข้า repo (ข้อมูล demo อยู่ใน `src/data/hr_onedrive_demo` อยู่แล้ว 150 ไฟล์)
- [x] แก้ `server/index.js` ให้อ่านข้อมูลจาก repo path (เพิ่ม `HR_DATA_DIR` env + fallback)
- [x] ลด RAM — เพิ่ม `VECTOR_INDEX_DISABLED=true` (ทดสอบแล้ว ใช้ RAM แค่ ~66MB)
- [x] เตรียม `.env.example` (ไม่มี key จริง) + เพิ่ม `PORT`/`CORS_ORIGINS`/`HR_DATA_DIR`
- [x] แก้ CORS ให้รองรับ Vercel domain (`CORS_ORIGINS` env)
- [x] สร้าง `render.yaml` blueprint สำหรับ Render
- [x] frontend `src/main.js` รองรับ `?backend=` + `VITE_RAG_BACKEND` env
- [ ] **มนุษย์ต้องทำ:** หมุน OpenAI key ที่หลุด (`sk-proj-…`) ก่อน deploy (M-RISK-07)

### C-2. Deploy Frontend → Vercel (CDN ฟรี) — [มนุษย์ต้องทำ]
- [ ] `npm run build` → ผูก repo กับ Vercel → Deploy (หรือ `vercel` CLI)
- [ ] ตั้ง `VITE_RAG_BACKEND` env = URL ของ Render backend
- [ ] เปิดได้ URL เช่น `https://<project>.vercel.app` (อาจใช้ `?backend=` แทนได้)

### C-3. Deploy Backend → Render (free tier) — [มนุษย์ต้องทำ]
- [ ] push repo → New → Blueprint → เลือก `render.yaml`
- [ ] ตั้งค่า `OPENAI_API_KEY` (key ใหม่ที่หมุนแล้ว) ใน Render dashboard
- [ ] ใส่ `CORS_ORIGINS` = URL Vercel ด้านหน้า
- [ ] ยืนยัน `/api/health` ขึ้น `status: ok`

### C-4. ทดสอบ E2E บน cloud — [มนุษย์/ผมช่วยตรวจ log]
- [ ] `test_e2e.js` รันผ่านบน Render
- [ ] ตรวจว่าอนุญาตให้ `Employee_A` anonymization ทำงานจริง (ไม่ส่ง PII ไป API)

---

## 🧠 แผน Automation Training (ภายหลัง — หลัง Cloud เสร็จ)

### Phase 0 — เก็บ Training Data (anonymized)
- [ ] สร้าง module log `train_pairs.jsonl` แบบ **append + file-lock**
- [ ] เก็บ (instruction=query, output=answer) ที่ **ยังไม่ผ่าน deAnonymize**
- [ ] เก็บ metadata: tier, matchersUsed, timestamp, ผ่าน data quality gate
- ⚠️ ห้ามเก็บ PII ดิบ (M-R4 จาก audit)

### Phase 1 — สร้าง Dataset Pipeline + QLoRA Formatter
- [ ] แปลงเป็น format instruction (Alpaca/ShareGPT)
- [ ] ตัด context ให้ ≤ 2,000 ตัวอักษรไทย (ป้องกัน token ล้น 2,048 seq — audit R4 พบ overflow 3.1–3.3x)
- [ ] กรอง PII ซ้ำรอบ 2 (regex + human review sample)

### Phase 2 — รัน QLoRA บน Colab GPU
- [ ] Base model: `qwen2.5-7b` / `scb10x/typhoon-7b` (ไทย)
- [ ] `transformers + peft + bitsandbytes` บน `colab new --gpu T4`
- [ ] Train 1–2 epoch → save adapter (LoRA)

### Phase 3 — Evaluate เทียบ API Baseline
- [ ] เปรียบเทียบ answer กับ GPT-4o-mini (same queries)
- [ ] เกณฑ์ผ่าน: ใกล้เคียง + ไม่เพิ่ม PII/ไม่มีคำตอบมั่ว
- [ ] ถ้าไม่ผ่าน → เก็บเป็น negative samples (ไม่ออก serve)

### Phase 4 — Serve Local Model (ถ้าผ่าน)
- [ ] รัน Ollama บนเครื่อง/Colab (adapter merge)
- [ ] Router: API หลัก / Local สำรอง fallback
- [ ] Monitor + วนลูปเก็บ data ต่อ (retrain รอบถัดไป)

---

## ⚠️ ความเสี่ยงที่ต้องรู้ (ตัดจาก Audit R1–R4)

| # | ความเสี่ยง | ระดับ |
|---|---|---|
| 1 | ฝึกด้วย PII จริง → model จดจำถาวร | 🔴 High |
| 2 | "ตัวมันเองสอนเอง" → model collapse | 🔴 High |
| 3 | ไทย token ล้น QLoRA 2,048 | 🟡 Medium |
| 4 | Colab runtime หลุด / URL เปลี่ยน | 🟡 Medium |
| 5 | key หลุดใน repo → deploy ต้องหมุนก่อน | 🔴 High |

---

## ✅ สรุปลำดับการทำ

```
[ตอนนี้]  1. ขึ้น Cloud (Vercel + Render) ← ขั้นถัดไป
[หลัง]    2. เก็บ anonymized training data (Phase 0)
[หลัง]    3. QLoRA บน Colab GPU (Phase 1–2)
[หลัง]    4. Evaluate + Serve Local (Phase 3–4)
```

---

*เอกสารนี้เป็นแผนอ้างอิง — ตัว `[]` ใน checklist หมายถึงยังไม่ได้ทำ*