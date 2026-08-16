// sign.js — Employee-acknowledgement signing page (step for the "ส่งพนักงานลงนาม"
// flow). Loads ONE PENDING_EMPLOYEE document (each employee has their own doc +
// access code), lets the employee sign the acknowledgement box only, then on
// confirm saves the signature, moves the document into the approver queue
// (APPLICANT_SUBMITTED), and emails the approver stored on the document.

$(document).ready(function () {
    // Print prep: mirror the duties textarea + print the Thai start date.
    window.addEventListener('beforeprint', function () {
        const ta = document.getElementById('responsibilities');
        const mirror = document.getElementById('responsibilitiesPrint');
        if (ta && mirror) mirror.textContent = ta.value;
        $('input[type="date"]').each(function () {
            $(this).toggleClass('print-empty-date', !this.value);
        });
        $('#startDate').toggleClass('print-thai-date', !!$('#startDate').val());
    });
    window.addEventListener('afterprint', function () {
        $('input.print-empty-date').removeClass('print-empty-date');
    });

    $('.sig-img-preview').each(function () {
        if (!$(this).attr('src')) $(this).hide();
    });
    $('.sig-img-preview').on('error', function () {
        $(this).removeAttr('src').hide();
    });
});

$(document).ready(async function () {
    const urlParams = new URLSearchParams(window.location.search);
    const docId = urlParams.get('id');
    if (!docId) {
        JDUI.error('ไม่พบรหัสเอกสาร (id) ใน URL — กรุณาเปิดลิงก์จากอีเมลอีกครั้ง', { title: 'ไม่พบเอกสาร' });
        return;
    }

    const docRef = db.collection('job_descriptions').doc(docId);

    try {
        const doc = await docRef.get();
        if (!doc.exists) {
            JDUI.error('ไม่พบเอกสารที่ระบุ (ID: ' + docId + ')', { title: 'ไม่พบเอกสาร' });
            return;
        }

        const data = doc.data();

        // Per-document access gate: require the code from the email.
        const accessCode = await window.JDAccess.unlock(data.accessCode);
        if (accessCode === null) {
            document.body.innerHTML =
                '<div style="max-width:520px;margin:80px auto;font-family:Sarabun,sans-serif;text-align:center;color:#444;">' +
                '<h2>🔒 ต้องใช้รหัสเข้าถึงเอกสาร</h2>' +
                '<p>กรุณาเปิดลิงก์จากอีเมลอีกครั้งและกรอกรหัสที่ถูกต้องเพื่อดูเอกสารนี้</p></div>';
            return;
        }

        // Basic fields
        $('#positionName').val(data.positionName || '');
        $('#DeptName').val(data.department || '');
        $('#location').val(data.location || '');
        $('#level').val(data.level || '');
        $('#responsibilities').val(data.responsibilities || '');
        autoExpandTextarea(document.getElementById('responsibilities'));

        try {
            const edu = data.education || {};
            $('#educationText').val((edu.levels && edu.levels.length) ? edu.levels.join(', ') : (edu.major || ''));
            const exp = data.experience || [];
            $('#experienceText').val(exp.length ? exp.join(', ') : '');
        } catch (e) { /* optional fields */ }

        // Existing signatures (display-only): at PENDING_EMPLOYEE only the
        // requestor has signed, but render whatever exists to be safe.
        const sigs = data.signatures || {};
        if (sigs.requestedBy) $('#previewSig1').attr('src', sigs.requestedBy).show();
        if (sigs.requestedByName) $('#SignName1').val(sigs.requestedByName);
        if (sigs.approver) $('#previewSig3').attr('src', sigs.approver).show();
        if (sigs.approverName) $('#SignName3').val(sigs.approverName);
        if (sigs.hr) $('#previewSig2').attr('src', sigs.hr).show();
        if (sigs.hrName) $('#SignName2').val(sigs.hrName);
        if (sigs.employee) $('#previewSig4').attr('src', sigs.employee).show();

        if (data.employeeName) $('#employeeName').val(data.employeeName);
        if (data.startDate) $('#startDate').val(normalizeStartDate(data.startDate));
        $('#startDateThai').text(formatThaiDate($('#startDate').val()));
        $('#startDate').on('change input', function () {
            $('#startDateThai').text(formatThaiDate(this.value));
        });

        $('#logoPreview').attr('src', 'img/logo.jpg').show();

        // Only a PENDING_EMPLOYEE document is still awaiting the employee's
        // signature. Anything else was already signed/forwarded — show it
        // read-only so a forwarded link can't be re-submitted.
        const signable = data.status === 'PENDING_EMPLOYEE';

        // Lock everything first, then re-enable only the acknowledgement inputs.
        $('input, textarea, select, button').prop('disabled', true);

        if (signable) {
            $('#sig-box-4 input, #uploadSig4, #sig-box-4 .btn-clear, #employeeName, #startDate, #btnConfirm, #btnPDF')
                .prop('disabled', false);
            $('#sig-box-4 canvas').css('pointer-events', 'auto');
            initSignatureBox(4);
        } else {
            $('#btnPDF').prop('disabled', false);
            $('.action-title').text('เอกสารนี้ลงนามแล้ว');
            $('.action-hint').text('ท่านได้ลงนามรับทราบและส่งให้ผู้อนุมัติเรียบร้อยแล้ว (อ่านอย่างเดียว)');
            $('#btnConfirm').hide();
        }

        // Confirm: save the employee signature and forward to the approver.
        $('#btnConfirm').on('click', async function () {
            const empSig = getSignatureData(4);

            let stepError = '';
            if (!empSig) stepError = 'กรุณาลงลายเซ็นพนักงาน';
            else if (!($('#employeeName').val() || '').trim()) stepError = 'กรุณากรอกชื่อพนักงาน';

            if (stepError) {
                $('#sig-box-4').addClass('invalid');
                $('#sig-box-4 .sig-error').remove();
                $('#sig-box-4').append('<p class="field-error sig-error">' + stepError + '</p>');
                $('html, body').animate({ scrollTop: $('#sig-box-4').offset().top - 90 }, 300);
                return;
            }
            $('#sig-box-4').removeClass('invalid');
            $('#sig-box-4 .sig-error').remove();

            const confirmed = await JDUI.confirm(
                'ระบบจะบันทึกลายเซ็นของท่านและส่งเอกสารให้ผู้อนุมัติ (' + (data.approverEmail || '') + ')',
                { title: 'ยืนยันการลงนาม', okText: 'ยืนยันและส่ง' }
            );
            if (!confirmed) return;

            try {
                JDUI.loading.show('กำลังบันทึกลายเซ็นและส่งให้ผู้อนุมัติ');
                await docRef.update({
                    status: 'APPLICANT_SUBMITTED',
                    'signatures.employee': empSig,
                    employeeName: $('#employeeName').val() || '',
                    startDate: normalizeStartDate($('#startDate').val()) || null,
                    employeeSignedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                JDUI.loading.hide();

                const approvalUrl = 'approval.html?id=' + docId;
                const requesterName = sigs.requestedByName || 'ไม่ระบุชื่อผู้จัดทำ';
                if (data.approverEmail && window.sendApprovalEmail) {
                    // sendApprovalEmail drives its own loading + success/error dialog,
                    // including the "saved, goes out the next day" wording when the
                    // daily send cap has been reached.
                    sendApprovalEmail(approvalUrl, requesterName, data.approverEmail, data.accessCode)
                        .catch(function (err) {
                            console.warn('Approval email send failed', err);
                            JDLog.error('mail', 'approvalFromSign', err, { jdId: docId });
                        });
                } else {
                    JDUI.success('บันทึกลายเซ็นเรียบร้อยแล้ว', { title: 'ลงนามสำเร็จ' });
                }

                // Lock the page so it can't be re-submitted.
                $('input, textarea, select, button').prop('disabled', true);
                $('#btnPDF').prop('disabled', false);
                $('#btnConfirm').hide();
                $('.action-title').text('ลงนามเรียบร้อยแล้ว');
                $('.action-hint').text('ระบบได้ส่งเอกสารให้ผู้อนุมัติแล้ว ขอบคุณครับ');
            } catch (err) {
                console.error(err);
                JDUI.loading.hide();
                JDUI.error('เกิดข้อผิดพลาดในการบันทึก กรุณาลองใหม่อีกครั้ง', { title: 'บันทึกไม่สำเร็จ' });
            }
        });

    } catch (err) {
        console.error(err);
        JDUI.error('เกิดข้อผิดพลาดในการโหลดเอกสาร กรุณาลองใหม่อีกครั้ง', { title: 'โหลดเอกสารไม่สำเร็จ' });
    }

    // Resize a textarea so all its text is visible (no internal scroll/clip).
    function autoExpandTextarea(ta) {
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
    }

    // --- Signature box (self-contained; mirrors preview.js) ---
    function initSignatureBox(id) {
        const boxId = '#sig-box-' + id;
        const canvasId = '#sig' + id;
        const uploadInputId = '#uploadSig' + id;
        const previewId = '#previewSig' + id;

        const canvas = document.querySelector(canvasId);
        let ctx = null;
        if (canvas) ctx = canvas.getContext('2d');
        let isDrawing = false;

        function resizeCanvas() {
            if (!canvas || !ctx) return;
            const ratio = Math.max(window.devicePixelRatio || 1, 1);
            const w = canvas.offsetWidth || 200;
            const h = canvas.offsetHeight || 80;
            canvas.width = w * ratio;
            canvas.height = h * ratio;
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#000080';
        }

        function getPos(e) {
            const rect = canvas.getBoundingClientRect();
            let clientX = e.clientX;
            let clientY = e.clientY;
            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            }
            return { x: clientX - rect.left, y: clientY - rect.top };
        }

        if (canvas && ctx) {
            resizeCanvas();
            $(window).on('resize', resizeCanvas);

            $(canvas).on('mousedown', function (e) {
                isDrawing = true;
                $(boxId + ' .sig-draw-hint').hide();
                ctx.beginPath();
                const pos = getPos(e);
                ctx.moveTo(pos.x, pos.y);
            });
            $(canvas).on('mousemove', function (e) {
                if (!isDrawing) return;
                const pos = getPos(e);
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();
            });
            $(canvas).on('mouseup mouseout', function () { isDrawing = false; });

            $(canvas).on('touchstart', function (e) {
                e.preventDefault(); isDrawing = true; $(boxId + ' .sig-draw-hint').hide(); ctx.beginPath(); const pos = getPos(e.originalEvent); ctx.moveTo(pos.x, pos.y);
            });
            $(canvas).on('touchmove', function (e) { e.preventDefault(); if (!isDrawing) return; const pos = getPos(e.originalEvent); ctx.lineTo(pos.x, pos.y); ctx.stroke(); });
            $(canvas).on('touchend', function () { isDrawing = false; });
        }

        $(boxId + ' input[type=radio]').on('change', function () {
            const mode = $(this).val();
            if (mode === 'draw') {
                $(boxId + ' canvas').show();
                $(boxId + ' .sig-draw-hint').toggle(!canvas || isCanvasBlank(canvas));
                $(boxId + ' .upload-area').hide();
                resizeCanvas();
            } else {
                $(boxId + ' canvas').hide();
                $(boxId + ' .sig-draw-hint').hide();
                $(boxId + ' .upload-area').css('display', 'flex');
            }
        });
        setTimeout(function () {
            $(boxId + ' input[type=radio]:checked').trigger('change');
        }, 0);

        $(uploadInputId).on('change', async function () {
            if (!this.files || !this.files[0]) return;
            const file = this.files[0];
            if (!validateSignatureFile(file)) { this.value = ''; return; }
            const resizedBase64 = await resizeImageToBase64(file, 400, 0.8);
            $(previewId).attr('src', resizedBase64).show();
        });

        $(boxId + ' .btn-clear').on('click', function () {
            if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
            $(boxId + ' .sig-draw-hint').show();
            $(previewId).attr('src', '').hide();
            $(uploadInputId).val('');
            $(boxId + ' input[type=radio][value="draw"]').prop('checked', true).trigger('change');
        });
    }

    function getSignatureData(id) {
        const mode = $('input[name="sigType' + id + '"]:checked').val();
        if (mode === 'draw') {
            const canvas = document.getElementById('sig' + id);
            return canvas && !isCanvasBlank(canvas) ? canvas.toDataURL() : null;
        }
        if (mode === 'upload') {
            return $('#previewSig' + id).attr('src') || null;
        }
        return null;
    }

    function isCanvasBlank(canvas) {
        const ctx = canvas.getContext('2d');
        const pixelBuffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
        return !pixelBuffer.some(color => color !== 0);
    }

    // Reject non-images and oversized uploads before they hit the canvas / Firestore.
    function validateSignatureFile(file) {
        const MAX_BYTES = 5 * 1024 * 1024;
        if (!file.type.startsWith('image/')) {
            JDUI.warning('กรุณาเลือกไฟล์รูปภาพเท่านั้น (เช่น JPG หรือ PNG)', { title: 'ไฟล์ไม่ถูกต้อง' });
            return false;
        }
        if (file.size > MAX_BYTES) {
            JDUI.warning('ไฟล์มีขนาดใหญ่เกินไป (เกิน 5MB) กรุณาเลือกไฟล์ที่เล็กลง', { title: 'ไฟล์ใหญ่เกินไป' });
            return false;
        }
        return true;
    }

    function resizeImageToBase64(file, maxWidth = 400, quality = 0.7) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = function (e) {
                const img = new Image();
                img.onload = function () {
                    const scale = Math.min(1, maxWidth / img.width);
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }
});
