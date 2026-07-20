// preview.js — load Firestore document and render preview with interactive signing for HR/Approver
$(document).ready(function () {
  $(".sig-img-preview").each(function () {
    if (!$(this).attr("src")) {
      $(this).hide();
    }
  });

  // This page doesn't load script.js, so it needs its own print prep:
  // mirror the (editable) duties textarea into the print-only div, and print
  // the Thai start date instead of the raw picker. See css @media print.
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
});
$(document).ready(async function () {
    
    // parse ?id=DOCID
    const urlParams = new URLSearchParams(window.location.search);
    const docId = urlParams.get('id');

    if (!docId) {
        $('.preview-note').html('⚠️ ไม่มี id ของเอกสารใน URL — ให้ใส่ ?id=DOCUMENT_ID เพื่อดูตัวอย่าง');
        return;
    }

    const docRef = db.collection('job_descriptions').doc(docId);

    try {
        const doc = await docRef.get();
        if (!doc.exists) {
            $('.preview-note').html('⚠️ ไม่พบเอกสารที่ระบุ (ID: ' + docId + ')');
            return;
        }

        const data = doc.data();

        // Per-document access gate: require the code from the email before showing
        // data (signed-in admins bypass this automatically).
        const accessCode = await window.JDAccess.unlock(data.accessCode);
        if (accessCode === null) {
            $('.preview-note').html('🔒 ต้องใช้รหัสเข้าถึงเอกสาร — กรุณาเปิดลิงก์จากอีเมลและกรอกรหัสที่ถูกต้อง');
            return;
        }

        // Basic fields
        $('#positionName').val(data.positionName || '');
        $('#DeptName').val(data.department || '');
        $('#location').val(data.location || '');
        $('#level').val(data.level || '');
        $('#responsibilities').val(data.responsibilities || '');
        // Grow the textarea to fit its content so all the duties show on screen
        // (it clips with overflow hidden otherwise). Also re-grow while HR edits.
        autoExpandTextarea(document.getElementById('responsibilities'));
        $('#responsibilities').on('input', function () { autoExpandTextarea(this); });

        // Education & Experience. These are flattened into single text fields
        // here, so only write them back when HR actually changed them —
        // see the save handler below.
        let initialEduText = '';
        let initialExpText = '';
        try {
            const edu = data.education || {};
            initialEduText = (edu.levels && edu.levels.length) ? edu.levels.join(', ') : (edu.major || '');
            $('#educationText').val(initialEduText);
            const exp = data.experience || [];
            initialExpText = exp.length ? exp.join(', ') : '';
            $('#experienceText').val(initialExpText);
        } catch (e) { }

        // Signatures
        const sigs = data.signatures || {};
        // Track cleared state for signatures (so we can delete fields if user clears)
        const clearedSigs = {};

        // All four boxes are editable here — an existing signature shows in
        // upload mode, an empty one defaults to draw so it can be signed.
        const SIG_FIELDS = {
            1: 'requestedBy',
            2: 'hr',
            3: 'approver',
            4: 'employee'
        };
        Object.keys(SIG_FIELDS).forEach(function (id) {
            const existing = sigs[SIG_FIELDS[id]];
            if (existing) {
                $('#previewSig' + id).attr('src', existing).show();
                $('input[name="sigType' + id + '"][value="upload"]').prop('checked', true);
            } else {
                $('input[name="sigType' + id + '"][value="draw"]').prop('checked', true);
            }
            clearedSigs[id] = false;
        });

        // Names under the signatures
        if (sigs.requestedByName) $('#SignName1').val(sigs.requestedByName);
        if (sigs.hrName) $('#SignName2').val(sigs.hrName);
        if (sigs.approverName) $('#SignName3').val(sigs.approverName);

        // expose clearedSigs map for other handlers (attach to docRef element)
        $(document).data('clearedSigs', clearedSigs);

        if (data.employeeName) $('#employeeName').val(data.employeeName);
        // The picker needs a plain ISO value; the Thai text beside it is what
        // gets printed (see .print-thai-date in css @media print).
        if (data.startDate) $('#startDate').val(normalizeStartDate(data.startDate));
        $('#startDateThai').text(formatThaiDate($('#startDate').val()));
        $('#startDate').on('change input', function () {
            $('#startDateThai').text(formatThaiDate(this.value));
        });

        // Ensure static logo is displayed
        $('#logoPreview').attr('src', 'img/logo.jpg').show();

        // HR/Admin reviews and corrects the whole document here, so every
        // field and every signature box stays editable.
        $('input, textarea, select, button').prop('disabled', false);
        $('.sig-box canvas, .ack-sig-col canvas').css('pointer-events', 'auto');
        $('#SignName1, #SignName2, #SignName3, #employeeName, #startDate').removeClass('disabled-input');

        // Initialize all four interactive signature boxes
        [1, 2, 3, 4].forEach(function (id) { initSignatureBox(id); });

        // BtnEmail: save HR signature and mark document COMPLETED
        $('#btnEmail').on('click', async function () {
            // collect signatures and names
            const hrSig = getSignatureData(2);

            // Step 3 requires HR to sign AND fill the name underneath.
            let stepError = '';
            if (!hrSig) stepError = 'กรุณาลงลายเซ็น HR';
            else if (!($('#SignName2').val() || '').trim()) stepError = 'กรุณากรอกชื่อ HR ใต้ลายเซ็น';

            if (stepError) {
                $('#sig-box-2').addClass('invalid');
                $('#sig-box-2 .sig-error').remove();
                $('#sig-box-2').append('<p class="field-error sig-error">' + stepError + '</p>');
                $('html, body').animate({ scrollTop: $('#sig-box-2').offset().top - 90 }, 300);
                return;
            }
            $('#sig-box-2').removeClass('invalid');
            $('#sig-box-2 .sig-error').remove();

            const confirmed = await JDUI.confirm('ระบบจะบันทึกลายเซ็น HR และทำเครื่องหมายว่าเอกสารนี้เสร็จสมบูรณ์', {
                title: 'ยืนยันการลงนาม HR',
                okText: 'บันทึกและเสร็จสิ้น'
            });
            if (!confirmed) return;
            try {
                JDUI.loading.show('กำลังบันทึกลายเซ็นและอัปเดตเอกสาร');

                const updateData = {
                    status: 'COMPLETED',
                    completedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    // HR may revise any of the form fields before completing.
                    positionName: $('#positionName').val() || '',
                    department: $('#DeptName').val() || '',
                    location: $('#location').val() || '',
                    level: $('#level').val() || '',
                    responsibilities: $('#responsibilities').val() || ''
                };

                // Education/experience are shown flattened into one text field
                // each, so writing them back always loses the original
                // levels/major (or per-item) split. Only pay that cost when HR
                // actually edited the field.
                const eduText = ($('#educationText').val() || '').trim();
                if (eduText !== initialEduText.trim()) {
                    updateData['education'] = { levels: splitList(eduText), major: '' };
                }
                const expText = ($('#experienceText').val() || '').trim();
                if (expText !== initialExpText.trim()) {
                    updateData['experience'] = splitList(expText);
                }

                const cleared = $(document).data('clearedSigs') || {};

                // Every box is editable, so each one saves the same way: a box
                // the user cleared and left empty removes the stored signature,
                // otherwise a drawn/uploaded image replaces it.
                Object.keys(SIG_FIELDS).forEach(function (id) {
                    const sig = getSignatureData(Number(id));
                    const field = 'signatures.' + SIG_FIELDS[id];
                    if (sig !== null) updateData[field] = sig;
                    else if (cleared[id]) updateData[field] = firebase.firestore.FieldValue.delete();
                });

                updateData['signatures.requestedByName'] = $('#SignName1').val() || '';
                updateData['signatures.hrName'] = $('#SignName2').val() || '';
                updateData['signatures.approverName'] = $('#SignName3').val() || '';

                // include employee acknowledgement fields if present
                updateData['employeeName'] = $('#employeeName').val() || '';
                updateData['startDate'] = normalizeStartDate($('#startDate').val()) || null;

                const docRefToUpdate = db.collection('job_descriptions').doc(docId);
                await docRefToUpdate.update(updateData);
                JDUI.loading.hide();
                JDUI.success('บันทึกลายเซ็น HR เรียบร้อยแล้ว เอกสาร JD เสร็จสมบูรณ์', { title: 'เสร็จสมบูรณ์' });
            } catch (err) {
                console.error(err);
                JDUI.loading.hide();
                JDUI.error('เกิดข้อผิดพลาดในการอัปเดตเอกสาร กรุณาลองใหม่อีกครั้ง', { title: 'อัปเดตไม่สำเร็จ' });
            }
        });

    } catch (err) {
        console.error(err);
        $('.preview-note').html('⚠️ เกิดข้อผิดพลาดในการโหลดข้อมูล');
    }

    // Resize a textarea so all its text is visible (no internal scroll/clip).
    function autoExpandTextarea(ta) {
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
    }

    // "a, b , c" -> ["a", "b", "c"] — mirrors how these lists are joined for display.
    function splitList(text) {
        return text.split(',').map(s => s.trim()).filter(Boolean);
    }

    // --- Signature helpers ---
    function initSignatureBox(id) {
        const boxId = '#sig-box-' + id;
        const canvasId = '#sig' + id;
        const uploadInputId = '#uploadSig' + id;
        const previewId = '#previewSig' + id;

        // Prepare canvas and context early to avoid "access before initialization"
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

        // Canvas drawing logic (safe-guarded)
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
            // ensure correct size
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

        // Toggle Draw / Upload mode
        $(boxId + ' input[type=radio]').on('change', function () {
            var mode = $(this).val();
            if (mode === 'draw') {
                $(boxId + ' canvas').show();
                // "sign here" hint only while the canvas is still blank
                $(boxId + ' .sig-draw-hint').toggle(!canvas || isCanvasBlank(canvas));
                $(boxId + ' .upload-area').hide();
                resizeCanvas();
            } else {
                $(boxId + ' canvas').hide();
                $(boxId + ' .sig-draw-hint').hide();
                $(boxId + ' .upload-area').css('display', 'flex');
            }
        });

        // apply the initial mode after handlers are ready
        setTimeout(function () {
            $(boxId + ' input[type=radio]:checked').trigger('change');
        }, 0);

        // File Upload logic
        $(uploadInputId).on('change', async function () {
            if (!this.files || !this.files[0]) return;
            const file = this.files[0];
            if (window.validateSignatureFile && !window.validateSignatureFile(file)) { this.value = ''; return; }
            const resizedBase64 = await resizeImageToBase64(file, 400, 0.8);
            $(previewId).attr('src', resizedBase64).show();
            // mark as not cleared when user uploads
            const cleared = $(document).data('clearedSigs') || {};
            cleared[id] = false;
            $(document).data('clearedSigs', cleared);
        });

        // Clear Button logic
        $(boxId + ' .btn-clear').on('click', function () {
            if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
            $(boxId + ' .sig-draw-hint').show();
            $(previewId).attr('src', '').hide();
            $(uploadInputId).val('');
            // mark as cleared so update will delete the field from Firestore
            const cleared = $(document).data('clearedSigs') || {};
            cleared[id] = true;
            $(document).data('clearedSigs', cleared);

            // switch to draw mode so user can sign again
            $(boxId + ' input[type=radio][value="draw"]').prop('checked', true).trigger('change');
        });
    }

    function getSignatureData(id) {
        const mode = $(`input[name="sigType${id}"]:checked`).val();
        if (mode === 'draw') {
            const canvas = document.getElementById(`sig${id}`);
            return canvas && !isCanvasBlank(canvas) ? canvas.toDataURL() : null;
        }
        if (mode === 'upload') {
            return $(`#previewSig${id}`).attr('src') || null;
        }
        return null;
    }

    function isCanvasBlank(canvas) {
        const ctx = canvas.getContext('2d');
        const pixelBuffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
        return !pixelBuffer.some(color => color !== 0);
    }

    function resizeImageToBase64(file, maxWidth = 400, quality = 0.7) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = function (e) {
                const img = new Image();
                img.onload = function () {
                    const scale = Math.min(1, maxWidth / img.width);
                    const canvas = document.createElement("canvas");
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    const base64 = canvas.toDataURL("image/jpeg", quality);
                    resolve(base64);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }
});
