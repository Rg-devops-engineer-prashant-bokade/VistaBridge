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
echo -e "${RED}                     GEOVISTA STOP UTILITY                             ${NC}"
echo -e "${RED}======================================================================${NC}"
echo ""

PID=$(lsof -ti :3000 2>/dev/null)
if [ -z "$PID" ]; then
    PID=$(ss -lptn 'sport = :3000' 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -n 1)
fi
if [ -z "$PID" ]; then
    PID=$(netstat -tulpn 2>/dev/null | grep :3000 | awk '{print $7}' | cut -d'/' -f1 | head -n 1)
fi

if [ -n "$PID" ]; then
    echo "[*] Terminating GeoVista process with PID: $PID on port 3000..."
    kill -9 $PID 2>/dev/null
    echo ""
    echo "======================================================================"
    echo -e "${GREEN}[OK] GeoVista application on port 3000 has been stopped successfully!${NC}"
    echo "======================================================================"
else
    echo "[INFO] No active GeoVista server found running on port 3000."
fi

echo ""
