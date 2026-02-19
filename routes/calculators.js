const express = require('express');
const router = express.Router();

const calcConfig = require('../config/calculators.json');

function findCalc(slug) {
  return calcConfig.calculators.find(c => c.slug === slug);
}

/* ---- General Calculators ---- */

const generalCalcs = [
  { slug: 'apr',             view: 'calculators/apr',             title: 'APR Calculator',                css: 'apr' },
  { slug: 'blended-rate',    view: 'calculators/blended-rate',    title: 'Blended Rate Calculator' },
  { slug: 'buydown',         view: 'calculators/buydown',         title: 'Buydown Calculator' },
  { slug: 'buy-vs-rent',     view: 'calculators/buy-vs-rent',     title: 'Buy vs Rent Calculator' },
  { slug: 'cash-vs-mortgage', view: 'calculators/cash-vs-mortgage', title: 'Cash vs Mortgage Comparison' },
  {
    slug: 'refi',
    view: 'calculators/refi',
    title: 'Refinance Analysis Tool',
    cdnScripts: [
      '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>',
      '<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" integrity="sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk" crossorigin="anonymous"></script>'
    ]
  },
  { slug: 'reo',             view: 'calculators/reo',             title: 'REO Investment ROI' },
  {
    slug: 'amortization',
    view: 'calculators/amortization',
    title: 'Amortization Calculator',
    css: 'amortization',
    cdnScripts: [
      '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>'
    ]
  }
];

generalCalcs.forEach(gc => {
  router.get(`/${gc.slug}`, (req, res) => {
    const ver = res.locals.v;
    const extraHeadParts = [];
    if (gc.css) extraHeadParts.push(`<link rel="stylesheet" href="/css/calculators/${gc.css}.css?v=${ver}">`);
    if (gc.cdnScripts) extraHeadParts.push(...gc.cdnScripts);

    res.render(gc.view, {
      title: gc.title,
      calc: findCalc(gc.slug),
      extraHead: extraHeadParts.length ? extraHeadParts.join('') : undefined,
      extraScripts: `<script src="/js/calculators/${gc.slug}.js?v=${ver}"></script>`
    });
  });
});

module.exports = router;
