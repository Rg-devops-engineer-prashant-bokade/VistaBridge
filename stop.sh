#!/usr/bin/env bash

# Resolve script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

clear
echo -e "${RED}======================================================================${NC}"
echo -e "${RED}                     VISTABRIDGE STOP UTILITY                          ${NC}"
echo -e "${RED}======================================================================${NC}"
echo ""

# Read configured port from SQLite (default 3000)
APP_PORT="3000"
if command -v node >/dev/null 2>&1 && [ -f "./data/geovista.db" ]; then
    DB_PORT=$(node -e "const { createClient } = require('@libsql/client'); async function get() { try { const c = createClient({ url: 'file:data/geovista.db' }); const r = await c.execute(\"SELECT value FROM app_settings WHERE key = 'app_port'\"); console.log(r.rows.length ? r.rows[0].value : '3000'); } catch(e) { console.log('3000'); } } get();" 2>/dev/null)
    [ -n "$DB_PORT" ] && APP_PORT="$DB_PORT"
fi

PID=""
if command -v lsof >/dev/null 2>&1; then
    PID=$(lsof -ti :"$APP_PORT" 2>/dev/null)
elif command -v ss >/dev/null 2>&1; then
    PID=$(ss -lptn "sport = :$APP_PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -n 1)
fi
if [ -z "$PID" ]; then
    PID=$(netstat -tulpn 2>/dev/null | grep ":$APP_PORT" | awk '{print $7}' | cut -d'/' -f1 | head -n 1)
fi

if [ -n "$PID" ]; then
    echo "[*] Terminating VistaBridge process with PID: $PID on port $APP_PORT..."
    kill -9 $PID 2>/dev/null
    echo ""
    echo "======================================================================"
    echo -e "${GREEN}[OK] VistaBridge application on port $APP_PORT has been stopped successfully!${NC}"
    echo "======================================================================"
else
    echo "[INFO] No active VistaBridge server found running on port $APP_PORT."
fi

echo ""
