// In-memory conversation store (H3 isolation)
// Sessions are keyed by `${userId}:${conversationId}` so the same conversation
// id used by two different authenticated users can never leak history into
// pronoun resolution / follow-up context. userId comes from the JWT identity,
// never from the client body.
const sessions = new Map();
const MAX_HISTORY = 6;

function sessionKey(userId, conversationId) {
  return `${userId != null ? userId : 'anon'}:${conversationId || ''}`;
}

export function getHistory(userId, conversationId) {
  if (!conversationId) return [];
  return sessions.get(sessionKey(userId, conversationId)) || [];
}

export function addMessage(userId, conversationId, role, content) {
  if (!conversationId) return;
  const key = sessionKey(userId, conversationId);
  if (!sessions.has(key)) sessions.set(key, []);
  const history = sessions.get(key);
  history.push({ role, content });
  // Keep only last MAX_HISTORY messages
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

export function clearHistory(userId, conversationId) {
  if (!conversationId) return;
  sessions.delete(sessionKey(userId, conversationId));
}
