'use strict';

/* =====================================================
   Schedule F Farm Income Calculator
   — AI upload, field sync, single-entity calculation
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
      processScheduleFFile(fileInput.files[0], zone, statusEl);
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
      processScheduleFFile(e.dataTransfer.files[0], zone, statusEl);
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

function processScheduleFFile(file, zone, statusEl) {
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

  setZoneStatus(zone, statusEl, 'loading', '<span class="spinner"></span> Analyzing Schedule F...');
  zone.classList.add('processing');
  zone.classList.remove('has-error');

  var formData = new FormData();
  formData.append('file', file);
  formData.append('slug', 'income-schedule-f');

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
    var nameLabel  = doc.farmName || '';
    var totalLabel = (doc.netProfit != null && doc.netProfit !== 0) ? fmt(doc.netProfit) : '--';
    var isYear1    = (i === 0);

    var html = '';
    html += '<div class="doc-card__header">';
    html += '<span class="doc-card__year">' + yearLabel + '</span>';
    if (nameLabel) html += '<span class="doc-card__name">' + escHtml(nameLabel) + '</span>';
    html += '<button class="doc-card__remove" type="button" title="Remove" data-doc-id="' + doc.id + '">&times;</button>';
    html += '</div>';
    html += '<div class="doc-card__amounts">';
    html += '<span>Net Profit/Loss: ' + totalLabel + '</span>';
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
  netProfit:          'f_np',
  coopPayments:       'f_coop',
  otherIncome:        'f_other',
  depreciation:       'f_dep',
  amortization:       'f_amort',
  businessUseOfHome:  'f_home',
  mealsEntertainment: 'f_meals'
};

/** Clear only the fields that AI auto-fills */
function clearAiFields() {
  var fields = ['f_np', 'f_coop', 'f_other', 'f_dep', 'f_amort', 'f_home', 'f_meals'];
  fields.forEach(function (f) {
    var el1 = document.getElementById(f + '1');
    var el2 = document.getElementById(f + '2');
    if (el1) el1.value = '0';
    if (el2) el2.value = '0';
  });
}

/** Map docStore entries to form fields. Index 0 = most recent = Year 1. */
function syncFieldsFromDocs() {
  docStore.forEach(function (doc, i) {
    var ySuffix = (i === 0) ? '1' : '2';

    Object.keys(AI_FIELD_MAP).forEach(function (aiKey) {
      var fieldBase = AI_FIELD_MAP[aiKey];
      var fieldId = fieldBase + ySuffix;
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
// FARM INCOME CALCULATION
// =====================================================

function calculate() {
  var np1    = pn('f_np1');
  var np2    = pn('f_np2');
  var coop1  = pn('f_coop1');
  var coop2  = pn('f_coop2');
  var other1 = pn('f_other1');
  var other2 = pn('f_other2');
  var dep1   = pn('f_dep1');
  var dep2   = pn('f_dep2');
  var amort1 = pn('f_amort1');
  var amort2 = pn('f_amort2');
  var home1  = pn('f_home1');
  var home2  = pn('f_home2');
  var meals1 = pn('f_meals1');
  var meals2 = pn('f_meals2');

  var year1 = np1 + coop1 + other1 + dep1 + amort1 + home1 - meals1;
  var year2 = np2 + coop2 + other2 + dep2 + amort2 + home2 - meals2;

  // Check if Year 2 has data
  var year2Vals = [np2, coop2, other2, dep2, amort2, home2, meals2];
  var hasYr2 = year2Vals.some(function (v) { return v !== 0; });

  var monthly, method;
  if (hasYr2 && year1 > year2) {
    monthly = (year1 + year2) / 24;
    method = 'average';
  } else {
    monthly = year1 / 12;
    method = 'recent';
  }

  // Update DOM
  document.getElementById('f_total1').textContent = fmt(year1);
  document.getElementById('f_total2').textContent = fmt(year2);
  document.getElementById('f_monthly').textContent = fmt(monthly);

  updateMathSteps({
    np1: np1, np2: np2,
    coop1: coop1, coop2: coop2,
    other1: other1, other2: other2,
    dep1: dep1, dep2: dep2,
    amort1: amort1, amort2: amort2,
    home1: home1, home2: home2,
    meals1: meals1, meals2: meals2,
    year1: year1, year2: year2,
    monthly: monthly, method: method,
    hasYr2: hasYr2
  });
}

// =====================================================
// MATH STEPS
// =====================================================

function updateMathSteps(data) {
  var stepsEl = document.getElementById('calcSteps-income-schedule-f');
  if (!stepsEl) return;

  var html = '';
  html += '<div class="math-steps">';

  // Formula reference
  html += '<div class="math-step">';
  html += '<h4>Schedule F Farm Income Formula</h4>';
  html += '<div class="math-formula">';
  html += '<span class="math-note">For farm income:</span>';
  html += '<div class="math-values">';
  html += 'Annual = Net Profit + Coop/CCC + Other + Depreciation + Amortization + Home &minus; Meals<br><br>';
  html += 'IF Year 2 provided AND Year 1 &gt; Year 2:<br>';
  html += '&nbsp;&nbsp;Monthly = (Year 1 + Year 2) / 24<br>';
  html += 'ELSE:<br>';
  html += '&nbsp;&nbsp;Monthly = Year 1 / 12';
  html += '</div></div></div>';

  // Year 1 breakdown
  html += '<div class="math-step">';
  html += '<h4>Year 1 Calculation</h4>';
  html += '<div class="math-formula">';
  html += 'Net Profit: ' + fmt(data.np1) + '<br>';
  html += '+ Coop/CCC: ' + fmt(data.coop1) + '<br>';
  html += '+ Other Income: ' + fmt(data.other1) + '<br>';
  html += '+ Depreciation: ' + fmt(data.dep1) + '<br>';
  html += '+ Amortization: ' + fmt(data.amort1) + '<br>';
  html += '+ Business Use of Home: ' + fmt(data.home1) + '<br>';
  html += '&minus; Meals: ' + fmt(data.meals1) + '<br>';
  html += '<div class="math-values">';
  html += '<strong>Year 1 Total = ' + fmt(data.year1) + '</strong>';
  html += '</div></div></div>';

  // Year 2 breakdown (only if has data)
  if (data.hasYr2) {
    html += '<div class="math-step">';
    html += '<h4>Year 2 Calculation</h4>';
    html += '<div class="math-formula">';
    html += 'Net Profit: ' + fmt(data.np2) + '<br>';
    html += '+ Coop/CCC: ' + fmt(data.coop2) + '<br>';
    html += '+ Other Income: ' + fmt(data.other2) + '<br>';
    html += '+ Depreciation: ' + fmt(data.dep2) + '<br>';
    html += '+ Amortization: ' + fmt(data.amort2) + '<br>';
    html += '+ Business Use of Home: ' + fmt(data.home2) + '<br>';
    html += '&minus; Meals: ' + fmt(data.meals2) + '<br>';
    html += '<div class="math-values">';
    html += '<strong>Year 2 Total = ' + fmt(data.year2) + '</strong>';
    html += '</div></div></div>';
  }

  // Monthly result
  var methodLabel = data.method === 'average'
    ? '24-month average (Year 1 > Year 2)'
    : 'Year 1 / 12 (most recent year only)';

  html += '<div class="math-step highlight">';
  html += '<h4>Monthly Qualifying Income</h4>';
  html += '<div class="math-formula">';
  html += 'Method: ' + methodLabel + '<br>';
  if (data.method === 'average') {
    html += '(' + fmt(data.year1) + ' + ' + fmt(data.year2) + ') / 24<br>';
  } else {
    html += fmt(data.year1) + ' / 12<br>';
  }
  html += '<div class="math-values"><strong>Monthly Income: ' + fmt(data.monthly) + '</strong></div>';
  html += '</div></div>';

  html += '</div>'; // close .math-steps
  stepsEl.innerHTML = html;
}

// =====================================================
// EXPORT CSV
// =====================================================

function exportCSV() {
  var np1    = pn('f_np1');
  var np2    = pn('f_np2');
  var coop1  = pn('f_coop1');
  var coop2  = pn('f_coop2');
  var other1 = pn('f_other1');
  var other2 = pn('f_other2');
  var dep1   = pn('f_dep1');
  var dep2   = pn('f_dep2');
  var amort1 = pn('f_amort1');
  var amort2 = pn('f_amort2');
  var home1  = pn('f_home1');
  var home2  = pn('f_home2');
  var meals1 = pn('f_meals1');
  var meals2 = pn('f_meals2');

  var year1 = np1 + coop1 + other1 + dep1 + amort1 + home1 - meals1;
  var year2 = np2 + coop2 + other2 + dep2 + amort2 + home2 - meals2;

  var year2Vals = [np2, coop2, other2, dep2, amort2, home2, meals2];
  var hasYr2 = year2Vals.some(function (v) { return v !== 0; });
  var monthly;
  if (hasYr2 && year1 > year2) {
    monthly = (year1 + year2) / 24;
  } else {
    monthly = year1 / 12;
  }

  var rows = [
    ['Schedule F Farm Income Calculator'],
    [''],
    ['Line Item', 'Year 1', 'Year 2'],
    ['Net Profit or Loss', np1, np2],
    ['Ongoing Coop & CCC Payments', coop1, coop2],
    ['Other Income or Loss', other1, other2],
    ['Depreciation', dep1, dep2],
    ['Amortization/Casualty Loss/Depletion', amort1, amort2],
    ['Business Use of Home', home1, home2],
    ['Meal & Entertainment Exclusion', meals1, meals2],
    [''],
    ['Year 1 Total', year1, ''],
    ['Year 2 Total', '', year2],
    ['Monthly Qualifying Income', monthly, ''],
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
  a.download = 'schedule-f-income-' + Date.now() + '.csv';
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
