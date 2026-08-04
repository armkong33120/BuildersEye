#!/usr/bin/env python3
"""Restructure identity-graph.json to Landy Home pyramid (150 people, 4 levels)."""
import json, random
from collections import Counter

INPUT = 'src/data/identity-graph.json'
BACKUP = 'src/data/identity-graph.json.bak'
random.seed(42)

# ── Target Manager Pool ──
MANAGERS = [
    ('COO', 'Engineering & Construction', 'Project Engineering Manager'),
    ('COO', 'Engineering & Construction', 'Site Construction Manager'),
    ('COO', 'Engineering & Construction', 'Structural Engineering Manager'),
    ('COO', 'Engineering & Construction', 'MEP Systems Manager'),
    ('COO', 'Engineering & Construction', 'Safety & Compliance Manager'),
    ('COO', 'Design & Architecture', 'Architectural Design Manager'),
    ('COO', 'Design & Architecture', 'Interior Design Manager'),
    ('COO', 'Design & Architecture', 'BOQ / Estimation Manager'),
    ('COO', 'Customer Service & Warranty', 'Quality Control Manager'),
    ('COO', 'Customer Service & Warranty', 'Warranty Manager'),
    ('COO', 'Procurement & Warehouse', 'Warehouse & Logistics Manager'),
    ('COO', 'Office Support', 'Office Administration Manager'),
    ('COO', 'Engineering & Construction', 'R&D / Innovation Manager'),
    ('CFO', 'Finance & Accounting', 'Accounting & Reporting Manager'),
    ('CFO', 'Finance & Accounting', 'Budget & Planning Manager'),
    ('CFO', 'HR & Admin', 'Human Resources Manager'),
    ('CFO', 'Procurement & Warehouse', 'Procurement & Sourcing Manager'),
    ('CFO', 'Legal', 'Legal & Compliance Manager'),
    ('CFO', 'Finance & Accounting', 'Audit & Tax Manager'),
    ('CMO', 'Sales', 'Bangkok Sales Manager'),
    ('CMO', 'Sales', 'Regional Sales Manager (East)'),
    ('CMO', 'Sales', 'Regional Sales Manager (North)'),
    ('CMO', 'Sales', 'Corporate & VIP Sales Manager'),
    ('CMO', 'Sales', 'Online Sales & Digital Manager'),
    ('CMO', 'Marketing', 'Brand & Marketing Manager'),
    ('CMO', 'Customer Service & Warranty', 'Customer Relations Manager'),
    ('CMO', 'Marketing', 'PR & Events Manager'),
]
assert len(MANAGERS) == 27, f'Expected 27 managers, got {len(MANAGERS)}'

def main():
    # Load
    with open(INPUT) as f:
        data = json.load(f)
    identities = data['identities']
    
    # Backup
    with open(BACKUP, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    # Group by department
    by_dept = {}
    for e in identities:
        by_dept.setdefault(e['department'], []).append(e)
    for d in by_dept:
        by_dept[d].sort(key=lambda e: e['pk'])
    
    used = set()
    
    def pick(pool):
        for e in pool:
            if e['pk'] not in used:
                used.add(e['pk'])
                return e
        return None
    
    # ── LV0: CEO (pk=1) ──
    ceo = identities[0]
    used.add(1)
    clevel_pks = {}  # abbr → pk
    
    # ── LV1: COO(pk=2), CFO(pk=3), CMO(pk=4) ──
    assignments = {}
    assignments[1] = ('CEO / Managing Director', 0, None)
    assignments[2] = ('Chief Operations Officer', 1, 1)
    assignments[3] = ('Chief Financial Officer', 1, 1)
    assignments[4] = ('Chief Marketing Officer', 1, 1)
    used.update([2, 3, 4])
    clevel_pks = {'COO': 2, 'CFO': 3, 'CMO': 4}
    
    # ── LV2 (35): secretaries + IT + managers ──
    
    # CEO Secretary
    ces = pick(by_dept['Executive'] + by_dept['Office Support'])
    if ces:
        assignments[ces['pk']] = ('Executive Secretary to CEO', 2, 1)  # reports to CEO
    
    # C-Level Secretaries (3)
    for abbr, cpk in [('COO', 2), ('CFO', 3), ('CMO', 4)]:
        sec = pick(by_dept['Executive'] + by_dept['Office Support'])
        if sec:
            assignments[sec['pk']] = (f'Secretary to {abbr}', 2, cpk)
    
    # IT Team (4 people at LV2, reports to CEO)
    it_team = [pick(by_dept['IT']) for _ in range(4)]
    for i, e in enumerate(it_team):
        if e:
            title = 'IT Manager' if i == 0 else 'IT Support Specialist'
            assignments[e['pk']] = (title, 2, 1)
    
    # 27 Managers (report to respective C-Level)
    for clevel_abbr, dept_name, mgr_title in MANAGERS:
        cpk = clevel_pks[clevel_abbr]
        emp = pick(by_dept.get(dept_name, []))
        if not emp:
            # fallback: any unused
            for d, pool in by_dept.items():
                emp = pick(pool)
                if emp:
                    break
        if emp:
            assignments[emp['pk']] = (mgr_title, 2, cpk)
    
    # ── LV3: 111 remaining (37 senior, 74 staff) ──
    remaining = [e for e in identities if e['pk'] not in used]
    random.shuffle(remaining)
    
    dept_to_clevel = {
        'Engineering & Construction': 'COO',
        'Design & Architecture': 'COO',
        'Office Support': 'COO',
        'Customer Service & Warranty': 'COO',
        'Finance & Accounting': 'CFO',
        'HR & Admin': 'CFO',
        'Procurement & Warehouse': 'CFO',
        'Legal': 'CFO',
        'Sales': 'CMO',
        'Marketing': 'CMO',
        'Executive': 'CEO',
        'IT': 'CEO',
    }
    
    for i, emp in enumerate(remaining):
        is_senior = (i % 3 == 0)
        dept = emp['department']
        cl_abbr = dept_to_clevel.get(dept, 'COO')
        
        # Find manager in same department
        mgr_pk = None
        for pk, (title, lvl, mgr) in assignments.items():
            if lvl == 2 and mgr == clevel_pks.get(cl_abbr):
                orig = next((e for e in identities if e['pk'] == pk), None)
                if orig and orig['department'] == dept:
                    mgr_pk = pk
                    break
        if not mgr_pk:
            mgr_pk = clevel_pks.get(cl_abbr, 1)
        
        prefix = 'Senior ' if is_senior else ''
        assignments[emp['pk']] = (prefix + emp['jobTitle'], 3, mgr_pk)
    
    # ── Build new identities ──
    pk_to_emp = {e['pk']: e for e in identities}
    new_identities = []
    
    for pk in sorted(assignments):
        emp = pk_to_emp[pk]
        title, level, mgr = assignments[pk]
        role = {0: 'CEO', 1: 'C-Level', 2: 'Manager', 3: 'Staff'}[level]
        new = {
            'pk': pk, 'code': emp['code'], 'name': emp['name'],
            'department': emp['department'], 'jobTitle': title,
            'roleGroup': role, 'managerPk': mgr,
            'managerCode': '', 'managerName': '', 'managerJobTitle': '',
            'directReportPks': [], 'directReportCount': 0,
            'managerChainPks': [], 'subtreePks': [pk],
            'hierarchyDepth': level,
        }
        new_identities.append(new)
    
    # Fill manager refs
    pmap = {e['pk']: e for e in new_identities}
    for emp in new_identities:
        if emp['managerPk'] and emp['managerPk'] in pmap:
            mgr = pmap[emp['managerPk']]
            emp['managerCode'] = mgr['code']
            emp['managerName'] = mgr['name']
            emp['managerJobTitle'] = mgr['jobTitle']
            mgr['directReportPks'].append(emp['pk'])
            mgr['directReportCount'] += 1
            emp['managerChainPks'] = list(mgr.get('managerChainPks', [])) + [mgr['pk']]
    
    # Reporting links
    links = []
    for emp in new_identities:
        if emp['managerPk'] and emp['managerPk'] in pmap:
            mgr = pmap[emp['managerPk']]
            links.append({
                'sourcePk': mgr['pk'], 'targetPk': emp['pk'],
                'sourceCode': mgr['code'], 'targetCode': emp['code'],
                'relationship': 'reports_to_manager',
                'sourceEmail': f"{mgr['code'].lower()}@demo-company.co.th",
                'targetEmail': f"{emp['code'].lower()}@demo-company.co.th",
                'depth': 1,
            })
    
    # Update data
    data['identities'] = new_identities
    data['reportingLinks'] = links
    data['stats']['reportingLinkCount'] = len(links)
    dept_counts = Counter(e['department'] for e in new_identities)
    for d in data['departments']:
        d['employeeCount'] = dept_counts.get(d['name'], 0)
    
    with open(INPUT, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    # Print summary
    lvl = Counter(e['hierarchyDepth'] for e in new_identities)
    names = {0: 'LV0 CEO', 1: 'LV1 C-Level', 2: 'LV2 Mgrs/Sec/IT', 3: 'LV3 Staff'}
    print('═══ Landy Home Pyramid ═══')
    for l in sorted(lvl):
        print(f'{names[l]:<25} {lvl[l]:>3}  {"█"*min(lvl[l],60)}')
    print(f'{"Total":<25} {sum(lvl.values()):>3}')
    print(f'Links: {len(links)}')
    
    # C-Level reports
    for pk in [2, 3, 4, 1]:
        e = pmap[pk]
        reports = [pmap[rp] for rp in e['directReportPks']]
        print(f'\n{e["jobTitle"]} ({e["name"]}) → {len(reports)} reports')
        for r in reports[:8]:
            print(f'  ├── {r["jobTitle"]} ({r["name"]})')
        if len(reports) > 8:
            print(f'  └── ...+{len(reports)-8} more')
    
    print(f'\n✅ Done! Backup: {BACKUP}')

if __name__ == '__main__':
    main()
