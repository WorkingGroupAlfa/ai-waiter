import test from 'node:test';
import assert from 'node:assert/strict';

import { buildQueryUnderstanding } from '../queryUnderstanding.js';
import { decideOrderMutationPolicy } from '../orderDecisionPolicy.js';

function makeItem({
  menu_item_id = null,
  matchConfidence = 0,
  matchSource = '',
  rawText = '',
} = {}) {
  return { menu_item_id, matchConfidence, matchSource, rawText };
}

test('exact match fast path enables add_exact for explicit order', () => {
  const understanding = buildQueryUnderstanding('хочу попкорн из креветок', { localeHint: 'ru' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'хочу попкорн из креветок',
    nluItems: [
      makeItem({
        rawText: 'попкорн из креветок',
        menu_item_id: 'm1',
        matchConfidence: 0.97,
        matchSource: 'name_exact',
      }),
    ],
    clarificationNeeded: false,
    queryUnderstanding: understanding,
  });

  assert.equal(decision.mode, 'add_exact');
  assert.deepEqual(decision.exactItemIds, ['m1']);
});

test('short exact match source enables add_exact for explicit order intent', () => {
  const understanding = buildQueryUnderstanding('Хочу том ям', { localeHint: 'ru' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'Хочу том ям',
    nluItems: [
      makeItem({
        rawText: 'том ям',
        menu_item_id: 'm_short_1',
        matchConfidence: 0.995,
        matchSource: 'name_exact_short',
      }),
    ],
    clarificationNeeded: false,
    queryUnderstanding: understanding,
  });

  assert.equal(decision.mode, 'add_exact');
  assert.equal(decision.reason, 'exact_match_fast_path');
  assert.deepEqual(decision.exactItemIds, ['m_short_1']);
});

test('short exact match no longer downgrades into suggest fallback path', () => {
  const understanding = buildQueryUnderstanding('Tom Yum', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'Tom Yum',
    nluItems: [
      makeItem({
        rawText: 'Tom Yum',
        menu_item_id: 'm_short_2',
        matchConfidence: 0.99,
        matchSource: 'name_exact_short',
      }),
    ],
    clarificationNeeded: false,
    queryUnderstanding: understanding,
  });

  assert.equal(decision.mode, 'add_exact');
  assert.notEqual(decision.mode, 'suggest_list');
  assert.equal(decision.reason, 'exact_match_direct_mention');
  assert.deepEqual(decision.exactItemIds, ['m_short_2']);
});

test('"I want noodles" routes to suggest_list and blocks cart mutation', () => {
  const understanding = buildQueryUnderstanding('I want noodles', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'I want noodles',
    nluItems: [makeItem({ rawText: 'noodles', matchConfidence: 0 })],
    clarificationNeeded: true,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'suggest_list');
});

test('"I want burger" routes to suggest_list and blocks cart mutation', () => {
  const understanding = buildQueryUnderstanding('I want burger', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'I want burger',
    nluItems: [makeItem({ rawText: 'burger', matchConfidence: 0 })],
    clarificationNeeded: true,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'suggest_list');
});

test('"I want meat" routes to suggest_list and blocks cart mutation', () => {
  const understanding = buildQueryUnderstanding('I want meat', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'I want meat',
    nluItems: [makeItem({ rawText: 'meat', matchConfidence: 0.4 })],
    clarificationNeeded: true,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'suggest_list');
});

test('single high-confidence non-exact candidate requires clarification', () => {
  const understanding = buildQueryUnderstanding('I want tuna', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'add_to_order',
    text: 'I want tuna',
    nluItems: [
      makeItem({
        rawText: 'tuna',
        menu_item_id: 'm2',
        matchConfidence: 0.89,
        matchSource: 'embedding',
      }),
    ],
    clarificationNeeded: false,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'ask_clarify');
});

test('tequila preference without exact item routes to suggest_list', () => {
  const understanding = buildQueryUnderstanding('Хочу текилу', { localeHint: 'ru' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'Хочу текилу',
    nluItems: [],
    clarificationNeeded: false,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'suggest_list');
});

test('very-high fuzzy drink match still uses add_exact fast path', () => {
  const understanding = buildQueryUnderstanding('хочу водку grey goose', { localeHint: 'ru' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'хочу водку grey goose',
    nluItems: [
      makeItem({
        rawText: 'grey goose',
        menu_item_id: 'm42',
        matchConfidence: 0.95,
        matchSource: 'name_fuzzy_drink',
      }),
    ],
    clarificationNeeded: false,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'add_exact');
});

test('exact direct mention without explicit verb still uses add_exact', () => {
  const understanding = buildQueryUnderstanding('Azul Plato', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'Azul Plato',
    nluItems: [
      makeItem({
        rawText: 'Azul Plato',
        menu_item_id: 'm55',
        matchConfidence: 0.96,
        matchSource: 'name_exact',
      }),
    ],
    clarificationNeeded: false,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'add_exact');
  assert.equal(decision.reason, 'exact_match_direct_mention');
});

test('category request does not auto-add even in english', () => {
  const understanding = buildQueryUnderstanding('do you have tequila', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'do you have tequila',
    nluItems: [],
    clarificationNeeded: false,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'suggest_list');
});

test('exact tequila item still uses add_exact and is not downgraded to category flow', () => {
  const understanding = buildQueryUnderstanding('Tequila Sunrise', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'Tequila Sunrise',
    nluItems: [
      makeItem({
        rawText: 'Tequila Sunrise',
        menu_item_id: 'm77',
        matchConfidence: 0.96,
        matchSource: 'name_exact',
      }),
    ],
    clarificationNeeded: false,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'add_exact');
});
