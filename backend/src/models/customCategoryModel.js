import { query } from '../db.js';

function normText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normAliases(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return Array.from(
      new Set(
        v
          .map((x) => normText(x))
          .filter(Boolean)
      )
    );
  }
  return [];
}

export async function listCustomCategories(restaurantId, { onlyActive = false } = {}) {
  const params = [restaurantId];
  let where = 'WHERE restaurant_id = $1';
  if (onlyActive) {
    where += ' AND is_active = TRUE';
  }

  const { rows } = await query(
    `
    SELECT
      id,
      restaurant_id,
      slug,
      name_ua,
      name_en,
      aliases,
      is_active,
      sort_order,
      created_at,
      updated_at
    FROM menu_custom_categories
    ${where}
    ORDER BY sort_order ASC, name_ua ASC, slug ASC
    `,
    params
  );

  return rows;
}

export async function createCustomCategory(payload = {}) {
  const restaurant_id = normText(payload.restaurant_id);
  const slug = normText(payload.slug);
  const name_ua = normText(payload.name_ua);
  const name_en = normText(payload.name_en);
  const aliases = normAliases(payload.aliases);
  const is_active =
    typeof payload.is_active === 'boolean' ? payload.is_active : true;
  const sort_order = Number.isFinite(Number(payload.sort_order))
    ? Number(payload.sort_order)
    : 0;

  if (!restaurant_id) throw new Error('restaurant_id is required');
  if (!slug) throw new Error('slug is required');
  if (!name_ua) throw new Error('name_ua is required');

  const { rows } = await query(
    `
    INSERT INTO menu_custom_categories (
      restaurant_id, slug, name_ua, name_en, aliases, is_active, sort_order
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
    `,
    [restaurant_id, slug, name_ua, name_en, aliases, is_active, sort_order]
  );

  return rows[0] || null;
}

export async function updateCustomCategory(id, patch = {}) {
  const fields = [];
  const params = [];
  let idx = 1;

  if (Object.prototype.hasOwnProperty.call(patch, 'slug')) {
    const slug = normText(patch.slug);
    if (!slug) throw new Error('slug cannot be empty');
    fields.push(`slug = $${idx++}`);
    params.push(slug);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'name_ua')) {
    const name_ua = normText(patch.name_ua);
    if (!name_ua) throw new Error('name_ua cannot be empty');
    fields.push(`name_ua = $${idx++}`);
    params.push(name_ua);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'name_en')) {
    fields.push(`name_en = $${idx++}`);
    params.push(normText(patch.name_en));
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'aliases')) {
    fields.push(`aliases = $${idx++}`);
    params.push(normAliases(patch.aliases));
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'is_active')) {
    fields.push(`is_active = $${idx++}`);
    params.push(Boolean(patch.is_active));
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'sort_order')) {
    const sort_order = Number.isFinite(Number(patch.sort_order))
      ? Number(patch.sort_order)
      : 0;
    fields.push(`sort_order = $${idx++}`);
    params.push(sort_order);
  }

  if (!fields.length) {
    const { rows } = await query(
      `SELECT * FROM menu_custom_categories WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  params.push(id);
  const { rows } = await query(
    `
    UPDATE menu_custom_categories
    SET ${fields.join(', ')}, updated_at = NOW()
    WHERE id = $${idx}
    RETURNING *
    `,
    params
  );
  return rows[0] || null;
}

export async function deleteCustomCategory(id) {
  const { rowCount } = await query(
    `DELETE FROM menu_custom_categories WHERE id = $1`,
    [id]
  );
  return rowCount > 0;
}

export async function replaceMenuItemCustomCategories(menuItemId, customCategoryIds = []) {
  await query(
    `DELETE FROM menu_item_custom_categories WHERE menu_item_id = $1`,
    [menuItemId]
  );

  const ids = Array.from(
    new Set(
      (customCategoryIds || [])
        .map((x) => normText(x))
        .filter(Boolean)
    )
  );

  for (const categoryId of ids) {
    await query(
      `
      INSERT INTO menu_item_custom_categories (menu_item_id, custom_category_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [menuItemId, categoryId]
    );
  }
}

export async function getMenuItemsByCustomCategory({
  restaurantId,
  categoryId,
  limit = 12,
} = {}) {
  const { rows } = await query(
    `
    SELECT
      m.id,
      m.item_code,
      COALESCE(m.name_en, m.name_ua) AS name,
      m.base_price AS price,
      (
        SELECT p.url
        FROM menu_item_photos p
        WHERE p.menu_item_id = m.id
        ORDER BY p.sort_order ASC, p.created_at ASC
        LIMIT 1
      ) AS image_url
    FROM menu_items m
    JOIN menu_item_custom_categories micc
      ON micc.menu_item_id = m.id
    JOIN menu_custom_categories mcc
      ON mcc.id = micc.custom_category_id
    WHERE m.restaurant_id = $1
      AND m.is_active = TRUE
      AND mcc.id = $2
      AND mcc.is_active = TRUE
    ORDER BY m.name_ua ASC
    LIMIT $3
    `,
    [restaurantId, categoryId, Math.max(1, Math.min(Number(limit) || 12, 50))]
  );
  return rows;
}

export async function findCustomCategoryByMention(restaurantId, mentionText = '') {
  const mention = normText(mentionText)?.toLowerCase();
  if (!mention) return null;

  const { rows } = await query(
    `
    SELECT
      id,
      restaurant_id,
      slug,
      name_ua,
      name_en,
      aliases,
      is_active,
      sort_order
    FROM menu_custom_categories
    WHERE restaurant_id = $1
      AND is_active = TRUE
    ORDER BY sort_order ASC, name_ua ASC
    `,
    [restaurantId]
  );

  const normalize = (v) =>
    String(v || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const mentionNorm = normalize(mention);
  const mentionTokens = new Set(mentionNorm.split(' ').filter(Boolean));

  const addKnownAliases = (terms, row) => {
    const title = normalize(row?.name_ua || row?.name_en || row?.slug || '');
    if (!title) return;

    if (title.includes('рол')) {
      terms.push('ролы', 'ролли', 'роллы', 'roll', 'rolls');
    }
    if (title.includes('суші') || title.includes('суши')) {
      terms.push('суши', 'sushi');
    }
    if (title.includes('сашим')) {
      terms.push('сашими', 'sashimi');
    }
    if (title.includes('тема')) {
      terms.push('темаки', 'temaki', 'hand roll', 'handroll');
    }
    if (title.includes('гункан')) {
      terms.push('гункан', 'gunkan');
    }
    if (title.includes('суп')) {
      terms.push('суп', 'супы', 'soups', 'soup');
    }
    if (title.includes('гаряч') || title.includes('горяч') || title.includes('hot')) {
      terms.push('горячее', 'горячие', 'hot dish', 'hot dishes');
    }
  };

  const getTerms = (row) => {
    const out = [];
    out.push(row.slug, row.name_ua, row.name_en);
    if (Array.isArray(row.aliases)) out.push(...row.aliases);
    addKnownAliases(out, row);

    return Array.from(
      new Set(
        out
          .map((x) => normalize(x))
          .filter(Boolean)
      )
    );
  };

  for (const row of rows) {
    const terms = getTerms(row);
    const strong = terms.some((t) => {
      if (!t) return false;
      if (mentionNorm === t) return true;
      if (mentionNorm.includes(t)) return true;
      if (t.includes(mentionNorm) && mentionNorm.length >= 4) return true;
      const tt = t.split(' ').filter(Boolean);
      return tt.some((w) => w.length >= 4 && mentionTokens.has(w));
    });

    if (strong) return row;
  }

  return null;
}
