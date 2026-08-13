// sqlRouting.js — Pure SQL-routing intent detection.
//
// Extracted from chatController so the routing decision is testable in
// isolation (no LLM / DB / index dependencies). chatController imports these
// helpers to decide whether a query warrants the SQL analytics path.
//
// SECURITY/CORRECTNESS: qualitative questions containing ปัญหา / ความเสี่ยง /
// จุดอ่อน (or วิกฤต / เสี่ยง) must NOT auto-route to SQL — they are keyword /
// vector questions. Only clear analytics intent triggers SQL.

// Genuine analytics-intent terms: aggregate / compare / statistical phrasing
// plus concrete data-field words that map to SQL-backed sheets.
const ANALYTICS_INTENT_RE = /average|avg|เฉลี่ย|mean|group by|compare|เทียบ|เปรียบเทียบ|standard deviation|sum|count|percentage|เปอร์เซ็นต์|highest|lowest|สูงสุด|ต่ำสุด|trend|แนวโน้ม|monthly|yearly|รายเดือน|รายปี|รวม|เท่าไหร่|กี่ชิ้น|กี่คน|นับ|เงินเดือน|โบนัส|ขึ้นเงินเดือน|ลาป่วย|ลากิจ|มาสาย|notebook|cost_thb|base_salary|sick_leave|attendance|asset|license|salary|bonus|สรุป|อุปกรณ์|เป็นเงิน|มูลค่า|ลาออก|ลาออกจากงาน|เทิร์นโอเวอร์|turnover|อัตราการ/i;

// Qualitative trigger words that previously caused false-positive SQL routing.
const QUALITATIVE_QUERY_RE = /ปัญหา|วิกฤต|ความเสี่ยง|เสี่ยง|จุดอ่อน/i;

export function isQualitativeQuery(query) {
  return !!query && QUALITATIVE_QUERY_RE.test(query);
}

export function detectSqlAnalyticsIntent(query) {
  if (!query) return false;
  if (QUALITATIVE_QUERY_RE.test(query)) return false; // qualitative wins — never route to SQL
  return ANALYTICS_INTENT_RE.test(query);
}
