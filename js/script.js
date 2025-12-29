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

    // --- Send Email ---
    $('#btnEmail').on('click', function () {
        // var position = $('#positionName').val() || "ไม่ระบุตำแหน่ง";
        // var email = "alisa@cclcolossal.com";
        // var subject = "อนุมัติ JD - ตำแหน่ง " + position;
        // var body = "เรียน คุณเบียร์ (HR)%0D%0A%0D%0Aขอส่งไฟล์ JD ที่ตรวจสอบและลงนามเรียบร้อยแล้ว ดังแนบ%0D%0A%0D%0A(กรุณาแนบไฟล์ PDF ที่เซ็นแล้วมาในเมลนี้)%0D%0A%0D%0Aขอบคุณครับ/ค่ะ";
        // window.location.href = "mailto:" + email + "?subject=" + subject + "&body=" + body;
        if (!confirm("ยืนยันส่งข้อมูลและอีเมล?")) return;

        const formData = collectFormData();

        // ===== Save to Firestore =====
        db.collection("job_descriptions")
            .add(formData)
            .then(docRef => {

                        const docId = docRef.id;
                const previewUrl = 'preview.html?id=' + docId;
               
                sendEmailToHR(previewUrl, $('#employeeName').val() || 'ไม่ระบุชื่อผู้ขอ');

            })
            .catch(err => {
                alert("เกิดข้อผิดพลาดในการบันทึกข้อมูล");
                console.error(err);
            });

        collectFormData(); // For debugging
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

        const resizedBase64 = await resizeImageToBase64(
            this.files[0],
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

        kpis: [
            {
                name: $(".kpi-table tbody tr:eq(0) td:eq(0) input").val(),
                target: $(".kpi-table tbody tr:eq(0) td:eq(1) input").val()
            },
            {
                name: $(".kpi-table tbody tr:eq(1) td:eq(0) input").val(),
                target: $(".kpi-table tbody tr:eq(1) td:eq(1) input").val()
            }
        ],

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