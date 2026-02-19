#!/bin/bash
# =============================================================
# MSFG Calculator Lite — Start / Restart Both Brands
# Usage: bash deploy/start.sh
# =============================================================

set -e

echo "Starting MSFG Calculator Lite (both brands)..."

# ---- MSFG Brand (port 3003) ----
echo ""
echo "--- MSFG Brand (calc.msfginfo.com) ---"
cd ~/msfg-calc-lite-msfg

if [ ! -f .env ]; then
    echo "PORT=3003" > .env
    echo "NODE_ENV=production" >> .env
    echo "  Created .env"
fi

pm2 describe msfg-lite-msfg > /dev/null 2>&1 && {
    echo "  Restarting existing process..."
    pm2 restart msfg-lite-msfg
} || {
    echo "  Starting new process..."
    PM2_APP_NAME=msfg-lite-msfg PORT=3003 pm2 start ecosystem.config.js
}

# ---- Compass Brand (port 3002) ----
echo ""
echo "--- Compass Brand (compass.msfginfo.com) ---"
cd ~/msfg-calc-lite-compass

if [ ! -f .env ]; then
    echo "PORT=3002" > .env
    echo "NODE_ENV=production" >> .env
    echo "  Created .env"
fi

pm2 describe msfg-lite-compass > /dev/null 2>&1 && {
    echo "  Restarting existing process..."
    pm2 restart msfg-lite-compass
} || {
    echo "  Starting new process..."
    PM2_APP_NAME=msfg-lite-compass PORT=3002 pm2 start ecosystem.config.js
}

# Save PM2 process list (survives reboot)
pm2 save
pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

echo ""
echo "========================================="
echo "  Both brands running!"
echo ""
echo "  MSFG:    port 3003 → calc.msfginfo.com"
echo "  Compass: port 3002 → compass.msfginfo.com"
echo ""
echo "  Useful commands:"
echo "    pm2 status"
echo "    pm2 logs msfg-lite-msfg"
echo "    pm2 logs msfg-lite-compass"
echo "========================================="
