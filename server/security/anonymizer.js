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

    // KPI records
    const kpiRecs = records.filter(r => r.sheetName === 'KPI_OKR_History');
    if (kpiRecs.length > 0) {
      const latestKpi = kpiRecs[kpiRecs.length - 1]; // Last KPI record (most recent)
      // Since records may be mixed, find the one with the latest reviewPeriod
      const sortedKpis = kpiRecs.sort((a, b) => (b.rowNumber || 0) - (a.rowNumber || 0));
      const kpi = sortedKpis[0];
      const band = records.find(r => r.fieldName === 'performanceBand');
      const score = records.find(r => r.fieldName === 'kpiScore');
      if (score) empBlock += `  - KPI Score: ${score.content}\n`;
      if (band) empBlock += `  - Performance Band: ${band.content}\n`;
    }

    // Warning records
    const warnRecs = records.filter(r => r.sheetName === 'Warning_Disciplinary_History' && r.fieldName === 'severity');
    if (warnRecs.length > 0) {
      for (const wr of warnRecs) {
        // Find companion fields from same row
        const row = wr.rowNumber;
        const type = records.find(r => r.sheetName === 'Warning_Disciplinary_History' && r.fieldName === 'caseType' && r.rowNumber === row);
        const date = records.find(r => r.sheetName === 'Warning_Disciplinary_History' && r.fieldName === 'caseDate' && r.rowNumber === row);
        empBlock += `  - Warning: severity=${wr.content}, type=${type?.content || ''}, date=${date?.content || ''}\n`;
        if (totalChars > MAX_CHARS) break;
      }
    }

    // Training records
    const trainRecs = records.filter(r => r.sheetName === 'Learning_Development' && r.fieldName === 'trainingName');
    if (trainRecs.length > 0) {
      const incomplete = records.some(r => r.fieldName === 'completionStatus' && r.content === 'Incomplete');
      empBlock += `  - Trainings: ${trainRecs.length} total`;
      if (incomplete) empBlock += ` (incomplete)`;
      empBlock += '\n';
    }

    // Project records
    const projRecs = records.filter(r => r.sheetName === 'Project_History' && r.fieldName === 'projectId');
    if (projRecs.length > 0) {
      empBlock += `  - Projects:\n`;
      for (const pr of projRecs.slice(0, 5)) { // Limit to top 5 projects per employee to conserve space
        const row = pr.rowNumber;
        const role = records.find(r => r.sheetName === 'Project_History' && r.fieldName === 'role' && r.rowNumber === row)?.content || 'Member';
        const contrib = records.find(r => r.sheetName === 'Project_History' && r.fieldName === 'contributionSummary' && r.rowNumber === row)?.content || '';
        empBlock += `    * ${pr.content} (Role: ${role}, Contribution: ${contrib})\n`;
      }
    }

    parts.push(empBlock);
    totalChars += empBlock.length;
  }

  return parts.join('\n').slice(0, MAX_CHARS);
}