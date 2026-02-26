// src/models/orderModel.js
import { query } from '../db.js';

// ---- базовые выборки заказов ----

export async function findDraftOrderForSession(sessionId) {
  const res = await query(
    `
    SELECT
      id, session_id, device_id, restaurant_id, table_id,
      status, total_amount,
      created_at, updated_at, submitted_at, cancelled_at
    FROM orders
    WHERE session_id = $1
      AND status = 'draft'
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [sessionId]
  );
  return res.rows[0] || null;
}

export async function insertDraftOrder({ id, sessionId, deviceId, restaurantId, tableId }) {
  const res = await query(
    `
    INSERT INTO orders (
      id, session_id, device_id, restaurant_id, table_id,
      status, total_amount
    )
    VALUES ($1, $2, $3, $4, $5, 'draft', 0)
    RETURNING
      id, session_id, device_id, restaurant_id, table_id,
      status, total_amount,
      created_at, updated_at, submitted_at, cancelled_at
    `,
    [id, sessionId, deviceId, restaurantId, tableId]
  );
  return res.rows[0];
}

export async function findActiveOrderForSession(sessionId) {
  const res = await query(
    `
    SELECT
      id, session_id, device_id, restaurant_id, table_id,
      status, total_amount,
      created_at, updated_at, submitted_at, cancelled_at
    FROM orders
    WHERE session_id = $1
      AND status IN ('draft', 'submitted', 'in_kitchen', 'ready')
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [sessionId]
  );
  return res.rows[0] || null;
}

export async function findOrderById(orderId) {
  const res = await query(
    `
    SELECT
      id, session_id, device_id, restaurant_id, table_id,
      status, total_amount,
      created_at, updated_at, submitted_at, cancelled_at
    FROM orders
    WHERE id = $1
    LIMIT 1
    `,
    [orderId]
  );
  return res.rows[0] || null;
}

export async function findOrderByIdAndSession(orderId, sessionId) {
  const res = await query(
    `
    SELECT
      id, session_id, device_id, restaurant_id, table_id,
      status, total_amount,
      created_at, updated_at, submitted_at, cancelled_at
    FROM orders
    WHERE id = $1 AND session_id = $2
    `,
    [orderId, sessionId]
  );
  return res.rows[0] || null;
}

// ---- позиции заказа ----

export async function findOrderItems(orderId) {
  const res = await query(
    `
    SELECT
      id, order_id, item_code, item_name,
      quantity, unit_price, modifiers, notes,
      created_at, updated_at
    FROM order_items
    WHERE order_id = $1
    ORDER BY created_at ASC
    `,
    [orderId]
  );
  return res.rows;
}

export async function insertOrderItem({
  id,
  orderId,
  itemCode,
  itemName,
  quantity,
  unitPrice,
  modifiers,
  notes,
}) {
  // --- НОРМАЛИЗАЦИЯ modifiers ---
  let modifiersValue = null;

  if (modifiers == null) {
    modifiersValue = null;
  } else if (Array.isArray(modifiers)) {
    // например ["spicy"] → валидный JSON-массив
    modifiersValue = JSON.stringify(modifiers);
  } else if (typeof modifiers === 'object') {
    // уже объект → просто сериализуем
    modifiersValue = JSON.stringify(modifiers);
  } else if (typeof modifiers === 'string') {
    // если пришла строка — пробуем считать, что это уже JSON
    try {
      JSON.parse(modifiers); // если не упало, значит норм
      modifiersValue = modifiers;
    } catch {
      // если это просто "spicy" или что-то кривое — завернём в объект
      modifiersValue = JSON.stringify({ value: modifiers });
    }
  } else {
    // всё остальное на всякий случай тоже в обёртку
    modifiersValue = JSON.stringify({ value: String(modifiers) });
  }

  const res = await query(
    `
    INSERT INTO order_items (
      id, order_id, item_code, item_name,
      quantity, unit_price, modifiers, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, '{}'::jsonb), $8)
    RETURNING
      id, order_id, item_code, item_name,
      quantity, unit_price, modifiers, notes,
      created_at, updated_at
    `,
    [id, orderId, itemCode, itemName, quantity, unitPrice, modifiersValue, notes]
  );
  return res.rows[0];
}


export async function updateOrderItem(orderId, itemId, fields) {
  const setParts = [];
  const values = [];
  let idx = 1;

  if (fields.quantity !== undefined) {
    setParts.push(`quantity = $${idx++}`);
    values.push(fields.quantity);
  }
  if (fields.unit_price !== undefined) {
    setParts.push(`unit_price = $${idx++}`);
    values.push(fields.unit_price);
  }
   if (fields.modifiers !== undefined) {
    let modifiersValue = null;
    const m = fields.modifiers;

    if (m == null) {
      modifiersValue = null;
    } else if (Array.isArray(m)) {
      modifiersValue = JSON.stringify(m);
    } else if (typeof m === 'object') {
      modifiersValue = JSON.stringify(m);
    } else if (typeof m === 'string') {
      try {
        JSON.parse(m);
        modifiersValue = m;
      } catch {
        modifiersValue = JSON.stringify({ value: m });
      }
    } else {
      modifiersValue = JSON.stringify({ value: String(m) });
    }

    setParts.push(`modifiers = $${idx++}`);
    values.push(modifiersValue);
  }

  if (fields.notes !== undefined) {
    setParts.push(`notes = $${idx++}`);
    values.push(fields.notes);
  }

  if (setParts.length === 0) {
    return null;
  }

  setParts.push(`updated_at = NOW()`);

  const sql = `
    UPDATE order_items
    SET ${setParts.join(', ')}
    WHERE id = $${idx} AND order_id = $${idx + 1}
    RETURNING
      id, order_id, item_code, item_name,
      quantity, unit_price, modifiers, notes,
      created_at, updated_at
  `;

  values.push(itemId, orderId);

  const res = await query(sql, values);
  return res.rows[0] || null;
}

export async function deleteOrderItem(orderId, itemId) {
  const res = await query(
    `
    DELETE FROM order_items
    WHERE id = $1 AND order_id = $2
    `,
    [itemId, orderId]
  );
  return res.rowCount; // 0 или 1
}

/**
 * НОВОЕ: удалить последнюю позицию по коду блюда
 */
export async function deleteLastOrderItemByCode(orderId, itemCode) {
  const res = await query(
    `
    DELETE FROM order_items
    WHERE id = (
      SELECT id
      FROM order_items
      WHERE order_id = $1 AND UPPER(item_code) = UPPER($2)
      ORDER BY created_at DESC
      LIMIT 1
    )
    RETURNING
      id, order_id, item_code, item_name,
      quantity, unit_price, modifiers, notes,
      created_at, updated_at
    `,
    [orderId, itemCode]
  );
  return res.rows[0] || null;
}

// ---- total и статусы ----

export async function calcOrderTotal(orderId) {
  const res = await query(
    `
    SELECT COALESCE(SUM(quantity * COALESCE(unit_price, 0)), 0) AS total
    FROM order_items
    WHERE order_id = $1
    `,
    [orderId]
  );
  return res.rows[0].total;
}

export async function updateOrderTotal(orderId, total) {
  await query(
    `
    UPDATE orders
    SET total_amount = $2,
        updated_at = NOW()
    WHERE id = $1
    `,
    [orderId, total]
  );
}

export async function submitOrder(orderId) {
  await query(
    `
    UPDATE orders
    SET status = 'submitted',
        submitted_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    `,
    [orderId]
  );
}

export async function cancelOrder(orderId) {
  await query(
    `
    UPDATE orders
    SET status = 'cancelled',
        cancelled_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    `,
    [orderId]
  );
}

export async function getOrderItemsForFraudCheck(orderId) {
  const res = await query(
    `
    SELECT quantity, unit_price
    FROM order_items
    WHERE order_id = $1
    `,
    [orderId]
  );
  return res.rows;
}

/**
 * НОВОЕ: получить заказ вместе с items (для чата)
 */
export async function findOrderWithItems(orderId) {
  const res = await query(
    `
    SELECT
      o.*,
      COALESCE(
        JSON_AGG(oi ORDER BY oi.created_at)
          FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.id = $1
    GROUP BY o.id
    `,
    [orderId]
  );

  return res.rows[0] || null;
}

// ---- medium-term history: последние заказы устройства ----

export async function findRecentOrdersForDevice(
  deviceId,
  { days = 3, limit = 10 } = {}
) {
  if (!deviceId) return [];

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const res = await query(
    `
    SELECT
      o.id,
      o.session_id,
      o.device_id,
      o.restaurant_id,
      o.table_id,
      o.status,
      o.total_amount,
      o.created_at,
      o.updated_at,
      o.submitted_at,
      o.cancelled_at,
      COALESCE(
        JSON_AGG(
          jsonb_build_object(
            'id', oi.id,
            'order_id', oi.order_id,
            'item_code', oi.item_code,
            'item_name', oi.item_name,
            'quantity', oi.quantity,
            'unit_price', oi.unit_price,
            'modifiers', oi.modifiers,
            'notes', oi.notes,
            'menu_item_id', mi.id,
            'created_at', oi.created_at,
            'updated_at', oi.updated_at
          )
          ORDER BY oi.created_at ASC
        )
        FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN menu_items mi
      ON mi.restaurant_id = o.restaurant_id
     AND mi.item_code = oi.item_code
    WHERE o.device_id = $1
      AND o.created_at >= $2
      AND o.status <> 'draft'
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT $3
    `,
    [deviceId, since, limit]
  );

  return res.rows;
}

