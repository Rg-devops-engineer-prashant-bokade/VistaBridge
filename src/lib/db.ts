// ============================================================================
// SQLite Database Engine (@libsql/client)
// 
// This file manages the local SQLite database for GeoVista.
// It creates tables (maps, dashboards, user profiles, settings),
// handles queries, and translates PostgreSQL-style SQL to SQLite.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { setCachedJwtSecret } from './jwt';

// Singleton database connection instance kept in memory
let clientInstance: Client | null = null;

// Returns the full path to the SQLite database file (defaults to data/geovista.db)
function getDatabaseFilePath(): string {
  if (process.env.SQLITE_DB_PATH) {
    return path.resolve(process.env.SQLITE_DB_PATH);
  }
  return path.resolve(process.cwd(), 'data', 'geovista.db');
}

// Connects to the SQLite database. If the 'data' folder doesn't exist, it creates it.
function getDbClient(): Client {
  if (!clientInstance) {
    const absolutePath = getDatabaseFilePath();
    const dbDir = path.dirname(absolutePath);
    // Create data directory if missing
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    // LibSQL uses "file:" URI format
    const fileUrl = 'file:' + absolutePath.replace(/\\/g, '/');
    clientInstance = createClient({ url: fileUrl });
    console.log(`[db.ts] Connected to SQLite database: ${absolutePath}`);
  }
  return clientInstance;
}

// Automatically parses JSON strings in query results back into JavaScript objects/arrays
function autoParseJson(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const copy: any = { ...row };
  for (const key of Object.keys(copy)) {
    const val = copy[key];
    if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
      try {
        copy[key] = JSON.parse(val);
      } catch {
        // Keep as string if parsing fails
      }
    }
  }
  return copy;
}

// Converts PostgreSQL SQL syntax to SQLite syntax:
// - Removes Postgres casts like ::text
// - Replaces NOW() with CURRENT_TIMESTAMP
function translateSqlForSqlite(sql: string): string {
  return sql
    .replace(/::[a-zA-Z0-9_]+(\[\])?/g, '') // remove postgres casts (e.g. ::text[])
    .replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP'); // map NOW() to CURRENT_TIMESTAMP
}

// Runs a query on SQLite, serializes parameters (objects to JSON, booleans to 1/0),
// and returns the matching rows and row count.
async function sqliteQuery(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
  const client = getDbClient();
  let translated = translateSqlForSqlite(sql);

  // Serialize parameters for SQLite
  const serializedParams = (params || []).map((p) => {
    if (p !== null && typeof p === 'object') {
      return JSON.stringify(p);
    }
    if (typeof p === 'boolean') {
      return p ? 1 : 0;
    }
    return p;
  });

  // If query uses Postgres-style positional parameters ($1, $2, etc.),
  // map each placeholder to its corresponding argument (allowing repeated indices like $1 ... $1)
  let finalArgs: any[] = serializedParams;
  if (/\$\d+/.test(translated)) {
    const reordered: any[] = [];
    translated = translated.replace(/\$(\d+)/g, (_, num) => {
      const idx = parseInt(num, 10) - 1;
      reordered.push(serializedParams[idx]);
      return '?';
    });
    finalArgs = reordered;
  } else {
    // If query already uses ?, keep finalArgs as serializedParams
    finalArgs = serializedParams;
  }

  const res = await client.execute({ sql: translated, args: finalArgs });
  const parsedRows = (res.rows || []).map(autoParseJson);
  const rowCount = res.rowsAffected !== undefined ? res.rowsAffected : parsedRows.length;
  return { rows: parsedRows, rowCount };
}

// ============================================================================
// Compatibility Pool
// Mimics a standard PostgreSQL 'pg' pool so existing code can call pool.query()
// ============================================================================
export const pool = {
  query: async (sql: string, params?: any[]) => {
    return sqliteQuery(sql, params);
  },
  connect: async () => {
    return {
      query: (sql: string, params?: any[]) => sqliteQuery(sql, params),
      release: () => { },
    };
  },
};

let dbInitialized = false;

// Initializes the database:
// 1. Creates all tables (map_workspaces, dashboards, user_profiles, app_settings, etc.)
// 2. Runs column migrations for any newly added fields
// 3. Generates and saves a secret JWT key and default GeoServer URLs
export async function initDb() {
  if (dbInitialized) return;



  try {
    const client = getDbClient();
    await client.batch([
      `CREATE TABLE IF NOT EXISTS map_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        share TEXT DEFAULT 'PRIVATE',
        type TEXT NOT NULL,
        center_lon REAL,
        center_lat REAL,
        zoom REAL,
        basemap_id TEXT,
        layers TEXT,
        created_by TEXT,
        geoserver_url TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS map_annotations (
        id TEXT PRIMARY KEY,
        map_id TEXT REFERENCES map_workspaces(id) ON DELETE CASCADE,
        geometry TEXT NOT NULL,
        label TEXT,
        type TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS map_measurements (
        id TEXT PRIMARY KEY,
        map_id TEXT REFERENCES map_workspaces(id) ON DELETE CASCADE,
        geometry TEXT NOT NULL,
        display_val TEXT,
        type TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS user_profiles (
        username TEXT NOT NULL,
        geoserver_url TEXT NOT NULL DEFAULT '',
        first_name TEXT,
        last_name TEXT,
        email TEXT,
        role TEXT DEFAULT 'MEMBER',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (username, geoserver_url)
      )`,
      `CREATE TABLE IF NOT EXISTS goto_xy_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        map_id TEXT REFERENCES map_workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        zoom REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS dashboards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        is_public INTEGER DEFAULT 0,
        content TEXT DEFAULT '{"widgets":[]}',
        tags TEXT DEFAULT '[]',
        version INTEGER DEFAULT 1,
        thumbnail TEXT,
        created_by TEXT,
        geoserver_url TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS dashboard_charts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        chart_type TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        created_by TEXT,
        geoserver_url TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS custom_basemaps (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        url TEXT NOT NULL,
        thumbnail TEXT,
        attributions TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS user_preferences (
        username TEXT PRIMARY KEY,
        theme_color TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`
    ], 'write');

    console.log('[db.ts] SQLite tables verified/created successfully.');

    // ------------------------------------------------------------------------
    // STEP 1: Additive column migrations for existing SQLite databases
    // ------------------------------------------------------------------------
    // Allows seamless updates when new feature columns are introduced,
    // inspecting table metadata via `PRAGMA table_info` before issuing `ALTER TABLE`.
    const migrations = [
      { table: 'map_workspaces', col: 'description', type: 'TEXT' },
      { table: 'map_workspaces', col: 'share', type: "TEXT DEFAULT 'PRIVATE'" },
      { table: 'map_workspaces', col: 'type', type: "TEXT DEFAULT '2D'" },
      { table: 'map_workspaces', col: 'center_lon', type: 'REAL' },
      { table: 'map_workspaces', col: 'center_lat', type: 'REAL' },
      { table: 'map_workspaces', col: 'zoom', type: 'REAL' },
      { table: 'map_workspaces', col: 'basemap_id', type: 'TEXT' },
      { table: 'map_workspaces', col: 'layers', type: 'TEXT' },
      { table: 'map_workspaces', col: 'created_by', type: 'TEXT' },
      { table: 'map_workspaces', col: 'geoserver_url', type: "TEXT DEFAULT ''" },
      { table: 'map_workspaces', col: 'created_at', type: 'TEXT' },
      { table: 'map_workspaces', col: 'updated_at', type: 'TEXT' },
      { table: 'dashboards', col: 'tags', type: "TEXT DEFAULT '[]'" },
      { table: 'dashboards', col: 'version', type: 'INTEGER DEFAULT 1' },
      { table: 'dashboards', col: 'thumbnail', type: 'TEXT' },
      { table: 'dashboards', col: 'description', type: "TEXT DEFAULT ''" },
      { table: 'dashboards', col: 'is_public', type: 'INTEGER DEFAULT 0' },
      { table: 'dashboards', col: 'geoserver_url', type: "TEXT DEFAULT ''" },
      { table: 'dashboard_charts', col: 'geoserver_url', type: "TEXT DEFAULT ''" },
      { table: 'user_profiles', col: 'geoserver_url', type: "TEXT DEFAULT ''" },
      { table: 'goto_xy_points', col: 'map_id', type: 'TEXT' },
      { table: 'goto_xy_points', col: 'zoom', type: 'REAL' },
    ];

    for (const m of migrations) {
      try {
        const info = await client.execute(`PRAGMA table_info(${m.table})`);
        const existing = new Set((info.rows || []).map((r: any) => String(r.name)));
        if (!existing.has(m.col)) {
          await client.execute(`ALTER TABLE ${m.table} ADD COLUMN ${m.col} ${m.type}`);
        }
      } catch {
        // Safe to ignore if column already exists
      }
    }

    // ------------------------------------------------------------------------
    // STEP 2: UUID Primary Key Migrations (dashboards & dashboard_charts)
    // ------------------------------------------------------------------------
    // Legacy schemas used AUTOINCREMENT INT ids; current architecture uses string UUIDs.
    // Recreates table with string primary key and migrates existing records smoothly.
    try {
      const dashInfo = await client.execute("PRAGMA table_info(dashboards)");
      const idCol = (dashInfo.rows || []).find((r: any) => String(r.name) === 'id');
      if (idCol && String(idCol.type).toUpperCase().includes('INT')) {
        console.log('[db.ts] Migrating dashboards table id to TEXT PRIMARY KEY (UUID)...');
        await client.batch([
          `CREATE TABLE IF NOT EXISTS dashboards_v2 (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            is_public INTEGER DEFAULT 0,
            content TEXT DEFAULT '{"widgets":[]}',
            tags TEXT DEFAULT '[]',
            version INTEGER DEFAULT 1,
            thumbnail TEXT,
            created_by TEXT,
            geoserver_url TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`,
          `INSERT OR IGNORE INTO dashboards_v2 (id, name, description, is_public, content, tags, version, thumbnail, created_by, geoserver_url, created_at, updated_at)
           SELECT CAST(id AS TEXT), name, description, is_public, content, tags, version, thumbnail, created_by, geoserver_url, created_at, updated_at FROM dashboards`,
          `DROP TABLE dashboards`,
          `ALTER TABLE dashboards_v2 RENAME TO dashboards`
        ], 'write');
        console.log('[db.ts] Migrated dashboards table successfully.');
      }
    } catch (migErr) {
      console.error('[db.ts] Error migrating dashboards table to UUID:', migErr);
    }

    try {
      const chartInfo = await client.execute("PRAGMA table_info(dashboard_charts)");
      const idCol = (chartInfo.rows || []).find((r: any) => String(r.name) === 'id');
      if (idCol && String(idCol.type).toUpperCase().includes('INT')) {
        console.log('[db.ts] Migrating dashboard_charts table id to TEXT PRIMARY KEY (UUID)...');
        await client.batch([
          `CREATE TABLE IF NOT EXISTS dashboard_charts_v2 (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            chart_type TEXT NOT NULL,
            config TEXT NOT NULL DEFAULT '{}',
            created_by TEXT,
            geoserver_url TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`,
          `INSERT OR IGNORE INTO dashboard_charts_v2 (id, title, chart_type, config, created_by, geoserver_url, created_at)
           SELECT CAST(id AS TEXT), title, chart_type, config, created_by, geoserver_url, created_at FROM dashboard_charts`,
          `DROP TABLE dashboard_charts`,
          `ALTER TABLE dashboard_charts_v2 RENAME TO dashboard_charts`
        ], 'write');
        console.log('[db.ts] Migrated dashboard_charts table successfully.');
      }
    } catch (migErr) {
      console.error('[db.ts] Error migrating dashboard_charts table to UUID:', migErr);
    }

    // ------------------------------------------------------------------------
    // STEP 3: Seed default system settings into SQLite if not present
    // ------------------------------------------------------------------------
    // Automatically persists:
    // 1. `jwt_secret`: 64-byte cryptographic random secret for signing session tokens.
    // 2. `geoserver_url`: Default GeoServer gateway endpoint.
    // 3. `tileserv_url`: Default pg_tileserv / vector tile server endpoint.
    try {
      const jwtRes = await client.execute("SELECT value FROM app_settings WHERE key = 'jwt_secret'");
      let jwtSecret = jwtRes.rows.length > 0 ? String(jwtRes.rows[0].value) : '';
      if (!jwtSecret) {
        jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(64).toString('base64');
        await client.execute({
          sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('jwt_secret', ?, CURRENT_TIMESTAMP)",
          args: [jwtSecret]
        });
        console.log('[db.ts] Auto-generated and persisted JWT_SECRET into app_settings.');
      }
      setCachedJwtSecret(jwtSecret);

      const geoRes = await client.execute("SELECT value FROM app_settings WHERE key = 'geoserver_url'");
      if (!geoRes.rows.length) {
        const defaultGeoUrl = process.env.GEOSERVER_URL || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver';
        await client.execute({
          sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('geoserver_url', ?, CURRENT_TIMESTAMP)",
          args: [defaultGeoUrl]
        });
        console.log(`[db.ts] Seeded default geoserver_url ('${defaultGeoUrl}') into app_settings.`);
      }

      const tileRes = await client.execute("SELECT value FROM app_settings WHERE key = 'tileserv_url'");
      if (!tileRes.rows.length) {
        const defaultTileUrl = process.env.NEXT_PUBLIC_TILESERV_URL || 'http://localhost:7800';
        await client.execute({
          sql: "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('tileserv_url', ?, CURRENT_TIMESTAMP)",
          args: [defaultTileUrl]
        });
        console.log(`[db.ts] Seeded default tileserv_url ('${defaultTileUrl}') into app_settings.`);
      }
    } catch (seedErr) {
      console.error('[db.ts] Error seeding app_settings:', seedErr);
    }

    dbInitialized = true;
  } catch (err) {
    console.error('[db.ts] Failed to initialize SQLite database:', err);
  }
}
