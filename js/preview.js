// preview.js — load Firestore document and render preview with interactive signing for HR/Approver

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

        // Basic fields
        $('#positionName').val(data.positionName || '');
        $('#DeptName').val(data.department || '');
        $('#location').val(data.location || '');
        $('#level').val(data.level || '');
        $('#responsibilities').val(data.responsibilities || '');

        // Education & Experience
        try {
            const edu = data.education || {};
            const eduStr = (edu.levels && edu.levels.length) ? edu.levels.join(', ') : (edu.major || '');
            $('#educationText').val(eduStr);
            const exp = data.experience || [];
            $('#experienceText').val(exp.length ? exp.join(', ') : '');
        } catch (e) { }

        // KPIs
        if (Array.isArray(data.kpis)) {
            $('#kpi1_name').val(data.kpis[0] ? data.kpis[0].name || '' : '');
            $('#kpi1_target').val(data.kpis[0] ? data.kpis[0].target || '' : '');
            $('#kpi2_name').val(data.kpis[1] ? data.kpis[1].name || '' : '');
            $('#kpi2_target').val(data.kpis[1] ? data.kpis[1].target || '' : '');
        }

        // Signatures
        const sigs = data.signatures || {};
        // Track cleared state for signatures (so we can delete fields if user clears)
        const clearedSigs = {};

        if (sigs.requestedBy) $('#previewSig1').attr('src', sigs.requestedBy);

        // HR signature: show image if exists and default to upload mode, else default to draw
        if (sigs.hr) {
            $('#previewSig2').attr('src', sigs.hr).show();
            // set upload mode selected
            $('input[name="sigType2"][value="upload"]').prop('checked', true);
            clearedSigs[2] = false;
        } else {
            // no image saved -> default to draw
            $('input[name="sigType2"][value="draw"]').prop('checked', true);
            clearedSigs[2] = false;
        }

        // approver: no image in preview (read-only)
        if (sigs.employee) $('#previewSig4').attr('src', sigs.employee);

        // Names for signatures
        if (sigs.requestedByName) $('#SignName1').val(sigs.requestedByName);
        if (sigs.hrName) {
            $('#SignName2').val(sigs.hrName);
            // make sure HR name field is editable in preview
            $('#SignName2').prop('disabled', false);
            $('#SignName2').removeClass('disabled-input');
        }
        if (sigs.approverName) $('#SignName3').val(sigs.approverName);

        // expose clearedSigs map for other handlers (attach to docRef element)
        $(document).data('clearedSigs', clearedSigs);

        if (data.employeeName) $('#employeeName').val(data.employeeName);
        if (data.startDate) $('#startDate').val(data.startDate);

        // Logo from localStorage
        const savedLogo = localStorage.getItem('companyLogo_Rev05');
        if (savedLogo) {
            $('#logoPreview').attr('src', savedLogo).show();
            $('#logoPlaceholder').hide();
        }

        // Disable all inputs by default and enable only HR controls
        $('input, textarea, select, button').prop('disabled', true);
        // enable HR draw/upload controls and name input
        $('#sig-box-2 input, #uploadSig2, #sig-box-2 .btn-clear, #SignName2, #btnEmail').prop('disabled', false);
        // allow HR canvas interactions
        $('#sig-box-2 canvas').css('pointer-events', 'auto');

        // Re-enable general fields and KPI inputs so they display like index.html (readonly)
        $('#positionName, #DeptName, #location, #level, #responsibilities, #kpi1_name, #kpi1_target, #kpi2_name, #kpi2_target, #employeeName, #startDate, #SignName1, #SignName3').prop('disabled', false);

        // Initialize interactive signature box for HR (2) only
        [2].forEach(function (id) { initSignatureBox(id); });

        // BtnEmail: save signatures (if any) and update existing document, then open mailto with preview link
        $('#btnEmail').on('click', async function () {
            if (!confirm('ยืนยันส่งเอกสารและอีเมลหา ผู้อนุมัติ?')) return;
            try {
                // collect signatures and names
                const hrSig = getSignatureData(2);
                const apprSig = getSignatureData(3); // likely null since approver read-only
                const hrName = $('#SignName2').val() || null;
                const apprName = $('#SignName3').val() || null;

                const updateData = {
                    status: 'SENT_TO_APPROVER',
                    sentAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                const cleared = $(document).data('clearedSigs') || {};

                // hr signature handling: if user cleared and did not provide new signature -> delete field
                if (cleared[2]) {
                    updateData['signatures.hr'] = firebase.firestore.FieldValue.delete();
                } else if (hrSig !== null) {
                    updateData['signatures.hr'] = hrSig;
                }

                // approver is read-only in preview; if apprSig exists, set it (unlikely)
                if (apprSig !== null) updateData['signatures.approver'] = apprSig;

                if (hrName !== null) updateData['signatures.hrName'] = hrName;
                if (apprName !== null) updateData['signatures.approverName'] = apprName;

                // include employee acknowledgement fields if present
                const employeeName = $('#employeeName').val() || null;
                const startDate = $('#startDate').val() || null;
                if (employeeName !== null) updateData['employeeName'] = employeeName;
                if (startDate !== null) updateData['startDate'] = startDate;

                const docRefToUpdate = db.collection('job_descriptions').doc(docId);
                await docRefToUpdate.update(updateData);
                alert('อัปเดตเอกสารเรียบร้อยแล้ว');

                const previewUrl = window.location.href;
                try {
                    if (navigator.clipboard) {
                        await navigator.clipboard.writeText(previewUrl);
                        alert('Preview URL ถูกคัดลอกไปยังคลิปบอร์ด');
                    }
                } catch (e) { }

                const position = $('#positionName').val() || '';
                const subject = encodeURIComponent('อนุมัติ JD - ตำแหน่ง ' + position);
                const body = encodeURIComponent('เรียน ผู้อนุมัติ,%0D%0A%0D%0Aขออนุมัติ JD: ' + previewUrl + '%0D%0A%0D%0Aขอบคุณ');
                window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
            } catch (err) {
                console.error(err);
                alert('เกิดข้อผิดพลาดในการอัปเดตเอกสาร');
            }
        });

    } catch (err) {
        console.error(err);
        $('.preview-note').html('⚠️ เกิดข้อผิดพลาดในการโหลดข้อมูล');
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
                e.preventDefault(); isDrawing = true; ctx.beginPath(); const pos = getPos(e.originalEvent); ctx.moveTo(pos.x, pos.y);
            });
            $(canvas).on('touchmove', function (e) { e.preventDefault(); if (!isDrawing) return; const pos = getPos(e.originalEvent); ctx.lineTo(pos.x, pos.y); ctx.stroke(); });
            $(canvas).on('touchend', function () { isDrawing = false; });
        }

        // Toggle Draw / Upload mode
        $(boxId + ' input[type=radio]').on('change', function () {
            var mode = $(this).val();
            if (mode === 'draw') {
                $(boxId + ' canvas').show();
                $(boxId + ' .upload-area').hide();
                resizeCanvas();
            } else {
                $(boxId + ' canvas').hide();
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
            const resizedBase64 = await resizeImageToBase64(this.files[0], 400, 0.8);
            $(previewId).attr('src', resizedBase64).show();
            // mark as not cleared when user uploads
            const cleared = $(document).data('clearedSigs') || {};
            cleared[id] = false;
            $(document).data('clearedSigs', cleared);
        });

        // Clear Button logic
        $(boxId + ' .btn-clear').on('click', function () {
            if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
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