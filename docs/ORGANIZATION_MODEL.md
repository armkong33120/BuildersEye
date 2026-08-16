# Organization Model — BuildersEye

Status flags: **[VERIFIED IN CODE]** · **[INFERRED FROM BEHAVIOR]** · **[PROPOSED FUTURE STATE]** · **[NOT YET IMPLEMENTED]**

## Summary
The organization is a directed graph of temporal edges between `employeeCode` values. Depth is **computed, never stored**, so arbitrary hierarchies and multiple C-Level roots are supported natively.

```
ceo/coo/cfo/cto  (GLOBAL_ADMIN, root(s))
  └── manager      (TEAM_MANAGER, scope=SUBTREE)
       ├── lead    (TEAM_MANAGER or SELF_ONLY per profile)
       │   └── junior (SELF_ONLY)
```

## Entities
- **Employee**: `employeeCode` (stable immutable PK), `employeeId` (legacy numeric, nullable), `name`, `jobTitle`, `department`, `managerCode` (denormalized current manager), `employmentStatus` (active|inactive|terminated|on_leave|removed), `accessProfile`, `effectiveFrom/To`, `version`, audit fields. **[VERIFIED IN CODE — accessModel.js]**
- **Organization Relationship**: `employeeCode`, `managerCode`, `relationshipType`, `effectiveFrom/To`, `version`. **[VERIFIED IN CODE]**

## Hierarchy behavior
- Arbitrary depth via BFS in `scopeResolver.js`. **[VERIFIED IN CODE]**
- Cycle detection via a visited set — a cycle never causes infinite loop. **[VERIFIED IN CODE]**
- Move employee / change manager / deactivate are non-destructive via temporal edges. **[VERIFIED IN CODE — temporal validity + versioning]**
- Multiple C-Level roots supported (`rootPks[]`, not a single `ceo`). **[VERIFIED IN CODE — scopeResolver multi-root]**
- Removing the fixed **150** and **EMP\d{3}** assumptions (employeeCode derived from file *content*, configurable `REGISTRY_FILE_PATTERN`). **[VERIFIED IN CODE — ingestExcel/onedriveSync/searchIndex/chatController edits]**

## Not implemented / proposed
- Neon table DDL + idempotent migration script for prod write-through. **[PROPOSED FUTURE STATE]**
- Full decommission of `subtreePks`/`directReportPks`/`hierarchyDepth` for authz (kept for 3D viz only). **[PROPOSED FUTURE STATE]**