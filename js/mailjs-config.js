// Email sending via Google Apps Script Web App (Gmail backend)
// The GAS web app receives a POST and calls GmailApp.sendEmail().
// Frontend keeps the same global function names so callers don't change.
const MAILJS_CONFIG = {
    // Google Apps Script Web App URL (deployed as "Anyone" access)
    webAppUrl: 'https://script.google.com/macros/s/AKfycbw1UMmOy2KfEBUWpLiiDBL8FxqKQOpAqdkuA-XZSJFe3ibkBguZBks0no4EwDw5iRfppw/exec',
    // Must match SHARED_SECRET in the Apps Script project
    token: 'jd2026-b8151ae17e08ed1bd62ebe1982f65197',
    defaultTo: 'alisa@cclcolossal.com',
    approvalTo: 'alisa.cclcolossal@gmail.com'
};
window.MAILJS_CONFIG = MAILJS_CONFIG;

// Escape every non-ASCII character as a \uXXXX sequence so the request body is
// pure ASCII. This is the fix for the mojibake ("Ã Â¸Â™...") in Thai subjects:
// Apps Script does not reliably honour the charset of a text/plain POST body and
// may decode our UTF-8 bytes as Latin-1. With an ASCII-only body there are no
// multi-byte sequences left to misread, and JSON.parse() on the Apps Script side
// restores the original Thai text regardless of which charset it assumed.
function toAsciiJson(obj) {
    return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, function (ch) {
        return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
    });
}

function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// One POST attempt. Resolves with the parsed response, or rejects with an error
// carrying `retriable` — true only when the mail was certainly NOT sent
// (network failure / 5xx), so a retry cannot produce a duplicate email.
function postOnce(body) {
    return fetch(MAILJS_CONFIG.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body
    }).then(function (res) {
        return res.text().then(function (text) {
            if (!res.ok) {
                const err = new Error('Mail web app HTTP ' + res.status);
                err.retriable = res.status >= 500;
                throw err;
            }
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                // GAS answered with HTML — almost always the sign-in page, i.e.
                // the deployment is not shared as "Anyone". Retrying won't help.
                throw new Error('Mail web app returned a non-JSON response (check that the deployment is accessible to "Anyone")');
            }
            if (!data || !data.ok) {
                throw new Error((data && data.error) || 'Mail send failed');
            }
            return data;
        });
    }, function (netErr) {
        netErr.retriable = true;
        throw netErr;
    });
}

// Low-level sender: POSTs to the GAS web app.
// Uses text/plain to avoid a CORS preflight that GAS cannot answer.
// Retries transient failures — a single GAS cold start or 5xx used to mean the
// email was silently lost.
function sendViaGas(payload) {
    if (!window.MAILJS_CONFIG || !MAILJS_CONFIG.webAppUrl) {
        return Promise.reject(new Error('Mail web app not configured'));
    }
    const body = toAsciiJson(Object.assign({ token: MAILJS_CONFIG.token }, payload));
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

// sendEmailToHR: available globally so both index and preview can call it.
// accessCode (optional) is the per-document unlock code; include it so the
// recipient can open the gated page.
window.sendEmailToHR = function (previewUrl, requesterName = null, approved = false, accessCode = null) {
    if (!requesterName) {
        try { requesterName = $('#SignName1').val() || ''; } catch (e) { requesterName = ''; }
    }

    if (window.JDUI) JDUI.loading.show('กำลังส่งอีเมลไปยังฝ่าย HR');
    return sendViaGas({
        to: MAILJS_CONFIG.defaultTo,
        requester_name: requesterName,
        review_url: previewUrl,
        access_code: accessCode || '',
        subject: (approved ? 'Approved: ' : '') + 'Kindly review and sign the JD document| ' + requesterName
    })
        .then(function (response) {
            console.log('Email sent', response);
            if (window.JDUI) JDUI.loading.hide();
            if (window.JDUI) JDUI.success('อีเมลถูกส่งเรียบร้อยแล้วไปยัง ' + MAILJS_CONFIG.defaultTo, { title: 'ส่งอีเมลสำเร็จ' });
            return response;
        })
        .catch(function (err) {
            console.error('Error sending email', err);
            if (window.JDUI) JDUI.loading.hide();
            if (window.JDUI) JDUI.error('ไม่สามารถส่งอีเมลได้ กรุณาลองใหม่อีกครั้ง (ดูรายละเอียดในคอนโซล)', { title: 'ส่งอีเมลไม่สำเร็จ' });
            throw err;
        });
};

// sendEmployeeAckEmail: sends the employee-acknowledgement flow email to ONE
// employee, linking to their own sign.html document. Each recipient gets a
// separate document + access code, so the link/code pair is per-employee.
// Does NOT toggle the global loading overlay (the caller drives a batch loader
// while sending to multiple employees).
window.sendEmployeeAckEmail = function (signUrl, recipient, requesterName = null, accessCode = null) {
    return sendViaGas({
        to: recipient,
        requester_name: requesterName || '',
        review_url: signUrl,
        access_code: accessCode || '',
        subject: 'Kindly review and acknowledge the JD document| ' + (requesterName || '')
    });
};

// sendApprovalEmail: sends to approver. Pass toEmail to override the default
// recipient, and accessCode to include the per-document unlock code.
window.sendApprovalEmail = function (previewUrl, requesterName = null, toEmail = null, accessCode = null) {
    if (!requesterName) {
        try { requesterName = $('#SignName1').val() || ''; } catch (e) { requesterName = ''; }
    }

    const recipient = toEmail?.trim() || MAILJS_CONFIG.approvalTo;

    if (window.JDUI) JDUI.loading.show('กำลังส่งอีเมลเพื่อขออนุมัติ');
    return sendViaGas({
        to: recipient,
        requester_name: requesterName,
        review_url: previewUrl,
        access_code: accessCode || '',
        subject: 'Kindly review and sign the JD document| ' + requesterName
    })
        .then(function (response) {
            console.log('Approval email sent', response);
            if (window.JDUI) JDUI.loading.hide();
            if (window.JDUI) JDUI.success('อีเมลสำหรับขออนุมัติถูกส่งไปยัง ' + recipient + ' เรียบร้อยแล้ว', { title: 'ส่งอีเมลสำเร็จ' });
            return response;
        })
        .catch(function (err) {
            console.error('Error sending approval email', err);
            if (window.JDUI) JDUI.loading.hide();
            if (window.JDUI) JDUI.error('ไม่สามารถส่งอีเมลขออนุมัติได้ กรุณาลองใหม่อีกครั้ง (ดูรายละเอียดในคอนโซล)', { title: 'ส่งอีเมลไม่สำเร็จ' });
            throw err;
        });
};
