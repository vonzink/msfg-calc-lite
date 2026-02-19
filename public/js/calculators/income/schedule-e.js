'use strict';

/* =====================================================
   Schedule E Non-Subject Property Income Calculator
   — AI upload, field sync, monthly payment subtraction
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
      processScheduleEFile(fileInput.files[0], zone, statusEl);
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
      processScheduleEFile(e.dataTransfer.files[0], zone, statusEl);
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

function processScheduleEFile(file, zone, statusEl) {
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
  formData.append('slug', 'income-schedule-e');

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
    var rentsLabel = (doc.rentsReceived != null && doc.rentsReceived !== 0) ? fmt(doc.rentsReceived) : '--';
    var isYear1    = (i === 0);

    var html = '';
    html += '<div class="doc-card__header">';
    html += '<span class="doc-card__year">' + yearLabel + '</span>';
    html += '<button class="doc-card__remove" type="button" title="Remove" data-doc-id="' + doc.id + '">&times;</button>';
    html += '</div>';
    html += '<div class="doc-card__amounts">';
    html += '<span>Rents Received: ' + rentsLabel + '</span>';
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
  rentsReceived:    'rents',
  royaltiesReceived: 'royalties',
  amortization:     'amort',
  totalExpenses:    'expenses',
  depreciation:     'deprec',
  insurance:        'insurance',
  mortgageInterest: 'mortint',
  taxes:            'taxes'
};

/** Clear only the fields that AI auto-fills */
function clearAiFields() {
  var fields = ['rents', 'royalties', 'amort', 'expenses', 'deprec', 'insurance', 'mortint', 'taxes'];
  fields.forEach(function (f) {
    var el1 = document.getElementById('prop1_' + f + '_y1');
    var el2 = document.getElementById('prop1_' + f + '_y2');
    if (el1) el1.value = '0';
    if (el2) el2.value = '0';
  });
}

/** Map docStore entries to form fields. Index 0 = most recent = Year 1. */
function syncFieldsFromDocs() {
  docStore.forEach(function (doc, i) {
    var ySuffix = (i === 0) ? 'y1' : 'y2';

    Object.keys(AI_FIELD_MAP).forEach(function (aiKey) {
      var fieldBase = AI_FIELD_MAP[aiKey];
      var fieldId = 'prop1_' + fieldBase + '_' + ySuffix;
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
// MAIN CALCULATION
// =====================================================

function calculate() {
  var rents1     = pn('prop1_rents_y1');
  var rents2     = pn('prop1_rents_y2');
  var royalties1 = pn('prop1_royalties_y1');
  var royalties2 = pn('prop1_royalties_y2');
  var amort1     = pn('prop1_amort_y1');
  var amort2     = pn('prop1_amort_y2');
  var expenses1  = pn('prop1_expenses_y1');
  var expenses2  = pn('prop1_expenses_y2');
  var deprec1    = pn('prop1_deprec_y1');
  var deprec2    = pn('prop1_deprec_y2');
  var insurance1 = pn('prop1_insurance_y1');
  var insurance2 = pn('prop1_insurance_y2');
  var mortint1   = pn('prop1_mortint_y1');
  var mortint2   = pn('prop1_mortint_y2');
  var taxes1     = pn('prop1_taxes_y1');
  var taxes2     = pn('prop1_taxes_y2');
  var monthlyPmt = pn('prop1_monthly_pmt');

  // Formula: totalY = (rents + royalties + amort + deprec + insurance + mortint + taxes) - expenses
  var totalY1 = (rents1 + royalties1 + amort1 + deprec1 + insurance1 + mortint1 + taxes1) - expenses1;
  var totalY2 = (rents2 + royalties2 + amort2 + deprec2 + insurance2 + mortint2 + taxes2) - expenses2;

  // Check if Year 2 has data
  var yr2Vals = [rents2, royalties2, amort2, expenses2, deprec2, insurance2, mortint2, taxes2];
  var hasYr2 = yr2Vals.some(function (v) { return v !== 0; });

  // Standard averaging
  var monthlyAvg, method;
  if (hasYr2 && totalY1 > totalY2) {
    monthlyAvg = (totalY1 + totalY2) / 24;
    method = 'average';
  } else {
    monthlyAvg = totalY1 / 12;
    method = 'recent';
  }

  // SUBTRACT monthly payment — unique to this calculator
  var finalResult = monthlyAvg - monthlyPmt;

  // Display result
  document.getElementById('prop1_result').textContent = fmt(finalResult);

  // Update math steps
  updateMathSteps({
    rents1: rents1, rents2: rents2,
    royalties1: royalties1, royalties2: royalties2,
    amort1: amort1, amort2: amort2,
    expenses1: expenses1, expenses2: expenses2,
    deprec1: deprec1, deprec2: deprec2,
    insurance1: insurance1, insurance2: insurance2,
    mortint1: mortint1, mortint2: mortint2,
    taxes1: taxes1, taxes2: taxes2,
    totalY1: totalY1, totalY2: totalY2,
    hasYr2: hasYr2, method: method,
    monthlyAvg: monthlyAvg,
    monthlyPmt: monthlyPmt,
    finalResult: finalResult
  });
}

// =====================================================
// MATH STEPS
// =====================================================

function updateMathSteps(d) {
  var stepsEl = document.getElementById('calcSteps-income-schedule-e');
  if (!stepsEl) return;

  var html = '';
  html += '<div class="math-steps">';

  // Formula reference
  html += '<div class="math-step">';
  html += '<h4>Schedule E Non-Subject Property Formula</h4>';
  html += '<div class="math-formula">';
  html += '<span class="math-note">For the rental property:</span>';
  html += '<div class="math-values">';
  html += 'Annual = (Rents + Royalties + Amortization + Depreciation + Insurance + Mortgage Interest + Taxes) &minus; Total Expenses<br><br>';
  html += 'IF Year 2 provided AND Year 1 &gt; Year 2:<br>';
  html += '&nbsp;&nbsp;Monthly Avg = (Year 1 + Year 2) / 24<br>';
  html += 'ELSE:<br>';
  html += '&nbsp;&nbsp;Monthly Avg = Year 1 / 12<br><br>';
  html += '<strong>Final = Monthly Avg &minus; Monthly Payment (Credit Report)</strong>';
  html += '</div></div></div>';

  // Year 1 breakdown
  html += '<div class="math-step">';
  html += '<h4>Year 1 (Most Recent)</h4>';
  html += '<div class="math-formula">';
  html += 'Rents Received: ' + fmt(d.rents1) + '<br>';
  html += 'Royalties Received: ' + fmt(d.royalties1) + '<br>';
  html += 'Amortization/Casualty Loss: ' + fmt(d.amort1) + '<br>';
  html += 'Depreciation: ' + fmt(d.deprec1) + '<br>';
  html += 'Insurance (if PITI): ' + fmt(d.insurance1) + '<br>';
  html += 'Mortgage Interest: ' + fmt(d.mortint1) + '<br>';
  html += 'Taxes (if PITI): ' + fmt(d.taxes1) + '<br>';
  html += 'Less Total Expenses: ' + fmt(d.expenses1) + '<br>';
  html += '<div class="math-values">';
  html += 'Year 1 Total = ' + fmt(d.rents1 + d.royalties1 + d.amort1 + d.deprec1 + d.insurance1 + d.mortint1 + d.taxes1);
  html += ' &minus; ' + fmt(d.expenses1) + ' = <strong>' + fmt(d.totalY1) + '</strong>';
  html += '</div></div></div>';

  // Year 2 breakdown (if present)
  if (d.hasYr2) {
    html += '<div class="math-step">';
    html += '<h4>Year 2 (Prior)</h4>';
    html += '<div class="math-formula">';
    html += 'Rents Received: ' + fmt(d.rents2) + '<br>';
    html += 'Royalties Received: ' + fmt(d.royalties2) + '<br>';
    html += 'Amortization/Casualty Loss: ' + fmt(d.amort2) + '<br>';
    html += 'Depreciation: ' + fmt(d.deprec2) + '<br>';
    html += 'Insurance (if PITI): ' + fmt(d.insurance2) + '<br>';
    html += 'Mortgage Interest: ' + fmt(d.mortint2) + '<br>';
    html += 'Taxes (if PITI): ' + fmt(d.taxes2) + '<br>';
    html += 'Less Total Expenses: ' + fmt(d.expenses2) + '<br>';
    html += '<div class="math-values">';
    html += 'Year 2 Total = ' + fmt(d.rents2 + d.royalties2 + d.amort2 + d.deprec2 + d.insurance2 + d.mortint2 + d.taxes2);
    html += ' &minus; ' + fmt(d.expenses2) + ' = <strong>' + fmt(d.totalY2) + '</strong>';
    html += '</div></div></div>';
  }

  // Averaging step
  html += '<div class="math-step">';
  html += '<h4>Monthly Average</h4>';
  html += '<div class="math-formula">';
  if (d.method === 'average') {
    html += 'Method: 24-month average (Year 1 &gt; Year 2)<br>';
    html += '(' + fmt(d.totalY1) + ' + ' + fmt(d.totalY2) + ') / 24<br>';
  } else {
    html += 'Method: Year 1 / 12 (most recent year only)<br>';
    html += fmt(d.totalY1) + ' / 12<br>';
  }
  html += '<div class="math-values">';
  html += '<strong>Monthly Average: ' + fmt(d.monthlyAvg) + '</strong>';
  html += '</div></div></div>';

  // Payment subtraction step
  html += '<div class="math-step highlight">';
  html += '<h4>Final Result (Net of Monthly Payment)</h4>';
  html += '<div class="math-formula">';
  html += 'Monthly Average: ' + fmt(d.monthlyAvg) + '<br>';
  html += 'Less Monthly Payment (Credit Report): ' + fmt(d.monthlyPmt) + '<br>';
  html += '<div class="math-values">';
  html += fmt(d.monthlyAvg) + ' &minus; ' + fmt(d.monthlyPmt) + ' = <strong>' + fmt(d.finalResult) + '</strong>';
  if (d.finalResult >= 0) {
    html += '<br><span style="color: var(--color-success);">Positive = Add to qualifying income</span>';
  } else {
    html += '<br><span style="color: var(--color-danger);">Negative = Count as monthly expense (liability)</span>';
  }
  html += '</div></div></div>';

  html += '</div>'; // close .math-steps
  stepsEl.innerHTML = html;
}

// =====================================================
// EXPORT CSV
// =====================================================

function exportCSV() {
  var rents1     = pn('prop1_rents_y1');
  var rents2     = pn('prop1_rents_y2');
  var royalties1 = pn('prop1_royalties_y1');
  var royalties2 = pn('prop1_royalties_y2');
  var amort1     = pn('prop1_amort_y1');
  var amort2     = pn('prop1_amort_y2');
  var expenses1  = pn('prop1_expenses_y1');
  var expenses2  = pn('prop1_expenses_y2');
  var deprec1    = pn('prop1_deprec_y1');
  var deprec2    = pn('prop1_deprec_y2');
  var insurance1 = pn('prop1_insurance_y1');
  var insurance2 = pn('prop1_insurance_y2');
  var mortint1   = pn('prop1_mortint_y1');
  var mortint2   = pn('prop1_mortint_y2');
  var taxes1     = pn('prop1_taxes_y1');
  var taxes2     = pn('prop1_taxes_y2');
  var monthlyPmt = pn('prop1_monthly_pmt');

  var totalY1 = (rents1 + royalties1 + amort1 + deprec1 + insurance1 + mortint1 + taxes1) - expenses1;
  var totalY2 = (rents2 + royalties2 + amort2 + deprec2 + insurance2 + mortint2 + taxes2) - expenses2;

  var yr2Vals = [rents2, royalties2, amort2, expenses2, deprec2, insurance2, mortint2, taxes2];
  var hasYr2 = yr2Vals.some(function (v) { return v !== 0; });

  var monthlyAvg;
  if (hasYr2 && totalY1 > totalY2) {
    monthlyAvg = (totalY1 + totalY2) / 24;
  } else {
    monthlyAvg = totalY1 / 12;
  }

  var finalResult = monthlyAvg - monthlyPmt;

  var rows = [
    ['Schedule E Non-Subject Property Income Calculator'],
    [''],
    ['Line Item', 'Line #', 'Sign', 'Year 1', 'Year 2'],
    ['Rents Received', '3', '+', rents1, rents2],
    ['Royalties Received', '4', '+', royalties1, royalties2],
    ['Amortization/Casualty Loss', '19', '+', amort1, amort2],
    ['Total Expenses', '20', '-', expenses1, expenses2],
    ['Depreciation', '18', '+', deprec1, deprec2],
    ['Insurance (if PITI)', '9', '+', insurance1, insurance2],
    ['Mortgage Interest', '12', '+', mortint1, mortint2],
    ['Taxes (if PITI)', '16', '+', taxes1, taxes2],
    [''],
    ['Year 1 Total', '', '', totalY1, ''],
    ['Year 2 Total', '', '', '', totalY2],
    ['Monthly Average', '', '', monthlyAvg, ''],
    ['Monthly Payment (Credit Report)', '', '', monthlyPmt, ''],
    [''],
    ['Final Monthly Income (Net of Payment)', '', '', finalResult, ''],
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
  a.download = 'schedule-e-nonsub-income-' + Date.now() + '.csv';
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
