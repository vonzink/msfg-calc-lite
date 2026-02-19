'use strict';

/* =====================================================
   Rental Property Income (1038) Calculator
   — Method A: Schedule E  |  Method B: Lease Agreement
   — AI upload for Schedule E extraction
   ===================================================== */

var fmt = MSFG.formatCurrency;
var pn  = MSFG.parseNumById;

// =====================================================
// DOCUMENT STORE
// =====================================================

var docStore = [];
var currentMethod = 'scheduleE';

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
      processRentalFile(fileInput.files[0], zone, statusEl);
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
      processRentalFile(e.dataTransfer.files[0], zone, statusEl);
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

function processRentalFile(file, zone, statusEl) {
  if (!validateFile(file)) {
    setZoneStatus(zone, statusEl, 'error', 'Unsupported file type. Use PNG, JPG, WebP, or PDF.');
    zone.classList.add('has-error');
    return;
  }

  if (docStore.length >= 1) {
    setZoneStatus(zone, statusEl, 'error', 'Maximum 1 Schedule E upload. Remove the existing one first.');
    zone.classList.add('has-error');
    return;
  }

  setZoneStatus(zone, statusEl, 'loading', '<span class="spinner"></span> Analyzing Schedule E...');
  zone.classList.add('processing');
  zone.classList.remove('has-error');

  var formData = new FormData();
  formData.append('file', file);
  formData.append('slug', 'income-rental-1038');

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

      docStore = [data];

      renderDocCards();
      syncFieldsFromDoc(data);

      // Auto-select Method A when Schedule E is uploaded
      if (currentMethod !== 'scheduleE') {
        selectMethod('scheduleE');
      }

      calculate();

      setZoneStatus(zone, statusEl, 'success', 'Schedule E data loaded successfully.');
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

  docStore.forEach(function (doc) {
    var card = document.createElement('div');
    card.className = 'doc-card';

    var yearLabel  = doc.taxYear || 'Schedule E';
    var rentsLabel = (doc.rentsReceived != null && doc.rentsReceived !== 0) ? fmt(doc.rentsReceived) : '--';

    var html = '';
    html += '<div class="doc-card__header">';
    html += '<span class="doc-card__year">' + yearLabel + '</span>';
    html += '<span class="doc-card__name">Schedule E</span>';
    html += '<span class="doc-card__badge">Method A</span>';
    html += '<button class="doc-card__remove" type="button" title="Remove" data-doc-id="' + doc.id + '">&times;</button>';
    html += '</div>';
    html += '<div class="doc-card__amounts">';
    html += '<span>Rents Received: ' + rentsLabel + '</span>';
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
  clearMethodAFields();
  calculate();

  // Update upload zone
  var zone = document.querySelector('.upload-zone');
  var statusEl = zone ? zone.querySelector('.upload-zone__status') : null;
  if (zone && statusEl) {
    zone.classList.remove('has-data', 'has-error');
    setZoneStatus(zone, statusEl, '', '');
    var fileInput = zone.querySelector('.upload-zone__input');
    if (fileInput) fileInput.value = '';
  }
}

// =====================================================
// FIELD MAPPING — AI → Form Fields
// =====================================================

var AI_FIELD_MAP = {
  rentsReceived:     'methodA_rents',
  totalExpenses:     'methodA_expenses',
  insurance:         'methodA_insurance',
  mortgageInterest:  'methodA_mortint',
  taxes:             'methodA_taxes',
  depreciation:      'methodA_deprec'
};

function syncFieldsFromDoc(doc) {
  Object.keys(AI_FIELD_MAP).forEach(function (aiKey) {
    var fieldId = AI_FIELD_MAP[aiKey];
    setField(fieldId, doc[aiKey]);
  });

  // fairRentalDays: if > 0, convert to months
  if (doc.fairRentalDays && doc.fairRentalDays > 0) {
    var months = Math.round(doc.fairRentalDays / 30);
    if (months < 1) months = 1;
    if (months > 12) months = 12;
    setField('methodA_months', months);
  }
}

function clearMethodAFields() {
  var fields = ['methodA_rents', 'methodA_expenses', 'methodA_insurance',
                'methodA_mortint', 'methodA_taxes', 'methodA_hoa',
                'methodA_deprec', 'methodA_onetime'];
  fields.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '0';
  });
  var monthsEl = document.getElementById('methodA_months');
  if (monthsEl) monthsEl.value = '12';
}

function setField(id, value) {
  var el = document.getElementById(id);
  if (el && value != null) {
    el.value = value || 0;
  }
}

// =====================================================
// METHOD SELECTOR
// =====================================================

function selectMethod(method) {
  currentMethod = method;

  // Toggle method buttons
  var btns = document.querySelectorAll('.method-btn');
  btns.forEach(function (btn, i) {
    if ((method === 'scheduleE' && i === 0) || (method === 'lease' && i === 1)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Toggle method content panels
  var methodA = document.getElementById('methodA');
  var methodB = document.getElementById('methodB');
  if (methodA) {
    if (method === 'scheduleE') {
      methodA.classList.add('active');
    } else {
      methodA.classList.remove('active');
    }
  }
  if (methodB) {
    if (method === 'lease') {
      methodB.classList.add('active');
    } else {
      methodB.classList.remove('active');
    }
  }

  calculate();
}

// =====================================================
// CALCULATIONS
// =====================================================

function calculate() {
  if (currentMethod === 'scheduleE') {
    calculateMethodA();
  } else {
    calculateMethodB();
  }
}

function calculateMethodA() {
  var rents     = pn('methodA_rents');
  var expenses  = pn('methodA_expenses');
  var insurance = pn('methodA_insurance');
  var mortint   = pn('methodA_mortint');
  var taxes     = pn('methodA_taxes');
  var hoa       = pn('methodA_hoa');
  var deprec    = pn('methodA_deprec');
  var onetime   = pn('methodA_onetime');
  var months    = pn('methodA_months') || 12;
  var pitia     = pn('methodA_pitia');

  // Clamp months
  if (months < 1) months = 1;
  if (months > 12) months = 12;

  // Adjusted annual income: rents - expenses + add-backs
  var adjustedIncome = (rents + insurance + mortint + taxes + hoa + deprec + onetime) - expenses;

  // Monthly adjusted
  var monthlyAdjusted = adjustedIncome / months;

  // Final result after PITIA
  var finalResult = monthlyAdjusted - pitia;

  // Update display
  var adjEl = document.getElementById('methodA_adjusted');
  if (adjEl) adjEl.textContent = fmt(monthlyAdjusted);

  var resEl = document.getElementById('methodA_result');
  if (resEl) resEl.textContent = fmt(finalResult);

  updateMathSteps({
    method: 'A',
    rents: rents,
    expenses: expenses,
    insurance: insurance,
    mortint: mortint,
    taxes: taxes,
    hoa: hoa,
    deprec: deprec,
    onetime: onetime,
    months: months,
    adjustedIncome: adjustedIncome,
    monthlyAdjusted: monthlyAdjusted,
    pitia: pitia,
    finalResult: finalResult
  });
}

function calculateMethodB() {
  var grossRent = pn('methodB_grossrent');
  var pitia     = pn('methodB_pitia');

  // Adjusted monthly = gross x 75%
  var adjustedMonthly = grossRent * 0.75;

  // Final result after PITIA
  var finalResult = adjustedMonthly - pitia;

  // Update display
  var adjEl = document.getElementById('methodB_adjusted');
  if (adjEl) adjEl.textContent = fmt(adjustedMonthly);

  var resEl = document.getElementById('methodB_result');
  if (resEl) resEl.textContent = fmt(finalResult);

  updateMathSteps({
    method: 'B',
    grossRent: grossRent,
    adjustedMonthly: adjustedMonthly,
    pitia: pitia,
    finalResult: finalResult
  });
}

// =====================================================
// MATH STEPS
// =====================================================

function updateMathSteps(data) {
  var stepsEl = document.getElementById('calcSteps-income-rental-1038');
  if (!stepsEl) return;

  var html = '';
  html += '<div class="math-steps">';

  if (data.method === 'A') {
    // Formula reference
    html += '<div class="math-step">';
    html += '<h4>Method A: Schedule E Formula</h4>';
    html += '<div class="math-formula">';
    html += '<span class="math-note">Rental Income from Schedule E with PITIA add-backs:</span>';
    html += '<div class="math-values">';
    html += 'Adjusted = Rents &minus; Total Expenses + Insurance + Mort Interest + Taxes + HOA + Depreciation + One-time<br>';
    html += 'Monthly = Adjusted / Months in Service<br>';
    html += 'Net = Monthly &minus; Proposed PITIA';
    html += '</div></div></div>';

    // Step 1: Schedule E adjustments
    html += '<div class="math-step">';
    html += '<h4>Step 1 &ndash; Adjusted Annual Income</h4>';
    html += '<div class="math-formula">';
    html += 'A1. Rents received: ' + fmt(data.rents) + '<br>';
    html += 'A2. Total expenses: &minus;' + fmt(data.expenses) + '<br>';
    html += 'A3. Insurance (add back): +' + fmt(data.insurance) + '<br>';
    html += 'A4. Mortgage interest (add back): +' + fmt(data.mortint) + '<br>';
    html += 'A5. Taxes (add back): +' + fmt(data.taxes) + '<br>';
    html += 'A6. HOA dues (add back): +' + fmt(data.hoa) + '<br>';
    html += 'A7. Depreciation (add back): +' + fmt(data.deprec) + '<br>';
    html += 'A8. One-time expense (add back): +' + fmt(data.onetime) + '<br>';
    html += '<div class="math-values">';
    html += 'Adjusted Annual = ' + fmt(data.adjustedIncome);
    html += '</div></div></div>';

    // Step 2: Monthly
    html += '<div class="math-step">';
    html += '<h4>Step 2 &ndash; Adjusted Monthly Income</h4>';
    html += '<div class="math-formula">';
    html += fmt(data.adjustedIncome) + ' / ' + data.months + ' months<br>';
    html += '<div class="math-values">';
    html += 'A9. Monthly = ' + fmt(data.monthlyAdjusted);
    html += '</div></div></div>';

    // Step 3: Net after PITIA
    html += '<div class="math-step highlight">';
    html += '<h4>Step 3 &ndash; Net Rental Income</h4>';
    html += '<div class="math-formula">';
    html += fmt(data.monthlyAdjusted) + ' &minus; ' + fmt(data.pitia) + ' (PITIA)<br>';
    html += '<div class="math-values">';
    html += '<strong>Net Rental Income = ' + fmt(data.finalResult) + '</strong>';
    html += '</div></div></div>';

  } else {
    // Method B
    html += '<div class="math-step">';
    html += '<h4>Method B: Lease Agreement Formula</h4>';
    html += '<div class="math-formula">';
    html += '<span class="math-note">Gross rent &times; 75% vacancy/expense factor, less proposed PITIA:</span>';
    html += '<div class="math-values">';
    html += 'Adjusted Monthly = Gross Rent &times; 0.75<br>';
    html += 'Net = Adjusted Monthly &minus; Proposed PITIA';
    html += '</div></div></div>';

    // Step 1: 75% factor
    html += '<div class="math-step">';
    html += '<h4>Step 1 &ndash; Adjusted Monthly Rent</h4>';
    html += '<div class="math-formula">';
    html += 'B1. Gross monthly rent: ' + fmt(data.grossRent) + '<br>';
    html += fmt(data.grossRent) + ' &times; 0.75<br>';
    html += '<div class="math-values">';
    html += 'B2. Adjusted Monthly = ' + fmt(data.adjustedMonthly);
    html += '</div></div></div>';

    // Step 2: Net after PITIA
    html += '<div class="math-step highlight">';
    html += '<h4>Step 2 &ndash; Net Rental Income</h4>';
    html += '<div class="math-formula">';
    html += fmt(data.adjustedMonthly) + ' &minus; ' + fmt(data.pitia) + ' (PITIA)<br>';
    html += '<div class="math-values">';
    html += '<strong>Net Rental Income = ' + fmt(data.finalResult) + '</strong>';
    html += '</div></div></div>';
  }

  html += '</div>'; // close .math-steps
  stepsEl.innerHTML = html;
}

// =====================================================
// EXPORT CSV
// =====================================================

function exportCSV() {
  var rows = [
    ['Rental Income Worksheet (1038)'],
    ['Method', currentMethod === 'scheduleE' ? 'A - Schedule E' : 'B - Lease Agreement'],
    ['']
  ];

  if (currentMethod === 'scheduleE') {
    var rents     = pn('methodA_rents');
    var expenses  = pn('methodA_expenses');
    var insurance = pn('methodA_insurance');
    var mortint   = pn('methodA_mortint');
    var taxes     = pn('methodA_taxes');
    var hoa       = pn('methodA_hoa');
    var deprec    = pn('methodA_deprec');
    var onetime   = pn('methodA_onetime');
    var months    = pn('methodA_months') || 12;
    var pitia     = pn('methodA_pitia');

    var adjustedIncome = (rents + insurance + mortint + taxes + hoa + deprec + onetime) - expenses;
    var monthlyAdj = adjustedIncome / months;
    var finalResult = monthlyAdj - pitia;

    rows.push(['Field', 'Amount']);
    rows.push(['A1. Total rents received', rents]);
    rows.push(['A2. Total expenses', expenses]);
    rows.push(['A3. Insurance (add back)', insurance]);
    rows.push(['A4. Mortgage interest (add back)', mortint]);
    rows.push(['A5. Taxes (add back)', taxes]);
    rows.push(['A6. HOA dues (add back)', hoa]);
    rows.push(['A7. Depreciation (add back)', deprec]);
    rows.push(['A8. One-time expense (add back)', onetime]);
    rows.push(['Months in service', months]);
    rows.push(['A9. Adjusted Monthly Income', monthlyAdj]);
    rows.push(['A10. Proposed PITIA', pitia]);
    rows.push(['']);
    rows.push(['Net Rental Income (Method A)', finalResult]);
  } else {
    var grossRent = pn('methodB_grossrent');
    var pitiaB    = pn('methodB_pitia');
    var adjustedMonthly = grossRent * 0.75;
    var finalResultB = adjustedMonthly - pitiaB;

    rows.push(['Field', 'Amount']);
    rows.push(['B1. Gross monthly rent', grossRent]);
    rows.push(['B2. Adjusted Monthly (75%)', adjustedMonthly]);
    rows.push(['B3. Proposed PITIA', pitiaB]);
    rows.push(['']);
    rows.push(['Net Rental Income (Method B)', finalResultB]);
  }

  rows.push(['']);
  rows.push(['Generated', new Date().toLocaleString()]);

  var csv = rows.map(function (row) {
    return row.map(function (cell) { return '"' + cell + '"'; }).join(',');
  }).join('\n');

  var blob = new Blob([csv], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'rental-income-1038-' + Date.now() + '.csv';
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

  // Reset all number inputs
  var inputs = document.querySelectorAll('input[type="number"]');
  inputs.forEach(function (input) {
    if (input.id === 'methodA_months') {
      input.value = '12';
    } else {
      input.value = '0';
    }
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
