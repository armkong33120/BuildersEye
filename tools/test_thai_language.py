#!/usr/bin/env python3
"""BuildersEye Thai Language Evaluation Harness"""
import argparse, json, re, sys, time, urllib.request
from dataclasses import dataclass, asdict
from typing import Optional

# Chinese CJK Unified Ideographs (NOT including Thai)
CJK_RE = re.compile("[一-鿿]")  # Chinese only
THAI_RE = re.compile("[฀-๿]") # Thai only
ENGLISH_RE = re.compile(r"[a-zA-Z]{3,}")

def detect_languages(text: str) -> dict:
    return {
        "has_chinese": bool(CJK_RE.search(text)),
        "has_thai": bool(THAI_RE.search(text)),
        "has_english": bool(ENGLISH_RE.search(text)),
        "chinese_chars": len(CJK_RE.findall(text)),
        "thai_chars": len(THAI_RE.findall(text)),
    }

def score_language(text: str) -> int:
    lang = detect_languages(text)
    if lang["has_chinese"]: return 1
    if lang["has_english"] and lang["has_thai"]: return 3
    if lang["has_thai"] and not lang["has_english"]: return 5
    if not lang["has_thai"]: return 2
    return 4

def score_content(answer: str, expected_keywords: list) -> int:
    if not answer: return 0
    matched = sum(1 for kw in expected_keywords if kw.lower() in answer.lower())
    if matched == 0: return 1
    if matched <= len(expected_keywords) / 2: return 2
    if matched < len(expected_keywords): return 3
    return 5

def score_concision(text: str) -> int:
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    wc = len(text.split())
    if wc <= 30 and len(lines) <= 4: return 5
    if wc <= 80 and len(lines) <= 8: return 3
    return 1

def call_llm(base_url: str, api_key: str, model: str, sys_prompt: str,
             user_prompt: str, max_tokens=300, temp=0.3) -> dict:
    body = json.dumps({"model": model, "messages": [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": user_prompt}],
        "max_tokens": max_tokens, "temperature": temp}).encode()
    url = base_url.rstrip("/") + "/chat/completions"
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"})
    start = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=120)
        data = json.loads(resp.read())
        elapsed = round(time.time() - start, 2)
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return {"ok": True, "answer": content, "latency_s": elapsed, "error": None}
    except Exception as e:
        elapsed = round(time.time() - start, 2)
        return {"ok": False, "answer": "", "latency_s": elapsed, "error": str(e)[:200]}

# ---------------------------------------------------------------------------
# Test queries (Thai-English code-switching HR domain)
# ---------------------------------------------------------------------------
DEFAULT_QUERIES = [
    {"id":"Q01","query":"มีพนักงานในแผนก IT กี่คน","expected_keywords":["IT","คน"]},
    {"id":"Q02","query":"ค่าเฉลี่ยเงินเดือนของฝ่ายขายเท่าไหร่","expected_keywords":["เงินเดือน","ฝ่ายขาย"]},
    {"id":"Q03","query":"ใครได้ KPI สูงสุด","expected_keywords":["KPI","สูงสุด"]},
    {"id":"Q04","query":"average bonus ของแผนก IT เท่าไหร่","expected_keywords":["bonus","IT"]},
    {"id":"Q05","query":"ใครมา working ล่าช้า (late) มากที่สุด","expected_keywords":["late","ล่าช้า"]},
    {"id":"Q06","query":"เปรียบเทียบ KPI ของ department A กับ B","expected_keywords":["A","B","KPI"]},
    {"id":"Q07","query":"total travel expense ของทั้งบริษัท","expected_keywords":["travel","expense"]},
    {"id":"Q08","query":"ใครมี formal warning มากที่สุด","expected_keywords":["warning","มากที่สุด"]},
    {"id":"Q09","query":"แผนกไหนได้ revenue สูงสุด","expected_keywords":["revenue","สูงสุด"]},
    {"id":"Q10","query":"สรุปผลงานของแผนก IT ให้หน่อย","expected_keywords":["IT","แผนก"]},
]

HR_CONTEXT = """Employee_Profile: Employee_A (IT dept, salary 48000, bonus 2mo)
Employee_Profile: Employee_B (IT dept, salary 52000, KPI 4.6)
Employee_Profile: Employee_C (Sales dept, salary 45000, KPI 3.8)
Employee_Profile: Employee_D (Sales dept, salary 55000, KPI 4.2)
Employee_Profile: Employee_E (IT dept, salary 46000, KPI 4.0)
Employee_Profile: Employee_F (IT dept, salary 63000, KPI 3.9)
KPI_History: A=4.2 B=4.6 C=3.8 D=4.2 E=4.0 F=3.9
Disciplinary: A late=1, B late=2+warn, C=0, D=0"""

SYSTEM_PROMPT_CURRENT = """You are BuildersEye HR Analytics Assistant. Answer based ONLY on provided context.
Rules:
1. Answer in the same language as the question (Thai if asked in Thai)
2. Be specific — cite exact values (KPI scores, severity levels, performance bands)
3. Keep answers concise (2-4 sentences) and conversational
4. Do not make up information not in the context
5. Refer to employees by their labels (Employee_A, Employee_B, etc.)"""

SYSTEM_PROMPT_IMPROVED = """คุณคือ BuildersEye ผู้ช่วยวิเคราะห์ HR ตอบภาษาไทยเท่านั้น ห้ามใช้จีน
Absolutely NO Chinese characters. ONLY Thai language.

ตัวอย่าง:
Q: ใครได้ KPI สูงสุดในแผนก IT
A: ผู้ที่ได้ KPI สูงสุดในแผนก IT คือ Employee_B โดยมี KPI Score 4.6 ครับ
Q: average salary ของแผนก IT เท่าไหร่
A: ค่าเฉลี่ยเงินเดือนของแผนก IT อยู่ที่ 52,250 บาทครับ
Q: เปรียบเทียบ KPI ของ department A กับ B
A: เปรียบเทียบ KPI: Employee_A ได้ 4.2, Employee_B ได้ 4.6 — Employee_B สูงกว่าครับ

ตอบเป็นภาษาไทย กระชับ 2-3 ประโยค ใช้ข้อมูลจาก context เท่านั้น
ใช้ Employee_A, Employee_B แทนชื่อจริง ถ้ามีคำอังกฤษ (KPI, bonus, IT) ให้คงไว้ได้ แต่ตอบไทย"""


# ---------------------------------------------------------------------------
# Result data class
# ---------------------------------------------------------------------------
@dataclass
class Result:
    query_id: str
    query: str
    answer: str
    latency_s: float
    error: Optional[str]
    language_score: int
    content_score: int
    concision_score: int
    total_score: int
    has_chinese: bool
    has_thai: bool

def evaluate_one(result: Result) -> Result:
    langs = detect_languages(result.answer)
    result.has_chinese = langs["has_chinese"]
    result.has_thai = langs["has_thai"]
    result.language_score = score_language(result.answer)
    return result

# ---------------------------------------------------------------------------
# Evaluation runner
# ---------------------------------------------------------------------------
def run_evaluation(provider_name, base_url, api_key, model, system_prompt, queries):
    results = []
    print(f"\n{'='*65}")
    print(f"Testing: {provider_name}  |  model={model}")
    print(f"{'='*65}")
    for q in queries:
        user_prompt = f"Context:\n{HR_CONTEXT}\n\nคำถาม: {q['query']}"
        resp = call_llm(base_url, api_key, model, system_prompt, user_prompt)
        r = Result(query_id=q["id"], query=q["query"], answer=resp["answer"],
                   latency_s=resp["latency_s"], error=resp["error"],
                   language_score=0, content_score=0, concision_score=0, total_score=0,
                   has_chinese=False, has_thai=False)
        if resp["ok"]:
            r.content_score = score_content(resp["answer"], q["expected_keywords"])
            r.concision_score = score_concision(resp["answer"])
            evaluate_one(r)
            r.total_score = r.language_score + r.content_score + r.concision_score
        else:
            r.total_score = 0
        flag = "🔴 CJK" if r.has_chinese else ("🟢 TH" if r.has_thai else "⚠️ --")
        icon = "✅" if r.has_thai and not r.has_chinese else "❌"
        print(f"  {icon} {r.query_id} lang={r.language_score} cont={r.content_score} "
              f"conc={r.concision_score} total={r.total_score} | {r.latency_s}s | {flag}")
        if r.has_chinese:
            print(f"     CHINESE: {r.answer[:120]}...")

# ---------------------------------------------------------------------------
# A/B comparison
# ---------------------------------------------------------------------------
def print_ab_comparison(results_a, label_a, results_b, label_b):
    print(f"\n{'='*65}")
    print(f"A/B COMPARISON: {label_a}  vs  {label_b}")
    print(f"{'='*65}")
    print(f"{'QID':<6} {'Query':<32} {label_a[:8]:>8} {label_b[:8]:>8}  Winner")
    print(f"{'─'*6} {'─'*32} {'─'*8} {'─'*8}  {'─'*10}")
    aw = bw = tie = 0
    for ra, rb in zip(results_a, results_b):
        w = "─"
        if ra.total_score > rb.total_score:
            w = label_a.split()[0]; aw += 1
        elif rb.total_score > ra.total_score:
            w = label_b.split()[0]; bw += 1
        else:
            tie += 1
        print(f"{ra.query_id:<6} {ra.query[:30]:<32} {ra.total_score:>8} {rb.total_score:>8}  {w}")
    print(f"{'─'*6} {'─'*32} {'─'*8} {'─'*8}  {'─'*10}")
    a_avg = sum(r.total_score for r in results_a) / len(results_a)
    b_avg = sum(r.total_score for r in results_b) / len(results_b)
    print(f"  {label_a}: {aw} wins | {label_b}: {bw} wins | Tie: {tie}")
    print(f"  Avg — {label_a}: {a_avg:.1f}  vs  {label_b}: {b_avg:.1f}")

# ---------------------------------------------------------------------------
# CLI main
# ---------------------------------------------------------------------------
def main():
    p = argparse.ArgumentParser(description="BuildersEye Thai Language Evaluation Harness")
    p.add_argument("--provider", default="deepseek")
    p.add_argument("--base-url", default="https://api.deepseek.com")
    p.add_argument("--key", required=True)
    p.add_argument("--model", default="deepseek-chat")
    p.add_argument("--prompt", choices=["current","improved"], default="current")
    p.add_argument("--compare")
    p.add_argument("--compare-base")
    p.add_argument("--compare-key")
    p.add_argument("--compare-model", default="qwen2.5:7b")
    p.add_argument("--queries")
    p.add_argument("--output")
    args = p.parse_args()
    api_key = args.key if args.key != "-" else sys.stdin.readline().strip()
    prompt = SYSTEM_PROMPT_IMPROVED if args.prompt == "improved" else SYSTEM_PROMPT_CURRENT
    queries = DEFAULT_QUERIES
    if args.queries:
        with open(args.queries) as f:
            queries = json.load(f)
    print(f"Queries: {len(queries)} | Provider: {args.provider} ({args.model})")
    print(f"Prompt: {args.prompt}")
    results_a = run_evaluation(args.provider, args.base_url, api_key, args.model, prompt, queries)
    results_b = None
    if args.compare:
        ck = args.compare_key or api_key
        if ck == "-": ck = sys.stdin.readline().strip()
        results_b = run_evaluation(args.compare, args.compare_base, ck, args.compare_model, prompt, queries)
        print_ab_comparison(results_a, args.provider, results_b, args.compare)
    if args.output:
        out = {"provider_a": args.provider, "results": [asdict(r) for r in results_a]}
        if results_b:
            out["provider_b"] = args.compare
            out["results_b"] = [asdict(r) for r in results_b]
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print(f"\nSaved: {args.output}")
    cn_total = sum(1 for r in results_a if r.has_chinese)
    print(f"\n{'='*65}")
    if cn_total > 0:
        print(f"FAIL: {cn_total}/{len(results_a)} responses contain Chinese characters")
        sys.exit(1)
    else:
        print(f"PASS: All {len(results_a)} responses are Chinese-free")
    print(f"{'='*65}")

if __name__ == "__main__":
    main()

