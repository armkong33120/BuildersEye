import 'dotenv/config';
import { search } from './searchIndex.js';
import { checkQueryPolicy, resolveScope, applyFieldRedaction } from './policy.js';
import { anonymize, deAnonymize, buildContext } from './anonymizer.js';
import { parseIntentSemantically } from './semanticParser.js';
import { parseIntent } from './intentParser.js';
import { addMessage, getHistory } from './chatMemory.js';
import { resolvePronouns } from './pronounResolver.js';
import { generateAnswer, isLLMAvailable } from './llmClient.js';
import { generateAndRunSQL, isDBReady } from './sqlEngine.js';
// หมายเหตุ: ไม่ใช้ semanticSearch จาก vectorEngine.js แล้ว (มัน embed ด้วย text-embedding-3-small
// ผ่าน DeepSeek → 404 + มิติผิด 1536 vs 384) — ใช้ production path embedOne + searchVectors แทน
import { cacheKeyFor, cacheGet, cacheSet } from './responseCache.js';

export async function chatHandler(query, viewer, { flatIndex, searchIndex, identityGraph }, conversationId = '') {
  const startTime = Date.now();
  const viewerRole = viewer?.role || 'CEO';
  const viewerPk = viewer?.employeeId || 1;

  const qp = checkQueryPolicy(query, viewerRole);
  if (qp.status === 'Blocked') {
    return { query, answer: 'Query blocked by governance policy.', suggestedOptions: [],
      matchedEmployeePks: [], matchedDepartments: [], results: [], sources: [],
      policy: qp, scan: { employeePks: [], highlightEdges: false, sourcePk: 1, durationMs: 0 },
      scannedFileCount: 0, responseTimeMs: Date.now() - startTime, matchersUsed: [] };
  }

  // LOOP 15: SQL analytics detection (LOOP 20: expanded for HR/IT)
  const needsSqlAnalytics = /average|avg|เฉลี่ย|mean|group by|compare|เทียบ|เปรียบเทียบ|standard deviation|เงินเดือน|โบนัส|ขึ้นเงินเดือน|ลาป่วย|ลากิจ|มาสาย|notebook|cost_thb|base_salary|sick_leave|attendance|asset|license|salary|bonus|สรุป|อุปกรณ์|เป็นเงิน|รวม|เท่าไหร่|มูลค่า|กี่ชิ้น|ปัญหา|วิกฤต|ความเสี่ยง|เสี่ยง|จุดอ่อน|ลาออก|ลาออกจากงาน|เทิร์นโอเวอร์|turnover|อัตราการ/i.test(query);

  // Pronoun resolution (LOOP 13C — deterministic)
  const pronounResult = resolvePronouns(query, conversationId);
  const resolvedQuery = pronounResult.resolved ? pronounResult.query : query;

  // Response cache for repeated questions (cost reduction). Only active when the
  // LLM is on; keyed by resolved query + viewer role/employeeId (scope-dependent).
  // Placed BEFORE semantic parsing/search so repeated questions skip all LLM work.
  const useCache = isLLMAvailable();
  if (useCache) {
    const ck = cacheKeyFor(resolvedQuery, viewer);
    const cached = cacheGet(ck);
    if (cached) {
      addMessage(conversationId, 'user', query);
      addMessage(conversationId, 'assistant', cached.answer);
      return { ...cached, cached: true, responseTimeMs: Date.now() - startTime };
    }
  }

  // Semantic parsing (LOOP 12)
  let parsedIntent = null;
  try {
    parsedIntent = await parseIntentSemantically(resolvedQuery, { role: viewerRole, employeeId: viewerPk }, flatIndex, conversationId);
  } catch (e) {}
  const suggestedOptions = parsedIntent?.suggestedOptions || [];

  // Check for clarification request
  if (parsedIntent && parsedIntent.isClarification) {
    addMessage(conversationId, 'user', query);
    addMessage(conversationId, 'assistant', parsedIntent.clarificationMessage || 'Please clarify your query.');
    return {
      query, answer: parsedIntent.clarificationMessage || 'Please clarify your query.',
      suggestedOptions: parsedIntent.suggestedOptions || [],
      matchedEmployeePks: [], matchedDepartments: [], results: [], sources: [],
      policy: { status: 'Allowed', redactedCount: 0, blockedCount: 0 },
      scan: { employeePks: [], highlightEdges: false, sourcePk: 1, durationMs: 0 },
      scannedFileCount: 0, responseTimeMs: Date.now() - startTime,
      matchersUsed: [], _parsedIntent: parsedIntent,
      llmUsed: false, answerSource: 'clarification',
    };
  }

  // RBAC: scope สำหรับ keyword/analytics path (searchIndex ใช้กรอง ANALYTICS_MIN/MAX/filter)
  // — scopeCodes เดียวกับ SQL path เพื่อให้ทุก path มีขอบเขตเท่ากัน; viewerRole สำหรับ template redaction
  const analyticsScopeCodes = buildScopeCodesForRole(viewerRole, viewerPk, identityGraph);
  const sr = search(resolvedQuery, { flatIndex, searchIndex }, parsedIntent, analyticsScopeCodes, viewerRole);
  const matchedPks = []; const matchedDepts = new Set(); const finalResults = [];
  let redactedCount = 0; let blockedCount = 0;

  for (const entry of sr.results) {
    const pk = entry.employeeId;
    if (!resolveScope(viewerRole, viewerPk, pk, identityGraph)) { blockedCount++; continue; }
    matchedPks.push(pk);
    const dept = entry.matchedRecords?.[0]?.department;
    if (dept) matchedDepts.add(dept);
    const filtered = entry.matchedRecords.map(r => {
      const redacted = applyFieldRedaction(r, viewerRole, viewerPk, pk);
      if (redacted.redacted) redactedCount++;
      return redacted;
    }).filter(r => r.content !== '[Redacted — Scope]');
    finalResults.push({ ...entry, matchedRecords: filtered });
  }

  const policy = { status: redactedCount > 0 ? 'Redacted' : 'Allowed', redactedCount, blockedCount };
  const sources = sr.sources || [];

  // Fallback: extract employee PKs from flatIndex when primary loop yields empty
  if (matchedPks.length === 0 && matchedDepts.size > 0) {
    for (const dept of matchedDepts) {
      for (const rec of flatIndex) {
        if (rec.department === dept && !matchedPks.includes(rec.employeeId)) {
          matchedPks.push(rec.employeeId);
        }
      }
    }
  }
  // Second fallback: extract from search result sources
  if (matchedPks.length === 0 && sources.length > 0) {
    for (const src of sources) {
      const match = src.fileName?.match(/EMP(\d{3})/i);
      if (match) {
        const pk = parseInt(match[1]);
        if (!matchedPks.includes(pk)) matchedPks.push(pk);
      }
    }
  }

  // LLM answer generation & SQL Routing
  let answer = sr.answer;
  let llmUsed = false;
  let sqlUsed = false;
  const isAnalytics = sr.matchersUsed?.some(m => m.startsWith('analytics-'));
  const isCount = parsedIntent?.isCount === true;
  const isTextToSql = parsedIntent?.intents?.some(i => i.type === 'TEXT_TO_SQL');
  const isExactEmployeeQuery = /EMP\d{3}/i.test(query);
  const shouldRouteSql = isTextToSql || (needsSqlAnalytics && !isExactEmployeeQuery);

  if (shouldRouteSql) {
    let sqlRes;
    // RBAC: ส่ง viewer scope เข้า SQL path (Layer 1+2) — generateAndRunSQL สร้าง scoped table
    // scopeCodes: null=CEO/HR เห็นทั้งหมด | Set<code>=Employee/Manager (จาก identityGraph subtree)
    const scopeCodes = buildScopeCodesForRole(viewerRole, viewerPk, identityGraph);
    try { sqlRes = await generateAndRunSQL(query, { viewerRole, viewerPk, scopeCodes }); } 
    catch (e) { sqlRes = { error: e.message }; }
    
    // Extract employee PKs from SQL results for graph highlighting
    if (sqlRes.data && Array.isArray(sqlRes.data)) {
      for (const row of sqlRes.data) {
        if (!row || typeof row !== 'object') continue; // alasql อาจคืน undefined elements
        if (row.employeeId && !matchedPks.includes(row.employeeId)) matchedPks.push(row.employeeId);
        if (row.department) matchedDepts.add(row.department);
      }
    }

    // Layer 3 — Field/Row Redaction + post-query scope verify (defense-in-depth):
    // ต่อให้ scoped table ทำงานผิด ตรงนี้ก็ดรอปแถว/field ที่นอกสิทธิ์ก่อนส่ง LLM
    let safeData = sqlRes.data;
    if (Array.isArray(safeData)) {
      safeData = safeData.map((row) => {
        if (!row || typeof row !== 'object') return row; // กัน undefined elements
        // post-query scope verify: ถ้าแถวมี employeeCode แต่นอก scope → drop
        if (scopeCodes && row.employeeCode && !scopeCodes.has(row.employeeCode)) return null;
        // field redaction (เหมือน keyword path) — Manager/Employee
        if (row.sheetName && row.fieldName) {
          const red = applyFieldRedaction({ ...row }, viewerRole, viewerPk, row.employeeId);
          if (red.redacted) { redactedCount++; row.content = red.content; }
        }
        return row;
      }).filter(Boolean);
    }

    const contextData = sqlRes.error 
      ? `Failed to compute SQL: ${sqlRes.error}` 
      : `SQL Query used: ${sqlRes.sql}\nResult Data: ${JSON.stringify(safeData)}`;
      
    const finalLLMAnswer = await generateAnswer(query, "Here is the raw data you must format into a natural Thai answer:\n" + contextData);
    if (finalLLMAnswer) {
      answer = finalLLMAnswer;
      llmUsed = true;
      sqlUsed = true;
    } else { answer = contextData; }
  } 
  else if (parsedIntent?.intents?.some(i => i.type === 'VECTOR_SEARCH') || (finalResults.length === 0 && !parsedIntent?.isClarification)) {
    // Vector search ผ่าน production path: localEmbedder (e5-small) + vectorStore
    // — ไม่ใช้ vectorEngine.semanticSearch เก่า (OpenAI model ผ่าน DeepSeek → 404 + มิติผิด)
    try {
      const { embedOne } = await import('./localEmbedder.js');
      const { searchVectors } = await import('./vectorStore.js');
      const allowSensitive = viewerRole === 'CEO' || viewerRole === 'HR';
      const qv = await embedOne(resolvedQuery, { isQuery: true });
      const out = await searchVectors(qv, { k: 15, scopeCodes: null, allowSensitive, whoBias: /ใคร|คนไหน|บุคคล/.test(query) });
      const vectorHits = (out.results || []).filter(h => resolveScope(viewerRole, viewerPk, h.meta?.pk, identityGraph));
      if (vectorHits.length > 0) {
        // Extract employee PKs from vector hits for graph highlighting
        for (const hit of vectorHits) {
          const pk = hit.meta?.pk || hit.meta?.employeeId;
          if (pk && !matchedPks.includes(pk)) matchedPks.push(pk);
          if (hit.meta?.department) matchedDepts.add(hit.meta.department);
        }
        const contextData = vectorHits.map(h => h.text).join('\n');
        const vectorPrompt = "Use the following context to answer the user's question politely in Thai.\nContext:\n" + contextData;
        const finalLLMAnswer = await generateAnswer(query, vectorPrompt);
        if (finalLLMAnswer) {
          answer = finalLLMAnswer;
          llmUsed = true;
          sr.matchersUsed = ['vector-search'];
        }
      }
    } catch (e) {
      // vector failure ต้องไม่ทำ chat 500 — fallback เป็น keyword answer เดิม
      console.warn('[vector] search failed, keep keyword answer:', e.message);
    }
  }
  else if (isLLMAvailable() && finalResults.length > 0) {
    try {
      const { anonymizedContext, mapping, tier } = anonymize(finalResults, flatIndex);

      if (tier !== 'Tier 1 — Strict') {
        let contextForLLM = anonymizedContext;
        if (isCount) contextForLLM = 'Total count: ' + finalResults.length + ' employees found.\n\n' + contextForLLM;
        const llmAnswer = await generateAnswer(query, contextForLLM);
        if (llmAnswer) {
          answer = deAnonymize(llmAnswer, mapping);
          llmUsed = true;
        }
      } else {
        let safeContext = sr.answer;
        if (isCount) safeContext = 'Total count: ' + finalResults.length + ' employees found.\n\n' + safeContext;
        
        const rewritePrompt = "Please rewrite the following system search result into a professional, natural, and polite conversational Thai response for an Executive. Do not change the facts. Answer as a helpful AI assistant. DO NOT use words like 'Found 1 matching employee'.\n\nRaw Data:\n" + safeContext;
        const llmAnswer = await generateAnswer(query, rewritePrompt);
        
        if (llmAnswer) {
          answer = llmAnswer; 
          llmUsed = true;
        }
      }
    } catch (e) { console.error('[llm] Error:', e.message); }
  }

  const finalAnswer = answer;

  // Save to conversation memory
  addMessage(conversationId, 'user', query);
  addMessage(conversationId, 'assistant', finalAnswer);

  const result = {
    query, answer: finalAnswer,
    suggestedOptions,
    matchedEmployeePks: matchedPks,
    matchedDepartments: [...matchedDepts],
    results: finalResults.slice(0, 10),
    sources: sources.slice(0, 10),
    policy,
    scan: { employeePks: matchedPks, highlightEdges: true, sourcePk: 1, durationMs: 5200 },
    scannedFileCount: new Set(flatIndex.map(r => r.employeeId)).size,
    responseTimeMs: Date.now() - startTime,
    matchersUsed: sr.matchersUsed,
    _parsedIntent: parsedIntent || parseIntent(query),
    llmUsed: llmUsed,
    sqlUsed: sqlUsed,
    answerSource: sqlUsed ? 'sql-analytics' : (llmUsed ? 'gemini' : 'template'),
  };

  // Cache LLM-produced answers only (repeated-question savings; skipped when LLM off).
  if (useCache && llmUsed) {
    cacheSet(cacheKeyFor(resolvedQuery, viewer), result);
  }

  return result;
}

// ── RBAC scope helper (SQL path) ──
// คืน Set ของ employee codes ที่ viewer มองเห็น (หรือ null = เห็นทั้งหมด CEO/HR)
// ใช้ identityGraph subtreePks/directReportPks (เดียวกับ resolveScope ใน keyword path)
// เพื่อให้ SQL path มีขอบเขตเท่ากัน keyword path เป๊ะ
export function buildScopeCodesForRole(viewerRole, viewerPk, identityGraph) {
  if (viewerRole === 'CEO' || viewerRole === 'HR') return null;
  if (!identityGraph?.identities) return new Set();
  const me = identityGraph.identities.find(e => e.pk === Number(viewerPk));
  if (!me?.code) return new Set();
  if (viewerRole === 'Employee') return new Set([me.code]);
  if (viewerRole === 'Manager') {
    const visible = new Set([me.code]);
    // subtreePks = ลูกน้องทุกชั้น (รวมตัวผู้จัดการเองในบางกรณี) — รวมทุก pk ที่ scope เห็น
    for (const pk of me.subtreePks || []) {
      const sub = identityGraph.identities.find(e => e.pk === Number(pk));
      if (sub?.code) visible.add(sub.code);
    }
    for (const pk of me.directReportPks || []) {
      const sub = identityGraph.identities.find(e => e.pk === Number(pk));
      if (sub?.code) visible.add(sub.code);
    }
    return visible;
  }
  return new Set();
}
