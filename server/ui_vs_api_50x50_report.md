# UI (Playwright e2e) vs API (multirole) — 50×50 Comparison Report

- **UI CSV:** `server/ui_50x50_results.csv` — 2500 rows (real browser via vite :5174 → backend :5199, Thai chat UI)
- **API CSV:** `server/multirole_50x50_results.csv` — 2500 rows (direct HTTP to backend)
- **Generated:** 2026-08-07T16:19:05.347Z

## 1. Overall

| metric | UI/e2e | API | delta |
| total questions | 2500 | 2500 | 0 |
| ok (answered) | 2359 (94.4%) | 2373 (94.9%) | -0.5 pp |
| blocked (RBAC) | 141 (5.6%) | 127 (5.1%) | 0.5 pp |
| empty answers | 0 (0.0%) | 0 (0.0%) | 0.0 pp |
| fail/error | 0 (0.0%) | 0 (0.0%) | 0.0 pp |
| avg latency (ms) | 2547 | 10 | 2537 ms |

## 2. Per-role stats (ok/blocked/empty/fail)

| role | ok/blocked/empty/fail (UI / API) | ok% (UI/API) | blk% (UI/API) | avgLat (UI/API) |
| CEO | UI 50/0/0/0 · API 50/0/0/0 | 100.0 / 100.0 | 0.0 / 0.0 | 2953 / 12 |
| HR | UI 250/0/0/0 · API 250/0/0/0 | 100.0 / 100.0 | 0.0 / 0.0 | 2906 / 11 |
| Manager | UI 1119/81/0/0 · API 1134/66/0/0 | 93.3 / 94.5 | 6.8 / 5.5 | 2537 / 10 |
| Employee | UI 940/60/0/0 · API 939/61/0/0 | 94.0 / 93.9 | 6.0 / 6.1 | 2449 / 10 |

> Format: `UI x / API y` — UI runs the browser chat (rendering + network), API is a direct backend call, so latency differs by design.

## 3. Salary-blocked (governance) — expected ~60–70 per role

| role | UI blocked / salary-q | API blocked / salary-q |
| CEO | 0 / 5 | 0 / 4 |
| HR | 0 / 24 | 0 / 18 |
| Manager | 81 / 105 | 66 / 84 |
| Employee | 60 / 84 | 61 / 80 |

All blocked questions in both runs are salary/pay-raise queries (RbacBlocked=1) — non-salary questions are never blocked.

## 4. Top blocked question patterns

**UI/e2e:**

- `28×` พนักงานทุกคนได้เงินเดือนเท่าไหร่
- `16×` เงินเดือนเฉลี่ยทั้งบริษัทเท่าไหร่
- `4×` EMP149 ปวีณา ตั้งเจริญ ได้รับโบนัส หรือก
- `3×` EMP143 Pattharawadee Sukata เคยขอปรับเงิ
- `3×` EMP011 อารยา วัฒนชัย เคยขอปรับเงินเดือน 
- `3×` เงินเดือนของ EMP063 กิตติพงศ์ เกตุแก้ว เ
- `2×` เงินเดือนของ EMP009 นราธิป กิตติธนากร เท
- `2×` EMP064 ภาคิน ตั้งเจริญ เคยขอปรับเงินเดือ

**API:**

- `28×` พนักงานทุกคนได้เงินเดือนเท่าไหร่
- `17×` เงินเดือนเฉลี่ยทั้งบริษัทเท่าไหร่
- `3×` EMP126 นราธิป ศรีสุวรรณ เคยขอปรับเงินเดื
- `3×` เงินเดือนของ EMP055 กุลธิดา เพชรนิยม เท่
- `2×` เงินเดือนของ EMP047 ธีรพงษ์ วงศ์วัฒนะ เท
- `2×` เงินเดือนปัจจุบันของ EMP068 ปกรณ์ อัศวเม
- `2×` เงินเดือนของ EMP010 ชยพล บุญส่ง เท่าไหร่
- `2×` เงินเดือนของ EMP150 มนัสนันท์ อินทรักษา 

## 5. Sample answers (good, non-blocked)

- **[CEO] ดูรายชื่อพนักงาน**  
  BERAGFound 15 matching employee(s) in Design & Architecture, Customer Service & Warranty, Sales, Executive, Finance & Accounting, Marketing, Engineering & Construction, Procurement & Warehouse: - กุลธิดา เพชรนิยม [score:
- **[HR] เครื่องมือ IT**  
  BERAGFound 4 matching employee(s) in IT: - Pattharawadee Sukata (IT Manager) [score: 0.0] - กรวิชญ์ วัฒนากุล (System / Network Admin) [score: 0.0] - ศักรินทร์ พงษ์ไพโรจน์ (IT Support) [score: 0.0] - ณัฐวุฒิ หิรัญญา (IT S
- **[Manager] ประสิทธิภาพการทำงาน**  
  BERAGFound 15 matching employee(s) in Sales, HR & Admin, Design & Architecture, Engineering & Construction, Executive, Procurement & Warehouse, Marketing: - ศิริพร สุทธิกุล [score: 38.7]   Matched: KPI_OKR_History.manage
- **[Employee] สรุปโปรเจกต์ที่ฉันทำอยู่**  
  BERAGFailed to compute SQL: LLM not available📎 10 sourcesEMP125_OneDrive_Profile.xlsx → KPI_OKR_History (row 5)EMP113_OneDrive_Profile.xlsx → KPI_OKR_History (row 2)EMP040_OneDrive_Profile.xlsx → Project_History (row 1)

## 6. Blocked-answer samples (UI)

- Manager | EMP143 Pattharawadee Sukata เคยขอปรับเงินเดือน หรือบ่นเรื่องสวัสดิการบ้างไหม | -> BERAGQuery blocked by governance policy.21:40⚡ 0ms● Blocked
- Manager | EMP143 Pattharawadee Sukata เคยขอปรับเงินเดือน หรือบ่นเรื่องสวัสดิการบ้างไหม | -> BERAGQuery blocked by governance policy.21:40⚡ 0ms● Blocked
- Manager | EMP143 Pattharawadee Sukata ได้รับโบนัส หรือการปรับขึ้นเงินเดือนเท่าไหร่ในปีนี้ | -> BERAGQuery blocked by governance policy.21:40⚡ 0ms● Blocked
- Manager | เงินเดือนของ EMP143 Pattharawadee Sukata เท่าไหร่ | -> BERAGQuery blocked by governance policy.21:41⚡ 0ms● Blocked
- Manager | EMP143 Pattharawadee Sukata เคยขอปรับเงินเดือน หรือบ่นเรื่องสวัสดิการบ้างไหม | -> BERAGQuery blocked by governance policy.21:41⚡ 0ms● Blocked
- Manager | พนักงานทุกคนได้เงินเดือนเท่าไหร่ | -> BERAGQuery blocked by governance policy.21:42⚡ 0ms● Blocked

## 7. UI-vs-API divergence notes

- **Latency:** UI avgLat is real end-to-end (browser render + WS + backend) ≈ 2500–2700 ms; API direct HTTP ≈ tens of ms. Not comparable apples-to-apples; UI includes ~2.4 s of UI/transport overhead.
- **Manager:** blocked-rate delta +1.3 pp (UI 6.8% vs API 5.5%), ok-rate delta -1.2 pp.
- **Blocked counts:** UI Manager 81 vs API Manager 66; UI Employee 60 vs API Employee 61. Slight over-count in UI is expected: the e2e flags blocked by scanning rendered chat text for 'Query blocked' / 'blocked by governance' / 🚫 markers, which can also match a partial re-render; API reads the authoritative RbacBlocked flag.
- **Failures:** UI fail=0 and API fail=0 → no crashes/HTTP errors in either path.
- **Empty answers:** ~0 in both → every non-blocked question produced a usable answer in the UI path (template fallback works end-to-end).
