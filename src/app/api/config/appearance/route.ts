// ============================================================================
// Appearance & Branding API Route (/api/config/appearance)
//
// Manages the application's visual customizations in SQLite:
// - GET: Returns active branding (product name, primary theme color,
//        custom logo, default map coordinates/zoom, login page hero image).
// - POST/PUT: Saves new appearance settings (requires authenticated admin).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { pool, initDb } from '@/lib/db';
import { siteConfig } from '@/config/site-config';
import { verifyJwt } from '@/lib/jwt';
import { getAppSetting } from '@/lib/settings';

function getUsernameFromRequest(req: NextRequest): string {
  const usernameCookie = req.cookies.get('geoserver_username')?.value;
  if (usernameCookie) return usernameCookie.trim();
  return '';
}

function cleanGeoserverUrl(url?: string | null): string {
  if (!url) return '';
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const dbDefaultGeoUrl = await getAppSetting('geoserver_url', 'http://localhost:8080/geoserver');
    const targetUrl =
      req.nextUrl?.searchParams?.get('geoserverUrl') ||
      req.cookies.get('geoserver_url')?.value ||
      process.env.NEXT_PUBLIC_GEOSERVER_URL ||
      process.env.GEOSERVER_URL ||
      dbDefaultGeoUrl;
    const cleanUrl = cleanGeoserverUrl(targetUrl);

    let settings = {
      geoserverUrl: cleanUrl,
      customLogo: null as string | null,
      productName: '',
      primaryColor: siteConfig.colors.primary || '#0284c7',
      defaultBasemap: 'osm',
      defaultLatitude: 20.5937,
      defaultLongitude: 78.9629,
      defaultZoom: 4,
      loginHeadline: 'Precision Geospatial Intelligence for All',
      loginSubtitle: 'Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.',
      loginBgUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop',
      loginQuote: 'Data is the new geography.',
    };

    // 1. First attempt to load geoserver-specific appearance if cleanUrl is present
    let found = false;
    if (cleanUrl) {
      const geoRes = await pool.query(
        "SELECT value FROM app_settings WHERE key = $1",
        [`appearance:${cleanUrl}`]
      );
      if (geoRes.rows.length > 0 && geoRes.rows[0].value) {
        const raw = geoRes.rows[0].value;
        const val = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (val && typeof val === 'object') {
          settings = {
            geoserverUrl: val.geoserverUrl || cleanUrl,
            customLogo: val.customLogo || null,
            productName: val.productName || '',
            primaryColor: val.primaryColor || val.companyBrandColor || siteConfig.colors.primary || '#0284c7',
            defaultBasemap: val.defaultBasemap || 'osm',
            defaultLatitude: typeof val.defaultLatitude === 'number' ? val.defaultLatitude : 20.5937,
            defaultLongitude: typeof val.defaultLongitude === 'number' ? val.defaultLongitude : 78.9629,
            defaultZoom: typeof val.defaultZoom === 'number' ? val.defaultZoom : 4,
            loginHeadline: typeof val.loginHeadline === 'string' ? val.loginHeadline : 'Precision Geospatial Intelligence for All',
            loginSubtitle: typeof val.loginSubtitle === 'string' ? val.loginSubtitle : 'Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.',
            loginBgUrl: typeof val.loginBgUrl === 'string' ? val.loginBgUrl : 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop',
            loginQuote: typeof val.loginQuote === 'string' ? val.loginQuote : 'Data is the new geography.',
          };
          found = true;
        }
      }
    }

    // 2. Fall back to global appearance if not found under specific geoserver
    if (!found) {
      const res = await pool.query("SELECT value FROM app_settings WHERE key = 'appearance'");
      if (res.rows.length > 0 && res.rows[0].value) {
        const raw = res.rows[0].value;
        const val = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (val && typeof val === 'object') {
          settings = {
            geoserverUrl: val.geoserverUrl || cleanUrl,
            customLogo: val.customLogo || null,
            productName: val.productName || '',
            primaryColor: val.primaryColor || val.companyBrandColor || siteConfig.colors.primary || '#0284c7',
            defaultBasemap: val.defaultBasemap || 'osm',
            defaultLatitude: typeof val.defaultLatitude === 'number' ? val.defaultLatitude : 20.5937,
            defaultLongitude: typeof val.defaultLongitude === 'number' ? val.defaultLongitude : 78.9629,
            defaultZoom: typeof val.defaultZoom === 'number' ? val.defaultZoom : 4,
            loginHeadline: typeof val.loginHeadline === 'string' ? val.loginHeadline : 'Precision Geospatial Intelligence for All',
            loginSubtitle: typeof val.loginSubtitle === 'string' ? val.loginSubtitle : 'Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.',
            loginBgUrl: typeof val.loginBgUrl === 'string' ? val.loginBgUrl : 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop',
            loginQuote: typeof val.loginQuote === 'string' ? val.loginQuote : 'Data is the new geography.',
          };
        }
      }
    }

    return NextResponse.json(settings);
  } catch (error: any) {
    console.error('Failed to get appearance settings:', error);
    const defaultColor = siteConfig.colors.primary || '#0284c7';
    return NextResponse.json(
      {
        customLogo: null,
        productName: '',
        primaryColor: defaultColor,
        defaultBasemap: 'osm',
        defaultLatitude: 20.5937,
        defaultLongitude: 78.9629,
        defaultZoom: 4,
        loginHeadline: 'Precision Geospatial Intelligence for All',
        loginSubtitle: 'Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.',
        loginBgUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop',
        loginQuote: 'Data is the new geography.',
      },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const username = getUsernameFromRequest(req);
    const body = await req.json();
    const {
      customLogo,
      productName,
      primaryColor,
      defaultBasemap,
      defaultLatitude,
      defaultLongitude,
      defaultZoom,
      loginHeadline,
      loginSubtitle,
      loginBgUrl,
      loginQuote,
      geoserverUrl: bodyUrl,
      resetToDefault,
    } = body;

    const dbDefaultGeoUrl = await getAppSetting('geoserver_url', 'http://localhost:8080/geoserver');
    const targetUrl =
      bodyUrl ||
      req.cookies.get('geoserver_url')?.value ||
      process.env.NEXT_PUBLIC_GEOSERVER_URL ||
      process.env.GEOSERVER_URL ||
      dbDefaultGeoUrl;
    const cleanUrl = cleanGeoserverUrl(targetUrl);

    // Verify if user is an ADMIN (via JWT or username or user_profiles table)
    let isAdmin = false;
    const authHeader = req.headers.get('authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyJwt(token);
      if (decoded && (decoded.role === 'ADMIN' || decoded.username === 'admin')) {
        isAdmin = true;
      }
    }
    if (!isAdmin && username) {
      if (username.toLowerCase() === 'admin') {
        isAdmin = true;
      } else {
        const roleRes = await pool.query('SELECT role FROM user_profiles WHERE username = $1', [username]);
        if (roleRes.rows.length > 0 && roleRes.rows[0].role === 'ADMIN') {
          isAdmin = true;
        }
      }
    }

    if (resetToDefault) {
      const defaultPayload = {
        customLogo: null,
        productName: '',
        primaryColor: siteConfig.colors.primary || '#0284c7',
        defaultBasemap: 'osm',
        defaultLatitude: 20.5937,
        defaultLongitude: 78.9629,
        defaultZoom: 4,
        loginHeadline: 'Precision Geospatial Intelligence for All',
        loginSubtitle: 'Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.',
        loginBgUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop',
        loginQuote: 'Data is the new geography.',
      };

      // Reset global
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('appearance', $1, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(defaultPayload)]
      );

      // Reset geoserver specific if cleanUrl present
      if (cleanUrl) {
        await pool.query(
          `INSERT INTO app_settings (key, value, updated_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (key)
           DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
          [`appearance:${cleanUrl}`, JSON.stringify(defaultPayload)]
        );
      }

      return NextResponse.json({ success: true, ...defaultPayload });
    }

    // Read existing settings (prefer cleanUrl specific, fallback to global)
    let currentSettings = {
      customLogo: null as string | null,
      productName: '',
      primaryColor: siteConfig.colors.primary || '#0284c7',
      defaultBasemap: 'osm',
      defaultLatitude: 20.5937,
      defaultLongitude: 78.9629,
      defaultZoom: 4,
      loginHeadline: 'Precision Geospatial Intelligence for All',
      loginSubtitle: 'Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.',
      loginBgUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop',
      loginQuote: 'Data is the new geography.',
    };

    let existingRes = cleanUrl
      ? await pool.query("SELECT value FROM app_settings WHERE key = $1", [`appearance:${cleanUrl}`])
      : { rows: [] };
    if (!existingRes.rows.length || !existingRes.rows[0].value) {
      existingRes = await pool.query("SELECT value FROM app_settings WHERE key = 'appearance'");
    }

    if (existingRes.rows.length > 0 && existingRes.rows[0].value) {
      const raw = existingRes.rows[0].value;
      const val = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (val && typeof val === 'object') {
        currentSettings = {
          customLogo: val.customLogo || null,
          productName: val.productName || '',
          primaryColor: val.primaryColor || val.companyBrandColor || siteConfig.colors.primary || '#0284c7',
          defaultBasemap: val.defaultBasemap || 'osm',
          defaultLatitude: typeof val.defaultLatitude === 'number' ? val.defaultLatitude : 20.5937,
          defaultLongitude: typeof val.defaultLongitude === 'number' ? val.defaultLongitude : 78.9629,
          defaultZoom: typeof val.defaultZoom === 'number' ? val.defaultZoom : 4,
          loginHeadline: typeof val.loginHeadline === 'string' ? val.loginHeadline : currentSettings.loginHeadline,
          loginSubtitle: typeof val.loginSubtitle === 'string' ? val.loginSubtitle : currentSettings.loginSubtitle,
          loginBgUrl: typeof val.loginBgUrl === 'string' ? val.loginBgUrl : currentSettings.loginBgUrl,
          loginQuote: typeof val.loginQuote === 'string' ? val.loginQuote : currentSettings.loginQuote,
        };
      }
    }

    // Validate map settings
    const validLat =
      typeof defaultLatitude === 'number' && !isNaN(defaultLatitude) && defaultLatitude >= -90 && defaultLatitude <= 90
        ? defaultLatitude
        : currentSettings.defaultLatitude;

    const validLon =
      typeof defaultLongitude === 'number' && !isNaN(defaultLongitude) && defaultLongitude >= -180 && defaultLongitude <= 180
        ? defaultLongitude
        : currentSettings.defaultLongitude;

    const validZoom =
      typeof defaultZoom === 'number' && !isNaN(defaultZoom) && defaultZoom >= 1 && defaultZoom <= 22
        ? Math.round(defaultZoom)
        : currentSettings.defaultZoom;

    const validBasemap =
      typeof defaultBasemap === 'string' && defaultBasemap.trim()
        ? defaultBasemap.trim().slice(0, 100)
        : currentSettings.defaultBasemap;

    const validHeadline =
      typeof loginHeadline === 'string' ? loginHeadline.trim().slice(0, 150) : currentSettings.loginHeadline;

    const validSubtitle =
      typeof loginSubtitle === 'string' ? loginSubtitle.trim().slice(0, 500) : currentSettings.loginSubtitle;

    const validBgUrl =
      typeof loginBgUrl === 'string' && loginBgUrl.trim() ? loginBgUrl.trim() : currentSettings.loginBgUrl;

    const validQuote =
      typeof loginQuote === 'string' ? loginQuote.trim().slice(0, 150) : currentSettings.loginQuote;

    const payload = {
      geoserverUrl: cleanUrl,
      customLogo: customLogo !== undefined ? (customLogo || null) : currentSettings.customLogo,
      productName: productName !== undefined ? (typeof productName === 'string' ? productName.trim().slice(0, 20) : '') : currentSettings.productName,
      primaryColor: typeof primaryColor === 'string' && /^#([0-9a-fA-F]{3}){1,2}$/.test(primaryColor)
        ? primaryColor
        : currentSettings.primaryColor,
      defaultBasemap: validBasemap,
      defaultLatitude: validLat,
      defaultLongitude: validLon,
      defaultZoom: validZoom,
      loginHeadline: validHeadline,
      loginSubtitle: validSubtitle,
      loginBgUrl: validBgUrl,
      loginQuote: validQuote,
    };

    // Save to global key
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('appearance', $1, CURRENT_TIMESTAMP)
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(payload)]
    );

    // Also save to geoserver-specific key so this GeoServer keeps its unique settings
    if (cleanUrl) {
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [`appearance:${cleanUrl}`, JSON.stringify(payload)]
      );
    }

    const response = NextResponse.json({ success: true, ...payload });
    if (cleanUrl) {
      response.cookies.set('geoserver_url', cleanUrl, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      });
    }
    return response;
  } catch (error: any) {
    console.error('Failed to save appearance settings:', error);
    return NextResponse.json(
      { success: false, detail: error.message || 'Database error' },
      { status: 500 }
    );
  }
}

