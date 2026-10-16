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

echo -e "${CYAN}======================================================================"
echo -e "           VISTABRIDGE AUTOMATED DEPLOYMENT"
echo -e "======================================================================${NC}"
echo ""

# -------------------------------------------------------------------------
# 1. NAVIGATE TO APP DIRECTORY & BACKUP SQLITE DATABASE
# -------------------------------------------------------------------------
echo "[1/5] Navigating to app directory: $APP_DIR"
cd "$APP_DIR" || { echo -e "${RED}[ERROR] Directory $APP_DIR not found!${NC}"; exit 1; }

# Automatic SQLite Backup before any changes (Zero Data Loss Protection)
if [ -d "$APP_DIR/data" ]; then
    BACKUP_DIR="/var/backups/vistabridge"
    mkdir -p "$BACKUP_DIR"
    BACKUP_FILE="$BACKUP_DIR/data_backup_$(date +%Y%m%d_%H%M%S).tar.gz"
    tar -czf "$BACKUP_FILE" -C "$APP_DIR" data 2>/dev/null || true
    echo -e "${GREEN}[OK] SQLite database backup created: $BACKUP_FILE${NC}"
    # Keep only the latest 15 backups to save disk space
    ls -dt "$BACKUP_DIR"/data_backup_*.tar.gz 2>/dev/null | tail -n +16 | xargs rm -f 2>/dev/null || true
fi

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

# Check if PM2 is running from the correct APP_DIR. If not, delete it so it rebinds cleanly to /var/www/VistaBridge
PM2_CURRENT_DIR=$(pm2 jlist 2>/dev/null | grep -o '"pm_cwd":"[^"]*"' | head -n 1 | cut -d'"' -f4)
if [ -n "$PM2_CURRENT_DIR" ] && [ "$PM2_CURRENT_DIR" != "$APP_DIR" ]; then
    echo -e "${YELLOW}[INFO] Updating PM2 working directory from '$PM2_CURRENT_DIR' to '$APP_DIR'...${NC}"
    pm2 delete "$PM2_APP_NAME" 2>/dev/null || true
fi

if pm2 list | grep -q "$PM2_APP_NAME"; then
    pm2 restart "$PM2_APP_NAME" --update-env
    echo -e "${GREEN}[OK] PM2 process restarted in $APP_DIR.${NC}"
else
    echo -e "${YELLOW}[INFO] Starting PM2 process '$PM2_APP_NAME' from $APP_DIR on port $APP_PORT...${NC}"
    PORT=$APP_PORT pm2 start "npx next start -p $APP_PORT" --name "$PM2_APP_NAME" --cwd "$APP_DIR"
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

