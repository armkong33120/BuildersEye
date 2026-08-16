# Data Source Governance — BuildersEye

Status flags: **[VERIFIED IN CODE]** · **[INFERRED FROM BEHAVIOR]** · **[PROPOSED FUTURE STATE]** · **[NOT YET IMPLEMENTED]**

## Source-link model
A `Data Source Link` binds a source to an employee or scope:

`employeeCode/scope`, `provider`, `fileId`, `fileName`, `drivePath`, `enabled`, `syncStatus`, `lastSyncedAt`, `contentVersion`, `hash`, `createdBy`, `updatedBy` **[VERIFIED IN CODE — accessModel.js / sourceLinks.js]**

## Governance rules
- **Duplicate ownership is prevented** unless explicitly allowed. **[VERIFIED IN CODE — adminService.js duplicate-ownership prevention; test_source_links passes]**
- **Enable/disable** a source is supported; disabled sources are not ingested. **[VERIFIED IN CODE — ingestion reads link enabled flag]**
- **Accessibility validation** before linking (source must be reachable). **[INFERRED FROM BEHAVIOR]**
- **Re-index is a protected operation** — triggered only through an authenticated admin action. **[VERIFIED IN CODE — admin routes gated by requireAuth + requireAdmin]**
- The 1:1 file↔employee assumption is removed; ownership lives in the link table. **[VERIFIED IN CODE — ingestExcel/onedriveSync edits]**

## Data flow
`CEO (admin) configures source-link → ingestion filters by enabled+ownership → chunks indexed with employeeCode/scope metadata → retrieval scoped pre-query → cache versioned`

## Not yet implemented / proposed
- Neon `data_source_links` table DDL + write-through. **[PROPOSED FUTURE STATE]**
- On-drive content-version diffing to skip unchanged re-indexes. **[PROPOSED FUTURE STATE]**
- OneDrive webhook-driven incremental sync on file change. **[PROPOSED FUTURE STATE]**