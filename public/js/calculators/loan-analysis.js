/* =====================================================
   Cover Letter — Cover Page Generator
   ===================================================== */
(function() {
  'use strict';

  var P = MSFG.parseNum;
  var fmt = MSFG.formatCurrency;
  var pct = MSFG.formatPercent;

  var STORAGE_KEY = 'msfg-la-toggles';

  /* ---- Helpers ---- */
  function el(id) { return document.getElementById(id); }

  function totalInterest(principal, annualRate, termYears) {
    if (principal <= 0 || annualRate <= 0 || termYears <= 0) return 0;
    var n = termYears * 12;
    var pmt = MSFG.calcMonthlyPayment(principal, annualRate, termYears);
    return (pmt * n) - principal;
  }

  /* ---- Section Toggle Logic ---- */
  function getToggleState() {
    var state = {};
    var toggles = document.querySelectorAll('.la-section-toggles input[data-toggle]');
    for (var i = 0; i < toggles.length; i++) {
      state[toggles[i].getAttribute('data-toggle')] = toggles[i].checked;
    }
    return state;
  }

  function applyToggles() {
    var state = getToggleState();
    var sections = document.querySelectorAll('[data-section]');
    for (var i = 0; i < sections.length; i++) {
      var key = sections[i].getAttribute('data-section');
      if (typeof state[key] !== 'undefined') {
        sections[i].style.display = state[key] ? '' : 'none';
      }
    }
    // Persist to sessionStorage
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function restoreToggles() {
    try {
      var stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      var state = JSON.parse(stored);
      var toggles = document.querySelectorAll('.la-section-toggles input[data-toggle]');
      for (var i = 0; i < toggles.length; i++) {
        var key = toggles[i].getAttribute('data-toggle');
        if (typeof state[key] !== 'undefined') {
          toggles[i].checked = state[key];
        }
      }
    } catch (e) { /* ignore */ }
  }

  function isSectionEnabled(sectionName) {
    var cb = document.querySelector('input[data-toggle="' + sectionName + '"]');
    return cb ? cb.checked : true;
  }

  /* ---- Read form state ---- */
  function getState() {
    var oldAmount = P(el('laOldAmount').value);
    var oldRate   = P(el('laOldRate').value) / 100;
    var oldTerm   = P(el('laOldTerm').value);
    var oldPIInput = P(el('laOldPayment').value);
    var oldPI     = oldPIInput > 0 ? oldPIInput : MSFG.calcMonthlyPayment(oldAmount, oldRate, oldTerm);
    var oldMI     = P(el('laOldMI').value);
    var oldEscrow = P(el('laOldEscrow').value);

    var newAmount = P(el('laNewAmount').value);
    var newRate   = P(el('laNewRate').value) / 100;
    var newTerm   = P(el('laNewTerm').value);
    var newPIInput = P(el('laNewPayment').value);
    var newPI     = newPIInput > 0 ? newPIInput : MSFG.calcMonthlyPayment(newAmount, newRate, newTerm);
    var newMI     = P(el('laNewMI').value);
    var newEscrow = P(el('laNewEscrow').value);

    return {
      borrower: isSectionEnabled('borrower') ? {
        name: el('laBorrowerName').value.trim(),
        coBorrower: el('laCoBorrowerName').value.trim(),
        street: el('laStreet').value.trim(),
        city: el('laCity').value.trim(),
        state: el('laState').value.trim(),
        zip: el('laZip').value.trim()
      } : null,
      oldLoan: isSectionEnabled('old-loan') ? {
        lender: el('laOldLender').value.trim(),
        type: el('laOldLoanType').value,
        amount: oldAmount,
        rate: oldRate,
        term: oldTerm,
        pi: oldPI,
        mi: oldMI,
        escrow: oldEscrow,
        total: oldPI + oldMI + oldEscrow
      } : null,
      newLoan: isSectionEnabled('new-loan') ? {
        lender: el('laNewLender').value.trim(),
        type: el('laNewLoanType').value,
        amount: newAmount,
        rate: newRate,
        term: newTerm,
        pi: newPI,
        mi: newMI,
        escrow: newEscrow,
        total: newPI + newMI + newEscrow
      } : null,
      closingCosts: isSectionEnabled('closing') ? P(el('laClosingCosts').value) : 0,
      credits: isSectionEnabled('closing') ? P(el('laCredits').value) : 0,
      showClosing: isSectionEnabled('closing'),
      loanOfficer: isSectionEnabled('lo') ? {
        name: el('laLoName').value.trim(),
        nmls: el('laLoNmls').value.trim(),
        phone: el('laLoPhone').value.trim(),
        email: el('laLoEmail').value.trim(),
        company: el('laLoCompany').value.trim()
      } : null,
      notes: isSectionEnabled('notes') ? el('laNotes').value.trim() : ''
    };
  }

  /* ---- Generate / Calculate ---- */
  function generate() {
    var s = getState();
    var resultsEl = el('laResults');

    var oldTotal = s.oldLoan ? s.oldLoan.total : 0;
    var newTotal = s.newLoan ? s.newLoan.total : 0;

    var monthlySavings = oldTotal - newTotal;
    var netCosts = s.closingCosts - s.credits;
    var breakeven = monthlySavings > 0 ? Math.ceil(netCosts / monthlySavings) : 0;

    var oldInterest = s.oldLoan ? totalInterest(s.oldLoan.amount, s.oldLoan.rate, s.oldLoan.term) : 0;
    var newInterest = s.newLoan ? totalInterest(s.newLoan.amount, s.newLoan.rate, s.newLoan.term) : 0;
    var lifetimeSavings = oldInterest - newInterest;

    // Summary cards
    el('laResMonthlySavings').textContent = fmt(monthlySavings);
    el('laResNetCosts').textContent = fmt(netCosts);
    el('laResBreakeven').textContent = breakeven > 0 ? breakeven + ' months' : '--';
    el('laResLifetimeSavings').textContent = fmt(lifetimeSavings);

    // Color-code savings
    el('laResMonthlySavings').style.color = monthlySavings > 0 ? 'var(--brand-primary, #2d6a4f)' : 'var(--color-danger, #dc3545)';
    el('laResLifetimeSavings').style.color = lifetimeSavings > 0 ? 'var(--brand-primary, #2d6a4f)' : 'var(--color-danger, #dc3545)';

    // Comparison table
    if (s.oldLoan) {
      el('laResOldLender').textContent  = s.oldLoan.lender || '--';
      el('laResOldType').textContent    = s.oldLoan.type;
      el('laResOldAmount').textContent  = fmt(s.oldLoan.amount);
      el('laResOldRate').textContent    = pct(s.oldLoan.rate * 100);
      el('laResOldTerm').textContent    = s.oldLoan.term + ' years';
      el('laResOldPI').textContent      = fmt(s.oldLoan.pi);
      el('laResOldMI').textContent      = fmt(s.oldLoan.mi);
      el('laResOldEscrow').textContent  = fmt(s.oldLoan.escrow);
      el('laResOldTotal').innerHTML     = '<strong>' + fmt(s.oldLoan.total) + '</strong>';
    }
    if (s.newLoan) {
      el('laResNewLender').textContent  = s.newLoan.lender || '--';
      el('laResNewType').textContent    = s.newLoan.type;
      el('laResNewAmount').textContent  = fmt(s.newLoan.amount);
      el('laResNewRate').textContent    = pct(s.newLoan.rate * 100);
      el('laResNewTerm').textContent    = s.newLoan.term + ' years';
      el('laResNewPI').textContent      = fmt(s.newLoan.pi);
      el('laResNewMI').textContent      = fmt(s.newLoan.mi);
      el('laResNewEscrow').textContent  = fmt(s.newLoan.escrow);
      el('laResNewTotal').innerHTML     = '<strong>' + fmt(s.newLoan.total) + '</strong>';
    }

    // Notes
    var notesSection = el('laResNotesSection');
    if (s.notes) {
      el('laResNotes').textContent = s.notes;
      notesSection.style.display = '';
    } else {
      notesSection.style.display = 'none';
    }

    resultsEl.style.display = '';
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---- Reset ---- */
  function resetForm() {
    var inputs = document.querySelectorAll('.calc-page input[type="text"], .calc-page input[type="number"], .calc-page input[type="tel"], .calc-page input[type="email"]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].id === 'laLoCompany') continue;
      inputs[i].value = '';
    }
    el('laNotes').value = '';
    // Reset selects to defaults
    el('laOldLoanType').value = 'Conventional';
    el('laNewLoanType').value = 'Conventional';
    el('laOldTerm').value = '30';
    el('laNewTerm').value = '30';
    el('laResults').style.display = 'none';
    // Restore all toggles to checked
    var toggles = document.querySelectorAll('.la-section-toggles input[data-toggle]');
    for (var j = 0; j < toggles.length; j++) {
      toggles[j].checked = true;
    }
    applyToggles();
  }

  /* ---- Init ---- */
  document.addEventListener('DOMContentLoaded', function() {
    el('laGenerateBtn').addEventListener('click', generate);
    el('laResetBtn').addEventListener('click', resetForm);

    // Section toggle listeners
    var toggles = document.querySelectorAll('.la-section-toggles input[data-toggle]');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].addEventListener('change', applyToggles);
    }

    // Restore saved toggle state
    restoreToggles();
    applyToggles();
  });

  // Expose isSectionEnabled for report template extractor
  window.__laSectionEnabled = isSectionEnabled;
})();
