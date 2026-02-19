'use strict';

/* =====================================================
   Form 1065 Partnership Income Calculator
   — AI upload, field sync, partnership calculation
   ===================================================== */

var fmt = MSFG.formatCurrency;
var pn  = MSFG.parseNumById;

// =====================================================
// DOCUMENT STORE — max 2 (one per tax year)
// =====================================================

var docStore = [];

// Track which partnership slot the AI data should fill
// Default: Partnership 1
var aiTargetPartnership = 'p1';

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
      process1065File(fileInput.files[0], zone, statusEl);
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
      process1065File(e.dataTransfer.files[0], zone, statusEl);
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

function process1065File(file, zone, statusEl) {
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

  setZoneStatus(zone, statusEl, 'loading', '<span class="spinner"></span> Analyzing 1065...');
  zone.classList.add('processing');
  zone.classList.remove('has-error');

  var formData = new FormData();
  formData.append('file', file);
  formData.append('slug', 'income-1065');

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
    var nameLabel  = doc.partnershipName || '';
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
    html += '<span>Total Income (Line 8): ' + totalLabel + '</span>';
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

/** AI fields map into Partnership 1 (p1_) by default. */
var AI_FIELD_MAP = {
  ordinaryIncome:      'ord',
  netFarmProfit:       'farm',
  netGainLoss:         'gain',
  otherIncomeLoss:     'oth',
  depreciation:        'dep',
  depletion:           'depl',
  amortization:        'amort',
  mortgagesPayable:    'mort',
  mealsEntertainment:  'meals'
};

/** Clear only the fields that AI auto-fills (Partnership 1 line items) */
function clearAiFields() {
  var prefix = aiTargetPartnership;
  var fields = ['ord', 'farm', 'gain', 'oth', 'dep', 'depl', 'amort', 'mort', 'meals'];
  fields.forEach(function (f) {
    var el1 = document.getElementById(prefix + '_' + f + '1');
    var el2 = document.getElementById(prefix + '_' + f + '2');
    if (el1) el1.value = '0';
    if (el2) el2.value = '0';
  });
}

/** Map docStore entries to form fields. Index 0 = most recent = Year 1. */
function syncFieldsFromDocs() {
  var prefix = aiTargetPartnership;

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
// PARTNERSHIP CALCULATION
// =====================================================

function computePartnership(prefix) {
  var ord1   = pn(prefix + '_ord1');
  var ord2   = pn(prefix + '_ord2');
  var farm1  = pn(prefix + '_farm1');
  var farm2  = pn(prefix + '_farm2');
  var gain1  = pn(prefix + '_gain1');
  var gain2  = pn(prefix + '_gain2');
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

  var sum1 = ord1 + farm1 + gain1 + oth1 + dep1 + depl1 + amort1;
  var sum2 = ord2 + farm2 + gain2 + oth2 + dep2 + depl2 + amort2;

  var total1 = (sum1 - mort1 - meals1) * own;
  var total2 = (sum2 - mort2 - meals2) * own;

  var year2Vals = [ord2, farm2, gain2, oth2, dep2, depl2, amort2, mort2, meals2];
  var hasYr2 = year2Vals.some(function (v) { return v !== 0; });

  var monthly, method;
  if (hasYr2 && total1 > total2) {
    monthly = (total1 + total2) / 24;
    method = 'average';
  } else {
    monthly = total1 / 12;
    method = 'recent';
  }

  return {
    sum1: sum1, sum2: sum2,
    total1: total1, total2: total2,
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
  var p1 = computePartnership('p1');
  document.getElementById('p1_year1').textContent = fmt(p1.total1);
  document.getElementById('p1_year2').textContent = fmt(p1.total2);
  document.getElementById('p1_month').textContent = fmt(p1.monthly);
  document.getElementById('result_p1').textContent = fmt(p1.monthly);

  var p2 = computePartnership('p2');
  document.getElementById('p2_year1').textContent = fmt(p2.total1);
  document.getElementById('p2_year2').textContent = fmt(p2.total2);
  document.getElementById('p2_month').textContent = fmt(p2.monthly);
  document.getElementById('result_p2').textContent = fmt(p2.monthly);

  var combined = p1.monthly + p2.monthly;
  document.getElementById('combined1065').textContent = fmt(combined);

  updateMathSteps(p1, p2, combined);
}

// =====================================================
// MATH STEPS
// =====================================================

function updateMathSteps(p1, p2, combined) {
  var stepsEl = document.getElementById('calcSteps-income-1065');
  if (!stepsEl) return;

  var html = '';
  html += '<div class="math-steps">';

  // Formula reference
  html += '<div class="math-step">';
  html += '<h4>Partnership Income Formula</h4>';
  html += '<div class="math-formula">';
  html += '<span class="math-note">For each partnership:</span>';
  html += '<div class="math-values">';
  html += 'Subtotal = Ordinary + Farm + Gain + Other + Depreciation + Depletion + Amortization<br>';
  html += 'Annual Income = (Subtotal &minus; Mortgages &minus; Meals) &times; Ownership %<br><br>';
  html += 'IF Year 2 provided AND Year 1 &gt; Year 2:<br>';
  html += '&nbsp;&nbsp;Monthly = (Year 1 + Year 2) / 24<br>';
  html += 'ELSE:<br>';
  html += '&nbsp;&nbsp;Monthly = Year 1 / 12';
  html += '</div></div></div>';

  // Partnership 1
  html += buildPartnershipMathStep('Partnership 1', p1);

  // Partnership 2 (only if has values)
  var p2HasData = p2.sum1 !== 0 || p2.sum2 !== 0 || p2.mort1 !== 0 || p2.meals1 !== 0;
  if (p2HasData) {
    html += buildPartnershipMathStep('Partnership 2', p2);
  }

  // Combined total
  html += '<div class="math-step highlight">';
  html += '<h4>Total Monthly Income</h4>';
  html += '<div class="math-formula">';
  html += 'Partnership 1: ' + fmt(p1.monthly) + '<br>';
  if (p2HasData) {
    html += '+ Partnership 2: ' + fmt(p2.monthly) + '<br>';
  }
  html += '<div class="math-values"><strong>Total Monthly: ' + fmt(combined) + '</strong></div>';
  html += '</div></div>';

  html += '</div>'; // close .math-steps
  stepsEl.innerHTML = html;
}

function buildPartnershipMathStep(label, p) {
  var methodLabel = p.method === 'average'
    ? '24-month average (Year 1 > Year 2)'
    : 'Year 1 / 12';

  var html = '';
  html += '<div class="math-step">';
  html += '<h4>' + label + ' Calculation</h4>';
  html += '<div class="math-formula">';
  html += 'Subtotal Year 1: ' + fmt(p.sum1) + '<br>';
  html += 'Subtotal Year 2: ' + fmt(p.sum2) + '<br>';
  html += 'Less Mortgages: ' + fmt(p.mort1) + ' / ' + fmt(p.mort2) + '<br>';
  html += 'Less Meals: ' + fmt(p.meals1) + ' / ' + fmt(p.meals2) + '<br>';
  html += 'Ownership: ' + p.own + '%<br>';
  html += '<div class="math-values">';
  html += 'Year 1 = (' + fmt(p.sum1) + ' &minus; ' + fmt(p.mort1) + ' &minus; ' + fmt(p.meals1) + ') &times; ' + p.own + '% = ' + fmt(p.total1) + '<br>';
  html += 'Year 2 = (' + fmt(p.sum2) + ' &minus; ' + fmt(p.mort2) + ' &minus; ' + fmt(p.meals2) + ') &times; ' + p.own + '% = ' + fmt(p.total2) + '<br>';
  html += 'Method: ' + methodLabel + '<br>';
  html += '<strong>Monthly: ' + fmt(p.monthly) + '</strong>';
  html += '</div></div></div>';
  return html;
}

// =====================================================
// EXPORT CSV
// =====================================================

function exportCSV() {
  var p1 = computePartnership('p1');
  var p2 = computePartnership('p2');
  var combined = p1.monthly + p2.monthly;

  var rows = [
    ['Form 1065 Partnership Income Calculator'],
    [''],
    ['Partnership', 'Year 1 Income', 'Year 2 Income', 'Ownership %', 'Monthly Income'],
    ['Partnership 1', p1.total1, p1.total2, p1.own, p1.monthly],
    ['Partnership 2', p2.total1, p2.total2, p2.own, p2.monthly],
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
  a.download = 'form1065-income-' + Date.now() + '.csv';
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
