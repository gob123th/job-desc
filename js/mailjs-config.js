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
