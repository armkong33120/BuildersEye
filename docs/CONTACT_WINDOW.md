# 📋 Contact Window — สถานะปัจจุบัน & ขั้นตอนถัดไป

> ไฟล์นี้เป็น "หน้าต่างติดต่อ" ระหว่างรอบทำงาน — บันทึกว่าตอนนี้ระบบอยู่ตรงไหน
> แล้วรอบหน้าจะทำอะไรต่อ เพื่อให้กลับมาทำงานต่อได้ทันทีโดยไม่ต้องไล่อ่านใหม่

อัปเดตล่าสุด: รอบงาน #4+#5 (ตัด legacy auth + แก้ log ซ้ำ)

---

## 1. สถานะปัจจุบัน (ณ หลังจบรอบล่าสุด)

### Infrastructure (Production — Azure)
| ส่วน | ที่อยู่ | สถานะ |
|------|--------|--------|
| Frontend | `https://builders-eye.vercel.app` | ✅ Live |
| 3D App | `/app.html` (+`?preview=1` = demo mode) | ✅ Live |
| Backend | Azure Container Apps `builderseye-backend...azurecontainerapps.io` | ✅ Live |
| Database | **Neon Postgres** (pgvector) — Source of Truth | ✅ Migrate 150 คน + 15,738 vectors |
| Monitor | Application Insights `appi-builderseye` | ✅ Live |
| CI/CD | GitHub Actions `deploy-aca.yml` (GHCR → ACA) | ⚠️ runner คิวแน่นบ่อย |

### ฟีเจอร์ที่ใช้งานได้ (verified)
- ✅ Auth **JWT-only** (ตัด legacy APP_API_KEY แล้ว — รอบนี้)
- ✅ RBAC: CEO/HR/Manager(subtree)/Employee(self) + redaction
- ✅ OneDrive sync (2 บัญชี × 75 ไฟล์) + Delta Query + **webhook (โค้ดพร้อม, รอ deploy)**
- ✅ Dynamic Employee Registry (schema drift ไม่พัง, คนเข้า-ออก lifecycle)
- ✅ Hybrid search (keyword RRF + vector) + LLM rerank + HyDE
- ✅ Semantic search ภาษาไทย (e5-small local, 15,738 chunks)
- ✅ E2E **17/17 ผ่าน**
- ✅ Retrieval eval: **Recall 100%** (person-bias + index-doc filter)
- ✅ Landing page warmup + keep-warm job 08:00–21:00 ไทย
- ✅ Preview/Demo mode + Test credentials + Tour guide

---

## 2. รอบล่าสุดทำอะไรไป (ติดต่อจากรอบก่อน)

| # | งาน | ผล |
|---|-----|-----|
| 4 | **ตัด legacy APP_API_KEY** | ✅ `requireAuth` = JWT-only; เอาออกจาก `render.yaml`/`.env.example`/`main.js`; x-api-key → 401 |
| 5 | **App Insights log ซ้ำ** | ✅ ปิด `setAutoCollectConsole` → ใช้ `trackAudit()` explicit (customEvents สะอาด ไม่ซ้ำ) + `flushAudit()` บน shutdown |

### ไฟล์ที่แก้รอบนี้
- `server/index.js` — auth JWT-only, `resolveViewer` ไม่อ่าน `req.body` อีกต่อไป, login audit → `trackAudit`
- `server/appInsightsSetup.js` — console capture off + export `trackAudit/trackMetric/flushAudit`
- `src/main.js` — เอา `VITE_APP_API_KEY`/`builderseye_app_key` fallback ออก, ข้อความ error ชี้ Azure
- `render.yaml`, `server/.env.example` — ลบ legacy key config, เพิ่ม webhook/Neon/AppInsights section

---

## 3. สิ่งที่ยังค้าง (ต้องทำต่อ)

### 🔴 รอการกระทำจากคุณ (มนุษย์)
| # | งาน | ต้องการอะไร |
|---|-----|-------------|
| 7 | **Azure OpenAI approval** | กด request ใน Azure portal (เจ้าของ subscription ต้องทำเอง) |
| 8 | (ถ้าตัดสินใจ) OneDrive token บน cloud — **webhook ต้องการให้ cloud sync เอง** | อนุมัติ privacy: token เก็บใน Neon (ปัจจุบัน token อยู่ local ตาม policy เดิม) |

### 🟡 รอ GitHub runner คิวปล่อย deploy
| งาน | หมายเหตุ |
|-----|----------|
| Deploy main (มี Neon + retrieval + webhook ครบ) | คิวแน่นบ่อย — รอบก่อน ๆ ถูก cancel (steps=0) เพราะรอเกิน 40 นาที |

### 🟢 ผมทำได้ทันที (ยังไม่ได้เริ่ม)
| # | งาน | effort |
|---|-----|--------|
| 3 | ปุ่ม Sync + Registry status บนหน้าเว็บ (CEO/HR กดได้) | ~1 ชม. |

### 📦 ตัดไว้ตามสั่ง (จอดอยู่ ไม่ทำต่อ)
- **Flywheel**: train-pair → QLoRA → promote gate (eval harness พร้อมใช้เป็น gate แล้ว)
- **Enterprise**: `Files.Read.All` 150 บัญชีจริง + admin consent, Teams Bot

---

## 4. ขั้นตอนถัดไป (ลำดับแนะนำ)

1. **Commit + push รอบนี้** (#4+#5) → รอ GitHub คิว deploy ขึ้น cloud
2. รอ/ช่วยปล่อยคิว — ถ้า deploy ถูก cancel ซ้ำ ให้ rerun workflow หรือ push เปล่า trigger ใหม่
3. หลัง cloud ขึ้น: ทดสอบ login จริงบน ACA (JWT only — ตรวจว่า frontend เก่าไม่มี legacy key ค้าง)
4. ทำ #3 (ปุ่ม Sync UI) ระหว่างรอ
5. ตัดสินใจ #8 (webhook privacy) → ถ้า approve เปิด webhook ตัวจริง + renew subscription

---

## 5. วิธีตรวจสอบสถานะ (คำสั่ง/URL)

```bash
# Health (backend)
curl -s https://builderseye-backend.wittybush-d59275bd.southeastasia.azurecontainerapps.io/api/health

# Login จริง (JWT)
curl -s -X POST <BACKEND>/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"ceo","password":"CEO@Landyi2026"}'

# ดู deploy CI/CD
cd "AI Test/mail-onedrive-org-graph" && gh run list --workflow deploy-aca.yml --limit 3

# ทดสอบ E2E (local)
cd server && node test_registry_e2e.js
```

---

## 6. หมายเหตุสำคัญ (สิ่งที่ห้ามลืม)

- **`ENABLE_TEST_CREDS=true` ยังเปิดอยู่** (สำหรับ demo) — ต้องตั้ง `false` ก่อนใช้งานจริง
- **Vercel ยังมี env เก่า** `VITE_APP_API_KEY` ค้างอยู่ (ไม่ถูกใช้แล้วหลังตัด) — ลบได้เมื่อสะดวก
- **Render service ยังเปิดอยู่** เป็น standby — ลบทิ้งได้เมื่อมั่นใจ Azure อยู่ตัว
- $100 Azure credit: ใช้ไป ~$0-2/เดือน ยังเหลืออีกมาก
