// conversationStore.js — Simple JSON file-based conversation storage
// No database needed — works on Render free tier (512MB)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '.data', 'conversations');

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// L2: conversation IDs are attacker-controlled. A 10k-char id would produce a
// 10k-char filename → ENAMETOOLONG (500) or filesystem abuse. Sanitize, then
// hash any id that is empty or longer than 128 chars into a fixed-length
// deterministic name (same id → same file, so ownership/read/write still work).
const MAX_CONVO_ID_LEN = 128;
function convoPath(id) {
  // Sanitize ID to prevent path traversal
  const raw = String(id);
  let safe = raw.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe.length > MAX_CONVO_ID_LEN) {
    safe = 'c-' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 64);
  }
  return path.join(DATA_DIR, `${safe}.json`);
}

// Conversation ownership (H2 isolation):
// Every conversation stores an `owner` userId. All reads/writes/deletes are
// scoped by that owner. Owner identity comes from the JWT (`req.authUser.id`),
// never from the request body. A caller cannot read, append to, or delete a
// conversation owned by another user just by supplying its id.

function readRaw(id) {
  try {
    const raw = fs.readFileSync(convoPath(id), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

export function listConversations(userId) {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const convos = files.map(f => {
      try {
        const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf-8');
        const c = JSON.parse(raw);
        // Only the owner may list a conversation.
        if (c.owner != null && String(c.owner) !== String(userId)) return null;
        return { id: c.id, title: c.title, messageCount: (c.messages || []).length, createdAt: c.createdAt, updatedAt: c.updatedAt };
      } catch { return null; }
    }).filter(Boolean);
    // Sort by updatedAt descending (newest first)
    convos.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return convos;
  } catch { return []; }
}

// Returns the conversation ONLY if it belongs to `userId`. A conversation owned
// by another user is indistinguishable from a missing one (returns null).
export function getConversation(id, userId) {
  const convo = readRaw(id);
  if (!convo) return null;
  if (convo.owner != null && String(convo.owner) !== String(userId)) return null;
  return convo;
}

export function saveConversation(id, title, messages, userId) {
  const now = new Date().toISOString();
  const existing = readRaw(id);
  // Ownership is immutable: a conversation created by A can never be re-saved
  // under B's identity.
  const owner = existing?.owner ?? userId;
  if (existing && existing.owner != null && String(existing.owner) !== String(userId)) {
    const err = new Error('Forbidden: conversation belongs to another user');
    err.status = 403; throw err;
  }
  if (owner == null) return null; // must have an owner
  const convo = {
    id,
    owner,
    title: title || (existing?.title || 'New Chat'),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    messages: messages || [],
  };
  fs.writeFileSync(convoPath(id), JSON.stringify(convo, null, 2), 'utf-8');
  return convo;
}

// Append a message to `id` as `userId`. Throws 403 if the conversation exists
// and is owned by someone else (body-supplied id of another user is rejected).
// If the conversation does not exist yet, creates it owned by `userId`.
export function addMessage(id, role, text, title, userId) {
  const existing = readRaw(id);
  if (existing && existing.owner != null && String(existing.owner) !== String(userId)) {
    const err = new Error('Forbidden: conversation belongs to another user');
    err.status = 403; throw err;
  }
  const convo = existing || { id, owner: userId, title: title || 'New Chat', createdAt: new Date().toISOString(), messages: [] };
  convo.messages.push({
    role,
    text,
    time: new Date().toISOString(),
  });
  // Auto-update title from first user message if still default
  if (convo.title === 'New Chat' && role === 'user' && text) {
    convo.title = text.slice(0, 60) + (text.length > 60 ? '…' : '');
  }
  return saveConversation(id, convo.title, convo.messages, userId);
}

// Delete `id` ONLY if it belongs to `userId`. Returns false (no deletion) for a
// conversation owned by another user or a missing one.
export function deleteConversation(id, userId) {
  try {
    const convo = readRaw(id);
    if (!convo) return false;
    if (convo.owner != null && String(convo.owner) !== String(userId)) return false;
    fs.unlinkSync(convoPath(id));
    return true;
  } catch { return false; }
}
