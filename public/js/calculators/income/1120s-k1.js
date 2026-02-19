'use strict';

/* =====================================================
   1120S K-1 Income Calculator
   — AI upload, field sync, 4 K-1 entity calculation
   ===================================================== */

var fmt = MSFG.formatCurrency;
var pn  = MSFG.parseNumById;

// =====================================================
// DOCUMENT STORE — max 2 (one per tax year)
// =====================================================

var docStore = [];
var K1_COUNT = 4;

// Track which K-1 slot the AI data should fill
// Default: K-1 #1
var aiTargetK1 = 1;

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
      processK1File(fileInput.files[0], zone, statusEl);
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
      processK1File(e.dataTransfer.files[0], zone, statusEl);
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

function processK1File(file, zone, statusEl) {
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

  setZoneStatus(zone, statusEl, 'loading', '<span class="spinner"></span> Analyzing K-1 (1120S)...');
  zone.classList.add('processing');
  zone.classList.remove('has-error');

  var formData = new FormData();
  formData.append('file', file);
  formData.append('slug', 'income-1120s-k1');

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
    var nameLabel  = doc.corporationName || doc.entityName || '';
    var einLabel   = doc.ein || '';
    var isYear1    = (i === 0);

    var html = '';
    html += '<div class="doc-card__header">';
    html += '<span class="doc-card__year">' + yearLabel + '</span>';
    if (nameLabel) html += '<span class="doc-card__name">' + escHtml(nameLabel) + '</span>';
    if (einLabel) html += '<span class="doc-card__filing">EIN: ' + escHtml(einLabel) + '</span>';
    html += '<button class="doc-card__remove" type="button" title="Remove" data-doc-id="' + doc.id + '">&times;</button>';
    html += '</div>';
    html += '<div class="doc-card__amounts">';
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

/** AI fields map into K-1 slot (k{aiTargetK1}_) by default. */
var AI_FIELD_MAP = {
  ordinaryIncome:     '_ord',
  rentalRealEstate:   '_rent',
  otherRentalIncome:  '_other'
};

/** Clear only the fields that AI auto-fills for the target K-1 */
function clearAiFields() {
  var prefix = 'k' + aiTargetK1;
  var fields = ['ord', 'rent', 'other'];
  fields.forEach(function (f) {
    var el1 = document.getElementById(prefix + '_' + f + '1');
    var el2 = document.getElementById(prefix + '_' + f + '2');
    if (el1) el1.value = '0';
    if (el2) el2.value = '0';
  });
}

/** Map docStore entries to form fields. Index 0 = most recent = Year 1. */
function syncFieldsFromDocs() {
  var prefix = 'k' + aiTargetK1;

  docStore.forEach(function (doc, i) {
    var ySuffix = (i === 0) ? '1' : '2'; // Year 1 = suffix 1, Year 2 = suffix 2

    Object.keys(AI_FIELD_MAP).forEach(function (aiKey) {
      var fieldSuffix = AI_FIELD_MAP[aiKey];
      var fieldId = prefix + fieldSuffix + ySuffix;
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
// K-1 ENTITY CALCULATION
// =====================================================

function computeK1(num) {
  var p = 'k' + num;

  var ord1   = pn(p + '_ord1');
  var ord2   = pn(p + '_ord2');
  var rent1  = pn(p + '_rent1');
  var rent2  = pn(p + '_rent2');
  var other1 = pn(p + '_other1');
  var other2 = pn(p + '_other2');

  var year1 = ord1 + rent1 + other1;
  var year2 = ord2 + rent2 + other2;

  var year2Vals = [ord2, rent2, other2];
  var hasYr2 = year2Vals.some(function (v) { return v !== 0; });

  var monthly, method;
  if (hasYr2 && year1 > year2) {
    monthly = (year1 + year2) / 24;
    method = 'average';
  } else {
    monthly = year1 / 12;
    method = 'recent';
  }

  return {
    year1: year1, year2: year2,
    monthly: monthly, method: method,
    ord1: ord1, ord2: ord2,
    rent1: rent1, rent2: rent2,
    other1: other1, other2: other2
  };
}

// =====================================================
// MAIN CALCULATION
// =====================================================

function calculate() {
  var results = [];
  var combined = 0;

  for (var i = 1; i <= K1_COUNT; i++) {
    var k = computeK1(i);
    results.push(k);

    document.getElementById('k' + i + '_yr1').textContent = fmt(k.year1);
    document.getElementById('k' + i + '_yr2').textContent = fmt(k.year2);
    document.getElementById('k' + i + '_month').textContent = fmt(k.monthly);
    document.getElementById('resultK' + i).textContent = fmt(k.monthly);

    combined += k.monthly;
  }

  document.getElementById('combinedK1').textContent = fmt(combined);

  updateMathSteps(results, combined);
}

// =====================================================
// MATH STEPS
// =====================================================

function updateMathSteps(results, combined) {
  var stepsEl = document.getElementById('calcSteps-income-1120s-k1');
  if (!stepsEl) return;

  var html = '';
  html += '<div class="math-steps">';

  // Formula reference
  html += '<div class="math-step">';
  html += '<h4>1120S K-1 Income Formula</h4>';
  html += '<div class="math-formula">';
  html += '<span class="math-note">For each K-1 entity:</span>';
  html += '<div class="math-values">';
  html += 'Annual = Ordinary Income + Rental RE Income + Other Rental Income<br><br>';
  html += 'IF Year 2 provided AND Year 1 &gt; Year 2:<br>';
  html += '&nbsp;&nbsp;Monthly = (Year 1 + Year 2) / 24<br>';
  html += 'ELSE:<br>';
  html += '&nbsp;&nbsp;Monthly = Year 1 / 12';
  html += '</div></div></div>';

  // Per-entity steps
  for (var i = 0; i < K1_COUNT; i++) {
    var d = results[i];
    var hasData = d.year1 !== 0 || d.year2 !== 0;
    if (hasData) {
      html += buildK1MathStep(i + 1, d);
    }
  }

  // Combined total
  html += '<div class="math-step highlight">';
  html += '<h4>Total Monthly K-1 Income</h4>';
  html += '<div class="math-formula">';
  for (var j = 0; j < K1_COUNT; j++) {
    var r = results[j];
    var hasVal = r.year1 !== 0 || r.year2 !== 0;
    if (hasVal) {
      html += (j > 0 ? '+ ' : '') + 'K-1 #' + (j + 1) + ': ' + fmt(r.monthly) + '<br>';
    }
  }
  html += '<div class="math-values"><strong>Total Monthly: ' + fmt(combined) + '</strong></div>';
  html += '</div></div>';

  html += '</div>'; // close .math-steps
  stepsEl.innerHTML = html;
}

function buildK1MathStep(num, d) {
  var methodLabel = d.method === 'average'
    ? '24-month average (Year 1 > Year 2)'
    : 'Year 1 / 12';

  var html = '';
  html += '<div class="math-step">';
  html += '<h4>K-1 #' + num + ' Calculation</h4>';
  html += '<div class="math-formula">';
  html += 'Ordinary Income: ' + fmt(d.ord1) + ' / ' + fmt(d.ord2) + '<br>';
  html += 'Rental RE Income: ' + fmt(d.rent1) + ' / ' + fmt(d.rent2) + '<br>';
  html += 'Other Rental: ' + fmt(d.other1) + ' / ' + fmt(d.other2) + '<br>';
  html += '<div class="math-values">';
  html += 'Year 1 = ' + fmt(d.ord1) + ' + ' + fmt(d.rent1) + ' + ' + fmt(d.other1) + ' = ' + fmt(d.year1) + '<br>';
  html += 'Year 2 = ' + fmt(d.ord2) + ' + ' + fmt(d.rent2) + ' + ' + fmt(d.other2) + ' = ' + fmt(d.year2) + '<br>';
  html += 'Method: ' + methodLabel + '<br>';
  html += '<strong>Monthly: ' + fmt(d.monthly) + '</strong>';
  html += '</div></div></div>';
  return html;
}

// =====================================================
// EXPORT CSV
// =====================================================

function exportCSV() {
  var rows = [
    ['1120S K-1 Income Calculator'],
    [''],
    ['K-1 Entity', 'Year 1 Income', 'Year 2 Income', 'Monthly Income']
  ];

  var combined = 0;
  for (var i = 1; i <= K1_COUNT; i++) {
    var k = computeK1(i);
    rows.push(['K-1 #' + i, k.year1, k.year2, k.monthly]);
    combined += k.monthly;
  }

  rows.push(['']);
  rows.push(['Total Monthly K-1 Income', '', '', combined]);
  rows.push(['']);
  rows.push(['Generated', new Date().toLocaleString()]);

  var csv = rows.map(function (row) {
    return row.map(function (cell) { return '"' + cell + '"'; }).join(',');
  }).join('\n');

  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = '1120s-k1-income-' + Date.now() + '.csv';
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
