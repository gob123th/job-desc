// Email sending via Google Apps Script Web App (Gmail backend)
// The GAS web app receives a POST and calls GmailApp.sendEmail().
// Frontend keeps the same global function names so callers don't change.
//
// ───────────────────────── The quota problem ─────────────────────────
// The Gmail account behind the Apps Script can send to at most 100 recipients per
// day and that ceiling cannot be raised on a consumer account. A batch of ~100
// employee JDs needs more than that, so running out mid-batch is normal operation,
// not an exception.
//
// Therefore every send goes through sendOrQueue(): it tries to send now, and when
// the cap is reached it writes the message to the `mail_queue` collection instead.
// An hourly Apps Script trigger (see apps-script/Code.gs → drainQueue) sends the
// backlog as quota frees up.
//
// What the user is told is deliberately free of the word "quota" — from their side
// nothing failed, the document is saved and the email goes out on the next day.
const MAILJS_CONFIG = {
    // Google Apps Script Web App URL (deployed as "Anyone" access)
    webAppUrl: 'https://script.google.com/macros/s/AKfycbw1UMmOy2KfEBUWpLiiDBL8FxqKQOpAqdkuA-XZSJFe3ibkBguZBks0no4EwDw5iRfppw/exec',
    // Must match SHARED_SECRET in the Apps Script project
    token: 'jd2026-b8151ae17e08ed1bd62ebe1982f65197',
    defaultTo: 'alisa@cclcolossal.com',
    approvalTo: 'alisa.cclcolossal@gmail.com'
};
window.MAILJS_CONFIG = MAILJS_CONFIG;

// Queue ordering. Lower runs first when the drainer has limited quota: an employee
// waiting on a signing link is blocked, an approver/HR notice is not (they can see
// everything in the admin console anyway).
const MAIL_PRIORITY = { employee_ack: 1, approval: 3, hr: 5 };

// Escape every non-ASCII character as a \uXXXX sequence so the request body is
// pure ASCII. Apps Script does not reliably honour the charset of a text/plain POST
// body and may decode our UTF-8 bytes as Latin-1; with an ASCII-only body there are
// no multi-byte sequences left to misread, and JSON.parse() on the Apps Script side
// restores the original Thai text regardless of which charset it assumed.
function toAsciiJson(obj) {
    return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, function (ch) {
        return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
    });
}

function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Identifier for one logical email, used to make retries idempotent.
// crypto.randomUUID is not available over plain HTTP or on older browsers, so fall
// back to a timestamp plus randomness — this only has to be unique among the
// handful of messages one browser sends within a 10-minute window.
function newMessageId() {
    try {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Last quota figure the Apps Script reported, so callers (and the admin badge) can
// read it without paying for another round trip. -1 = not known yet.
let lastRemaining = -1;

// Pull the JD document id out of a review URL ("approval.html?id=ABC" → "ABC") so
// log rows and queue entries can point back at the document without every call
// site having to pass the id down.
function jdIdFromUrl(url) {
    const m = /[?&]id=([^&]+)/.exec(String(url || ''));
    return m ? decodeURIComponent(m[1]) : '';
}

// One POST attempt. Resolves with the parsed response, or rejects with an error
// carrying:
//   err.code      — the Apps Script error code (QUOTA_EXCEEDED / BAD_RECIPIENT / …)
//   err.retriable — true only when the mail was certainly NOT sent (network / 5xx),
//                   so an immediate retry cannot produce a duplicate email.
function postOnce(body) {
    return fetch(MAILJS_CONFIG.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body
    }).then(function (res) {
        return res.text().then(function (text) {
            if (!res.ok) {
                const err = new Error('Mail web app HTTP ' + res.status);
                err.code = 'HTTP_' + res.status;
                err.retriable = res.status >= 500;
                throw err;
            }
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                // GAS answered with HTML — almost always the sign-in page, i.e.
                // the deployment is not shared as "Anyone". Retrying won't help.
                const err = new Error('Mail web app returned a non-JSON response (check that the deployment is accessible to "Anyone")');
                err.code = 'NOT_DEPLOYED';
                throw err;
            }

            if (typeof data.remaining === 'number') lastRemaining = data.remaining;

            if (!data || !data.ok) {
                const err = new Error((data && data.error) || 'Mail send failed');
                err.code = (data && data.code) || 'SEND_FAILED';
                err.retriable = false;
                throw err;
            }
            return data;
        });
    }, function (netErr) {
        netErr.code = 'NETWORK';
        netErr.retriable = true;
        throw netErr;
    });
}

// Low-level sender: POSTs to the GAS web app, retrying only transient failures.
function postWithRetry(payload) {
    if (!window.MAILJS_CONFIG || !MAILJS_CONFIG.webAppUrl) {
        return Promise.reject(new Error('Mail web app not configured'));
    }
    // One id per logical message, generated ONCE and reused by every retry of this
    // same body. A retry fires when the response never arrived — but "no response"
    // does not mean "not sent": Apps Script may have delivered the mail and then
    // failed to answer. The id lets the script recognise the repeat and skip it, so
    // a retry can no longer cost a duplicate email (or a wasted slot of the 100/day).
    const body = toAsciiJson(Object.assign({
        token: MAILJS_CONFIG.token,
        msg_id: newMessageId()
    }, payload));
    const backoffMs = [800, 2500];

    function attempt(i) {
        return postOnce(body).catch(function (err) {
            if (!err.retriable || i >= backoffMs.length) throw err;
            console.warn('Mail send attempt ' + (i + 1) + ' failed, retrying', err);
            return delay(backoffMs[i]).then(function () { return attempt(i + 1); });
        });
    }
    return attempt(0);
}

// Append one message to mail_queue for the hourly Apps Script trigger to pick up.
// Field names and types must match the `mail_queue` rule in firestore.rules.
function enqueue(payload, meta) {
    return db.collection('mail_queue').add({
        to: payload.to || '',
        subject: payload.subject || '',
        requesterName: payload.requester_name || '',
        reviewUrl: payload.review_url || '',
        accessCode: payload.access_code || '',
        kind: meta.kind,
        priority: MAIL_PRIORITY[meta.kind] || 5,
        jdId: meta.jdId || '',
        status: 'PENDING',
        attempts: 0,
        lastError: meta.reason || '',
        lastCode: meta.code || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        sentAt: null
    });
}

// ───────────────────────── The one funnel every email goes through ─────────────
//
// Resolves with { status: 'sent' | 'queued', remaining }.
// Rejects only when the message can never be delivered as written (a malformed
// recipient), because queueing that would retry a doomed address every hour.
// `opts.forceQueue` skips the send attempt entirely. A caller sending a batch uses
// it once the daily cap is known to be reached: without it, every remaining
// recipient would pay for a doomed round trip (plus its retries) before landing in
// the queue anyway — which is what made a failed 100-person batch take minutes.
function sendOrQueue(payload, kind, opts) {
    const jdId = jdIdFromUrl(payload.review_url);

    if (opts && opts.forceQueue) {
        return enqueue(payload, { kind: kind, jdId: jdId, code: 'QUOTA_EXCEEDED', reason: 'daily cap reached, not attempted' })
            .then(function () {
                JDLog.warn('mail', kind + ':queued', 'daily cap reached, not attempted', { jdId: jdId });
                return { status: 'queued', remaining: 0 };
            });
    }

    return postWithRetry(payload)
        .then(function (response) {
            JDLog.ok('mail', kind, { jdId: jdId, message: 'remaining ' + lastRemaining });
            return { status: 'sent', remaining: lastRemaining };
        })
        .catch(function (err) {
            // A bad address is the user's to fix — surface it, never queue it.
            if (err.code === 'BAD_RECIPIENT') {
                JDLog.error('mail', kind, err, { jdId: jdId });
                throw err;
            }

            // Everything else is worth keeping: the daily cap (expected), a network
            // blip, or a script error. Queueing a message that might already have
            // gone out risks a duplicate, which is far better than a signing link
            // that silently never arrives.
            return enqueue(payload, { kind: kind, jdId: jdId, code: err.code, reason: err.message })
                .then(function () {
                    JDLog.warn('mail', kind + ':queued', err, { jdId: jdId });
                    return { status: 'queued', remaining: lastRemaining };
                })
                .catch(function (queueErr) {
                    // Could not send AND could not queue — this one really is lost,
                    // so make sure it is recorded loudly.
                    JDLog.error('mail', kind + ':queueFailed', queueErr, { jdId: jdId });
                    throw err;
                });
        });
}

// How many emails the Gmail account can still send today. Asked over the same POST
// channel as everything else, because a text/plain POST is the one request shape
// that reaches Apps Script without a CORS preflight it cannot answer.
// Resolves with -1 when the figure cannot be determined — callers must treat that
// as "unknown, carry on" rather than as "no quota left".
function getQuota() {
    return postWithRetry({ action: 'quota' })
        .then(function (data) {
            return typeof data.remaining === 'number' ? data.remaining : -1;
        })
        .catch(function (err) {
            JDLog.warn('mail', 'getQuota', err);
            return -1;
        });
}

window.JDMail = {
    getQuota: getQuota,
    sendOrQueue: sendOrQueue,
    // Send without the queue fallback. Used by the admin console when it drains
    // mail_queue: those messages are already queued, so a failure must update the
    // existing row rather than append a second copy of the same email.
    sendNow: postWithRetry,
    lastRemaining: function () { return lastRemaining; }
};

// ───────────────────────── Public senders ─────────────────────────

// sendEmailToHR: available globally so both index and preview can call it.
// accessCode (optional) is the per-document unlock code; include it so the
// recipient can open the gated page.
window.sendEmailToHR = function (previewUrl, requesterName = null, approved = false, accessCode = null) {
    if (!requesterName) {
        try { requesterName = $('#SignName1').val() || ''; } catch (e) { requesterName = ''; }
    }

    if (window.JDUI) JDUI.loading.show('กำลังส่งอีเมลไปยังฝ่าย HR');
    return sendOrQueue({
        to: MAILJS_CONFIG.defaultTo,
        requester_name: requesterName,
        review_url: previewUrl,
        access_code: accessCode || '',
        subject: (approved ? 'Approved: ' : '') + 'Kindly review and sign the JD document| ' + requesterName
    }, 'hr')
        .then(function (result) {
            if (window.JDUI) JDUI.loading.hide();
            if (window.JDUI) {
                if (result.status === 'sent') {
                    JDUI.success('อีเมลถูกส่งเรียบร้อยแล้วไปยัง ' + MAILJS_CONFIG.defaultTo, { title: 'ส่งอีเมลสำเร็จ' });
                } else {
                    JDUI.success('บันทึกเอกสารเรียบร้อยแล้ว ระบบจะส่งให้ฝ่าย HR ในวันถัดไป', { title: 'บันทึกเรียบร้อย' });
                }
            }
            return result;
        })
        .catch(function (err) {
            console.error('Error sending email', err);
            if (window.JDUI) JDUI.loading.hide();
            if (window.JDUI) JDUI.error(mailErrorText(err), { title: 'ส่งอีเมลไม่สำเร็จ' });
            throw err;
        });
};

// sendEmployeeAckEmail: sends the employee-acknowledgement flow email to ONE
// employee, linking to their own sign.html document. Each recipient gets a
// separate document + access code, so the link/code pair is per-employee.
// Does NOT toggle the global loading overlay (the caller drives a batch loader
// while sending to multiple employees) and does NOT show its own dialogs — the
// caller reports one summary for the whole batch.
window.sendEmployeeAckEmail = function (signUrl, recipient, requesterName = null, accessCode = null, opts = null) {
    return sendOrQueue({
        to: recipient,
        requester_name: requesterName || '',
        review_url: signUrl,
        access_code: accessCode || '',
        subject: 'Kindly review and acknowledge the JD document| ' + (requesterName || '')
    }, 'employee_ack', opts);
};

// sendApprovalEmail: sends to approver. Pass toEmail to override the default
// recipient, and accessCode to include the per-document unlock code.
window.sendApprovalEmail = function (previewUrl, requesterName = null, toEmail = null, accessCode = null) {
    if (!requesterName) {
        try { requesterName = $('#SignName1').val() || ''; } catch (e) { requesterName = ''; }
    }

    const recipient = toEmail?.trim() || MAILJS_CONFIG.approvalTo;

    if (window.JDUI) JDUI.loading.show('กำลังส่งอีเมลเพื่อขออนุมัติ');
    return sendOrQueue({
        to: recipient,
        requester_name: requesterName,
        review_url: previewUrl,
        access_code: accessCode || '',
        subject: 'Kindly review and sign the JD document| ' + requesterName
    }, 'approval')
        .then(function (result) {
            if (window.JDUI) JDUI.loading.hide();
            if (window.JDUI) {
                if (result.status === 'sent') {
                    JDUI.success('อีเมลสำหรับขออนุมัติถูกส่งไปยัง ' + recipient + ' เรียบร้อยแล้ว', { title: 'ส่งอีเมลสำเร็จ' });
                } else {
                    JDUI.success('บันทึกเอกสารเรียบร้อยแล้ว ระบบจะส่งให้ผู้อนุมัติในวันถัดไป ไม่ต้องกรอกใหม่', { title: 'บันทึกเรียบร้อย' });
                }
            }
            return result;
        })
        .catch(function (err) {
            console.error('Error sending approval email', err);
            if (window.JDUI) JDUI.loading.hide();
            if (window.JDUI) JDUI.error(mailErrorText(err), { title: 'ส่งอีเมลไม่สำเร็จ' });
            throw err;
        });
};

// Turn a send failure into something the person reading it can act on. Only a bad
// address reaches here now (everything else is queued), so the message says what
// to fix rather than the useless "please try again" the old code showed for every
// failure — including the daily cap, where trying again could never work.
function mailErrorText(err) {
    if (err && err.code === 'BAD_RECIPIENT') {
        return err.message || 'อีเมลปลายทางไม่ถูกต้อง กรุณาตรวจสอบตัวสะกดอีกครั้ง';
    }
    if (err && err.code === 'NOT_DEPLOYED') {
        return 'ระบบส่งอีเมลยังไม่พร้อมใช้งาน กรุณาแจ้งผู้ดูแลระบบ';
    }
    return 'ไม่สามารถส่งอีเมลได้ กรุณาแจ้งผู้ดูแลระบบ (ดูรายละเอียดในหน้า Log ระบบ)';
}
