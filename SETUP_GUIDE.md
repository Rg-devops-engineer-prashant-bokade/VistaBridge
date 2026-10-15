# 🚀 GeoVista / Urban Vista — Complete Setup & Integration Guide

A comprehensive guide for setting up the application locally, connecting any GeoServer instance, configuring CORS (Jetty / Apache Tomcat), and installing the WPS (Web Processing Service) extension for spatial/raster analysis.

---

## 📋 Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Project Installation & Setup](#2-project-installation--setup)
3. [PostgreSQL Database Setup](#3-postgresql-database-setup)
4. [Connecting GeoServer to GeoVista](#4-connecting-geoserver-to-geovista)
5. [CORS Configuration Guide (Jetty & Tomcat)](#5-cors-configuration-guide)
   - [A. Standalone GeoServer (Jetty)](#a-standalone-geoserver-jetty)
   - [B. Apache Tomcat Deployment (WAR)](#b-apache-tomcat-deployment-war)
   - [Verifying CORS Configuration](#verifying-cors-configuration)
6. [GeoServer WPS Extension Setup](#6-geoserver-wps-extension-setup)
7. [Running & Verifying the Application](#7-running--verifying-the-application)

---

## 1. Prerequisites

Before starting, ensure you have the following installed on your system:
* **Node.js**: v18.17.0+ or v20.x+ (Check with `node -v`)
* **npm** or **yarn** / **pnpm**
* **PostgreSQL**: v14+ with PostGIS extension (optional but recommended)
* **GeoServer**: v2.20.x - v2.26.x (Running on Jetty or Apache Tomcat)
* **Java (JDK/JRE)**: OpenJDK 11 or 17 (Required by GeoServer)

---

## 2. Project Installation & Setup

### Step 1: Clone the repository
```bash
git clone https://github.com/your-org/geovista.git
cd geovista/urban-vista-development
```

### Step 2: Install dependencies
```bash
npm install
```

### Step 3: Configure Environment Variables
Copy the example environment file:
```bash
cp .env.example .env
```

Open `.env` and configure your settings:
```env
# --- DATABASE SETTINGS ---
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=vismap_control
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password_here

# --- SERVICE & GEOSERVER SETTINGS ---
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_GEOSERVER_URL=http://localhost:8080/geoserver
NEXT_PUBLIC_TILESERV_URL=http://localhost:7800

# --- JWT AUTHENTICATION SECRET ---
# Generate a 512-bit key with: node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
JWT_SECRET=your_generated_jwt_secret_key_here
```

---

## 3. PostgreSQL Database Setup

GeoVista uses PostgreSQL to store user profiles, custom dashboards, charts, and map workspaces with multi-tenant GeoServer isolation.

### Step 1: Create Database and User
Open `psql` or pgAdmin:
```sql
CREATE DATABASE vismap_control;
CREATE USER vismap_admin WITH ENCRYPTED PASSWORD 'vismap_password';
GRANT ALL PRIVILEGES ON DATABASE vismap_control TO vismap_admin;
```

### Step 2: Automatic Table Initialization
You **do not** need to run manual migration scripts!
When Next.js starts, the application automatically initializes and migrates all required tables:
* `user_profiles`
* `dashboards`
* `dashboard_charts`
* `map_workspaces`

---

## 4. Connecting GeoServer to GeoVista

GeoVista connects dynamically to **any** standard GeoServer instance:

1. **Default Connection**:
   * Set `NEXT_PUBLIC_GEOSERVER_URL` in `.env` to your default GeoServer instance (e.g., `http://localhost:8080/geoserver` or `http://your-remote-ip:8080/geoserver`).

2. **Multi-Server Connection via Login UI**:
   * Open the login page at `http://localhost:3000/login`.
   * Under the **GeoServer URL** field, enter the target GeoServer URL.
   * Enter your GeoServer credentials (e.g., `admin` / `geoserver` or any registered user).
   * GeoVista authenticates directly against GeoServer's security API and sets up an isolated workspace session for that specific GeoServer.

---

## 5. CORS Configuration Guide

To allow the frontend application to fetch **WMS GetCapabilities**, **WFS GetFeature**, **WCS**, and **WPS** layers without browser CORS blocking, CORS must be enabled on your GeoServer.

---

### A. Standalone GeoServer (Jetty)

If you are running the standalone GeoServer zip/installer (which uses an embedded **Jetty** web server):

1. Locate the `web.xml` file:
   * **Windows**: `C:\<geoserver_install_dir>\webapps\geoserver\WEB-INF\web.xml`
   * **Linux / Mac**: `/opt/geoserver/webapps/geoserver/WEB-INF/web.xml`

2. Open `web.xml` in a text editor and search for the **`<!-- Uncomment following filter to enable CORS in Jetty -->`** section (around lines 50–70).

3. Uncomment and ensure the **cross-origin filter** is defined:
```xml
<filter>
    <filter-name>cross-origin</filter-name>
    <filter-class>org.eclipse.jetty.servlets.CrossOriginFilter</filter-class>
    <init-param>
        <param-name>allowedOrigins</param-name>
        <param-value>*</param-value>
    </init-param>
    <init-param>
        <param-name>allowedMethods</param-name>
        <param-value>GET,POST,PUT,DELETE,HEAD,OPTIONS</param-value>
    </init-param>
    <init-param>
        <param-name>allowedHeaders</param-name>
        <param-value>Authorization,Content-Type,Accept,Origin,X-Requested-With,Access-Control-Request-Method,Access-Control-Request-Headers</param-value>
    </init-param>
    <init-param>
        <param-name>exposedHeaders</param-name>
        <param-value>Access-Control-Allow-Origin,Access-Control-Allow-Credentials,Content-Disposition</param-value>
    </init-param>
    <init-param>
        <param-name>supportsCredentials</param-name>
        <param-value>true</param-value>
    </init-param>
</filter>
```

4. Search for the corresponding **`filter-mapping`** (around lines 100–120) and uncomment it:
```xml
<filter-mapping>
    <filter-name>cross-origin</filter-name>
    <url-pattern>/*</url-pattern>
</filter-mapping>
```

5. Save `web.xml` and **restart GeoServer** (`bin/startup.bat` or `bin/startup.sh`).

---

### B. Apache Tomcat Deployment (WAR)

If GeoServer is deployed as a `.war` file inside an **Apache Tomcat** web server:

1. Locate the GeoServer `web.xml` file inside Tomcat:
   * `CATALINA_HOME/webapps/geoserver/WEB-INF/web.xml`
   *(Alternatively, you can edit Tomcat's global `CATALINA_HOME/conf/web.xml`)*

2. Add the Tomcat **`CorsFilter`** block inside the `<web-app>` tags:
```xml
<!-- Apache Tomcat CORS Filter for GeoServer -->
<filter>
    <filter-name>CorsFilter</filter-name>
    <filter-class>org.apache.catalina.filters.CorsFilter</filter-class>
    <init-param>
        <param-name>cors.allowed.origins</param-name>
        <param-value>*</param-value>
    </init-param>
    <init-param>
        <param-name>cors.allowed.methods</param-name>
        <param-value>GET,POST,PUT,DELETE,HEAD,OPTIONS</param-value>
    </init-param>
    <init-param>
        <param-name>cors.allowed.headers</param-name>
        <param-value>Authorization,Content-Type,Accept,Origin,X-Requested-With,Access-Control-Request-Method,Access-Control-Request-Headers</param-value>
    </init-param>
    <init-param>
        <param-name>cors.exposed.headers</param-name>
        <param-value>Access-Control-Allow-Origin,Access-Control-Allow-Credentials,Content-Disposition</param-value>
    </init-param>
    <init-param>
        <param-name>cors.support.credentials</param-name>
        <param-value>true</param-value>
    </init-param>
</filter>

<filter-mapping>
    <filter-name>CorsFilter</filter-name>
    <url-pattern>/*</url-pattern>
</filter-mapping>
```

3. Save `web.xml` and **restart Tomcat**:
```bash
# Windows
catalina.bat stop
catalina.bat start

# Linux
sudo systemctl restart tomcat
# or
./catalina.sh stop
./catalina.sh start
```

---

### Verifying CORS Configuration

Test your CORS headers from the terminal:
```bash
curl -I -X OPTIONS http://localhost:8080/geoserver/wms \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: GET"
```

**Expected Response**:
```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,HEAD,OPTIONS
Access-Control-Allow-Headers: Authorization,Content-Type,Accept,Origin,X-Requested-With
```

---

## 6. GeoServer WPS Extension Setup

GeoVista provides built-in spatial and raster analytics (Buffer, Clip, Intersection, Contour, Reclassify, Zonal Statistics) powered by GeoServer's **Web Processing Service (WPS)**.

### Step 1: Check your exact GeoServer version
* Open GeoServer in your browser: `http://localhost:8080/geoserver`
* Look at the bottom right corner or click **About GeoServer** (e.g. `2.24.2`, `2.25.0`, `2.26.1`).

### Step 2: Download the Matching WPS Plugin
Download the official WPS plugin corresponding to your exact version:
* Official Download Portal: [https://geoserver.org/download/](https://geoserver.org/download/)
* Direct Archive link template:
  `https://sourceforge.net/projects/geoserver/files/GeoServer/<VERSION>/extensions/geoserver-<VERSION>-wps-plugin.zip`

  *(Example for version 2.25.2: `geoserver-2.25.2-wps-plugin.zip`)*

### Step 3: Install the Extension JARs
1. Extract the downloaded `.zip` file.
2. Copy all `.jar` files from the extracted folder into GeoServer's `WEB-INF/lib/` directory:
   * **Standalone (Jetty)**: `<GEOSERVER_HOME>/webapps/geoserver/WEB-INF/lib/`
   * **Tomcat**: `<CATALINA_HOME>/webapps/geoserver/WEB-INF/lib/`
3. Restart GeoServer.

### Step 4: Verify WPS Installation in GeoServer Admin
1. Log in to GeoServer as Admin (`http://localhost:8080/geoserver/web`).
2. In the left navigation menu, verify that:
   * Under **Services**, **WPS** is now listed.
   * Under **About & Status**, click **Process Status** / **WPS Processes** to see installed processes (`gs:BufferFeatureCollection`, `gs:Clip`, `gs:Intersection`, `ras:RasterAsPointCollection`, `ras:Contour`, etc.).
3. Click on **WPS** under Services:
   * Ensure **Service Enabled** is checked ✅.
   * Set maximum execution limits (e.g., max synchronous processes = `16`).
   * Click **Save**.

---

## 7. Running & Verifying the Application

### Start Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Key Features to Test
1. **Login & Dynamic GeoServer Switch**:
   * Log in using your GeoServer URL & credentials.
2. **2D Map & Layer Catalog**:
   * Go to `/map/2d` and inspect WMS/WFS layers loaded live from your GeoServer.
3. **Query Builder & Spatial Queries**:
   * Open the Spatial / Buffer Query tools to execute buffer and polygon queries.
4. **WPS Analysis Panel**:
   * Run vector or raster processing operations directly against GeoServer's WPS engine.
5. **Dashboard & Charts**:
   * Go to `/dashboard/manage` or `/dashboard/view` to build interactive dashboards and ECharts visualizations.

---

## 🛠️ Troubleshooting & FAQs

* **Issue: `401 Unauthorized` on GeoServer WMS/WFS requests**:
  * Ensure the user credentials provided at login have read/write access to the workspaces in GeoServer (`Security` -> `Data Security`).
* **Issue: `Could not find type: {namespace}layer_name` on Layer Groups**:
  * Layer Groups (like `tasmania`) are WMS composite layers and do not have single vector schemas. Use individual sub-layers (e.g., `tasmania_roads`, `states`) for charts and attribute queries.
* **Issue: `CORS error` when fetching capabilities**:
  * Double check that the `<filter>` and `<filter-mapping>` blocks in `web.xml` are active and that GeoServer was restarted after editing.
