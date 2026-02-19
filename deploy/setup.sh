#!/bin/bash
# =============================================================
# MSFG Calculator Lite — EC2 Setup (adds to existing server)
# Run this ONCE on the EC2 instance that already runs msfg-calc.
# Usage: bash deploy/setup.sh
# =============================================================

set -e

echo "========================================="
echo "  MSFG Calculator Lite — Server Setup"
echo "========================================="

# Node.js, PM2, and nginx are already installed from main msfg-calc.
# This script just adds the lite nginx config and installs deps.

# Configure nginx — add lite server blocks alongside existing config
echo "[1/3] Configuring nginx for lite sites..."
sudo cp deploy/nginx.conf /etc/nginx/sites-available/msfg-calc-lite
sudo ln -sf /etc/nginx/sites-available/msfg-calc-lite /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Install dependencies for MSFG brand
echo "[2/3] Installing MSFG brand dependencies..."
cd ~/msfg-calc-lite-msfg
npm ci --production

# Install dependencies for Compass brand
echo "[3/3] Installing Compass brand dependencies..."
cd ~/msfg-calc-lite-compass
npm ci --production

# Swap Compass config
cp config/site-compass.json config/site.json
echo "  Swapped site-compass.json → site.json for Compass deploy"

echo ""
echo "========================================="
echo "  Setup complete! Now run:"
echo "  bash deploy/start.sh"
echo "========================================="
