// observability.js — LLM Observability & Telemetry Tracing
// ตาม AI Engineering Guidebook (หน้า 370-375): บันทึก Tracing, Latency, Token Cost, RAG Context Rate

class ObservabilityTracer {
  constructor() {
    this.spans = [];
    this.maxSpans = 500;
  }

  startTrace(query, viewer) {
    const spanId = 'tr_' + Math.random().toString(36).substring(2, 10);
    const span = {
      spanId,
      query,
      viewerRole: viewer?.role || 'CEO',
      startTime: Date.now(),
      status: 'RUNNING',
    };
    this.spans.push(span);
    if (this.spans.length > this.maxSpans) this.spans.shift();
    return spanId;
  }

  endTrace(spanId, { tokenCount = 0, ragHits = 0, isCacheHit = false, error = null }) {
    const span = this.spans.find(s => s.spanId === spanId);
    if (!span) return null;

    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    span.tokenCount = tokenCount;
    span.ragHits = ragHits;
    span.isCacheHit = isCacheHit;
    span.status = error ? 'ERROR' : 'SUCCESS';
    span.error = error ? error.message : null;
    return span;
  }

  getMetricsSummary() {
    const completed = this.spans.filter(s => s.status !== 'RUNNING');
    if (completed.length === 0) return { totalRequests: 0, avgDurationMs: 0, cacheHitRate: '0.0%' };

    const totalDuration = completed.reduce((acc, s) => acc + (s.durationMs || 0), 0);
    const cacheHits = completed.filter(s => s.isCacheHit).length;

    return {
      totalRequests: completed.length,
      avgDurationMs: Number((totalDuration / completed.length).toFixed(1)),
      cacheHits,
      cacheHitRate: ((cacheHits / completed.length) * 100).toFixed(1) + '%',
      lastRequests: completed.slice(-5),
    };
  }
}

export const tracer = new ObservabilityTracer();
