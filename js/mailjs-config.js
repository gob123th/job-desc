const MAILJS_CONFIG = {
    serviceId: 'service_egazmzk',  
    templateId: 'template_pn9ykcg',   
    publicKey: 'RB1kmyw8Syp8yi1P4',  
    defaultTo: 'alisa.autt@gmail.com',
    approvalTo: 'alisa.autt@gmail.com',
    approvalTemplateId: 'template_pn9ykcg'
};
if (window.emailjs && MAILJS_CONFIG.publicKey) {
    emailjs.init(MAILJS_CONFIG.publicKey);
}
window.MAILJS_CONFIG = MAILJS_CONFIG;

// sendEmailToHR: available globally so both index and preview can call it
window.sendEmailToHR = function (previewUrl, requesterName = null, approved = false) {
    if (!window.emailjs || !window.MAILJS_CONFIG) {
        alert('Email service not configured. โปรดตรวจสอบ js/mailjs-config.js และ publicKey/service/template');
        window.open(previewUrl, '_blank');
        return Promise.reject(new Error('EmailJS not configured'));
    }

    // If requesterName not provided, attempt to read from DOM
    if (!requesterName) {
        try { requesterName = $('#SignName1').val() || ''; } catch (e) { requesterName = ''; }
    }

    const templateParams = {
        requester_name: requesterName,
        review_url: previewUrl,
        to_email: MAILJS_CONFIG.defaultTo,
        Subject: (approved ? 'Approved: ' : '') + 'Kindly review and sign the JD document| ' + requesterName,
    };

    return emailjs.send(MAILJS_CONFIG.serviceId, MAILJS_CONFIG.templateId, templateParams)
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

// sendApprovalEmail: sends to approver (uses approvalTo / approvalTemplateId)
window.sendApprovalEmail = function (previewUrl, requesterName = null) {
    if (!window.emailjs || !window.MAILJS_CONFIG) {
        alert('Email service not configured. โปรดตรวจสอบ js/mailjs-config.js และ publicKey/service/template');
        window.open(previewUrl, '_blank');
        return Promise.reject(new Error('EmailJS not configured'));
    }

    if (!requesterName) {
        try { requesterName = $('#SignName1').val() || ''; } catch (e) { requesterName = ''; }
    }

    const templateParams = {
        requester_name: requesterName,
        review_url: previewUrl,
        to_email: MAILJS_CONFIG.approvalTo,
        Subject: 'Kindly review and sign the JD document| ' + requesterName,

    };

    const tpl = MAILJS_CONFIG.approvalTemplateId || MAILJS_CONFIG.templateId;
    return emailjs.send(MAILJS_CONFIG.serviceId, tpl, templateParams)
        .then(function (response) {
            console.log('Approval email sent', response);
            alert('อีเมล (สำหรับอนุมัติ) ถูกส่งไปยัง ' + MAILJS_CONFIG.approvalTo);
            window.open(previewUrl, '_blank');
            return response;
        })
        .catch(function (err) {
            console.error('Error sending approval email', err);
            alert('เกิดข้อผิดพลาดในการส่งอีเมลอนุมัติ (ดูคอนโซล)');
            window.open(previewUrl, '_blank');
            throw err;
        });
};