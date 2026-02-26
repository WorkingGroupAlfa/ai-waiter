// src/config/env.js
import dotenv from 'dotenv';

dotenv.config();

export const env = process.env;

// Общие настройки приложения
export const appConfig = {
  port: Number(env.PORT || 3000),
  nodeEnv: env.NODE_ENV || 'development',
};

// Настройки БД
export const dbConfig = {
  host: env.PG_HOST,
  port: Number(env.PG_PORT || 5432),
  user: env.PG_USER,
  password: env.PG_PASSWORD,
  database: env.PG_DATABASE,
};

// Telegram
export const telegramConfig = {
  botToken: env.TELEGRAM_BOT_TOKEN,
  orderChatId: env.TELEGRAM_CHAT_ID, // у тебя сейчас TELEGRAM_CHAT_ID
};

// OpenAI
export const openaiConfig = {
  apiKey: env.OPENAI_API_KEY,
};
