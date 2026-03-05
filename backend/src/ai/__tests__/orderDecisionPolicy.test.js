import test from 'node:test';
import assert from 'node:assert/strict';

import { buildQueryUnderstanding } from '../queryUnderstanding.js';
import { decideOrderMutationPolicy } from '../orderDecisionPolicy.js';

function makeItem({ menu_item_id = null, matchConfidence = 0, rawText = '' } = {}) {
  return { menu_item_id, matchConfidence, rawText };
}

test('"I want noodles" routes to suggestions and blocks cart mutation', () => {
  const understanding = buildQueryUnderstanding('I want noodles', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'I want noodles',
    nluItems: [makeItem({ rawText: 'noodles', matchConfidence: 0 })],
    clarificationNeeded: true,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'suggest');
});

test('"I want burger" routes to suggestions and blocks cart mutation', () => {
  const understanding = buildQueryUnderstanding('I want burger', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'I want burger',
    nluItems: [makeItem({ rawText: 'burger', matchConfidence: 0 })],
    clarificationNeeded: true,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'suggest');
});

test('"I want meat" routes to suggestions and blocks cart mutation', () => {
  const understanding = buildQueryUnderstanding('I want meat', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'order',
    text: 'I want meat',
    nluItems: [makeItem({ rawText: 'meat', matchConfidence: 0.4 })],
    clarificationNeeded: true,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'suggest');
});

test('"Do you have meat dishes?" routes to suggestions and blocks cart mutation', () => {
  const understanding = buildQueryUnderstanding('Do you have meat dishes?', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'ask_menu',
    text: 'Do you have meat dishes?',
    nluItems: [],
    clarificationNeeded: false,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'suggest');
});

test('explicit high-confidence order allows add', () => {
  const understanding = buildQueryUnderstanding('Add tuna nigiri', { localeHint: 'en' });
  const decision = decideOrderMutationPolicy({
    resolvedIntent: 'add_to_order',
    text: 'Add tuna nigiri',
    nluItems: [makeItem({ rawText: 'tuna nigiri', menu_item_id: 'm1', matchConfidence: 0.93 })],
    clarificationNeeded: false,
    queryUnderstanding: understanding,
  });
  assert.equal(decision.mode, 'add');
});

