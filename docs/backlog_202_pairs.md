# Backlog: 202 Silent Pairs (no real events, both sides silent)

> Source: `tools/upgrade_360/out/full_150/validation_report.json` → `coverageNoLink` (202 entries).
> Matrix: `tools/upgrade_360/design/relationship_matrix.json` (2,194 pairs total).
> Generated: 2026-08-07 · Owner: feature-dev (cost/backlog analysis)

## TL;DR

- **202 of 2,194 pairs (9.2%)** produced **zero linked rows on either side** — no
  `Collaboration_Network` row, no drama row, no routine `pairWith` row that Phase 3
  could match (claims between `a` and `b` empty in both directions).
- **Root cause (100% of 202): hire-date skip in `_plan_collab_pairs`.** For every one
  of the 202 pairs, the *first* referenced event's canonical timestamp predates **one
  (or both) members' hire date** → the whole pair is skipped (both sides silent).
  It is *not* a data-generation failure: it is a **design gap** — the matrix assigns
  eventIds to pairs whose members hadn't joined yet at event time.
- **Where they sit:** dominated by **Engineering & Construction (227 member-slots)**,
  then Sales (43), Customer Service & Warranty (30), Procurement & Warehouse (25).
  Relationship mix: `work_partner` 93, `friendship` 66, `conflict` 25, `collusion` 10,
  `family` 6, `mentorship` 2.
- **Fix directions:** (1) `faker_routines` — pick a *post-hire* event/timestamp for
  collab rows instead of always `eventIds[0]`; (2) `storyline_catalog.json` — add
  recent (2024–2026) "ongoing" events covering the late-hire cluster (EMP089–EMP098,
  EMP116–EMP140) so every pair has ≥1 event after both join dates.

---

## 1. What "silent" means (exact definition)

Phase 3 (`phase3_validate.cross_validate_relationships`) marks a pair as
`coverageNoLink` when **neither file contains any claim** linking `a` and `b`:

- `claims_ab` (rows in A's Excel / injected metadata referencing B) is empty, **and**
- `claims_ba` (rows in B's Excel referencing A) is empty.

A claim is any row where `counterpartyEmployeeCode` contains the other party, or a
shared `(eventId, logDateTime)` pair. `coverageLinkedPairs = 1992`, `coverageNoLinkPairs = 202`.

## 2. Root-cause analysis

In `tools/upgrade_360/phase2_generator.py`, `_plan_collab_pairs()` emits the
Collaboration_Network mirror for a pair using **`eventIds[0]`** (first referenced event):

```python
eids = [e for e in pair.get("eventIds", []) if e in ctx.event_index]
if not eids: continue
ev = ctx.event_index[eids[0]]
...
times = ctx.ensure_event_times(ev)
t = times[0]
if hire and not is_legacy and t[:10] < hire.isoformat():
    continue                      # ← member A joined after the event
other_hire = ctx.hire_date(other)
if other_hire and not is_legacy and t[:10] < other_hire.isoformat():
    continue                      # ← member B joined after the event
```

For **all 202 pairs** the first event timestamp `t` is strictly before **at least one**
member's `joinDate` (verified against `career-story-plan.json` + the run's
`checkpoint_events.json` `event_times`). Example:

| pair | join A | join B | eventIds[0] | event time | who is too new |
|---|---|---|---|---|---|
| EMP014 × EMP092 | 2021-06-10 | **2025-08-20** | WORK-07 | 2023-11-13 | EMP092 |
| EMP015 × EMP053 | 2023-06-26 | 2021-05-19 | WORK-02 | 2023-01-23 | EMP015 |
| EMP015 × EMP084 | 2023-06-26 | **2024-11-30** | WORK-05 | 2023-04-15 | EMP084 |

Because `_plan_collab_pairs` is the **only** place that guarantees a 2-sided row per
matrix pair, skipping it leaves the pair with **no link at all** — drama rows may still
exist for each side individually (each participates in *some* event), but never *for
that pair*, so RAG questions like *"ใครเคยทำงานร่วมกับใคร"* miss these edges.

### Why the matrix assigned pre-hire events

- `relationship_matrix.json` generation picked `eventIds` from the catalog **without
  filtering by each pair's hire dates** (the matrix generator only validated EMP-code
  existence, not join-date feasibility).
- Late-hire cluster: **55 employees joined 2024–2026** (EMP089–EMP098 Engineering,
  EMP116–EMP117/119 Customer Service, EMP131–EMP140 Finance/HR/IT, EMP144 IT, …) while
  most catalog events are dated 2023 or earlier (`WORK-*` = "ongoing" 2023+, `POS-*`
  = 2023, `CRISIS-2020-*` = 2020, legacy 1997/2011).
- `is_legacy` exemption only covers period 1997/2011; ongoing/2020/2023 events are
  filtered normally.

## 3. Composition of the 202

### 3.1 By relationship

| relationship | count | note |
|---|---|---|
| work_partner | 93 | 46% — the bulk; many E&C↔E&C |
| friendship | 66 | |
| conflict | 25 | real drama intent, zero drama link |
| collusion | 10 | grey-area pairs with no shared evidence row |
| family | 6 | |
| mentorship | 2 | |

### 3.2 By department (member-slots; a pair counts twice)

| department | slots | share |
|---|---|---|
| Engineering & Construction | 227 | 56% |
| Sales | 43 | |
| Customer Service & Warranty | 30 | |
| Procurement & Warehouse | 25 | |
| Design & Architecture | 24 | |
| HR & Admin | 18 | |
| Finance & Accounting | 13 | |
| Marketing | 11 | |
| IT | 6 | |
| Legal | 5 | |
| Office Support | 2 | |

### 3.3 By department-pair (within vs cross)

- **Within same department: 59** (mostly E&C↔E&C: 30 work_partner + 16 friendship).
- **Top cross-dept combos:** E&C↔Procurement 23, Design↔E&C 21, E&C↔Sales 20,
  E&C↔HR 16, CSW↔E&C 13, CSW↔Sales 11, E&C↔Marketing 11.


### 3.4 Most-affected employees (in ≥10 silent pairs)

| code | name | dept | silent pairs |
|---|---|---|---|
| EMP092 | ปวีณา สิริกุล | Engineering & Construction | 32 |
| EMP089 | ณัฐวุฒิ กิตติธนากร | Engineering & Construction | 20 |
| EMP084 | จักริน กาญจนกุล | Engineering & Construction | 19 |
| EMP091 | ชลธิชา วัฒนชัย | Engineering & Construction | 18 |
| EMP087 | กรวิชญ์ วงศ์วัฒนะ | Engineering & Construction | 17 |
| EMP093 | มนัสนันท์ สุขประเสริฐ | Engineering & Construction | 14 |
| EMP074 | ปรียาภรณ์ จิรภัทร | Engineering & Construction | 13 |
| EMP080 | สุภัสสรา รุ่งพิทักษ์ | Engineering & Construction | 12 |
| EMP071 | อารยา ใจดี | Engineering & Construction | 11 |

These are almost all **late hires (2024–2025)** in Engineering & Construction — the
"new guard" field staff who joined after most storylines fired.

## 4. Gap explanation (why it matters)

1. **RAG recall gap:** questions about collaboration between these employees
   ("ใครทำงานกับใคร", "ใครเป็นคู่ขัดแย้ง", "มีหลักฐานอะไรระหว่าง X กับ Y") return
   nothing for 202 edges, even though the matrix declares the relationship.
2. **Phase 3 coverage < 100%:** `coverageLinkedPairs` is 1,992/2,194 = 90.8%; the
   remaining 9.2% is a silent-hole that QA flags on every run.
3. **No evidence trail:** `conflict`/`collusion` pairs (35 combined) have **zero**
   grievance/expense/warning rows referencing the other side → the "drama" is
   undetectable in the data, weakening the 360-digital-twin use case.



## 5. Proposed fixes

### 5.1 `faker_routines.py` / `phase2_generator.py` (preferred, cheapest — no new events)

In `_plan_collab_pairs` (phase2_generator), replace the hard `eventIds[0]` pick with a
**hire-feasible pick**:

1. Iterate `pair["eventIds"]` and pick the **first event whose timestamp ≥ both join
   dates**; fall back to the latest `WORK-*`/routine event.
2. If **no** referenced event is post-hire, fall back to a **routine pair row**
   (`routine_pair_ratio` path already exists in `faker_routines.generate_routine_plan`
   via `pairWith`) — gives the pair a `Collaboration_Network` row with `logType=routine`
   instead of nothing.
3. Optionally back-date `logDateTime` for routine rows to `max(joinA, joinB) + ε` so
   Phase 3's `(eventId, logDateTime)` claim matching still works.

Expected effect: **all 202 pairs get ≥1 linked row**, coverage → ~100%.

### 5.2 `storyline_catalog.json` additions (fills the "recent history" hole)

Add ~6–10 **ongoing/2024–2026** events that involve the late-hire cluster, so the
matrix can be re-generated with post-hire eventIds:

| suggested eventId | category | period | theme | keyPair suggestions |
|---|---|---|---|---|
| `XDEPT-25` | cross_dept_conflict | ongoing (2025) | สายงาน E&C ใหม่ vs Procurement เรื่องวัสดุทดแทน | EMP092×EMP105, EMP089×EMP101 |
| `DEPT-EN-03` | dept_negative | ongoing (2025) | งาน QA หน้างานพลาด — รุ่นใหม่โดนตำหนิ | EMP084×EMP091, EMP087×EMP093 |
| `SVC-11` | cross_dept_conflict | ongoing (2025) | Sales รับงานเกินกำลัง E&C รุ่นใหม่ | EMP015×EMP084, EMP031×EMP092 |
| `POS-14` | positive | 2025 | โครงการรีโนเวทบ้านพักพนักงาน — ทีมข้ามแผนกรุ่นใหม่ | EMP092×EMP116, EMP089×EMP113 |
| `FAM-05` | family | ongoing | ญาติรุ่นใหม่เข้าสายงานเดียวกัน | EMP074×EMP087 (พี่น้อง) |
| `GREY-RIG-05` | grey_area_collusion | 2024 | ฮั้วราคาวัสดุรอบใหม่ — เจ้าหน้าที่จัดซื้อรุ่นใหม่ | EMP105×EMP092 |

Add `suggestedParticipants`/`keyPairCodes` from the top-affected list (§3.4) and
re-run the matrix generator with a **join-date feasibility filter** (skip eventIds
predating either member's join).

### 5.3 Matrix generator guard (prevents recurrence)

Add to the matrix generation validation: for every pair, drop/replace `eventIds` where
`min(event_time) < max(joinA, joinB)`. This is the systemic fix — the catalog/matrix
are both deterministic, so a one-time filter removes the whole class.

## 6. Verification

```bash
cd tools/upgrade_360
.venv/bin/python phase3_validate.py --all --excel-dir out/full_150/hr_onedrive_upgraded --no-api
# expect coverageNoLinkPairs: 202 → 0
```

## 7. Full list of 202 pairs

Regenerate from `validation_report.json` → `coverageNoLink`:

```bash
python3 - <<'EOF'
import json
rep = json.load(open('tools/upgrade_360/out/full_150/validation_report.json'))
for p in rep['coverageNoLink']:
    print(p['a'], p['b'], p['eventIds'])
EOF
```
