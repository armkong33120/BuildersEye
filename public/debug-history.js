// debug-history.js — Shared, dependency-free helpers for the Debug RAG Inspector
// history panel. Loaded by debug_neural_network_diagram.html via a classic
// <script src="./debug-history.js"> tag (synchronous, before the inline script)
// and also importable from Node tests via ESM `import` (it attaches to
// window.ViewerUtils in the browser and globalThis.ViewerUtils under Node), so
// scripts/test_sql_evidence_history.mjs unit-tests the EXACT code the browser
// runs — no duplication between frontend and tests.
(function (global) {
  'use strict';

  // Convert ANY value (string, object, null, number) into a readable, single-line
  // actor label. Objects are flattened to "username · role" (or the first
  // available field) so raw JS objects are NEVER rendered as [object Object].
  function actorString(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'object') {
      const u = v.username != null ? String(v.username).trim() : '';
      const r = v.role != null ? String(v.role).trim() : '';
      const name = v.name != null ? String(v.name).trim() : '';
      if (u && r && r.toLowerCase() !== u.toLowerCase()) return u + ' · ' + r;
      return u || name || r;
    }
    return String(v);
  }

  // Build a readable viewer label from a pipeline object. Viewer identity comes
  // from the signed JWT (d.viewer = {username, role, employeeId, department, name}).
  // Returns e.g. "ceo · CEO", "it-manager", "employee", or the fallback/"—".
  function viewerLabel(d, fallback) {
    const v = (d && typeof d === 'object' && d.viewer && typeof d.viewer === 'object') ? d.viewer : null;
    const fromViewer = actorString(v);
    if (fromViewer) return fromViewer;
    if (d && typeof d === 'object') {
      const u = d.username != null ? String(d.username).trim() : '';
      const r = d.role != null ? String(d.role).trim() : '';
      if (u && r) return u + ' · ' + r;
      if (u) return u;
      if (r) return r;
    }
    const fb = fallback != null ? String(fallback).trim() : '';
    return fb || '—';
  }

  // Stable identity for a history entry: the backend message/pipeline id, then
  // conversation/message id, then (last resort) query+timestamp. Two genuinely
  // different messages that share the same text keep different ids and are BOTH
  // preserved; only re-delivery of the SAME id is treated as a duplicate.
  function stableId(evt) {
    if (evt && typeof evt === 'object') {
      if (evt.id != null && String(evt.id).length) return String(evt.id);
      if (evt.messageId != null && String(evt.messageId).length) return String(evt.messageId);
      if (evt.conversationId != null && String(evt.conversationId).length) return String(evt.conversationId);
      return (evt.query != null ? String(evt.query) : '') + '|' + (evt.at != null ? String(evt.at) : '');
    }
    return String(evt == null ? '' : evt);
  }

  // Add `evt` to `entries` unless an entry with the same stable id already
  // exists (returns null for a duplicate). Otherwise returns the new list,
  // capped at `max` (default 50).
  function dedupeHistory(entries, evt, max) {
    const list = Array.isArray(entries) ? entries : [];
    const limit = Math.max(0, Number(max) || 50);
    const id = stableId(evt);
    if (id && list.some((e) => e && e.id === id)) return null;
    return [evt, ...list].slice(0, limit);
  }

  // Normalize a raw history array: coerce each entry's viewer to a readable
  // string (fixes legacy [object Object] entries), drop duplicate stable ids
  // (newest wins), and cap at `max` (default 50).
  function normalizeHistory(entries, max) {
    const limit = Math.max(0, Number(max) || 50);
    const seen = new Set();
    const out = [];
    for (const e of (Array.isArray(entries) ? entries : [])) {
      if (!e || typeof e !== 'object') continue;
      const id = stableId(e);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(Object.assign({}, e, { viewer: actorString(e.viewer) }));
      if (out.length >= limit) break;
    }
    return out;
  }

  const api = { actorString, viewerLabel, dedupeHistory, normalizeHistory, stableId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ViewerUtils = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
