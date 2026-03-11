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

function normalizeCategoryText(v) {
  return String(v || '')
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/[’'`´]+/g, '')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemCategoryToken(token) {
  let t = normalizeCategoryText(token);
  if (!t) return '';

  const cyrSuffixes = [
    'иями',
    'ями',
    'ами',
    'ого',
    'ему',
    'ому',
    'ими',
    'ий',
    'ый',
    'ой',
    'ая',
    'яя',
    'ое',
    'ее',
    'ые',
    'ие',
    'ов',
    'ев',
    'ей',
    'ам',
    'ям',
    'ах',
    'ях',
    'а',
    'я',
    'у',
    'ю',
    'ы',
    'и',
    'е',
    'о',
  ];
  const latinSuffixes = ['ingly', 'edly', 'ing', 'ed', 'es', 's'];
  const hasCyr = /[\u0400-\u04ff]/.test(t);
  const hasLatin = /[a-z]/.test(t);
  const suffixes = hasCyr ? cyrSuffixes : hasLatin ? latinSuffixes : [];

  for (const suffix of suffixes) {
    if (t.length > suffix.length + 2 && t.endsWith(suffix)) {
      t = t.slice(0, -suffix.length);
      break;
    }
  }
  return t;
}

function tokenizeCategoryText(text, genericTokens = new Set()) {
  const normalized = normalizeCategoryText(text);
  if (!normalized) return { normalized, tokens: [], stems: [] };

  const tokens = normalized
    .split(' ')
    .filter(Boolean)
    .filter((t) => t.length >= 3 && !genericTokens.has(t));
  const stems = tokens.map((t) => stemCategoryToken(t)).filter(Boolean);

  return {
    normalized,
    tokens: Array.from(new Set(tokens)),
    stems: Array.from(new Set(stems)),
  };
}

function levenshteinDistance(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const n = s.length;
  const m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i += 1) dp[i][0] = i;
  for (let j = 0; j <= m; j += 1) dp[0][j] = j;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[n][m];
}

function similarityRatio(a, b) {
  const x = normalizeCategoryText(a);
  const y = normalizeCategoryText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const dist = levenshteinDistance(x, y);
  const maxLen = Math.max(x.length, y.length) || 1;
  return 1 - dist / maxLen;
}

function addKnownAliases(terms, row) {
  const title = normalizeCategoryText(row?.name_ua || row?.name_en || row?.slug || '');
  if (!title) return;

  if (title.includes('рол')) {
    terms.push('роли', 'ролли', 'роллы', 'roll', 'rolls');
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
  if (title.includes('горяч') || title.includes('hot')) {
    terms.push('горячее', 'горячие', 'hot dish', 'hot dishes');
  }
}

function getCategoryTerms(row) {
  const out = [];
  out.push(row.slug, row.name_ua, row.name_en);
  if (Array.isArray(row.aliases)) out.push(...row.aliases);
  addKnownAliases(out, row);

  return Array.from(
    new Set(
      out
        .map((x) => normalizeCategoryText(x))
        .filter(Boolean)
    )
  );
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
      m.protect_name_from_translation,
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

export function matchCustomCategoryFromRows(rows = [], mentionText = '') {
  const mention = normText(mentionText)?.toLowerCase();
  if (!mention) return null;

  const GENERIC_TOKENS = new Set([
    'dish',
    'dishes',
    'food',
    'menu',
    'item',
    'items',
    'have',
    'show',
    'want',
    'what',
    'please',
    'with',
    'from',
    'about',
    'something',
    'category',
    'блюдо',
    'блюда',
    'страва',
    'страви',
    'меню',
    'є',
    'есть',
    'хочу',
    'покажи',
    'что',
    'у',
    'вас',
  ]);
  const mentionParts = tokenizeCategoryText(mention, GENERIC_TOKENS);
  const mentionNorm = mentionParts.normalized;
  const mentionTokens = new Set(mentionParts.tokens);
  const mentionStems = new Set(mentionParts.stems);

  let bestRow = null;
  let bestScore = 0;

  for (const row of rows) {
    const terms = getCategoryTerms(row);
    let rowScore = 0;

    for (const t of terms) {
      if (!t) continue;

      if (mentionNorm === t) {
        rowScore = Math.max(rowScore, 100);
        continue;
      }

      if (mentionNorm.includes(t) && t.length >= 3) {
        rowScore = Math.max(rowScore, Math.min(95, 50 + t.length));
      }
      if (t.includes(mentionNorm) && mentionNorm.length >= 4) {
        rowScore = Math.max(rowScore, Math.min(90, 45 + mentionNorm.length));
      }

      const termParts = tokenizeCategoryText(t, GENERIC_TOKENS);
      let tokenOverlap = 0;

      for (const w of termParts.tokens) {
        if (mentionTokens.has(w)) tokenOverlap += 1;
      }
      for (const w of termParts.stems) {
        if (mentionStems.has(w)) tokenOverlap += 1;
      }
      if (tokenOverlap > 0) {
        rowScore = Math.max(rowScore, 60 + tokenOverlap * 10);
      }

      for (const mt of mentionStems) {
        if (mt.length < 4) continue;
        for (const tw of termParts.stems) {
          if (tw.length < 4) continue;
          const sim = similarityRatio(mt, tw);
          if (sim >= 0.82) {
            rowScore = Math.max(rowScore, 74);
          }
        }
      }
    }

    if (rowScore > bestScore) {
      bestScore = rowScore;
      bestRow = row;
    }
  }

  if (bestRow && bestScore >= 72) return bestRow;

  return null;
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

  return matchCustomCategoryFromRows(rows, mention);
}
