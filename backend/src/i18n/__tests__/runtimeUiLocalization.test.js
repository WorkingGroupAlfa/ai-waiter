import test from 'node:test';
import assert from 'node:assert/strict';

import { localizeUiPayloadBatch } from '../runtimeUiLocalization.js';

async function fakeLiteralTranslator(text, lang) {
  const translated = String(text)
    .replaceAll('Grey Goose', 'Ganso Gris')
    .replaceAll('Azul Plata', 'Plata Azul')
    .replaceAll('Aperol Spritz', 'Aperol Rociado')
    .replaceAll('Would you like', 'Te gustaria')
    .replaceAll('with', 'con')
    .replaceAll('or', 'o')
    .replaceAll('Try', 'Prueba')
    .replaceAll('Available', 'Disponible')
    .replaceAll('Order draft', 'Borrador del pedido')
    .replaceAll('Recommendation', 'Recomendacion');

  return `[${lang}] ${translated}`;
}

async function fakeMenuNameTranslator(text, lang) {
  const translated = String(text)
    .replaceAll('Chicken Soup', 'Sopa de pollo')
    .replaceAll('Tom Yum', 'Tom Yum')
    .replaceAll('Daplings', 'Daplings')
    .replaceAll('Spicy Tuna Roll', 'Rollo picante de atun');

  return `[${lang}] ${translated}`;
}

test('replyText preserves protected proper names on multiple languages', async () => {
  for (const lang of ['es', 'pl', 'de']) {
    const localized = await localizeUiPayloadBatch({
      targetLanguage: lang,
      replyText:
        'Would you like Grey Goose or Aperol Spritz? Azul Plata is also available.',
      orderDraft: {
        items: [
          {
            code: 'GREY_GOOSE',
            name: 'Grey Goose',
            category: 'special',
            protect_name_from_translation: true,
          },
        ],
      },
      upsell: {
        text: 'Try Aperol Spritz with Grey Goose.',
        items: [
          {
            code: 'APEROL_SPRITZ',
            name: 'Aperol Spritz',
            protect_name_from_translation: true,
          },
        ],
      },
      recommendations: [
        {
          code: 'AZUL_PLATA',
          name: 'Azul Plata',
          protect_name_from_translation: true,
        },
      ],
      translateTextFn: fakeLiteralTranslator,
    });

    assert.match(localized.replyText, /Grey Goose/);
    assert.match(localized.replyText, /Aperol Spritz/);
    assert.match(localized.replyText, /Azul Plata/);
    assert.doesNotMatch(localized.replyText, /Ganso Gris|Aperol Rociado|Plata Azul/);

    assert.match(localized.upsell.text, /Grey Goose/);
    assert.match(localized.upsell.text, /Aperol Spritz/);
    assert.doesNotMatch(localized.upsell.text, /Ganso Gris|Aperol Rociado/);
  }
});

test('protected names remain unchanged in order draft, upsell items and recommendations', async () => {
  const localized = await localizeUiPayloadBatch({
    targetLanguage: 'es',
    replyText: 'Order draft: Grey Goose.',
    orderDraft: {
      items: [
        {
          code: 'GREY_GOOSE',
          name: 'Grey Goose',
          category: 'non-drink-special',
          protect_name_from_translation: true,
        },
      ],
    },
    upsell: {
      text: 'Try Aperol Spritz.',
      items: [
        {
          code: 'APEROL_SPRITZ',
          name: 'Aperol Spritz',
          category: 'cocktails',
          protect_name_from_translation: true,
        },
      ],
    },
    recommendations: [
      {
        code: 'AZUL_PLATA',
        name: 'Azul Plata',
        category: 'tequila',
        protect_name_from_translation: true,
      },
    ],
    translateTextFn: fakeLiteralTranslator,
  });

  assert.equal(localized.orderDraft.items[0].name, 'Grey Goose');
  assert.equal(localized.orderDraft.items[0].display_name, 'Grey Goose');
  assert.equal(localized.orderDraft.items[0].raw_name, 'Grey Goose');

  assert.equal(localized.upsell.items[0].name, 'Aperol Spritz');
  assert.equal(localized.upsell.items[0].display_name, 'Aperol Spritz');
  assert.equal(localized.upsell.items[0].raw_name, 'Aperol Spritz');

  assert.equal(localized.recommendations[0].name, 'Azul Plata');
  assert.equal(localized.recommendations[0].display_name, 'Azul Plata');
  assert.equal(localized.recommendations[0].raw_name, 'Azul Plata');
});

test('menu-style dish names avoid coarse literal translation and stay consistent in replyText and cards', async () => {
  const localized = await localizeUiPayloadBatch({
    targetLanguage: 'ru',
    replyText: 'Order draft: Daplings, Chicken Soup, Tom Yum.',
    orderDraft: {
      items: [
        {
          code: 'DAPLINGS',
          name: 'Daplings',
        },
        {
          code: 'CHICKEN_SOUP',
          name: 'Chicken Soup',
        },
      ],
    },
    recommendations: [
      {
        code: 'TOM_YUM',
        name: 'Tom Yum',
      },
    ],
    translateTextFn: fakeLiteralTranslator,
    translateMenuItemNameFn: fakeMenuNameTranslator,
  });

  assert.match(localized.replyText, /\[ru\] Daplings/);
  assert.match(localized.replyText, /\[ru\] Sopa de pollo/);
  assert.match(localized.replyText, /\[ru\] Tom Yum/);
  assert.doesNotMatch(localized.replyText, /пельмени|dumplings/i);

  assert.equal(localized.orderDraft.items[0].name, '[ru] Daplings');
  assert.equal(localized.orderDraft.items[0].display_name, '[ru] Daplings');
  assert.equal(localized.orderDraft.items[0].raw_name, 'Daplings');

  assert.equal(localized.orderDraft.items[1].name, '[ru] Sopa de pollo');
  assert.equal(localized.orderDraft.items[1].display_name, '[ru] Sopa de pollo');
  assert.equal(localized.orderDraft.items[1].raw_name, 'Chicken Soup');

  assert.equal(localized.recommendations[0].name, '[ru] Tom Yum');
  assert.equal(localized.recommendations[0].display_name, '[ru] Tom Yum');
  assert.equal(localized.recommendations[0].raw_name, 'Tom Yum');
});

test('menu-style localization works across multiple non-EN languages', async () => {
  for (const lang of ['pl', 'de', 'es']) {
    const localized = await localizeUiPayloadBatch({
      targetLanguage: lang,
      replyText: 'Recommendation: Daplings with Spicy Tuna Roll.',
      recommendations: [
        {
          code: 'DAPLINGS',
          name: 'Daplings',
        },
        {
          code: 'SPICY_TUNA_ROLL',
          name: 'Spicy Tuna Roll',
        },
      ],
      translateTextFn: fakeLiteralTranslator,
      translateMenuItemNameFn: fakeMenuNameTranslator,
    });

    assert.match(localized.replyText, /\[.+\] Daplings/);
    assert.match(localized.replyText, /\[.+\] Rollo picante de atun/);
    assert.equal(localized.recommendations[0].raw_name, 'Daplings');
    assert.equal(localized.recommendations[1].raw_name, 'Spicy Tuna Roll');
  }
});

test('localization keeps exact item identifiers intact for item cards', async () => {
  const localized = await localizeUiPayloadBatch({
    targetLanguage: 'uk',
    orderDraft: {
      items: [
        {
          code: 'DAPLINGS_EXACT',
          name: 'Daplings',
        },
      ],
    },
    translateTextFn: fakeLiteralTranslator,
    translateMenuItemNameFn: fakeMenuNameTranslator,
  });

  assert.equal(localized.orderDraft.items[0].code, 'DAPLINGS_EXACT');
  assert.equal(localized.orderDraft.items[0].raw_name, 'Daplings');
  assert.equal(localized.orderDraft.items[0].name, '[uk] Daplings');
});
