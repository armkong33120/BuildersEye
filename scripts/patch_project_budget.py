#!/usr/bin/env python3
"""PATCH: Add budgetTHB, actualCostTHB, customerId to project-assignments.json"""
import json, random
from pathlib import Path

random.seed(42)
DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
assignments = json.loads((DATA_DIR / "project-assignments.json").read_text("utf-8"))
print(f"Loaded {len(assignments)} records")

PROJECT_BUDGETS = {
    "P01": (8_000_000, 80_000_000), "P02": (3_000_000, 25_000_000),
    "P03": (500_000, 5_000_000), "P04": (200_000, 2_000_000),
    "P05": (1_000_000, 8_000_000), "P06": (300_000, 3_000_000),
    "P07": (100_000, 1_000_000), "P08": (500_000, 5_000_000),
    "P09": (200_000, 2_000_000), "P10": (1_000_000, 10_000_000),
    "P11": (100_000, 1_500_000), "P12": (200_000, 2_000_000),
    "P13": (300_000, 3_000_000), "P14": (5_000_000, 50_000_000),
    "P15": (2_000_000, 20_000_000),
}

by_pid = {}
for a in assignments:
    pid = a["projectId"]
    if pid not in by_pid:
        by_pid[pid] = {"hasMistake": False}
    if a.get("hasMistake"):
        by_pid[pid]["hasMistake"] = True

for pid, info in by_pid.items():
    pt = "P01"
    b_min, b_max = PROJECT_BUDGETS.get(pt, (200_000, 2_000_000))
    budget = random.randint(b_min, b_max)
    is_completed = random.random() < 0.60
    if is_completed and info["hasMistake"]:
        actual = int(budget * random.uniform(1.05, 1.25))
    elif is_completed:
        actual = int(budget * random.uniform(0.90, 1.02))
    else:
        actual = int(budget * random.uniform(0.20, 0.70))
    cid = f"CUS{random.randint(1,40):03d}" if random.random() < 0.60 else None
    info["budget"] = budget
    info["actual"] = actual
    info["cid"] = cid

for a in assignments:
    info = by_pid[a["projectId"]]
    a["budgetTHB"] = info["budget"]
    a["actualCostTHB"] = info["actual"]
    a["customerId"] = info["cid"]

json.dump(assignments, open(DATA_DIR / "project-assignments.json", "w"), ensure_ascii=False, indent=2)
print(f"Patched {len(assignments)} records across {len(by_pid)} projects")
print(f"Sample: budget={assignments[0]['budgetTHB']}, actual={assignments[0]['actualCostTHB']}, customer={assignments[0]['customerId']}")