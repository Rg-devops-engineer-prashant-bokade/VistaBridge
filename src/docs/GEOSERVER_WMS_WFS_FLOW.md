# GeoServer WMS & WFS Dual-Stream Flow Architecture

This document describes the architectural flow of how the map dashboards integrate with GeoServer to render maps (via WMS) and load attributes/features (via WFS) dynamically using user session cookies. This architecture mimics advanced client-side GIS platforms (like MapStore) by maintaining separate visualization (Tiles) and querying (Attributes) pipelines.

## Architectural Diagram

```
                       [ Add Layer ]
                             |
                       [ GeoServer ]
                             |
              +--------------+--------------+
              |                             |
          [ WMS ]                        [ WFS ]
              |                             |
         GetMap()                      GetFeature()
              |                             |
           (Tiles)                     (Attributes)
              |                             |
              +--------------+--------------+
                             |
                      [ Next.js API ]
                    (Cookies & Proxy)
                             |
                     [ Frontend client ]
                             |
              +--------------+--------------+
              |                             |
           [ MAP ]                      [ TABLE ]
        (OpenLayers)                 (AntD Attribute)
              |                             |
          [ User ]                      [ User ]
```

---

## 1. The Visualization Stream (WMS GetMap)

- **Purpose**: Render and display fast, cached spatial tiles on the interactive map.
- **Protocol**: Web Map Service (WMS) `GetMap` request.
- **Client Implementation**:
  - The OpenLayers map widget adds a `TileLayer` using `TileWMS` source.
  - The target URL is routed to the local Next.js proxy at `/api/geoserver/wms`.
- **Backend Implementation** ([wms/route.ts](file:///c:/Users/rotte/Desktop/geovista/urban-vista-development/src/app/api/geoserver/wms/route.ts)):
  - Reads the `geoserver_url` and `geoserver_auth` cookies from the request.
  - Appends the query parameters and forwards the request to the target GeoServer instance.
  - Caches the binary image tile response for **10 minutes** (`Cache-Control: public, max-age=600`) to optimize map pan and zoom actions.

---

## 2. The Query and Attributes Stream (WFS GetFeature)

- **Purpose**: Query features, run filters, calculate geometries, list attributes in tabular data, and export data in various formats (CSV, Shapefile, GeoJSON).
- **Protocol**: Web Feature Service (WFS) `GetFeature` and `DescribeFeatureType` requests.
- **Client Implementation**:
  - The `AttributeTable` component requests features dynamically from `/api/datasets/[id]/features/`.
  - The `QueryBuilder` component requests spatial and attribute filter matches from the same `/api/datasets/[id]/features/` endpoint.
- **Backend Implementation** ([features/route.ts](file:///c:/Users/rotte/Desktop/geovista/urban-vista-development/src/app/api/datasets/%5Bid%5D/features/route.ts)):
  - Resolves target URL and authorization headers from cookies.
  - Queries WFS GetFeature on GeoServer dynamically in JSON format (`outputFormat=application/json`).
  - Supports dynamic page parameters (`page`, `page_size`) using WFS 2.0.0 pagination (`count`, `startIndex`).
  - Implements a robust fallback mechanism for LayerGroups or Raster layers (which do not support WFS query streams) by parsing the error code and returning dynamic summary metadata records instead of throwing 500 error codes.

---

## 3. Benefits of this Flow

1. **End-to-End Security**: Authentication tokens (Basic Auth) are never exposed to the client-side browser Javascript. They are stored inside HttpOnly secure cookies and sent strictly from Next.js server-side route proxies.
2. **Dynamic Multi-Tenancy**: Users can log into their custom GeoServer instances dynamically. Next.js automatically proxies both WMS tile streams and WFS attribute tables to the user's specific GeoServer URL.
3. **Decoupled MAP & TABLE**: The map displays high-performance server-rendered tiles, while the attribute table handles rich attributes, query searches, and sorting.
