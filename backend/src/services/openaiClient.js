// src/services/openaiClient.js
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();
const apiKey = process.env.OPENAI_API_KEY;

let openai = null;
let hasOpenAI = false;

if (apiKey) {
  openai = new OpenAI({ apiKey });
  hasOpenAI = true;
  console.log('[AI Waiter] OpenAI client initialized.');
} else {
  console.warn(
    '[AI Waiter] OPENAI_API_KEY is not set. Falling back to rule-based NLU/NLG.'
  );
}

export { openai, hasOpenAI };
