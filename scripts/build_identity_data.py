#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = APP_ROOT.parent
SOURCE_JSON = WORKSPACE_ROOT / "visibility-3d-web" / "src" / "data" / "graph-data.json"
OUTPUT_JSON = APP_ROOT / "src" / "data" / "identity-graph.json"

MAIL_DOMAIN = "demo-company.co.th"
TENANT = "demo-company"


def slug(value: str) -> str:
    text = value.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "company"


def dept_slug(value: str) -> str:
    return slug(value.replace("&", "and"))


def license_for(employee: dict[str, Any]) -> str:
    role = str(employee.get("roleGroup") or "")
    title = str(employee.get("jobTitle") or "")
    if role in {"CEO", "COO", "CFO", "Head_of_Sales", "Head_of_Construction"}:
        return "M365 E5"
    if re.search(r"Manager|Lead|Head|Director", title, re.I):
        return "M365 E3"
    if employee.get("department") in {"IT", "Legal", "Finance / Accounting"}:
        return "M365 E3"
    return "M365 Business Standard"


def quota_for(license_name: str) -> tuple[int, int]:
    if license_name == "M365 E5":
        return 100, 2048
    if license_name == "M365 E3":
        return 100, 1024
    return 50, 512


def account_risk(employee: dict[str, Any]) -> str:
    depth = len(employee.get("managerChainPks") or [])
    if employee.get("roleGroup") in {"CEO", "COO", "CFO"}:
        return "Privileged"
    if employee.get("department") in {"IT", "Finance / Accounting", "Legal"}:
        return "Sensitive"
    if depth >= 4:
        return "Standard"
    return "Elevated"


def main() -> None:
    source = json.loads(SOURCE_JSON.read_text(encoding="utf-8"))
    employees_raw = source["employees"]
    departments_raw = source["departments"]
    employees_by_pk = {employee["pk"]: employee for employee in employees_raw}
    children_by_manager: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for employee in employees_raw:
        manager_pk = employee.get("managerPk")
        if manager_pk:
            children_by_manager[int(manager_pk)].append(employee)

    department_counts = Counter(employee["department"] for employee in employees_raw)
    departments = []
    for department in departments_raw:
        departments.append(
            {
                "name": department["name"],
                "slug": dept_slug(department["name"]),
                "color": department["color"],
                "employeeCount": department_counts[department["name"]],
            }
        )

    identities = []
    for employee in sorted(employees_raw, key=lambda item: item["pk"]):
        code = employee["code"].lower()
        local_part = f"{code}.{dept_slug(employee['department'])}"
        email = f"{local_part}@{MAIL_DOMAIN}"
        one_drive_path = email.replace("@", "_").replace(".", "_")
        license_name = license_for(employee)
        mailbox_quota_gb, drive_quota_gb = quota_for(license_name)
        manager = employees_by_pk.get(employee.get("managerPk"))
        direct_reports = sorted(children_by_manager.get(employee["pk"], []), key=lambda item: item["pk"])
        depth = 0 if employee["pk"] == source["ceo"]["pk"] else len(employee.get("managerChainPks") or [])
        identities.append(
            {
                "pk": employee["pk"],
                "code": employee["code"],
                "name": employee["name"],
                "department": employee["department"],
                "jobTitle": employee["jobTitle"],
                "roleGroup": employee.get("roleGroup") or "Employee",
                "managerPk": employee.get("managerPk"),
                "managerCode": manager.get("code") if manager else "",
                "managerName": manager.get("name") if manager else "",
                "managerJobTitle": manager.get("jobTitle") if manager else "",
                "directReportPks": [report["pk"] for report in direct_reports],
                "directReportCount": len(direct_reports),
                "managerChainPks": employee.get("managerChainPks") or [],
                "subtreePks": employee.get("subtreePks") or [employee["pk"]],
                "hierarchyDepth": depth,
                "email": email,
                "mailAlias": local_part,
                "mailDomain": MAIL_DOMAIN,
                "oneDriveUrl": f"https://{TENANT}-my.sharepoint.com/personal/{one_drive_path}",
                "oneDriveOwner": email,
                "licensePlan": license_name,
                "mailboxQuotaGb": mailbox_quota_gb,
                "oneDriveQuotaGb": drive_quota_gb,
                "mfaStatus": "Required",
                "accountStatus": "Active",
                "accountRisk": account_risk(employee),
                "lastDirectorySync": "2026-06-26T08:00:00+07:00",
            }
        )

    identity_by_pk = {identity["pk"]: identity for identity in identities}
    reporting_links = []
    for identity in identities:
        if not identity["managerPk"]:
            continue
        manager = identity_by_pk[identity["managerPk"]]
        reporting_links.append(
            {
                "sourcePk": manager["pk"],
                "targetPk": identity["pk"],
                "sourceCode": manager["code"],
                "targetCode": identity["code"],
                "relationship": "reports_to_manager",
                "sourceEmail": manager["email"],
                "targetEmail": identity["email"],
                "depth": identity["hierarchyDepth"],
            }
        )

    graph = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": str(SOURCE_JSON.relative_to(WORKSPACE_ROOT)),
        "mailDomain": MAIL_DOMAIN,
        "tenant": TENANT,
        "ceoPk": source["ceo"]["pk"],
        "departments": departments,
        "identities": identities,
        "reportingLinks": reporting_links,
        "stats": {
            "employeeCount": len(identities),
            "reportingLinkCount": len(reporting_links),
            "departmentCount": len(departments),
            "mailDomainCount": 1,
            "oneDriveSiteCount": len(identities),
            "maxDepth": max(identity["hierarchyDepth"] for identity in identities),
            "licenses": dict(Counter(identity["licensePlan"] for identity in identities)),
            "risks": dict(Counter(identity["accountRisk"] for identity in identities)),
        },
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")
    print(OUTPUT_JSON)
    print(
        "identities={employeeCount} links={reportingLinkCount} departments={departmentCount}".format(
            **graph["stats"]
        )
    )


if __name__ == "__main__":
    main()
