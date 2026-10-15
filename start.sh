#!/usr/bin/env bash

# Resolve script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

clear
echo -e "${CYAN}======================================================================${NC}"
echo -e "${CYAN}                 VISTABRIDGE APPLICATION LAUNCHER                     ${NC}"
echo -e "${CYAN}======================================================================${NC}"
echo ""

# -------------------------------------------------------------------------
# 0. CHECK NODE.JS
# -------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}[ERROR] Node.js is not found in your system PATH!${NC}"
    echo "Please install Node.js v18 or higher from https://nodejs.org"
    echo ""
    exit 1
fi

# -------------------------------------------------------------------------
# 1. CHECK CONFIGURATION (SQLite Database)
# -------------------------------------------------------------------------
ACTIVE_DB="./data/geovista.db"
if [ ! -f "$ACTIVE_DB" ]; then
    echo -e "${YELLOW}[!] Database $ACTIVE_DB not found.${NC}"
    echo "[*] Running setup wizard first..."
    echo ""
    bash "$SCRIPT_DIR/setup.sh"
    exit 0
fi

# Read active GeoServer directly from SQLite
ACTIVE_GS=$(node -e "const { createClient } = require('@libsql/client'); async function get() { try { const c = createClient({ url: 'file:$ACTIVE_DB' }); const r = await c.execute(\"SELECT value FROM app_settings WHERE key = 'geoserver_url'\"); console.log(r.rows.length ? r.rows[0].value : 'http://localhost:8080/geoserver'); } catch(e) { console.log('http://localhost:8080/geoserver'); } } get();" 2>/dev/null)
[ -z "$ACTIVE_GS" ] && ACTIVE_GS="http://localhost:8080/geoserver"

# -------------------------------------------------------------------------
# 2. VERIFY DEPENDENCIES & PRODUCTION BUILD
# -------------------------------------------------------------------------
if [ ! -d "node_modules" ]; then
    echo "[*] Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERROR] Failed to install dependencies.${NC}"
        exit 1
    fi
fi

if [ ! -d ".next" ]; then
    echo "[*] Production build not found. Running build now..."
    npm run build
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERROR] Build failed.${NC}"
        exit 1
    fi
fi

# -------------------------------------------------------------------------
# 3. CONFIGURE APPLICATION PORT (Default: 3007)
# -------------------------------------------------------------------------
APP_PORT="${PORT:-3007}"

PID=$(lsof -ti :$APP_PORT 2>/dev/null)
if [ -z "$PID" ]; then
    PID=$(ss -lptn "sport = :$APP_PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -n 1)
fi
if [ -n "$PID" ]; then
    echo "[*] Clearing previous process on port $APP_PORT (PID: $PID)..."
    kill -9 $PID 2>/dev/null
fi

# -------------------------------------------------------------------------
# 4. LAUNCH PRODUCTION SERVER
# -------------------------------------------------------------------------
echo "======================================================================"
echo "Current Configuration:"
echo "  GeoServer: $ACTIVE_GS"
echo "  Database:  $ACTIVE_DB"
echo "  Web URL:   http://localhost:$APP_PORT"
echo ""
echo "[*] Running in production mode on Port $APP_PORT (clean errors, fast performance)"
echo "[*] Note: To connect to a different GeoServer, run ./setup.sh"
echo "======================================================================"
echo ""
echo "Starting production server on port $APP_PORT..."
echo ""

# Launch Next.js on the unique port
npx next start -p "$APP_PORT"
