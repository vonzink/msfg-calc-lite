'use strict';

/* =====================================================
   Schedule D Capital Gains/Losses Income Calculator
   — AI upload, field sync, capital gains calculation
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
      processScheduleDFile(fileInput.files[0], zone, statusEl);
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
      processScheduleDFile(e.dataTransfer.files[0], zone, statusEl);
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

function processScheduleDFile(file, zone, statusEl) {
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

  setZoneStatus(zone, statusEl, 'loading', '<span class="spinner"></span> Analyzing Schedule D...');
  zone.classList.add('processing');
  zone.classList.remove('has-error');

  var formData = new FormData();
  formData.append('file', file);
  formData.append('slug', 'income-schedule-d');

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

    var yearLabel = doc.taxYear || '?';
    var stcg = doc.shortTermGainLoss != null ? fmt(doc.shortTermGainLoss) : '--';
    var ltcg = doc.longTermGainLoss != null ? fmt(doc.longTermGainLoss) : '--';
    var isYear1 = (i === 0);

    var html = '';
    html += '<div class="doc-card__header">';
    html += '<span class="doc-card__year">' + yearLabel + '</span>';
    html += '<span class="doc-card__name">Schedule D</span>';
    html += '<button class="doc-card__remove" type="button" title="Remove" data-doc-id="' + doc.id + '">&times;</button>';
    html += '</div>';
    html += '<div class="doc-card__amounts">';
    html += '<span>ST: ' + stcg + '</span>';
    html += '<span>LT: ' + ltcg + '</span>';
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
  shortTermGainLoss: 'd_stcg',
  longTermGainLoss:  'd_ltcg'
};

/** Clear only the fields that AI auto-fills */
function clearAiFields() {
  var fields = ['d_stcg', 'd_ltcg'];
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
// CALCULATION
// =====================================================

function calculate() {
  var stcg1 = pn('d_stcg1');
  var stcg2 = pn('d_stcg2');
  var ltcg1 = pn('d_ltcg1');
  var ltcg2 = pn('d_ltcg2');

  var total1 = stcg1 + ltcg1;
  var total2 = stcg2 + ltcg2;

  // Check if Year 2 has data
  var hasYr2 = (stcg2 !== 0 || ltcg2 !== 0);

  var monthly, method;
  if (hasYr2 && total1 > total2) {
    monthly = (total1 + total2) / 24;
    method = 'average';
  } else {
    monthly = total1 / 12;
    method = 'recent';
  }

  // Display results
  document.getElementById('d_total1').textContent = fmt(total1);
  document.getElementById('d_total2').textContent = fmt(total2);
  document.getElementById('d_monthly').textContent = fmt(monthly);

  updateMathSteps({
    stcg1: stcg1, stcg2: stcg2,
    ltcg1: ltcg1, ltcg2: ltcg2,
    total1: total1, total2: total2,
    monthly: monthly, method: method,
    hasYr2: hasYr2
  });
}

// =====================================================
// MATH STEPS
// =====================================================

function updateMathSteps(d) {
  var stepsEl = document.getElementById('calcSteps-income-schedule-d');
  if (!stepsEl) return;

  var methodLabel = d.method === 'average'
    ? '24-month average (Year 1 > Year 2)'
    : 'Year 1 / 12';

  var html = '';
  html += '<div class="math-steps">';

  // Formula reference
  html += '<div class="math-step">';
  html += '<h4>Capital Gains Income Formula</h4>';
  html += '<div class="math-formula">';
  html += '<span class="math-note">For each tax year:</span>';
  html += '<div class="math-values">';
  html += 'Total = Short-Term Gain/Loss + Long-Term Gain/Loss<br><br>';
  html += 'IF Year 2 provided AND Year 1 &gt; Year 2:<br>';
  html += '&nbsp;&nbsp;Monthly = (Year 1 + Year 2) / 24<br>';
  html += 'ELSE:<br>';
  html += '&nbsp;&nbsp;Monthly = Year 1 / 12';
  html += '</div></div></div>';

  // Year 1
  html += '<div class="math-step">';
  html += '<h4>Year 1 (Most Recent)</h4>';
  html += '<div class="math-formula">';
  html += 'Short-Term: ' + fmt(d.stcg1) + '<br>';
  html += 'Long-Term: ' + fmt(d.ltcg1) + '<br>';
  html += '<div class="math-values">';
  html += 'Year 1 Total = ' + fmt(d.stcg1) + ' + ' + fmt(d.ltcg1) + ' = ' + fmt(d.total1);
  html += '</div></div></div>';

  // Year 2 (only if has values)
  if (d.hasYr2) {
    html += '<div class="math-step">';
    html += '<h4>Year 2 (Prior)</h4>';
    html += '<div class="math-formula">';
    html += 'Short-Term: ' + fmt(d.stcg2) + '<br>';
    html += 'Long-Term: ' + fmt(d.ltcg2) + '<br>';
    html += '<div class="math-values">';
    html += 'Year 2 Total = ' + fmt(d.stcg2) + ' + ' + fmt(d.ltcg2) + ' = ' + fmt(d.total2);
    html += '</div></div></div>';
  }

  // Monthly result
  html += '<div class="math-step highlight">';
  html += '<h4>Monthly Income</h4>';
  html += '<div class="math-formula">';
  html += 'Method: ' + methodLabel + '<br>';
  if (d.method === 'average') {
    html += '(' + fmt(d.total1) + ' + ' + fmt(d.total2) + ') / 24<br>';
  } else {
    html += fmt(d.total1) + ' / 12<br>';
  }
  html += '<div class="math-values"><strong>Monthly Income: ' + fmt(d.monthly) + '</strong></div>';
  html += '</div></div>';

  html += '</div>'; // close .math-steps
  stepsEl.innerHTML = html;
}

// =====================================================
// EXPORT CSV
// =====================================================

function exportCSV() {
  var stcg1 = pn('d_stcg1');
  var stcg2 = pn('d_stcg2');
  var ltcg1 = pn('d_ltcg1');
  var ltcg2 = pn('d_ltcg2');
  var total1 = stcg1 + ltcg1;
  var total2 = stcg2 + ltcg2;
  var hasYr2 = (stcg2 !== 0 || ltcg2 !== 0);
  var monthly = (hasYr2 && total1 > total2) ? (total1 + total2) / 24 : total1 / 12;

  var rows = [
    ['Schedule D Capital Gains/Losses Income Calculator'],
    [''],
    ['Description', 'Year 1 (Most Recent)', 'Year 2 (Prior)'],
    ['Short-Term Capital Gain/Loss', stcg1, stcg2],
    ['Long-Term Capital Gain/Loss', ltcg1, ltcg2],
    [''],
    ['Year 1 Total', total1, ''],
    ['Year 2 Total', '', total2],
    ['Monthly Income', monthly, ''],
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
  a.download = 'schedule-d-income-' + Date.now() + '.csv';
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
