// Central error/event log for the JD app.
//
// WHY: every outbound call in this app (Gmail via Apps Script, Firestore writes,
// the AI generator) used to report failures with console.error() only — which is
// gone the moment the user closes the tab. When someone says "I submitted it and
// nothing happened", there was no way to find out what actually broke. This layer
// writes those events to Firestore so admin.html can show them.
//
// Firestore layout:
//   app_logs/{autoId} -> { ts, level, service, action, ok, code, message, jdId, page }
//
// RULES OF THIS MODULE
//   1. Logging must NEVER break the flow it is observing. Every call is
//      fire-and-forget and swallows its own errors — a failed log write must not
//      turn a successful form submission into an error dialog.
//   2. Errors and warnings are always written. Successes are written compactly
//      (no payload echo) so the collection does not balloon; admin.html has a
//      "delete logs older than N days" button for upkeep.
//
// Used by: mailjs-config.js, script.js, sign.js, approval.js, preview.js,
//          ai-generate.js, admin.js
window.JDLog = (function () {
    'use strict';

    const COLLECTION = 'app_logs';

    // Keep messages short: they are read in a list, and an unbounded string from a
    // stack trace could push the document toward Firestore's 1 MiB limit.
    const MAX_MESSAGE = 500;

    function trim(v, max) {
        const s = (v === null || v === undefined) ? '' : String(v);
        return s.length > max ? s.slice(0, max) + '…' : s;
    }

    // The current page file name ("index.html"), used to locate where a failure
    // happened without storing the full URL (which carries the document id and
    // would put a capability URL into a log row).
    function currentPage() {
        try {
            const parts = window.location.pathname.split('/');
            return parts[parts.length - 1] || 'index.html';
        } catch (e) {
            return '';
        }
    }

    // ── Noise control ──
    // The same fault usually fires repeatedly: a broken page init throws once per
    // element it touches, and a failure inside a loop throws once per iteration. One
    // row per distinct problem is what makes the log readable; the rest is the same
    // information again, and each copy costs a Firestore write.
    //
    // Both limits are per page load, so reloading the page reports the problem again
    // — a fault that comes back is worth seeing.
    const seen = {};                 // dedup key -> true
    const MAX_ROWS_PER_LOAD = 25;    // ceiling for a runaway loop
    let written = 0;

    function isDuplicate(entry) {
        // Successes are counted events, not problems — never collapse them.
        if (entry.ok === true) return false;
        const key = [entry.level, entry.service, entry.action, entry.message].join('|');
        if (seen[key]) return true;
        seen[key] = true;
        return false;
    }

    // Write one row. Returns a promise that never rejects — see rule 1 above.
    function write(entry) {
        try {
            if (typeof db === 'undefined' || !db) return Promise.resolve();
            if (isDuplicate(entry)) return Promise.resolve();
            if (written >= MAX_ROWS_PER_LOAD) return Promise.resolve();
            written++;

            const row = {
                ts: firebase.firestore.FieldValue.serverTimestamp(),
                level: entry.level || 'info',
                service: entry.service || 'app',
                action: trim(entry.action, 80),
                ok: entry.ok === true,
                code: trim(entry.code, 40),
                message: trim(entry.message, MAX_MESSAGE),
                jdId: trim(entry.jdId, 64),
                page: currentPage()
            };

            return db.collection(COLLECTION).add(row).catch(function (err) {
                // Nothing left to do but say so locally — writing a log about a
                // failed log write would recurse.
                console.warn('JDLog: could not write log entry', err);
            });
        } catch (err) {
            console.warn('JDLog: could not write log entry', err);
            return Promise.resolve();
        }
    }

    // Turn whatever was thrown (Error, string, Firestore error, GAS response)
    // into the { code, message } pair the log stores.
    function describe(err) {
        if (!err) return { code: '', message: '' };
        if (typeof err === 'string') return { code: '', message: err };
        return {
            code: err.code || err.status || '',
            message: err.message || String(err)
        };
    }

    return {
        // Success path. Deliberately terse — we only need to know it happened.
        //   JDLog.ok('mail', 'sendApproval', { jdId: id, message: 'quota left 37' })
        ok: function (service, action, extra) {
            return write(Object.assign({ level: 'info', service: service, action: action, ok: true }, extra || {}));
        },

        // Something did not work but the user can still continue (e.g. the email
        // went to the queue instead of going out now).
        warn: function (service, action, err, extra) {
            const d = describe(err);
            return write(Object.assign({ level: 'warn', service: service, action: action, ok: false }, d, extra || {}));
        },

        // Something failed.
        //   JDLog.error('firestore', 'createSubmission', err, { jdId: id })
        error: function (service, action, err, extra) {
            const d = describe(err);
            return write(Object.assign({ level: 'error', service: service, action: action, ok: false }, d, extra || {}));
        },

        // Free-form escape hatch when the three helpers above don't fit.
        event: write,

        // Catch what no try/catch caught. Called once per page (bottom of this
        // file) so a hard JS error still leaves a trace an admin can read.
        installGlobalHandlers: function () {
            window.addEventListener('error', function (e) {
                // "Script error." with no filename is the browser censoring an error
                // thrown by a cross-origin script. The CDN <script> tags carry
                // crossorigin="anonymous" so the real message comes through; if this
                // still appears, a script is being served without CORS headers and
                // the details are simply not available to us.
                const censored = e.message === 'Script error.' && !e.filename;
                write({
                    level: 'error',
                    service: 'app',
                    action: censored ? 'uncaught:cross-origin' : 'uncaught',
                    message: censored
                        ? 'เบราว์เซอร์ปิดบังรายละเอียด (error จากสคริปต์ข้ามโดเมนที่ไม่ได้ตั้ง CORS) — ดูข้อความจริงได้ใน DevTools Console'
                        : (e.message || 'error') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0)
                });
            });
            window.addEventListener('unhandledrejection', function (e) {
                const d = describe(e.reason);
                write({
                    level: 'error',
                    service: 'app',
                    action: 'unhandledRejection',
                    code: d.code,
                    message: d.message
                });
            });
        }
    };
})();

JDLog.installGlobalHandlers();
