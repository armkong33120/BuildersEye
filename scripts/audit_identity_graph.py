#!/usr/bin/env python3
"""Source data audit for identity-graph.json."""
import json
from collections import Counter
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
SOURCE = APP_ROOT / "src" / "data" / "identity-graph.json"

g = json.loads(SOURCE.read_text(encoding="utf-8"))
idents = g["identities"]
depts = g["departments"]
ceo_pk = g["ceoPk"]

print("=" * 80)
print("SOURCE AUDIT SUMMARY")
print("=" * 80)

# --- 1. Count ---
print(f"\nTotal employees: {len(idents)}")
print(f"CEO pk: {ceo_pk}")

# --- 2. Duplicate checks ---
pks = [e["pk"] for e in idents]
codes = [e["code"] for e in idents]
emails = [e["email"] for e in idents]

dup_pks = sorted({x for x in pks if pks.count(x) > 1})
dup_codes = sorted({x for x in codes if codes.count(x) > 1})
dup_emails = sorted({x for x in emails if emails.count(x) > 1})

print(f"Duplicate PKs: {dup_pks if dup_pks else 'None'}")
print(f"Duplicate Codes: {dup_codes if dup_codes else 'None'}")
print(f"Duplicate Emails: {dup_emails if dup_emails else 'None'}")

# --- 3. PK range ---
print(f"PK range: {min(pks)} to {max(pks)}")
print(f"PKs contiguous 1..150: {sorted(pks) == list(range(1, 151))}")

# --- 4. Manager checks ---
no_manager = [
    e for e in idents if e["pk"] != ceo_pk and not e.get("managerPk")
]
print(f"\nNon-CEO employees missing managerPk: {len(no_manager)}")
if no_manager:
    for e in no_manager[:10]:
        print(f"  PK={e['pk']} {e['code']} {e['name']}")

pk_set = set(pks)
bad_mgr = [
    e for e in idents
    if e.get("managerPk") and e["managerPk"] not in pk_set
]
print(f"Manager PK references non-existent employee: {len(bad_mgr)}")
if bad_mgr:
    for e in bad_mgr[:10]:
        print(f"  PK={e['pk']} managerPk={e['managerPk']}")

# --- 5. Department headcount ---
dept_counter = Counter(e["department"] for e in idents)
expected_map = {d["name"]: d["employeeCount"] for d in depts}
print(f"\n{'Department':55s} {'Count':>6s}  {'Expected':>8s}  {'Status':>6s}")
print("-" * 80)
dept_ok = True
for dept_name in sorted(dept_counter.keys()):
    cnt = dept_counter[dept_name]
    exp = expected_map.get(dept_name, "N/A")
    status = "OK" if cnt == exp else "MISMATCH"
    if status != "OK":
        dept_ok = False
    print(f"{dept_name:55s} {cnt:>6d}  {str(exp):>8s}  {status:>6s}")
print(f"\nAll department counts match expected: {dept_ok}")

# --- 6. Hierarchy depth ---
depth_counter = Counter(e["hierarchyDepth"] for e in idents)
print(f"\nHierarchy Depth Distribution:")
for depth in sorted(depth_counter.keys()):
    bar = "█" * depth_counter[depth]
    print(f"  Level {depth}: {depth_counter[depth]:>4d}  {bar}")
print(f"  Max depth: {max(depth_counter.keys())}")
print(f"  Depth range within expected [0,6]: {max(depth_counter.keys()) <= 6}")

# --- 7. Account risk ---
risk_counter = Counter(e["accountRisk"] for e in idents)
print(f"\nAccount Risk Distribution:")
for risk in sorted(risk_counter.keys()):
    print(f"  {risk:12s}: {risk_counter[risk]:>4d}")

# --- 8. Department name validity ---
valid_depts = {d["name"] for d in depts}
invalid_dept = [e for e in idents if e["department"] not in valid_depts]
print(f"\nEmployees referencing invalid department name: {len(invalid_dept)}")
if invalid_dept:
    for e in invalid_dept[:10]:
        print(f"  PK={e['pk']} dept=\"{e['department']}\"")

# --- 9. License ---
license_counter = Counter(e["licensePlan"] for e in idents)
print(f"\nLicense Distribution:")
for lic in sorted(license_counter.keys()):
    print(f"  {lic:30s}: {license_counter[lic]:>4d}")

# --- 10. Email format ---
bad_emails = [e for e in idents if "@demo-company.co.th" not in e["email"]]
print(f"\nBad email format (missing domain): {len(bad_emails)}")

# --- 11. Direct report count integrity ---
mismatch_reports = [
    e for e in idents
    if len(e.get("directReportPks", [])) != e.get("directReportCount", 0)
]
print(f"\nDirectReportPks length vs directReportCount mismatches: {len(mismatch_reports)}")
if mismatch_reports:
    for e in mismatch_reports[:10]:
        print(f"  PK={e['pk']} actual={len(e['directReportPks'])} stored={e['directReportCount']}")

# --- 12. OneDrive owner == email ---
od_mismatch = [e for e in idents if e["oneDriveOwner"] != e["email"]]
print(f"OneDriveOwner != Email mismatches: {len(od_mismatch)}")

# --- 13. managerChainPks integrity ---
chain_contains_self = 0
chain_bad_refs = 0
for e in idents:
    chain = e.get("managerChainPks", [])
    if e["pk"] in chain:
        chain_contains_self += 1
    for pk in chain:
        if pk not in pk_set:
            chain_bad_refs += 1
            break
print(f"\nManagerChainPks contains self: {chain_contains_self}")
print(f"ManagerChainPks references non-existent PK: {chain_bad_refs}")

# --- 14. subtreePks integrity ---
subtree_bad = 0
for e in idents:
    tree = e.get("subtreePks", [])
    for pk in tree:
        if pk not in pk_set:
            subtree_bad += 1
            break
print(f"SubtreePks references non-existent PK: {subtree_bad}")

# --- 15. Stats block consistency ---
stats = g["stats"]
print(f"\nStats Block:")
for k, v in stats.items():
    if k == "licenses":
        print(f"  licenses: {v}")
    elif k == "risks":
        print(f"  risks: {v}")
    else:
        print(f"  {k}: {v}")

checks = [
    (stats.get("employeeCount") == len(idents), "employeeCount"),
    (stats.get("departmentCount") == len(depts), "departmentCount"),
    (stats.get("reportingLinkCount") == len(g.get("reportingLinks", [])), "reportingLinkCount"),
    (stats.get("oneDriveSiteCount") == len(idents), "oneDriveSiteCount"),
    (stats.get("mailDomainCount") == 1, "mailDomainCount"),
    (stats.get("maxDepth") == max(depth_counter.keys()), "maxDepth"),
]
all_ok = all(c[0] for c in checks)
for ok, label in checks:
    status = "OK" if ok else "FAIL"
    print(f"  Stats.{label} consistent: {status}")

print(f"\nStats block overall: {'ALL OK' if all_ok else 'HAS FAILURES'}")

# --- SUMMARY ---
print("\n" + "=" * 80)
print("AUDIT VERDICT")
print("=" * 80)
issues = []
if not no_manager and not bad_mgr:
    print("✓ All non-CEO employees have valid managers")
else:
    issues.append(f"Manager issues: {len(no_manager)} missing, {len(bad_mgr)} invalid refs")
    print(f"✗ Manager issues: {len(no_manager)} missing, {len(bad_mgr)} invalid refs")

if dup_pks or dup_codes or dup_emails:
    issues.append("Duplicate PKs/codes/emails detected")
    print("✗ Duplicates found")
else:
    print("✓ No duplicates (PK, code, email)")

if not dept_ok:
    issues.append("Department headcount mismatches")
else:
    print("✓ Department headcounts match")

if invalid_dept:
    issues.append(f"{len(invalid_dept)} employees with invalid dept name")
else:
    print("✓ All department names valid")

if bad_emails:
    issues.append(f"{len(bad_emails)} bad email formats")
else:
    print("✓ All email formats valid")

if mismatch_reports:
    issues.append(f"{len(mismatch_reports)} direct report count mismatches")
else:
    print("✓ Direct report counts match array lengths")

if od_mismatch:
    issues.append(f"{len(od_mismatch)} OneDrive owner/email mismatches")
else:
    print("✓ OneDrive owner equals email for all employees")

if not all_ok:
    issues.append("Stats block internal inconsistencies")
else:
    print("✓ Stats block internally consistent")

if len(idents) == 150:
    print("✓ Exactly 150 employees")
else:
    issues.append(f"Expected 150, found {len(idents)}")
    print(f"✗ Expected 150, found {len(idents)}")

if issues:
    print(f"\n⚠ {len(issues)} issue(s) detected:")
    for i, iss in enumerate(issues, 1):
        print(f"  {i}. {iss}")
else:
    print("\n✓ NO ISSUES DETECTED — data is clean")
print("=" * 80)