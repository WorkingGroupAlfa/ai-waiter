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
