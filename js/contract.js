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
                '<div style="max-width:520px;margin:80px auto;font-family:\'TH Sarabun PSK\',Sarabun,sans-serif;text-align:center;color:#444;">' +
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
        const responsibilities = data.responsibilities || '';
        $('#responsibilities').val(responsibilities);
        const ta = document.getElementById('responsibilities');
        if (ta) {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
        }
        // Print-only mirror — textareas clip long text in PDF/print, so show
        // the full duties as plain text (white-space:pre-wrap keeps line breaks).
        $('#responsibilitiesPrint').text(responsibilities);

        // ---- Education & Experience ----
        const edu = data.education || {};
        const eduLevels = (edu.levels && edu.levels.length) ? edu.levels.join(', ') : '';
        const major = edu.major ? ' (สาขา ' + edu.major + ')' : '';
        $('#educationText').val((eduLevels || '') + major);

        const exp = data.experience || [];
        $('#experienceText').val(exp.length ? exp.join(', ') : '');

        // ---- Employee acknowledgement ----
        $('#employeeName').val(data.employeeName || '');
        $('#startDate').val(formatThaiDate(data.startDate));

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

// Export a blank-signing template: same contract, but the Employee
// Acknowledgement signature, name and start date are left empty so the
// employee can print it and sign by hand. Values are restored after printing.
function exportTemplatePDF() {
    const sig4 = document.getElementById('previewSig4');
    const employeeName = document.getElementById('employeeName');
    const startDate = document.getElementById('startDate');

    const saved = {
        sigSrc: sig4 ? sig4.getAttribute('src') : null,
        sigDisplay: sig4 ? sig4.style.display : '',
        name: employeeName ? employeeName.value : '',
        date: startDate ? startDate.value : ''
    };

    // Blank out the employee fields (leaves the dashed sig-area box empty)
    if (sig4) { sig4.removeAttribute('src'); sig4.style.display = 'none'; }
    if (employeeName) employeeName.value = '';
    if (startDate) startDate.value = '';

    function restore() {
        if (sig4) {
            if (saved.sigSrc) sig4.setAttribute('src', saved.sigSrc);
            sig4.style.display = saved.sigDisplay;
        }
        if (employeeName) employeeName.value = saved.name;
        if (startDate) startDate.value = saved.date;
        window.removeEventListener('afterprint', restore);
    }

    window.addEventListener('afterprint', restore);
    window.print();
}
