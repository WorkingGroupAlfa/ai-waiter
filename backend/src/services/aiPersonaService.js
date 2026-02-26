// src/services/aiPersonaService.js
import {
  getPersonaByRestaurant,
  upsertPersona,
} from '../models/aiPersonaModel.js';

export async function loadPersona(restaurantId) {
  const persona = await getPersonaByRestaurant(restaurantId);
  if (persona) return persona;

  // дефолтные настройки, если записи ещё нет
  return {
    restaurant_id: restaurantId,
    speech_rate: 1.0,
    humor_level: 0.0,
    tone: 'neutral',
    greeting: 'Hello! I am your AI assistant.',
    farewell: 'Thank you for visiting!',
  };
}

export async function savePersona(payload) {
  return upsertPersona(payload);
}
