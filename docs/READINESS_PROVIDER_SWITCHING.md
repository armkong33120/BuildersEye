# System Readiness Assessment — Provider Switching (API / Cloud GPU / Local Model)

**วันที่:** 5 สิงหาคม 2026
**ขอบเขต:** ประเมินว่าโครงสร้างของระบบ BuildersEye RAG มีความพร้อมแค่ไหนในการสลับระหว่าง 3 โหมด LLM:
1. **API** (DeepSeek/OpenAI — managed API)
2. **Cloud GPU** (Google Colab T4 + Ollama)
3. **Local model** (Ollama Qwen2.5-7B บนเครื่อง/self-hosted)

**หมายเหตุ:** งานนี้ถูกจัดตั้งเป็นทีมผู้เชี่ยวชาญ 7 คน แต่ agent ย่อยไม่สามารถรันได้เนื่องจาก auth error ของ Cline (`Unauthorized` ทั้ง sync/async) จึงดำเนินการประเมินโดย lead โดยตรง (read-only, ไม่แก้โค้ด)
**วิธีตรวจ:** อ่านโค้ดจริง (`llmClient.js`, `semanticParser.js`, `sqlEngine.js`, `chatController.js`, `index.js`, `render.yaml`) + ตรวจ env จริงบน Render + สังเกตการณ์จากการทดลองจริง (Qwen ผ่าน Colab tunnel)

---

## Executive Summary (คะแนนความพร้อม)

| โหมด | คะแนน | สถานะ |
|------|-------|--------|
| **1. API (DeepSeek/OpenAI)** | 🟢 **85% — Ready** | abstraction ครบ, ใช้ได้จริง, เปลี่ยน provider ได้ด้วย env |
| **2. Cloud GPU (Colab T4)** | 🟡 **45% — Partial** | ทำงานได้ (พิสูจน์แล้ว) แต่ tunnel ไม่เสถียร, session ตาย |
| **3. Local model (Ollama 7B)** | 🟡 **55% — Partial** | เข้ากันได้กับ client แต่คุณภาพ/การบังคับภาษาไทยยังเป็นจุดเสี่ยง |
| **สถาปัตยกรรม (สลับอัตโนมัติ)** | 🟡 **50% — Partial** | switch ผ่าน env ได้ แต่ไม่มี router/failover/validation |

---

## 🔷 1. โหมด API (DeepSeek/OpenAI) — Ready 85%

### จุดแข็ง
- ✅ **Abstraction ดี:** `llmClient.js` read env `LLM_BASE_URL` + `LLM_MODEL` + `LLM_API_KEY` → ใช้ `OpenAI` client เดียว
- ✅ **Consistent:** `semanticParser.js` (line 121) และ `sqlEngine.js` ใช้ client กลางจาก `llmClient.js` เดียวกัน (provider switch ผ่าน env เดียว)
- ✅ **พิสูจน์การทำงาน:** DeepSeek ทำงานได้จริงบน Render (ตอบภาษาไทยถูกต้อง, คำนวณเงินเดือน/KPI สำเร็จ)
- ✅ **rawSql mode** + SQL allowlist ทำงาน (ทดสอบ SELECT/DROP แล้ว)
- ✅ เปลี่ยน provider API (DeepSeek↔OpenAI) ได้โดยแก้แค่ env

### จุดที่ยังขาด (Partial)
- ⚠️ **ไม่มี rate-limit handling / retry** — เรียก API ครั้งเดียว ถ้าล้มเหลวคืน null (ไม่มี backoff)
- ⚠️ **ไม่มี cost monitoring** — ใช้ DeepSeek ได้แต่ไม่มี budget guard
- ⚠️ `getClient()` สร้าง client ครั้งเดียว (module-level) — ถ้า env เปลี่ยนตอน runtime ต้อง restart

### เกณฑ์ Ready:
- ✅ ใช้เป็น production ได้ (พิสูจน์แล้ว), ⚠️ เพิ่ม retry/backoff + cost cap จะเป็น 100%

---

## 🔷 2. โหมด Cloud GPU (Colab T4) — Partial 45%

### จุดแข็ง
- ✅ **พิสูจน์การทำงาน:** Qwen2.5-7B บน Colab T4 → cloudflared tunnel → `/v1/chat/completions` ทำงานได้ (ตอบ 1.3s)
- ✅ OpenAI-compatible `/v1` path ใช้ได้กับ `llmClient.js` (ไม่ต้องแก้โค้ด)

### จุดเสี่ยง/ขาด (จุดที่ทำให้ไม่ Ready)
- 🔴 **Tunnel ไม่เสถียร (Critical):** quick tunnel (trycloudflare) เจอ **403/530** บ่อย — ต้องใช้ `--protocol http2` + version ใหม่ถึงจะผ่าน และ URL **เปลี่ยนทุกครั้ง** ที่เปิด session ใหม่
- 🔴 **Colab VM ตายเมื่อ idle:** session หลุด → model หาย → ระบบ Qwen ใช้ไม่ได้
- 🔴 **Cold start ช้า:** ต้องโหลด Ollama + model (ใช้เวลา 1-2 นาที) ก่อนตอบครั้งแรก
- 🔴 **URL tunnel เปลี่ยนทุกครั้ง:** ต้องแก้ `LLM_BASE_URL` บน Render ทุกครั้งที่เปิด Colab → ไม่เหมาะ production
- ⚠️ **Security:** เปิด local model ผ่าน tunnel สาธารณะ (ไม่มี auth บน Ollama) = ใครก็เรียกได้
- ⚠️ **ค่าใช้จ่าย/Quota:** T4 ฟรีมี quota จำกัด

### เกณฑ์ Ready:
- ❌ ยังไม่พร้อม production — เหมาะเป็น **test/staging** หรือ **dev** มากกว่า
- ต้อง: named tunnel ที่เสถียร + auto-restart script + ไม่พึ่ง URL เปลี่ยน

---

## 🔷 3. โหมด Local model (Ollama 7B) — Partial 55%

### จุดแข็ง
- ✅ **เข้ากันได้กับ client:** Ollama `/v1/chat/completions` ใช้กับ `OpenAI` client ของ `llmClient.js` ได้ทันที
- ✅ **VRAM พอ:** Qwen2.5-7B (~4.7GB) ใส่ T4 15.6GB ได้สบาย, QLoRA fine-tune ได้
- ✅ **เร็ว:** inference 1.3s บน T4
- ✅ **Privacy:** ข้อมูลไม่ต้องออกเครื่อง (ตรงกับจุดขายเดิม)

### จุดเสี่ยง/ขาด
- 🔴 **การบังคับภาษาไทย (Critical):** Qwen2.5-7B **ตอบเป็นภาษาจีน** เมื่อ context/คำถามมีภาษาอังกฤษเยอะ (ทดสอบพบจริง) — ต้องมี system prompt บังคับ "ตอบไทยเท่านั้น" ที่ชัดเจน (ตอนนี้ `llmClient.js` มี rule ข้อ 1 อยู่ แต่ไม่แรงพอสำหรับ local 7B)
- 🟠 **คุณภาพสู้ DeepSeek ไม่ได้:** 7B เล็กกว่า DeepSeek → การ parse/SQL/คำตอบซับซ้อนอาจคลาดเคลื่อน (สังเกต query "สรุปผล KPI" Qwen คำนวณได้ 0 ผิด)
- 🟠 **Local model ต้องการ GPU/เครื่องแรง** — ถ้าวิ่งบน Mac CPU จะช้ามาก
- ⚠️ ต้อง **QLoRA fine-tune** ด้วยข้อมูลไทยปนอังกฤษ + คำ HR เพื่อให้เทียบเท่า API

### เกณฑ์ Ready:
- ⚠️ ใช้ได้ใน dev/privacy-sensitive แต่ **ต้องแก้ system prompt ไทย + fine-tune** ก่อน production
---

## 🔷 4. สถาปัตยกรรม (Dynamic Switching) — Partial 50%

### จุดแข็ง (สิ่งที่ทำดีแล้ว)
- ✅ **Single abstraction point:** `llmClient.js` เป็น entry เดียว → ทั้ง `semanticParser`, `sqlEngine`, `chatController` ใช้ client เดียวกัน
- ✅ **Switch ผ่าน env 100%:** `LLM_BASE_URL` + `LLM_MODEL` → เปลี่ยน provider โดยไม่แก้โค้ด (DeepSeek↔Qwen พิสูจน์แล้ว)
- ✅ **Default ปลอดภัย:** fallback เป็น DeepSeek ใน `llmClient.js` (line 9, 11)

### จุดขาด (ที่ทำให้ไม่ 100%)
- 🔴 **ไม่มี router/failover:** ถ้า provider หนึ่งล้ม (เช่น tunnel ตาย) ไม่มี fallback อัตโนมัติ → ตอบไม่ได้
- 🔴 **ไม่มี config validation:** ถ้า `LLM_BASE_URL`/`LLM_MODEL` ผิด (เช่น URL ตาย, model ไม่มี) → คืน null เงียบ ๆ ไม่มี error ชัดเจน
- 🟠 **Single point of failure:** พึ่ง tunnel ตัวเดียว, ไม่มี health check ของ provider ก่อนใช้
- 🟠 `getClient()` cache client ตัวเดียว — สลับ provider ต้อง restart process
- 🟠 **ไม่มีการแยก config ต่อ provider** (เช่น API key ของ cloud GPU ต่างจาก local)

### ข้อแนะนำสถาปัตยกรรม (เพื่อให้ 100%)
1. **เพิ่ม Provider Registry/Selector** — ตั้งค่า provider หลายตัว + เลือก/สลับตาม config หรือ health
2. **เพิ่ม failover** — ถ้า provider หลักล้ม → พยายามตัวถัดไป
3. **เพิ่ม config validation** — ตรวจ URL/model/key ตอน startup แจ้ง error ชัดเจน
4. **Provider health check** — ping `/v1/models` ก่อนใช้

---

## 🎯 สรุปความพร้อม (ตามโหมดที่คุณวางแผนไว้)

| โหมด | ความพร้อม | ใช้ทำอะไรได้ตอนนี้ |
|------|-----------|------------------|
| **API (DeepSeek)** | ✅ **พร้อมใช้ production** | เป็นสมองหลักได้เลย (ค่าใช้จ่ายแต่เสถียร) |
| **Cloud GPU (Colab)** | ⚠️ **เป็น dev/test** | ทดลอง model, fine-tune, R&D — ยังไม่เหมาะ serve |
| **Local model** | ⚠️ **เป็น dev/privacy** | ใช้ในเครื่อง, ต้อง fine-tune + แก้ไทยก่อน |

**คำแนะนำตามแผน 3 ชั้นของคุณ:**
- ใช้ **API (DeepSeek)** เป็น baseline/serve หลัก (Ready) ✅
- ใช้ **Cloud GPU (Colab)** เป็น **training farm** (QLoRA) — เหมาะกับจุดที่ GPU ทำงานชิ้นเดียวจบ ไม่ใช่ serve ต่อเนื่อง
- **Local model** เป็นเป้าหมายสุดท้าย — ต้อง fine-tune + แก้การบังคับไทย + ต้องการเครื่อง GPU

---

## 📋 รายการสิ่งที่ต้องปรับเพื่อให้พร้อมสลับได้ครบ (Priority)

| # | งาน | เหตุผล | Priority |
|---|-----|--------|----------|
| 1 | เพิ่ม retry/backoff + cost cap ใน `llmClient.js` | API-ready 100% | P1 |
| 2 | แก้ system prompt ให้บังคับ "ตอบไทยเท่านั้น" ชัดเจน | Local/Cloud GPU ตอบไทย | **P0** |
| 3 | เพิ่ม config validation (URL/model/key) ตอน startup | ป้องกัน config ผิดเงียบ | P1 |
| 4 | เพิ่ม provider failover (หลัก→สำรอง) | tunnel/API ล้มไม่ตาย | P1 |
| 5 | ใช้ named tunnel ที่เสถียร (ไม่ใช่ quick tunnel) | Cloud GPU ใช้ได้จริง | P2 |
| 6 | เพิ่ม health check ของ provider ก่อนใช้ | สลับอัตโนมัติ | P2 |

---

*รายงานนี้จัดทำโดย lead โดยตรง (read-only) เนื่องจาก infrastructure ของทีมย่อยมี auth error ระหว่างการรัน*