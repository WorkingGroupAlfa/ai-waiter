import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupeByCode,
  buildOrderDraftForResponseSafe,
  buildOrderReplyTextSafe,
} from '../dialogResponseUtils.js';

test('dedupeByCode removes duplicate recommendation items', () => {
  const rows = dedupeByCode([
    { code: 'SHRIMP_POPCORN', name: 'Popcorn' },
    { code: 'shrimp_popcorn', name: 'Popcorn duplicate' },
    { code: 'GREY_GOOSE', name: 'Grey Goose' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].code, 'SHRIMP_POPCORN');
  assert.equal(rows[1].code, 'GREY_GOOSE');
});

test('buildOrderDraftForResponseSafe merges duplicate order item codes', () => {
  const draft = buildOrderDraftForResponseSafe({
    id: 'o1',
    status: 'draft',
    table_id: '7',
    total_amount: 300,
    items: [
      { id: '1', item_code: 'SHRIMP_POPCORN', item_name: 'ПОПКОРН З КРЕВЕТОК', quantity: 1, unit_price: 100 },
      { id: '2', item_code: 'SHRIMP_POPCORN', item_name: 'ПОПКОРН З КРЕВЕТОК', quantity: 2, unit_price: 100 },
      { id: '3', item_code: 'GREY_GOOSE', item_name: 'Grey Goose', quantity: 1, unit_price: 200 },
    ],
  });

  assert.equal(draft.items.length, 2);
  const popcorn = draft.items.find((x) => x.code === 'SHRIMP_POPCORN');
  assert.ok(popcorn);
  assert.equal(popcorn.quantity, 3);
});

test('buildOrderReplyTextSafe does not duplicate repeated lines', () => {
  const text = buildOrderReplyTextSafe({
    total_amount: 300,
    items: [
      { item_code: 'SHRIMP_POPCORN', item_name: 'ПОПКОРН З КРЕВЕТОК', quantity: 1 },
      { item_code: 'SHRIMP_POPCORN', item_name: 'ПОПКОРН З КРЕВЕТОК', quantity: 1 },
      { item_code: 'GREY_GOOSE', item_name: 'Grey Goose', quantity: 1 },
    ],
  });

  const popcornOccurrences = (text.match(/ПОПКОРН З КРЕВЕТОК/g) || []).length;
  assert.equal(popcornOccurrences, 1);
});

