// src/db/index.js
import pkg from 'pg';
import { dbConfig } from '../config/env.js';

const { Pool } = pkg;

export const pool = new Pool({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
});

export async function query(text, params) {
  return pool.query(text, params);
}
