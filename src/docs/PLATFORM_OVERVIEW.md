# VistaBridge Platform Overview for Frontend Developers

> **Understanding the Complete Ecosystem**  
> This guide provides frontend developers with essential knowledge about the backend, database, and infrastructure layers to work effectively on the VistaBridge platform.

---

## 🏗️ Platform Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND LAYER                           │
│  Next.js 16 | React 19 | TypeScript | Ant Design | Tailwind    │
│  Port: 3000                                                      │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP/REST
┌───────────────────────────────▼─────────────────────────────────┐
│                     CONTROL PLANE (Backend)                      │
│  Django 5.x | Django REST Framework | JWT Auth                  │
│  Port: 8000                                                      │
│  - User Management (accounts/)                                   │
│  - Dataset Metadata (datasets/)                                  │
│  - Map Workspaces (maps/)                                        │
│  - Upload Orchestration (DataUpload/)                            │
│  - Analysis APIs (vectoranalysis/, rasteranalysis/)              │
└─────┬──────────────────────────────────┬─────────────────────────┘
      │                                  │
      │ PostgreSQL                       │ S3 Protocol
      │                                  │
┌─────▼──────────────┐         ┌─────────▼─────────────────────────┐
│  METADATA DB       │         │   OBJECT STORAGE (MinIO)          │
│  PostgreSQL 15     │         │   Port: 9000 (API), 9001 (UI)     │
│  Port: 5432        │         │   - Raw uploads (GeoJSON, LAZ)    │
│  - User accounts   │         │   - Processed COGs                 │
│  - Dataset records │         │   - Point cloud COPC tiles         │
│  - Map configs     │         └─────────┬─────────────────────────┘
└────────────────────┘                   │
                                         │
┌────────────────────────────────────────▼─────────────────────────┐
│                    COMPUTE PLANE (Workers)                        │
│  Prefect 3.x Orchestration | GDAL/OGR | Python Workers           │
│  - Vector ingestion (ogr2ogr → PostGIS)                          │
│  - Raster ingestion (gdal_translate → COG)                       │
│  - Point cloud processing (pdal → COPC)                          │
│  - Analysis operations (buffer, clip, slope, NDVI)               │
└─────────────────┬────────────────────────────────────────────────┘
                  │
                  │ PostGIS Connection
                  │
┌─────────────────▼────────────────────────────────────────────────┐
│                   DATA PLANE (GIS Database)                       │
│  PostGIS (PostgreSQL 15 + Spatial Extensions)                    │
│  Port: 5433                                                       │
│  - Actual vector geometries                                       │
│  - Spatial tables (public.vistabridge_ds_*)                         │
│  - Spatial indexes (GIST)                                         │
└─────────────────┬────────────────────────────────────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
┌───────▼────────┐  ┌───────▼────────────┐
│ pg_tileserv    │  │ pg_featureserv     │
│ Port: 7800     │  │ Port: 9000         │
│ MVT Tiles      │  │ OGC Features API   │
└────────────────┘  └────────────────────┘
         │                   │
         └─────────┬─────────┘
                   │
         ┌─────────▼─────────────────────┐
         │     TRAEFIK (Gateway)          │
         │     Port: 80                   │
         │  - /vectortiles/*              │
         │  - /vectorfeature/*            │
         │  - /rastertiles/*              │
         │  - /pointcloud/*               │
         │  - Auth middleware             │
         └────────────────────────────────┘
```

---

## 🔐 Authentication & Authorization

### JWT Token Flow

1. **Login**: User submits credentials
   - Frontend → `POST /api/auth/token/` → Backend
   - Backend validates → Returns `{ access: "...", refresh: "..." }`

2. **Access Token**:
   - Valid for **15 minutes** (default)
   - Included in every request: `Authorization: Bearer <access>`

3. **Refresh Token**:
   - Valid for **7 days** (default)
   - Used to get new access token: `POST /api/token/refresh/`

4. **Auto-Refresh** (handled in `api.ts`):
   - When API returns `401`, frontend automatically calls refresh endpoint
   - If refresh succeeds → retry original request
   - If refresh fails → redirect to `/login`

### Backend Auth Files

```
backend/accounts/
├── models.py          # Custom User model (extends AbstractUser)
├── serializers.py     # User profile serialization
├── views.py           # Login, logout, profile endpoints
└── permissions.py     # IsOwner, IsInternal custom permissions
```

### Access Levels

| Level | Visibility | Use Case |
|-------|-----------|----------|
| `PRIVATE` | Only creator | Personal datasets |
| `INTERNAL` | All org users | Team collaboration |
| `PUBLIC` | Everyone | Open data |

**Frontend Usage**:
```tsx
<Select>
  <Option value="PRIVATE">Private (Restricted)</Option>
  <Option value="INTERNAL">Internal (Organization)</Option>
  <Option value="PUBLIC">Public (Global)</Option>
</Select>
```

---

## 🗄️ Database Schema Overview

### Metadata Database (Django PostgreSQL)

**Key Tables**:

```sql
-- User accounts
accounts_user (
  id, username, email, first_name, last_name,
  password, is_staff, is_active, date_joined
)

-- Dataset metadata
datasets_dataset (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  description TEXT,
  type VARCHAR(20),  -- 'VECTOR', 'RASTER', 'POINTCLOUD'
  format VARCHAR(10), -- '.geojson', '.tif', '.laz'
  status VARCHAR(20), -- 'PENDING', 'PROCESSING', 'READY', 'FAILED'
  access_level VARCHAR(20), -- 'PRIVATE', 'INTERNAL', 'PUBLIC'
  tags JSONB,
  bounds JSONB,  -- [minX, minY, maxX, maxY]
  crs VARCHAR(50),
  owner_id INT REFERENCES accounts_user(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Map workspaces
maps_mapworkspace (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  description TEXT,
  type VARCHAR(20),  -- '2D', '3D', 'POINTCLOUD'
  share VARCHAR(20), -- 'PRIVATE', 'INTERNAL', 'PUBLIC'
  owner_id INT REFERENCES accounts_user(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Map <-> Dataset relationship
maps_mapworkspace_datasets (
  id, mapworkspace_id, dataset_id
)
```

### Data Plane Database (PostGIS)

**Key Concepts**:

1. **Table Naming Convention**:
   ```
   public.vistabridge_ds_<UUID-with-underscores>
   Example: public.vistabridge_ds_a1b2c3d4_e5f6_7890_abcd_ef1234567890
   ```

2. **Geometry Column**:
   - Always named `geom`
   - Type: `GEOMETRY(Point/LineString/Polygon, 4326)` or `GEOGRAPHY`

3. **Spatial Index**:
   - Automatically created: `CREATE INDEX ON table USING GIST (geom)`

**Example Table**:
```sql
CREATE TABLE public.vistabridge_ds_a1b2c3d4_e5f6_7890_abcd_ef1234567890 (
  fid SERIAL PRIMARY KEY,
  geom GEOMETRY(MultiPolygon, 4326),
  name VARCHAR(255),
  area DOUBLE PRECISION,
  population INTEGER
);

CREATE INDEX idx_geom ON public.vistabridge_ds_... USING GIST (geom);
```

---

## 🛠️ Backend API Structure

### Django Apps Overview

```
backend/
├── accounts/          # User management, JWT auth
├── api/               # Core API views (schema, health checks)
├── datasets/          # Dataset CRUD, metadata management
├── DataUpload/        # Presigned URLs, ingestion status polling
├── maps/              # Map workspace CRUD
├── vectoranalysis/    # Buffer, clip, dissolve, union, etc.
├── rasteranalysis/    # Slope, aspect, NDVI, hillshade, etc.
├── internal/          # Internal-only APIs (system health)
└── misc/              # Miscellaneous utilities
```

### Key Backend Endpoints

#### Authentication
```
POST   /api/auth/token/           # Login (get JWT)
POST   /api/auth/token/refresh/   # Refresh access token
GET    /api/auth/profile/         # Get current user
PATCH  /api/auth/profile/         # Update profile
POST   /api/auth/password/        # Change password
```

#### Dataset Management
```
GET    /api/datasets/                     # List all datasets
POST   /api/datasets/                     # Create dataset (rarely used, use upload flow)
GET    /api/datasets/{uuid}/              # Get dataset detail
PATCH  /api/datasets/{uuid}/              # Update metadata
DELETE /api/datasets/{uuid}/              # Delete dataset + PostGIS table + S3 file
GET    /api/datasets/{uuid}/geojson/      # Export as GeoJSON
```

#### Upload Flow
```
POST   /api/upload/presigned-url/         # Get S3 upload URL
         Body: { "type": "VECTOR", "format": ".geojson" }
         Returns: { "url": "s3://...", "uuid": "..." }

GET    /api/upload/status/{uuid}/         # Poll ingestion progress
         Returns: { "status": "PROCESSING", "progress": 45, "message": "..." }
```

#### Map Workspaces
```
GET    /api/maps/                # List all maps
POST   /api/maps/                # Create map
         Body: { "name": "...", "type": "2D", "share": "PRIVATE" }
GET    /api/maps/{uuid}/         # Get map detail
PATCH  /api/maps/{uuid}/         # Update map
DELETE /api/maps/{uuid}/         # Delete map
POST   /api/maps/{uuid}/add-dataset/     # Add dataset to map
POST   /api/maps/{uuid}/remove-dataset/  # Remove dataset from map
```

#### Vector Analysis
```
POST   /api/vectoranalysis/buffer/
         Body: { "dataset_id": "uuid", "distance": 100, "unit": "meters" }
POST   /api/vectoranalysis/clip/
         Body: { "dataset_id": "uuid", "clip_geometry": {...} }
POST   /api/vectoranalysis/dissolve/
POST   /api/vectoranalysis/union/
POST   /api/vectoranalysis/difference/
# ... and more
```

#### Raster Analysis
```
POST   /api/rasteranalysis/slope/
POST   /api/rasteranalysis/aspect/
POST   /api/rasteranalysis/hillshade/
POST   /api/rasteranalysis/ndvi/
POST   /api/rasteranalysis/clip/
# ... and more
```

---

## ⚙️ Prefect Orchestration (Workflow Engine)

### What is Prefect?

**Prefect** is a modern workflow orchestration engine that:
- Schedules and monitors data pipelines
- Retries failed tasks automatically
- Provides real-time progress tracking
- Runs as a separate service (Port 4200)

### Prefect Flows (Workers)

Located in `workers/` directory:

```
workers/
├── vector_ingestion.py        # Main vector ingestion flow
├── raster_ingestion.py        # Main raster ingestion flow
├── point_cloud_ingestion.py   # Point cloud processing flow
├── vector/                    # Vector analysis operations
│   ├── buffer.py
│   ├── clip.py
│   ├── dissolve.py
│   └── ...
└── raster/                    # Raster analysis operations
    ├── slope.py
    ├── ndvi.py
    └── ...
```

### How It Works

1. **Backend triggers flow**:
   ```python
   from prefect.client.orchestration import get_client
   
   client = get_client()
   deployment = await client.read_deployment_by_name("vector-ingestion/default")
   flow_run = await client.create_flow_run_from_deployment(
       deployment.id,
       parameters={"dataset_id": uuid, "file_path": "s3://..."}
   )
   ```

2. **Worker executes**:
   - Downloads file from S3
   - Runs GDAL/OGR commands
   - Ingests to PostGIS
   - Updates dataset status in Django DB

3. **Frontend polls status**:
   ```typescript
   const response = await apiRequest(`/upload/status/${uuid}/`);
   // { status: "PROCESSING", progress: 65, message: "Importing to PostGIS..." }
   ```

**Prefect Dashboard**: http://localhost:4200

---

## 🌐 Tiling Services

### pg_tileserv (Vector Tiles)

**Purpose**: Serve PostGIS tables as Mapbox Vector Tiles (MVT)

**URL Pattern**:
```
http://localhost:80/vectortiles/{dataset-uuid}/{z}/{x}/{y}.pbf
```

**How it works**:
1. Traefik intercepts request
2. Rewrites UUID to PostGIS table name: `public.vistabridge_ds_*`
3. Forwards to pg_tileserv (Port 7800)
4. pg_tileserv queries PostGIS with spatial filter for tile bounds
5. Returns binary MVT (Protocol Buffers)

**Frontend Usage (OpenLayers)**:
```typescript
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import MVT from 'ol/format/MVT';

const layer = new VectorTileLayer({
  source: new VectorTileSource({
    format: new MVT(),
    url: `http://localhost:80/vectortiles/${datasetId}/{z}/{x}/{y}.pbf`
  })
});
```

### pg_featureserv (OGC Features API)

**Purpose**: Serve PostGIS tables as GeoJSON features (REST API)

**URL Pattern**:
```
http://localhost:80/vectorfeature/{dataset-uuid}/items
http://localhost:80/vectorfeature/{dataset-uuid}/items/{feature-id}
```

**Frontend Usage**:
```typescript
const response = await fetch(
  `http://localhost:80/vectorfeature/${datasetId}/items?limit=100`
);
const geojson = await response.json();
```

### TiTiler (Raster Tiles)

**Purpose**: Dynamically generate raster tiles from Cloud Optimized GeoTIFFs (COGs)

**URL Pattern**:
```
http://localhost:80/rastertiles/{dataset-uuid}/tiles/{z}/{x}/{y}.png
```

**Frontend Usage (OpenLayers)**:
```typescript
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';

const layer = new TileLayer({
  source: new XYZ({
    url: `http://localhost:80/rastertiles/${datasetId}/tiles/{z}/{x}/{y}.png`
  })
});
```

---

## 🐳 Docker Services

### Service Overview

| Service | Port | Purpose | Tech |
|---------|------|---------|------|
| **frontend** | 3000 | UI | Next.js |
| **backend** | 8000 | API | Django |
| **db** | 5432 | Metadata | PostgreSQL |
| **gis_db** | 5433 | Spatial Data | PostGIS |
| **minio** | 9000, 9001 | Object Storage | MinIO |
| **redis** | 6379 | Cache | Redis |
| **prefect** | 4200 | Orchestration | Prefect |
| **pg_tileserv** | 7800 | Vector Tiles | Go binary |
| **pg_featureserv** | 9000 | Features API | Go binary |
| **titiler** | 8080 | Raster Tiles | FastAPI |
| **traefik** | 80, 8080 | Gateway | Traefik |
| **docs** | 8005 | Documentation | MkDocs |

### Docker Compose Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f frontend
docker-compose logs -f backend

# Restart a service
docker-compose restart frontend

# Rebuild after code changes
docker-compose up -d --build frontend

# Stop all services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

### Environment Variables

**File**: `.env` (project root)

```env
# Database
POSTGRES_DB=vistabridge_control
POSTGRES_USER=vistabridge
POSTGRES_PASSWORD=vistabridge123

# GIS Database (Data Plane)
GIS_DB_NAME=vistabridge_gis
GIS_DB_USER=gis_user
GIS_DB_PASSWORD=gis_pass123
GIS_DB_HOST=gis_db
GIS_DB_PORT=5432

# MinIO (S3)
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_BUCKET=vistabridge

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000/api
NEXT_PUBLIC_TILESERV_URL=http://localhost:80

# Ports
BACKEND_PORT=8000
POSTGRES_HOST_PORT=5432
GIS_DB_HOST_PORT=5433
STORAGE_API_PORT=9000
STORAGE_CONSOLE_PORT=9001
```

---

## 📦 Data Flow Examples

### Example 1: Vector Dataset Upload

**Step-by-Step**:

1. **User**: Uploads `buildings.geojson` via `/data/new`

2. **Frontend**:
   ```typescript
   // Get presigned URL
   const { url, uuid } = await apiRequest('/upload/presigned-url/', {
     method: 'POST',
     body: JSON.stringify({ type: 'VECTOR', format: '.geojson' })
   });
   
   // Upload to S3
   await fetch(url, { method: 'PUT', body: file });
   ```

3. **Backend**: Triggers Prefect flow
   ```python
   await client.create_flow_run_from_deployment(
       deployment_id,
       parameters={"dataset_id": uuid, "file_path": f"s3://vistabridge/{uuid}.geojson"}
   )
   ```

4. **Prefect Worker**:
   - Downloads from S3: `/tmp/{uuid}.geojson`
   - Runs `ogr2ogr`:
     ```bash
     ogr2ogr -f PostgreSQL \
       "PG:host=gis_db dbname=vistabridge_gis user=gis_user password=gis_pass123" \
       /tmp/{uuid}.geojson \
       -nln vistabridge_ds_{uuid_underscores} \
       -lco GEOMETRY_NAME=geom
     ```
   - Updates dataset status: `READY`

5. **Frontend**: Polls status, sees `READY`, proceeds to metadata form

6. **User**: Fills metadata, clicks "Register Asset"

7. **Frontend**: `PATCH /api/datasets/{uuid}/` with name, description, tags

8. **Done**: Dataset appears in `/data/manage` and can be added to maps

### Example 2: 2D Map with Vector Layer

**Step-by-Step**:

1. **User**: Creates 2D map at `/map/new`

2. **Frontend**: `POST /api/maps/` → Returns map UUID

3. **User**: Clicks "Add Layer" → Selects dataset

4. **Frontend**: `POST /api/maps/{map-uuid}/add-dataset/` with `dataset_id`

5. **Frontend**: Initializes OpenLayers map
   ```typescript
   const vectorLayer = new VectorTileLayer({
     source: new VectorTileSource({
       format: new MVT(),
       url: `http://localhost:80/vectortiles/${datasetId}/{z}/{x}/{y}.pbf`
     })
   });
   map.addLayer(vectorLayer);
   ```

6. **Browser**: Requests tiles as user pans/zooms
   - `GET /vectortiles/{uuid}/10/512/384.pbf`
   - Traefik → pg_tileserv → PostGIS → MVT binary

7. **Done**: User sees interactive map with clickable features

---

## 🔍 Debugging Tips

### Frontend Debugging

**Browser DevTools**:
```javascript
// Check auth state
JSON.parse(localStorage.getItem('vismap-auth'))

// Manually test API
fetch('http://localhost:8000/api/datasets/', {
  headers: { 'Authorization': 'Bearer YOUR_TOKEN' }
}).then(r => r.json()).then(console.log)
```

**Network Tab**:
- Check request/response payloads
- Look for `401` (auth failed), `403` (permission denied), `500` (server error)

### Backend Debugging

**Django Logs**:
```bash
docker-compose logs -f backend
```

**Django Shell**:
```bash
docker-compose exec backend python manage.py shell

# Test API logic
from datasets.models import Dataset
datasets = Dataset.objects.all()
print(datasets)
```

### Database Debugging

**PostgreSQL (Metadata)**:
```bash
docker-compose exec db psql -U vistabridge -d vistabridge_control

\dt                              -- List tables
SELECT * FROM datasets_dataset;  -- Query datasets
```

**PostGIS (Data Plane)**:
```bash
docker-compose exec gis_db psql -U gis_user -d vistabridge_gis

\dt public.vistabridge_ds_*         -- List spatial tables
SELECT fid, ST_AsText(geom) FROM public.vistabridge_ds_...;  -- View geometries
```

### MinIO Debugging

**MinIO Console**: http://localhost:9001
- Login: `minioadmin` / `minioadmin`
- Browse bucket: `vistabridge`
- Check uploaded files

---

## 🚨 Common Issues & Solutions

### Issue: Frontend can't connect to backend

**Symptom**: Network errors, CORS issues

**Solution**:
1. Check backend is running: `docker-compose ps backend`
2. Check frontend `.env.local`: `NEXT_PUBLIC_API_URL=http://localhost:8000/api`
3. Check backend CORS settings in `settings.py`

### Issue: Dataset stuck in PROCESSING

**Symptom**: Progress bar never completes

**Solution**:
1. Check Prefect logs: `docker-compose logs -f worker`
2. Check Prefect dashboard: http://localhost:4200
3. Look for failed flow runs
4. Check MinIO for uploaded file: http://localhost:9001

### Issue: Map tiles not loading (404 errors)

**Symptom**: Map blank, network tab shows 404 for tile requests

**Solution**:
1. Check dataset status: Must be `READY`
2. Check PostGIS table exists:
   ```bash
   docker-compose exec gis_db psql -U gis_user -d vistabridge_gis -c "\dt public.vistabridge_ds_*"
   ```
3. Check pg_tileserv is running: `docker-compose ps pg_tileserv`
4. Check Traefik routing: http://localhost:8080/dashboard/

---

## 📖 Further Reading

- **Django REST Framework**: https://www.django-rest-framework.org/
- **PostGIS Documentation**: https://postgis.net/documentation/
- **GDAL/OGR Tutorials**: https://gdal.org/tutorials/
- **Prefect Concepts**: https://docs.prefect.io/latest/concepts/
- **MVT Specification**: https://github.com/mapbox/vector-tile-spec
- **OGC Features API**: https://ogcapi.ogc.org/features/

---

## ✅ Knowledge Check

After reading this guide, you should be able to:

- [ ] Explain the difference between Control Plane, Data Plane, and Compute Plane
- [ ] Describe the JWT authentication flow
- [ ] Understand how data flows from upload to map visualization
- [ ] Know which database stores what (metadata vs spatial data)
- [ ] Identify which service handles vector tiles vs raster tiles
- [ ] Debug common issues using logs and database queries
- [ ] Communicate effectively with backend and DevOps teams

---

**Questions? Reach out to the platform team!** 🙋‍♂️
