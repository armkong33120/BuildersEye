// conversationStore.js — Simple JSON file-based conversation storage
// No database needed — works on Render free tier (512MB)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '.data', 'conversations');

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function convoPath(id) {
  // Sanitize ID to prevent path traversal
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(DATA_DIR, `${safe}.json`);
}

export function listConversations() {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const convos = files.map(f => {
      try {
        const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf-8');
        const c = JSON.parse(raw);
        return { id: c.id, title: c.title, messageCount: (c.messages || []).length, createdAt: c.createdAt, updatedAt: c.updatedAt };
      } catch { return null; }
    }).filter(Boolean);
    // Sort by updatedAt descending (newest first)
    convos.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return convos;
  } catch { return []; }
}

export function getConversation(id) {
  try {
    const raw = fs.readFileSync(convoPath(id), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

export function saveConversation(id, title, messages) {
  const now = new Date().toISOString();
  const existing = getConversation(id);
  const convo = {
    id,
    title: title || (existing?.title || 'New Chat'),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    messages: messages || [],
  };
  fs.writeFileSync(convoPath(id), JSON.stringify(convo, null, 2), 'utf-8');
  return convo;
}

export function addMessage(id, role, text, title) {
  const convo = getConversation(id) || { id, title: title || 'New Chat', createdAt: new Date().toISOString(), messages: [] };
  convo.messages.push({
    role,
    text,
    time: new Date().toISOString(),
  });
  // Auto-update title from first user message if still default
  if (convo.title === 'New Chat' && role === 'user' && text) {
    convo.title = text.slice(0, 60) + (text.length > 60 ? '…' : '');
  }
  return saveConversation(id, convo.title, convo.messages);
}

export function deleteConversation(id) {
  try {
    fs.unlinkSync(convoPath(id));
    return true;
  } catch { return false; }
}
