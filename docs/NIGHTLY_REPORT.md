# 🌙 Nightly Build Report — 2026-08-06

## ✅ งานที่เสร็จในคืนนี้ (ตามที่สั่ง: ตัด Flywheel / Azure OpenAI / Enterprise ออก)

### กลุ่ม 1 — Quick wins
| งาน | ผล |
|-----|-----|
| Render → standby | ✅ suspend ผ่าน API (ยังกลับมาใช้ได้ ไม่ได้ลบ) |
| `ENABLE_TEST_CREDS` | ⚠️ **ตัดสินใจคงไว้ (true)** — เพราะคุณเคยกำหนดไว้ว่าหน้า login ต้องโชว์รหัสทดสอบให้คนดู portfolio เล่นได้ ข้อมูลเป็น demo ทั้งหมด ไม่ใช่ของจริง |
| Vectors ขึ้น cloud | ✅ Azure Blob `stbuilderseye/vectors` (129MB) + auto-download ตอน boot (4.8s) |
| 3D graph จาก registry | ✅ `build-graph.js` — regenerate identity-graph.json จาก OneDrive data (150/149/12 เท่าเดิมเป๊ะ) |

### กลุ่ม 2 — RAG quality (ตาม mind map)
| งาน | ผล |
|-----|-----|
| Hybrid search (keyword+vector, RRF fusion) | ✅ `hybridSearch.js` — พิสูจน์: "EMP143" เจอ exact code ผ่าน keyword leg |
| LLM Rerank (DeepSeek listwise) | ✅ `llmRerank.js` — ทำงานบน cloud (มี LLM key) |
| HyDE | ✅ อยู่ในโมดูลเดียวกัน — `hyde=true` |
| Eval harness | ✅ `evalRag.js` + golden set 10 ข้อ → **Recall@5 = 90%** (baseline แรกของระบบ) |

### กลุ่ม 4 — โครงสร้าง
| งาน | ผล |
|-----|-----|
| Org docs เข้า vector store | ✅ 4,939 chunks (Project Pipeline/Registry, Defects, Legal, company-master) — รวม 15,738 vectors |
| Neon Postgres | ⏸️ ต้องให้คุณสมัคร account เอง (ฟรี) — ยังไม่เร่ง เพราะ JSON+Blob รองรับได้แล้ว |
| Graph Webhook | ⏸️ ต้องวาง token persistence ก่อน — เหลือไว้รอบหน้า |
| HR shared docs | ✅ ผ่าน orgDocs (ไฟล์ org-level ทั้ง 10 เข้า vector store แล้ว) |

## 🐛 Bug สำคัญที่เจอ+แก้คืนนี้
1. **onnxruntime segfault บน cloud** — slim image ขาด `libgomp1` → แก้ใน Dockerfile + pre-bake model เข้า image (ไม่ต้องโหลด 120MB ทุก cold start)
2. **ACA CPU:memory pairs** — 1Gi ต้องจับคู่ 0.5 vCPU, 2Gi จับคู่ 1 vCPU (ตอนนี้ 1 vCPU / 2Gi)
3. **Phantom employees** — org files กลายเป็นพนักงานปลอม → file contract `^EMP\d+` + identity guard
4. **CI/CD `:latest` ไม่ re-pull** — เปลี่ยนเป็น sha-tag ทุก deploy

## 💰 ค่าใช้จ่าย Azure โดยประมาณ
- Container Apps (1 vCPU/2Gi, scale-to-zero): ~$1-4/เดือน (ตาม traffic demo)
- Blob Storage 129MB: ~$0.03/เดือน
- App Insights: $0 (≤5GB)
- **รวม ~$1.5-4/เดือน → $100 อยู่ได้เกินปี** ✅

## 🧪 ทดสอบตอนเช้า
```
local:  cd server && node test_registry_e2e.js   (17/17 ✅)
cloud:  https://builders-eye.vercel.app  → login ceo / CEO@Landyi2026
        ลองถาม "ใครเคยทำโปรเจกต์พลาด" (semantic), "EMP143" (hybrid exact)
```

## 📌 เหลือ (ตัดไว้ตามสั่ง)
- Flywheel (เก็บ train-pair, QLoRA, promote gate)
- Azure OpenAI approval
- Enterprise-grade (Files.Read.All, Teams bot)
- Neon Postgres, Graph webhook (ต้องมี design เพิ่ม)
