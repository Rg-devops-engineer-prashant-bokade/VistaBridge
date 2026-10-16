#!/usr/bin/env bash
# =============================================================================
# VistaBridge Production Deployment Script
# Called by GitHub Actions CI/CD pipeline after all tests pass
# =============================================================================

set -e  # Exit immediately on any error

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

APP_DIR="/var/www/VistaBridge"
PM2_APP_NAME="vistabridge"
APP_PORT=3007

# Auto-detect folder fallback if default path doesn't exist
if [ ! -d "$APP_DIR" ]; then
    if [ -d "/var/www/vistabridge/geovista/urban-vista-development" ]; then
        APP_DIR="/var/www/vistabridge/geovista/urban-vista-development"
    elif [ -d "/var/www/geovista/urban-vista-development" ]; then
        APP_DIR="/var/www/geovista/urban-vista-development"
    fi
fi

echo -e "${CYAN}======================================================================"
echo -e "           VISTABRIDGE AUTOMATED DEPLOYMENT"
echo -e "======================================================================${NC}"
echo ""

# -------------------------------------------------------------------------
# 1. NAVIGATE TO APP DIRECTORY
# -------------------------------------------------------------------------
echo "[1/5] Navigating to app directory: $APP_DIR"
cd "$APP_DIR" || { echo -e "${RED}[ERROR] Directory $APP_DIR not found!${NC}"; exit 1; }

# -------------------------------------------------------------------------
# 2. PULL LATEST CODE
# -------------------------------------------------------------------------
echo ""
echo "[2/5] Pulling latest code from GitHub..."
GIT_REMOTE="origin"
if ! git remote | grep -q "^origin$"; then
    GIT_REMOTE=$(git remote | head -n 1)
fi
git fetch "$GIT_REMOTE" main
git reset --hard "$GIT_REMOTE/main"
echo -e "${GREEN}[OK] Code updated from $GIT_REMOTE/main.${NC}"

# -------------------------------------------------------------------------
# 3. INSTALL DEPENDENCIES
# -------------------------------------------------------------------------
echo ""
echo "[3/5] Installing dependencies..."
npm ci --legacy-peer-deps || npm install --legacy-peer-deps
echo -e "${GREEN}[OK] Dependencies installed.${NC}"

# -------------------------------------------------------------------------
# 4. BUILD PRODUCTION
# -------------------------------------------------------------------------
echo ""
echo "[4/5] Building production bundle..."
npm run build
echo -e "${GREEN}[OK] Build complete.${NC}"

# -------------------------------------------------------------------------
# 5. RESTART PM2 PROCESS
# -------------------------------------------------------------------------
echo ""
echo "[5/5] Restarting PM2 process: $PM2_APP_NAME"

if pm2 list | grep -q "$PM2_APP_NAME"; then
    pm2 restart "$PM2_APP_NAME" --update-env
    echo -e "${GREEN}[OK] PM2 process restarted.${NC}"
else
    echo -e "${YELLOW}[WARN] PM2 process '$PM2_APP_NAME' not found. Starting fresh...${NC}"
    PORT=$APP_PORT pm2 start "npx next start -p $APP_PORT" --name "$PM2_APP_NAME"
    pm2 save
    echo -e "${GREEN}[OK] PM2 process started on port $APP_PORT.${NC}"
fi

# -------------------------------------------------------------------------
# DONE
# -------------------------------------------------------------------------
echo ""
echo -e "${GREEN}======================================================================"
echo -e "           DEPLOYMENT COMPLETED SUCCESSFULLY!"
echo -e "======================================================================${NC}"
echo "  App:  https://vistabridge.rottengrapes.tech"
echo "  Port: $APP_PORT"
echo "  Time: $(date)"
echo ""

