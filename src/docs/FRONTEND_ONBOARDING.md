# VistaBridge Frontend - Developer Onboarding Guide

> **Welcome to the VistaBridge Geospatial Platform Frontend Team!**  
> This document will help you quickly understand the architecture, setup, and development workflow for the VistaBridge frontend application.

---

## 📋 Table of Contents

1. [Platform Overview](#platform-overview)
2. [Frontend Technology Stack](#frontend-technology-stack)
3. [Project Structure](#project-structure)
4. [Getting Started](#getting-started)
5. [Core Concepts](#core-concepts)
6. [Key Features & Pages](#key-features--pages)
7. [State Management](#state-management)
8. [API Integration](#api-integration)
9. [Styling & UI Components](#styling--ui-components)
10. [Map Visualization](#map-visualization)
11. [Development Workflow](#development-workflow)
12. [Common Tasks](#common-tasks)
13. [Troubleshooting](#troubleshooting)
14. [Resources](#resources)

---

## 🌍 Platform Overview

**VistaBridge** is a cloud-native, enterprise-grade **Geospatial Data Infrastructure (SDI)** platform that enables:

- **Multi-format Vector Ingestion**: Shapefiles, GeoPackage, DXF, GeoJSON
- **Raster Processing**: Cloud Optimized GeoTIFF (COG) generation
- **Point Cloud Visualization**: LiDAR data (LAZ/LAS) rendering
- **Real-time Tiling**: Mapbox Vector Tiles (MVT) and OGC Features API
- **Advanced GIS Analytics**: Vector and raster spatial analysis

### Architecture Layers

The platform consists of three main layers:

1. **Control Plane** (Django Backend): API, authentication, metadata management
2. **Data Plane** (PostGIS): Spatial database for actual geospatial data
3. **Compute Plane** (Prefect Workers): Orchestration and processing workflows
4. **Frontend** (Next.js): User interface and visualization layer ← **YOU ARE HERE**

### How Data Flows

```
User Upload → Frontend → Backend API → S3/MinIO Storage → Prefect Worker → PostGIS → Tiling Services → Frontend Map
```

---

## 🛠️ Frontend Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js** | 16.2.6 | React framework with App Router |
| **React** | 19.2.4 | UI library |
| **TypeScript** | 5.x | Type safety |
| **Ant Design** | 6.4.2 | UI component library |
| **Tailwind CSS** | 4.x | Utility-first CSS framework |
| **Zustand** | 5.0.13 | Lightweight state management |
| **OpenLayers (OL)** | 10.9.0 | 2D web mapping library |
| **Lucide React** | 1.16.0 | Icon library |

---

## 📁 Project Structure

```
frontend/
├── public/                      # Static assets
│   ├── vblogo.png             # Application logo
│   └── rottengrapes_logo.png  # Rotten Grapes logo
│
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── accounts/           # User profile & password management
│   │   │   ├── password/
│   │   │   └── profile/
│   │   ├── map/                # Map workspace management
│   │   │   ├── 2d/            # 2D map viewer (OpenLayers)
│   │   │   ├── manage/        # List all maps
│   │   │   └── new/           # Create new map wizard
│   │   ├── login/              # Authentication page
│   │   ├── layout.tsx          # Root layout with providers
│   │   ├── page.tsx            # Dashboard homepage
│   │   └── globals.css         # Global styles
│   │
│   ├── components/             # Reusable components
│   │   ├── layout/
│   │   │   └── DashboardLayout.tsx  # Main app layout with sidebar
│   │   ├── map/
│   │   │   ├── Geocoder.tsx         # Location search
│   │   │   ├── StyleEditor.tsx      # Vector style editor
│   │   │   └── PointCloudStyleEditor.tsx  # Point cloud styling
│   │   └── providers/
│   │       └── AntdProvider.tsx     # Ant Design theme config
│   │
│   ├── config/                 # Configuration files
│   │   ├── site-config.ts      # App branding, API URLs
│   │   └── basemap.config.json # Base map tile providers
│   │
│   ├── lib/                    # Utility functions
│   │   └── api.ts              # API client with auth handling
│   │
│   └── store/                  # State management
│       └── useAuthStore.ts     # Authentication state (Zustand)
│
├── package.json                # Dependencies
├── tsconfig.json              # TypeScript configuration
├── next.config.ts             # Next.js configuration
└── tailwind.config.js         # (implicit) Tailwind config
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v20+ recommended
- **npm** or **yarn** or **pnpm**
- **Docker & Docker Compose**: For running the full stack locally

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd urban-vista/frontend
```

### Step 2: Install Dependencies

```bash
npm install
# or
yarn install
```

### Step 3: Environment Configuration

Create a `.env.local` file in the `frontend/` directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api
NEXT_PUBLIC_TILESERV_URL=http://localhost:80
```

> **Note**: When running via Docker Compose, these are set automatically in `docker-compose.yml`.

### Step 4: Run Development Server

**Option A: Standalone (requires backend running separately)**
```bash
npm run dev
```

**Option B: Full Stack with Docker Compose (Recommended)**
```bash
# From project root
docker-compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Step 5: Login

Default credentials (configured in backend):
- **Username**: `admin`
- **Password**: (check backend setup or create via Django admin)

---

## 🧠 Core Concepts

### 1. App Router (Next.js 13+ Paradigm)

This project uses **Next.js App Router** (not Pages Router). Key differences:

- **File-based routing**: `app/data/new/page.tsx` → `/data/new`
- **Server Components by default**: Add `'use client'` directive for client-side interactivity
- **Layouts**: `layout.tsx` files wrap child pages
- **Loading & Error States**: `loading.tsx` and `error.tsx` per route

### 2. Authentication Flow

1. User enters credentials at `/login`
2. Frontend calls `/api/auth/token/` (JWT token endpoint)
3. Backend returns `{ access: "...", refresh: "..." }`
4. Token stored in **Zustand** with **localStorage persistence**
5. All API requests include `Authorization: Bearer <access_token>`
6. Token refresh happens automatically in `api.ts` when `401` is received

### 3. Data Ingestion Workflow

**User Journey**: Upload → Process → Metadata → Success

1. **Upload**: User drags/drops file → presigned S3 URL obtained → direct upload to MinIO
2. **Process**: Backend triggers Prefect flow → GDAL/OGR processing → PostGIS import
3. **Metadata**: User fills in name, description, access level, tags
4. **Success**: Dataset appears in `/data/manage` and can be added to maps

### 4. Map Types

| Type | Description | Library | Format |
|------|-------------|---------|--------|
| **2D Map** | Flat planar viewer | OpenLayers | MVT (Vector Tiles), TMS (Raster) |
| **3D Map** | Globe with terrain draping | CesiumJS | 3D Tiles, Terrain, Imagery |
| **Point Cloud** | LiDAR visualization | CesiumJS | LAZ/LAS (COPC) |

---

## 📄 Key Features & Pages

### 1. Dashboard (`/`)

**File**: `src/app/page.tsx`

- **Purpose**: Landing page after login
- **Features**: Stats cards (datasets, maps, users), recent activity feed
- **Protected**: Redirects to `/login` if not authenticated

### 2. Login Page (`/login`)

**File**: `src/app/login/page.tsx`

- **Purpose**: JWT authentication
- **API Endpoint**: `POST /api/auth/token/`
- **Stores**: Access & refresh tokens in Zustand store
- **Split Layout**: Left panel (hero image), Right panel (login form)

### 3. Add New Data (`/data/new`)

**File**: `src/app/data/new/page.tsx`

**Wizard Steps**:
1. **Upload**: Drag & drop file → presigned URL → S3 upload with progress bar
2. **Process**: Poll `/upload/status/{uuid}/` every 2 seconds for progress (0-100%)
3. **Metadata**: Form with name, description, access level (PRIVATE/INTERNAL/PUBLIC), tags
4. **Success**: Redirect to `/data/manage/{id}` (detail view)

**Supported Formats**:
- **Vector**: GeoJSON, Shapefile (ZIP), GeoPackage
- **Raster**: GeoTIFF
- **Point Cloud**: LAZ, LAS, COPC.LAZ

### 4. Manage Data (`/data/manage`)

**File**: `src/app/data/manage/page.tsx`

- **Purpose**: Browse all datasets (table view)
- **Features**:
  - Search by name/ID
  - Filter by type (VECTOR/RASTER/POINTCLOUD), access level, date range
  - Bulk delete
  - Quick actions: View, Edit, Delete
- **API Endpoint**: `GET /api/datasets/`

### 5. Create New Map (`/map/new`)

**File**: `src/app/map/new/page.tsx`

- **Purpose**: Choose map type (2D/3D/Point Cloud) and create workspace
- **Flow**: Select template → Fill metadata → Create → Redirect to viewer
- **API Endpoint**: `POST /api/maps/`

### 6. Manage Maps (`/map/manage`)

**File**: `src/app/map/manage/page.tsx`

- **Purpose**: Browse all map workspaces
- **Features**: Similar to data management (search, filter, delete)
- **API Endpoint**: `GET /api/maps/`

### 7. 2D Map Viewer (`/map/2d?id=<uuid>`)

**File**: `src/app/map/2d/page.tsx`

- **Library**: OpenLayers
- **Data Sources**:
  - **Vector Tiles**: `http://localhost:80/vectortiles/{uuid}/{z}/{x}/{y}.pbf`
  - **Raster Tiles**: `http://localhost:80/rastertiles/{uuid}/{z}/{x}/{y}.png`
- **Features**: Layer switcher, style editor, measurement tools, geocoder

### 8. 3D Map Viewer (`/map/3d?id=<uuid>`)

**File**: `src/app/map/3d/page.tsx`

- **Library**: CesiumJS
- **Data Sources**: 3D Tiles, Terrain, Imagery layers
- **Features**: Camera controls, terrain draping, hillshade rendering

---

## 🗃️ State Management

### Zustand Store: `useAuthStore`

**File**: `src/store/useAuthStore.ts`

**State**:
```typescript
{
  user: User | null,           // Current user profile
  token: string | null,        // JWT access token
  refreshToken: string | null, // JWT refresh token
  hydrated: boolean            // Rehydration complete flag
}
```

**Actions**:
```typescript
setAuth(user, token, refreshToken)  // Store credentials
clearAuth()                         // Logout (clear all)
refreshAccessToken()                // Refresh expired token
```

**Persistence**: Automatically synced to `localStorage` under key `vismap-auth`.

**Usage Example**:
```tsx
import { useAuthStore } from '@/store/useAuthStore';

function MyComponent() {
  const { user, token, clearAuth } = useAuthStore();
  
  const handleLogout = () => {
    clearAuth();
    router.push('/login');
  };
  
  return <div>Welcome, {user?.username}</div>;
}
```

---

## 🔌 API Integration

### API Client: `apiRequest`

**File**: `src/lib/api.ts`

**Purpose**: Centralized HTTP client with automatic authentication and token refresh.

**Usage**:
```typescript
import { apiRequest } from '@/lib/api';

// GET request
const response = await apiRequest('/datasets/');
const data = await response.json();

// POST request
const response = await apiRequest('/maps/', {
  method: 'POST',
  body: JSON.stringify({ name: 'My Map', type: '2D' })
});

// Without auth (public endpoint)
const response = await apiRequest('/public/data/', { auth: false });
```

**Features**:
- ✅ Automatic `Authorization: Bearer <token>` header
- ✅ Automatic token refresh on `401` error
- ✅ Redirect to `/login` if refresh fails
- ✅ Base URL from `siteConfig.api.baseUrl`

### Backend API Endpoints

**Base URL**: `http://localhost:8000/api`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/token/` | POST | Login (get JWT tokens) |
| `/auth/refresh/` | POST | Refresh access token |
| `/auth/profile/` | GET | Get current user profile |
| `/upload/presigned-url/` | POST | Get S3 presigned upload URL |
| `/upload/status/{uuid}/` | GET | Poll ingestion progress |
| `/datasets/` | GET/POST | List/create datasets |
| `/datasets/{uuid}/` | GET/PATCH/DELETE | Retrieve/update/delete dataset |
| `/maps/` | GET/POST | List/create map workspaces |
| `/maps/{uuid}/` | GET/PATCH/DELETE | Retrieve/update/delete map |
| `/vectoranalysis/{operation}/` | POST | Run vector analysis (buffer, clip, etc.) |
| `/rasteranalysis/{operation}/` | POST | Run raster analysis (NDVI, slope, etc.) |

**API Documentation**: [http://localhost:8000/api/schema/swagger-ui/](http://localhost:8000/api/schema/swagger-ui/)

---

## 🎨 Styling & UI Components

### Design System

**Primary Library**: [Ant Design v6](https://ant.design/)

**Theme Configuration**: `src/components/providers/AntdProvider.tsx`

```tsx
<ConfigProvider
  theme={{
    token: {
      colorPrimary: '#6818d2ff',   // Brand purple
      borderRadius: 8,
      fontFamily: 'Inter'
    }
  }}
>
  {children}
</ConfigProvider>
```

### Tailwind CSS

**Global Styles**: `src/app/globals.css`

**Utility Classes**:
```tsx
// Backgrounds
className="bg-white bg-gray-50 bg-primary/10"

// Rounded corners
className="rounded-xl rounded-2xl rounded-3xl"

// Shadows
className="shadow-sm shadow-md shadow-lg"

// Text
className="text-gray-500 text-primary font-bold uppercase"
```

### Custom CSS Classes

**Borderless Inputs**:
```css
.vismap-input {
  background-color: #f1f5f9 !important;
  border: none !important;
  padding: 10px 16px !important;
  border-radius: 12px !important;
}
```

**Primary Buttons**:
```css
.vismap-btn-primary {
  height: 48px !important;
  border-radius: 12px !important;
  font-weight: 600 !important;
  box-shadow: 0 4px 12px rgba(22, 119, 255, 0.2) !important;
}
```

### Icons

**Library**: [Lucide React](https://lucide.dev/)

**Usage**:
```tsx
import { Database, Map, User } from 'lucide-react';

<Database size={24} className="text-primary" />
```

---

## 🗺️ Map Visualization

### 2D Maps (OpenLayers)

**File**: `src/app/map/2d/page.tsx`

**Initialization**:
```typescript
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import MVT from 'ol/format/MVT';

const map = new Map({
  target: 'map',
  layers: [
    new TileLayer({
      source: new XYZ({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
      })
    })
  ],
  view: new View({
    center: [0, 0],
    zoom: 2
  })
});
```

**Loading Vector Tiles**:
```typescript
const vectorTileLayer = new VectorTileLayer({
  source: new VectorTileSource({
    format: new MVT(),
    url: `http://localhost:80/vectortiles/${datasetId}/{z}/{x}/{y}.pbf`
  })
});
map.addLayer(vectorTileLayer);
```

### 3D Maps (CesiumJS)

**File**: `src/app/map/3d/page.tsx`

**Initialization**:
```typescript
import { Viewer } from 'cesium';

const viewer = new Viewer('cesiumContainer', {
  terrainProvider: await createWorldTerrainAsync(),
  baseLayerPicker: true,
  timeline: false,
  animation: false
});
```

**Loading 3D Tiles**:
```typescript
import { Cesium3DTileset } from 'cesium';

const tileset = await Cesium3DTileset.fromUrl(
  `http://localhost:9000/pointcloud/${datasetId}/tileset.json`
);
viewer.scene.primitives.add(tileset);
viewer.zoomTo(tileset);
```

### Base Maps Configuration

**File**: `src/config/basemap.config.json`

**Available Base Maps**:
- OpenStreetMap (OSM)
- ESRI World Imagery
- Google Hybrid
- Google Street
- CartoDB Positron (Light)
- CartoDB Dark Matter
- CartoDB Voyager

---

## 💻 Development Workflow

### 1. Create a New Page

```bash
# Example: Create a new "Reports" page
mkdir -p src/app/reports
touch src/app/reports/page.tsx
```

```tsx
// src/app/reports/page.tsx
'use client';

import DashboardLayout from '@/components/layout/DashboardLayout';

export default function ReportsPage() {
  return (
    <DashboardLayout>
      <h1>Reports</h1>
    </DashboardLayout>
  );
}
```

**Route**: Automatically available at `/reports`

### 2. Add a New API Endpoint Integration

```typescript
// Example: Fetch reports
const response = await apiRequest('/reports/');
if (!response.ok) throw new Error('Failed to fetch reports');
const reports = await response.json();
```

### 3. Add New State (if needed)

**Option A**: Local component state
```tsx
const [reports, setReports] = useState([]);
```

**Option B**: Global Zustand store
```typescript
// src/store/useReportStore.ts
import { create } from 'zustand';

interface ReportState {
  reports: any[];
  setReports: (reports: any[]) => void;
}

export const useReportStore = create<ReportState>((set) => ({
  reports: [],
  setReports: (reports) => set({ reports })
}));
```

### 4. Styling Best Practices

✅ **DO**:
- Use Ant Design components for forms, modals, tables
- Use Tailwind for layout, spacing, colors
- Keep custom CSS minimal
- Use `className` for dynamic styles
- Follow existing design patterns (rounded corners, shadows)

❌ **DON'T**:
- Write inline styles (`style={{...}}`) unless dynamic
- Override Ant Design styles globally
- Use random color values (use theme colors)

---

## 🔧 Common Tasks

### Task 1: Add a New Menu Item to Sidebar

**File**: `src/components/layout/DashboardLayout.tsx`

```typescript
const menuItems = [
  // ... existing items
  {
    key: 'reports',
    label: 'Reports',
    icon: <FileText size={20} />,
    children: [
      { key: '/reports/analytics', label: 'Analytics', icon: <BarChart size={16} /> },
      { key: '/reports/exports', label: 'Exports', icon: <Download size={16} /> }
    ]
  }
];
```

### Task 2: Add a New Filter to Data Management

**File**: `src/app/data/manage/page.tsx`

```typescript
// Add state
const [statusFilter, setStatusFilter] = useState<string | null>(null);

// Add filter logic in useEffect
if (statusFilter) {
  filtered = filtered.filter(d => d.status === statusFilter);
}

// Add UI
<Select
  placeholder="Filter by status"
  value={statusFilter}
  onChange={setStatusFilter}
  options={[
    { label: 'All', value: null },
    { label: 'Ready', value: 'READY' },
    { label: 'Processing', value: 'PROCESSING' }
  ]}
/>
```

### Task 3: Customize Theme Colors

**File**: `src/config/site-config.ts`

```typescript
export const siteConfig: SiteConfig = {
  name: "VistaBridge",
  description: "Enterprise Spatial Data Infrastructure ( SDI ) solution",
  logo: "/vblogo.png",
  colors: {
    primary: "#6818d2ff",   // Change this to your brand color
    secondary: "#63676aff"
  },
  font: "Inter",
  api: {
    baseUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api"
  }
};
```

### Task 4: Add Error Handling to a Page

```tsx
import { App } from 'antd';

export default function MyPage() {
  const { notification } = App.useApp();
  
  const fetchData = async () => {
    try {
      const response = await apiRequest('/data/');
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      // ...
    } catch (error: any) {
      notification.error({
        message: 'Error',
        description: error.message,
        placement: 'topRight'
      });
    }
  };
  
  return <div>...</div>;
}
```

---

## 🐛 Troubleshooting

### Issue: "Hydration Mismatch" Error

**Cause**: Server-rendered HTML doesn't match client-side React tree.

**Solution**:
1. Add `suppressHydrationWarning` to `<html>` tag (already done in `layout.tsx`)
2. Avoid rendering dynamic content on initial load
3. Use `useEffect` to render client-only content

### Issue: Blank Page / "Module Not Found"

**Cause**: Import path error or missing dependency.

**Solution**:
```bash
# Clear Next.js cache
rm -rf .next
npm run dev
```

### Issue: API Requests Failing (CORS)

**Cause**: Backend not configured for frontend origin.

**Solution**: Check `backend/core/settings.py`:
```python
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://frontend:3000"
]
```

### Issue: Map Not Rendering

**Cause**: CesiumJS assets not found or OpenLayers CSS missing.

**Solution**:
- Ensure `public/cesium/` folder exists
- Check browser console for 404 errors
- Verify map container has height: `style={{ height: '100%' }}`

### Issue: Token Expired, Not Auto-Refreshing

**Cause**: Refresh token invalid or expired.

**Solution**:
```typescript
// Clear auth and re-login
import { useAuthStore } from '@/store/useAuthStore';
useAuthStore.getState().clearAuth();
```

---

## 📚 Resources

### Official Documentation

- **Next.js**: https://nextjs.org/docs
- **React**: https://react.dev/
- **TypeScript**: https://www.typescriptlang.org/docs/
- **Ant Design**: https://ant.design/components/overview/
- **Tailwind CSS**: https://tailwindcss.com/docs
- **Zustand**: https://zustand.docs.pmnd.rs/
- **OpenLayers**: https://openlayers.org/en/latest/doc/
- **CesiumJS**: https://cesium.com/learn/cesiumjs-learn/

### Project-Specific

- **Backend API Docs**: http://localhost:8000/api/schema/swagger-ui/
- **Platform Architecture**: `../vistabridge_software_architecture_and_system_design.md`
- **Vector Upload Docs**: `../doc/vector-upload.md`

### Useful Commands

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint code
npm run lint

# Type check
npx tsc --noEmit
```

---

## 🎯 Quick Start Checklist

- [ ] Clone repository
- [ ] Install Node.js v20+
- [ ] Run `npm install`
- [ ] Start backend via Docker Compose
- [ ] Run `npm run dev`
- [ ] Login at http://localhost:3000
- [ ] Upload a test dataset at `/data/new`
- [ ] Create a 2D map at `/map/new`
- [ ] Explore the codebase structure
- [ ] Read backend API docs
- [ ] Join team Slack/Discord channel (if applicable)

---

## 🤝 Team Collaboration

### Git Workflow

1. **Create feature branch**: `git checkout -b feature/add-reports-page`
2. **Make changes**: Edit files
3. **Commit**: `git commit -m "feat: add reports page"`
4. **Push**: `git push origin feature/add-reports-page`
5. **Create Pull Request**: On GitHub/GitLab

### Code Review Checklist

- [ ] Code follows existing patterns
- [ ] TypeScript types defined (no `any` unless necessary)
- [ ] API errors handled gracefully
- [ ] UI responsive on mobile/tablet
- [ ] No console errors in browser
- [ ] Tested on Chrome, Firefox, Safari

---

## 📞 Getting Help

- **Frontend Lead**: [Contact Info]
- **Backend Team**: For API questions
- **DevOps Team**: For deployment/Docker issues
- **Slack Channel**: `#vistabridge-frontend` (if applicable)

---

**Welcome aboard! Happy coding! 🚀**
