// test_helpers.mjs — Shared test HTTP helpers with configurable timeout.
//
// All auth-gated test scripts import BACKEND_URL and TEST_HTTP_TIMEOUT_MS
// from here instead of hardcoding timeout values. The timeout is overridden
// via environment variable for slow backends (e.g. Neon ~19 s login latency):
//
//   TEST_HTTP_TIMEOUT_MS=60000 node scripts/test_api_xxx.mjs
//
// Default: 30000 ms (safe for local file-backed or fast-network backends).
// Never changes production API, JWT TTL, Neon query or application timeouts.

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5199';
const TEST_HTTP_TIMEOUT_MS = parseInt(process.env.TEST_HTTP_TIMEOUT_MS, 10) || 30000;

export { BACKEND_URL, TEST_HTTP_TIMEOUT_MS };
