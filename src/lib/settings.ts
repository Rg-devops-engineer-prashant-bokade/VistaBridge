// ============================================================================
// Application Settings Storage
//
// Reads and saves key-value settings in the SQLite 'app_settings' table
// (e.g. geoserver_url, tileserv_url, jwt_secret) and caches them in memory.
// ============================================================================

import { pool, initDb } from './db';

// In-memory cache so we don't hit SQLite on every request
const cachedSettings: Record<string, string> = {};

// Gets a setting by key (checks memory cache first, then queries database)
export async function getAppSetting(key: string, defaultValue: string = ''): Promise<string> {
  if (cachedSettings[key]) {
    return cachedSettings[key];
  }

  await initDb();
  try {
    const res = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
    if (res.rows.length > 0 && res.rows[0].value) {
      const val = typeof res.rows[0].value === 'string' ? res.rows[0].value : JSON.stringify(res.rows[0].value);
      cachedSettings[key] = val;
      return val;
    }
  } catch (err) {
    console.error(`[settings.ts] Failed to read app setting '${key}':`, err);
  }

  return defaultValue;
}

// Saves or updates a setting in the SQLite database and updates the memory cache
export async function setAppSetting(key: string, value: string): Promise<void> {
  await initDb();
  cachedSettings[key] = value;
  try {
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [key, value]
    );
  } catch (err) {
    console.error(`[settings.ts] Failed to save app setting '${key}':`, err);
  }
}

// Returns the core public endpoints used by the frontend map and UI
export async function getPublicConfig(): Promise<{ geoserverUrl: string; tileservUrl: string; apiUrl: string }> {
  await initDb();
  const geoserverUrl = await getAppSetting('geoserver_url', 'http://localhost:8080/geoserver');
  const tileservUrl = await getAppSetting('tileserv_url', 'http://localhost:7800');
  const apiUrl = await getAppSetting('api_url', '/api');
  return { geoserverUrl, tileservUrl, apiUrl };
}


