import { getHistory } from './chatMemory.js';

const PRONOUN_PATTERNS = /เขา|เธอ|คนนี้|เค้า|คนนั้น|ไอ้นี่|him|her|this person|that person|they/i;
const FOLLOW_UP_PATTERNS = /^แล้ว|^so |^and |^then |แล้ว.+ล่ะ|แล้ว.+เท่าไหร่|แล้ว.+บ้าง/i;

function extractEmployeeRef(text) {
  if (!text) return null;
  const empMatch = text.match(/EMP(\d{1,3})/i);
  if (empMatch) return { type: 'pk', value: parseInt(empMatch[1]) };
  const namePatterns = [
    /คือ\s*([ก-๙a-zA-Z]+\s+[ก-๙a-zA-Z]+)/,
    /ได้แก่\s*([ก-๙a-zA-Z]+\s+[ก-๙a-zA-Z]+)/,
    /—\s*([ก-๙a-zA-Z]+\s+[ก-๙a-zA-Z]+)/,
  ];
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match) return { type: 'name', value: match[1].trim() };
  }
  return null;
}

export function resolvePronouns(query, conversationId) {
  const hasPronouns = PRONOUN_PATTERNS.test(query);
  const isFollowUp = FOLLOW_UP_PATTERNS.test(query);
  if (!hasPronouns && !isFollowUp) return { resolved: false, query };
  const history = getHistory(conversationId);
  if (history.length === 0) return { resolved: false, query };
  let lastAssistantMsg = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') { lastAssistantMsg = history[i].content; break; }
  }
  if (!lastAssistantMsg) return { resolved: false, query };
  const ref = extractEmployeeRef(lastAssistantMsg);
  if (!ref) return { resolved: false, query };
  let enrichedQuery = query;
  if (ref.type === 'pk') enrichedQuery = query + ' (หมายถึง EMP' + String(ref.value).padStart(3, '0') + ')';
  else if (ref.type === 'name') enrichedQuery = query + ' (หมายถึง ' + ref.value + ')';
  return { resolved: true, query: enrichedQuery, ref };
}
