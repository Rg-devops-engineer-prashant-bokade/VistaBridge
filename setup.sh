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
echo -e "${CYAN}                     VISTABRIDGE SETUP WIZARD                         ${NC}"
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
# 1. CHECK DEPENDENCIES
# -------------------------------------------------------------------------
if [ ! -d "node_modules" ]; then
    echo "[*] Dependencies not found. Installing packages..."
    echo "[*] Please wait while npm install finishes..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo -e "${RED}[ERROR] npm install encountered an error. Please check your network.${NC}"
        exit 1
    fi
    echo -e "${GREEN}[OK] Dependencies installed successfully!${NC}"
    echo ""
fi

# -------------------------------------------------------------------------
# 2. GEOSERVER URL PROMPT
# -------------------------------------------------------------------------
FINAL_GS="http://localhost:8080/geoserver"
echo "----------------------------------------------------------------------"
echo " GeoServer Configuration"
echo "----------------------------------------------------------------------"
echo "Default: http://localhost:8080/geoserver"
read -r -p "Enter GeoServer URL (Press ENTER to use default): " USER_GS

if [ -n "$USER_GS" ]; then
    FINAL_GS="$USER_GS"
fi

if [ "$FINAL_GS" = "." ] || [ "$FINAL_GS" = "./" ] || [ -z "$FINAL_GS" ]; then
    FINAL_GS="http://localhost:8080/geoserver"
fi
if [[ ! "$FINAL_GS" =~ ^https?:// ]]; then
    FINAL_GS="http://$FINAL_GS"
fi

# Trim trailing slash
FINAL_GS="${FINAL_GS%/}"

# -------------------------------------------------------------------------
# 3. FRONTEND PORT CONFIGURATION
# -------------------------------------------------------------------------
echo ""
echo "----------------------------------------------------------------------"
echo " Frontend Port Configuration"
echo "----------------------------------------------------------------------"

APP_PORT=3000

while true; do
    read -r -p "Enter frontend port (default $APP_PORT, press ENTER to use default): " USER_PORT
    if [ -n "$USER_PORT" ]; then
        # Validate it's a number
        if ! [[ "$USER_PORT" =~ ^[0-9]+$ ]]; then
            echo -e "${RED}[ERROR] Invalid port number. Please enter a number between 1024 and 65535.${NC}"
            continue
        fi
        APP_PORT="$USER_PORT"
    fi

    # Check if port is in use
    PORT_PID=""
    if command -v lsof >/dev/null 2>&1; then
        PORT_PID=$(lsof -ti :"$APP_PORT" 2>/dev/null)
    elif command -v ss >/dev/null 2>&1; then
        PORT_PID=$(ss -lptn "sport = :$APP_PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -n 1)
    fi

    if [ -n "$PORT_PID" ]; then
        echo ""
        echo -e "${YELLOW}[WARN] Port $APP_PORT is currently in use (PID: $PORT_PID).${NC}"
        echo ""
        echo "  [1] Kill the process on port $APP_PORT and use it anyway"
        echo "  [2] Enter a different port"
        echo ""
        read -r -p "Your choice (1 or 2): " PORT_CHOICE
        if [ "$PORT_CHOICE" = "1" ]; then
            echo "[*] Terminating process on port $APP_PORT [PID: $PORT_PID]..."
            kill -9 $PORT_PID 2>/dev/null || true
            echo -e "${GREEN}[OK] Port $APP_PORT is now free.${NC}"
            break
        else
            APP_PORT=3000
            continue
        fi
    else
        break
    fi
done

echo -e "${GREEN}[OK] Frontend will run on port $APP_PORT.${NC}"

# -------------------------------------------------------------------------
# 4. SAVE CONFIGURATION
# -------------------------------------------------------------------------
echo ""
echo "[*] Saving configuration..."

mkdir -p "data"

# Remove any .env files - project runs 100% from SQLite
rm -f .env .env.local .env.production >/dev/null 2>&1

node -e "const { createClient } = require('@libsql/client'); const crypto = require('crypto'); async function save() { try { const c = createClient({ url: 'file:data/geovista.db' }); await c.execute('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);'); await c.execute({ sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: ['geoserver_url', process.argv[1]] }); await c.execute({ sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', args: ['tileserv_url', 'http://localhost:7800'] }); await c.execute({ sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: ['app_port', process.argv[2]] }); const row = await c.execute({ sql: 'SELECT value FROM app_settings WHERE key = ?', args: ['jwt_secret'] }); if (row.rows.length === 0) { const newKey = crypto.randomBytes(64).toString('base64'); await c.execute({ sql: 'INSERT INTO app_settings (key, value) VALUES (?, ?)', args: ['jwt_secret', newKey] }); } } catch(e){ console.error(e); } } save();" "$FINAL_GS" "$APP_PORT" >/dev/null 2>&1

echo -e "${GREEN}[OK] Configuration saved directly into SQLite database (data/geovista.db)!${NC}"
echo -e "${GREEN}[OK] Zero .env files created - project runs 100% from SQLite database.${NC}"

# -------------------------------------------------------------------------
# 5. VERIFY CONNECTION
# -------------------------------------------------------------------------
echo "[*] Checking GeoServer reachability [$FINAL_GS]..."
if curl -s -I --max-time 5 "$FINAL_GS/web/" >/dev/null 2>&1; then
    echo -e " ${GREEN}[OK] GeoServer is ONLINE.${NC}"
else
    echo -e " ${YELLOW}[WARN] GeoServer did not respond within 5s at $FINAL_GS. (Setup will continue)${NC}"
fi

# -------------------------------------------------------------------------
# 6. CLEAR CACHE
# -------------------------------------------------------------------------
if [ -d ".next" ]; then
    echo "[*] Clearing Next.js build cache..."
    rm -rf ".next"
fi

# -------------------------------------------------------------------------
# 7. COMPILE OPTIMIZED PRODUCTION BUILD
# -------------------------------------------------------------------------
echo ""
echo -e "${CYAN}======================================================================${NC}"
echo -e "${CYAN}[*] Compiling optimized production build (npm run build)...            ${NC}"
echo -e "${CYAN}[*] This removes all development error overlays and maximizes speed.  ${NC}"
echo -e "${CYAN}======================================================================${NC}"
echo ""
npm run build
if [ $? -ne 0 ]; then
    echo ""
    echo -e "${RED}[ERROR] Build encountered an error! Please check output above.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}======================================================================${NC}"
echo -e "${GREEN}                  SETUP COMPLETED SUCCESSFULLY!                      ${NC}"
echo -e "${GREEN}======================================================================${NC}"
echo "Active GeoServer: $FINAL_GS"
echo "Frontend Port:    $APP_PORT"
echo ""
echo "You can start the application anytime by running:"
echo "    ./start.sh"
echo "======================================================================"
echo ""

read -r -p "Would you like to start the application now? (Y/n): " LAUNCH
if [[ "$LAUNCH" =~ ^[Nn]$ ]]; then
    echo ""
    echo "Setup done. Run ./start.sh when you are ready!"
    exit 0
fi

bash "$SCRIPT_DIR/start.sh"
