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

// Low-level sender: POSTs to the GAS web app.
// Uses text/plain to avoid a CORS preflight that GAS cannot answer.
function sendViaGas(payload) {
    if (!window.MAILJS_CONFIG || !MAILJS_CONFIG.webAppUrl) {
        return Promise.reject(new Error('Mail web app not configured'));
    }
    return fetch(MAILJS_CONFIG.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ token: MAILJS_CONFIG.token }, payload))
    })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (!data || !data.ok) {
                throw new Error((data && data.error) || 'Mail send failed');
            }
            return data;
        });
}

// sendEmailToHR: available globally so both index and preview can call it
window.sendEmailToHR = function (previewUrl, requesterName = null, approved = false) {
    if (!requesterName) {
        try { requesterName = $('#SignName1').val() || ''; } catch (e) { requesterName = ''; }
    }

    return sendViaGas({
        to: MAILJS_CONFIG.defaultTo,
        requester_name: requesterName,
        review_url: previewUrl,
        subject: (approved ? 'Approved: ' : '') + 'Kindly review and sign the JD document| ' + requesterName
    })
        .then(function (response) {
            console.log('Email sent', response);
            alert('อีเมลส่งเรียบร้อยแล้วไปยัง ' + MAILJS_CONFIG.defaultTo);
            return response;
        })
        .catch(function (err) {
            console.error('Error sending email', err);
            alert('เกิดข้อผิดพลาดในการส่งอีเมล (ดูคอนโซล)');
            throw err;
        });
};

// sendApprovalEmail: sends to approver. Pass toEmail to override the default recipient.
window.sendApprovalEmail = function (previewUrl, requesterName = null, toEmail = null) {
    if (!requesterName) {
        try { requesterName = $('#SignName1').val() || ''; } catch (e) { requesterName = ''; }
    }

    const recipient = toEmail?.trim() || MAILJS_CONFIG.approvalTo;

    return sendViaGas({
        to: recipient,
        requester_name: requesterName,
        review_url: previewUrl,
        subject: 'Kindly review and sign the JD document| ' + requesterName
    })
        .then(function (response) {
            console.log('Approval email sent', response);
            alert('อีเมล (สำหรับอนุมัติ) ถูกส่งไปยัง ' + recipient);
            return response;
        })
        .catch(function (err) {
            console.error('Error sending approval email', err);
            alert('เกิดข้อผิดพลาดในการส่งอีเมลอนุมัติ (ดูคอนโซล)');
            throw err;
        });
};
