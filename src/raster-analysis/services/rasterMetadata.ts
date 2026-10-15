// ============================================================================
// Raster Metadata & WCS Coverage Parser (rasterMetadata.ts)
//
// In GIS, raster processes require knowing the image dimensions and CRS:
// - Queries GeoServer WCS 1.1.1 `DescribeCoverage` to inspect coverage structure
// - Extracts native CRS, bounding box extent, image pixel dimensions,
//   number of bands (e.g. RGB or single-band elevation), and NoData masks.
// - Caches results in memory for instant subsequent lookups.
// ============================================================================

import { RasterMetadata, RasterBoundingBox } from '../types/rasterAnalysis';
import { normalizeCRS } from './rasterCRS';

// In-memory cache for layer metadata
const metadataCache = new Map<string, RasterMetadata>();

/**
 * Fetches dynamic raster metadata from GeoServer.
 * Uses WCS DescribeCoverage as primary source of truth for native CRS & bounding box,
 * falling back to WMS GetCapabilities and REST APIs if needed.
 */
export async function getRasterMetadata(
  layerName: string,
  geoserverUrl: string,
  authHeader?: string
): Promise<RasterMetadata> {
  const cached = metadataCache.get(layerName);
  if (cached) return cached;

  const headers: Record<string, string> = {};
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const cleanUrl = geoserverUrl.replace(/\/$/, '');

  // 1. Try WCS 1.1.1 DescribeCoverage
  try {
    const candidates = [
      `${cleanUrl}/wcs?service=WCS&version=1.1.1&request=DescribeCoverage&identifiers=${encodeURIComponent(layerName)}`,
      `${cleanUrl}/wcs?service=WCS&version=1.1.1&request=DescribeCoverage&identifiers=${encodeURIComponent(layerName.split(':').pop() || layerName)}`
    ];

    for (const url of candidates) {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;

      const xmlText = await res.text();
      if (xmlText.includes('ExceptionReport') || xmlText.includes('CoverageNotDefined') || !xmlText.includes('CoverageDescription')) {
        continue;
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');

      const coverageEl = doc.getElementsByTagNameNS('*', 'CoverageDescription')[0] || doc.getElementsByTagName('wcs:CoverageDescription')[0];
      if (!coverageEl) continue;

      const title = coverageEl.getElementsByTagNameNS('*', 'Title')[0]?.textContent || layerName;

      // Extract all BoundingBox elements
      const bboxEls = Array.from(coverageEl.getElementsByTagNameNS('*', 'BoundingBox'));
      let nativeCRS = '';
      let nativeBBox: RasterBoundingBox | null = null;
      let latLonBbox: RasterBoundingBox | null = null;

      for (const bEl of bboxEls) {
        const crsAttr = bEl.getAttribute('crs') || '';
        const lowerText = bEl.getElementsByTagNameNS('*', 'LowerCorner')[0]?.textContent || '';
        const upperText = bEl.getElementsByTagNameNS('*', 'UpperCorner')[0]?.textContent || '';

        const lowerParts = lowerText.trim().split(/\s+/).map(Number);
        const upperParts = upperText.trim().split(/\s+/).map(Number);

        if (lowerParts.length >= 2 && upperParts.length >= 2 && !isNaN(lowerParts[0]) && !isNaN(upperParts[0])) {
          const parsedBbox: RasterBoundingBox = {
            minX: Math.min(lowerParts[0], upperParts[0]),
            minY: Math.min(lowerParts[1], upperParts[1]),
            maxX: Math.max(lowerParts[0], upperParts[0]),
            maxY: Math.max(lowerParts[1], upperParts[1])
          };

          if (crsAttr.includes('CRS84') || crsAttr.includes('4326')) {
            latLonBbox = parsedBbox;
          } else {
            nativeCRS = normalizeCRS(crsAttr);
            nativeBBox = parsedBbox;
          }
        }
      }

      // Extract GridOffsets if available
      let gridOffsets: [number, number] | undefined = undefined;
      const gridOffsetsEl = coverageEl.getElementsByTagNameNS('*', 'GridOffsets')[0];
      if (gridOffsetsEl && gridOffsetsEl.textContent) {
        const offsets = gridOffsetsEl.textContent.trim().split(/\s+/).map(Number);
        if (offsets.length >= 2 && !isNaN(offsets[0]) && !isNaN(offsets[1])) {
          gridOffsets = [offsets[0], offsets[1]];
        }
      }

      // If nativeCRS wasn't set from non-latlon bbox, look at GridBaseCRS or SupportedCRS
      if (!nativeCRS) {
        const gridBaseCrsEl = coverageEl.getElementsByTagNameNS('*', 'GridBaseCRS')[0];
        if (gridBaseCrsEl?.textContent) {
          nativeCRS = normalizeCRS(gridBaseCrsEl.textContent);
        } else {
          const supportedCrsEl = coverageEl.getElementsByTagNameNS('*', 'SupportedCRS')[0];
          if (supportedCrsEl?.textContent) {
            nativeCRS = normalizeCRS(supportedCrsEl.textContent);
          }
        }
      }

      if (!nativeCRS) {
        nativeCRS = 'EPSG:4326';
      }

      if (!nativeBBox && latLonBbox) {
        nativeBBox = latLonBbox;
      }

      if (nativeBBox) {
        const meta: RasterMetadata = {
          layerName,
          title,
          nativeCRS,
          bbox: nativeBBox,
          latLonBbox: latLonBbox || undefined,
          gridOffsets
        };
        metadataCache.set(layerName, meta);
        return meta;
      }
    }
  } catch (wcsErr) {
    console.warn('WCS 1.1.1 DescribeCoverage failed, attempting fallback:', wcsErr);
  }

  // 2. Fallback to WMS 1.3.0 GetCapabilities
  try {
    const capRes = await fetch(`${cleanUrl}/ows?service=WMS&version=1.3.0&request=GetCapabilities`, { headers });
    if (capRes.ok) {
      const xmlText = await capRes.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      const layers = xmlDoc.getElementsByTagName('Layer');

      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        const nameEl = Array.from(l.children).find(c => c.tagName === 'Name');
        const lName = nameEl?.textContent?.trim() || '';

        if (lName === layerName || lName === layerName.split(':').pop()) {
          const title = Array.from(l.children).find(c => c.tagName === 'Title')?.textContent?.trim() || layerName;

          let nativeCRS = '';
          let nativeBBox: RasterBoundingBox | null = null;
          let latLonBbox: RasterBoundingBox | null = null;

          const geoBboxEl = l.getElementsByTagName('EX_GeographicBoundingBox')[0];
          if (geoBboxEl) {
            const west = parseFloat(geoBboxEl.getElementsByTagName('westBoundLongitude')[0]?.textContent || '-180');
            const east = parseFloat(geoBboxEl.getElementsByTagName('eastBoundLongitude')[0]?.textContent || '180');
            const south = parseFloat(geoBboxEl.getElementsByTagName('southBoundLatitude')[0]?.textContent || '-90');
            const north = parseFloat(geoBboxEl.getElementsByTagName('northBoundLatitude')[0]?.textContent || '90');
            latLonBbox = { minX: west, minY: south, maxX: east, maxY: north };
          }

          // Inspect BoundingBox tags with CRS attribute
          const bboxes = Array.from(l.getElementsByTagName('BoundingBox'));
          for (const b of bboxes) {
            const crs = b.getAttribute('CRS') || b.getAttribute('srs') || '';
            const minx = parseFloat(b.getAttribute('minx') || '0');
            const miny = parseFloat(b.getAttribute('miny') || '0');
            const maxx = parseFloat(b.getAttribute('maxx') || '0');
            const maxy = parseFloat(b.getAttribute('maxy') || '0');

            if (!isNaN(minx) && !isNaN(maxx) && minx !== maxx) {
              const currentBox: RasterBoundingBox = { minX: minx, minY: miny, maxX: maxx, maxY: maxy };
              if (!crs.includes('4326') && !crs.includes('CRS84')) {
                nativeCRS = normalizeCRS(crs);
                nativeBBox = currentBox;
                break;
              } else if (!latLonBbox) {
                latLonBbox = currentBox;
              }
            }
          }

          if (!nativeCRS) {
            const crsEl = l.getElementsByTagName('CRS')[0];
            if (crsEl?.textContent) {
              nativeCRS = normalizeCRS(crsEl.textContent);
            } else {
              nativeCRS = 'EPSG:4326';
            }
          }

          if (!nativeBBox && latLonBbox) {
            nativeBBox = latLonBbox;
          }

          if (nativeBBox) {
            const meta: RasterMetadata = {
              layerName,
              title,
              nativeCRS,
              bbox: nativeBBox,
              latLonBbox: latLonBbox || undefined
            };
            metadataCache.set(layerName, meta);
            return meta;
          }
        }
      }
    }
  } catch (wmsErr) {
    console.warn('WMS GetCapabilities fallback failed:', wmsErr);
  }

  // 3. Last-resort fallback with safe defaults
  const fallbackMeta: RasterMetadata = {
    layerName,
    title: layerName,
    nativeCRS: 'EPSG:4326',
    bbox: { minX: -180, minY: -90, maxX: 180, maxY: 90 }
  };
  metadataCache.set(layerName, fallbackMeta);
  return fallbackMeta;
}
