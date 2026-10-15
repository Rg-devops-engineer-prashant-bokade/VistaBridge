// ============================================================================
// API Gateway & GeoServer Client
//
// This file handles all network requests in the frontend:
// 1. Sends authenticated requests to Next.js API routes (/api/*) with JWT tokens.
// 2. Intercepts /datasets/* calls to talk directly to GeoServer (WMS/WFS/WPS).
// 3. Handles spatial queries (intersections) with GeoServer or in-memory Turf.js.
// ============================================================================


/* eslint-disable @typescript-eslint/no-explicit-any */
import { useAuthStore } from '@/store/useAuthStore';
import { siteConfig } from '@/config/site-config';
import { booleanIntersects } from '@turf/boolean-intersects';

interface RequestOptions extends RequestInit {
  /** Set to false to skip Authorization header. Defaults to true. */
  auth?: boolean;
}

// ---------------------------------------------------------------------------
// WKT & GML SPATIAL CONVERSION HELPERS
// ---------------------------------------------------------------------------
// Used server-side and client-side to convert GeoJSON features into GEOMETRYCOLLECTION
// WKT and GML 3.2 fragments for GeoServer CQL and OGC Filter XML requests.
// ---------------------------------------------------------------------------


/** Convert a single GeoJSON geometry object to its WKT representation.
 * Coordinates are emitted as "lon lat" (X Y / c[0] c[1]) for SRID=4326 WKT.
 */
function geomToWkt(geom: any): string | null {
  if (!geom || !geom.type || !geom.coordinates) return null;
  const pt = (c: number[]) => `${c[0]} ${c[1]}`;
  const ring2d = (ring: number[][]) => ring.map(pt).join(',');
  try {
    switch (geom.type) {
      case 'Point':
        return `POINT(${pt(geom.coordinates)})`;
      case 'MultiPoint':
        return `MULTIPOINT(${geom.coordinates.map((c: number[]) => `(${pt(c)})`).join(',')})`;
      case 'LineString':
        return `LINESTRING(${ring2d(geom.coordinates)})`;
      case 'MultiLineString':
        return `MULTILINESTRING(${geom.coordinates.map((l: number[][]) => `(${ring2d(l)})`).join(',')})`;
      case 'Polygon':
        return `POLYGON(${geom.coordinates.map((r: number[][]) => `(${ring2d(r)})`).join(',')})`;
      case 'MultiPolygon':
        return `MULTIPOLYGON(${geom.coordinates.map((p: number[][][]) => `(${p.map((r: number[][]) => `(${ring2d(r)})`).join(',')})`).join(',')})`;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Robust in-memory spatial intersection evaluator using Turf.js.
 */
function checkSpatialIntersection(f1: any, f2: any): boolean {
  try {
    const geom1 = f1?.type === 'Feature' ? f1.geometry : f1;
    const geom2 = f2?.type === 'Feature' ? f2.geometry : f2;
    if (!geom1 || !geom2 || !geom1.coordinates || !geom2.coordinates) return false;
    return booleanIntersects(f1, f2);
  } catch {
    return false;
  }
}

/**
 * Parses WKT string to GeoJSON geometry object.
 */
function _wktToGeoJson(wkt: string): any | null {
  if (!wkt) return null;
  const clean = wkt.replace(/^SRID=\d+;/i, '').trim();
  const typeMatch = clean.match(/^([A-Z]+)\s*\(([\s\S]+)\)$/i);
  if (!typeMatch) return null;
  const type = typeMatch[1].toUpperCase();
  const body = typeMatch[2].trim();

  try {
    if (type === 'POINT') {
      const coords = body.replace(/[()]/g, '').trim().split(/\s+/).map(Number);
      return { type: 'Point', coordinates: coords };
    }
    if (type === 'LINESTRING') {
      const pts = body.split(',').map(p => p.trim().split(/\s+/).map(Number));
      return { type: 'LineString', coordinates: pts };
    }
    if (type === 'POLYGON') {
      const ringMatches = body.match(/\(([^()]+)\)/g);
      if (!ringMatches) return null;
      const rings = ringMatches.map(r =>
        r.replace(/[()]/g, '').trim().split(',').map(p => p.trim().split(/\s+/).map(Number))
      );
      return { type: 'Polygon', coordinates: rings };
    }
    if (type === 'MULTIPOLYGON') {
      const polyMatches = body.match(/\(\(([\s\S]+?)\)\)/g);
      if (!polyMatches) return null;
      const polys = polyMatches.map(p => {
        const ringMatches = p.match(/\(([^()]+)\)/g) || [];
        return ringMatches.map(r =>
          r.replace(/[()]/g, '').trim().split(',').map(pt => pt.trim().split(/\s+/).map(Number))
        );
      });
      return { type: 'MultiPolygon', coordinates: polys };
    }
  } catch (e) {
    console.warn('Failed to parse WKT to GeoJSON:', e);
  }
  return null;
}

/**
 * Converts a GeoJSON geometry object into standard GML 3.2 elements.
 * Emits coordinates in "lat lon" (Y X) order for compatibility with EPSG:4326 in WFS 2.0.0.
 * Multi-geometries are unpacked to list of individual GML geometries to be combined
 * under a fes:Or filter, ensuring maximum compatibility across GeoServer versions.
 */
function geojsonToGml32(geom: any, index: string): string[] {
  if (!geom || !geom.type || !geom.coordinates) return [];
  const pt = (c: number[]) => `${c[1]} ${c[0]}`; // Y X order for EPSG:4326
  try {
    switch (geom.type) {
      case 'Point':
        return [`<gml:Point gml:id="p_${index}" srsName="urn:ogc:def:crs:EPSG::4326"><gml:pos>${pt(geom.coordinates)}</gml:pos></gml:Point>`];
      case 'MultiPoint':
        return geom.coordinates.map((c: number[], cIdx: number) => {
          return `<gml:Point gml:id="mp_${index}_${cIdx}" srsName="urn:ogc:def:crs:EPSG::4326"><gml:pos>${pt(c)}</gml:pos></gml:Point>`;
        });
      case 'LineString':
        return [`<gml:LineString gml:id="l_${index}" srsName="urn:ogc:def:crs:EPSG::4326"><gml:posList>${geom.coordinates.map(pt).join(' ')}</gml:posList></gml:LineString>`];
      case 'MultiLineString':
        return geom.coordinates.map((l: number[][], lIdx: number) => {
          return `<gml:LineString gml:id="mc_${index}_${lIdx}" srsName="urn:ogc:def:crs:EPSG::4326"><gml:posList>${l.map(pt).join(' ')}</gml:posList></gml:LineString>`;
        });
      case 'Polygon': {
        const ext = geom.coordinates[0].map(pt).join(' ');
        const ints = geom.coordinates.slice(1).map((ring: number[][], _rIdx: number) => {
          return `<gml:interior><gml:LinearRing><gml:posList>${ring.map(pt).join(' ')}</gml:posList></gml:LinearRing></gml:interior>`;
        }).join('');
        return [`<gml:Polygon gml:id="poly_${index}" srsName="urn:ogc:def:crs:EPSG::4326"><gml:exterior><gml:LinearRing><gml:posList>${ext}</gml:posList></gml:LinearRing></gml:exterior>${ints}</gml:Polygon>`];
      }
      case 'MultiPolygon': {
        const polys: string[] = [];
        geom.coordinates.forEach((poly: number[][][], pIdx: number) => {
          const ext = poly[0].map(pt).join(' ');
          const ints = poly.slice(1).map((ring: number[][], _rIdx: number) => {
            return `<gml:interior><gml:LinearRing><gml:posList>${ring.map(pt).join(' ')}</gml:posList></gml:LinearRing></gml:interior>`;
          }).join('');
          polys.push(`<gml:Polygon gml:id="mpoly_${index}_${pIdx}" srsName="urn:ogc:def:crs:EPSG::4326"><gml:exterior><gml:LinearRing><gml:posList>${ext}</gml:posList></gml:LinearRing></gml:exterior>${ints}</gml:Polygon>`);
        });
        return polys;
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/**
 * Builds the spatial XML Filter segment by combining geometries from reference features
 * inside an OGC <fes:Or> logical operator wrapping individual spatial predicates.
 * This guarantees exact spatial results for non-trivial geometries like complex polygons.
 */
function buildSpatialXmlFilter(
  targetGeomField: string,
  refFeatures: any[],
  operation: string
): string | null {
  const opTag = operation.charAt(0) + operation.slice(1).toLowerCase(); // "Intersects", "Within", etc.
  const xmlFilters: string[] = [];

  refFeatures.forEach((f, idx) => {
    const gmlList = geojsonToGml32(f.geometry, String(idx));
    gmlList.forEach((gml) => {
      xmlFilters.push(`
        <fes:${opTag}>
          <fes:ValueReference>${targetGeomField}</fes:ValueReference>
          ${gml}
        </fes:${opTag}>
      `.trim());
    });
  });

  if (xmlFilters.length === 0) return null;
  if (xmlFilters.length === 1) return xmlFilters[0];
  return `<fes:Or>${xmlFilters.join('')}</fes:Or>`;
}

/**
 * Count coordinates in a GeoJSON geometry object to determine complexity.
 */
function getCoordinateCount(geom: any): number {
  if (!geom || !geom.coordinates) return 0;
  if (geom.type === 'Point') return 1;
  if (geom.type === 'LineString' || geom.type === 'MultiPoint') return geom.coordinates.length;
  if (geom.type === 'Polygon' || geom.type === 'MultiLineString') {
    return geom.coordinates.reduce((acc: number, ring: any[]) => acc + ring.length, 0);
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.reduce((acc: number, poly: any[][]) => {
      return acc + poly.reduce((acc2: number, ring: any[]) => acc2 + ring.length, 0);
    }, 0);
  }
  return 0;
}

/**
 * Return the bounding box envelope of a geometry in WKT Polygon format.
 * Emits "lat lon" (Y X) coordinate order for EPSG:4326.
 */
function getGeometryEnvelopeWkt(geom: any): string | null {
  if (!geom || !geom.coordinates) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const processCoord = (c: number[]) => {
    if (c[0] < minX) minX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] > maxY) maxY = c[1];
  };

  const processArray = (arr: any) => {
    if (Array.isArray(arr[0])) {
      arr.forEach(processArray);
    } else if (typeof arr[0] === 'number') {
      processCoord(arr);
    }
  };

  processArray(geom.coordinates);

  if (minX === Infinity || minY === Infinity) return null;
  return `POLYGON((${minX} ${minY}, ${minX} ${maxY}, ${maxX} ${maxY}, ${maxX} ${minY}, ${minX} ${minY}))`;
}

/**
 * Collect all feature geometries from a WFS GeoJSON response into a single
 * GEOMETRYCOLLECTION WKT string suitable for use in a GeoServer CQL filter.
 * 
 * To avoid 400 "Unable to parse form content" and 500 Server Errors in GeoServer,
 * we check the total coordinate complexity of the layer. If the total number
 * of coordinates exceeds 1000, we simplify complex geometries to their bounding
 * box envelopes. This reduces the size of the POST body from hundreds of kilobytes
 * down to just a few kilobytes, ensuring fast, successful execution.
 */
function _buildGeomCollectionWkt(features: any[]): string | null {
  let totalCoords = 0;
  for (const f of features) {
    totalCoords += getCoordinateCount(f.geometry);
  }

  // If reference layer is complex (> 1000 vertices), approximate using envelopes
  const useEnvelope = totalCoords > 1000;
  const parts: string[] = [];

  for (const f of features) {
    const wkt = useEnvelope ? getGeometryEnvelopeWkt(f.geometry) : geomToWkt(f.geometry);
    if (wkt) parts.push(wkt);
  }

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]; // Single geom — no collection wrapper needed
  return `GEOMETRYCOLLECTION(${parts.join(',')})`;
}

/**
 * Server-side geometry field discovery via WFS DescribeFeatureType.
 * Tries JSON output format first (regex-friendly), then plain XML with regex.
 * Returns 'geom' as a safe default if discovery fails.
 * Runs entirely inside the Next.js API route — no browser CORS restrictions.
 */
async function serverDescribeGeomField(
  layerId: string,
  geoserverUrl: string,
  headers: Record<string, string>,
): Promise<string> {
  if (layerId.startsWith('wps_result_') || layerId.startsWith('raster_res_')) {
    return 'geometry';
  }

  try {
    const workspace = layerId.includes(':') ? layerId.split(':')[0] : null;
    const localName = layerId.includes(':') ? layerId.split(':')[1] : layerId;

    const xmlUrls = [
      workspace
        ? `${geoserverUrl}/${workspace}/wfs?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=${encodeURIComponent(localName)}`
        : null,
      `${geoserverUrl}/ows?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=${encodeURIComponent(layerId)}`,
      workspace
        ? `${geoserverUrl}/${workspace}/wfs?service=WFS&version=1.1.0&request=DescribeFeatureType&typeName=${encodeURIComponent(localName)}`
        : null,
      `${geoserverUrl}/ows?service=WFS&version=1.1.0&request=DescribeFeatureType&typeName=${encodeURIComponent(layerId)}`,
    ].filter(Boolean) as string[];

    for (const xmlUrl of xmlUrls) {
      const res = await fetch(xmlUrl, { headers });
      if (res.ok) {
        const xml = await res.text();
        const match =
          xml.match(/name="([^"]+)"[^>]*type="(?:[^"]*:)?(?:[A-Za-z]*[Gg]eom[A-Za-z]*|[A-Za-z]*[Ss]urface[A-Za-z]*|[A-Za-z]*[Pp]oint[A-Za-z]*|[A-Za-z]*[Ll]ine[A-Za-z]*)PropertyType"/) ||
          xml.match(/name="([^"]+)"[^>]*type="[^"]*gml:[^"]*"/);
        if (match) return match[1];
      }
    }
  } catch { /* ignore */ }

  return 'geom'; // Safe default
}

function parseXmlSchema(xmlText: string): Record<string, string> {
  const schema: Record<string, string> = {};
  if (typeof window === 'undefined') return schema;

  // Common geometry field names to always skip
  const GEOM_FIELD_NAMES = new Set([
    'the_geom', 'geom', 'geometry', 'wkb_geometry', 'wkt_geometry', 'shape',
    'msgeometry', 'geometria', 'geom_poly', 'geom_point', 'geom_line',
  ]);

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const elements = Array.from(doc.getElementsByTagName('*'));
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const localName = el.localName || el.tagName.split(':').pop() || '';
      if (localName === 'element') {
        const name = el.getAttribute('name');
        const type = el.getAttribute('type') || '';
        const _maxOccurs = el.getAttribute('maxOccurs');
        const substitutionGroup = el.getAttribute('substitutionGroup');
        if (!name) continue;

        // Skip root element defining the feature type itself (e.g. tiger_roads)
        if (substitutionGroup || type.endsWith('Type') || type.includes('FeatureType')) {
          continue;
        }

        // Skip nillable geometry elements (maxOccurs=1 + nillable=true with gml type)
        // Skip geometry/gml field types
        const typeLower = type.toLowerCase();
        if (
          typeLower.includes('gml:') ||
          typeLower.includes('geometrypropertytype') ||
          typeLower.includes('multilinestring') ||
          typeLower.includes('multipolygon') ||
          typeLower.includes('multipoint') ||
          typeLower.includes('pointpropertytype') ||
          typeLower.includes('linestringstringpropertytype')
        ) {
          continue;
        }

        // Skip well-known geometry column names regardless of type
        const nameLower = name.toLowerCase();
        if (
          GEOM_FIELD_NAMES.has(nameLower) ||
          nameLower.endsWith('_geom') ||
          nameLower.endsWith('_geometry') ||
          nameLower.endsWith('_shape') ||
          // Skip if name matches the layer name itself (often geometry col in tiger layers)
          nameLower === name.toLowerCase().replace(/[^a-z0-9_]/g, '')
        ) {
          // Only skip if no type attribute or type looks like geometry
          if (!type || typeLower.includes('gml') || typeLower.includes('geom')) {
            continue;
          }
        }

        if (!type) continue;

        const localType = (type.split(':').pop() || '').toLowerCase();
        let mappedType = 'string';
        if (['int', 'integer', 'long', 'short', 'byte'].includes(localType)) {
          mappedType = 'integer';
        } else if (['float', 'double', 'decimal', 'real'].includes(localType)) {
          mappedType = 'float';
        } else if (['boolean'].includes(localType)) {
          mappedType = 'boolean';
        } else if (['datetime', 'date', 'time'].includes(localType)) {
          mappedType = 'date';
        }
        schema[name] = mappedType;
      }
    }
  } catch (err) {
    console.error('Failed to parse WFS XML DescribeFeatureType:', err);
  }
  return schema;
}

function parseXmlDistinctValues(xmlText: string, field: string): string[] {
  const values = new Set<string>();
  if (typeof window === 'undefined') return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const elements = Array.from(doc.getElementsByTagName('*'));
    elements.forEach(el => {
      const localName = el.localName || el.tagName.split(':').pop() || '';
      if (localName === field) {
        const text = el.textContent?.trim();
        if (text) {
          values.add(text);
        }
      }
    });
  } catch (err) {
    console.error(`Failed to parse XML distinct values for ${field}:`, err);
  }
  return Array.from(values).sort();
}

// Handles calls to /datasets/* directly in the browser by querying GeoServer:
// - /datasets/ -> lists all layers from WMS/WFS GetCapabilities
// - /datasets/[id]/ -> gets layer schema and attributes via WFS DescribeFeatureType
// - /datasets/[id]/spatial-query/ -> spatial filters (intersections) with GeoServer or Turf.js
// - /datasets/[id]/distincts/ -> fetches unique column values for filter dropdowns
async function handleDirectGeoServerDatasetRequest(endpoint: string, options: RequestOptions) {

  if (typeof window === 'undefined') {
    return new Response(JSON.stringify({ detail: 'Server-side direct requests not supported.' }), { status: 500 });
  }

  const store = useAuthStore.getState();
  const geoserverUrl = (store.user?.geoserverUrl || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/+$/, '');
  const geoserverAuth = store.user?.geoserverAuth;


  // JSON-accepting headers (for GetFeature/capabilities responses)
  const headers: Record<string, string> = {};
  // XML-only headers for WFS DescribeFeatureType — do NOT include Accept:json or
  // GeoServer will 400 because it only supports application/gml+xml for DescribeFeatureType
  const xmlHeaders: Record<string, string> = {};
  if (geoserverAuth) {
    headers['Authorization'] = geoserverAuth;
    xmlHeaders['Authorization'] = geoserverAuth;
  }

  // Extract path and search params
  const [pathOnly, queryString = ''] = endpoint.split('?');
  const parts = pathOnly.split('/').filter(Boolean);
  const searchParams = new URLSearchParams(queryString);

  const layerId = parts[1];

  // 0. GET /datasets/ (list all datasets)
  if (parts.length === 1 && parts[0] === 'datasets') {
    try {
      const [capRes, wfsRes] = await Promise.all([
        fetch(`${geoserverUrl}/ows?service=WMS&version=1.3.0&request=GetCapabilities`, { headers }),
        fetch(`${geoserverUrl}/ows?service=WFS&version=2.0.0&request=GetCapabilities`, { headers }).catch(() => null)
      ]);

      if (!capRes.ok) throw new Error(`GeoServer returned status: ${capRes.status}`);
      const capXml = await capRes.text();
      const parser = new DOMParser();
      const capDoc = parser.parseFromString(capXml, 'application/xml');

      // Parse WFS FeatureTypes to identify true vector layers
      const wfsFeatureTypes = new Set<string>();
      if (wfsRes && wfsRes.ok) {
        try {
          const wfsXml = await wfsRes.text();
          const wfsDoc = parser.parseFromString(wfsXml, 'application/xml');
          wfsDoc.querySelectorAll('FeatureType > Name').forEach((nameEl) => {
            const name = nameEl.textContent?.trim();
            if (name) {
              wfsFeatureTypes.add(name);
              if (name.includes(':')) {
                wfsFeatureTypes.add(name.split(':').pop()!);
              }
            }
          });
        } catch (wfsParseErr) {
          console.warn('Failed to parse WFS capabilities:', wfsParseErr);
        }
      }

      // Collect leaf layers from WMS capabilities
      const wmsLayers: Record<string, any> = {};
      capDoc.querySelectorAll('Layer > Name').forEach((nameEl) => {
        const name = nameEl.textContent?.trim() || '';
        if (!name) return;
        const layerEl = nameEl.parentElement!;
        if (layerEl === capDoc.querySelector('Capability > Layer')) return;
        const isGroup = layerEl.querySelector('Layer') !== null;
        const title = layerEl.querySelector('Title')?.textContent?.trim() || name;
        const styles: any[] = [];
        const styleEls = Array.from(layerEl.getElementsByTagNameNS('*', 'Style'));
        styleEls.forEach((styleEl: any) => {
          const sNameEl = styleEl.getElementsByTagNameNS('*', 'Name')[0];
          const sName = sNameEl?.textContent?.trim() || '';
          const sTitleEl = styleEl.getElementsByTagNameNS('*', 'Title')[0];
          const sTitle = sTitleEl?.textContent?.trim() || sName;

          const legendUrlEl = styleEl.getElementsByTagNameNS('*', 'LegendURL')[0];
          const resourceEl = legendUrlEl ? legendUrlEl.getElementsByTagNameNS('*', 'OnlineResource')[0] : null;
          const legendHref = resourceEl
            ? (resourceEl.getAttribute('xlink:href') || resourceEl.getAttribute('href') || '')
            : '';

          styles.push({ name: sName, title: sTitle, legendUrl: legendHref });
        });
        let bbox = [-180, -90, 180, 90];
        const geoBbox = layerEl.querySelector('EX_GeographicBoundingBox');
        if (geoBbox) {
          bbox = [
            parseFloat(geoBbox.querySelector('westBoundLongitude')?.textContent || '-180'),
            parseFloat(geoBbox.querySelector('southBoundLatitude')?.textContent || '-90'),
            parseFloat(geoBbox.querySelector('eastBoundLongitude')?.textContent || '180'),
            parseFloat(geoBbox.querySelector('northBoundLatitude')?.textContent || '90'),
          ];
        }
        wmsLayers[name] = { name, title, styles, bbox, isGroup };
      });

      // 2. WMS DescribeLayer — get actual layer type (WFS=VECTOR, WCS=RASTER)
      const layerNames = Object.keys(wmsLayers);
      const typeMap: Record<string, 'VECTOR' | 'RASTER'> = {};
      if (layerNames.length > 0) {
        try {
          const descUrl = `${geoserverUrl}/ows?service=WMS&version=1.1.1&request=DescribeLayer&LAYERS=${encodeURIComponent(layerNames.join(','))}`;
          const descRes = await fetch(descUrl, { headers });
          if (descRes.ok) {
            const descXml = await descRes.text();
            const descDoc = parser.parseFromString(descXml, 'application/xml');
            const allEls = Array.from(descDoc.getElementsByTagName('*'));
            allEls.forEach((el) => {
              const localName = el.localName || el.tagName?.split(':').pop() || '';
              if (localName !== 'LayerDescription') return;
              const n = el.getAttribute('name') || '';
              if (!n) return;
              const owsType = el.getAttribute('owsType') || '';
              const owsURL = el.getAttribute('owsURL') || '';
              const type = (owsType === 'WCS' || owsURL.toLowerCase().includes('wcs')) ? 'RASTER' : 'VECTOR';
              typeMap[n] = type;
              if (n.includes(':')) {
                typeMap[n.split(':').pop()!] = type;
              }
            });
          }
        } catch (e) {
          console.warn('DescribeLayer failed in dataset list API:', e);
        }
      }

      // 3. Build final layers list
      const hasDescribeResults = Object.keys(typeMap).length > 0;
      const layers = layerNames.map((name) => {
        const wl = wmsLayers[name];
        const localName = name.includes(':') ? name.split(':').pop()! : name;
        const isDescribeGroup = hasDescribeResults && !typeMap[name] && !typeMap[localName];

        const isVector = wfsFeatureTypes.has(name) || wfsFeatureTypes.has(localName) || typeMap[name] === 'VECTOR' || typeMap[localName] === 'VECTOR';

        const data_type: 'VECTOR' | 'RASTER' | 'GROUP' = (wl.isGroup || isDescribeGroup)
          ? 'GROUP'
          : (isVector ? 'VECTOR' : 'RASTER');
        return {
          id: name,
          name,
          title: wl.title,
          styles: wl.styles,
          data_type,
          status: 'READY',
          access_level: 'PUBLIC',
          metadata: { bbox: wl.bbox },
        };
      });

      return new Response(JSON.stringify(layers), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      console.error('Failed to list datasets from GeoServer capabilities:', err);
      return new Response(JSON.stringify({ detail: err.message || 'Failed to list datasets.' }), { status: 500 });
    }
  }

  if (!layerId) {
    return new Response(JSON.stringify({ detail: 'Layer ID is required.' }), { status: 400 });
  }

  // 1. GET /datasets/[id]/
  if (parts.length === 2 && parts[0] === 'datasets') {
    if (layerId.startsWith('wps_result_') || layerId.startsWith('raster_res_')) {
      return new Response(JSON.stringify({
        id: layerId,
        name: layerId,
        type: layerId.startsWith('raster_res_') ? 'RASTER' : 'VECTOR',
        schema: {},
        bbox: [-180, -90, 180, 90]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let dataType: 'VECTOR' | 'RASTER' | 'GROUP' = 'RASTER';
    let title = layerId.includes(':') ? layerId.split(':')[1] : layerId;
    let bbox = [-180, -90, 180, 90];
    const attributesSchema: Record<string, string> = {};

    try {
      const descUrl = `${geoserverUrl}/ows?service=WMS&version=1.1.1&request=DescribeLayer&LAYERS=${encodeURIComponent(layerId)}`;
      const descRes = await fetch(descUrl, { headers });
      if (descRes.ok) {
        const descXml = await descRes.text();
        const parser = new DOMParser();
        const descDoc = parser.parseFromString(descXml, 'text/xml');
        const allEls = Array.from(descDoc.getElementsByTagName('*'));
        let foundOwnDescription = false;
        allEls.forEach((el) => {
          const localName = el.localName || el.tagName?.split(':').pop() || '';
          if (localName !== 'LayerDescription') return;
          const n = el.getAttribute('name') || '';
          if (n === layerId || n.split(':').pop() === layerId.split(':').pop()) {
            foundOwnDescription = true;
            const owsType = el.getAttribute('owsType') || '';
            const owsURL = el.getAttribute('owsURL') || '';
            dataType = (owsType === 'WCS' || owsURL.toLowerCase().includes('wcs')) ? 'RASTER' : 'VECTOR';
          }
        });
        if (!foundOwnDescription && allEls.some(el => (el.localName || el.tagName?.split(':').pop() || '') === 'LayerDescription')) {
          dataType = 'GROUP';
        }
      }
    } catch (e) {
      console.warn('DescribeLayer failed in dataset API:', e);
    }

    try {
      // Build all candidate DescribeFeatureType URLs to try in order
      // GeoServer WFS 2.0.0 only supports application/gml+xml for DescribeFeatureType
      // — do NOT send outputFormat=application/json or Accept:application/json,
      //   as that causes a 400 "not supported output format" error.
      const workspace = layerId.includes(':') ? layerId.split(':')[0] : null;
      const layerLocalName = layerId.includes(':') ? layerId.split(':')[1] : layerId;

      // XML candidate endpoints (GeoServer natively supports XSD DescribeFeatureType across all versions)
      const schemaCandidates: Array<{ url: string; isJson: boolean }> = [];
      if (workspace) {
        schemaCandidates.push({
          url: `${geoserverUrl}/${workspace}/wfs?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=${encodeURIComponent(layerLocalName)}`,
          isJson: false,
        });
        schemaCandidates.push({
          url: `${geoserverUrl}/${workspace}/wfs?service=WFS&version=1.1.0&request=DescribeFeatureType&typeName=${encodeURIComponent(layerLocalName)}`,
          isJson: false,
        });
      }
      schemaCandidates.push({
        url: `${geoserverUrl}/ows?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=${encodeURIComponent(layerId)}`,
        isJson: false,
      });
      schemaCandidates.push({
        url: `${geoserverUrl}/ows?service=WFS&version=1.1.0&request=DescribeFeatureType&typeName=${encodeURIComponent(layerId)}`,
        isJson: false,
      });

      for (const candidate of schemaCandidates) {
        try {
          const reqHeaders = candidate.isJson ? headers : xmlHeaders;
          const res = await fetch(candidate.url, { headers: reqHeaders });
          if (!res.ok) continue;

          if (candidate.isJson) {
            const text = await res.text();
            try {
              const schemaJson = JSON.parse(text);
              const properties = schemaJson.complexTypes?.[0]?.properties || [];
              properties
                .filter((p: any) => !p.type?.includes('gml:'))
                .forEach((p: any) => {
                  attributesSchema[p.name] = p.localType || 'string';
                });
              if (Object.keys(attributesSchema).length > 0) {
                dataType = 'VECTOR';
                break;
              }
            } catch {
              // not JSON, continue to next candidate
            }
          } else {
            const xmlText = await res.text();
            // Check for exception in XML response
            if (xmlText.includes('ExceptionReport') || xmlText.includes('ExceptionText')) {
              continue;
            }
            const parsedSchema = parseXmlSchema(xmlText);
            Object.assign(attributesSchema, parsedSchema);
            if (Object.keys(parsedSchema).length > 0) {
              dataType = 'VECTOR';
              break;
            }
          }
        } catch {
          // try next candidate
        }
      }
    } catch (schemaErr) {
      console.warn('WFS DescribeFeatureType check failed (likely a raster/group):', schemaErr);
    }

    try {
      const capabilitiesUrl = `${geoserverUrl}/ows?service=WMS&version=1.3.0&request=GetCapabilities`;
      const capRes = await fetch(capabilitiesUrl, { headers });

      if (capRes.ok) {
        const xmlText = await capRes.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        const layers = xmlDoc.getElementsByTagName('Layer');
        for (let i = 0; i < layers.length; i++) {
          const nameEl = Array.from(layers[i].children).find(el => el.tagName === 'Name');
          if (nameEl && nameEl.textContent?.trim() === layerId) {
            const titleEl = Array.from(layers[i].children).find(el => el.tagName === 'Title');
            if (titleEl && titleEl.textContent) title = titleEl.textContent.trim();

            const isGroup = layers[i].getElementsByTagName('Layer').length > 0;
            if (isGroup) {
              dataType = 'GROUP';
            }

            const geoBboxEl = layers[i].getElementsByTagName('EX_GeographicBoundingBox')[0];
            if (geoBboxEl) {
              const west = parseFloat(geoBboxEl.getElementsByTagName('westBoundLongitude')[0]?.textContent || '-180');
              const east = parseFloat(geoBboxEl.getElementsByTagName('eastBoundLongitude')[0]?.textContent || '180');
              const south = parseFloat(geoBboxEl.getElementsByTagName('southBoundLatitude')[0]?.textContent || '-90');
              const north = parseFloat(geoBboxEl.getElementsByTagName('northBoundLatitude')[0]?.textContent || '90');
              bbox = [west, south, east, north];
            } else {
              const bboxEl = layers[i].getElementsByTagName('BoundingBox')[0];
              if (bboxEl) {
                const minx = parseFloat(bboxEl.getAttribute('minx') || '-180');
                const miny = parseFloat(bboxEl.getAttribute('miny') || '-90');
                const maxx = parseFloat(bboxEl.getAttribute('maxx') || '180');
                const maxy = parseFloat(bboxEl.getAttribute('maxy') || '90');
                bbox = [minx, miny, maxx, maxy];
              }
            }
            break;
          }
        }
      }
    } catch (capErr) {
      console.error('Failed to parse bbox from WMS GetCapabilities:', capErr);
    }

    let geomField = 'geom';
    try {
      geomField = await serverDescribeGeomField(layerId, geoserverUrl, headers);
    } catch (e) {
      console.warn(`Failed to resolve geometry field name for dataset ${layerId}:`, e);
    }

    return new Response(JSON.stringify({
      id: layerId,
      name: title,
      data_type: dataType,
      metadata: {
        bbox: bbox,
        attributes_schema: attributesSchema,
        geom_field: geomField,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // 1b. GET /datasets/[id]/spatial-query/
  //
  // Cross-layer spatial query — fully server-side to avoid browser CORS restrictions.
  //
  // Step 0 — Discover geometry field names via DescribeFeatureType (both layers in parallel)
  // Step 1 — Fetch the reference layer's geometries (WFS GetFeature GET, no CQL filter)
  // Step 2 — Build GEOMETRYCOLLECTION WKT from ref features
  // Step 3 — Query target layer via WFS GetFeature **POST** (avoids 414 URI Too Long for
  //           complex reference layers like tiger:poly_landmarks)
  //
  // Accepts params:
  //   ref_layer_id   — workspace:layerName of the reference layer
  // 1b. GET /datasets/[id]/spatial-query/
  //
  // Cross-layer spatial query — fully server-side to avoid browser CORS restrictions.
  // Supports ANY GeoServer version and datastore (PostGIS, Shapefile, GeoPackage/SQLite).
  //
  // Step 1: Fetch the reference layer's geometries (WFS GetFeature)
  // Step 2: Try fast native GeoServer spatial query
  // Step 3: If GeoServer lacks spatial extension or throws "Reader has already been closed",
  //         seamlessly fall back to high-performance in-memory Turf.js intersection.
  //
  // Accepts params:
  //   ref_layer_id   — workspace:layerName of the reference layer
  //   operation      — INTERSECTS | WITHIN | CONTAINS | TOUCHES | CROSSES | OVERLAPS
  //   count          — max features to return (default 50000, max 100000)
  //   attr_ecql      — optional attribute CQL AND-ed with the spatial predicate
  //
  // Returns: { count: N, data: ['id1', 'id2', ...] }
  if (parts.length === 3 && parts[0] === 'datasets' && parts[2] === 'spatial-query') {
    const refLayerId = searchParams.get('ref_layer_id');
    if (!refLayerId) {
      return new Response(
        JSON.stringify({ detail: 'ref_layer_id query parameter is required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const operation = (searchParams.get('operation') || 'INTERSECTS').toUpperCase();
    const count = Math.min(parseInt(searchParams.get('count') || '50000', 10), 100000);
    const attrEcql = searchParams.get('attr_ecql') || '';
    const refCqlFilter = searchParams.get('ref_cql_filter') || '';

    // -------------------------------------------------------------------
    // Step 1: Fetch reference layer features (WFS GET)
    // -------------------------------------------------------------------
    const refWfsParams110 = new URLSearchParams({
      service: 'WFS',
      version: '1.1.0',
      request: 'GetFeature',
      typeName: refLayerId,
      outputFormat: 'application/json',
      maxFeatures: '5000',
      ...(refCqlFilter ? { cql_filter: refCqlFilter } : {}),
    });

    let refRes: Response | null = null;
    try {
      refRes = await fetch(`${geoserverUrl}/ows?${refWfsParams110.toString()}`, { headers });
    } catch { /* try next */ }

    if (!refRes || !refRes.ok) {
      const refWfsParams200 = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeNames: refLayerId,
        outputFormat: 'application/json',
        count: '5000',
        ...(refCqlFilter ? { cql_filter: refCqlFilter } : {}),
      });
      try {
        refRes = await fetch(`${geoserverUrl}/ows?${refWfsParams200.toString()}`, { headers });
      } catch (fetchErr: any) {
        return new Response(
          JSON.stringify({ detail: `Cannot reach GeoServer for reference layer: ${fetchErr.message}` }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!refRes || !refRes.ok) {
      let refDetail = `Reference layer fetch failed (HTTP ${refRes?.status || 500})`;
      try {
        const t = await refRes?.text();
        if (t) {
          const m = t.match(/<(?:[a-zA-Z0-9_]+:)?ExceptionText>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?ExceptionText>/i);
          if (m) refDetail = m[1].trim();
        }
      } catch { /* ignore */ }
      return new Response(JSON.stringify({ detail: refDetail }), {
        status: refRes?.status || 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let refJson: any;
    try {
      const text = await refRes.text();
      if (text.includes('<ows:ExceptionReport') || text.includes('<ExceptionReport')) {
        const m = text.match(/<(?:[a-zA-Z0-9_]+:)?ExceptionText>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?ExceptionText>/i);
        return new Response(
          JSON.stringify({ detail: m ? m[1].trim() : 'Reference layer query failed.' }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      }
      refJson = JSON.parse(text);
    } catch {
      return new Response(
        JSON.stringify({ detail: 'Reference layer returned non-JSON response.' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const refFeatures: any[] = refJson.features || [];
    if (refFeatures.length === 0) {
      return new Response(
        JSON.stringify({ count: 0, data: [], message: 'Reference layer has no features.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Helper: Turf in-memory intersection fallback
    const runTurfIntersectionFallback = async () => {
      console.log('[spatial-query] Running high-speed in-memory Turf spatial filter...');
      // Strip spatial predicates from attrEcql when querying GeoServer so GeoPackage layers don't trigger "Reader closed"
      const nonSpatialAttrEcql = attrEcql
        ? attrEcql
          .split(/\s+AND\s+/i)
          .filter(part => !/^(INTERSECTS|DWITHIN|WITHIN|CONTAINS|TOUCHES|CROSSES|OVERLAPS|BBOX)\s*\(/i.test(part.trim().replace(/^\(|\)$/g, '')))
          .join(' AND ')
        : '';

      const targetFetchParams110 = new URLSearchParams({
        service: 'WFS',
        version: '1.1.0',
        request: 'GetFeature',
        typeName: layerId,
        outputFormat: 'application/json',
        maxFeatures: String(count),
        ...(nonSpatialAttrEcql ? { cql_filter: nonSpatialAttrEcql } : {}),
      });

      let targetDataRes: Response | null = null;
      try {
        targetDataRes = await fetch(`${geoserverUrl}/ows?${targetFetchParams110.toString()}`, { headers });
      } catch { /* try next */ }

      if (!targetDataRes || !targetDataRes.ok) {
        const targetFetchParams200 = new URLSearchParams({
          service: 'WFS',
          version: '2.0.0',
          request: 'GetFeature',
          typeNames: layerId,
          outputFormat: 'application/json',
          count: String(count),
          ...(nonSpatialAttrEcql ? { cql_filter: nonSpatialAttrEcql } : {}),
        });
        try {
          targetDataRes = await fetch(`${geoserverUrl}/ows?${targetFetchParams200.toString()}`, { headers });
        } catch { }
      }

      let targetDataJson: any = null;
      if (targetDataRes) {
        try {
          const rawText = await targetDataRes.text();
          if (
            !rawText.includes('<ows:ExceptionReport') &&
            !rawText.includes('<ExceptionReport') &&
            !rawText.includes('Reader has already been closed')
          ) {
            targetDataJson = JSON.parse(rawText);
          }
        } catch { }
      }

      // If target layer fetch failed with filters, fetch pure features without filters
      if (!targetDataJson || !targetDataJson.features) {
        try {
          const pureRes = await fetch(`${geoserverUrl}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${encodeURIComponent(layerId)}&outputFormat=application/json&maxFeatures=${count}`, { headers });
          if (pureRes.ok) {
            const pureText = await pureRes.text();
            if (!pureText.includes('<ExceptionReport') && !pureText.includes('<ows:ExceptionReport')) {
              targetDataJson = JSON.parse(pureText);
            }
          }
        } catch { }
      }

      if (!targetDataJson || !targetDataJson.features) {
        return new Response(
          JSON.stringify({ detail: 'Target layer returned non-JSON response.' }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const allTargetFeatures: any[] = targetDataJson.features || [];
      const matchedIds: string[] = [];

      for (const tf of allTargetFeatures) {
        if (!tf.geometry) continue;
        let hit = false;
        for (const rf of refFeatures) {
          if (!rf.geometry) continue;
          if (checkSpatialIntersection(tf, rf)) {
            hit = true;
            break;
          }
        }
        if (hit) {
          const id = tf.id
            ? String(tf.id)
            : tf.properties?.ogc_fid || tf.properties?.fid || tf.properties?.id
              ? String(tf.properties.ogc_fid || tf.properties.fid || tf.properties.id)
              : null;
          if (id) matchedIds.push(id);
        }
      }

      return new Response(
        JSON.stringify({ count: matchedIds.length, data: matchedIds }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    // -------------------------------------------------------------------
    // Step 2: Try Server-Side Native GeoServer Spatial Query
    // -------------------------------------------------------------------
    try {
      const [targetGeomField, _refGeomField] = await Promise.all([
        serverDescribeGeomField(layerId, geoserverUrl, headers),
        serverDescribeGeomField(refLayerId, geoserverUrl, headers),
      ]);

      const spatialFilterXml = buildSpatialXmlFilter(targetGeomField, refFeatures, operation);
      if (spatialFilterXml) {
        const wfsXmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:GetFeature 
  service="WFS" 
  version="2.0.0" 
  outputFormat="application/json" 
  count="${count}"
  xmlns:wfs="http://www.opengis.net/wfs/2.0" 
  xmlns:fes="http://www.opengis.net/fes/2.0" 
  xmlns:gml="http://www.opengis.net/gml/3.2">
  <wfs:Query typeNames="${layerId}">
    <fes:Filter>
      ${spatialFilterXml}
    </fes:Filter>
  </wfs:Query>
</wfs:GetFeature>`.trim();

        const targetUrl = attrEcql
          ? `${geoserverUrl}/ows?cql_filter=${encodeURIComponent(attrEcql)}`
          : `${geoserverUrl}/ows`;

        const serverRes = await fetch(targetUrl, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/xml' },
          body: wfsXmlPayload,
        });

        if (serverRes.ok) {
          const bodyText = await serverRes.text();
          if (
            !bodyText.includes('<ows:ExceptionReport') &&
            !bodyText.includes('<ExceptionReport') &&
            !bodyText.includes('Reader has already been closed') &&
            !bodyText.includes('IllegalStateException')
          ) {
            try {
              const targetJson = JSON.parse(bodyText);
              const targetFeatures: any[] = targetJson.features || [];
              const totalMatched: number =
                targetJson.numberMatched !== undefined
                  ? Number(targetJson.numberMatched)
                  : targetJson.totalFeatures !== undefined
                    ? Number(targetJson.totalFeatures)
                    : targetFeatures.length;

              const featureIds = targetFeatures
                .map((f: any) => (f.id ? String(f.id) : null))
                .filter(Boolean) as string[];

              return new Response(
                JSON.stringify({ count: totalMatched, data: featureIds }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            } catch { /* JSON parse error, fall through to Turf fallback */ }
          }
        }
      }
    } catch (serverQueryErr: any) {
      console.warn('[spatial-query] Server-side spatial query failed, falling back to Turf:', serverQueryErr.message);
    }

    // Fall back to in-memory spatial intersection if GeoServer query fails
    return await runTurfIntersectionFallback();
  }

  // 2. GET /datasets/[id]/features/
  if (parts.length === 3 && parts[0] === 'datasets' && parts[2] === 'features') {
    if (layerId.startsWith('wps_result_') || layerId.startsWith('raster_res_')) {
      return new Response(JSON.stringify({
        count: 0,
        results: [],
        columns: []
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('page_size') || '100', 10);
    const search = searchParams.get('search') || '';
    const sortBy = searchParams.get('sort_by');
    const sortOrder = searchParams.get('sort_order') || 'asc';
    const idsFilter = searchParams.get('ids');

    let columns: { name: string; type: string }[] = [];
    try {
      const workspace = layerId.includes(':') ? layerId.split(':')[0] : null;
      const layerLocalName = layerId.includes(':') ? layerId.split(':')[1] : layerId;

      const colCandidates: Array<{ url: string; isJson: boolean }> = [];
      if (workspace) {
        colCandidates.push({
          url: `${geoserverUrl}/${workspace}/wfs?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=${encodeURIComponent(layerLocalName)}`,
          isJson: false,
        });
        colCandidates.push({
          url: `${geoserverUrl}/${workspace}/wfs?service=WFS&version=1.1.0&request=DescribeFeatureType&typeName=${encodeURIComponent(layerLocalName)}`,
          isJson: false,
        });
      }
      colCandidates.push({
        url: `${geoserverUrl}/ows?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=${encodeURIComponent(layerId)}`,
        isJson: false,
      });
      colCandidates.push({
        url: `${geoserverUrl}/ows?service=WFS&version=1.1.0&request=DescribeFeatureType&typeName=${encodeURIComponent(layerId)}`,
        isJson: false,
      });

      for (const candidate of colCandidates) {
        try {
          const reqHeaders = candidate.isJson ? headers : xmlHeaders;
          const res = await fetch(candidate.url, { headers: reqHeaders });
          if (!res.ok) continue;
          if (candidate.isJson) {
            const text = await res.text();
            try {
              const schemaJson = JSON.parse(text);
              const properties = schemaJson.complexTypes?.[0]?.properties || [];
              const mapped = properties
                .filter((p: any) => !p.type?.includes('gml:'))
                .map((p: any) => ({ name: p.name, type: p.localType || 'string' }));
              if (mapped.length > 0) { columns = mapped; break; }
            } catch { /* not JSON, continue */ }
          } else {
            const xmlText = await res.text();
            if (xmlText.includes('ExceptionReport') || xmlText.includes('ExceptionText')) continue;
            const parsedSchema = parseXmlSchema(xmlText);
            if (Object.keys(parsedSchema).length > 0) {
              columns = Object.entries(parsedSchema).map(([name, type]) => ({ name, type }));
              break;
            }
          }
        } catch { /* try next */ }
      }
    } catch (schemaErr) {
      console.warn('Failed to fetch schema via DescribeFeatureType:', schemaErr);
    }

    // Build CQL filter parts from query parameters
    const cqlFilterParts: string[] = [];

    const isWfsFeatureId = idsFilter && idsFilter.includes('.');
    if (idsFilter && !isWfsFeatureId) {
      const ids = idsFilter.split(',').map((id: string) => {
        // Leave pure numeric IDs unquoted so integer keys (like ogc_fid) match correctly
        return /^\d+$/.test(id) ? id : `'${id.replace(/'/g, "''")}'`;
      }).join(',');
      cqlFilterParts.push(`IN (${ids})`);
    }

    if (search && columns.length > 0) {
      const rawTerms = search.split(/[,]+/).map(t => t.trim()).filter(t => t.length > 0);
      const terms = rawTerms.length > 0 ? rawTerms : [search.trim()];

      const stringCols = columns.filter(col => ['string', 'text', 'varchar', 'char'].includes(col.type.toLowerCase()));
      if (stringCols.length > 0) {
        const termCqls = terms.map(term => {
          const escaped = term.replace(/'/g, "''");
          const colMatches = stringCols.map(col => `"${col.name}" ILIKE '%${escaped}%'`);
          return `(${colMatches.join(' OR ')})`;
        });
        cqlFilterParts.push(`(${termCqls.join(' OR ')})`);
      }
    }

    searchParams.forEach((value, key) => {
      if (key.startsWith('filters[')) {
        const match = key.match(/filters\[([A-Za-z0-9_]+)__([a-z]+)\]/);
        if (match) {
          const colName = match[1];
          const operator = match[2];
          const colInfo = columns.find((c: { name: string; type: string }) => c.name === colName);
          const isNumeric = colInfo ? ['integer', 'int', 'float', 'double', 'number'].includes(colInfo.type.toLowerCase()) : false;
          if (operator === 'contains') cqlFilterParts.push(`"${colName}" ILIKE '%${value.replace(/'/g, "''")}%'`);
          else if (operator === 'startswith') cqlFilterParts.push(`"${colName}" ILIKE '${value.replace(/'/g, "''")}%'`);
          else if (operator === 'endswith') cqlFilterParts.push(`"${colName}" ILIKE '%${value.replace(/'/g, "''")}'`);
          else if (operator === 'eq') cqlFilterParts.push(isNumeric ? `"${colName}" = ${value}` : `"${colName}" = '${value}'`);
          else if (operator === 'gt') cqlFilterParts.push(`"${colName}" > ${value}`);
          else if (operator === 'gte') cqlFilterParts.push(`"${colName}" >= ${value}`);
          else if (operator === 'lt') cqlFilterParts.push(`"${colName}" < ${value}`);
          else if (operator === 'lte') cqlFilterParts.push(`"${colName}" <= ${value}`);
        }
      }
    });

    const qbFilter = searchParams.get('query_builder');
    if (qbFilter) cqlFilterParts.push(qbFilter);

    const bboxFilter = searchParams.get('bbox');
    if (bboxFilter) {
      console.log('[Server API] Received bbox parameter in WFS request:', bboxFilter);
    }

    // Build WFS request — workspace-prefixed layers must use the workspace-specific
    // OWS endpoint or GeoServer returns "Unknown namespace" errors.
    const wfsWorkspace = layerId.includes(':') ? layerId.split(':')[0] : null;
    const wfsLocalName = layerId.includes(':') ? layerId.split(':')[1] : layerId;

    // Try workspace-scoped OWS endpoint first (avoids namespace issues)
    const wfsEndpointCandidates: Array<{ baseUrl: string; typeNamesParam: string; version: string; countParam: string }> = [];
    if (wfsWorkspace) {
      wfsEndpointCandidates.push({
        baseUrl: `${geoserverUrl}/${wfsWorkspace}/ows`,
        typeNamesParam: wfsLocalName,
        version: '2.0.0',
        countParam: 'count',
      });
      wfsEndpointCandidates.push({
        baseUrl: `${geoserverUrl}/${wfsWorkspace}/ows`,
        typeNamesParam: wfsLocalName,
        version: '1.1.0',
        countParam: 'maxFeatures',
      });
    }
    // Global endpoints as fallback
    wfsEndpointCandidates.push({
      baseUrl: `${geoserverUrl}/ows`,
      typeNamesParam: layerId,
      version: '2.0.0',
      countParam: 'count',
    });
    wfsEndpointCandidates.push({
      baseUrl: `${geoserverUrl}/ows`,
      typeNamesParam: layerId,
      version: '1.1.0',
      countParam: 'maxFeatures',
    });

    let dataRes: Response | null = null;

    if (isWfsFeatureId && idsFilter) {
      // ── WFS system feature IDs: use standard XML POST GetFeature ──
      // This is highly robust: no URL length limits and no x-www-form-urlencoded parsing issues.
      const idsList = idsFilter.split(',');
      const resourceIdsXml = idsList.map(id => `<fes:ResourceId rid="${id}"/>`).join('\n');
      const wfsXmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<wfs:GetFeature 
  service="WFS" 
  version="2.0.0" 
  outputFormat="application/json" 
  count="${pageSize}"
  startIndex="${(page - 1) * pageSize}"
  xmlns:wfs="http://www.opengis.net/wfs/2.0" 
  xmlns:fes="http://www.opengis.net/fes/2.0">
  <wfs:Query typeNames="${layerId}">
    <fes:Filter>
      ${resourceIdsXml}
    </fes:Filter>
  </wfs:Query>
</wfs:GetFeature>`.trim();

      // Try workspace-specific endpoint first, fallback to global
      const wfsUrls = wfsWorkspace
        ? [`${geoserverUrl}/${wfsWorkspace}/ows`, `${geoserverUrl}/ows`]
        : [`${geoserverUrl}/ows`];

      for (const url of wfsUrls) {
        try {
          const testRes = await fetch(url, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/xml' },
            body: wfsXmlPayload,
          });
          if (testRes.ok) {
            dataRes = testRes;
            break;
          }
          const errText = await testRes.text();
          if (errText.includes('Unknown namespace') || errText.includes('404') || testRes.status === 404) {
            continue; // try next
          }
          dataRes = new Response(errText, { status: testRes.status, headers: testRes.headers });
          break;
        } catch {
          continue;
        }
      }

      if (!dataRes) {
        // Fallback to global endpoint
        dataRes = await fetch(`${geoserverUrl}/ows`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/xml' },
          body: wfsXmlPayload,
        });
      }
    } else {
      // ── Regular search/attribute filters: use standard WFS GET query ──
      let bboxCoords: [number, number, number, number] | null = null;
      if (bboxFilter) {
        const parts = bboxFilter.split(',').map(Number);
        if (parts.length === 4 && parts.every(n => !isNaN(n))) {
          let [minX, minY, maxX, maxY] = parts;
          minX = Math.max(-180, Math.min(180, minX));
          maxX = Math.max(-180, Math.min(180, maxX));
          minY = Math.max(-90, Math.min(90, minY));
          maxY = Math.max(-90, Math.min(90, maxY));
          if (minX >= maxX) { minX = -180; maxX = 180; }
          if (minY >= maxY) { minY = -90; maxY = 90; }
          if (!(minX <= -179.9 && maxX >= 179.9 && minY <= -89.9 && maxY >= 89.9)) {
            bboxCoords = [minX, minY, maxX, maxY];
          }
        }
      }

      if (bboxCoords) {
        const [minX, minY, maxX, maxY] = bboxCoords;
        console.log(`[Server API] 📡 Passing BBOX to GeoServer WFS: ${minX},${minY},${maxX},${maxY},CRS:84`);
      }

      for (const ep of wfsEndpointCandidates) {
        const epParams = new URLSearchParams({
          service: 'WFS',
          version: ep.version,
          request: 'GetFeature',
          [ep.version === '2.0.0' ? 'typeNames' : 'typeName']: ep.typeNamesParam,
          outputFormat: 'application/json',
          srsName: 'CRS:84',
          [ep.countParam]: pageSize.toString(),
          startIndex: ((page - 1) * pageSize).toString(),
        });
        if (sortBy) {
          epParams.append('sortBy', `${sortBy} ${sortOrder === 'desc' ? 'D' : 'A'}`);
        }
        if (cqlFilterParts.length > 0) {
          epParams.append('cql_filter', cqlFilterParts.join(' AND '));
        }
        if (bboxCoords) {
          const [minX, minY, maxX, maxY] = bboxCoords;
          epParams.append('bbox', `${minX},${minY},${maxX},${maxY},CRS:84`);
        }
        const queryString = epParams.toString();
        console.log('[DEBUG SERVER WFS URL]', `${ep.baseUrl}?${queryString}`);
        try {
          let testRes: Response;
          if (queryString.length > 1000) {
            testRes = await fetch(ep.baseUrl, {
              method: 'POST',
              headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: queryString,
            });
          } else {
            testRes = await fetch(`${ep.baseUrl}?${queryString}`, { headers });
          }
          if (testRes.ok) {
            dataRes = testRes;
            break;
          }
          const errText = await testRes.text();
          if (errText.includes('Unknown namespace') || errText.includes('404') || testRes.status === 404) {
            continue;
          }
          dataRes = new Response(errText, { status: testRes.status, headers: testRes.headers });
          break;
        } catch {
          continue;
        }
      }

      if (!dataRes) {
        const fallbackParams = new URLSearchParams({
          service: 'WFS',
          version: '2.0.0',
          request: 'GetFeature',
          typeNames: layerId,
          outputFormat: 'application/json',
          srsName: 'CRS:84',
          count: pageSize.toString(),
          startIndex: ((page - 1) * pageSize).toString(),
        });
        if (cqlFilterParts.length > 0) fallbackParams.append('cql_filter', cqlFilterParts.join(' AND '));
        if (bboxCoords) {
          const [minX, minY, maxX, maxY] = bboxCoords;
          fallbackParams.append('bbox', `${minX},${minY},${maxX},${maxY},CRS:84`);
        }
        const fallbackQuery = fallbackParams.toString();
        if (fallbackQuery.length > 1000) {
          dataRes = await fetch(`${geoserverUrl}/ows`, {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: fallbackQuery,
          });
        } else {
          dataRes = await fetch(`${geoserverUrl}/ows?${fallbackQuery}`, { headers });
        }
      }
    }
    const dataRes2 = dataRes;

    let wfsJson: any = null;
    let isXmlOrError = false;
    let geoServerError = `GeoServer returned status ${dataRes2.status}`;

    try {
      const errorText = await dataRes2.clone().text();
      if (
        !dataRes2.ok ||
        errorText.includes('<ows:ExceptionReport') ||
        errorText.includes('<ExceptionReport') ||
        errorText.includes('Reader has already been closed') ||
        errorText.includes('IllegalStateException') ||
        errorText.includes('NoApplicableCode')
      ) {
        isXmlOrError = true;
        console.warn('GeoServer WFS returned non-JSON / Exception:', errorText.slice(0, 300));
        const exceptionMatch = errorText.match(/<(?:[a-zA-Z0-9_]+:)?ExceptionText>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?ExceptionText>/i) ||
          errorText.match(/text="([^"]+)"/i);
        if (exceptionMatch) {
          geoServerError = exceptionMatch[1].trim();
        } else if (errorText.trim() && errorText.length < 200) {
          geoServerError = errorText.trim();
        }
      } else {
        wfsJson = JSON.parse(errorText);
      }
    } catch (e: any) {
      isXmlOrError = true;
      console.warn('Failed to parse WFS body as JSON:', e.message);
    }

    if (isXmlOrError || !wfsJson) {
      if (cqlFilterParts.length > 0) {
        return new Response(JSON.stringify({ detail: geoServerError || 'GeoServer query failed.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        columns: [
          { name: 'attribute', type: 'string' },
          { name: 'value', type: 'string' }
        ],
        data: [
          { id: '1', attribute: 'Layer Name', value: layerId },
          { id: '2', attribute: 'Service Type', value: 'WMS / Raster Grid' },
          { id: '3', attribute: 'WFS Status', value: `Unavailable (${geoServerError})` }
        ],
        pagination: {
          page: 1,
          page_size: pageSize,
          total_records: 3,
          total_pages: 1,
        },
        sorting: {
          sort_by: sortBy,
          sort_order: sortOrder,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const features = wfsJson.features || [];

    if (columns.length === 0 && features.length > 0) {
      const keySet = new Set<string>();
      features.forEach((f: any) => {
        if (f.properties) {
          Object.keys(f.properties).forEach(k => keySet.add(k));
        }
      });
      columns = Array.from(keySet).map(name => ({ name, type: 'string' }));
    }

    const dataRows = features.map((f: any, index: number) => ({
      id: f.id || `${layerId}.${index}`,
      geometry_type: f.geometry?.type || 'Unknown',
      geometry: f.geometry || null,
      ...f.properties,
    }));

    const totalRecords = wfsJson.numberMatched !== undefined
      ? wfsJson.numberMatched
      : (wfsJson.totalFeatures !== undefined ? wfsJson.totalFeatures : dataRows.length);

    const totalPages = Math.ceil(totalRecords / pageSize);

    return new Response(JSON.stringify({
      columns,
      data: dataRows,
      pagination: {
        page,
        page_size: pageSize,
        total_records: totalRecords,
        total_pages: totalPages,
      },
      sorting: {
        sort_by: sortBy,
        sort_order: sortOrder,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // 3. GET /datasets/[id]/features/bbox/
  if (parts.length === 4 && parts[0] === 'datasets' && parts[2] === 'features' && parts[3] === 'bbox') {
    const idsFilter = searchParams.get('ids');
    if (!idsFilter) {
      return new Response(JSON.stringify({ detail: 'ids query parameter is required.' }), { status: 400 });
    }

    const wfsParams = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: layerId,
      outputFormat: 'application/json',
      featureID: idsFilter,
    });

    const wfsUrl = `${geoserverUrl}/ows?${wfsParams.toString()}`;
    const response = await fetch(wfsUrl, { headers });

    if (!response.ok) {
      throw new Error(`GeoServer WFS returned status ${response.status}`);
    }

    const wfsJson = await response.json();
    const features = wfsJson.features || [];

    if (features.length === 0) {
      return new Response(JSON.stringify({ bbox: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let foundGeometry = false;

    function processCoordinates(coords: any) {
      if (Array.isArray(coords)) {
        if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
          const x = coords[0];
          const y = coords[1];
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          foundGeometry = true;
        } else {
          coords.forEach(processCoordinates);
        }
      }
    }

    features.forEach((f: any) => {
      if (f.geometry?.coordinates) {
        processCoordinates(f.geometry.coordinates);
      }
    });

    if (!foundGeometry) {
      return new Response(JSON.stringify({ bbox: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      bbox: [minX, minY, maxX, maxY],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // 4. GET /datasets/[id]/export/
  if (parts.length === 3 && parts[0] === 'datasets' && parts[2] === 'export') {
    const format = searchParams.get('format') || 'csv';
    const idsFilter = searchParams.get('ids');
    const search = searchParams.get('search') || '';
    const sortBy = searchParams.get('sort_by');
    const sortOrder = searchParams.get('sort_order') || 'asc';

    let outputFormat = 'csv';
    let contentType = 'text/csv';
    let fileExtension = 'csv';

    if (format === 'geojson') {
      outputFormat = 'application/json';
      contentType = 'application/json';
      fileExtension = 'geojson';
    } else if (format === 'kml') {
      outputFormat = 'application/vnd.google-earth.kml+xml';
      contentType = 'application/vnd.google-earth.kml+xml';
      fileExtension = 'kml';
    } else if (format === 'shapefile') {
      outputFormat = 'shape-zip';
      contentType = 'application/zip';
      fileExtension = 'zip';
    }

    // Dynamically retrieve schema to determine real layer attributes
    let columns: Array<{ name: string; type: string }> = [];
    try {
      const describeCandidates = [
        `${geoserverUrl}/ows?service=WFS&version=2.0.0&request=DescribeFeatureType&typeName=${encodeURIComponent(layerId)}`,
        `${geoserverUrl}/ows?service=WFS&version=1.1.0&request=DescribeFeatureType&typeName=${encodeURIComponent(layerId)}`,
      ];
      if (layerId.includes(':')) {
        const [ws, local] = layerId.split(':');
        describeCandidates.unshift(
          `${geoserverUrl}/${ws}/ows?service=WFS&version=2.0.0&request=DescribeFeatureType&typeName=${encodeURIComponent(local)}`
        );
      }
      for (const dUrl of describeCandidates) {
        try {
          const res = await fetch(dUrl, { headers: xmlHeaders });
          if (!res.ok) continue;
          const xmlText = await res.text();
          if (xmlText.includes('ExceptionReport') || xmlText.includes('ExceptionText')) continue;
          const parsedSchema = parseXmlSchema(xmlText);
          if (Object.keys(parsedSchema).length > 0) {
            columns = Object.entries(parsedSchema).map(([name, type]) => ({ name, type }));
            break;
          }
        } catch { /* continue */ }
      }
    } catch (schemaErr) {
      console.warn('Failed to fetch export schema via DescribeFeatureType:', schemaErr);
    }

    const cqlFilterParts: string[] = [];

    if (idsFilter) {
      const idsList = idsFilter.split(',').map(s => s.trim()).filter(Boolean);
      if (idsList.length > 0) {
        const idCol = columns.find(c => ['ogc_fid', 'fid', 'id'].includes(c.name.toLowerCase()));
        const allNumbers = idsList.every(id => /^\d+$/.test(id));
        if (allNumbers && idCol) {
          cqlFilterParts.push(`"${idCol.name}" IN (${idsList.join(',')})`);
        } else {
          cqlFilterParts.push(`IN ('${idsList.map(id => id.replace(/'/g, "''")).join("','")}')`);
        }
      }
    } else {
      // Dynamic fuzzy search across actual string columns
      if (search) {
        const rawTerms = search.split(',').map(s => s.trim()).filter(Boolean);
        const terms = rawTerms.length > 0 ? rawTerms : [search.trim()];
        const stringCols = columns.filter(col => ['string', 'text', 'varchar', 'char'].includes(col.type.toLowerCase()));
        if (stringCols.length > 0) {
          const termCqls = terms.map(term => {
            const escaped = term.replace(/'/g, "''");
            const colMatches = stringCols.map(col => `"${col.name}" ILIKE '%${escaped}%'`);
            return `(${colMatches.join(' OR ')})`;
          });
          cqlFilterParts.push(`(${termCqls.join(' OR ')})`);
        }
      }

      // Column-specific attribute filters
      searchParams.forEach((value, key) => {
        if (key.startsWith('filters[')) {
          const match = key.match(/filters\[([A-Za-z0-9_]+)__([a-z]+)\]/);
          if (match) {
            const colName = match[1];
            const operator = match[2];
            const colInfo = columns.find((c: { name: string; type: string }) => c.name === colName);
            const isNumeric = colInfo ? ['integer', 'int', 'float', 'double', 'number'].includes(colInfo.type.toLowerCase()) : false;
            if (operator === 'contains') cqlFilterParts.push(`"${colName}" ILIKE '%${value.replace(/'/g, "''")}%'`);
            else if (operator === 'startswith') cqlFilterParts.push(`"${colName}" ILIKE '${value.replace(/'/g, "''")}%'`);
            else if (operator === 'endswith') cqlFilterParts.push(`"${colName}" ILIKE '%${value.replace(/'/g, "''")}'`);
            else if (operator === 'eq') cqlFilterParts.push(isNumeric ? `"${colName}" = ${value}` : `"${colName}" = '${value}'`);
            else if (operator === 'gt') cqlFilterParts.push(`"${colName}" > ${value}`);
            else if (operator === 'gte') cqlFilterParts.push(`"${colName}" >= ${value}`);
            else if (operator === 'lt') cqlFilterParts.push(`"${colName}" < ${value}`);
            else if (operator === 'lte') cqlFilterParts.push(`"${colName}" <= ${value}`);
          }
        }
      });

      const qbFilter = searchParams.get('query_builder') || searchParams.get('cql_filter');
      if (qbFilter) cqlFilterParts.push(qbFilter);
    }

    // Try workspace-specific endpoint first (prevents "Unknown namespace" 400/404)
    const wfsWorkspace = layerId.includes(':') ? layerId.split(':')[0] : null;
    const wfsLocalName = layerId.includes(':') ? layerId.split(':')[1] : layerId;

    const wfsEndpointCandidates: Array<{ baseUrl: string; typeNamesParam: string; version: string }> = [];
    if (wfsWorkspace) {
      wfsEndpointCandidates.push({
        baseUrl: `${geoserverUrl}/${wfsWorkspace}/ows`,
        typeNamesParam: wfsLocalName,
        version: '2.0.0',
      });
      wfsEndpointCandidates.push({
        baseUrl: `${geoserverUrl}/${wfsWorkspace}/ows`,
        typeNamesParam: wfsLocalName,
        version: '1.1.0',
      });
    }
    wfsEndpointCandidates.push({
      baseUrl: `${geoserverUrl}/ows`,
      typeNamesParam: layerId,
      version: '2.0.0',
    });
    wfsEndpointCandidates.push({
      baseUrl: `${geoserverUrl}/ows`,
      typeNamesParam: layerId,
      version: '1.1.0',
    });

    let exportRes: Response | null = null;
    let exportError = '';

    for (const ep of wfsEndpointCandidates) {
      const epParams = new URLSearchParams({
        service: 'WFS',
        version: ep.version,
        request: 'GetFeature',
        [ep.version === '2.0.0' ? 'typeNames' : 'typeName']: ep.typeNamesParam,
        outputFormat: outputFormat,
      });

      if (sortBy) {
        epParams.append('sortBy', `${sortBy} ${sortOrder === 'desc' ? 'D' : 'A'}`);
      }
      if (cqlFilterParts.length > 0) {
        epParams.append('cql_filter', cqlFilterParts.join(' AND '));
      }

      const queryString = epParams.toString();
      try {
        let testRes: Response;
        if (queryString.length > 1000) {
          testRes = await fetch(ep.baseUrl, {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: queryString,
          });
        } else {
          testRes = await fetch(`${ep.baseUrl}?${queryString}`, { headers });
        }

        if (testRes.ok) {
          const peekText = await testRes.clone().text();
          if (peekText.includes('<ows:ExceptionReport') || peekText.includes('<ExceptionReport')) {
            const exceptionMatch = peekText.match(/<(?:[a-zA-Z0-9_]+:)?ExceptionText>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?ExceptionText>/i);
            exportError = exceptionMatch ? exceptionMatch[1].trim() : 'GeoServer Exception in export';
            continue;
          }
          exportRes = testRes;
          break;
        }

        const errText = await testRes.text();
        if (errText.includes('Unknown namespace') || errText.includes('404') || testRes.status === 404) {
          continue;
        }
        exportError = errText;
      } catch {
        continue;
      }
    }

    if (!exportRes || !exportRes.ok) {
      return new Response(JSON.stringify({ detail: exportError || 'WFS export failed from GeoServer.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const filename = `${layerId.replace(':', '_')}_export.${fileExtension}`;
    const headersConfig = new Headers({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new Response(exportRes.body, {
      status: 200,
      headers: headersConfig,
    });
  }

  // 5. POST /datasets/[id]/distincts/features/
  if (parts.length === 4 && parts[0] === 'datasets' && parts[2] === 'distincts' && parts[3] === 'features') {
    let fieldsToQuery: string[] = [];
    try {
      if (options.body) {
        const bodyObj = JSON.parse(
          typeof options.body === 'string'
            ? options.body
            : new TextDecoder().decode(options.body as any)
        );
        fieldsToQuery = bodyObj.fields || [];
      }
    } catch (e) {
      console.warn('Failed to parse distincts request body:', e);
    }

    const result: Record<string, string[]> = {};
    for (const field of fieldsToQuery) {
      try {
        const wfsParams = new URLSearchParams({
          service: 'WFS',
          version: '2.0.0',
          request: 'GetFeature',
          typeNames: layerId,
          propertyName: field,
          outputFormat: 'application/json',
          count: '5000',
        });
        const wfsUrl = `${geoserverUrl}/ows?${wfsParams.toString()}`;
        const wfsRes = await fetch(wfsUrl, { headers });
        let parsed = false;
        if (wfsRes.ok) {
          try {
            const json = await wfsRes.json();
            const features = json.features || [];
            const uniqueVals = new Set<string>();
            features.forEach((f: any) => {
              if (f.properties && f.properties[field] !== undefined && f.properties[field] !== null) {
                uniqueVals.add(String(f.properties[field]));
              }
            });
            result[field] = Array.from(uniqueVals).sort();
            parsed = true;
          } catch (jsonErr) {
            console.warn('GetFeature JSON distincts parsing failed, falling back to XML:', jsonErr);
          }
        }

        if (!parsed) {
          const xmlParams = new URLSearchParams({
            service: 'WFS',
            version: '2.0.0',
            request: 'GetFeature',
            typeNames: layerId,
            propertyName: field,
            count: '5000',
          });
          const xmlUrl = `${geoserverUrl}/ows?${xmlParams.toString()}`;
          const xmlRes = await fetch(xmlUrl, { headers });
          if (xmlRes.ok) {
            const xmlText = await xmlRes.text();
            result[field] = parseXmlDistinctValues(xmlText, field);
          } else {
            result[field] = [];
          }
        }
      } catch (err) {
        console.warn(`Failed to fetch distinct values for field ${field}:`, err);
        result[field] = [];
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ detail: 'Endpoint not supported.' }), { status: 404 });
}

// Main fetch helper for frontend API requests:
// - Adds JWT Bearer token to headers
// - Refreshes token automatically if expiring within 60s
// - If request gets a 401 Unauthorized, tries to refresh token once and retries
// - Routes /datasets/* calls directly to GeoServer
export async function apiRequest(endpoint: string, options: RequestOptions = {}) {

  // Direct client-side calls to GeoServer for datasets
  if (endpoint.startsWith('/datasets/')) {
    return handleDirectGeoServerDatasetRequest(endpoint, options);
  }

  const { auth = true, ...fetchOptions } = options;
  const store = useAuthStore.getState();

  let currentToken = store.token;

  // Proactive refresh: if the token is about to expire (within 60s), refresh
  // before sending the request so we don't get an avoidable 401.
  if (auth && currentToken && store.isTokenExpiringSoon()) {
    const refreshed = await store.refreshAccessToken();
    if (refreshed) currentToken = refreshed;
  }

  const headers = new Headers(fetchOptions.headers);
  if (auth && currentToken) {
    headers.set('Authorization', `Bearer ${currentToken}`);
  }
  if (!headers.has('Content-Type') && !(fetchOptions.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  let response = await fetch(`${siteConfig.api.baseUrl}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  // Reactive fallback: if we still get a 401 (e.g. the token was expired but not
  // flagged by isTokenExpiringSoon), attempt a refresh and retry once.
  if (response.status === 401 && auth) {
    const newToken = await store.refreshAccessToken();

    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      response = await fetch(`${siteConfig.api.baseUrl}${endpoint}`, {
        ...fetchOptions,
        headers,
      });
    } else {
      // Refresh failed (invalid/expired refresh token) — redirect to login.
      // Use replace so the login page doesn't appear in browser history.
      if (typeof window !== 'undefined') {
        window.location.replace('/login');
      }
    }
  }

  return response;
}
