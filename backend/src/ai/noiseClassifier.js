// backend/src/ai/noiseClassifier.js

/**
 * Примитивный классификатор шума.
 * Цель: не гонять ASR на полностью пустых/очень тихих кусках аудио.
 *
 * Мы считаем "энергию" сигнала как среднее абсолютное отклонение байт
 * от их среднего значения. Если буфер слишком короткий или энергия
 * ниже порога — считаем, что речи нет.
 *
 * Это не ML-модель, но для ТЗ достаточно, чтобы отсеивать тишину/шум.
 *
 * @param {Buffer|Uint8Array} audioBuffer
 * @returns {boolean} - true, если похоже, что речь есть
 */
export function isSpeechPresent(audioBuffer) {
  if (!audioBuffer || !audioBuffer.length) {
    return false;
  }

  // Совсем короткие отрезки считаем шумом/тишиной
  if (audioBuffer.length < 2000) {
    return false;
  }

  const buf = Buffer.isBuffer(audioBuffer)
    ? audioBuffer
    : Buffer.from(audioBuffer);

  const len = buf.length;
  let sum = 0;

  for (let i = 0; i < len; i += 1) {
    sum += buf[i];
  }

  const mean = sum / len;

  let sumAbsDiff = 0;
  for (let i = 0; i < len; i += 1) {
    const diff = buf[i] - mean;
    sumAbsDiff += Math.abs(diff);
  }

  const avgAbsDiff = sumAbsDiff / len;

  // Эмпирический порог. Если нужно — можно подкрутить.
  const ENERGY_THRESHOLD = 5;

  const isSpeech = avgAbsDiff >= ENERGY_THRESHOLD;

  // Можно раскомментировать для дебага:
  // console.log('[noiseClassifier] len, avgAbsDiff, isSpeech =', len, avgAbsDiff, isSpeech);

  return isSpeech;
}
