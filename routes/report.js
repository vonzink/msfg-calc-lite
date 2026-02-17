const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('report', {
    title: 'Session Report',
    extraHead: '<link rel="stylesheet" href="/css/report.css">',
    extraScripts: ''
  });
});

module.exports = router;
