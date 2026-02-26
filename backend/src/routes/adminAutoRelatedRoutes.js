import express from 'express';
import {
  listUpsellRelatedStats,
  toggleUpsellRelatedStat,
  setUpsellRelatedBoost,
  convertRelatedToUpsellRule,
} from '../models/upsellRelatedStatsModel.js';

const router = express.Router();

/**
 * GET /admin/auto-related
 * Query:
 *  - restaurant_id (required)
 *  - a_item_code
 *  - min_support
 *  - min_confidence
 *  - is_enabled
 *  - page
 *  - limit
 */
router.get('/', async (req, res) => {
  try {
    const {
      restaurant_id,
      a_item_code,
      min_support,
      min_confidence,
      is_enabled,
      page,
      limit,
    } = req.query;

    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }

    const data = await listUpsellRelatedStats({
      restaurantId: restaurant_id,
      aItemCode: a_item_code,
      minSupport: min_support,
      minConfidence: min_confidence,
      isEnabled:
        typeof is_enabled === 'string'
          ? is_enabled === 'true'
          : undefined,
      page,
      limit,
    });

    res.json(data);
  } catch (err) {
    console.error('[admin/auto-related][list]', err);
    res.status(500).json({ error: 'failed_to_list_auto_related' });
  }
});

/**
 * POST /admin/auto-related/toggle
 * Body:
 *  - restaurant_id
 *  - a_item_code
 *  - b_item_code
 *  - is_enabled (boolean)
 */
router.post('/toggle', async (req, res) => {
  try {
    const { restaurant_id, a_item_code, b_item_code, is_enabled } = req.body;

    if (
      !restaurant_id ||
      !a_item_code ||
      !b_item_code ||
      typeof is_enabled !== 'boolean'
    ) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const row = await toggleUpsellRelatedStat({
      restaurantId: restaurant_id,
      aItemCode: a_item_code,
      bItemCode: b_item_code,
      isEnabled: is_enabled,
    });

    res.json({ ok: true, row });
  } catch (err) {
    console.error('[admin/auto-related][toggle]', err);
    res.status(500).json({ error: 'failed_to_toggle' });
  }
});

/**
 * POST /admin/auto-related/boost
 * Body:
 *  - restaurant_id
 *  - a_item_code
 *  - b_item_code
 *  - boost_weight (number)
 */
router.post('/boost', async (req, res) => {
  try {
    const { restaurant_id, a_item_code, b_item_code, boost_weight } = req.body;

    if (!restaurant_id || !a_item_code || !b_item_code) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const row = await setUpsellRelatedBoost({
      restaurantId: restaurant_id,
      aItemCode: a_item_code,
      bItemCode: b_item_code,
      boostWeight: boost_weight,
    });

    res.json({ ok: true, row });
  } catch (err) {
    console.error('[admin/auto-related][boost]', err);
    res.status(500).json({ error: 'failed_to_set_boost' });
  }
});

/**
 * POST /admin/auto-related/convert-to-rule
 * Body:
 *  - restaurant_id
 *  - a_item_code
 *  - b_item_code
 *  - priority (optional)
 *  - weight (optional)
 */
router.post('/convert-to-rule', async (req, res) => {
  try {
    const {
      restaurant_id,
      a_item_code,
      b_item_code,
      priority,
      weight,
    } = req.body;

    if (!restaurant_id || !a_item_code || !b_item_code) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const rule = await convertRelatedToUpsellRule({
      restaurantId: restaurant_id,
      aItemCode: a_item_code,
      bItemCode: b_item_code,
      priority,
      weight,
    });

    res.json({ ok: true, rule });
  } catch (err) {
    if (err?.code === '23505') {
    return res.status(409).json({
      error: 'rule_already_exists',
      message: 'Upsell rule for this A→B already exists',
    });
     }
  console.error('[admin/auto-related][convert]', err);
  return res.status(500).json({ error: 'failed_to_convert' });
  }
});

export default router;
