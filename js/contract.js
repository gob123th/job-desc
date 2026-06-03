// contract.js — Load Firestore data into the read-only contract view (Step 4)
// Mirrors the layout of the other pages: every field renders as a read-only input.

$(document).ready(function () {
    // Hide empty signature images so blank boxes don't show a broken icon
    $('.sig-img-preview').each(function () {
        if (!$(this).attr('src')) $(this).hide();
    });
});

$(document).ready(async function () {
    const urlParams = new URLSearchParams(window.location.search);
    const docId = urlParams.get('id');

    if (!docId) {
        JDUI.error('ไม่พบรหัสเอกสาร (id) ใน URL — กรุณาเปิดลิงก์จากอีเมลอีกครั้ง', { title: 'ไม่พบเอกสาร' });
        return;
    }

    try {
        const doc = await db.collection('job_descriptions').doc(docId).get();
        if (!doc.exists) {
            JDUI.error('ไม่พบเอกสารที่ระบุ (ID: ' + docId + ')', { title: 'ไม่พบเอกสาร' });
            return;
        }

        const data = doc.data();

        // Per-document access gate: require the code from the email before showing
        // data (signed-in admins bypass this automatically).
        const accessCode = await window.JDAccess.unlock(data.accessCode);
        if (accessCode === null) {
            document.body.innerHTML =
                '<div style="max-width:520px;margin:80px auto;font-family:Sarabun,sans-serif;text-align:center;color:#444;">' +
                '<h2>🔒 ต้องใช้รหัสเข้าถึงเอกสาร</h2>' +
                '<p>กรุณาเปิดลิงก์จากอีเมลอีกครั้งและกรอกรหัสที่ถูกต้องเพื่อดูเอกสารนี้</p></div>';
            return;
        }

        const sigs = data.signatures || {};

        // ---- Basic fields ----
        $('#positionName').val(data.positionName || '');
        $('#DeptName').val(data.department || '');
        $('#location').val(data.location || '');
        $('#level').val(data.level || '');

        // ---- Responsibilities (auto-expand the read-only textarea) ----
        $('#responsibilities').val(data.responsibilities || '');
        const ta = document.getElementById('responsibilities');
        if (ta) {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
        }

        // ---- Education & Experience ----
        const edu = data.education || {};
        const eduLevels = (edu.levels && edu.levels.length) ? edu.levels.join(', ') : '';
        const major = edu.major ? ' (สาขา ' + edu.major + ')' : '';
        $('#educationText').val((eduLevels || '') + major);

        const exp = data.experience || [];
        $('#experienceText').val(exp.length ? exp.join(', ') : '');

        // ---- Employee acknowledgement ----
        $('#employeeName').val(data.employeeName || '');
        const startDate = data.startDate
            ? new Date(data.startDate).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
            : '';
        $('#startDate').val(startDate);

        // ---- Signatures (all read-only images + names) ----
        function setSig(imgId, src) {
            if (src) $('#' + imgId).attr('src', src).show();
        }
        setSig('previewSig1', sigs.requestedBy);
        setSig('previewSig3', sigs.approver);
        setSig('previewSig2', sigs.hr);
        setSig('previewSig4', sigs.employee);

        if (sigs.requestedByName) $('#SignName1').val(sigs.requestedByName);
        if (sigs.approverName) $('#SignName3').val(sigs.approverName);
        if (sigs.hrName) $('#SignName2').val(sigs.hrName);

        // Ensure static logo is displayed
        $('#logoPreview').attr('src', 'img/logo.jpg').show();

    } catch (err) {
        console.error(err);
        JDUI.error('เกิดข้อผิดพลาดในการโหลดเอกสาร กรุณาลองใหม่อีกครั้ง', { title: 'โหลดเอกสารไม่สำเร็จ' });
    }
});
