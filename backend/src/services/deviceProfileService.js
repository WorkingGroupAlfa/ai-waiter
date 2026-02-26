// src/services/deviceProfileService.js
import {
  findDeviceProfile,
  insertDeviceProfile,
  updateDeviceProfile as updateDeviceProfileModel,
} from '../models/deviceProfileModel.js';

/**
 * Вызывается, когда устройство впервые/очередной раз зашло.
 * Создаёт профиль, если его ещё нет, или обновляет last_seen.
 */
export async function touchDeviceProfile(deviceId) {
  if (!deviceId) return null;
  return insertDeviceProfile(deviceId);
}

/**
 * Получить профиль устройства.
 * Если createIfMissing=true — создаст новый профиль, если не найден.
 */
export async function getDeviceProfile(deviceId, { createIfMissing = false } = {}) {
  if (!deviceId) return null;

  let profile = await findDeviceProfile(deviceId);

  if (!profile && createIfMissing) {
    profile = await insertDeviceProfile(deviceId);
  }

  return profile;
}

/**
 * Обновить профиль устройства (аллергии, поведение и т.п.)
 */
export async function updateDeviceProfile(deviceId, data) {
  if (!deviceId) return null;
  return updateDeviceProfileModel(deviceId, data);
}

/**
 * Совместимый метод для старого кода:
 * вернуть массив аллергий устройства.
 * Используется в upsellService и chatRoutes.
 */
export async function getDeviceAllergies(deviceId) {
  const profile = await getDeviceProfile(deviceId, { createIfMissing: false });

  if (!profile || profile.allergies == null) {
    return [];
  }

  if (Array.isArray(profile.allergies)) {
    return profile.allergies;
  }

  if (typeof profile.allergies === 'string') {
    try {
      const parsed = JSON.parse(profile.allergies);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Failed to parse allergies JSON', e);
      return [];
    }
  }

  return [];
}

/**
 * Совместимая функция для старого кода:
 * обновить только allergies в профиле устройства.
 * Используется в chatRoutes (updateDeviceAllergies).
 */
export async function updateDeviceAllergies(deviceId, allergies) {
  if (!deviceId) return null;

  return updateDeviceProfileModel(deviceId, {
    allergies,
  });
}
