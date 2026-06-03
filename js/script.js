$(document).ready(function () {
    // --- Auto Expand Textarea ---
    $('.auto-expand').on('input', function () {
        this.style.height = 'inherit';

        // Calculate border + padding from computed styles
        var computed = window.getComputedStyle(this);
        var borderTop = parseInt(computed.getPropertyValue('border-top-width'), 10) || 0;
        var paddingTop = parseInt(computed.getPropertyValue('padding-top'), 10) || 0;
        var paddingBottom = parseInt(computed.getPropertyValue('padding-bottom'), 10) || 0;
        var borderBottom = parseInt(computed.getPropertyValue('border-bottom-width'), 10) || 0;

        var height = borderTop + paddingTop + this.scrollHeight + paddingBottom + borderBottom;
        this.style.height = height + 'px';
    });

    // Set static logo
    $('#logoPreview').attr('src', 'img/logo.jpg').show();

    // --- Auto Numbering for Responsibilities ---
    const $resp = $('#responsibilities');

    // On focus: if empty, seed with "1. "
    $resp.on('focus', function () {
        if ($(this).val().trim() === '') {
            $(this).val('1. ');
            // trigger auto-expand
            $(this).trigger('input');
        }
    });

    // On keydown Enter: insert next number
    $resp.on('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();

        const textarea = this;
        const val = textarea.value;
        const pos = textarea.selectionStart;

        // Find the current line
        const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
        const currentLine = val.substring(lineStart, pos);

        // Extract current number (e.g. "3. ..." → 3)
        const match = currentLine.match(/^(\d+)\. /);
        const nextNum = match ? parseInt(match[1], 10) + 1 : null;

        const insertion = nextNum !== null ? '\n' + nextNum + '. ' : '\n';

        textarea.value = val.substring(0, pos) + insertion + val.substring(pos);
        const newPos = pos + insertion.length;
        textarea.selectionStart = textarea.selectionEnd = newPos;

        // trigger auto-expand
        $resp.trigger('input');
    });

    // --- Realtime field validation (inline red border + message under field) ---
    const formValidator = setupFormValidation();

    // --- Send Email ---
    $('#btnEmail').on('click', async function () {
        // Validate every field; reveal inline errors and jump to the first problem.
        const $firstInvalid = formValidator.validateAll();
        if ($firstInvalid) {
            $('html, body').animate({ scrollTop: $firstInvalid.offset().top - 90 }, 300);
            $firstInvalid.find('input, select, textarea').filter(':visible').first().trigger('focus');
            return;
        }

        const approverEmail = ($('#approverEmail').val() || '').trim();

        const confirmed = await JDUI.confirm('ระบบจะบันทึกข้อมูลและส่งอีเมลขออนุมัติไปยัง ' + approverEmail, {
            title: 'ยืนยันการส่งเอกสาร',
            okText: 'ส่งเลย'
        });
        if (!confirmed) return;

        const formData = collectFormData();

        // Generate a per-document access code. Stored on the doc (reads are already
        // capability-based) and emailed with the link so each step can unlock.
        const accessCode = window.JDAccess.generateCode(8);
        formData.accessCode = accessCode;

        // ===== Save to Firestore =====
        JDUI.loading.show('กำลังบันทึกข้อมูลเอกสาร');
        db.collection("job_descriptions")
            .add(formData)
            .then(docRef => {

                JDUI.loading.hide();
                const docId = docRef.id;
                const approvalUrl = 'approval.html?id=' + docId;

                sendApprovalEmail(approvalUrl, $('#employeeName').val() || 'ไม่ระบุชื่อผู้ขอ', approverEmail, accessCode);

            })
            .catch(err => {
                JDUI.loading.hide();
                JDUI.error('ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง', { title: 'บันทึกไม่สำเร็จ' });
                console.error(err);
            });

    });

    // --- Signature System Logic (Draw vs Upload) ---
    // Initialize for boxes 1, 2, 3, 4
    [1, 2, 3, 4].forEach(function (id) {
        initSignatureBox(id);
    });

    // Disable editing for HR (2) and Approver (3) — allow only Requested By (1) and Employee (4)
    [2,3].forEach(function (id) {
        const boxId = '#sig-box-' + id;
        // disable mode controls and file inputs and clear button
        $(boxId + ' .sig-controls input, ' + boxId + ' .sig-file-input, ' + boxId + ' .btn-clear').prop('disabled', true);
        // prevent drawing on canvas
        $(boxId + ' canvas').css('pointer-events', 'none');
        // subtle disabled style and helpful note
        $(boxId).css('opacity', '0.7');
        $(boxId).append('<div class="sig-locked-note" style="color:#888;font-size:12px;margin-top:6px;">(ปิดการแก้ไขเฉพาะ HR/ผู้อนุมัติ)</div>');
    });
});

function initSignatureBox(id) {
    const boxId = '#sig-box-' + id;
    const canvasId = '#sig' + id;
    const uploadInputId = '#uploadSig' + id;
    const previewId = '#previewSig' + id;

    // Toggle Draw / Upload mode
    $(boxId + ' input[type=radio]').on('change', function () {
        var mode = $(this).val();
        if (mode === 'draw') {
            $(boxId + ' canvas').show();
            $(boxId + ' .upload-area').hide();
        } else {
            $(boxId + ' canvas').hide();
            $(boxId + ' .upload-area').css('display', 'flex'); // Flex to center content
        }
    });

    // Canvas drawing logic
    const canvas = document.querySelector(canvasId);
    const ctx = canvas.getContext('2d');
    let isDrawing = false;

    // Resize canvas for better resolution
    function resizeCanvas() {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        ctx.scale(ratio, ratio);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000080';
    }
    // Initial resize + on window load
    resizeCanvas();
    $(window).on('load', resizeCanvas);

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        let clientX = e.clientX;
        let clientY = e.clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    // Mouse events
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
    $(canvas).on('mouseup mouseout', function () {
        isDrawing = false;
    });

    // Touch events
    $(canvas).on('touchstart', function (e) {
        e.preventDefault();
        isDrawing = true;
        ctx.beginPath();
        const pos = getPos(e.originalEvent);
        ctx.moveTo(pos.x, pos.y);
    });
    $(canvas).on('touchmove', function (e) {
        e.preventDefault();
        if (!isDrawing) return;
        const pos = getPos(e.originalEvent);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    });
    $(canvas).on('touchend', function () {
        isDrawing = false;
    });

    // File Upload logic
    $(uploadInputId).on("change", async function () {
        if (!this.files || !this.files[0]) return;

        const file = this.files[0];
        if (!validateSignatureFile(file)) { this.value = ''; return; }

        const resizedBase64 = await resizeImageToBase64(
            file,
            200,     // max width
            0.5      // quality
        );

        $(previewId)
            .attr("src", resizedBase64)
            .show();
    });
    // Clear Button logic
    $(boxId + ' .btn-clear').on('click', function () {
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Clear upload preview
        $(previewId).attr('src', '').hide();
        $(uploadInputId).val('');
    });
}


//firebase config file
function collectEducationAndExperience() {

    // วุฒิการศึกษา
    const educationLevels = [];
    $("label:contains('วุฒิการศึกษา')")
        .closest(".form-group")
        .find("input[type='checkbox']:checked")
        .each(function () {
            educationLevels.push($(this).val());
        });

    const major = $(".input-spec").val();

    // ประสบการณ์
    const experience = [];
    $("label:contains('ประสบการณ์')")
        .closest(".form-group")
        .find("input[type='checkbox']:checked")
        .each(function () {
            experience.push($(this).val());
        });

    return {
        education: {
            levels: educationLevels,
            major: major
        },
        experience: experience
    };
}
// Realtime, inline field validation.
// Each field shows a red border + a message under it once "touched" (blurred once),
// then re-checks live as the user edits. Returns a controller with validateAll().
function setupFormValidation() {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const fields = [];

    // Register a standard input/select/textarea field.
    // rule() returns an error message string, or '' when the value is valid.
    function register($input, rule, opts) {
        opts = opts || {};
        if (!$input.length) return;

        const $wrapper = opts.wrapper || $input.closest('.form-group');
        let $error = opts.error;
        if (!$error || !$error.length) {
            $error = $('<p class="field-error"></p>');
            $input.after($error);
        }

        let touched = false;
        function evaluate() {
            const msg = rule();
            $error.text(msg);
            $wrapper.toggleClass('invalid', !!msg).toggleClass('valid', !msg);
            return !msg;
        }

        $input.on('blur change', function () { touched = true; evaluate(); });
        $input.on('input', function () { if (touched) evaluate(); });

        fields.push({
            $wrapper: $wrapper,
            force: function () { touched = true; return evaluate(); }
        });
    }

    register($('#positionName'), function () {
        return $('#positionName').val().trim() ? '' : 'กรุณากรอกชื่อตำแหน่ง';
    });
    register($('#DeptName'), function () {
        return $('#DeptName').val().trim() ? '' : 'กรุณากรอกแผนก/ฝ่าย';
    });
    register($('#location'), function () {
        return $('#location').val() ? '' : 'กรุณาเลือกสถานที่ปฏิบัติงาน';
    });
    register($('#level'), function () {
        return $('#level').val() ? '' : 'กรุณาเลือกระดับตำแหน่ง';
    });
    register($('#responsibilities'), function () {
        return $('#responsibilities').val().trim() ? '' : 'กรุณากรอกหน้าที่ความรับผิดชอบ';
    });
    register($('#employeeName'), function () {
        return $('#employeeName').val().trim() ? '' : 'กรุณากรอกชื่อพนักงาน';
    }, { wrapper: $('.ack-info-col') });
    register($('#startDate'), function () {
        return $('#startDate').val() ? '' : 'กรุณาเลือกวันที่เริ่มงาน';
    }, { wrapper: $('.input-date-wrapper') });
    register($('#approverEmail'), function () {
        const v = ($('#approverEmail').val() || '').trim();
        if (!v) return 'กรุณากรอกอีเมลผู้อนุมัติ';
        if (!EMAIL_RE.test(v)) return 'รูปแบบอีเมลไม่ถูกต้อง (เช่น example@company.com)';
        return '';
    }, { wrapper: $('#approverEmailField'), error: $('#approverEmailError') });

    // Requester signature (box 1): a canvas/upload widget plus the name field
    // underneath it — both must be filled in, so it needs custom wiring.
    (function () {
        const $box = $('#sig-box-1');
        if (!$box.length) return;
        const $error = $('<p class="field-error"></p>').appendTo($box);
        const $name = $('#SignName1');
        let touched = false;

        function evaluate() {
            let msg = '';
            if (!getSignatureData(1)) msg = 'กรุณาลงลายเซ็นผู้จัดทำ';
            else if (!$name.val().trim()) msg = 'กรุณากรอกชื่อผู้จัดทำใต้ลายเซ็น';
            $error.text(msg);
            $box.toggleClass('invalid', !!msg).toggleClass('valid', !msg);
            return !msg;
        }
        // Re-check after the user draws, uploads, or clears the signature, or edits the name.
        $('#sig1').on('mouseup touchend', function () { if (touched) setTimeout(evaluate, 0); });
        $('#uploadSig1').on('change', function () { if (touched) setTimeout(evaluate, 60); });
        $('#sig-box-1 .btn-clear').on('click', function () { if (touched) setTimeout(evaluate, 0); });
        $name.on('blur change input', function () { if (touched) evaluate(); });

        fields.push({
            $wrapper: $box,
            force: function () { touched = true; return evaluate(); }
        });
    })();

    // Employee signature (box 4): acknowledgement signature, same custom wiring.
    (function () {
        const $box = $('#sig-box-4');
        if (!$box.length) return;
        const $error = $('<p class="field-error"></p>').appendTo($box);
        let touched = false;

        function evaluate() {
            const msg = getSignatureData(4) ? '' : 'กรุณาลงลายเซ็นพนักงาน';
            $error.text(msg);
            $box.toggleClass('invalid', !!msg).toggleClass('valid', !msg);
            return !msg;
        }
        // Re-check after the user draws, uploads, or clears the signature.
        $('#sig4').on('mouseup touchend', function () { if (touched) setTimeout(evaluate, 0); });
        $('#uploadSig4').on('change', function () { if (touched) setTimeout(evaluate, 60); });
        $('#sig-box-4 .btn-clear').on('click', function () { if (touched) setTimeout(evaluate, 0); });

        fields.push({
            $wrapper: $box,
            force: function () { touched = true; return evaluate(); }
        });
    })();

    return {
        // Force-validate everything; returns the first invalid wrapper ($) or null.
        validateAll: function () {
            let $first = null;
            fields.forEach(function (f) {
                if (!f.force() && !$first) $first = f.$wrapper;
            });
            return $first;
        }
    };
}

function collectFormData() {
    const eduExp = collectEducationAndExperience();

    return {
        positionName: $("#positionName").val(),
        department: $("#DeptName").val(),
        location: $("#location").val(),
        level: $("#level").val(),
        education: eduExp.education,
        experience: eduExp.experience,
        responsibilities: $("#responsibilities").val(),

        signatures: {
            requestedBy: getSignatureData(1),
            requestedByName: $('#SignName1').val() || null,
            hr: getSignatureData(2),
            hrName: $('#SignName2').val() || null,
            approver: getSignatureData(3),
            approverName: $('#SignName3').val() || null,
            employee: getSignatureData(4)
        },
        // Employee acknowledgement fields
        employeeName: $('#employeeName').val() || null,
        startDate: $('#startDate').val() || null,


        status: "APPLICANT_SUBMITTED",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
}

function getSignatureData(id) {
    const mode = $(`input[name="sigType${id}"]:checked`).val();

    if (mode === "draw") {
        const canvas = document.getElementById(`sig${id}`);
        return canvas && !isCanvasBlank(canvas)
            ? canvas.toDataURL()
            : null;
    }

    if (mode === "upload") {
        return $("#previewSig" + id).attr("src") || null;
    }

    return null;
}

function isCanvasBlank(canvas) {
    const ctx = canvas.getContext("2d");
    const pixelBuffer = new Uint32Array(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer
    );
    return !pixelBuffer.some(color => color !== 0);
}

// Reject non-images and oversized uploads before they ever hit the canvas / Firestore.
// Returns true when the file is acceptable, otherwise alerts and returns false.
function validateSignatureFile(file) {
    const MAX_BYTES = 5 * 1024 * 1024; // 5 MB before client-side resize
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
window.validateSignatureFile = validateSignatureFile;

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

                // JPEG จะเล็กกว่า PNG เยอะมาก
                const base64 = canvas.toDataURL("image/jpeg", quality);
                resolve(base64);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// sendEmailToHR moved to js/mailjs-config.js and exposed as window.sendEmailToHR()