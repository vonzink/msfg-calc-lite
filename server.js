require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');

const fs = require('fs');
const { execSync } = require('child_process');

// Asset version — computed once at startup for cache-busting.
// Uses short git hash so deploys automatically bust CloudFront cache.
let ASSET_VERSION;
try {
  ASSET_VERSION = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch (e) {
  ASSET_VERSION = Date.now().toString(36);
}

// Calculator config is static — loaded once at startup
const calcConfig = require('./config/calculators.json');

// Site config — read fresh each request so branding changes take effect immediately
const siteConfigPath = path.join(__dirname, 'config', 'site.json');
function getSiteConfig() {
  try {
    return JSON.parse(fs.readFileSync(siteConfigPath, 'utf-8'));
  } catch (err) {
    console.error('Failed to read site config:', err);
    return { siteName: 'MSFG', companyName: 'MSFG', favicon: '', logo: {} };
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com"
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://msfg-media.s3.us-west-2.amazonaws.com"],
      frameSrc: ["'self'"],
      connectSrc: ["'self'", "https://cdnjs.cloudflare.com"]
    }
  },
  // Allow iframes from same origin (workspace uses them)
  frameguard: { action: 'sameorigin' }
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Make config available to all templates
app.use((req, res, next) => {
  res.locals.site = getSiteConfig();
  res.locals.calculators = calcConfig.calculators;
  res.locals.categories = calcConfig.categories;
  res.locals.currentPath = req.path;
  res.locals.v = ASSET_VERSION;
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/', require('./routes/index'));
app.use('/calculators', require('./routes/calculators'));
app.use('/workspace', require('./routes/workspace'));
app.use('/report', require('./routes/report'));

// Serve legacy calculator files (iframe stubs)
app.use('/legacy/gen-calc', express.static(path.join(__dirname, 'gen-calc')));
app.use('/legacy/buydown-calc', express.static(path.join(__dirname, 'buydown-calc')));
app.use('/legacy/refi-calc', express.static(path.join(__dirname, 'refi-calc')));
app.use('/legacy/calc-reo', express.static(path.join(__dirname, 'calc-reo')));

// Legacy shared CSS (referenced by iframe calculators as /css/main.css)
app.use('/css', express.static(path.join(__dirname, 'css')));

// 404 handler
app.use((req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

// Global error handler — prevents stack traces from leaking to clients
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).render('404', {
    title: 'Something went wrong'
  });
});

// Start server when run directly; export app for testing
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MSFG Calculator Lite running at http://localhost:${PORT}`);
  });
}

module.exports = app;
