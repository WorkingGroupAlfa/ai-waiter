// src/ai/dialogResponseUtils.js
// Deterministic response shaping: dedupe items/recommendations and avoid repeated lines.

function normalizeCode(v) {
  return String(v || '').trim().toUpperCase();
}

function normalizeName(v, fallback = 'item') {
  const s = String(v || '').trim();
  return s || fallback;
}

export function dedupeByCode(items = []) {
  const out = [];
  const seen = new Set();

  for (const it of Array.isArray(items) ? items : []) {
    const code = normalizeCode(it?.code || it?.item_code || it?.itemCode);
    if (!code) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ ...it, code });
  }
  return out;
}

export function mergeOrderItemsByCode(items = []) {
  const map = new Map();

  for (const it of Array.isArray(items) ? items : []) {
    const code = normalizeCode(it?.item_code || it?.code);
    const key = code || normalizeName(it?.item_name || it?.name, 'item').toLowerCase();
    const qty = Number.isFinite(Number(it?.quantity)) && Number(it.quantity) > 0 ? Number(it.quantity) : 1;

    if (!map.has(key)) {
      map.set(key, {
        id: it?.id || null,
        code: code || null,
        name: normalizeName(it?.item_name || it?.name || it?.item_code || it?.code, 'item'),
        quantity: qty,
        unitPrice: Number.isFinite(Number(it?.unit_price)) ? Number(it.unit_price) : null,
        modifiers: it?.modifiers ?? null,
        notes: it?.notes ?? null,
        menuItemId: it?.menu_item_id || it?.menuItemId || null,
      });
      continue;
    }

    const prev = map.get(key);
    prev.quantity += qty;
    if (prev.unitPrice == null && Number.isFinite(Number(it?.unit_price))) {
      prev.unitPrice = Number(it.unit_price);
    }
  }

  return Array.from(map.values());
}

export function buildOrderDraftForResponseSafe(order) {
  if (!order) return null;

  return {
    id: order.id,
    status: order.status,
    tableId: order.table_id,
    totalAmount:
      typeof order.total_amount === 'number'
        ? order.total_amount
        : parseFloat(order.total_amount || '0') || 0,
    items: mergeOrderItemsByCode(order.items || []),
  };
}

export function buildOrderReplyTextSafe(order) {
  const merged = mergeOrderItemsByCode(order?.items || []);
  const total =
    typeof order?.total_amount === 'number'
      ? order.total_amount
      : parseFloat(order?.total_amount || '0') || 0;

  let text = 'You ordered:\n\n';
  merged.forEach((item, idx) => {
    text += `${idx + 1}. ${item.quantity} x ${item.name} (per menu)\n`;
  });
  text += `\nTotal amount: ${total}₴.\n\n`;
  text +=
    'To confirm this order, press the "Confirm order" button below. If you want to add or change something - just type it here.';
  return text;
}

