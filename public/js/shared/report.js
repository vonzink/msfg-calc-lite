/* =====================================================
   MSFG Report Manager
   Captures calculator snapshots and manages session report
   ===================================================== */

(function() {
  'use strict';

  var STORAGE_KEY = 'msfg-report-items';
  var MAX_ITEMS = 30;

  window.MSFG = window.MSFG || {};

  MSFG.Report = {

    getItems: function() {
      try {
        var data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
      } catch (e) {
        return [];
      }
    },

    addItem: function(item) {
      var items = this.getItems();
      items.push({
        id: 'rpt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        name: item.name || 'Calculator',
        icon: item.icon || '',
        timestamp: new Date().toISOString(),
        imageData: item.imageData || ''
      });
      if (items.length > MAX_ITEMS) items = items.slice(items.length - MAX_ITEMS);
      this._save(items);
      this._updateBadge();
      return items[items.length - 1].id;
    },

    removeItem: function(id) {
      var items = this.getItems().filter(function(i) { return i.id !== id; });
      this._save(items);
      this._updateBadge();
    },

    clear: function() {
      localStorage.removeItem(STORAGE_KEY);
      this._updateBadge();
    },

    getCount: function() {
      return this.getItems().length;
    },

    _save: function(items) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      } catch (e) {
        if (items.length > 1) {
          items.shift();
          this._save(items);
        }
      }
    },

    _updateBadge: function() {
      var badge = document.getElementById('reportBadge');
      if (!badge) return;
      var count = this.getCount();
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    },

    /**
     * Capture a DOM element as a JPEG data URL using html2canvas.
     */
    captureElement: function(element, options) {
      options = options || {};
      if (typeof html2canvas === 'undefined') {
        return Promise.reject(new Error('html2canvas not loaded'));
      }
      return html2canvas(element, {
        useCORS: true,
        allowTaint: true,
        scale: options.scale || 1.5,
        backgroundColor: '#ffffff',
        logging: false
      }).then(function(canvas) {
        return canvas.toDataURL('image/jpeg', options.quality || 0.65);
      });
    },

    /**
     * Show a toast notification
     */
    _showToast: function(message, type) {
      var toast = document.createElement('div');
      toast.className = 'report-toast report-toast--' + (type || 'success');
      toast.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
        '<span>' + message + '</span>';
      document.body.appendChild(toast);
      requestAnimationFrame(function() { toast.classList.add('show'); });
      setTimeout(function() {
        toast.classList.remove('show');
        setTimeout(function() { toast.remove(); }, 300);
      }, 2500);
    },

    /**
     * Main capture for a calculator page.
     * Tries iframe content first, then falls back to page content.
     */
    captureCurrentCalculator: function(calcName, calcIcon) {
      var self = this;
      var target = null;
      var iframe = document.querySelector('.calc-page__body iframe');

      if (iframe) {
        try {
          var iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
          if (iframeDoc && iframeDoc.body) {
            target = iframeDoc.body;
          }
        } catch (e) { /* cross-origin fallback */ }
      }

      if (!target) {
        target = document.querySelector('.calc-page__body') ||
                 document.querySelector('.calc-page') ||
                 document.querySelector('.site-main');
      }

      if (!target) {
        return Promise.reject(new Error('No capturable content found'));
      }

      return self.captureElement(target).then(function(imageData) {
        self.addItem({ name: calcName, icon: calcIcon, imageData: imageData });
        self._showToast('Added to report');
      });
    }
  };

  /* ---- Auto-inject "Add to Report" button on calculator pages ---- */
  document.addEventListener('DOMContentLoaded', function() {
    MSFG.Report._updateBadge();

    // Only inject on calculator pages
    var calcHeader = document.querySelector('.calc-page__header');
    if (!calcHeader) return;

    // Get calculator name from the page heading
    var h1 = calcHeader.querySelector('h1');
    var calcName = h1 ? h1.textContent.trim() : document.title;

    // Try to get the icon from the page config (injected by EJS)
    var calcIcon = '';
    if (typeof window.__calcIcon !== 'undefined') {
      calcIcon = window.__calcIcon;
    }

    // Create the icon button
    var btn = document.createElement('button');
    btn.className = 'report-add-btn';
    btn.title = 'Add to Report';
    var defaultSvg =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<polyline points="14 2 14 8 20 8"/>' +
        '<line x1="12" y1="18" x2="12" y2="12"/>' +
        '<line x1="9" y1="15" x2="15" y2="15"/>' +
      '</svg>';
    btn.innerHTML = defaultSvg;

    btn.addEventListener('click', function() {
      btn.disabled = true;
      btn.innerHTML =
        '<svg class="report-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="31.4 31.4" stroke-dashoffset="0"/></svg>';

      MSFG.Report.captureCurrentCalculator(calcName, calcIcon).then(function() {
        btn.disabled = false;
        btn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
        btn.style.color = 'var(--brand-primary)';
        btn.style.borderColor = 'var(--brand-primary)';
        setTimeout(function() {
          btn.innerHTML = defaultSvg;
          btn.style.color = '';
          btn.style.borderColor = '';
        }, 1500);
      }).catch(function(err) {
        console.error('Report capture failed:', err);
        btn.disabled = false;
        btn.innerHTML = defaultSvg;
        MSFG.Report._showToast('Capture failed — try again', 'error');
      });
    });

    // Insert button into the header area
    var headerWrapper = document.createElement('div');
    headerWrapper.className = 'calc-page__header-actions';
    headerWrapper.appendChild(btn);
    calcHeader.appendChild(headerWrapper);
  });
})();
