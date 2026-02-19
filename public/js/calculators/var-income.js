/* =====================================================
   Variable Income Analyzer
   — Upload zone + Fannie Mae B3-3.1 trending engine
   ===================================================== */
'use strict';

(function () {
  var fmt = MSFG.formatCurrency;
  var pn = MSFG.parseNum;

  // ---- Helpers (engine) ----

  var PAY_PERIODS_PER_YEAR = { WEEKLY: 52, BIWEEKLY: 26, SEMIMONTHLY: 24, MONTHLY: 12 };

  function safeDiv(n, d) { return d ? n / d : 0; }
  function annualToMonthly(a) { return a / 12; }

  function monthsElapsedInYear(asOfISO) {
    var d = new Date(asOfISO + 'T00:00:00');
    return d.getMonth() + 1;
  }

  function ytdToMonthly(ytd, asOfISO) {
    return safeDiv(ytd, monthsElapsedInYear(asOfISO));
  }

  function evaluateTrend(currentMonthly, prior1Monthly, prior2Monthly) {
    var twoYrAvg = prior2Monthly != null ? (prior1Monthly + prior2Monthly) / 2 : prior1Monthly;
    var stableOrUp = currentMonthly >= twoYrAvg - 0.01;

    if (stableOrUp) return { status: 'STABLE_OR_UP', recommendedMonthly: twoYrAvg, note: 'Stable/increasing: use average.' };
    var stabilized = currentMonthly >= prior1Monthly - 0.01;
    if (stabilized) return { status: 'DECLINED_THEN_STABLE', recommendedMonthly: currentMonthly, note: 'Declined then stabilized: use current lower.' };
    return { status: 'DECLINING', recommendedMonthly: currentMonthly, note: 'Declining: manual analysis; do not average over decline.' };
  }

  function addFlag(flags, severity, code, message) {
    flags.push({ severity: severity, code: code, message: message });
  }

  function addDoc(docs, item) {
    if (docs.indexOf(item) === -1) docs.push(item);
  }

  // ---- Fannie Mae Engine (inlined from var-calc.js) ----

  function underwriteVariableIncome(input) {
    var flags = [];
    var docs = [];
    var notes = [];

    addDoc(docs, 'Most recent paystub (\u2264 30 days old) showing YTD earnings');
    addDoc(docs, 'W-2s (most recent 1\u20132 years depending on income type)');

    if (input.employerCount > 1) {
      addDoc(docs, 'Paystubs/W-2s for each employer used to qualify');
      addDoc(docs, 'Verbal VOE for each employer');
      addFlag(flags, 'info', 'MULTIPLE_EMPLOYERS', 'Multiple jobs/employers: separate verification required.');
    }

    if (input.hasEmploymentGap) {
      addDoc(docs, 'Letter of explanation for employment gap(s)');
      addFlag(flags, 'warn', 'GAP', 'Employment gap indicated: underwriter will require explanation and may request additional history.');
    }

    if (input.jobChangedOrNewRole) {
      addDoc(docs, 'Written explanation of job/role change (and impact to OT/bonus/commission)');
      addFlag(flags, 'warn', 'COMP_CHANGE', 'Recent job/role/comp change can affect variable income continuance.');
    }

    var monthlyBase = 0;

    if (input.basePayType === 'SALARY') {
      monthlyBase = annualToMonthly(input.baseRateAnnualOrHourly);
    } else {
      if (input.hoursFluctuate) {
        var current = ytdToMonthly(input.ytd.base, input.asOfDateISO);
        var p1 = input.priorYears[0] ? input.priorYears[0].base / 12 : null;
        var p2 = input.priorYears[1] ? input.priorYears[1].base / 12 : null;

        var tr = evaluateTrend(current, p1 != null ? p1 : current, p2);
        monthlyBase = tr.recommendedMonthly;
        notes.push('Base hourly (fluctuating): ' + tr.note);

        if (tr.status === 'DECLINING') {
          addFlag(flags, 'warn', 'BASE_DECLINING', 'Hourly base appears declining; manual UW analysis likely required.');
        }
      } else {
        if (!input.expectedHoursPerWeek) {
          addFlag(flags, 'stop', 'MISSING_HOURS', 'Hourly base requires expected hours/week when hours are stable.');
        } else {
          monthlyBase = (input.baseRateAnnualOrHourly * input.expectedHoursPerWeek * 52) / 12;
        }
      }
    }

    // YTD sanity check
    var periods = PAY_PERIODS_PER_YEAR[input.payFrequency];
    if (periods && input.payPeriodsYTD > 0) {
      var expectedBaseYTD = null;

      if (input.basePayType === 'SALARY') {
        expectedBaseYTD = (input.baseRateAnnualOrHourly / periods) * input.payPeriodsYTD;
      } else if (!input.hoursFluctuate && input.expectedHoursPerWeek) {
        var weekly = input.baseRateAnnualOrHourly * input.expectedHoursPerWeek;
        var perPeriod =
          input.payFrequency === 'WEEKLY' ? weekly :
          input.payFrequency === 'BIWEEKLY' ? weekly * 2 :
          input.payFrequency === 'SEMIMONTHLY' ? weekly * (52 / 24) :
          weekly * (52 / 12);
        expectedBaseYTD = perPeriod * input.payPeriodsYTD;
      }

      if (expectedBaseYTD != null && expectedBaseYTD > 0 && input.ytd.base > 0) {
        var variance = (input.ytd.base - expectedBaseYTD) / expectedBaseYTD;
        if (Math.abs(variance) >= 0.05) {
          addFlag(flags, 'warn', 'YTD_MISMATCH', 'Base YTD differs from expected by ' + (variance * 100).toFixed(1) + '% (possible gap/unpaid leave/comp change).');
          addDoc(docs, 'Explanation for YTD variance (unpaid leave, schedule change, comp change, etc.)');
        }
      }
    }

    // Variable components
    function handleVar(type, ytdAmount, priorSelector, minMonthsHistory, label) {
      if (ytdAmount <= 0) return 0;

      var cur = ytdToMonthly(ytdAmount, input.asOfDateISO);
      var py1 = input.priorYears[0] ? priorSelector(input.priorYears[0]) / 12 : null;
      var py2 = input.priorYears[1] ? priorSelector(input.priorYears[1]) / 12 : null;

      var monthsAvailableProxy = input.priorYears.length >= 1 ? 24 : 0;
      if (minMonthsHistory && monthsAvailableProxy < minMonthsHistory) {
        addFlag(flags, 'warn', type + '_HISTORY', label + ' history may be insufficient; underwriting may require \u2265' + minMonthsHistory + ' months.');
        addDoc(docs, 'Prior year(s) evidence of ' + label + ' (W-2, VOE, or pay history)');
      }

      var trend = evaluateTrend(cur, py1 != null ? py1 : cur, py2);
      notes.push(label + ': ' + trend.note);

      if (trend.status === 'DECLINING') {
        addFlag(flags, 'warn', type + '_DECLINING', label + ' appears declining; do not average over decline period without analysis.');
      }

      return trend.recommendedMonthly;
    }

    var monthlyOT = handleVar('OT', input.ytd.overtime, function (y) { return y.overtime; }, 12, 'Overtime');
    var monthlyBonus = handleVar('BONUS', input.ytd.bonus, function (y) { return y.bonus; }, 12, 'Bonus');
    var monthlyComm = handleVar('COMM', input.ytd.commission, function (y) { return y.commission; }, 12, 'Commission');

    var monthlyByType = {
      base: monthlyBase,
      overtime: monthlyOT,
      bonus: monthlyBonus,
      commission: monthlyComm
    };

    var monthlyUsable = 0;
    for (var k in monthlyByType) {
      if (monthlyByType.hasOwnProperty(k)) monthlyUsable += (monthlyByType[k] || 0);
    }

    return { monthlyUsable: monthlyUsable, monthlyByType: monthlyByType, docsRequired: docs, flags: flags, notes: notes };
  }

  // ---- DOM Utilities ----

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function valStr(el) { return el ? el.value.trim() : ''; }
  function valNum(el) { return el ? parseFloat(el.value) || 0 : 0; }

  // ---- Employment Panel Management ----

  var container = document.getElementById('employmentsContainer');
  var addBtn = document.getElementById('addEmploymentBtn');
  var calcBtn = document.getElementById('calculateBtn');
  var resetBtn = document.getElementById('resetBtn');
  var resultsSection = document.getElementById('resultsSection');

  function getPanels() { return $$('.employment-panel', container); }

  function reindexPanels() {
    getPanels().forEach(function (panel, i) {
      panel.setAttribute('data-emp-index', i);
      $('.emp-panel-title', panel).textContent = 'Employment ' + (i + 1);
      var removeBtn = $('.remove-emp-btn', panel);
      if (removeBtn) removeBtn.style.display = i === 0 ? 'none' : '';
      // Update upload zone index
      var uz = $('.upload-zone', panel);
      if (uz) uz.setAttribute('data-emp-index', i);
    });
    updatePriorYearLabels();
  }

  function updatePriorYearLabels() {
    var currentYear = new Date().getFullYear();
    $$('.emp-prior-year-label-1').forEach(function (el) { el.textContent = currentYear - 1; });
    $$('.emp-prior-year-label-2').forEach(function (el) { el.textContent = currentYear - 2; });
  }

  function initPayTypeToggle(panel) {
    var payTypeSelect = $('.emp-pay-type', panel);
    var hourlyFields = $('.emp-hourly-fields', panel);
    var rateLabel = $('.emp-rate-label', panel);

    function toggle() {
      var isHourly = payTypeSelect.value === 'HOURLY';
      hourlyFields.style.display = isHourly ? '' : 'none';
      rateLabel.textContent = isHourly ? 'Hourly Rate' : 'Annual Salary';
    }

    payTypeSelect.addEventListener('change', toggle);
    toggle();
  }

  function initUploadZone(panel) {
    var zone = $('.upload-zone', panel);
    if (!zone) return;

    var fileInput = $('.upload-zone__input', zone);
    var statusEl = $('.upload-zone__status', zone);

    // Click to upload
    zone.addEventListener('click', function (e) {
      if (e.target === fileInput || zone.classList.contains('processing')) return;
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      if (fileInput.files.length > 0) processFile(fileInput.files[0], panel, zone, statusEl);
    });

    // Drag and drop
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
        processFile(e.dataTransfer.files[0], panel, zone, statusEl);
      }
    });
  }

  function processFile(file, panel, zone, statusEl) {
    // Validate file type
    var allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (allowed.indexOf(file.type) === -1) {
      setZoneStatus(zone, statusEl, 'error', 'Unsupported file type. Use PNG, JPG, WebP, or PDF.');
      return;
    }

    // Show loading state
    setZoneStatus(zone, statusEl, 'loading', '<span class="spinner"></span> Analyzing paystub...');
    zone.classList.add('processing');
    zone.classList.remove('has-data', 'has-error');

    var formData = new FormData();
    formData.append('file', file);
    formData.append('slug', 'var-income');

    fetch('/api/ai/extract', { method: 'POST', body: formData })
      .then(function (resp) { return resp.json(); })
      .then(function (result) {
        zone.classList.remove('processing');
        if (result.success && result.data) {
          populatePanel(panel, result.data);
          setZoneStatus(zone, statusEl, 'success', 'Fields populated from paystub. Please verify.');
          zone.classList.add('has-data');
        } else {
          setZoneStatus(zone, statusEl, 'error', result.message || 'AI extraction failed.');
          zone.classList.add('has-error');
        }
      })
      .catch(function (err) {
        zone.classList.remove('processing');
        setZoneStatus(zone, statusEl, 'error', 'Network error: ' + err.message);
        zone.classList.add('has-error');
      });
  }

  function setZoneStatus(zone, statusEl, type, html) {
    statusEl.className = 'upload-zone__status';
    if (type === 'loading') statusEl.className += ' status--loading';
    else if (type === 'success') statusEl.className += ' status--success';
    else if (type === 'error') statusEl.className += ' status--error';
    statusEl.innerHTML = html;
  }

  function populatePanel(panel, data) {
    if (data.employerName) $('.emp-employer-name', panel).value = data.employerName;
    if (data.position) $('.emp-position', panel).value = data.position;

    if (data.payType) {
      var payTypeSelect = $('.emp-pay-type', panel);
      payTypeSelect.value = data.payType;
      payTypeSelect.dispatchEvent(new Event('change'));
    }

    if (data.payFrequency) $('.emp-pay-frequency', panel).value = data.payFrequency;

    if (data.baseRate != null) $('.emp-base-rate', panel).value = data.baseRate;
    if (data.hoursPerWeek != null) $('.emp-hours-per-week', panel).value = data.hoursPerWeek;
    if (data.asOfDate) $('.emp-as-of-date', panel).value = data.asOfDate;
    if (data.payPeriodsYTD != null) $('.emp-pay-periods-ytd', panel).value = data.payPeriodsYTD;

    if (data.ytdBase != null) $('.emp-ytd-base', panel).value = data.ytdBase;
    if (data.ytdOvertime != null) $('.emp-ytd-overtime', panel).value = data.ytdOvertime;
    if (data.ytdBonus != null) $('.emp-ytd-bonus', panel).value = data.ytdBonus;
    if (data.ytdCommission != null) $('.emp-ytd-commission', panel).value = data.ytdCommission;
    if (data.ytdOther != null) $('.emp-ytd-other', panel).value = data.ytdOther;
  }

  function clonePanel() {
    var template = getPanels()[0];
    var clone = template.cloneNode(true);

    // Clear all input values
    $$('input[type="text"], input[type="number"], input[type="date"]', clone).forEach(function (inp) { inp.value = ''; });
    $$('select', clone).forEach(function (sel) { sel.selectedIndex = 0; });
    $$('input[type="checkbox"]', clone).forEach(function (cb) { cb.checked = false; });

    // Reset upload zone
    var zone = $('.upload-zone', clone);
    if (zone) {
      zone.classList.remove('has-data', 'has-error', 'processing');
      var status = $('.upload-zone__status', zone);
      if (status) { status.className = 'upload-zone__status'; status.innerHTML = ''; }
    }

    // Reset hourly fields
    var hourlyFields = $('.emp-hourly-fields', clone);
    if (hourlyFields) hourlyFields.style.display = 'none';
    var rateLabel = $('.emp-rate-label', clone);
    if (rateLabel) rateLabel.textContent = 'Annual Salary';

    container.appendChild(clone);
    reindexPanels();
    initPayTypeToggle(clone);
    initUploadZone(clone);

    // Bind remove button
    var removeBtn = $('.remove-emp-btn', clone);
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        clone.remove();
        reindexPanels();
      });
    }
  }

  // ---- Gather Input from Panel ----

  function gatherPanelInput(panel) {
    var payType = valStr($('.emp-pay-type', panel));
    var payFreq = valStr($('.emp-pay-frequency', panel));
    var baseRate = valNum($('.emp-base-rate', panel));
    var hoursPerWeek = valNum($('.emp-hours-per-week', panel)) || null;
    var hoursFluctuate = $('.emp-hours-fluctuate', panel).checked;
    var asOfDate = valStr($('.emp-as-of-date', panel));
    var payPeriodsYTD = valNum($('.emp-pay-periods-ytd', panel));
    var compChange = $('.emp-comp-change', panel).checked;

    // Use today if no as-of date entered
    if (!asOfDate) {
      var today = new Date();
      asOfDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    }

    var priorYears = [];
    var p1Base = valNum($('.emp-prior1-base', panel));
    var p1OT = valNum($('.emp-prior1-overtime', panel));
    var p1Bonus = valNum($('.emp-prior1-bonus', panel));
    var p1Comm = valNum($('.emp-prior1-commission', panel));
    if (p1Base > 0 || p1OT > 0 || p1Bonus > 0 || p1Comm > 0) {
      priorYears.push({ year: new Date().getFullYear() - 1, base: p1Base, overtime: p1OT, bonus: p1Bonus, commission: p1Comm });
    }

    var p2Base = valNum($('.emp-prior2-base', panel));
    var p2OT = valNum($('.emp-prior2-overtime', panel));
    var p2Bonus = valNum($('.emp-prior2-bonus', panel));
    var p2Comm = valNum($('.emp-prior2-commission', panel));
    if (p2Base > 0 || p2OT > 0 || p2Bonus > 0 || p2Comm > 0) {
      priorYears.push({ year: new Date().getFullYear() - 2, base: p2Base, overtime: p2OT, bonus: p2Bonus, commission: p2Comm });
    }

    return {
      employerName: valStr($('.emp-employer-name', panel)),
      asOfDateISO: asOfDate,
      basePayType: payType,
      payFrequency: payFreq,
      baseRateAnnualOrHourly: baseRate,
      expectedHoursPerWeek: hoursPerWeek,
      hoursFluctuate: hoursFluctuate,
      payPeriodsYTD: payPeriodsYTD,
      ytd: {
        base: valNum($('.emp-ytd-base', panel)),
        overtime: valNum($('.emp-ytd-overtime', panel)),
        bonus: valNum($('.emp-ytd-bonus', panel)),
        commission: valNum($('.emp-ytd-commission', panel))
      },
      priorYears: priorYears,
      employerCount: 1, // set properly at aggregate level
      jobChangedOrNewRole: compChange,
      hasEmploymentGap: false
    };
  }

  // ---- Calculate & Render Results ----

  function calculate() {
    var panels = getPanels();
    var allResults = [];
    var totalBase = 0, totalOT = 0, totalBonus = 0, totalComm = 0;
    var allFlags = [];
    var allDocs = [];
    var allNotes = [];
    var calcSteps = [];

    panels.forEach(function (panel, i) {
      var input = gatherPanelInput(panel);
      input.employerCount = panels.length;

      var result = underwriteVariableIncome(input);
      result.employerName = input.employerName || ('Employment ' + (i + 1));
      allResults.push(result);

      totalBase += result.monthlyByType.base;
      totalOT += result.monthlyByType.overtime;
      totalBonus += result.monthlyByType.bonus;
      totalComm += result.monthlyByType.commission;

      // Merge flags and docs
      result.flags.forEach(function (f) {
        var dup = allFlags.some(function (ef) { return ef.code === f.code && ef.message === f.message; });
        if (!dup) allFlags.push(f);
      });
      result.docsRequired.forEach(function (d) {
        if (allDocs.indexOf(d) === -1) allDocs.push(d);
      });
      result.notes.forEach(function (n) {
        allNotes.push('[' + result.employerName + '] ' + n);
      });

      // Build calc steps for this employment
      calcSteps.push('<strong>' + result.employerName + '</strong>');
      calcSteps.push('  Base: ' + fmt(result.monthlyByType.base) + '/mo');
      if (result.monthlyByType.overtime > 0) calcSteps.push('  Overtime: ' + fmt(result.monthlyByType.overtime) + '/mo');
      if (result.monthlyByType.bonus > 0) calcSteps.push('  Bonus: ' + fmt(result.monthlyByType.bonus) + '/mo');
      if (result.monthlyByType.commission > 0) calcSteps.push('  Commission: ' + fmt(result.monthlyByType.commission) + '/mo');
      calcSteps.push('  Subtotal: ' + fmt(result.monthlyUsable) + '/mo');
      calcSteps.push('');
    });

    var totalVariable = totalOT + totalBonus + totalComm;
    var totalMonthly = totalBase + totalVariable;

    // Summary cards
    document.getElementById('resultMonthlyBase').textContent = fmt(totalBase);
    document.getElementById('resultMonthlyVariable').textContent = fmt(totalVariable);
    document.getElementById('resultMonthlyTotal').textContent = fmt(totalMonthly);
    document.getElementById('resultQualifyingIncome').textContent = fmt(totalMonthly);

    // Per-employment breakdown tables
    var breakdownContainer = document.getElementById('empBreakdownContainer');
    breakdownContainer.innerHTML = '';

    allResults.forEach(function (r) {
      var div = document.createElement('div');
      div.className = 'calc-section emp-breakdown';

      var html = '<h3>' + escHtml(r.employerName) + ' — Income Breakdown</h3>';
      html += '<table class="breakdown-table">';
      html += '<thead><tr><th>Type</th><th>Monthly</th><th>Annual</th><th>Trend</th></tr></thead>';
      html += '<tbody>';

      var types = [
        { key: 'base', label: 'Base' },
        { key: 'overtime', label: 'Overtime' },
        { key: 'bonus', label: 'Bonus' },
        { key: 'commission', label: 'Commission' }
      ];

      types.forEach(function (t) {
        var monthly = r.monthlyByType[t.key] || 0;
        if (monthly > 0 || t.key === 'base') {
          var trendNote = '';
          r.notes.forEach(function (n) {
            if (n.indexOf(t.label) === 0) {
              if (n.indexOf('Stable') !== -1 || n.indexOf('increasing') !== -1) trendNote = '<span class="trend-stable">Stable/Up</span>';
              else if (n.indexOf('Declining') !== -1) trendNote = '<span class="trend-declining">Declining</span>';
              else if (n.indexOf('stabilized') !== -1) trendNote = '<span class="trend-stable">Stabilized</span>';
            }
          });
          html += '<tr><td>' + t.label + '</td><td>' + fmt(monthly) + '</td><td>' + fmt(monthly * 12) + '</td><td>' + (trendNote || '\u2014') + '</td></tr>';
        }
      });

      html += '<tr><td><strong>Total</strong></td><td><strong>' + fmt(r.monthlyUsable) + '</strong></td><td><strong>' + fmt(r.monthlyUsable * 12) + '</strong></td><td></td></tr>';
      html += '</tbody></table>';
      div.innerHTML = html;
      breakdownContainer.appendChild(div);
    });

    // Flags
    var flagsContainer = document.getElementById('flagsContainer');
    if (allFlags.length === 0) {
      flagsContainer.innerHTML = '<p style="font-size: 0.85rem; color: var(--color-gray-500);">No flags or observations.</p>';
    } else {
      var flagHtml = '<ul class="flag-list">';
      allFlags.forEach(function (f) {
        flagHtml += '<li class="flag-item flag-item--' + f.severity + '">';
        flagHtml += '<span class="flag-badge">' + f.severity + '</span>';
        flagHtml += '<span>' + escHtml(f.message) + '</span>';
        flagHtml += '</li>';
      });
      flagHtml += '</ul>';
      flagsContainer.innerHTML = flagHtml;
    }

    // Documentation
    var docsContainer = document.getElementById('docsContainer');
    if (allDocs.length === 0) {
      docsContainer.innerHTML = '<p style="font-size: 0.85rem; color: var(--color-gray-500);">No additional documentation required.</p>';
    } else {
      var docHtml = '<ul class="doc-list">';
      allDocs.forEach(function (d) {
        docHtml += '<li>' + escHtml(d) + '</li>';
      });
      docHtml += '</ul>';
      docsContainer.innerHTML = docHtml;
    }

    // Calc steps
    var stepsEl = document.getElementById('calcSteps-var-income');
    if (stepsEl) {
      var stepsHtml = '<pre style="white-space: pre-wrap; font-size: 0.85rem; line-height: 1.6;">';
      calcSteps.forEach(function (line) { stepsHtml += line + '\n'; });
      if (allNotes.length > 0) {
        stepsHtml += '\nTrending Notes:\n';
        allNotes.forEach(function (n) { stepsHtml += '  \u2022 ' + escHtml(n) + '\n'; });
      }
      stepsHtml += '</pre>';
      stepsEl.innerHTML = stepsHtml;
    }

    resultsSection.style.display = '';
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function escHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function resetAll() {
    // Remove extra panels
    var panels = getPanels();
    for (var i = panels.length - 1; i > 0; i--) {
      panels[i].remove();
    }

    // Clear first panel
    var first = getPanels()[0];
    $$('input[type="text"], input[type="number"], input[type="date"]', first).forEach(function (inp) { inp.value = ''; });
    $$('select', first).forEach(function (sel) { sel.selectedIndex = 0; });
    $$('input[type="checkbox"]', first).forEach(function (cb) { cb.checked = false; });

    // Reset upload zone
    var zone = $('.upload-zone', first);
    if (zone) {
      zone.classList.remove('has-data', 'has-error', 'processing');
      var status = $('.upload-zone__status', zone);
      if (status) { status.className = 'upload-zone__status'; status.innerHTML = ''; }
    }

    // Reset hourly fields display
    var hourlyFields = $('.emp-hourly-fields', first);
    if (hourlyFields) hourlyFields.style.display = 'none';
    var rateLabel = $('.emp-rate-label', first);
    if (rateLabel) rateLabel.textContent = 'Annual Salary';

    resultsSection.style.display = 'none';
    reindexPanels();
  }

  // ---- Initialize ----

  // Init first panel
  var firstPanel = getPanels()[0];
  initPayTypeToggle(firstPanel);
  initUploadZone(firstPanel);
  updatePriorYearLabels();

  // Bind first panel's remove button (hidden for index 0)
  var firstRemoveBtn = $('.remove-emp-btn', firstPanel);
  if (firstRemoveBtn) {
    firstRemoveBtn.addEventListener('click', function () {
      // Should never fire for index 0, but safety
    });
  }

  // Add employment button
  addBtn.addEventListener('click', clonePanel);

  // Calculate button
  calcBtn.addEventListener('click', calculate);

  // Reset button
  resetBtn.addEventListener('click', resetAll);

})();
