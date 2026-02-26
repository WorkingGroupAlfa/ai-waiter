// src/models/aiPersonaModel.js
import { query } from '../db.js';

export async function getPersonaByRestaurant(restaurantId) {
  const { rows } = await query(
    `
    SELECT restaurant_id, speech_rate, humor_level, tone, greeting, farewell
    FROM ai_persona_settings
    WHERE restaurant_id = $1
    `,
    [restaurantId]
  );
  return rows[0] || null;
}

export async function upsertPersona(payload) {
  const {
    restaurant_id,
    speech_rate,
    humor_level,
    tone,
    greeting,
    farewell,
  } = payload;

  const { rows } = await query(
    `
    INSERT INTO ai_persona_settings
      (restaurant_id, speech_rate, humor_level, tone, greeting, farewell)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (restaurant_id)
    DO UPDATE SET
      speech_rate = EXCLUDED.speech_rate,
      humor_level = EXCLUDED.humor_level,
      tone        = EXCLUDED.tone,
      greeting    = EXCLUDED.greeting,
      farewell    = EXCLUDED.farewell,
      updated_at  = now()
    RETURNING restaurant_id, speech_rate, humor_level, tone, greeting, farewell
    `,
    [restaurant_id, speech_rate, humor_level, tone, greeting, farewell]
  );

  return rows[0];
}
