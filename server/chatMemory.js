// In-memory conversation store
const sessions = new Map();
const MAX_HISTORY = 6;

export function getHistory(conversationId) {
  if (!conversationId) return [];
  return sessions.get(conversationId) || [];
}

export function addMessage(conversationId, role, content) {
  if (!conversationId) return;
  if (!sessions.has(conversationId)) sessions.set(conversationId, []);
  const history = sessions.get(conversationId);
  history.push({ role, content });
  // Keep only last MAX_HISTORY messages
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

export function clearHistory(conversationId) {
  if (!conversationId) return;
  sessions.delete(conversationId);
}
