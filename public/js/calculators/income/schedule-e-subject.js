'use strict';

/* =====================================================
   Schedule E Subject Property Calculator
   — AI upload, field sync, single property (no payment subtraction)
   ===================================================== */

var fmt = MSFG.formatCurrency;
var pn  = MSFG.parseNumById;

// =====================================================
// DOCUMENT STORE — max 2 (one per tax year)
// =====================================================

var docStore = [];

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
      processFile(fileInput.files[0], zone, statusEl);
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
      processFile(e.dataTransfer.files[0], zone, statusEl);
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

function processFile(file, zone, statusEl) {
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

  setZoneStatus(zone, statusEl, 'loading', '<span class="spinner"></span> Analyzing Schedule E...');
  zone.classList.add('processing');
  zone.classList.remove('has-error');

  var formData = new FormData();
  formData.append('file', file);
  formData.append('slug', 'income-schedule-e-subject');

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
    var nameLabel  = doc.propertyAddress || '';
    var rentsLabel = (doc.rentsReceived != null && doc.rentsReceived !== 0) ? fmt(doc.rentsReceived) : '--';
    var isYear1    = (i === 0);

    var html = '';
    html += '<div class="doc-card__header">';
    html += '<span class="doc-card__year">' + yearLabel + '</span>';
    if (nameLabel) html += '<span class="doc-card__name">' + escHtml(nameLabel) + '</span>';
    html += '<button class="doc-card__remove" type="button" title="Remove" data-doc-id="' + doc.id + '">&times;</button>';
    html += '</div>';
    html += '<div class="doc-card__amounts">';
    html += '<span>Rents Received (Line 3): ' + rentsLabel + '</span>';
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

var AI_FIELD_MAP = {
  rentsReceived:   'rents',
  royaltiesReceived: 'roy',
  amortization:    'cas',
  totalExpenses:   'exp',
  depreciation:    'dep',
  insurance:       'ins',
  mortgageInterest: 'int',
  taxes:           'tax'
};

/** Clear only the fields that AI auto-fills */
function clearAiFields() {
  var fields = ['rents', 'roy', 'cas', 'exp', 'dep', 'ins', 'int', 'tax'];
  fields.forEach(function (f) {
    var el1 = document.getElementById('sr1_' + f);
    var el2 = document.getElementById('sr2_' + f);
    if (el1) el1.value = '0';
    if (el2) el2.value = '0';
  });
}

/** Map docStore entries to form fields. Index 0 = most recent = Year 1. */
function syncFieldsFromDocs() {
  docStore.forEach(function (doc, i) {
    var prefix = (i === 0) ? 'sr1_' : 'sr2_';

    Object.keys(AI_FIELD_MAP).forEach(function (aiKey) {
      var fieldBase = AI_FIELD_MAP[aiKey];
      var fieldId = prefix + fieldBase;
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
// CALCULATION
// =====================================================

function computeYear(yr) {
  var rents = pn('sr' + yr + '_rents');
  var roy   = pn('sr' + yr + '_roy');
  var cas   = pn('sr' + yr + '_cas');
  var exp   = pn('sr' + yr + '_exp');
  var dep   = pn('sr' + yr + '_dep');
  var ins   = pn('sr' + yr + '_ins');
  var int_  = pn('sr' + yr + '_int');
  var tax   = pn('sr' + yr + '_tax');

  var total = rents + roy + cas + dep + ins + int_ + tax - exp;

  return {
    rents: rents, roy: roy, cas: cas, exp: exp,
    dep: dep, ins: ins, int: int_, tax: tax,
    total: total
  };
}

function calculate() {
  var y1 = computeYear('1');
  var y2 = computeYear('2');

  // Check if Year 2 has any data
  var yr2Vals = [y2.rents, y2.roy, y2.cas, y2.exp, y2.dep, y2.ins, y2.int, y2.tax];
  var hasYr2 = yr2Vals.some(function (v) { return v !== 0; });

  var monthly, method;
  if (hasYr2 && y1.total > y2.total) {
    monthly = (y1.total + y2.total) / 24;
    method = 'average';
  } else {
    monthly = y1.total / 12;
    method = 'recent';
  }

  document.getElementById('sr_total1').textContent = fmt(y1.total);
  document.getElementById('sr_total2').textContent = fmt(y2.total);
  document.getElementById('sr_avg').textContent = fmt(monthly);

  updateMathSteps({ y1: y1, y2: y2, hasYr2: hasYr2, monthly: monthly, method: method });
}

// =====================================================
// MATH STEPS
// =====================================================

function updateMathSteps(data) {
  var stepsEl = document.getElementById('calcSteps-income-schedule-e-subject');
  if (!stepsEl) return;

  var html = '';
  html += '<div class="math-steps">';

  // Formula reference
  html += '<div class="math-step">';
  html += '<h4>Subject Property Income Formula</h4>';
  html += '<div class="math-formula">';
  html += '<span class="math-note">Schedule E subject property (no payment subtraction):</span>';
  html += '<div class="math-values">';
  html += 'Annual = Rents + Royalties + Amort/Casualty + Depreciation + Insurance + Mortgage Interest + Taxes &minus; Total Expenses<br><br>';
  html += 'IF Year 2 provided AND Year 1 &gt; Year 2:<br>';
  html += '&nbsp;&nbsp;Monthly = (Year 1 + Year 2) / 24<br>';
  html += 'ELSE:<br>';
  html += '&nbsp;&nbsp;Monthly = Year 1 / 12';
  html += '</div></div></div>';

  // Year 1 breakdown
  html += '<div class="math-step">';
  html += '<h4>Year 1 Calculation</h4>';
  html += '<div class="math-formula">';
  html += 'Rents Received: ' + fmt(data.y1.rents) + '<br>';
  html += '+ Royalties: ' + fmt(data.y1.roy) + '<br>';
  html += '+ Amort/Casualty: ' + fmt(data.y1.cas) + '<br>';
  html += '+ Depreciation: ' + fmt(data.y1.dep) + '<br>';
  html += '+ Insurance: ' + fmt(data.y1.ins) + '<br>';
  html += '+ Mortgage Interest: ' + fmt(data.y1.int) + '<br>';
  html += '+ Taxes: ' + fmt(data.y1.tax) + '<br>';
  html += '&minus; Total Expenses: ' + fmt(data.y1.exp) + '<br>';
  html += '<div class="math-values"><strong>Year 1 Total = ' + fmt(data.y1.total) + '</strong></div>';
  html += '</div></div>';

  // Year 2 breakdown (if data exists)
  if (data.hasYr2) {
    html += '<div class="math-step">';
    html += '<h4>Year 2 Calculation</h4>';
    html += '<div class="math-formula">';
    html += 'Rents Received: ' + fmt(data.y2.rents) + '<br>';
    html += '+ Royalties: ' + fmt(data.y2.roy) + '<br>';
    html += '+ Amort/Casualty: ' + fmt(data.y2.cas) + '<br>';
    html += '+ Depreciation: ' + fmt(data.y2.dep) + '<br>';
    html += '+ Insurance: ' + fmt(data.y2.ins) + '<br>';
    html += '+ Mortgage Interest: ' + fmt(data.y2.int) + '<br>';
    html += '+ Taxes: ' + fmt(data.y2.tax) + '<br>';
    html += '&minus; Total Expenses: ' + fmt(data.y2.exp) + '<br>';
    html += '<div class="math-values"><strong>Year 2 Total = ' + fmt(data.y2.total) + '</strong></div>';
    html += '</div></div>';
  }

  // Monthly result
  var methodLabel = data.method === 'average'
    ? '24-month average (Year 1 > Year 2)'
    : 'Year 1 / 12';

  html += '<div class="math-step highlight">';
  html += '<h4>Monthly Average</h4>';
  html += '<div class="math-formula">';
  html += 'Method: ' + methodLabel + '<br>';
  if (data.method === 'average') {
    html += '(' + fmt(data.y1.total) + ' + ' + fmt(data.y2.total) + ') / 24<br>';
  } else {
    html += fmt(data.y1.total) + ' / 12<br>';
  }
  html += '<div class="math-values"><strong>Monthly Average: ' + fmt(data.monthly) + '</strong></div>';
  html += '</div></div>';

  html += '</div>'; // close .math-steps
  stepsEl.innerHTML = html;
}

// =====================================================
// EXPORT CSV
// =====================================================

function exportCSV() {
  var y1 = computeYear('1');
  var y2 = computeYear('2');

  var yr2Vals = [y2.rents, y2.roy, y2.cas, y2.exp, y2.dep, y2.ins, y2.int, y2.tax];
  var hasYr2 = yr2Vals.some(function (v) { return v !== 0; });

  var monthly;
  if (hasYr2 && y1.total > y2.total) {
    monthly = (y1.total + y2.total) / 24;
  } else {
    monthly = y1.total / 12;
  }

  var rows = [
    ['Schedule E Subject Property Calculator'],
    [''],
    ['Line Item', 'Year 1', 'Year 2'],
    ['Rents Received (Ln 3)', y1.rents, y2.rents],
    ['Royalties Received (Ln 4)', y1.roy, y2.roy],
    ['Amortization/Casualty Loss (Ln 19)', y1.cas, y2.cas],
    ['Total Expenses (Ln 20)', y1.exp, y2.exp],
    ['Depreciation (Ln 18)', y1.dep, y2.dep],
    ['Insurance (Ln 9)', y1.ins, y2.ins],
    ['Mortgage Interest (Ln 12)', y1.int, y2.int],
    ['Taxes (Ln 16)', y1.tax, y2.tax],
    [''],
    ['Year 1 Total', y1.total, ''],
    ['Year 2 Total', '', y2.total],
    ['Monthly Average', monthly, ''],
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
  a.download = 'schedule-e-subject-' + Date.now() + '.csv';
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

  // Reset all number inputs to 0
  var inputs = document.querySelectorAll('input[type="number"]');
  inputs.forEach(function (input) {
    input.value = '0';
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
