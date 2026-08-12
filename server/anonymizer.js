import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lazily load CONFIDENTIALITY_MAP from ingestExcel to avoid duplication
const CONFIDENTIALITY_MAP = {
  'Executive': 'Tier 1 — Strict',
  'HR & Admin': 'Tier 1 — Strict',
  'Finance & Accounting': 'Tier 1 — Strict',
  'Legal': 'Tier 1 — Strict',
  'IT': 'Tier 2 — Sensitive',
};

function getTier(confidentiality) {
  if (confidentiality === 'Tier 1 — Strict') return 1;
  if (confidentiality === 'Tier 2 — Sensitive') return 2;
  return 3;
}

export function anonymize(finalResults, flatIndex) {
  // Build mapping: real name → label, real code → ID_ label
  const nameMap = new Map();   // real name → Employee_A
  const reverseNameMap = new Map(); // Employee_A → real name
  const codeMap = new Map();   // EMP016 → ID_A
  const reverseCodeMap = new Map(); // ID_A → EMP016
  const emailRegex = /\b[\w.-]+@[\w.-]+\.\w+\b/g;

  let labelIdx = 0;
  const labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  
  function nextLabel() {
    if (labelIdx < 26) return 'Employee_' + labels[labelIdx];
    return 'Employee_' + labels[Math.floor(labelIdx / 26) - 1] + labels[labelIdx % 26];
  }

  // Scan all results to collect unique employees
  const seenPks = new Set();
  let highestTier = 3;

  for (const entry of finalResults) {
    const pk = entry.employeeId;
    if (seenPks.has(pk)) continue;
    seenPks.add(pk);

    // Find employee records from flatIndex
    const nameRec = entry.matchedRecords?.find(
      r => r.sheetName === 'Employee_Profile' && r.fieldName === 'name'
    );
    const deptRec = entry.matchedRecords?.find(
      r => r.sheetName === 'Employee_Profile' && r.fieldName === 'department'
    );
    const codeRec = entry.matchedRecords?.find(
      r => r.sheetName === 'Employee_Profile' && r.fieldName === 'code'
    );

    const realName = nameRec?.content || 'Unknown';
    const realCode = codeRec?.content || '';
    const dept = deptRec?.content || '';
    const confidentiality = entry.matchedRecords?.[0]?.confidentialityLevel || 
                           CONFIDENTIALITY_MAP[dept] || 'Tier 3 — Standard';
    
    const tier = getTier(confidentiality);
    if (tier < highestTier) highestTier = tier;

    if (realName && !nameMap.has(realName)) {
      const label = nextLabel();
      nameMap.set(realName, label);
      reverseNameMap.set(label, realName);
      labelIdx++;
    }
    if (realCode && !codeMap.has(realCode)) {
      const idLabel = 'ID_' + labels[labelIdx > 25 ? Math.floor((labelIdx-26)/26) : labelIdx % labels.length];
      codeMap.set(realCode, idLabel);
      reverseCodeMap.set(idLabel, realCode);
    }
  }

  const tierLabel = ['', 'Tier 1 — Strict', 'Tier 2 — Sensitive', 'Tier 3 — Standard'][highestTier];

  // Build anonymized context
  let context = buildContext(finalResults, flatIndex);
  
  // Replace real names with labels
  for (const [realName, label] of nameMap) {
    context = context.replaceAll(realName, label);
  }
  // Replace real codes with ID_ labels
  for (const [realCode, idLabel] of codeMap) {
    context = context.replaceAll(realCode, idLabel);
  }
  // Replace emails
  context = context.replaceAll(emailRegex, '[email]');

  return {
    anonymizedContext: context,
    mapping: { nameMap: Object.fromEntries(nameMap), reverseNameMap: Object.fromEntries(reverseNameMap) },
    codeMapping: { codeMap: Object.fromEntries(codeMap), reverseCodeMap: Object.fromEntries(reverseCodeMap) },
    tier: tierLabel,
  };
}

export function deAnonymize(text, mapping) {
  let result = text || '';
  if (!result) return '';
  
  // Restore real names from Employee_A labels
  const reverseNameMap = mapping?.reverseNameMap || {};
  for (const [label, realName] of Object.entries(reverseNameMap)) {
    result = result.replaceAll(label, realName);
  }
  
  // Restore real codes from ID_A labels
  const reverseCodeMap = mapping?.reverseCodeMap || {};
  for (const [idLabel, realCode] of Object.entries(reverseCodeMap)) {
    result = result.replaceAll(idLabel, realCode);
  }
  
  return result;
}

export function buildContext(finalResults, flatIndex) {
  const parts = [];
  let totalChars = 0;
  const MAX_CHARS = 8000;

  // Group records by (sheet, rowNumber) → dict of fieldName → content
  function rowMap(records, sheet) {
    const map = new Map();
    for (const r of records) {
      if (r.sheetName !== sheet) continue;
      const key = r.rowNumber || 0;
      if (!map.has(key)) map.set(key, {});
      map.get(key)[r.fieldName] = r.content;
    }
    return map;
  }
  const rowAt = (map, row, field) => map.get(row)?.[field] ?? '';

  for (const entry of finalResults) {
    if (totalChars >= MAX_CHARS) break;

    // Pull full employee records from flatIndex to give LLM complete context
    const records = flatIndex.filter(r => r.employeeId === entry.employeeId);
    const nameRec = records.find(r => r.fieldName === 'name');
    const deptRec = records.find(r => r.fieldName === 'department');
    const titleRec = records.find(r => r.fieldName === 'jobTitle');
    const codeRec = records.find(r => r.fieldName === 'code');

    const name = nameRec?.content || 'Unknown';
    const dept = deptRec?.content || 'Unknown';
    const title = titleRec?.content || '';
    const code = codeRec?.content || '';

    let empBlock = `${name} (${code}, department: ${dept}, title: ${title}):\n`;

    // ── KPI / OKR ──
    const kpiMap = rowMap(records, 'KPI_OKR_History');
    const kpiRows = [...kpiMap.keys()].sort((a, b) => b - a);
    if (kpiRows.length > 0) {
      const latest = kpiMap.get(kpiRows[0]) || {};
      empBlock += `  - KPI Score: ${latest.kpiScore ?? ''} | Band: ${latest.performanceBand ?? ''} | Review: ${latest.reviewPeriod ?? ''}\n`;
      // managerFeedback ของ 2 ช่วงล่าสุด (ข้อมูลที่เป็นธรรมชาติที่สุด)
      for (const row of kpiRows.slice(0, 2)) {
        const fb = rowAt(kpiMap, row, 'managerFeedback');
        if (fb) empBlock += `  - managerFeedback: ${fb}\n`;
      }
    }

    // ── Warning / Disciplinary ──
    const warnMap = rowMap(records, 'Warning_Disciplinary_History');
    const warnRows = [...warnMap.keys()].slice(0, 3);
    for (const row of warnRows) {
      const w = warnMap.get(row) || {};
      empBlock += `  - Warning: severity=${w.severity ?? ''}, type=${w.caseType ?? ''}, date=${w.caseDate ?? ''} | ${w.summary ?? ''}\n`;
    }

    // ── Training ──
    const trainRecs = records.filter(r => r.sheetName === 'Learning_Development' && r.fieldName === 'trainingName');
    if (trainRecs.length > 0) {
      const incomplete = records.some(r => r.fieldName === 'completionStatus' && r.content === 'Incomplete');
      empBlock += `  - Trainings: ${trainRecs.length} total${incomplete ? ' (มีรายการไม่จบ)' : ''}\n`;
    }

    // ── Project_History (รวม mistakeIssue ที่ enrich มา) ──
    const projMap = rowMap(records, 'Project_History');
    const projRows = [...projMap.keys()].slice(0, 4);
    if (projRows.length > 0) {
      empBlock += `  - Projects:\n`;
      for (const row of projRows) {
        const p = projMap.get(row) || {};
        const mistake = p.mistakeIssue ? ` | MISTAKE: ${p.mistakeIssue}` : '';
        const recovery = p.recoveryAction ? ` | FIX: ${p.recoveryAction}` : '';
        empBlock += `    * ${p.projectId ?? ''} (Role: ${p.role ?? 'Member'}, ${p.contributionSummary ?? ''})${mistake}${recovery}\n`;
      }
    }

    // ── Timesheet_Log (OT / เทปูน / missing punch) ──
    const tsMap = rowMap(records, 'Timesheet_Log');
    const tsRows = [...tsMap.keys()].filter(r => tsMap.get(r)?.Notes || tsMap.get(r)?.Overtime_Hours).slice(0, 3);
    for (const row of tsRows) {
      const t = tsMap.get(row) || {};
      empBlock += `  - Timesheet: admin=${t.Admin_Hours_Pct ?? ''}% billable=${t.Billable_Hours_Pct ?? ''}% OT=${t.Overtime_Hours ?? 0}h missingPunch=${t.Missing_Punch ?? 'No'} | ${t.Notes ?? ''}\n`;
    }

    // ── Expense_Reports (line items ที่ enrich) ──
    const expMap = rowMap(records, 'Expense_Reports');
    const expRows = [...expMap.keys()].filter(r => expMap.get(r)?.Description).slice(0, 3);
    for (const row of expRows) {
      const e = expMap.get(row) || {};
      empBlock += `  - Expense: [${e.Category ?? ''}] ${e.Description ?? ''} (${e.Amount_THB ?? ''} THB, ${e.Status ?? ''})\n`;
    }

    // ── IT_Ticket_Log (defect / จอฟ้า / ransomware / เน็ต) ──
    const itMap = rowMap(records, 'IT_Ticket_Log');
    const itRows = [...itMap.keys()].filter(r => itMap.get(r)?.Description || itMap.get(r)?.Ticket_Issue).slice(0, 3);
    for (const row of itRows) {
      const i = itMap.get(row) || {};
      empBlock += `  - IT Ticket: ${i.Ticket_Issue ?? ''} (${i.Status ?? ''}) | ${i.Description ?? ''}${i.Priority ? ` | priority=${i.Priority}` : ''}\n`;
    }

    // ── Grievance_Log ──
    const grMap = rowMap(records, 'Grievance_Log');
    const grRows = [...grMap.keys()].filter(r => grMap.get(r)?.Description).slice(0, 2);
    for (const row of grRows) {
      const g = grMap.get(row) || {};
      empBlock += `  - Grievance: [${g.Complaint_Type ?? ''}] ${g.Description ?? ''} (${g.Status ?? ''})\n`;
    }

    // ── Compliance_Mandates ──
    const cmMap = rowMap(records, 'Compliance_Mandates');
    const cmRows = [...cmMap.keys()].filter(r => cmMap.get(r)?.Details).slice(0, 2);
    for (const row of cmRows) {
      const c = cmMap.get(row) || {};
      empBlock += `  - Compliance: ${c.Mandate ?? ''} (${c.Status ?? ''}) | ${c.Details ?? ''}\n`;
    }

    // ── Attendance_Record (notes) ──
    const attRows = records.filter(r => r.sheetName === 'Attendance_Record' && r.fieldName === 'Notes' && r.content);
    for (const a of attRows.slice(0, 1)) {
      empBlock += `  - Attendance Note: ${a.content}\n`;
    }

    // ── Skill_Matrix (top 3) ──
    const skillMap = rowMap(records, 'Skill_Matrix');
    const skillRows = [...skillMap.keys()].slice(0, 3);
    if (skillRows.length > 0) {
      const names = skillRows.map(r => rowAt(skillMap, r, 'Core_Skill')).filter(Boolean);
      if (names.length) empBlock += `  - Skills: ${names.join(', ')}\n`;
    }

    parts.push(empBlock);
    totalChars += empBlock.length;
  }

  return parts.join('\n').slice(0, MAX_CHARS);
}
