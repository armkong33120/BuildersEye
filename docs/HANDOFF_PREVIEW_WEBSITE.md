# 🎯 HANDOFF — สร้างหน้า "Preview Website" ของ BuildersEye

> **เอกสารนี้คือชุดมอบหมายงาน (handoff package) สำหรับ AI/นักพัฒนาอีกตัว** ให้สร้างหน้าเว็บ **Preview / Showcase** ของระบบ BuildersEye โดยไม่ต้องไล่อ่านเอกสารย่อยทั้งหมด
>
> **อ่านไฟล์นี้ไฟล์เดียวก็พอ** — รวมทุกอย่างที่ต้องรู้ไว้แล้ว

---

## 0. TL;DR — ต้องสร้างอะไร

สร้าง **หน้าเว็บแนะนำระบบ (Showcase / Landing / Preview site)** สำหรับ **BuildersEye** — ผู้ช่วยวิเคราะห์ HR แบบ 3D Org-Graph + AI Chat

หน้าเว็บนี้ **ไม่ใช่ตัวแอปจริง** (ตัวแอปจริงทำเสร็จแล้ว ดูส่วนที่ 2) แต่เป็น **หน้านำเสนอ** ที่อธิบายว่า:
- ระบบนี้คืออะไร สร้างมาเพื่ออะไร
- มีฟีเจอร์อะไรบ้าง (พร้อมภาพ/diagram)
- ใช้ Tech Stack อะไร
- ถ้าพัฒนาต่อจะได้อะไร (roadmap + flywheel)
- **ให้ผู้ชมกดเข้าไปทดลองใช้แอปจริงได้** (พร้อมบัญชีทดสอบ)

**เป้าหมายผู้ชม:** ผู้บริหาร / HR / นักลงทุน / ทีม dev ที่อยากเข้าใจระบบใน 2-3 นาที

---

## 1. บริบท — BuildersEye คืออะไร

**BuildersEye = Org-Graph Intelligence** — ระบบวิเคราะห์โครงสร้างองค์กร + HR ด้วย AI

ชูแนวคิด 3 อย่าง:
1. **RAG เหนือ Org-Graph** — ถามภาษาไทย/อังกฤษ → ดึงข้อมูลจากไฟล์ Excel HR 160 ไฟล์ (โปรไฟล์พนักงาน, โปรเจกต์, KPI/OKR, defect, กฎหมาย) → ตอบด้วยบริบทจริง ไม่ hallucinate
2. **3D Visualization** — พนักงาน 150 คนเรียงเป็นพีระมิด 4 ชั้น ตามสายบังคับบัญชา + ระดับอาวุโส → เห็นโครงสร้างในพริบตา
3. **Role-Based Access (RBAC)** — แต่ละตำแหน่งเห็นข้อมูลเฉพาะสิทธิ์ตน (CEO เห็นหมด / HR เห็น HR / Manager เห็นลูกน้อง / Employee เห็นตัวเอง)

### ใครได้ประโยชน์
| กลุ่ม | ใช้ทำอะไร |
|-------|----------|
| **CEO** | ภาพรวม KPI/OKR, ความเสี่ยง retention, การสืบทอดตำแหน่ง |
| **HR** | ค้นโปรไฟล์, วิเคราะห์ผลงาน 360°, วางแผนกำลังคน |
| **Manager** | ตามผลงานทีม, ตรวจ project backlog, ดู warning |
| **พนักงาน** | ดูผลงานตัวเอง, โปรเจกต์ตัวเอง, ข้อควรปรับปรุง |

---

## 2. ✅ สิ่งที่ "ทำเสร็จแล้ว" (ตัวแอปจริง — ห้ามสร้างซ้ำ)

> ส่วนนี้ **สร้างเสร็จและ deploy จริงแล้ว** AI ที่รับงาน **ไม่ต้องสร้างใหม่** แค่ **อ้างอิง/ลิงก์ไป** เท่านั้น

### 2.1 Live URLs (ใช้งานได้จริง)
| ส่วน | URL |
|------|-----|
| **Frontend (แอปจริง)** | `https://builders-eye.vercel.app` |
| **Backend API** | `https://builderseye-backend.onrender.com` |
| Health check | `https://builderseye-backend.onrender.com/api/health` |

### 2.2 ฟีเจอร์ที่มีอยู่แล้วในแอปจริง
| ฟีเจอร์ | รายละเอียด |
|---------|-----------|
| **3D Org Graph** | three.js, 150 nodes, 4 layers (CEO→C-Level→Manager→Staff), กระจายตามอาวุโส, คลิก node ดูรายละเอียด + ลิงก์ Excel ต้นฉบับ |
| **RAG Chat** | UI แบบ ChatGPT/Claude (bubble, avatar, typing indicator), ถามไทย/อังกฤษ, node ที่เกี่ยวข้อง **กระพริบบนกราฟ** |
| **JWT Auth + RBAC** | login จริง 150 บัญชี, role CEO/HR/Manager/Employee, policy กรองข้อมูลตามสิทธิ์, refresh token |
| **Conversation History** | เก็บ/โหลด/ลบบทสนทนาย้อนหลัง |
| **Tour Guide** | แนะนำการใช้งาน 5 ขั้นตอนสำหรับผู้ใช้ครั้งแรก |
| **Test Credentials Panel** | หน้า login มีปุ่มเลือกตำแหน่งทดสอบ (เปิดด้วย `?preview=1`) |
| **Responsive** | รองรับ Desktop / Tablet / Mobile (3 breakpoints) |
| **LLM** | ใช้ DeepSeek API (ผ่าน env `LLM_BASE_URL`/`LLM_MODEL`) — สลับเป็น local/Colab ได้ |

### 2.3 สถาปัตยกรรมที่มีอยู่ (อ้างอิงสำหรับ diagram)
- **Frontend:** Vite + vanilla JS + three.js + CSS ธรรมดา → deploy บน **Vercel**
- **Backend:** Node.js + Express → deploy บน **Render** (free tier)
- **LLM:** OpenAI-compatible client (`server/llmClient.js`) → ชี้ไป DeepSeek / Ollama / Colab ได้
- **Auth:** JWT (jsonwebtoken + bcryptjs), file-based store (`server/authStore.js`)
- **Data:** ไฟล์ Excel ใน `src/data/hr_onedrive_demo/` + `identity-graph.json` (150 คน)
- **Policy/RBAC:** `server/policy.js` (CEO/HR/Manager/Employee)

---

## 3. ❌ สิ่งที่ "ยังไม่ได้ทำ" = งานของคุณ (The Deliverable)

> **นี่คือสิ่งที่ต้องสร้าง** — หน้า Preview/Showcase Website

สร้างหน้าเว็บ (single-page หรือ multi-section) ที่มีส่วนประกอบต่อไปนี้:

### 3.1 โครงหน้าเว็บที่ต้องสร้าง
| # | Section | เนื้อหา |
|---|---------|--------|
| 1 | **Hero** | ชื่อระบบ "BuildersEye" + tagline + ปุ่ม "ทดลองใช้งาน" (ลิงก์ไปแอปจริง) + ภาพ/แอนิเมชัน 3D graph |
| 2 | **ระบบนี้คืออะไร** | 3 แนวคิดหลัก (RAG / 3D / RBAC) + ใครได้ประโยชน์ |
| 3 | **Live Demo / Features** | แสดงฟีเจอร์เด่น (3D graph, chat, node กระพริบ, RBAC) — screenshot หรือ embed |
| 4 | **System Flow / Architecture** | diagram การทำงาน (ใช้จากส่วนที่ 4 ด้านล่าง) |
| 5 | **Tech Stack** | แสดงเทคโนโลยีทั้งหมด (ใช้จากส่วนที่ 4) |
| 6 | **Roadmap / คุณค่าต่อยอด** | ตาราง compounding value + Self-Improvement Flywheel (ส่วนที่ 4) |
| 7 | **ทดลองใช้งาน (Try it)** | บัญชีทดสอบ (ส่วนที่ 5) + ปุ่มเข้าแอปจริง |
| 8 | **Footer** | ลิงก์, credit, หมายเหตุ demo |

### 3.2 ข้อกำหนดสำคัญ
- **เป็นหน้า static/presentational** — ไม่ต้องเชื่อม backend จริง (ยกเว้นปุ่มลิงก์ไปแอปจริง)
- **Responsive** — รองรับมือถือ/แท็บเล็ต/เดสก์ท็อป
- **โทน dark** ให้เข้ากับแอปจริง (ดูส่วนที่ 6 design system)
- **ไทยเป็นหลัก** (ผสมอังกฤษในศัพท์เทคนิคได้)
- เปิดด้วย static hosting ได้ (Vercel/Netlify/GitHub Pages) — แยกจากแอปจริงหรือเป็น path ย่อยก็ได้

### 3.3 สิ่งที่ "ไม่ต้อง" ทำ
- ❌ ไม่ต้องสร้าง 3D graph จริง (ใช้ภาพ/screenshot/gif แทน)
- ❌ ไม่ต้องทำ auth/login จริง (ลิงก์ไปแอปจริงที่มี login อยู่แล้ว)
- ❌ ไม่ต้องเชื่อม LLM/backend (ยกเว้นอยากโชว์ badge สถานะจาก `/api/health`)

---

## 4. 📦 เนื้อหาที่ต้องใส่ (copy-paste ไปใช้ได้)

### 4.1 คุณค่าการพัฒนาต่อยอด (Compounding Value)
| ระยะ | ได้อะไร | มูลค่า |
|------|---------|--------|
| ตอนนี้ | RAG + 3D graph + role access | เร็วกว่าค้น Excel เอง ~10x |
| + Auth/Login | ทุกคนเข้าด้วยบัญชีตัวเอง ปลอดภัยตามสิทธิ์ | ลดเสี่ยงข้อมูลรั่ว |
| + Fine-tune (QLoRA) | model เก่งภาษา HR ไทยปนอังกฤษ ไม่ต้องจ่าย API | ลดต้นทุนต่อเนื่อง |
| + Realtime sync | ข้อมูลอัปเดตจากไฟล์ HR รายวันอัตโนมัติ | ข้อมูลสดตลอด |
| + Dashboard/Analytics | กราฟเทรนด์ KPI, attrition, risk | ตัดสินใจเชิงกลยุทธ์ |
| + Mobile PWA | ใช้บนมือถือได้ | เข้าถึงทุกที่ |

### 4.2 System Flow (ใช้วาด diagram ในหน้า Architecture)

**Flow หลัก (ผู้ใช้ถาม → ตอบ):**
```
ผู้ใช้พิมพ์คำถาม (ไทย/อังกฤษ)
   │
   ▼
Frontend (Vercel) ──► Backend (Render /api/chat)
                          │
                          ▼
                   parse intent → search index + SQL + vector
                          │
                          ▼
                   anonymize (ซ่อนชื่อจริง → Employee_A) ←─ PII fence
                          │
                          ▼
                   policy.js กรองตาม role (CEO/HR/Manager/Employee)
                          │
                          ▼
                   LLM (DeepSeek / Ollama / Colab GPU) ตอบ
                          │
                          ▼
                   de-anonymize (คืนชื่อจริงฝั่ง server)
                          │
                          ▼
            ผู้ใช้เห็นคำตอบ + node ที่เกี่ยวข้องกระพริบบน 3D graph
```

**Brain Selector (เลือกสมอง LLM ได้ 3 แบบ):**
```
[A] Frontier API   [B] Local LLM      [C] Colab GPU
 DeepSeek/GPT      Ollama             Ollama/vLLM บน T4
 (เสถียร, มีค่าใช้จ่าย)  Qwen2.5-7B/Typhoon   (เร็ว, ชั่วคราว)
      │             (ฟรี, ลับ)            │
      └────────┬───────────┬──────────────┘
               ▼           ▼
        LLM_CONFIG {base_url, model, api_key}
               ▼
        llmClient.js เรียกสมองที่เลือก
```

### 4.3 Self-Improvement Flywheel (หัวใจของระบบ — ยิ่งใช้ยิ่งเก่งยิ่งถูก)

> ยิ่งคนใช้มาก → ระบบยิ่งเก่ง + ยิ่งถูก → คนใช้มากขึ้น → เก่งขึ้นอีก

```
ผู้ใช้ถามคำถามจริง
   │
   ▼
Hybrid Brain: [A] Frontier API + [B] Local (เลือกสมองที่พร้อม/ถูกสุด)
   │
   ▼
เก็บ (query + answer) แบบ anonymize (PII fence)
   │
   ├─► ตั้งสมอง B (local) ให้ตอบคำถามที่มั่นใจ
   │
   ▼
เทรนทุกวันช่วงปิดปรับปรุง (QLoRA บน Colab/เครื่อง GPU)
   │
   ▼
ใช้ Frontier API ลดลง ←─ evaluate ผ่าน (A/B test)
   │
   ▼
ระบบตอบไวขึ้น + แม่นขึ้น + จ่าย API น้อยลง
```

**ตารางกลไก (ค่อยๆ ดีขึ้นตามการใช้งาน):**
| ช่วงการใช้งาน | สมองที่ตอบหลัก | Frontier API ที่ใช้ | ต้นทุน |
|---------------|----------------|---------------------|--------|
| วันแรก | A (Frontier) 100% | สูงสุด | สูงสุด |
| เก็บข้อมูล 2-4 สัปดาห์ | A ส่วนใหญ่ + B จับคำซ้ำ | ลด ~30% | ลดลง |
| หลัง fine-tune รอบแรก | B ตอบเอง ~60% | ลด ~60% | ลดมาก |
| เทรนทุกวันเรื่อยๆ | B ตอบเอง ~85-95% | เหลือเฉพาะคำใหม่/ยาก | ต่ำมาก |

**ข้อควรรู้ (สำคัญ):** training loop ใช้ข้อมูล **anonymized เท่านั้น** (กัน PII เจือ model) + มี **quality gate** (กัน model collapse)

### 4.4 Tech Stack (ใช้ในหน้า Tech Stack)

| หมวด | เทคโนโลยี |
|------|-----------|
| **Frontend** | Vite, Vanilla JS, three.js (3D), CSS3 (responsive) |
| **Backend** | Node.js, Express.js |
| **AI / LLM** | OpenAI-compatible API → DeepSeek (ปัจจุบัน) / Ollama (local) / Colab GPU (cloud) |
| **Auth** | JWT (jsonwebtoken), bcryptjs, RBAC 4 roles |
| **Data / RAG** | Excel (xlsx), AlaSQL (SQL), custom search index, vector embedding |
| **Privacy** | Anonymizer (PII masking ก่อนส่ง LLM) |
| **Deploy** | Vercel (frontend), Render (backend) — free tier |
| **อนาคต** | QLoRA fine-tune, PostgreSQL, Cloudflare Tunnel, PWA |

---

## 5. 🔑 บัญชีทดสอบ (สำหรับหน้า "ทดลองใช้งาน")

> แอปจริงมีระบบ login + RBAC แล้ว หน้า Preview ควรโชว์บัญชีตัวอย่างให้ผู้ชมกดเข้าไปลอง

### 5.1 วิธีให้ผู้ชมเข้าใช้
- **ลิงก์แอปจริง:** `https://builders-eye.vercel.app`
- **เปิดหน้า login พร้อมแผงบัญชีทดสอบ:** `https://builders-eye.vercel.app/?preview=1`
- หมายเหตุ: backend เป็น Render free tier → **ครั้งแรกอาจ cold start 30-60 วิ** (ระบบมี warmup อัตโนมัติแล้ว)

### 5.2 ตารางบัญชีทดสอบ (ตัวอย่างครบทุก role)
| Role | ตำแหน่ง | Username | Password |
|------|---------|----------|----------|
| **CEO** | CEO / Managing Director | `ceo` | `CEO@Landyi2026` |
| **Manager** | COO / CFO / CMO | `coo` `cfo` `cmo` | `Exec@2026test` |
| **Manager** | IT Manager | `it-manager` | `Exec@2026test` |
| **HR** | HR Manager | `hr-manager` | `HR@2026test` |
| **Employee** | พนักงานทั่วไป | `emp013` … `emp150` | `Emp@2026test` |

### 5.3 สิ่งที่แต่ละ role จะเห็นต่างกัน (โชว์ใน demo)
| Role | ถามเงินเดือนคนอื่น | เห็นข้อมูล |
|------|---------------------|-----------|
| CEO | ✅ ได้ | ทั้งหมด |
| HR | ✅ ได้ (HR records) | HR scope |
| Manager | ❌ blocked | เฉพาะลูกน้อง (subtree) |
| Employee | ❌ blocked | เฉพาะตัวเอง (self) |

> 💡 **จุดขาย demo:** ให้ลอง login เป็น Employee (`emp144`/`Emp@2026test`) แล้วถาม "เงินเดือน CEO เท่าไหร่" → ระบบจะตอบ *"Query blocked by governance policy"* → แสดง RBAC ทำงานจริง

### 5.4 API ดึงบัญชี (ถ้าอยากทำ dynamic)
- `GET https://builderseye-backend.onrender.com/api/preview/credentials` → คืนบัญชีทั้ง 150 (username/password/role/name/jobTitle)
- ⚠️ endpoint นี้เปิดเฉพาะ demo (`ENABLE_TEST_CREDS=true`) — **ปิดใน production จริง**

---

## 6. 🎨 Design System (ให้เข้ากับแอปจริง)

### สีหลัก
| ใช้ | ค่า |
|-----|-----|
| พื้นหลังหลัก | `#0d1117` (GitHub dark) |
| พื้นหลังรอง / card | `#161b22` |
| Accent หลัก (teal) | `#2dd4bf` |
| Accent รอง (blue) | `#1f6feb` |
| ข้อความหลัก | `#e6edf3` |
| ข้อความรอง | `#8b98a9` |
| Danger / error | `#f87171` |

### สี Role (ใช้แสดง badge)
| Role | สี |
|------|-----|
| CEO | `#f59e0b` (amber) |
| HR | `#a78bfa` (purple) |
| Manager | `#38bdf8` (sky) |
| Employee | `#34d399` (green) |

### สไตล์
- มุมโค้งมน (border-radius 12–20px)
- เงาเข้ม (box-shadow ดำ)
- ฟอนต์: system / sans-serif, อ่านไทยชัด
- โทนมืดสมัยใหม่ คล้าย ChatGPT/Claude/Gemini dark mode
- micro-animation เบาๆ (fade-in, hover lift, pop)

---

## 7. ✅ Acceptance Criteria (เช็กว่าสร้างเสร็จสมบูรณ์)

- [ ] มีครบ 8 sections ตามข้อ 3.1
- [ ] แสดง flow diagram (4.2) + flywheel (4.3) + tech stack (4.4)
- [ ] มีตารางบัญชีทดสอบ (5.2) + ปุ่มลิงก์ไปแอปจริง
- [ ] Responsive (มือถือ/แท็บเล็ต/เดสก์ท็อป)
- [ ] โทน dark ตาม design system (ส่วนที่ 6)
- [ ] ภาษาไทยเป็นหลัก อ่านเข้าใจง่าย
- [ ] โหลดเร็ว (static) ไม่มี backend dependency ที่จำเป็น
- [ ] **ไม่** สร้างซ้ำสิ่งที่มีแล้ว (ส่วนที่ 2)

---

## 8. 📚 เอกสารอ้างอิงเพิ่มเติม (ถ้าต้องการรายละเอียด)

| ไฟล์ | เนื้อหา |
|------|--------|
| `docs/PLAN_VISION.md` | วิสัยทัศน์ + flywheel + flow diagram เต็ม |
| `docs/PLAN_PREVIEW_TOUR.md` | preview design + test creds + tour guide |
| `docs/PLAN_AUTH.md` | ระบบ login + RBAC + บัญชี 150 |
| `docs/BRAIN_ROADMAP.md` | roadmap สมอง LLM 3 ชั้น |

---

**สรุปส่งมอบ:** สร้าง **หน้า Preview/Showcase Website** นำเสนอ BuildersEye (ส่วนที่ 3) โดยใช้เนื้อหา/สี/diagram ที่ให้ (ส่วนที่ 4-6) และลิงก์ไปแอปจริงที่ทำเสร็จแล้ว (ส่วนที่ 2) — อย่าสร้างซ้ำส่วนที่มีอยู่แล้ว
