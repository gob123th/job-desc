// approval.js — Approval UI: show HR from requestedBy, enable Approver (sig3) to sign/upload and save

$(document).ready(async function () {
    const urlParams = new URLSearchParams(window.location.search);
    const docId = urlParams.get('id');
    if (!docId) {
        JDUI.error('ไม่พบรหัสเอกสาร (id) ใน URL — กรุณาเปิดลิงก์จากอีเมลอีกครั้ง', { title: 'ไม่พบเอกสาร' });
        return;
    }

    const docRef = db.collection('job_descriptions').doc(docId);
    let hadApproverSig = false;
    let clearedApprover = false;

    try {
        const doc = await docRef.get();
        if (!doc.exists) {
            JDUI.error('ไม่พบเอกสารที่ระบุ (ID: ' + docId + ')', { title: 'ไม่พบเอกสาร' });
            return;
        }

        const data = doc.data();

        // Per-document access gate: require the code from the email before showing
        // any data (signed-in admins bypass this automatically).
        const accessCode = await window.JDAccess.unlock(data.accessCode);
        if (accessCode === null) {
            document.body.innerHTML =
                '<div style="max-width:520px;margin:80px auto;font-family:Sarabun,sans-serif;text-align:center;color:#444;">' +
                '<h2>🔒 ต้องใช้รหัสเข้าถึงเอกสาร</h2>' +
                '<p>กรุณาเปิดลิงก์จากอีเมลอีกครั้งและกรอกรหัสที่ถูกต้องเพื่อดูเอกสารนี้</p></div>';
            return;
        }

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

        // Requested By
        if (sigs.requestedBy) $('#previewSig1').attr('src', sigs.requestedBy).show();
        if (sigs.requestedByName) $('#SignName1').val(sigs.requestedByName);

        // Employee signature carried over from Step 1
        if (sigs.employee) $('#previewSig4').attr('src', sigs.employee).show();

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
        $('#sig-box-3 input, #uploadSig3, #sig-box-3 .btn-clear, #SignName3, #btnApprove, #btnPDF').prop('disabled', false);
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
            const apprSig = getSignatureData(3);

            // Step 2 requires the approver to sign AND fill the name underneath.
            let stepError = '';
            if (!apprSig) stepError = 'กรุณาลงลายเซ็นผู้อนุมัติ';
            else if (!($('#SignName3').val() || '').trim()) stepError = 'กรุณากรอกชื่อผู้อนุมัติใต้ลายเซ็น';

            if (stepError) {
                $('#sig-box-3').addClass('invalid');
                $('#sig-box-3 .sig-error').remove();
                $('#sig-box-3').append('<p class="field-error sig-error">' + stepError + '</p>');
                $('html, body').animate({ scrollTop: $('#sig-box-3').offset().top - 90 }, 300);
                return;
            }
            $('#sig-box-3').removeClass('invalid');
            $('#sig-box-3 .sig-error').remove();

            const confirmed = await JDUI.confirm('ระบบจะบันทึกการอนุมัติของคุณและส่งอีเมลแจ้งฝ่าย HR', {
                title: 'ยืนยันการอนุมัติ',
                okText: 'อนุมัติ'
            });
            if (!confirmed) return;
            try {
                JDUI.loading.show('กำลังบันทึกการอนุมัติ');
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
                JDUI.loading.hide();
                const previewUrl = 'preview.html?id=' + docId;
                if (window.sendEmailToHR) {
                    // Forward the document's access code so HR can unlock too.
                    // The email sender shows its own loading overlay + success/error dialog.
                    sendEmailToHR(previewUrl, $('#employeeName').val() || 'ไม่ระบุชื่อผู้ขอ', true, data.accessCode).catch(() => { console.warn('Email send failed'); });
                } else {
                    JDUI.success('บันทึกการอนุมัติเรียบร้อยแล้ว', { title: 'อนุมัติสำเร็จ' });
                }

            } catch (err) {
                console.error(err);
                JDUI.loading.hide();
                JDUI.error('เกิดข้อผิดพลาดในการบันทึกการอนุมัติ กรุณาลองใหม่อีกครั้ง', { title: 'บันทึกไม่สำเร็จ' });
            }
        });

    } catch (err) {
        console.error(err);
        JDUI.error('เกิดข้อผิดพลาดในการโหลดเอกสาร กรุณาลองใหม่อีกครั้ง', { title: 'โหลดเอกสารไม่สำเร็จ' });
    }
});