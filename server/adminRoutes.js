// adminRoutes.js — Admin-only configuration API (read + write separated).
//
// Authorization chain: JWT identity → authenticated user → admin check.
//   - requireAuth (in index.js) validates the signed JWT and sets req.authUser.
//   - requireAdmin (in index.js) enforces CEO/admin role.
//
// Backend is the source of truth: role/employeeId/permissions are NEVER read
// from the request body. The actor recorded in audit events comes from
// req.authUser (the JWT), not from the body.
//
// Read endpoints are under /api/admin/... and write endpoints under
// /api/admin/... too, but separated by HTTP verb + path suffix (/write).

import express from 'express';
import * as adminService from './access/adminService.js';
import { readAccess } from './access/adminService.js';

export function mountAdminRoutes(app, { requireAuth, requireAdmin }) {
  const router = express.Router();
  router.use(requireAuth, requireAdmin);

  const actor = (req) => ({
    username: req.authUser?.username,
    employeeId: req.authUser?.employeeId,
    role: req.authUser?.role,
  });

  // ── Read (GET) ─────────────────────────────────────────────────────────────
  router.get('/profiles', (req, res) => res.json(readAccess.profiles()));
  router.get('/profiles/:code', (req, res) => {
    const p = readAccess.profile(req.params.code);
    if (!p) return res.status(404).json({ error: 'Profile not found' });
    res.json(p);
  });
  router.get('/policies', (req, res) => res.json(readAccess.policies()));
  router.get('/source-links', (req, res) => res.json(readAccess.sourceLinks()));
  router.get('/employees', (req, res) => res.json(readAccess.employees()));
  router.get('/relationships', (req, res) => res.json(readAccess.relationships()));
  router.get('/audit', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const entity = req.query.entity || null;
    res.json(readAccess.audit({ limit, entity }));
  });
  router.get('/policy-version', (req, res) => res.json({ version: readAccess.policyVersion() }));

  // ── Write (POST/PUT/DELETE) ────────────────────────────────────────────────
  router.put('/profiles/:code', (req, res) => {
    try {
      res.json(adminService.updateProfile(actor(req), req.params.code, req.body || {}));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.post('/policies', (req, res) => {
    try {
      res.json(adminService.createPolicy(actor(req), req.body || {}));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.put('/policies/:id', (req, res) => {
    try {
      res.json(adminService.updatePolicy(actor(req), req.params.id, req.body || {}));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.delete('/policies/:id', (req, res) => {
    try {
      res.json(adminService.deletePolicy(actor(req), req.params.id));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.post('/source-links', (req, res) => {
    try {
      res.json(adminService.createSourceLink(actor(req), req.body || {}));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.put('/source-links/:id', (req, res) => {
    try {
      res.json(adminService.updateSourceLink(actor(req), req.params.id, req.body || {}));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  router.delete('/source-links/:id', (req, res) => {
    try {
      res.json(adminService.deleteSourceLink(actor(req), req.params.id));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.put('/employees/:code/profile', (req, res) => {
    try {
      res.json(adminService.assignProfile(actor(req), req.params.code, req.body?.profileCode));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.put('/relationships/:code/manager', (req, res) => {
    try {
      res.json(adminService.setManager(actor(req), req.params.code, req.body?.managerCode));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.post('/rollback', (req, res) => {
    try {
      const { entity, entityId } = req.body || {};
      res.json(adminService.rollback(actor(req), entity, entityId));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.use('/api/admin', router);
  return router;
}
