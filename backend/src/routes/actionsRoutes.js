// src/routes/actionsRoutes.js
import express from 'express';
import { sessionAuth } from '../middleware/sessionAuth.js';
import { logEvent } from '../services/eventService.js';
import { sendQuickActionToStaff } from '../services/telegramService.js';

export const actionsRouter = express.Router();

/**
 * Helper: common handler for quick actions.
 */
async function handleQuickAction(req, res, action) {
  try {
    const session = req.session;

    const restaurantId = session?.restaurant_id || session?.restaurantId || null;
    const tableId = session?.table_id || session?.tableId || null;

    // 1) Telegram notify staff (best-effort, do not break runtime)
    await sendQuickActionToStaff({
      restaurant_id: restaurantId,
      table_id: tableId,
      session_id: session?.id,
      action,
    });

    // 2) Log event for analytics/audit
    await logEvent(
      'quick_action_requested',
      { session, deviceId: req.deviceId },
      {
        action,
        restaurant_id: restaurantId,
        table_id: tableId,
        channel: 'widget',
      }
    );

    return res.json({ status: 'ok' });
  } catch (err) {
    console.error(`[actions] Failed quick action: ${action}`, err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/v1/actions/request-waiter
 * Headers: x-session-token
 */
actionsRouter.post('/request-waiter', sessionAuth, async (req, res) => {
  return handleQuickAction(req, res, 'request_waiter');
});

/**
 * POST /api/v1/actions/request-bill
 * Headers: x-session-token
 */
actionsRouter.post('/request-bill', sessionAuth, async (req, res) => {
  return handleQuickAction(req, res, 'request_bill');
});
