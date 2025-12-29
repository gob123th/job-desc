// approval.js — Approval UI: show HR from requestedBy, enable Approver (sig3) to sign/upload and save

$(document).ready(async function () {
    const urlParams = new URLSearchParams(window.location.search);
    const docId = urlParams.get('id');
    if (!docId) {
        alert('ไม่พบ id ของเอกสารใน URL — ให้ใส่ ?id=DOCUMENT_ID');
        return;
    }

    const docRef = db.collection('job_descriptions').doc(docId);
    let hadApproverSig = false;
    let clearedApprover = false;

    try {
        const doc = await docRef.get();
        if (!doc.exists) {
            alert('ไม่พบเอกสารที่ระบุ (ID:' + docId + ')');
            return;
        }

        const data = doc.data();
        const sigs = data.signatures || {};

        // Basic fields
        $('#positionName').val(data.positionName || '');
        $('#DeptName').val(data.department || '');
        $('#location').val(data.location || '');
        $('#level').val(data.level || '');
        $('#responsibilities').val(data.responsibilities || '');

        // Education / experience quick copy
        try {
            const edu = data.education || {};
            const eduStr = (edu.levels && edu.levels.length) ? edu.levels.join(', ') : (edu.major || '');
            $('#educationText').val(eduStr);
            const exp = data.experience || [];
            $('#experienceText').val(exp.length ? exp.join(', ') : '');
        } catch (e) {}

        // KPIs
        if (Array.isArray(data.kpis)) {
            $('#kpi1_name').val(data.kpis[0] ? data.kpis[0].name || '' : '');
            $('#kpi1_target').val(data.kpis[0] ? data.kpis[0].target || '' : '');
            $('#kpi2_name').val(data.kpis[1] ? data.kpis[1].name || '' : '');
            $('#kpi2_target').val(data.kpis[1] ? data.kpis[1].target || '' : '');
        }

        // Requested By
        if (sigs.requestedBy) $('#previewSig1').attr('src', sigs.requestedBy).show();
        if (sigs.requestedByName) $('#SignName1').val(sigs.requestedByName);

        // HR signature: prefer sigs.hr, otherwise fallback to requestedBy
        if (sigs.hr) {
            $('#previewSig2').attr('src', sigs.hr).show();
            $('input[name="sigType2"][value="upload"]').prop('checked', true);
            if (sigs.hrName) $('#SignName2').val(sigs.hrName);
        } 

        // Approver: if exists, show image; else keep draw default
        if (sigs.approver) {
            $('#previewSig3').attr('src', sigs.approver).show();
            // default upload mode
            $('input[name="sigType3"][value="upload"]').prop('checked', true);
            clearedApprover = false;
            hadApproverSig = true;
        } else {
            $('input[name="sigType3"][value="draw"]').prop('checked', true);
            hadApproverSig = false;
            clearedApprover = false;
        }

        if (sigs.approverName) $('#SignName3').val(sigs.approverName);

        if (data.employeeName) $('#employeeName').val(data.employeeName);
        if (data.startDate) $('#startDate').val(data.startDate);

        // By default inputs are readonly; enable approver controls
        $('input, textarea, select, button').prop('disabled', true);
        $('#sig-box-3 input, #uploadSig3, #sig-box-3 .btn-clear, #SignName3, #btnApprove').prop('disabled', false);
        $('#sig-box-3 canvas').css('pointer-events', 'auto');

        // Initialize approver signature box (3)
        if (typeof initSignatureBox === 'function') {
            initSignatureBox(3);
        } else {
            console.warn('initSignatureBox not found; approver drawing may not function');
        }

        // Hook clear to mark clearedApprover flag (so we can delete field when saving)
        $('#sig-box-3 .btn-clear').on('click', function () {
            clearedApprover = true;
        });

        // Approve button: save approver signature and status
        $('#btnApprove').on('click', async function () {
            if (!confirm('ยืนยันการอนุมัติและบันทึกเอกสาร?')) return;
            try {
                const apprSig = getSignatureData(3);
                const apprName = $('#SignName3').val() || null;

                const updateData = {
                    status: 'APPROVED',
                    approvedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                if (clearedApprover && !apprSig && hadApproverSig) {
                    updateData['signatures.approver'] = firebase.firestore.FieldValue.delete();
                    updateData['signatures.approverName'] = firebase.firestore.FieldValue.delete();
                } else if (apprSig !== null) {
                    updateData['signatures.approver'] = apprSig;
                    updateData['signatures.approverName'] = apprName;
                } else if (apprName !== null) {
                    // no signature but name changed
                    updateData['signatures.approverName'] = apprName;
                }

                await docRef.update(updateData);
                 const previewUrl = window.location.href;
                if (window.sendEmailToHR) {
                    sendEmailToHR(previewUrl, $('#employeeName').val() || 'ไม่ระบุชื่อผู้ขอ', true).catch(() => { });
                }
                alert('บันทึกการอนุมัติเรียบร้อยแล้ว');

            } catch (err) {
                console.error(err);
                alert('เกิดข้อผิดพลาดในการบันทึกการอนุมัติ (ดูคอนโซล)');
            }
        });

    } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดในการโหลดเอกสาร (ดูคอนโซล)');
    }
});