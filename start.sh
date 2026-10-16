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

# Read configured port from SQLite (default 3000)
APP_PORT=$(node -e "const { createClient } = require('@libsql/client'); async function get() { try { const c = createClient({ url: 'file:$ACTIVE_DB' }); const r = await c.execute(\"SELECT value FROM app_settings WHERE key = 'app_port'\"); console.log(r.rows.length ? r.rows[0].value : '3000'); } catch(e) { console.log('3000'); } } get();" 2>/dev/null)
[ -z "$APP_PORT" ] && APP_PORT="3000"

# Allow PORT env var to override
if [ -n "${PORT}" ]; then
    APP_PORT="${PORT}"
fi

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
# 3. CHECK IF PORT IS BUSY
# -------------------------------------------------------------------------
PORT_PID=""
if command -v lsof >/dev/null 2>&1; then
    PORT_PID=$(lsof -ti :"$APP_PORT" 2>/dev/null)
elif command -v ss >/dev/null 2>&1; then
    PORT_PID=$(ss -lptn "sport = :$APP_PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -n 1)
fi

if [ -n "$PORT_PID" ]; then
    echo -e "${YELLOW}[WARN] Port $APP_PORT is currently in use (PID: $PORT_PID).${NC}"
    echo ""
    echo "  [1] Kill the process and use port $APP_PORT"
    echo "  [2] Enter a different port for this session"
    echo ""
    read -r -p "Your choice (1 or 2): " PORT_CHOICE
    if [ "$PORT_CHOICE" = "1" ]; then
        echo "[*] Terminating process on port $APP_PORT (PID: $PORT_PID)..."
        kill -9 $PORT_PID 2>/dev/null || true
        echo -e "${GREEN}[OK] Port $APP_PORT is now free.${NC}"
    else
        read -r -p "Enter port number: " NEW_PORT
        if [ -n "$NEW_PORT" ]; then
            APP_PORT="$NEW_PORT"
        fi
    fi
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
echo "[*] The browser will open automatically once the application is ready."
echo ""

# Silently poll local port in background and open default browser when ready
(
  node -e "const net = require('net'); const { exec } = require('child_process'); const port = parseInt(process.argv[1] || '3000'); let tries = 0; const check = () => { if (tries++ > 60) return; const sock = net.createConnection({ port, host: '127.0.0.1' }, () => { sock.destroy(); const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'; exec(cmd + ' http://localhost:' + port); }); sock.on('error', () => setTimeout(check, 500)); }; setTimeout(check, 800);" "$APP_PORT"
) >/dev/null 2>&1 &

# Launch Next.js on the configured port
npx next start -p "$APP_PORT"
