// sourceLinks.js — Data Source Link filtering for ingestion.
//
// The Data Source Link entity maps a source (file/sheet) to its owning employee.
// Ingestion (ingestExcel.js, registryIngest.js, onedriveSync.js) consults these
// links so that:
//   - disabled links are skipped (enabled !== false respected),
//   - duplicate ownership is prevented (a source owned by employee X is not
//     ingested as employee Y unless the link is marked shared).
//
// Backward compatible: when NO source link matches (or none exist), ingestion
// proceeds as before — source links only RESTRICT, never expand.

import { getSourceLinks } from './accessStore.js';
import { employeeKey } from './accessModel.js';

// Normalize a source id for matching (case-insensitive, slash-normalized).
function normSource(s) {
  return String(s ?? '').replace(/\\/g, '/').trim().toLowerCase();
}

// Find the source link governing a source (file path/name). Matches by full
// sourceId or by basename, so 'onedrive/EMP001.xlsx' matches 'EMP001.xlsx'.
export function findSourceLink(sourceId, links = getSourceLinks()) {
  const target = normSource(sourceId);
  if (!target) return null;
  const base = target.split('/').pop();
  return links.find((l) => {
    const ls = normSource(l.sourceId);
    if (!ls) return false;
    return ls === target || ls.split('/').pop() === base;
  }) || null;
}

// True if a source is enabled for ingestion (no link → enabled by default).
export function isSourceEnabled(sourceId, links = getSourceLinks()) {
  const link = findSourceLink(sourceId, links);
  return link ? link.enabled !== false : true;
}

// Resolve the owning employeeCode for a source (null if no link).
export function sourceOwner(sourceId, links = getSourceLinks()) {
  const link = findSourceLink(sourceId, links);
  return link ? employeeKey(link.employeeCode) : null;
}

// True if a source may be ingested for the given employeeCode. Respects
// enabled + duplicate-ownership. No matching link → allowed (backward compatible).
export function canIngestSource(sourceId, employeeCode, links = getSourceLinks()) {
  const link = findSourceLink(sourceId, links);
  if (!link) return true;
  if (link.enabled === false) return false;
  if (link.shared) return true;
  return employeeKey(link.employeeCode) === employeeKey(employeeCode);
}
