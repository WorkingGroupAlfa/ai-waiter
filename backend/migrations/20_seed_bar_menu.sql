BEGIN;

-- Seed bar custom categories and items for azuma_demo from frontend/bar.html
-- Safe upsert: only affects (restaurant_id='azuma_demo', slug like 'bar-%', item_code like 'BAR_%').

INSERT INTO menu_custom_categories (
  restaurant_id, slug, name_ua, name_en, aliases, is_active, sort_order
)
VALUES
  ('azuma_demo', 'bar-01', 'САКЕ', 'САКЕ', ARRAY[]::text[], TRUE, 1),
  ('azuma_demo', 'bar-02', 'ГОРІЛКА', 'ГОРІЛКА', ARRAY[]::text[], TRUE, 2),
  ('azuma_demo', 'bar-03', 'ВИНОГРАДНА ГОРІЛКА', 'ВИНОГРАДНА ГОРІЛКА', ARRAY[]::text[], TRUE, 3),
  ('azuma_demo', 'bar-04', 'ЯПОНСЬКИЙ ДЖИН', 'ЯПОНСЬКИЙ ДЖИН', ARRAY[]::text[], TRUE, 4),
  ('azuma_demo', 'bar-05', 'ДЖИН', 'ДЖИН', ARRAY[]::text[], TRUE, 5),
  ('azuma_demo', 'bar-06', 'ТЕКІЛА', 'ТЕКІЛА', ARRAY[]::text[], TRUE, 6),
  ('azuma_demo', 'bar-07', 'РОМ', 'РОМ', ARRAY[]::text[], TRUE, 7),
  ('azuma_demo', 'bar-08', 'КОНЬЯК', 'КОНЬЯК', ARRAY[]::text[], TRUE, 8),
  ('azuma_demo', 'bar-09', 'КАЛЬВАДОС', 'КАЛЬВАДОС', ARRAY[]::text[], TRUE, 9),
  ('azuma_demo', 'bar-10', 'ЯПОНСЬКИЙ ВІСКІ', 'ЯПОНСЬКИЙ ВІСКІ', ARRAY[]::text[], TRUE, 10),
  ('azuma_demo', 'bar-12', 'АМЕРИКАНСЬКИЙ ВІСКІ ТЕННЕСІ', 'АМЕРИКАНСЬКИЙ ВІСКІ ТЕННЕСІ', ARRAY[]::text[], TRUE, 12),
  ('azuma_demo', 'bar-13', 'БУРБОН', 'БУРБОН', ARRAY[]::text[], TRUE, 13),
  ('azuma_demo', 'bar-14', 'ШОТЛАНДСЬКИЙ ВІСКІ', 'ШОТЛАНДСЬКИЙ ВІСКІ', ARRAY[]::text[], TRUE, 14),
  ('azuma_demo', 'bar-15', 'ШОТЛАНДСЬКИЙ ВІСКІ ОДНОСОЛОДОВИЙ', 'ШОТЛАНДСЬКИЙ ВІСКІ ОДНОСОЛОДОВИЙ', ARRAY[]::text[], TRUE, 15),
  ('azuma_demo', 'bar-16', 'ІРЛАНДСЬКИЙ ВІСКІ', 'ІРЛАНДСЬКИЙ ВІСКІ', ARRAY[]::text[], TRUE, 16),
  ('azuma_demo', 'bar-17', 'ЛІКЕРИ', 'ЛІКЕРИ', ARRAY[]::text[], TRUE, 17),
  ('azuma_demo', 'bar-18', 'НАСТОЯНКИ', 'НАСТОЯНКИ', ARRAY[]::text[], TRUE, 18),
  ('azuma_demo', 'bar-19', 'ВЕРМУТ', 'ВЕРМУТ', ARRAY[]::text[], TRUE, 19),
  ('azuma_demo', 'bar-20', 'ШОТИ', 'ШОТИ', ARRAY[]::text[], TRUE, 20),
  ('azuma_demo', 'bar-21', 'ПИВО', 'ПИВО', ARRAY[]::text[], TRUE, 21),
  ('azuma_demo', 'bar-22', 'КОКТЕЙЛІ АЛКОГОЛЬНІ', 'КОКТЕЙЛІ АЛКОГОЛЬНІ', ARRAY[]::text[], TRUE, 22),
  ('azuma_demo', 'bar-23', 'ГАРЯЧІ НАПОЇ', 'ГАРЯЧІ НАПОЇ', ARRAY[]::text[], TRUE, 23),
  ('azuma_demo', 'bar-24', 'БЕЗАЛКОГОЛЬНІ НАПОЇ', 'БЕЗАЛКОГОЛЬНІ НАПОЇ', ARRAY[]::text[], TRUE, 24),
  ('azuma_demo', 'bar-25', 'СВІЖОВИДАВЛЕНІ СОКИ', 'СВІЖОВИДАВЛЕНІ СОКИ', ARRAY[]::text[], TRUE, 25),
  ('azuma_demo', 'bar-26', 'КОКТЕЙЛІ БЕЗАЛКОГОЛЬНІ', 'КОКТЕЙЛІ БЕЗАЛКОГОЛЬНІ', ARRAY[]::text[], TRUE, 26)
ON CONFLICT (restaurant_id, slug) DO UPDATE SET
  name_ua = EXCLUDED.name_ua,
  name_en = EXCLUDED.name_en,
  aliases = EXCLUDED.aliases,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

INSERT INTO menu_items (
  restaurant_id, item_code, name_ua, name_en,
  description_ua, description_en, base_price,
  category, tags, is_active
)
VALUES
  ('azuma_demo', 'BAR_01_CHOYA-SAKE', 'CHOYA SAKE', 'CHOYA SAKE', NULL, NULL, 210.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_01_JUNMAI-GINJO', 'Junmai Ginjo', 'Junmai Ginjo', NULL, NULL, 230.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_02_GREY-GOOSE', 'Grey Goose', 'Grey Goose', NULL, NULL, 230.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_02_MOGUTNI-KARPATY', 'Mogutni Karpaty', 'Mogutni Karpaty', NULL, NULL, 180.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_03_GRAPPA-II-PROSECCO-RISERVA', 'Grappa II Prosecco Riserva', 'Grappa II Prosecco Riserva', NULL, NULL, 420.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_03_PISCO-CAPEL', 'Pisco Capel', 'Pisco Capel', NULL, NULL, 230.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_04_ETSU-PREMIUM-ARTISANAL-JAPANESE-GIN', 'ETSU Premium artisanal Japanese Gin', 'ETSU Premium artisanal Japanese Gin', NULL, NULL, 410.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_05_HENDRICK-S', 'Hendrick''s', 'Hendrick''s', NULL, NULL, 360.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_05_TANQUERAY-LONDON-DRY', 'Tanqueray London Dry', 'Tanqueray London Dry', NULL, NULL, 235.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_05_WHITLEY-NEILL-BLOOD-ORANGE-AYVA-RASBERRY', 'Whitley Neill: blood orange, ayva, rasberry', 'Whitley Neill: blood orange, ayva, rasberry', NULL, NULL, 195.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_06_AZUL-REPOSADO', 'Azul reposado', 'Azul reposado', NULL, NULL, 2100.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_06_AZUL-PLATO', 'Azul plato', 'Azul plato', NULL, NULL, 2100.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_06_PATRON-ANEJO', 'Patron Anejo', 'Patron Anejo', NULL, NULL, 610.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_06_PATRON-RESPOSADO', 'Patron Resposado', 'Patron Resposado', NULL, NULL, 550.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_06_PATRON-SILVER', 'Patron Silver', 'Patron Silver', NULL, NULL, 490.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_06_MILANGO-SILVER', 'Milango Silver', 'Milango Silver', NULL, NULL, 510.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_06_MILANGO-SELECT-BARREL-SILVER', 'Milango Select Barrel Silver', 'Milango Select Barrel Silver', NULL, NULL, 795.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_06_MILANGO-RESPOSADO', 'Milango Resposado', 'Milango Resposado', NULL, NULL, 480.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_06_MILANGO-ANEJO', 'Milango Anejo', 'Milango Anejo', NULL, NULL, 680.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_07_ZACAPA-XO', 'Zacapa XO', 'Zacapa XO', NULL, NULL, 1800.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_07_ABUELO-12', 'Abuelo 12', 'Abuelo 12', NULL, NULL, 420.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_07_BOTAFOGO-SPICED', 'Botafogo Spiced', 'Botafogo Spiced', NULL, NULL, 250.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_07_RESERVA-EXCLUSIVA-DIPLOMATICA', 'Reserva Exclusiva Diplomatica', 'Reserva Exclusiva Diplomatica', NULL, NULL, 385.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_08_HENESSY-XO', 'Henessy XO', 'Henessy XO', NULL, NULL, 2200.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_08_HENESSY-VSOP-PRIVILEDGE', 'Henessy VSOP Priviledge', 'Henessy VSOP Priviledge', NULL, NULL, 870.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_08_HENESSY-VERY-SPECIAL', 'Henessy Very Special', 'Henessy Very Special', NULL, NULL, 450.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_08_CHATEAU-DE-MONTIFAUD-V-S-O-P', 'Chateau de Montifaud V.S.O.P.', 'Chateau de Montifaud V.S.O.P.', NULL, NULL, 550.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_09_PERE-MAGLOIRE-V-S-O-P', 'Pere Magloire V.S.O.P.', 'Pere Magloire V.S.O.P.', NULL, NULL, 250.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_10_FUJIMI-BLENDED', 'Fujimi Blended', 'Fujimi Blended', NULL, NULL, 395.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_10_THE-TOTTORI-BLENDED-BOURBON-BARREL', 'The Tottori Blended Bourbon Barrel', 'The Tottori Blended Bourbon Barrel', NULL, NULL, 490.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_10_SUNTORY-TOKI', 'Suntory Toki', 'Suntory Toki', NULL, NULL, 395.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_12_JACK-DANIEL-S-GENTLEMAN-JACK', 'Jack Daniel''s Gentleman Jack', 'Jack Daniel''s Gentleman Jack', NULL, NULL, 270.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_12_JACK-DANIEL-S-TENNESSEE-HONEY', 'Jack Daniel''s Tennessee Honey', 'Jack Daniel''s Tennessee Honey', NULL, NULL, 240.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_12_JACK-DANIEL-S-7', 'Jack Daniel''s №7', 'Jack Daniel''s №7', NULL, NULL, 190.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_13_MAKER-S-MARK', 'Maker''s Mark', 'Maker''s Mark', NULL, NULL, 320.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_14_CHIVAS-REGAL-18-YO', 'Chivas Regal 18 YO', 'Chivas Regal 18 YO', NULL, NULL, 690.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_14_CHIVAS-REGAL-12-YO', 'Chivas Regal 12 YO', 'Chivas Regal 12 YO', NULL, NULL, 320.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_14_MONKEY-SHOULDER', 'Monkey Shoulder', 'Monkey Shoulder', NULL, NULL, 395.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_15_MACALLAN-12-YO', 'Macallan 12 YO', 'Macallan 12 YO', NULL, NULL, 880.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_15_GLENFIDDICH-12-YO', 'Glenfiddich 12 YO', 'Glenfiddich 12 YO', NULL, NULL, 590.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_15_GLENFIDDICH-18-YO', 'Glenfiddich 18 YO', 'Glenfiddich 18 YO', NULL, NULL, 1400.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_15_GLENMORANGIE-QUINTA-RUBAN-12-YO', 'Glenmorangie Quinta Ruban, 12 YO', 'Glenmorangie Quinta Ruban, 12 YO', NULL, NULL, 590.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_15_GLENMORANGIE-THE-ORIGINAL-10-YO', 'Glenmorangie The Original, 10 YO', 'Glenmorangie The Original, 10 YO', NULL, NULL, 550.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_15_ARDBEG-10-YO', 'Ardbeg 10 YO', 'Ardbeg 10 YO', NULL, NULL, 590.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_15_LAPHROAIG-10-YO', 'Laphroaig 10 YO', 'Laphroaig 10 YO', NULL, NULL, 580.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_16_SAMUEL-GELSTON-S', 'Samuel Gelston''s', 'Samuel Gelston''s', NULL, NULL, 300.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_16_JAMESON', 'Jameson', 'Jameson', NULL, NULL, 210.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_16_THE-POGUES-BLENDED', 'The Pogues Blended', 'The Pogues Blended', NULL, NULL, 190.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_17_LIMONCELLO', 'Limoncello', 'Limoncello', NULL, NULL, 155.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_17_BAILEYS-THE-ORIGINAL', 'Baileys The Original', 'Baileys The Original', NULL, NULL, 155.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_17_APEROL', 'Aperol', 'Aperol', NULL, NULL, 155.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_17_HEERING-CHERRY', 'Heering Cherry', 'Heering Cherry', NULL, NULL, 280.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_17_MANDARINE-NAPOLEON', 'Mandarine Napoleon', 'Mandarine Napoleon', NULL, NULL, 235.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_17_NONINO-PRUNELLA-MANDORLATA', 'Nonino Prunella Mandorlata', 'Nonino Prunella Mandorlata', NULL, NULL, 260.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_18_CAMPARI', 'Campari', 'Campari', NULL, NULL, 155.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_18_FERNET-BRANCA', 'Fernet Branca', 'Fernet Branca', NULL, NULL, 220.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_18_AMARO-MONTENEGRO', 'Amaro Montenegro', 'Amaro Montenegro', NULL, NULL, 155.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_18_JAGERMEISTER', 'Jagermeister', 'Jagermeister', NULL, NULL, 190.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_18_BECHEROVKA', 'Becherovka', 'Becherovka', NULL, NULL, 175.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_19_MARTINI-BIANCO-ROSSO-EXTRA-DRY', 'Martini Bianco / Rosso / Extra Dry', 'Martini Bianco / Rosso / Extra Dry', NULL, NULL, 150.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_20_ELECTROLYTE', 'Electrolyte', 'Electrolyte', NULL, NULL, 210.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_20_GREEN-MEXICAN', 'Green Mexican', 'Green Mexican', NULL, NULL, 210.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_20_B-52', 'B-52', 'B-52', NULL, NULL, 210.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_21_LEFFE-BRUNE', 'Leffe Brune', 'Leffe Brune', NULL, NULL, 250.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_21_CORONA', 'Corona', 'Corona', NULL, NULL, 220.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_21_HOEGAARDEN', 'Hoegaarden', 'Hoegaarden', NULL, NULL, 250.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_21_HOEGAARDEN-ALCOHOL-FREE', 'Hoegaarden / Alcohol Free', 'Hoegaarden / Alcohol Free', NULL, NULL, 220.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_PEACH-SOUR', 'Peach Sour', 'Peach Sour', NULL, NULL, 310.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_WHISKEY-SOUR', 'Whiskey Sour', 'Whiskey Sour', NULL, NULL, 310.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_PISCO-PARADISE', 'Pisco Paradise', 'Pisco Paradise', NULL, NULL, 395.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_MAI-TAI', 'Mai Tai', 'Mai Tai', NULL, NULL, 450.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_BLOODY-MARY', 'Bloody Mary', 'Bloody Mary', NULL, NULL, 370.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_APEROL-SOUR', 'Aperol Sour', 'Aperol Sour', NULL, NULL, 290.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_PINK-COLADA', 'Pink Colada', 'Pink Colada', NULL, NULL, 320.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_NEGRONI', 'Negroni', 'Negroni', NULL, NULL, 320.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_MOJITO', 'Mojito', 'Mojito', NULL, NULL, 320.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_MOJITO-FRUIT', 'Mojito Fruit', 'Mojito Fruit', NULL, NULL, 320.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_DAIQUIRI-PASSIONFRUIT', 'Daiquiri PassionFruit', 'Daiquiri PassionFruit', NULL, NULL, 270.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_LONG-ISLAND-ICE-TEA', 'Long Island Ice Tea', 'Long Island Ice Tea', NULL, NULL, 450.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_BELLINI', 'Bellini', 'Bellini', NULL, NULL, 390.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_HENDRICK-S-TONIC', 'Hendrick''s Tonic', 'Hendrick''s Tonic', NULL, NULL, 550.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_APEROL-SPRITZ', 'Aperol Spritz', 'Aperol Spritz', NULL, NULL, 390.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_HUGO', 'Hugo', 'Hugo', NULL, NULL, 410.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_CROWN-BERRY', 'Crown Berry', 'Crown Berry', NULL, NULL, 325.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_22_EMPIRE-STAR-MARTINI', 'Empire Star martini', 'Empire Star martini', NULL, NULL, 360.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_26_PINK-COLADA-SOFT-DRINK', 'Pink Colada (soft drink)', 'Pink Colada (soft drink)', NULL, NULL, 300.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_26_MOJITO-SOFT-DRINK', 'Mojito (soft drink)', 'Mojito (soft drink)', NULL, NULL, 290.00, 'drink', ARRAY['drink']::text[], TRUE),
  ('azuma_demo', 'BAR_26_FRUIT-MOJITO-SOFT-DRINK', 'Fruit Mojito (soft drink)', 'Fruit Mojito (soft drink)', NULL, NULL, 290.00, 'drink', ARRAY['drink']::text[], TRUE)
ON CONFLICT (restaurant_id, item_code) DO UPDATE SET
  name_ua = EXCLUDED.name_ua,
  name_en = EXCLUDED.name_en,
  description_ua = NULL,
  description_en = NULL,
  base_price = EXCLUDED.base_price,
  category = EXCLUDED.category,
  tags = EXCLUDED.tags,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

INSERT INTO menu_item_custom_categories (menu_item_id, custom_category_id)
SELECT mi.id, mcc.id
FROM menu_items mi
JOIN menu_custom_categories mcc
  ON mcc.restaurant_id = mi.restaurant_id
 AND mcc.slug = ('bar-' || split_part(mi.item_code, '_', 2))
WHERE mi.restaurant_id = 'azuma_demo'
  AND mi.item_code LIKE 'BAR_%'
ON CONFLICT DO NOTHING;

COMMIT;
