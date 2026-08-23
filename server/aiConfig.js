// aiConfig.js — Simple dynamic AI-system configuration persisted to a JSON file.
//
// Fields:
//   - llmModel             (string): model id used by the RAG/chat pipeline
//   - ragTimeoutMs         (number): retrieval timeout (ms)
//   - systemPromptOverride (string): optional global system-prompt override
//
// Reads are cheap (in-memory cache); writes validate + persist to
// server/.data/ai_config.json so the CEO/admin can tune the system at runtime
// without redeploying or touching environment variables.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, '.data', 'ai_config.json');

// Defaults are EMPTY so the real pipeline keeps reading from `process.env`
// (LLM_MODEL / LLM_TIMEOUT_MS) until the CEO explicitly overrides a value on the
// "System Settings" page. A non-empty llmModel / ragTimeoutMs here would
// silently hijack the deployed env config on a fresh system.
const DEFAULTS = {
  llmModel: '',
  ragTimeoutMs: 0,
  systemPromptOverride: '',
};

// Coerce stored values to the expected shape (dropping unknown keys).
function sanitize(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  return {
    llmModel: typeof src.llmModel === 'string' ? src.llmModel : DEFAULTS.llmModel,
    ragTimeoutMs: Number.isFinite(Number(src.ragTimeoutMs)) ? Number(src.ragTimeoutMs) : DEFAULTS.ragTimeoutMs,
    systemPromptOverride: typeof src.systemPromptOverride === 'string' ? src.systemPromptOverride : DEFAULTS.systemPromptOverride,
  };
}

let cached = null;

export function getConfig() {
  if (cached) return { ...cached };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      cached = sanitize(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
    } else {
      cached = { ...DEFAULTS };
    }
  } catch (e) {
    // Corrupt/missing file → fall back to defaults rather than crashing.
    console.warn('[aiConfig] using defaults: ' + e.message);
    cached = { ...DEFAULTS };
  }
  return { ...cached };
}

// Accepts a partial patch { llmModel?, ragTimeoutMs?, systemPromptOverride? },
// validates it, merges onto the current config, and persists. Returns the saved
// (merged) config. Throws with a `status` on validation failure.
export function saveConfig(patch = {}) {
  const current = getConfig();
  const next = { ...current };

  if (patch.llmModel !== undefined) {
    if (typeof patch.llmModel !== 'string' || !patch.llmModel.trim()) {
      const e = new Error('llmModel must be a non-empty string');
      e.status = 400; throw e;
    }
    next.llmModel = patch.llmModel.trim();
  }

  if (patch.ragTimeoutMs !== undefined) {
    const n = Number(patch.ragTimeoutMs);
    if (!Number.isFinite(n) || n < 0) {
      const e = new Error('ragTimeoutMs must be a non-negative number');
      e.status = 400; throw e;
    }
    next.ragTimeoutMs = n;
  }

  if (patch.systemPromptOverride !== undefined) {
    if (typeof patch.systemPromptOverride !== 'string') {
      const e = new Error('systemPromptOverride must be a string');
      e.status = 400; throw e;
    }
    next.systemPromptOverride = patch.systemPromptOverride;
  }

  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  cached = { ...next };
  return { ...cached };
}
