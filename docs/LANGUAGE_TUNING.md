# Language Tuning Report — Thai Output Control for Qwen2.5-7B / Local Models

**วันที่:** 5 สิงหาคม 2026
**ปัญหา:** เมื่อใช้ Qwen2.5-7B แทน DeepSeek พบว่า model **ตอบเป็นภาษาจีน** เมื่อ context/query มีคำอังกฤษปน (code-switching) โดยเฉพาะ query แบบ "average salary ของแผนก A กับ B" — ถึงแม้ system prompt มี rule "Answer in the same language as the question" ก็ไม่แรงพอ
**ขอบเขต:** วิเคราะห์ root cause + ออกแบบ prompt ที่แก้ปัญหา + แผน fine-tune + ชุดทดสอบ

---

## 🔍 R1 — Root Cause Analysis: ทำไม Qwen2.5-7B ตอบเป็นภาษาจีน?

### สาเหตุหลัก 3 ประการ

#### 1. **Token-level language bias** (สาเหตุหลัก)
- Qwen2.5 ถูก pre-train บนข้อมูล **จีน + อังกฤษ** เป็นหลัก (70-80%) — จึงมีภาษาแม่เป็นจีน
- เมื่อเจอคำอังกฤษใน query ("department A", "average salary") → **bias distribution ชี้ไปทางจีน** เพราะใน training data รูปแบบ "English word + Chinese translation" พบเยอะ
- ระบบปัจจุบันส่ง context เป็นอังกฤษ ("Employee_A has KPI 4.2...") + query ไทยปนอังกฤษ = **ไม่มีสัญญาณ "Thai" ที่แรงพอ**ให้ model เลือก

#### 2. **Instruction following ที่อ่อนกว่า DeepSeek**
- DeepSeek (~400B parameters) เก่งกว่า Qwen 7B มากในการ follow "Answer in the same language"
- 7B model ต้องการ instruction ที่ **direct + strong + explicit** มากกว่า (ไม่ใช่แค่ "rule ข้อหนึ่ง" ที่ซ่อนอยู่ใน list of rules)

#### 3. **System prompt structure อ่อนไปสำหรับ local 7B**
- ปัจจุบัน: `"1. Answer in the same language as the question (Thai if asked in Thai)"` — เป็น rule ข้อ 1 ใน 8 ข้อ
- **ข้อผิดพลาด:** มีข้อความอังกฤษเต็ม prompt (ชื่อระบบ, field names, company data) → reinforce English bias
- **สำหรับ 7B ต้อง:** ใส่ภาษาไทย direct ใน system message + few-shot examples + explicit negative constraint

### หลักฐานจากการทดสอบจริง
- **ถามแบบไทยล้วน ("สวัสดี")** → ตอบไทย ✅
- **ถามไทยปนอังกฤษ ("ค่า KPI ของแผนก IT เท่าไหร่")** → ตอบไทย ✅ (context บังคับไทย)
- **ถามอังกฤษหนัก ("compare average salary of department A vs B")** → **ตอบจีน** ❌ (เจอตอนทดสอบ)
- **เมื่อเพิ่ม prompt "ตอบภาษาไทยเท่านั้น ห้ามใช้ภาษาจีน"** → ตอบไทยล้วนถูกต้อง ✅

---

## 🎯 R2 — Improved Prompt Design (แก้ไขใน llmClient.js)

### หลักการ
1. **ภาษาไทยต้องเป็น "first-class citizen"** — เปิด prompt ด้วยภาษาไทย
2. **ห้ามจีน — explicit negative constraint** — อยู่ใน system message
3. **Few-shot examples** — แสดงรูปแบบ "คำถามไทยปนอังกฤษ → คำตอบไทย" ให้ model ดู
4. **rawSql mode แยกต่างหาก** — SQL ต้องเป็นอังกฤษ (ไม่เปลี่ยน)

### System Prompt ใหม่ (สำหรับ default mode — chat assistant)

```
คุณคือ BuildersEye — ผู้ช่วยวิเคราะห์ข้อมูลทรัพยากรบุคคล (HR Analytics) 
คุณต้องตอบเป็นภาษาไทยเท่านั้น ห้ามใช้ภาษาจีนเด็ดขาด 
Absolutley NO Chinese characters. If you see Chinese, delete and rewrite in Thai.

Context: {context}

Question: {query}

ตอบเป็นภาษาไทย กระชับ 2-3 ประโยค ใช้ข้อมูลจาก context เท่านั้น
- ใช้ Employee_A, Employee_B แทนชื่อจริง
- ถ้ามีคำอังกฤษ (KPI, bonus, IT) ให้คงไว้ได้ แต่ตอบไทย
```

### Few-shot examples (ใส่ไว้ใน system prompt)

```
ตัวอย่าง:
User: ใครได้ KPI สูงสุดในแผนก IT
Assistant: ผู้ที่ได้ KPI สูงสุดในแผนก IT คือวรพล สุวรรณกิจ (Employee_C) โดยมี KPI Score 4.8 ครับ

User: average salary ของแผนก IT เท่าไหร่
Assistant: ค่าเฉลี่ยเงินเดือนของแผนก IT อยู่ที่ 88,545.5 บาทครับ

User: เปรียบเทียบ KPI ของ department A กับ B
Assistant: เปรียบเทียบ KPI ระหว่างแผนก A และ B: แผนก A มีค่าเฉลี่ย KPI 4.00 (A1=4.2, A2=3.8) ส่วนแผนก B มีค่าเฉลี่ย 4.05 (B1=4.6, B2=3.5) — แผนก B สูงกว่าเล็กน้อยครับ

User: ใครได้ bonus มากที่สุด
Assistant: Employee_D ได้ bonus มากที่สุด โดยได้รับ 3 เดือน หรือคิดเป็นเงิน 183,000 บาทครับ
```

### แนวทางการใส่ในโค้ด
```
const systemPrompt = options.rawSql
  ? "...SQL prompt เดิม..."
  : [
      "คุณคือ BuildersEye — ผู้ช่วยวิเคราะห์ HR ตอบภาษาไทยเท่านั้น ห้ามจีน",
      "Absolutely NO Chinese characters. ONLY Thai.",
      "",
      "ตัวอย่าง (few-shot):",
      "Question: ใครได้ KPI สูงสุดในแผนก IT",
      "Answer: ผู้ที่ได้ KPI สูงสุดคือ...",
      ...
      "=== Context ===\n" + anonymizedContext,
      "=== คำถาม ===\n" + query
    ].join("\n");
```

---

## 🏗️ R3 — Prompt Structure Analysis (3 LLM Call Sites)

### Site 1: `generateAnswer()` — final chat answer
- **Path:** `chatController.js:96`
- **ปัจจุบัน:** ระบบ prompt with "Answer in same language..." rule
- **ปัญหา:** ใช้ภาษาอังกฤษ + context เป็นอังกฤษ → ไม่มีแรงบังคับไทยสำหรับ 7B
- **แนวทางแก้:** ใช้ภาษาไทยใน system prompt + few-shot + explicit Thai-only (ตาม R2)

### Site 2: `generateAnswer()` — rawSql mode (sqlEngine.js)
- **Path:** `sqlEngine.js:48`
- **ปัจจุบัน:** System prompt เป็นอังกฤษล้วน ("You are a SQL generation engine... No Thai text")
- **การวิเคราะห์:** rawSql **ไม่ควรเปลี่ยน** — SQL ต้องเป็นอังกฤษ ✅ (prompt บอก "No Thai text" ชัดเจนดี)
- **ข้อแนะนำ:** ไม่ต้องแก้ rawSql — ทำงานถูกต้องแล้ว

### Site 3: `semanticParser.parseIntentSemantically()` — JSON output
- **Path:** `semanticParser.js:30-114`
- **ปัจจุบัน:** Prompt เป็นอังกฤษล้วน + response_format json_object
- **การวิเคราะห์:** ใช้ `response_format: { type: "json_object" }` + temperature 0.0 → model ถูกบังคับให้ JSON → ไม่มีปัญหาเรื่องภาษา (JSON key เป็นอังกฤษ)
- **ข้อแนะนำ:** ไม่ต้องแก้ — JSON output ถูกบังคับโดย API แล้ว

### สรุปการปรับ
| Site | ต้องปรับ? | วิธี |
|------|----------|------|
| generateAnswer (default) | ✅ **ต้องปรับ** | ภาษาไทย + few-shot + no-Chinese |
| generateAnswer (rawSql) | ❌ ไม่ต้อง | SQL แล้ว "No Thai" |
---

## 🎓 R4 — QLoRA Fine-tuning Plan (ทางออกระยะยาว)

### Torn: prompt อย่างเดียวพอไหม?
- **พอสำหรับ dev/demo** — ใส่ system prompt ไทย + few-shot จะลดจีนได้มาก (ทดสอบแล้วว่า "ตอบไทยเท่านั้น" ช่วย)
- **แต่ยังไม่พอสำหรับ production** — 7B ยังอาจเพี้ยนใน query ซับซ้อน (กรองหลายเงื่อนไข) เพราะ model ไม่รู้บริบท HR ไทย

### แผน QLoRA fine-tuning (Qwen2.5-7B บน T4)
1. **สร้าง dataset:** เก็บชุด "คำถามไทยปนอังกฤษ → คำตอบไทย" (อย่างน้อย 200-500 ตัวอย่าง) จาก:
   - log ของระบบจริง (`train_pairs.jsonl` — ที่ audit R1/R4 แนะนำให้สร้าง)
   - ปรับ prompt ตัวอย่างใน R2 เป็น ground-truth
2. **Format training data (QLoRA):**
   ```json
   {"instruction": "ค่า KPI ของแผนก IT เท่าไหร่ ใครได้สูงสุด",
    "input": "Context: Employee_A kpi 4.2, Employee_B kpi 3.8 (IT)",
    "output": "ในแผนก IT พนักงานที่ได้ KPI สูงสุดคือ Employee_A โดยมี KPI score 4.2 ครับ"}
   ```
3. **Config:**
   - `base_model`: `Qwen/Qwen2.5-7B-Instruct`
   - `per_device_train_batch_size`: 1-2 (T4 15.6GB)
   - `num_epochs`: 3, `lr`: 2e-4 (LoRA), `gradient_accumulation`: 8-16
   - `lora_r`: 16, `lora_alpha`: 32, `target_modules`: q_proj, k_proj, v_proj
4. **รันบน Colab T4** (GPU พร้อมแล้ว — ติดตั้ง qwen2.5:7b เรียบร้อย)
5. **Serving:** Export ออกเป็น Ollama model ใหม่ → ใช้ `/v1` เดิม

### ทางเลือก: Typhoon-2-7B
- ฝึกมาเน้นไทยโดยเฉพาะ → **ตอบไทยสม่ำเสมอกว่า Qwen** โดยไม่ต้อง prompt แรง
- แต่ fine-tune ecosystem น้อยกว่า Qwen
- **ทางเลือกแนะนำ:** ใช้ Typhoon-2-7B ถ้าอยากได้ไทย-native, ใช้ Qwen ถ้าอยาก fine-tune ง่าย

---

## 🧪 R5 — Evaluation Harness (ชุดทดสอบภาษา)

### Test set (10 คำถามไทยปนอังกฤษ)
```
1. "มีพนักงานในแผนก IT กี่คน" → ตัวเลข
2. "ค่าเฉลี่ยเงินเดือนของฝ่ายขายเท่าไหร่" → ตัวเลขเงิน
3. "ใครได้ KPI สูงสุด" → ชื่อ/Employee_X + ค่า
4. "average bonus ของแผนก IT เท่าไหร่" → ตัวเลข
5. "ใครมา working ล่าช้า (late) มากที่สุด" → ชื่อ + ครั้ง
6. "เปรียบเทียบ KPI ของ department A กับ B" → เปรียบเทียบ
7. "total travel expense ของทั้งบริษัท" → ตัวเลขรวม
8. "ใครมี formal warning มากที่สุด" → ชื่อ + จำนวน
9. "แผนกไหนได้ revenue สูงสุด" → แผนก + ตัวเลข
10. "สรุปผลงานของแผนก IT ให้หน่อย" → สรุปไทย
```

### การตรวจอัตโนมัติ (Python)
```python
import re
CJK = re.compile(r'[\u4e00-\u9fff\u3400-\u4dbf]')  # จีน
THAI = re.compile(r'[\u0E00-\u0E7F]')               # ไทย
def check_lang(text):
    has_cjk = bool(CJK.search(text))
    has_thai = bool(THAI.search(text))
    return {"chinese_detected": has_cjk, "thai_present": has_thai,
            "pass": not has_cjk and has_thai}
```

### Scoring rubric (1-5)
- **ภาษา (Language):** 5=ไทยล้วน, 3=มีอังกฤษคำศัพท์แปลก, 1=จีน/ต่างชาติ
- **เนื้อหา (Content):** 5=ถูกต้องครบ, 3=ถูกบางส่วน, 1=ผิด
- **กระชับ (Concision):** 5=สั้นตรงประเด็น, 3=ยาวเฟ้อ, 1=ไม่เกี่ยวข้อง

### A/B worklow
1. ตั้ง `LLM_BASE_URL` = DeepSeek → รัน 10 queries → save result_deepseek.json
2. ตั้ง `LLM_BASE_URL` = Qwen tunnel → รัน 10 queries → save result_qwen.json
3. เปรียบเทียบด้วย rubric → เลือก winner ต่อ query

---

## ✅ สรุป

| ชั้น | Solution | ระดับ | ใช้เวลา |
|-----|----------|-------|---------|
| **Prompt fix (ทันที)** | ภาษาไทยใน system prompt + few-shot + no-Chinese | ✅ แก้ตอนนี้ | 30 นาที |
| **Config** | ใช้ Typhoon-2-7B (ไทย-native) แทน Qwen | ⚠️ พิจารณา | 10 นาที |
| **Fine-tune** | QLoRA บน T4 ด้วย dataset ไทย HR | ✅ แก้ถาวร | 1-3 ชม. |
| **Test harness** | ตรวจอัตโนมัติ (CJK + Thai regex) + A/B | ✅ ต่อเนื่อง | 1 ชม. |

**ลำดับแนะนำ:**
1. 🔥 **แก้ prompt ตอนนี้** (ใช้ได้ทันทีทั้ง Qwen และ DeepSeek)
2. สร้าง test harness + ตรวจ A/B
3. ถ้าผลยังไม่ดี → QLoRA fine-tune หรือสลับเป็น Typhoon-2-7B

---

## 📋 ไฟล์ที่ต้องแก้เมื่อเริ่ม implementation (ยังไม่ได้แก้)
| ไฟล์ | จุดแก้ |
|------|--------|
| `server/llmClient.js` | system prompt default mode → ไทย + few-shot (ตาม R2) |
| `docs/BRAIN_ROADMAP.md` | เพิ่ม task นี้ |
| `server/.env` / Render | (ไม่ต้อง — prompt ในโค้ด) |

---

*รายงานนี้จัดทำโดย lead โดยตรง (read-only) เนื่องจาก infrastructure ของทีมย่อยมี auth error ระหว่างการรัน*
| semanticParser | ❌ ไม่ต้อง | JSON + temperature 0.0 เหมาะสมแล้ว |