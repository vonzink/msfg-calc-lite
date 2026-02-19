'use strict';

/* =====================================================
   Form 1120S S-Corporation Income Calculator
   — AI upload, field sync, dual S-Corp calculation
   ===================================================== */

var fmt = MSFG.formatCurrency;
var pn  = MSFG.parseNumById;

// =====================================================
// DOCUMENT STORE — max 2 (one per tax year)
// =====================================================

var docStore = [];

// Track which S-Corp slot the AI data should fill
// Default: S-Corporation 1
var aiTargetCorp = 'c1';

// =====================================================
// UPLOAD ZONE
// =====================================================

function initUploadZone() {
  var zone = document.querySelector('.upload-zone');
  if (!zone) return;

  var fileInput = zone.querySelector('.upload-zone__input');
  var statusEl  = zone.querySelector('.upload-zone__status');

  zone.addEventListener('click', function (e) {
    if (e.target === fileInput || zone.classList.contains('processing')) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files.length > 0) {
      process1120sFile(fileInput.files[0], zone, statusEl);
    }
  });

  zone.addEventListener('dragover', function (e) {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', function () {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      process1120sFile(e.dataTransfer.files[0], zone, statusEl);
    }
  });
}

// =====================================================
// FILE PROCESSING
// =====================================================

function validateFile(file) {
  var allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
  return allowed.indexOf(file.type) !== -1;
}

function setZoneStatus(zone, statusEl, type, html) {
  statusEl.className = 'upload-zone__status';
  if (type === 'loading')  statusEl.className += ' status--loading';
  if (type === 'success')  statusEl.className += ' status--success';
  if (type === 'error')    statusEl.className += ' status--error';
  statusEl.innerHTML = html;
}

function process1120sFile(file, zone, statusEl) {
  if (!validateFile(file)) {
    setZoneStatus(zone, statusEl, 'error', 'Unsupported file type. Use PNG, JPG, WebP, or PDF.');
    zone.classList.add('has-error');
    return;
  }

  if (docStore.length >= 2) {
    setZoneStatus(zone, statusEl, 'error', 'Maximum 2 returns (one per year). Remove one first.');
    zone.classList.add('has-error');
    return;
  }

  setZoneStatus(zone, statusEl, 'loading', '<span class="spinner"></span> Analyzing 1120S...');
  zone.classList.add('processing');
  zone.classList.remove('has-error');

  var formData = new FormData();
  formData.append('file', file);
  formData.append('slug', 'income-1120s');

  var fileInput = zone.querySelector('.upload-zone__input');

  fetch('/api/ai/extract', { method: 'POST', body: formData })
    .then(function (resp) { return resp.json(); })
    .then(function (result) {
      zone.classList.remove('processing');

      if (!result.success || !result.data) {
        setZoneStatus(zone, statusEl, 'error', result.message || 'AI extraction failed.');
        zone.classList.add('has-error');
        return;
      }

      var data = result.data;
      data.id = 'doc_' + Date.now();

      // Replace if same tax year already uploaded
      docStore = docStore.filter(function (d) { return d.taxYear !== data.taxYear; });
      docStore.push(data);

      // Sort descending by taxYear (most recent first = Year 1)
      docStore.sort(function (a, b) { return (b.taxYear || 0) - (a.taxYear || 0); });

      renderDocCards();
      clearAiFields();
      syncFieldsFromDocs();
      calculate();

      var msg = docStore.length + ' return(s) loaded.';
      if (docStore.length < 2) msg += ' Upload another year for 2-year analysis.';
      setZoneStatus(zone, statusEl, 'success', msg);
      zone.classList.add('has-data');
      zone.classList.remove('has-error');

      if (fileInput) fileInput.value = '';
    })
    .catch(function (err) {
      zone.classList.remove('processing');
      setZoneStatus(zone, statusEl, 'error', 'Network error: ' + err.message);
      zone.classList.add('has-error');
    });
}

// =====================================================
// DOCUMENT CARDS
// =====================================================

function renderDocCards() {
  var container = document.getElementById('docCards');
  if (!container) return;
  container.innerHTML = '';

  if (docStore.length === 0) return;

  docStore.forEach(function (doc, i) {
    var card = document.createElement('div');
    card.className = 'doc-card';

    var yearLabel  = doc.taxYear || '?';
    var nameLabel  = doc.corporationName || '';
    var einLabel   = doc.ein || '';
    var totalLabel = (doc.totalIncome != null && doc.totalIncome !== 0) ? fmt(doc.totalIncome) : '--';
    var isYear1    = (i === 0);

    var html = '';
    html += '<div class="doc-card__header">';
    html += '<span class="doc-card__year">' + yearLabel + '</span>';
    if (nameLabel) html += '<span class="doc-card__name">' + escHtml(nameLabel) + '</span>';
    if (einLabel) html += '<span class="doc-card__filing">EIN: ' + escHtml(einLabel) + '</span>';
    html += '<button class="doc-card__remove" type="button" title="Remove" data-doc-id="' + doc.id + '">&times;</button>';
    html += '</div>';
    html += '<div class="doc-card__amounts">';
    html += '<span>Total Income (Line 6): ' + totalLabel + '</span>';
    if (docStore.length > 1) {
      if (isYear1) {
        html += '<span class="doc-card__badge">Year 1 (Most Recent)</span>';
      } else {
        html += '<span class="doc-card__badge doc-card__badge--secondary">Year 2 (Prior)</span>';
      }
    }
    html += '</div>';

    card.innerHTML = html;
    container.appendChild(card);
  });

  // Bind remove buttons
  container.querySelectorAll('.doc-card__remove').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      removeDoc(btn.getAttribute('data-doc-id'));
    });
  });
}

function removeDoc(docId) {
  docStore = docStore.filter(function (d) { return d.id !== docId; });
  renderDocCards();
  clearAiFields();
  if (docStore.length > 0) syncFieldsFromDocs();
  calculate();

  // Update upload zone
  var zone = document.querySelector('.upload-zone');
  var statusEl = zone ? zone.querySelector('.upload-zone__status') : null;
  if (zone && statusEl) {
    if (docStore.length === 0) {
      zone.classList.remove('has-data', 'has-error');
      setZoneStatus(zone, statusEl, '', '');
    } else {
      setZoneStatus(zone, statusEl, 'success', docStore.length + ' return(s) loaded.');
    }
  }
}

function escHtml(str) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// =====================================================
// FIELD MAPPING — AI → Form Fields
// =====================================================

/** AI fields map into S-Corp 1 (c1_) by default. */
var AI_FIELD_MAP = {
  netGainLoss:         'net',
  otherIncome:         'oth',
  depreciation:        'dep',
  depletion:           'depl',
  amortization:        'amort',
  mortgagesPayable:    'mort',
  mealsEntertainment:  'meals'
};

/** Clear only the fields that AI auto-fills (S-Corp 1 line items) */
function clearAiFields() {
  var prefix = aiTargetCorp;
  var fields = ['net', 'oth', 'dep', 'depl', 'amort', 'mort', 'meals'];
  fields.forEach(function (f) {
    var el1 = document.getElementById(prefix + '_' + f + '1');
    var el2 = document.getElementById(prefix + '_' + f + '2');
    if (el1) el1.value = '0';
    if (el2) el2.value = '0';
  });
}

/** Map docStore entries to form fields. Index 0 = most recent = Year 1. */
function syncFieldsFromDocs() {
  var prefix = aiTargetCorp;

  docStore.forEach(function (doc, i) {
    var ySuffix = (i === 0) ? '1' : '2'; // Year 1 = suffix 1, Year 2 = suffix 2

    Object.keys(AI_FIELD_MAP).forEach(function (aiKey) {
      var fieldBase = AI_FIELD_MAP[aiKey];
      var fieldId = prefix + '_' + fieldBase + ySuffix;
      setField(fieldId, doc[aiKey]);
    });
  });
}

function setField(id, value) {
  var el = document.getElementById(id);
  if (el && value != null) {
    el.value = value || 0;
  }
}

// =====================================================
// S-CORPORATION CALCULATION
// =====================================================

function computeCorp(prefix) {
  var net1   = pn(prefix + '_net1');
  var net2   = pn(prefix + '_net2');
  var oth1   = pn(prefix + '_oth1');
  var oth2   = pn(prefix + '_oth2');
  var dep1   = pn(prefix + '_dep1');
  var dep2   = pn(prefix + '_dep2');
  var depl1  = pn(prefix + '_depl1');
  var depl2  = pn(prefix + '_depl2');
  var amort1 = pn(prefix + '_amort1');
  var amort2 = pn(prefix + '_amort2');
  var mort1  = pn(prefix + '_mort1');
  var mort2  = pn(prefix + '_mort2');
  var meals1 = pn(prefix + '_meals1');
  var meals2 = pn(prefix + '_meals2');
  var own    = pn(prefix + '_owner') / 100;

  var year1 = net1 + oth1 + dep1 + depl1 + amort1 - mort1 - meals1;
  var year2 = net2 + oth2 + dep2 + depl2 + amort2 - mort2 - meals2;

  var year2Vals = [net2, oth2, dep2, depl2, amort2, mort2, meals2];
  var hasYr2 = year2Vals.some(function (v) { return v !== 0; });

  var monthly, method;
  if (hasYr2 && year1 > year2) {
    monthly = ((year1 + year2) / 24) * own;
    method = 'average';
  } else {
    monthly = (year1 / 12) * own;
    method = 'recent';
  }

  return {
    year1: year1, year2: year2,
    monthly: monthly, method: method,
    mort1: mort1, mort2: mort2,
    meals1: meals1, meals2: meals2,
    own: own * 100
  };
}

// =====================================================
// MAIN CALCULATION
// =====================================================

function calculate() {
  var c1 = computeCorp('c1');
  document.getElementById('c1_year1').textContent = fmt(c1.year1);
  document.getElementById('c1_year2').textContent = fmt(c1.year2);
  document.getElementById('c1_month').textContent = fmt(c1.monthly);
  document.getElementById('result_c1').textContent = fmt(c1.monthly);

  var c2 = computeCorp('c2');
  document.getElementById('c2_year1').textContent = fmt(c2.year1);
  document.getElementById('c2_year2').textContent = fmt(c2.year2);
  document.getElementById('c2_month').textContent = fmt(c2.monthly);
  document.getElementById('result_c2').textContent = fmt(c2.monthly);

  var combined = c1.monthly + c2.monthly;
  document.getElementById('combined1120s').textContent = fmt(combined);

  updateMathSteps(c1, c2, combined);
}

// =====================================================
// MATH STEPS
// =====================================================

function updateMathSteps(c1, c2, combined) {
  var stepsEl = document.getElementById('calcSteps-income-1120s');
  if (!stepsEl) return;

  var html = '';
  html += '<div class="math-steps">';

  // Formula reference
  html += '<div class="math-step">';
  html += '<h4>S-Corporation Income Formula</h4>';
  html += '<div class="math-formula">';
  html += '<span class="math-note">For each S-Corporation:</span>';
  html += '<div class="math-values">';
  html += 'Subtotal = Net Gain + Other + Depreciation + Depletion + Amortization<br>';
  html += 'Annual = Subtotal &minus; Mortgages &minus; Meals<br><br>';
  html += 'IF Year 2 provided AND Year 1 &gt; Year 2:<br>';
  html += '&nbsp;&nbsp;Monthly = ((Year 1 + Year 2) / 24) &times; Ownership %<br>';
  html += 'ELSE:<br>';
  html += '&nbsp;&nbsp;Monthly = (Year 1 / 12) &times; Ownership %';
  html += '</div></div></div>';

  // S-Corp 1
  html += buildCorpMathStep('S-Corporation 1', c1);

  // S-Corp 2 (only if has values)
  var c2HasData = c2.year1 !== 0 || c2.year2 !== 0;
  if (c2HasData) {
    html += buildCorpMathStep('S-Corporation 2', c2);
  }

  // Combined total
  html += '<div class="math-step highlight">';
  html += '<h4>Total Monthly Income</h4>';
  html += '<div class="math-formula">';
  html += 'S-Corp 1: ' + fmt(c1.monthly) + '<br>';
  if (c2HasData) {
    html += '+ S-Corp 2: ' + fmt(c2.monthly) + '<br>';
  }
  html += '<div class="math-values"><strong>Total Monthly: ' + fmt(combined) + '</strong></div>';
  html += '</div></div>';

  html += '</div>'; // close .math-steps
  stepsEl.innerHTML = html;
}

function buildCorpMathStep(label, c) {
  var methodLabel = c.method === 'average'
    ? '24-month average (Year 1 > Year 2)'
    : 'Year 1 / 12';

  var sub1 = c.year1 + c.mort1 + c.meals1; // subtotal before subtractions
  var sub2 = c.year2 + c.mort2 + c.meals2;

  var html = '';
  html += '<div class="math-step">';
  html += '<h4>' + label + ' Calculation</h4>';
  html += '<div class="math-formula">';
  html += 'Subtotal Year 1: ' + fmt(sub1) + '<br>';
  html += 'Subtotal Year 2: ' + fmt(sub2) + '<br>';
  html += 'Less Mortgages: ' + fmt(c.mort1) + ' / ' + fmt(c.mort2) + '<br>';
  html += 'Less Meals: ' + fmt(c.meals1) + ' / ' + fmt(c.meals2) + '<br>';
  html += 'Ownership: ' + c.own + '%<br>';
  html += '<div class="math-values">';
  html += 'Year 1 = ' + fmt(sub1) + ' &minus; ' + fmt(c.mort1) + ' &minus; ' + fmt(c.meals1) + ' = ' + fmt(c.year1) + '<br>';
  html += 'Year 2 = ' + fmt(sub2) + ' &minus; ' + fmt(c.mort2) + ' &minus; ' + fmt(c.meals2) + ' = ' + fmt(c.year2) + '<br>';
  html += 'Method: ' + methodLabel + '<br>';
  html += '<strong>Monthly: ' + fmt(c.monthly) + '</strong>';
  html += '</div></div></div>';
  return html;
}

// =====================================================
// EXPORT CSV
// =====================================================

function exportCSV() {
  var c1 = computeCorp('c1');
  var c2 = computeCorp('c2');
  var combined = c1.monthly + c2.monthly;

  var rows = [
    ['Form 1120S S-Corporation Income Calculator'],
    [''],
    ['Corporation', 'Year 1 Income', 'Year 2 Income', 'Ownership %', 'Monthly Income'],
    ['S-Corp 1', c1.year1, c1.year2, c1.own, c1.monthly],
    ['S-Corp 2', c2.year1, c2.year2, c2.own, c2.monthly],
    [''],
    ['Total Monthly Income', '', '', '', combined],
    [''],
    ['Generated', new Date().toLocaleString()]
  ];

  var csv = rows.map(function (row) {
    return row.map(function (cell) { return '"' + cell + '"'; }).join(',');
  }).join('\n');

  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'form1120s-income-' + Date.now() + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// =====================================================
// CLEAR ALL
// =====================================================

function clearAll() {
  // Reset document store
  docStore = [];
  renderDocCards();

  // Reset all number inputs (ownership % → 100, everything else → 0)
  var inputs = document.querySelectorAll('input[type="number"]');
  inputs.forEach(function (input) {
    input.value = input.id.indexOf('owner') !== -1 ? '100' : '0';
  });

  // Reset upload zone
  var zone = document.querySelector('.upload-zone');
  if (zone) {
    zone.classList.remove('has-data', 'has-error');
    var statusEl = zone.querySelector('.upload-zone__status');
    if (statusEl) {
      statusEl.className = 'upload-zone__status';
      statusEl.innerHTML = '';
    }
    var fileInput = zone.querySelector('.upload-zone__input');
    if (fileInput) fileInput.value = '';
  }

  calculate();
}

// =====================================================
// INITIALIZATION
// =====================================================

document.addEventListener('DOMContentLoaded', function () {
  initUploadZone();
  calculate();
});
