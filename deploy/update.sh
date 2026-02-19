#!/bin/bash
# =============================================================
# MSFG Calculator Lite — Pull & Deploy Update (Both Brands)
# Usage: bash deploy/update.sh
# =============================================================

set -e

echo "Deploying update to both brands..."

# ---- MSFG Brand ----
echo ""
echo "--- MSFG Brand ---"
cd ~/msfg-calc-lite-msfg
echo "[1/3] Pulling latest..."
git pull origin main
echo "[2/3] Installing dependencies..."
npm ci --production
echo "[3/3] Restarting..."
pm2 restart msfg-lite-msfg

# ---- Compass Brand ----
echo ""
echo "--- Compass Brand ---"
cd ~/msfg-calc-lite-compass
echo "[1/3] Pulling latest..."
git pull origin main
echo "[2/3] Installing dependencies..."
npm ci --production
# Re-apply Compass config (git pull may overwrite site.json)
cp config/site-compass.json config/site.json
echo "[3/3] Restarting..."
pm2 restart msfg-lite-compass

echo ""
echo "========================================="
echo "  Deploy complete!"
echo "  Port map: MSFG=3003, Compass=3002"
echo "  pm2 logs msfg-lite-msfg     — MSFG logs"
echo "  pm2 logs msfg-lite-compass  — Compass logs"
echo "========================================="
