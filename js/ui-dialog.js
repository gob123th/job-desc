// ui-dialog.js — Shared, dependency-free UI layer for the JD app.
// Replaces the browser's native alert() / confirm() / prompt() with accessible,
// animated modal dialogs, and provides a full-screen "lazy loading" overlay used
// while emails / Firestore writes are in flight.
//
// Public API (all on window.JDUI):
//   JDUI.alert(message, opts)   -> Promise<void>        opts: {title, variant, okText}
//   JDUI.confirm(message, opts) -> Promise<boolean>     opts: {title, variant, okText, cancelText}
//   JDUI.prompt(message, opts)  -> Promise<string|null> opts: {title, placeholder, value, okText, cancelText}
//   JDUI.success / .error / .warning / .info(message, opts) -> shorthand alerts
//   JDUI.loading.show(message)  -> shows overlay (returns a handle)
//   JDUI.loading.hide()         -> hides overlay
//   JDUI.loading.during(promiseOrFn, message) -> wraps async work with the overlay
//
// No external dependencies (pure DOM); injects its own styles on load.
window.JDUI = (function () {
    'use strict';

    // ---- One-time stylesheet injection ----------------------------------
    var STYLE = ''
        + '.jdui-root{font-family:"TH Sarabun PSK","Sarabun",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}'
        + '.jdui-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;'
        + 'justify-content:center;padding:20px;background:rgba(17,24,39,.55);backdrop-filter:blur(4px);'
        + '-webkit-backdrop-filter:blur(4px);opacity:0;transition:opacity .2s ease;}'
        + '.jdui-overlay.jdui-show{opacity:1;}'
        + '.jdui-card{width:100%;max-width:420px;background:#fff;border-radius:18px;'
        + 'box-shadow:0 20px 60px rgba(0,0,0,.28),0 4px 12px rgba(0,0,0,.12);'
        + 'padding:28px 26px 22px;text-align:center;transform:translateY(14px) scale(.97);'
        + 'opacity:0;transition:transform .26s cubic-bezier(.16,1,.3,1),opacity .26s ease;'
        + 'box-sizing:border-box;}'
        + '.jdui-overlay.jdui-show .jdui-card{transform:translateY(0) scale(1);opacity:1;}'
        + '.jdui-icon{width:60px;height:60px;border-radius:50%;margin:2px auto 16px;display:flex;'
        + 'align-items:center;justify-content:center;}'
        + '.jdui-icon svg{width:32px;height:32px;stroke-width:2.4;fill:none;stroke-linecap:round;stroke-linejoin:round;}'
        + '.jdui-icon-success{background:#e7f7ee;}.jdui-icon-success svg{stroke:#16a34a;}'
        + '.jdui-icon-error{background:#fdeaea;}.jdui-icon-error svg{stroke:#dc2626;}'
        + '.jdui-icon-warning{background:#fdf3e3;}.jdui-icon-warning svg{stroke:#d97706;}'
        + '.jdui-icon-info{background:#e8eefc;}.jdui-icon-info svg{stroke:#000080;}'
        + '.jdui-icon-question{background:#e8eefc;}.jdui-icon-question svg{stroke:#000080;}'
        + '.jdui-title{font-size:19px;font-weight:700;color:#1f2937;margin:0 0 8px;line-height:1.35;}'
        + '.jdui-msg{font-size:15px;color:#5b6470;line-height:1.6;margin:0 0 22px;word-break:break-word;}'
        + '.jdui-input{width:100%;box-sizing:border-box;padding:12px 14px;font-size:16px;'
        + 'font-family:inherit;border:1.5px solid #d7dbe2;border-radius:11px;margin:0 0 22px;'
        + 'outline:none;transition:border-color .15s,box-shadow .15s;text-align:center;letter-spacing:.5px;}'
        + '.jdui-input:focus{border-color:#000080;box-shadow:0 0 0 3px rgba(0,0,128,.12);}'
        + '.jdui-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}'
        + '.jdui-btn{flex:1 1 auto;min-width:110px;padding:12px 18px;font-size:15px;font-weight:600;'
        + 'font-family:inherit;border-radius:11px;border:1.5px solid transparent;cursor:pointer;'
        + 'transition:transform .08s,box-shadow .15s,background .15s,border-color .15s;}'
        + '.jdui-btn:active{transform:translateY(1px);}'
        + '.jdui-btn-primary{background:#000080;color:#fff;box-shadow:0 4px 12px rgba(0,0,128,.28);}'
        + '.jdui-btn-primary:hover{background:#000066;}'
        + '.jdui-btn-danger{background:#dc2626;color:#fff;box-shadow:0 4px 12px rgba(220,38,38,.28);}'
        + '.jdui-btn-danger:hover{background:#b91c1c;}'
        + '.jdui-btn-ghost{background:#fff;color:#4b5563;border-color:#d7dbe2;}'
        + '.jdui-btn-ghost:hover{background:#f4f5f7;}'
        // ---- Loading overlay ----
        + '.jdui-loading{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;'
        + 'align-items:center;justify-content:center;gap:22px;background:rgba(17,24,39,.62);'
        + 'backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);opacity:0;'
        + 'transition:opacity .22s ease;}'
        + '.jdui-loading.jdui-show{opacity:1;}'
        + '.jdui-spinner{width:62px;height:62px;}'
        + '.jdui-spinner circle{fill:none;stroke:rgba(255,255,255,.22);stroke-width:6;}'
        + '.jdui-spinner .jdui-arc{stroke:#fff;stroke-linecap:round;stroke-dasharray:90 200;'
        + 'transform-origin:center;animation:jdui-spin 1s linear infinite;}'
        + '@keyframes jdui-spin{to{transform:rotate(360deg);}}'
        + '.jdui-loading-text{color:#fff;font-size:16px;font-weight:600;letter-spacing:.3px;'
        + 'text-align:center;max-width:300px;}'
        + '.jdui-loading-dots::after{content:"";animation:jdui-dots 1.4s steps(4,end) infinite;}'
        + '@keyframes jdui-dots{0%{content:"";}25%{content:".";}50%{content:"..";}75%{content:"...";}100%{content:"";}}'
        + '@media (max-width:480px){.jdui-card{padding:24px 20px 18px;}.jdui-actions{flex-direction:column-reverse;}'
        + '.jdui-btn{width:100%;}}';

    function injectStyle() {
        if (document.getElementById('jdui-style')) return;
        var s = document.createElement('style');
        s.id = 'jdui-style';
        s.textContent = STYLE;
        (document.head || document.documentElement).appendChild(s);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectStyle);
    }
    injectStyle();

    // ---- Icons (inline SVG paths per variant) ---------------------------
    var ICONS = {
        success: '<polyline points="20 6 9 17 4 12"></polyline>',
        error: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
        warning: '<path d="M12 9v4"></path><path d="M12 17h.01"></path>'
            + '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path>',
        info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 7h.01"></path>',
        question: '<circle cx="12" cy="12" r="9"></circle>'
            + '<path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .8-1 1.7"></path><path d="M12 17h.01"></path>'
    };

    function iconMarkup(variant) {
        var v = ICONS[variant] ? variant : 'info';
        return '<div class="jdui-icon jdui-icon-' + v + '">'
            + '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[v] + '</svg></div>';
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ---- Core dialog builder --------------------------------------------
    // kind: 'alert' | 'confirm' | 'prompt'
    function open(kind, message, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var variant = opts.variant
                || (kind === 'confirm' ? 'question' : kind === 'prompt' ? 'info' : 'info');
            var defaultTitle = kind === 'confirm' ? 'ยืนยันการทำรายการ'
                : variant === 'success' ? 'สำเร็จ'
                : variant === 'error' ? 'เกิดข้อผิดพลาด'
                : variant === 'warning' ? 'โปรดตรวจสอบ' : 'แจ้งเตือน';
            var title = opts.title != null ? opts.title : defaultTitle;
            var okText = opts.okText || (kind === 'confirm' ? 'ยืนยัน' : 'ตกลง');
            var cancelText = opts.cancelText || 'ยกเลิก';
            var primaryClass = (variant === 'error' || opts.danger) ? 'jdui-btn-danger' : 'jdui-btn-primary';

            var overlay = document.createElement('div');
            overlay.className = 'jdui-overlay jdui-root';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');

            var inputHtml = kind === 'prompt'
                ? '<input class="jdui-input" type="text" value="' + esc(opts.value || '')
                    + '" placeholder="' + esc(opts.placeholder || '') + '" />'
                : '';
            var cancelBtn = (kind === 'confirm' || kind === 'prompt')
                ? '<button type="button" class="jdui-btn jdui-btn-ghost" data-act="cancel">' + esc(cancelText) + '</button>'
                : '';

            overlay.innerHTML = '<div class="jdui-card">'
                + iconMarkup(variant)
                + (title ? '<h2 class="jdui-title">' + esc(title) + '</h2>' : '')
                + '<p class="jdui-msg">' + esc(message) + '</p>'
                + inputHtml
                + '<div class="jdui-actions">' + cancelBtn
                + '<button type="button" class="jdui-btn ' + primaryClass + '" data-act="ok">' + esc(okText) + '</button>'
                + '</div></div>';

            document.body.appendChild(overlay);
            var input = overlay.querySelector('.jdui-input');
            var okBtn = overlay.querySelector('[data-act="ok"]');
            var lastFocus = document.activeElement;

            // Animate in
            requestAnimationFrame(function () { overlay.classList.add('jdui-show'); });

            var done = false;
            function close(result) {
                if (done) return;
                done = true;
                overlay.classList.remove('jdui-show');
                document.removeEventListener('keydown', onKey, true);
                setTimeout(function () {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (e) {}
                    resolve(result);
                }, 220);
            }

            function confirmValue() {
                if (kind === 'prompt') return input ? input.value : '';
                if (kind === 'confirm') return true;
                return undefined;
            }
            function cancelValue() {
                if (kind === 'prompt') return null;
                if (kind === 'confirm') return false;
                return undefined;
            }

            overlay.addEventListener('click', function (e) {
                var act = e.target.getAttribute && e.target.getAttribute('data-act');
                if (act === 'ok') close(confirmValue());
                else if (act === 'cancel') close(cancelValue());
                else if (e.target === overlay && kind !== 'prompt') {
                    // Backdrop click: dismiss (treated as cancel for confirm, ack for alert)
                    close(cancelValue());
                }
            });

            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); close(cancelValue()); }
                else if (e.key === 'Enter') {
                    // Enter confirms unless focus is on the cancel button
                    if (document.activeElement && document.activeElement.getAttribute('data-act') === 'cancel') return;
                    e.preventDefault();
                    close(confirmValue());
                }
            }
            document.addEventListener('keydown', onKey, true);

            setTimeout(function () {
                if (input) { input.focus(); input.select(); }
                else if (okBtn) okBtn.focus();
            }, 60);
        });
    }

    // ---- Loading overlay ------------------------------------------------
    var loadingEl = null;
    var loadingCount = 0;

    function showLoading(message) {
        loadingCount++;
        if (loadingEl) {
            if (message) setLoadingText(message);
            return;
        }
        loadingEl = document.createElement('div');
        loadingEl.className = 'jdui-loading jdui-root';
        loadingEl.setAttribute('role', 'alert');
        loadingEl.setAttribute('aria-busy', 'true');
        loadingEl.innerHTML = ''
            + '<svg class="jdui-spinner" viewBox="0 0 50 50" aria-hidden="true">'
            + '<circle cx="25" cy="25" r="20"></circle>'
            + '<circle class="jdui-arc" cx="25" cy="25" r="20"></circle></svg>'
            + '<div class="jdui-loading-text"><span class="jdui-loading-label">'
            + esc(message || 'กำลังดำเนินการ') + '</span><span class="jdui-loading-dots"></span></div>';
        document.body.appendChild(loadingEl);
        requestAnimationFrame(function () { loadingEl.classList.add('jdui-show'); });
    }

    function setLoadingText(message) {
        if (!loadingEl) return;
        var label = loadingEl.querySelector('.jdui-loading-label');
        if (label) label.textContent = message;
    }

    function hideLoading(force) {
        if (force) loadingCount = 0; else loadingCount = Math.max(0, loadingCount - 1);
        if (loadingCount > 0 || !loadingEl) return;
        var el = loadingEl;
        loadingEl = null;
        el.classList.remove('jdui-show');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }

    // Wrap async work with the loading overlay. Accepts a promise or a function
    // returning a promise. Always hides the overlay when settled.
    function during(work, message) {
        showLoading(message);
        var p;
        try { p = (typeof work === 'function') ? work() : work; }
        catch (e) { hideLoading(); return Promise.reject(e); }
        return Promise.resolve(p).then(
            function (v) { hideLoading(); return v; },
            function (e) { hideLoading(); throw e; }
        );
    }

    return {
        alert: function (m, o) { return open('alert', m, o); },
        confirm: function (m, o) { return open('confirm', m, o); },
        prompt: function (m, o) { return open('prompt', m, o); },
        success: function (m, o) { return open('alert', m, Object.assign({ variant: 'success' }, o || {})); },
        error: function (m, o) { return open('alert', m, Object.assign({ variant: 'error' }, o || {})); },
        warning: function (m, o) { return open('alert', m, Object.assign({ variant: 'warning' }, o || {})); },
        info: function (m, o) { return open('alert', m, Object.assign({ variant: 'info' }, o || {})); },
        loading: { show: showLoading, hide: hideLoading, setText: setLoadingText, during: during }
    };
})();
