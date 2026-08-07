# DESIGN.md — 360-Degree Digital Twin & Time-Series Logs (Phase 1: Global Graph)

> ผู้เขียน: Lead Data Engineer / Storyline Architect · ไฟล์ชุดนี้: `tools/upgrade_360/design/`
> สถานะ: **Design / Phase 1** — ปูโครงสร้างให้ Phase 2 (row generation) และ Phase 3 (RAG indexing) ใช้ต่อ
> วันที่: 2026-08-07 · บริษัท: BuildersEye (demo, 40 ปี, พนักงาน 150 คน)

---

## 1. เป้าหมาย (Goals)

อัปเกรด Excel พนักงาน 150 คน (23 sheets ต่อคน) จาก **ข้อมูลแถวเดียว/รายการเล็กๆ** ให้เป็น
**log timeline 300–500 rows/คน** ที่เชื่อมโยงข้ามคนผ่านคีย์ร่วม **`eventId` + `logDateTime`** เดียวกันทั้ง 2 ฝั่ง
เพื่อให้ RAG/Graph RAG ตอบคำถามเชิงลึกได้ เช่น
*"วรพลกับภาคินเคยมีปัญหาอะไรกับใครบ้าง มีหลักฐานใน sheet ไหน และเกี่ยวข้องกับฮั้วประมูลหรือไม่"*

Deliverables ของเฟสนี้ (3 ไฟล์):
| ไฟล์ | บทบาท |
|---|---|
| `DESIGN.md` (ไฟล์นี้) | schema ของคอลัมน์ใหม่ใน 23 sheets + หลักการเชื่อมโยง + storyline components |
| `relationship_matrix.json` | sparse graph ของคู่คน 2,194 คู่ + faction + eventIds ที่คู่นั้นเกี่ยวข้อง |
| `storyline_catalog.json` | แคตตาล็อกเหตุการณ์ 101 รายการ (ดี/ร้าย/วิกฤต/การเมือง/grey area) |

---

## 2. ข้อมูลอ้างอิง (Sources — อ่านเพื่อความ consistent)

| Source | รายละเอียด |
|---|---|
| `src/data/identity-graph.json` | 150 คน: pk, code, name, department, jobTitle, managerPk, directReportPks, hierarchyDepth |
| `src/data/collaboration-graph.json` | 5,331 rows, 551 rows มี `hasConflict=true` (ใช้ weighting การเลือกคู่ + ใช้ summary เดิม) |
| `src/data/warning-history.json` | 291 คดี (caseId, caseType, severity, summary) |
| `src/data/grievance-log.json` | 10 เรื่องร้องทุกข์ (Complaint_Type, Status) |
| `src/data/master-index.json`, `career-story-plan.json` | hireDate, tenure, promotionCount, hrRiskLevel |
| `scripts/build_excel_files.py` | schema เดิมของ 23 sheets (อ้างอิงคอลัมน์เดิม) |

**ข้อเท็จจริงที่ผูกการออกแบบ:**
- พนักงานทั้งหมด join ปี 2015+ → เหตุการณ์ **1997/2011** เป็น "เหตุการณ์มรดกองค์กร" (company legacy / survivor narrative)
  ไม่ใช่ timestamp จริงของคนปัจจุบัน → Phase 2 ต้องใช้ `logType=legacy_context` สำหรับช่วงก่อน 2015
  และใช้ timestamp จริงสำหรับเหตุการณ์ 2015+ / ongoing
- นามสกุลไทยซ้ำกันเป็นระบบ (40 กลุ่ม, 3–4 คน/กลุ่ม) → ใช้เป็นฐานของความสัมพันธ์ **family** (สมจริง + ใช้ข้อมูลจริง)
- HR confidentiality: ฝ่ายบริหาร/HR/IT/การเงิน หลายคนเป็น Tier 1 → บางแถวควรมี `redactionRequired=true`

---

## 3. หลักการเชื่อมโยง (Linking Principles)

1. **Sparse graph:** เลือกคู่คนเพียง ~19.6% (2,194 จาก 11,175 คู่ที่เป็นไปได้) — ไม่ใช่ 150×150 แน่น
2. **Bidirectional (ทุกคู่มีทั้งสองทิศ):** แต่ละคู่เก็บ **1 edge** (a<b เสมอ) ใน matrix
   → เมื่อ Phase 2 สร้างแถว จะแตกเป็น **2 แถว** ใน `Collaboration_Network` ของแต่ละคน (ฝั่งละแถว)
   ใช้ `eventId` + `logDateTime` เดียวกัน ⇒ "ถ้า A ทะเลาะกับ B ต้องมี B ทะเลาะกับ A" เป็นจริงเสมอ
3. **ทุกคู่มีบริบท/ทิศทาง:** `relationship` ∈ {conflict, collusion, friendship, mentorship, work_partner, family}
   + `faction` ∈ {old_guard, new_guard, cross_old_new, neutral_mixed}
4. **ทุก event ต้องมี eventId + timestamp เดียวกันทั้ง 2 ฝั่ง** — `eventIds[]` ใน matrix เป็นสัญญาผูกมัด
   ที่ Phase 2 ต้อง generate แถวคู่กัน
5. **"ไม่ต้องเยอะแต่มั่นใจว่าเชื่อมโยง":** เน้น 101 เหตุการณ์คุณภาพสูงที่มี keyPairCodes ชัดเจน
   มากกว่าเหตุการณ์จ้ำจี้ 500 รายการที่เชื่อมโยงไม่ครบ

---

## 4. ตัวเลขเป้าหมาย (Target Numbers — วัดจากไฟล์จริง)

| Metric | เป้าหมาย | ค่าจริง (ไฟล์ที่ generate) |
|---|---|---|
| pairs (คู่คน) | 1,500–3,000 | **2,194** (sparsity 19.6%) |
| events ในแคตตาล็อก | ~100 | **101** |
| connected events/คน | เฉลี่ย 8–20 | **avg 19.6** (min 3 / max 39) |
| drama events/คน (ไม่นับ routine/positive) | — | **avg 11.5** |
| degree/คน | 10–60 | **min 10 / max 56 / avg 29.3** |
| rows/คน (23 sheets รวม) | 300–500 | คำนวณได้จากตารางด้านล่าง ≈ **310–520** |

**งบประมาณ rows/คน (300–500):**

| ส่วน | จำนวนแถวโดยประมาณ/คน |
|---|---|
| Base time-series (Attendance 36 + Timesheet 36 + Salary 10 + KPI 20 + Expense 24 + Benefit 12 + IT Ticket 8 + Learning 15 + Career 8 + Project 12 + Collab 25 + Warning 3 + Grievance 2 + 360° 5 + อื่นๆ ~20) | ~236 |
| Connected event rows (8–20 events × 3–5 แถว/event/คน ข้าม sheets ตาม `affectedSheets`) | 24–100 |
| Routine filler logs (badge swipe, ประชุม, email) | 50–150 |
| **รวม** | **~310–520** |

> กลไก row expansion: 1 `eventId` → หลายแถวต่อคนต่อ sheet (ตาม `affectedSheets` + `logRowExpansion`)
> ทุกแถวของทุกคนที่เกี่ยวข้องใช้ **eventId + logDateTime เดียวกัน** ⇒ query กลับมาเจอทั้ง 2 ฝั่งเสมอ


## 5. Data Model — คอลัมน์ใหม่ใน 23 Sheets

### 5.1 คอลัมน์ร่วม (Common columns — เพิ่มทุก sheet ที่เป็น log)

| คอลัมน์ | ตัวอย่าง | ความหมาย |
|---|---|---|
| `logDateTime` | `2023-11-05T09:14:00+07:00` | timestamp ของเหตุการณ์ **ต้องเหมือนกันทุกฝั่งที่เกี่ยวข้อง** |
| `logType` | `incident / warning / grievance / expense_irregularity / praise / routine / access / legacy_context` | ประเภทแถว (enum) |
| `subject` | `"ทะเลาะเรื่อง scope งานหน้างาน"` | สรุปสั้นภาษาไทย |
| `counterpartyEmployeeCode` | `EMP063;EMP101` | รหัสคนที่เกี่ยวข้อง (คั่น `;`) — หัวใจของการเชื่อมโยง |
| `eventId` | `SVC-01` | FK → `storyline_catalog.json` (คอลัมน์หลักสำหรับ cross-person join) |
| `location` | `PRJ003 / site-nonthaburi / HQ` | สถานที่เกิดเหตุ |
| `source` | `HRIS / ITSM / Expense / Badge / 360 / CRM` | ระบบต้นทาง |
| `notes` | ข้อความยาว (สำหรับ RAG chunking) | รายละเอียดเพิ่มเติม |

### 5.2 Schema ต่อ sheet (คอลัมน์เดิม → คอลัมน์ใหม่) + จุดที่ดราม่าไปอยู่

| # | Sheet | คอลัมน์เดิม (มีอยู่แล้ว) | คอลัมน์ใหม่ที่เพิ่ม | ดราม่าที่ควรอยู่ใน sheet นี้ |
|---|---|---|---|---|
| 1 | **Employee_Profile** | pk, code, name, department, jobTitle, managerCode, hireDate, retentionRisk… | `faction`, `factionConfidence`, `profileNote`, `redactionRequired`, `lastUpdatedAt` | บันทึก "โต๊ะกาแฟ"/ขั้วการเมือง, Tier-1 redaction |
| 2 | **Career_Timeline** | date, eventType, title, department, notes | `logDateTime`, `logType`, `counterpartyEmployeeCode`, `eventId`, `location`, `source` | เลื่อนตำแหน่งช้า/โดนดอง หลังเกิดดราม่า (เชื่อม POL-01) |
| 3 | **KPI_OKR_History** | reviewPeriod, kpiScore, okrScore, performanceBand, managerFeedback… | `logDateTime`, `eventId`, `counterpartyEmployeeCode`, `targetVsActual`, `incidentLinkedFlag` | คะแนนตกหลังเหตุการณ์ (SVC-08, GREY-RIG-*) |
| 4 | **Project_History** | projectId, role, contributionSummary, hasMistake, mistakeIssue… | `logDateTime`, `logType`, `eventId`, `counterpartyEmployeeCode`, `scopeChangeTHB`, `budgetOverrunPct`, `delayDays`, `blamePartyCode` | สเปกเกิน/งบเกิน/โยนความผิด (SVC-01, SVC-06, XDEPT-04) |
| 5 | **Collaboration_Network** | collaboratorEmployeeId, relationshipType, collaborationQuality, hasConflict, conflictSummary… | `logDateTime`, `eventId`, `counterpartyEmployeeCode` (=collaborator), `relationship` (enum ใหม่), `faction`, `directionNote` | **แผ่นหลักของ relationship matrix** — ทุกคู่มี 2 แถว (ฝั่งละแถว) |
| 6 | **Warning_Disciplinary_History** | caseId, caseDate, caseType, severity, formalWarning, summary, actionTaken… | `logDateTime`, `eventId`, `counterpartyEmployeeCode`, `involvedManagerCode`, `hearingDate`, `appealStatus` | คดีฮั้ว/เบิกเงิน/ขโมยข้อมูล (GREY-*, DEPT-SA-01) |
| 7 | **Learning_Development** | trainingId, trainingName, completionStatus, relatedMistake… | `logDateTime`, `eventId`, `counterpartyEmployeeCode`, `trainerCode`, `remedialForWarningId` | อบรมซ้ำหลังถูกตักเตือน (DEPT-EN-01) |
| 8 | **IT_Asset_Register** | Asset_Type, Brand, Cost_THB, Status | `logDateTime`, `eventId`, `counterpartyEmployeeCode`, `assetSerial`, `assignedByCode`, `disposalReason` | อุปกรณ์ที่เกี่ยวข้องกับข้อมูลรั่ว (GREY-DATA-*) |
| 9 | **IT_Ticket_Log** | Ticket_Issue, Status | `logDateTime`, `logType`, `eventId`, `counterpartyEmployeeCode`, `ticketId`, `resolutionHours`, `securityFlag` | VPN ล่ม/CRM ล่ม/สิทธิ์ผิดปกติ (CRISIS-2020-02, XDEPT-01) |
| 10 | **Software_Licenses** | License_Name, Status | `logDateTime`, `eventId`, `counterpartyEmployeeCode`, `licenseKey`, `overageFlag`, `approvedByCode` | license เกินจำนวน (DEPT-IT-02) |
| 11 | **Salary_History** | Base_Salary, Bonus_Months, Increase_Percent | `logDateTime`, `eventId`, `counterpartyEmployeeCode`, `changeReason`, `freezeFlag`, `approvedByCode` | ลดเงินเดือน 1997 / freeze 2020 (CRISIS-1997-03, CRISIS-2020-04) |
| 12 | **Attendance_Record** | Sick_Leave_Days, Personal_Leave_Days, Late_Arrivals | `logDateTime`, `logType`, `eventId`, `counterpartyEmployeeCode`, `checkInTime`, `checkOutTime`, `workMode` (office/WFH/site), `absenceReason`, `verifiedByCode` | ลางานผิดปกติ/ตบตาการ์ด (XDEPT-03, CRISIS-2020-03) |


| # | Sheet | คอลัมน์เดิม (มีอยู่แล้ว) | คอลัมน์ใหม่ที่เพิ่ม | ดราม่าที่ควรอยู่ใน sheet นี้ |
|---|---|---|---|---|
| 13 | **360_Feedback** | Reviewer_Type, Comment | `logDateTime`, `eventId`, `counterpartyEmployeeCode` (=reviewer), `reviewerDept`, `sentimentScore`, `conflictMentionedFlag`, `factionHint` | คำวิจารณ์แฝงการเมือง/โยนความผิด (POL-*, SVC-09) |
| 14 | **Skill_Matrix** | Core_Skill, Language_Score_IELTS, Certification | `logDateTime`, `eventId`, `counterpartyEmployeeCode`, `skillGapAfterIncident`, `assessedByCode` | ช่องว่างทักษะหลังเหตุการณ์ (DEPT-EN-01 retraining) |
| 15 | **Succession_Planning** | Flight_Risk_Pct, Impact_of_Loss, Readiness | `logDateTime`, `eventId`, `counterpartyEmployeeCode`, `factionBiasNote`, `reviewedByCode` | flight risk หลังการเมือง (POL-01, POL-04) |
| 16 | **Benefit_Claims** | Medical_THB, Dental_THB, Wellness_THB | `logDateTime`, `logType`, `eventId`, `counterpartyEmployeeCode`, `claimType`, `amountTHB`, `approvalChain`, `overclaimFlag` | เบิกสวัสดิการเกินสิทธิ์ (DEPT-FA-02, GREY-EXP-03) |
| 17 | **Expense_Reports** | Travel_THB, Entertainment_THB, Office_Supplies_THB | `logDateTime`, `logType`, `eventId`, `counterpartyEmployeeCode`, `amountTHB`, `receiptRef`, `approvalStatus`, `anomalyFlag`, `approvedByCode` | **แผ่นหลักของ grey area การเงิน** — เบิกซ้ำ/ใบเสร็จปลอม (GREY-EXP-*, GREY-FIN-*, GREY-RIG-04) |
| 18 | **Grievance_Log** | Complaint_Type, Status | `logDateTime`, `logType`, `eventId`, `counterpartyEmployeeCode` (=respondent), `complainantCode`, `complaintDetail`, `resolutionDate`, `confidentialTier` | **แผ่นหลักของความขัดแย้งระหว่างคน** (SVC-04, POL-05, XDEPT-*) |
| 19 | **Compliance_Mandates** | Mandate, Status | `logDateTime`, `eventId`, `counterpartyEmployeeCode`, `auditFindingCode`, `deadline`, `ownerCode`, `followUpStatus` | ผลตรวจภายใน ฮั้วประมูล/ข้อมูลรั่ว (GREY-*, CRISIS-1997-01) |
| 20 | **Onboarding_Journey** | Culture_Fit_Score, Interview_Score, Buddy_Name | `logDateTime`, `eventId`, `counterpartyEmployeeCode` (=buddy), `referralFlag`, `factionInductionNote` | พนักงานใหม่ถูกดึงเข้าขั้ว/ญาติ referral (FAM-04, POL-04) |
| 21 | **Employee_Engagement** | eNPS, Burnout_Risk | `logDateTime`, `eventId`, `counterpartyEmployeeCode`, `surveyWave`, `burnoutNote` | burnout หลังโดนด่า/ดราม่า (DEPT-CS-01, DEPT-EX-01) |
| 22 | **Physical_Security** | Access_Zone, Parking_Slot, Last_Badge_Swipe | `logDateTime`, `logType`, `eventId`, `counterpartyEmployeeCode`, `badgeEventType` (in/out/anomaly), `zone`, `pairedPersonCode` | แสกนการ์ดผิดเวลา/ประชุมลับ "โต๊ะกาแฟ" (POL-08, SVC-10) |
| 23 | **Timesheet_Log** | Billable_Hours_Pct, Admin_Hours_Pct | `logDateTime`, `logType`, `eventId`, `counterpartyEmployeeCode`, `projectId`, `billableHours`, `overtimeFlag`, `verifiedByCode` | เบิกชั่วโมงเกินจริง (GREY-EXP-02, DEPT-DA-02) |

### 5.3 แผนที่ "ดราม่าไปอยู่ sheet ไหน" (สรุป)

| ประเภทดราม่า | Sheet หลัก | Sheet รอง |
|---|---|---|
| ทะเลาะ/ขัดแย้งระหว่างคน | Grievance_Log, Collaboration_Network | 360_Feedback, Warning_Disciplinary_History |
| วินัย/คดี | Warning_Disciplinary_History | Compliance_Mandates, Learning_Development |
| ฮั้วประมูล/ทุจริตจัดซื้อ | Expense_Reports, Warning_Disciplinary_History | Project_History, Compliance_Mandates, IT_Ticket_Log |
| ขโมยข้อมูลลูกค้า | IT_Ticket_Log, Compliance_Mandates | IT_Asset_Register, Warning_Disciplinary_History |
| เบิกเงินผิดปกติ | Expense_Reports, Benefit_Claims | Attendance_Record, Timesheet_Log |
| สเปก/งบ/หน้างาน | Project_History | Grievance_Log, KPI_OKR_History |
| ลางาน/ตบตาเวลา | Attendance_Record, Timesheet_Log | Physical_Security |
| การเมือง/ขั้วอำนาจ | 360_Feedback, Collaboration_Network | Succession_Planning, Career_Timeline, Employee_Profile |


## 6. relationship_matrix.json — Spec

```jsonc
{
  "generatedAt": "2026-08-07T...Z",
  "schemaVersion": "1.0",
  "scope": { "employees": 150, "possiblePairs": 11175, "targetPairRange": "1500-3000" },
  "factions": {
    "old_guard": { "nameTH": "ขั้วอำนาจเก่า (สายปฏิบัติการ)", "leaders": ["EMP002","EMP005","EMP101","EMP045"], "keyDepartments": [...] },
    "new_guard": { "nameTH": "ขั้วคนรุ่นใหม่ (สายธุรกิจ/ดิจิทัล)", "leaders": ["EMP003","EMP004","EMP125","EMP135","EMP143"], ... },
    "neutral":   { "nameTH": "กลุ่มกลาง / ไม่เข้าข้าง", "leaders": ["EMP001","EMP147","EMP113","EMP006"], ... }
  },
  "employeeFaction": { "EMP001": "neutral", "EMP002": "old_guard", ... },   // 150 คน
  "relationshipTypes": { "conflict": {...}, "collusion": {...}, "friendship": {...}, "mentorship": {...}, "work_partner": {...}, "family": {...} },
  "pairs": [
    { "a": "EMP005", "b": "EMP101", "relationship": "collusion",
      "faction": "old_guard",                       // กลุ่มของคู่นั้น (ดู 6.1)
      "eventIds": ["GREY-RIG-01", "GREY-RIG-04"] }  // เหตุการณ์ที่คู่นี้เกี่ยวข้องร่วมกัน
  ],
  "stats": { "totalPairs": 2194, "byRelationship": {...}, "byFaction": {...},
             "degree": {"min":10,"max":56,"avg":29.25}, "sparsityPct": 19.63 }
}
```

### 6.1 ความหมาย field
- `a`, `b` : employee code **เรียง a<b เสมอ** (edge ไม่มีทิศทาง = bidirectional)
- `relationship` : enum 6 ค่า — conflict / collusion / friendship / mentorship / work_partner / family
- `faction` : ระบุบริบทขั้วของคู่นั้น
  - `old_guard` / `new_guard` = คู่อยู่ในขั้วเดียวกัน
  - `cross_old_new` = คู่ข้ามขั้ว (old×new) → มักเป็น conflict/การเมือง
  - `neutral_mixed` = คู่ที่ฝ่ายใดฝ่ายหนึ่ง (หรือทั้งคู่) อยู่กลุ่มกลาง
- `eventIds[]` : 1–3 eventId จาก `storyline_catalog.json` — **สัญญาว่า Phase 2 ต้องสร้างแถว log
  ของทั้ง `a` และ `b` ด้วย eventId + logDateTime เดียวกัน**

### 6.2 หลักการสร้าง (generation logic — reproducible ด้วย seed 20260807)
1. **family** = คู่คนในกลุ่มนามสกุลเดียวกัน (จาก identity จริง) เลือก ~42% → 90 คู่
2. **weighted sampling** คู่ที่เหลือให้ได้ ~2,150 คู่ น้ำหนักสูงขึ้นเมื่อ:
   - สายบังคับบัญชา (×8) / รู้จักกันใน collaboration-graph (×2.4) / แผนกเดียวกัน (×3)
   - ข้ามขั้ว old×new (×1.9) / คู่แผนกดราม่า Sales×Construction, Finance×Procurement ฯลฯ (×1.8)
   - neutral×neutral ถูกลดน้ำหนัก (×0.75) → ไม่ใช่ทุกคนที่ "การเมือง"
3. **type assignment** ตามบริบท (ผู้ใต้บังคับบัญชา→mentorship, คู่ดราม่า→conflict, คู่ collusion-combo→collusion ฯลฯ)
4. **min degree** รับประกันทุกคนมีอย่างน้อย 10 คู่ (ผู้บริหาร ≥16)
5. **force-add keyPairCodes** จากแคตตาล็อก → คู่ "ตัวละครหลัก" ของแต่ละเหตุการณ์ อยู่ใน matrix เสมอ (44 คู่)

### 6.3 ผลลัพธ์จริง (จากไฟล์)
- totalPairs **2,194** · work_partner 877 · friendship 478 · conflict 475 · collusion 177 · mentorship 97 · family 90
- employee faction: old_guard **56** · new_guard **47** · neutral **47** (สมดุลพอให้การเมืองมีสองขั้วจริง)

---

## 7. storyline_catalog.json — Spec

```jsonc
{
  "generatedAt": "...", "schemaVersion": "1.0",
  "meta": {
    "categories": { "crisis": "...", "politics": "...", "grey_area_collusion": "...",
                     "cross_dept_conflict": "...", "dept_negative": "...", "positive": "...",
                     "routine": "...", "family": "..." },
    "periods": { "1997": "...", "2011": "...", "2020": "...", "ongoing": "..." },
    "riskLevels": { "low": "...", "medium": "...", "high": "...", "critical": "..." },
    "logRowExpansionNote": "1 eventId → หลายแถว/คน/sheet โดยใช้ eventId + timestamp เดียวกัน"
  },
  "catalog": [
    {
      "eventId": "SVC-01",
      "titleTH": "สัญญาขายเกินสเปก — ขายบ้าน 4 ห้องนอนแต่แบบมี 3 ห้อง",
      "descriptionTH": "ทีมขายเซ็นสัญญาเกินแบบมาตรฐาน ... (ยาว สำหรับ RAG)",
      "category": "cross_dept_conflict",
      "period": "ongoing",
      "riskLevel": "high",
      "affectedSheets": ["Project_History","Grievance_Log","Collaboration_Network","Warning_Disciplinary_History"],
      "suggestedCounterpartDepts": ["Sales","Engineering & Construction"],
      "suggestedParticipants": ["EMP016","EMP066","EMP063","EMP007"],   // ตัวละครหลัก (แนะนำ)
      "keyPairCodes": [["EMP016","EMP066"]],                            // คู่ "ดาว" ของเหตุการณ์ (มีใน matrix เสมอ)
      "financialImpactTHB": 8900000,
      "resolutionStatus": "Escalated to CEO",
      "recurring": false,
      "logRowExpansion": 4   // แนวทาง: ~4 แถว/คน/sheet
    }
  ],
  "stats": { "totalEvents": 101, "byCategory": {...}, "byPeriod": {...}, "byRiskLevel": {...},
             "pairReferences": 3094, "eventsWithZeroPairRefs": [] }
}
```

- ผู้เข้าร่วมจริงของแต่ละเหตุการณ์ = **keyPairCodes (บังคับ) + คู่ใน matrix ที่อ้าง eventId นั้น** + suggestedParticipants (แนะนำ)
- ทุก `eventId` ที่ปรากฏใน `pairs[].eventIds` ต้องมีอยู่ใน catalog (validated: 0 รายการค้าง)


## 8. Storyline Components (เนื้อหาดราม่าหลัก)

### 8.1 วิกฤตประวัติศาสตร์ — 1997 / 2011 / 2020 (กระทบ senior staff)
- **1997 ต้มยำกุ้ง** (`CRISIS-1997-*` 5 เหตุการณ์): งานหยุดทั้งระบบ, เงินดาวน์ลูกค้าหาย, ลดเงินเดือน 20%,
  ยุบแผนกการตลาด, จุดเริ่ม "เส้นสาย" ในฝ่ายจัดซื้อ → **เป็นเหตุการณ์มรดกองค์กร** (logType=legacy_context)
  ที่ฝังวัฒนธรรมจนถึงปัจจุบัน; ส่งผลกับผู้บริหาร/พนักงานรุ่นเก๋า (EMP002, EMP005, EMP101, EMP063)
- **2011 น้ำท่วม** (`CRISIS-2011-*` 5 เหตุการณ์): ไซต์งานเสียหาย, สินไหมไม่ครบ, เซิร์ฟเวอร์จมน้ำ,
  พนักงานติดน้ำท่วม, ลูกค้าทิ้งโครงการ → ต้นตอของช่องโหว่ "เบิกเงินทดรอง" (เชื่อม GREY-EXP-*)
- **2020 โควิด** (`CRISIS-2020-*` 5 เหตุการณ์): lockdown งานหยุด, VPN ล่ม/ช่องโหว่, คลัสเตอร์ในทีมขาย,
  freeze เงินเดือน, ยอดขายปลอม Q4 → จุดเริ่มการเมือง "คนรุ่นใหม่ vs ขั้วเก่า" (เชื่อม POL-*, GREY-DATA-*)

### 8.2 การเมือง: ขั้วอำนาจเก่า vs คนรุ่นใหม่ (`POL-01..08`)
- **ขั้วเก่า (old_guard, 56 คน):** COO ณัฐพล (EMP002), วรพล หัวหน้าฝ่ายก่อสร้าง (EMP005),
  สาย Design Manager (EMP045), ฝ่ายจัดซื้อ (EMP101) + Engineering/Procurement/Design ส่วนใหญ่
  — วัฒนธรรม "โต๊ะกาแฟ" (POL-08), สายสัมพันธ์ผู้รับเหมา, ต่อต้านดิจิทัล
- **ขั้วใหม่ (new_guard, 47 คน):** CFO กิตติพงศ์ (EMP003), ภาคิน หัวหน้าฝ่ายขาย (EMP004),
  Finance/Sales/Marketing/HR/IT ส่วนใหญ่ — KPI-based, ความโปร่งใส, ดิจิทัล
- **กลุ่มกลาง (neutral, 47 คน):** CEO ธนกฤต (ผู้ชี้ขาด), ฝ่ายกฎหมาย, บริการลูกค้าส่วนใหญ่, สนับสนุน
- ฉากหลัก: ศึกชิงตำแหน่งรอง MD (POL-01), แย่งงบคุมโครงการ (POL-02), ตรวจสอบวรพล (POL-03),
  HR ถูกมองเข้าข้างฝ่ายเก่า (POL-04), เลขาฯ CEO สายลับสองฝ่าย (POL-05)

### 8.3 Grey Areas (หลักฐานเชิงลบร่วมกัน)
| Grey area | เหตุการณ์ | ผู้เล่นหลัก (keyPairCodes) |
|---|---|---|
| ฮั้วประมูล (Construction+Procurement+Sales) | `GREY-RIG-01..04` | EMP101×EMP063, EMP101×EMP125, EMP046×EMP101, EMP101×EMP064 |
| ขโมยข้อมูลลูกค้า (Sales+IT) | `GREY-DATA-01..03` | EMP025×EMP145, EMP008×EMP143, EMP138×EMP143 |
| เบิกเงินผิดปกติ (Finance+Admin) | `GREY-EXP-01..03` | EMP132×EMP012, EMP111×EMP026, EMP127×EMP107 |
| วางบิลปลอม/โอนผิดบัญชี | `GREY-FIN-01..02` | EMP104×EMP101, EMP101×EMP147, EMP128×EMP129 |

### 8.4 Sales vs Construction (`SVC-01..10`) — ความขัดแย้งคลาสสิก
- **สเปกเกินสัญญา** (SVC-01, SVC-06) · **ส่งมอบล่าช้า** (SVC-02) · **งบเกิน/แถมของ** (SVC-03)
- **ทะเลาะต่อหน้าลูกค้า** (SVC-04) · **แย่งงบ showhouse** (SVC-05) · **เคลมวัสดุสามเส้า** (SVC-07)
- **backlog ล้น / รับงานเกินกำลัง** (SVC-08 — critical) · **แย่งเครดิต** (SVC-09) · **ห้ามเข้าหน้างาน** (SVC-10)

---

## 9. Handoff — วิธีใช้ Phase 2 / Phase 3

### Phase 2 (row generation — เพื่อนร่วมทีม)
1. เปิด `relationship_matrix.json` → สำหรับทุก pair: สร้างแถว `Collaboration_Network` 2 แถว (ฝั่ง a, ฝั่ง b)
   ด้วย `eventId` + `logDateTime` เดียวกัน
2. เปิด `storyline_catalog.json` → สำหรับทุก event: สร้างแถวใน sheets ที่อยู่ใน `affectedSheets`
   ให้กับทุกคนใน `suggestedParticipants` + คนจาก pairs ที่อ้าง eventId นั้น
   (จำนวนแถว/คน/sheet ใช้ `logRowExpansion` เป็นแนวทาง)
3. เติม `logType=legacy_context` สำหรับ period 1997/2011 (พนักงานปัจจุบันยังไม่เกิด/ยังไม่เข้าทำงาน)
   และ timestamp จริงสำหรับ period ongoing/2020/2021-2025
4. เพิ่ม routine filler rows (badge, ประชุม, email, expense ปกติ) ให้ครบ 300–500 rows/คน
5. เกณฑ์บังคับ: ไม่มีแถวไหนที่ `counterpartyEmployeeCode` ไม่อยู่ใน identity; ทุกแถวที่มี eventId
   ต้อง match catalog; ทุกคู่ drama ต้องมีแถวครบทั้ง 2 ฝั่ง

### Phase 3 (RAG indexing)
- ใช้ `eventId` เป็น document/record ID ร่วม → สร้างเวกเตอร์ต่อแถว/ต่อ event cluster
- ใช้ `faction`/`relationship` เป็น metadata สำหรับ graph traversal & filter
- ใช้ `affectedSheets` เป็นคำใบ้ routing ว่าเนื้อหาดราม่าอยู่ sheet ไหน
- คำถามตัวอย่างที่ dataset นี้รองรับ:
  *"ใครอยู่ในขั้วอำนาจเก่าบ้าง และมีหลักฐานฮั้วประมูลใน Expense_Reports ของใคร"*
  *"EMP005 กับ EMP004 ขัดแย้งกันเรื่องอะไร มี eventId ไหน และเกิดเมื่อไหร่"*
  *"เหตุการณ์ปี 1997/2011/2020 ส่งผลต่อนโยบายปัจจุบันอย่างไร"*

---

## 10. Validation Checklist (ตรวจแล้วผ่านทุกข้อ)

- [x] JSON ทั้ง 2 ไฟล์ parse ได้ (`json.load`) + UTF-8 Thai ถูกต้อง
- [x] ทุก EMP code ใน pairs / suggestedParticipants / keyPairCodes อยู่ใน identity-graph (150 คน)
- [x] pairs อยู่ช่วง 1,500–3,000 → **2,194** คู่ (sparsity 19.63%)
- [x] ทุกคู่มี `eventIds` อย่างน้อย 1 อัน และทุก eventId มีใน catalog (unknown = 0)
- [x] keyPairCodes ทุกคู่มีอยู่ใน matrix (missing = 0) — ตัวละครหลักไม่หาย
- [x] ทุกคนมี degree ≥ 10 (min 10 / max 56 / avg 29.3) — ไม่มีใคร "ไม่มีเพื่อน"
- [x] a<b เสมอ (bidirectional edge) + faction tag ตรงกับ employeeFaction (mismatch = 0)
- [x] connected events/คน เฉลี่ย **19.6** (อยู่ในช่วง 8–20) · drama events/คน เฉลี่ย **11.5**
- [x] เหตุการณ์ครอบคลุม 12 แผนก + วิกฤต 3 ยุค + การเมือง 2 ขั้ว + grey area 4 กลุ่ม + positive 15 รายการ




