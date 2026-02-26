import express from 'express';
import {
  listUpsellRules,
  getUpsellRuleById,
  createUpsellRule,
  updateUpsellRule,
  deleteUpsellRule,
  toggleUpsellRule,
  duplicateUpsellRule,
} from '../models/upsellRulesModel.js';
import { adminAuth } from '../middleware/adminAuth.js';


const router = express.Router();
router.use(adminAuth);


// GET /api/v1/admin/upsell-rules?restaurant_id=...&page=1&limit=200
router.get('/', async (req, res) => {
  try {
    const { restaurant_id, page = '1', limit = '50' } = req.query;
    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }

    const out = await listUpsellRules({
      restaurantId: String(restaurant_id),
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.min(500, Math.max(1, parseInt(limit, 10) || 50)),
    });

    return res.json(out);
  } catch (e) {
    console.error('[adminUpsellRulesRoutes] GET / error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// GET /api/v1/admin/upsell-rules/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await getUpsellRuleById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.json(row);
  } catch (e) {
    console.error('[adminUpsellRulesRoutes] GET /:id error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// POST /api/v1/admin/upsell-rules
router.post('/', async (req, res) => {
  try {
    const created = await createUpsellRule(req.body || {});
    return res.status(201).json({ rule: created });

  } catch (e) {
    console.error('[adminUpsellRulesRoutes] POST / error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// PUT /api/v1/admin/upsell-rules/:id
router.put('/:id', async (req, res) => {
  try {
    const updated = await updateUpsellRule(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Not found' });
    return res.json(updated);
  } catch (e) {
    console.error('[adminUpsellRulesRoutes] PUT /:id error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// PATCH /api/v1/admin/upsell-rules/:id/toggle
router.patch('/:id/toggle', async (req, res) => {
  try {
    const { is_active } = req.body || {};
    const updated = await toggleUpsellRule(req.params.id, !!is_active);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    return res.json({ rule: updated });

  } catch (e) {
    console.error('[adminUpsellRulesRoutes] PATCH /:id/toggle error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// POST /api/v1/admin/upsell-rules/:id/toggle  (compat with admin-frontend)
router.post('/:id/toggle', async (req, res) => {
  try {
    const { is_active } = req.body || {};
    const updated = await toggleUpsellRule(req.params.id, !!is_active);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    return res.json({ rule: updated });
  } catch (e) {
    console.error('[adminUpsellRulesRoutes] POST /:id/toggle error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});


// DELETE /api/v1/admin/upsell-rules/:id
router.delete('/:id', async (req, res) => {
  try {
    const ok = await deleteUpsellRule(req.params.id);
    return res.json({ ok });
  } catch (e) {
    console.error('[adminUpsellRulesRoutes] DELETE /:id error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// POST /api/v1/admin/upsell-rules/:id/duplicate
router.post('/:id/duplicate', async (req, res) => {
  try {
    const created = await duplicateUpsellRule(req.params.id);
    return res.status(201).json({ rule: created });
  } catch (e) {
    console.error('[adminUpsellRulesRoutes] POST /:id/duplicate error', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});


export default router;
