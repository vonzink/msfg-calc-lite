'use strict';

/* =====================================================
   Schedule B Interest & Dividend Income Calculator
   — AI upload, field sync, 3-institution calculation
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
      processScheduleBFile(fileInput.files[0], zone, statusEl);
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
      processScheduleBFile(e.dataTransfer.files[0], zone, statusEl);
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

function processScheduleBFile(file, zone, statusEl) {
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

  setZoneStatus(zone, statusEl, 'loading', '<span class="spinner"></span> Analyzing Schedule B...');
  zone.classList.add('processing');
  zone.classList.remove('has-error');

  var formData = new FormData();
  formData.append('file', file);
  formData.append('slug', 'income-schedule-b');

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

    var yearLabel    = doc.taxYear || '?';
    var totalInt     = (doc.totalInterest != null) ? fmt(doc.totalInterest) : '--';
    var totalDiv     = (doc.totalDividends != null) ? fmt(doc.totalDividends) : '--';
    var isYear1      = (i === 0);

    var html = '';
    html += '<div class="doc-card__header">';
    html += '<span class="doc-card__year">' + yearLabel + '</span>';
    html += '<span class="doc-card__name">Schedule B</span>';
    html += '<button class="doc-card__remove" type="button" title="Remove" data-doc-id="' + doc.id + '">&times;</button>';
    html += '</div>';
    html += '<div class="doc-card__amounts">';
    html += '<span>Interest: ' + totalInt + '</span>';
    html += '<span>Dividends: ' + totalDiv + '</span>';
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

/**
 * AI data maps into Institution 1 (inst1_) fields by default.
 * institutions array: first institution fills inst1_ fields.
 * totalInterest  → inst1_interest
 * taxExemptInterest → inst1_taxexempt
 * totalDividends → inst1_dividend
 */
var AI_FIELD_MAP = {
  totalInterest:       'interest',
  taxExemptInterest:   'taxexempt',
  totalDividends:      'dividend'
};

/** Clear only the fields that AI auto-fills (Institution 1 line items) */
function clearAiFields() {
  var fields = ['interest', 'taxexempt', 'dividend'];
  fields.forEach(function (f) {
    var el1 = document.getElementById('inst1_' + f + '_y1');
    var el2 = document.getElementById('inst1_' + f + '_y2');
    if (el1) el1.value = '0';
    if (el2) el2.value = '0';
  });
}

/** Map docStore entries to form fields. Index 0 = most recent = Year 1. */
function syncFieldsFromDocs() {
  docStore.forEach(function (doc, i) {
    var ySuffix = (i === 0) ? 'y1' : 'y2';

    // If the AI returns an institutions array, use the first one
    var source = doc;
    if (doc.institutions && doc.institutions.length > 0) {
      source = doc.institutions[0];
    }

    Object.keys(AI_FIELD_MAP).forEach(function (aiKey) {
      var fieldBase = AI_FIELD_MAP[aiKey];
      var fieldId = 'inst1_' + fieldBase + '_' + ySuffix;
      setField(fieldId, source[aiKey]);
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

function calculate() {
  var totalY1 = 0;
  var totalY2 = 0;

  // Loop through all 3 institutions
  for (var i = 1; i <= 3; i++) {
    var prefix = 'inst' + i;

    var intY1  = pn(prefix + '_interest_y1');
    var intY2  = pn(prefix + '_interest_y2');
    var texY1  = pn(prefix + '_taxexempt_y1');
    var texY2  = pn(prefix + '_taxexempt_y2');
    var divY1  = pn(prefix + '_dividend_y1');
    var divY2  = pn(prefix + '_dividend_y2');

    totalY1 += intY1 + texY1 + divY1;
    totalY2 += intY2 + texY2 + divY2;
  }

  // Standard averaging policy
  var hasYr2 = totalY2 !== 0;
  var monthly, method;

  if (hasYr2 && totalY1 > totalY2) {
    monthly = (totalY1 + totalY2) / 24;
    method = 'average';
  } else {
    monthly = totalY1 / 12;
    method = 'recent';
  }

  // Update DOM
  document.getElementById('totalYear1').textContent = fmt(totalY1);
  document.getElementById('totalYear2').textContent = fmt(totalY2);
  document.getElementById('incomeToUse').textContent = fmt(monthly);

  updateMathSteps({
    totalY1: totalY1,
    totalY2: totalY2,
    monthly: monthly,
    method: method,
    hasYr2: hasYr2
  });
}

// =====================================================
// MATH STEPS
// =====================================================

function updateMathSteps(data) {
  var stepsEl = document.getElementById('calcSteps-income-schedule-b');
  if (!stepsEl) return;

  var html = '';
  html += '<div class="math-steps">';

  // Formula reference
  html += '<div class="math-step">';
  html += '<h4>Schedule B Income Formula</h4>';
  html += '<div class="math-formula">';
  html += '<span class="math-note">For each institution:</span>';
  html += '<div class="math-values">';
  html += 'Annual = Interest + Tax-Exempt Interest + Dividends<br><br>';
  html += 'Total Year 1 = Sum of all institutions (Year 1)<br>';
  html += 'Total Year 2 = Sum of all institutions (Year 2)<br><br>';
  html += 'IF Year 2 provided AND Year 1 &gt; Year 2:<br>';
  html += '&nbsp;&nbsp;Monthly = (Year 1 + Year 2) / 24<br>';
  html += 'ELSE:<br>';
  html += '&nbsp;&nbsp;Monthly = Year 1 / 12';
  html += '</div></div></div>';

  // Per-institution breakdown
  for (var i = 1; i <= 3; i++) {
    var prefix = 'inst' + i;
    var intY1  = pn(prefix + '_interest_y1');
    var intY2  = pn(prefix + '_interest_y2');
    var texY1  = pn(prefix + '_taxexempt_y1');
    var texY2  = pn(prefix + '_taxexempt_y2');
    var divY1  = pn(prefix + '_dividend_y1');
    var divY2  = pn(prefix + '_dividend_y2');

    var instY1 = intY1 + texY1 + divY1;
    var instY2 = intY2 + texY2 + divY2;

    // Only show institutions that have data
    if (instY1 !== 0 || instY2 !== 0) {
      html += '<div class="math-step">';
      html += '<h4>Institution ' + i + '</h4>';
      html += '<div class="math-formula">';
      html += 'Interest:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;' + fmt(intY1) + ' / ' + fmt(intY2) + '<br>';
      html += 'Tax-Exempt:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;' + fmt(texY1) + ' / ' + fmt(texY2) + '<br>';
      html += 'Dividends:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;' + fmt(divY1) + ' / ' + fmt(divY2) + '<br>';
      html += '<div class="math-values">';
      html += 'Year 1 = ' + fmt(intY1) + ' + ' + fmt(texY1) + ' + ' + fmt(divY1) + ' = ' + fmt(instY1) + '<br>';
      html += 'Year 2 = ' + fmt(intY2) + ' + ' + fmt(texY2) + ' + ' + fmt(divY2) + ' = ' + fmt(instY2);
      html += '</div></div></div>';
    }
  }

  // Averaging / final result
  var methodLabel = data.method === 'average'
    ? '24-month average (Year 1 > Year 2)'
    : 'Year 1 / 12 (most recent)';

  html += '<div class="math-step highlight">';
  html += '<h4>Monthly Qualifying Income</h4>';
  html += '<div class="math-formula">';
  html += 'Total Year 1: ' + fmt(data.totalY1) + '<br>';
  html += 'Total Year 2: ' + fmt(data.totalY2) + '<br>';
  html += 'Method: ' + methodLabel + '<br>';

  if (data.method === 'average') {
    html += '<div class="math-values">';
    html += '(' + fmt(data.totalY1) + ' + ' + fmt(data.totalY2) + ') / 24 = <strong>' + fmt(data.monthly) + '</strong>';
    html += '</div>';
  } else {
    html += '<div class="math-values">';
    html += fmt(data.totalY1) + ' / 12 = <strong>' + fmt(data.monthly) + '</strong>';
    html += '</div>';
  }

  html += '</div></div>';

  html += '</div>'; // close .math-steps
  stepsEl.innerHTML = html;
}

// =====================================================
// EXPORT CSV
// =====================================================

function exportCSV() {
  var totalY1 = 0;
  var totalY2 = 0;

  var rows = [
    ['Schedule B Interest & Dividend Income Calculator'],
    [''],
    ['Institution', 'Type', 'Year 1', 'Year 2']
  ];

  for (var i = 1; i <= 3; i++) {
    var prefix = 'inst' + i;
    var intY1  = pn(prefix + '_interest_y1');
    var intY2  = pn(prefix + '_interest_y2');
    var texY1  = pn(prefix + '_taxexempt_y1');
    var texY2  = pn(prefix + '_taxexempt_y2');
    var divY1  = pn(prefix + '_dividend_y1');
    var divY2  = pn(prefix + '_dividend_y2');

    rows.push(['Institution ' + i, 'Interest', intY1, intY2]);
    rows.push(['Institution ' + i, 'Tax-Exempt Interest', texY1, texY2]);
    rows.push(['Institution ' + i, 'Dividends', divY1, divY2]);

    totalY1 += intY1 + texY1 + divY1;
    totalY2 += intY2 + texY2 + divY2;
  }

  var hasYr2 = totalY2 !== 0;
  var monthly;
  if (hasYr2 && totalY1 > totalY2) {
    monthly = (totalY1 + totalY2) / 24;
  } else {
    monthly = totalY1 / 12;
  }

  rows.push(['']);
  rows.push(['Totals', '', totalY1, totalY2]);
  rows.push(['Monthly Qualifying Income', '', '', monthly]);
  rows.push(['']);
  rows.push(['Generated', new Date().toLocaleString()]);

  var csv = rows.map(function (row) {
    return row.map(function (cell) { return '"' + cell + '"'; }).join(',');
  }).join('\n');

  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'schedule-b-income-' + Date.now() + '.csv';
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
