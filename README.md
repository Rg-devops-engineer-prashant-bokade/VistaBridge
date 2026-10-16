<div align="center">

<img src="public/vblogo.png" alt="VistaBridge Logo" width="140" />

# VistaBridge

### Enterprise Spatial Data Infrastructure (SDI) & Web GIS Platform

*Empowering organizations to visualize, query, analyze, and build executive dashboards on top of any GeoServer instance.*

[![Built by Rotten Grapes](https://img.shields.io/badge/Built%20By-Rotten%20Grapes%20Pvt%20Ltd-0284c7?style=for-the-badge&logo=compass)](https://rottengrapes.tech/)
[![Live Trial](https://img.shields.io/badge/Live%20Demo-Try%20VistaBridge-10b981?style=for-the-badge&logo=google-chrome)](https://vistabridge.rottengrapes.tech/)
[![Documentation](https://img.shields.io/badge/Docs-Official%20Documentation-6366f1?style=for-the-badge&logo=gitbook)](https://rottengrapes.tech/docs/vistabridge/)

[![Next.js 16](https://img.shields.io/badge/Next.js-16.2.6-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.2.4-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![OpenLayers 10](https://img.shields.io/badge/OpenLayers-10.9-1F425B?style=flat-square&logo=openlayers)](https://openlayers.org/)
[![Apache ECharts 6](https://img.shields.io/badge/Apache%20ECharts-6.1-AA344D?style=flat-square&logo=apacheecharts)](https://echarts.apache.org/)
[![Ant Design 6](https://img.shields.io/badge/Ant%20Design-6.4-0170FE?style=flat-square&logo=antdesign)](https://ant.design/)

---

[Instant Trial](#instant-live-trial) •
[Documentation](#documentation--resources) •
[Key Features](#key-features) •
[Architecture](#architecture--tech-stack) •
[Quick Start](#quick-start-guide) •
[About Rotten Grapes](#about-rotten-grapes-private-limited)

---

</div>

## Instant Live Trial

You can explore VistaBridge directly in your browser with our hosted cloud demo environment:

| Resource | URL / Details |
| :--- | :--- |
| **Live Application** | [https://vistabridge.rottengrapes.tech/](https://vistabridge.rottengrapes.tech/) |
| **Demo Username** | `geouser` |
| **Demo Password** | `geouser` |
| **Official Documentation** | [https://rottengrapes.tech/docs/vistabridge/](https://rottengrapes.tech/docs/vistabridge/) |

> **Tip:** Log in with the credentials above to test live 2D mapping, spatial layer filtering, dynamic query building, and executive dashboard composition with pre-loaded spatial layers.

---

## What is VistaBridge?

**VistaBridge** is a modern, production-grade Web GIS and Spatial Data Infrastructure (SDI) solution engineered by **[Rotten Grapes Private Limited](https://rottengrapes.tech/)**. 

Traditional GIS software often suffers from complex desktop setups, clunky user interfaces, and siloed data workflows. VistaBridge bridges this gap by connecting directly to your existing **GeoServer** infrastructure to provide a lightning-fast, web-based control plane for:
- Interactive map exploration and spatial data visualization
- Advanced visual CQL / ECQL attribute & spatial query building
- Drag-and-drop executive dashboards combining maps, interactive charts, and KPIs
- Production-ready PDF report generation
- Complete white-labeling and multi-tenant customization

---

## Key Features

### 1. High-Performance 2D Web Mapping
- **OpenLayers 10 Engine**: Hardware-accelerated rendering with full support for vector, raster, and tile layers.
- **Dynamic OGC Services**: Native support for **WMS**, **WFS**, and **WPS** with dynamic layer catalog discovery.
- **Layer & Styling Controls**: Granular control over layer order, opacity, visibility, and on-the-fly thematic styling.
- **Interactive Measurement & Drawing**: Tools for distance, area calculation, point coordinates, and polygon boundary drawing.

### 2. Advanced Spatial Query & Visual CQL Builder
- **Visual Expression Builder**: Build complex filtering conditions without writing raw SQL or CQL syntax by hand.
- **Attribute Queries**: Filter datasets using logical operators (`=`, `!=`, `>`, `<`, `LIKE`, `IN`, `BETWEEN`).
- **Spatial Operators**: Perform spatial interactions including **INTERSECTS**, **WITHIN**, **CONTAINS**, and **DISJOINT**.
- **Cross-Layer & Buffer Queries**: Query features in a target layer based on spatial relationships or buffers around reference layers.
- **Smart Fallback Engine**: Seamlessly falls back from GeoServer WFS POST spatial filters to client-side **Turf.js** processing to eliminate feature-limit bottlenecks.

### 3. Drag-and-Drop Executive Dashboard Studio
- **Freeform Grid Layout**: Powered by `react-grid-layout` with responsive resizable and draggable widgets.
- **Rich Widget Library**:
  - **Live Map Widgets**: Interactive OpenLayers instances linked to filtered dataset views.
  - **Apache ECharts Visualizations**: Bar, Line, Pie, Donut, Scatter, and GeoCharts automatically synchronized with spatial attributes.
  - **KPI & Stat Cards**: Key metrics, counters, and progress indicators.
  - **Rich Text Notes & Documentation**: WYSIWYG note cards for context and annotations.
- **Spatial Extent Synchronization**: Pan or zoom a map widget to dynamically update linked statistical charts.


### 4. Multi-Page PDF & Report Export
- **Print Layout Sandbox**: Rearrange widgets across designated paper sheets before export.
- **Standard Page Formats**: Full support for **A4**, **A3**, and **Letter** paper sizes.
- **Flexible Orientation**: Switch between **Landscape** and **Portrait** modes.
- **Ultra-HD Quality**: High-resolution canvas rasterization via `html2canvas-pro` and vector generation via `jspdf`.
- **Automated Pagination & Branding**: Configurable headers, footers, pagination (`Page X of Y`), timestamps, and custom logos.

### 5. White-Labeling & Brand Customization
- Tailor the entire platform to your corporate identity in real time:
  - Custom branding colors (Primary & Secondary palettes)
  - Custom brand logo and favicon
  - Application title, subtitle, and footer credits
  - Automatic persistence via local SQLite database or PostgreSQL

### 6. Frictionless Setup & Platform Portability
- **One-Click Launchers**: Automated setup and launch scripts for both Windows (`setup.bat`, `start.bat`) and Linux/macOS (`setup.sh`, `start.sh`).
- **Embedded Database**: Zero-config SQLite database (`@libsql/client`) for local storage, with seamless PostgreSQL migration options for enterprise scale.
- **Port Conflict Management**: Automatically detects occupied ports and offers quick remapping or termination.

---

## Architecture & Tech Stack

```mermaid
graph TD
    Client[Browser / User Device] -->|HTTPS| Frontend[Next.js 16 App Router / React 19]
    Frontend --> MapLib[OpenLayers 10 & Proj4]
    Frontend --> ChartLib[Apache ECharts 6]
    Frontend --> SpatialEngine[Turf.js Spatial Engine]
    
    Frontend -->|WMS / WFS / WPS| GeoServer[GeoServer Spatial Backend]
    Frontend -->|REST APIs| APIRoutes[Next.js API Routes]
    
    APIRoutes --> LocalDB[(Embedded SQLite / PostgreSQL)]
    GeoServer --> PostGIS[(PostGIS Spatial Database)]
    GeoServer --> Geopackage[(GeoPackage / Shapefiles / COGs)]
```

### Core Technologies

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Framework** | [Next.js](https://nextjs.org/) | `16.2.6` | App Router, SSR, and API endpoints |
| **UI Library** | [React](https://react.dev/) | `19.2.4` | Modern component rendering |
| **Language** | [TypeScript](https://www.typescriptlang.org/) | `5.x` | Strict type safety across the entire application |
| **GIS Mapping** | [OpenLayers](https://openlayers.org/) | `10.9.0` | 2D Web map visualization & layer orchestration |
| **Spatial Analysis** | [Turf.js](https://turfjs.org/) | `7.3.5` | Spatial predicates, buffers, and geometric computations |
| **Charts & Data** | [Apache ECharts](https://echarts.apache.org/) | `6.1.0` | High-performance interactive visualizations |
| **Component Design**| [Ant Design](https://ant.design/) | `6.4.2` | Clean, accessible enterprise UI widgets |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) | `4.x` | Modern utility-first responsive styling |
| **Grid Management** | [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) | `2.2.3` | Responsive draggable/resizable dashboard canvas |
| **State Management**| [Zustand](https://zustand-demo.pmnd.rs/) | `5.0.13` | Lightweight, unopinionated reactive stores |
| **Local Storage** | [libSQL / SQLite](https://github.com/tursodatabase/libsql-client-ts) | `0.18.0` | Embedded persistence for workspaces & settings |

---

## Quick Start Guide

### Prerequisites
- **Node.js**: Latest LTS (`v20.x` or `v22.x`+) ([Download Node.js](https://nodejs.org/))
- **GeoServer**: Any accessible GeoServer instance (v2.20.x – v2.26.x+ or higher, local or remote URL — e.g., `http://localhost:8080/geoserver` or your domain)
- **Port & Configuration**: Runs on port `3000` by default or any port you specify. All configurations and environment parameters are stored directly in the embedded database (`data/geovista.db`) created during setup — no `.env` file management required.
- **Git**: Installed and available in your system path

---

### Option A: Automated Setup Scripts

#### On Windows:
Double-click or run:
```cmd
setup.bat
```
Follow the interactive prompts to configure your GeoServer URL and preferred port, then launch anytime with:
```cmd
start.bat
```

#### On Linux / macOS:
Make the scripts executable and run:
```bash
chmod +x setup.sh start.sh stop.sh
./setup.sh
./start.sh
```

---

### Option B: Manual Setup

#### 1. Clone the repository
```bash
git clone https://github.com/rottengrapes/VistaBridge.git
cd VistaBridge
```

#### 2. Install dependencies
```bash
npm install
```

#### 3. Initialize Configuration Database
VistaBridge manages application settings and environment variables directly inside an embedded SQLite database (`data/geovista.db` in the `app_settings` table). Run the setup script (`setup.bat` / `setup.sh`) or initialize the settings table:
```bash
# Automated configuration prompt:
./setup.sh    # or setup.bat on Windows
```

#### 4. Run the development server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or your configured port) in your browser.

#### 5. Build for production
```bash
npm run build
npm run start
```

---

## Connecting Your Own GeoServer

VistaBridge connects to any standard GeoServer instance:

1. **Configure GeoServer URL & Port**:
   Set during the interactive setup wizard (`setup.bat` / `setup.sh`) or update the `geoserver_url` and `app_port` entries directly in the `app_settings` table of `data/geovista.db`.
2. **Ensure CORS is enabled on GeoServer**:
   - **For Jetty (Standalone GeoServer)**:
     Uncomment the `CrossOriginFilter` block inside `webapps/geoserver/WEB-INF/web.xml`.
   - **For Apache Tomcat**:
     Enable Tomcat's built-in `CorsFilter` inside Tomcat's `conf/web.xml`.
3. **Verify WFS / WMS services**:
   Ensure `WFS 1.1.0` or `WFS 2.0.0` output format `application/json` is allowed for feature queries.
4. For detailed step-by-step instructions, see our [Setup & Integration Guide](SETUP_GUIDE.md).

---

## Repository Structure

```text
VistaBridge/
├── public/                 # Static assets, logos, and icons
├── src/
│   ├── app/                # Next.js App Router
│   │   ├── api/            # Serverless API routes (GeoServer proxy, auth, settings)
│   │   ├── accounts/       # User profile, appearance & theme settings
│   │   ├── dashboard/      # Executive Dashboard Builder & Viewer
│   │   │   ├── manage/     # Dashboard manager & list
│   │   │   ├── new/        # Dashboard creation wizard
│   │   └── view/           # Interactive canvas & PDF export studio
│   │   ├── map/            # Web GIS Map Workspaces
│   │   │   ├── 2d/         # 2D OpenLayers map viewer & layer manager
│   │   │   ├── manage/     # Saved maps list
│   │   │   └── new/        # Map creation wizard
│   │   └── login/          # Authentication view
│   ├── components/         # Modular React UI components
│   │   ├── dashboard/      # Chart theme pickers, widget wrappers
│   │   │   └── widgets/    # MapWidget, GeoChartWidget, TextWidget
│   │   └── map/            # QueryBuilder, Geocoder, StyleEditor, LayerTree
│   ├── config/             # Site configuration and default brand metadata
│   ├── lib/                # Database clients, GeoServer API proxy, spatial utils
│   └── store/              # Zustand global state stores (Auth, Map, Dashboard)
├── data/                   # Embedded SQLite persistent storage
├── setup.bat / setup.sh    # Interactive setup automation scripts
├── start.bat / start.sh    # Production launchers with port checking
└── stop.bat / stop.sh      # Service termination scripts
```

---

## Documentation & Resources

- **Comprehensive Documentation**: [https://rottengrapes.tech/docs/vistabridge/](https://rottengrapes.tech/docs/vistabridge/)
- **Live Demo & Sandbox**: [https://vistabridge.rottengrapes.tech/](https://vistabridge.rottengrapes.tech/)
- **Frontend Onboarding Guide**: [src/docs/FRONTEND_ONBOARDING.md](src/docs/FRONTEND_ONBOARDING.md)
- **GeoServer Setup Guide**: [SETUP_GUIDE.md](SETUP_GUIDE.md)

---

## About Rotten Grapes Private Limited

**[Rotten Grapes Private Limited](https://rottengrapes.tech/)** is a specialized geospatial technology and software engineering company. We build modern, scalable, and intelligent spatial data infrastructures, remote sensing pipelines, and enterprise GIS applications.

- **Website**: [https://rottengrapes.tech](https://rottengrapes.tech/)
- **Inquiries & Support**: [office@rottengrapes.tech](mailto:office@rottengrapes.tech)
- **Enterprise Consulting**: Custom GIS architectures, GeoServer optimization, spatial database modeling, and dedicated deployments.

---

## License

This software is developed and maintained by **Rotten Grapes Private Limited**.  
For licensing details, commercial support, or custom enterprise solutions, please visit [rottengrapes.tech](https://rottengrapes.tech/) or reach out to [office@rottengrapes.tech](mailto:office@rottengrapes.tech).

<div align="center">
<sub>Crafted with precision by the geospatial engineering team at <strong>Rotten Grapes Private Limited</strong>.</sub>
</div>
