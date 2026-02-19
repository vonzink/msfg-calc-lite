// PM2 Process Manager Configuration — MSFG Calculator Lite
//
// Two-brand setup: deploy this repo twice on the same EC2 instance.
//   - MSFG brand:    ~/msfg-calc-lite-msfg    → port 3003
//   - Compass brand: ~/msfg-calc-lite-compass  → port 3002
// NOTE: port 3001 is used by Keyword Explorer — do not reuse
//
// The BRAND env var selects the name; PORT is set per deploy.
// Override at start: PM2_APP_NAME=msfg-lite-compass PORT=3002 pm2 start ecosystem.config.js

module.exports = {
  apps: [{
    name: process.env.PM2_APP_NAME || 'msfg-lite-msfg',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || 3003
    }
  }]
};
