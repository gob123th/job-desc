// contract.js — Load Firestore data and populate the contract template

$(document).ready(async function () {
    const urlParams = new URLSearchParams(window.location.search);
    const docId = urlParams.get('id');

    if (!docId) {
        alert('ไม่พบ id ของเอกสารใน URL — ให้ใส่ ?id=DOCUMENT_ID');
        return;
    }

    try {
        const doc = await db.collection('job_descriptions').doc(docId).get();
        if (!doc.exists) {
            alert('ไม่พบเอกสารที่ระบุ (ID: ' + docId + ')');
            return;
        }

        const data = doc.data();
        const sigs = data.signatures || {};

        // ---- Basic fields ----
        const position = data.positionName || '-';
        const dept     = data.department  || '-';
        const loc      = data.location    || '-';
        const level    = data.level       || '-';
        const empName  = data.employeeName || '-';
        const startDate = data.startDate
            ? new Date(data.startDate).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
            : '-';

        $('#c-position').text(position);
        $('#c-position2').text(position);
        $('#c-dept').text(dept);
        $('#c-location').text(loc);
        $('#c-location2').text(loc);
        $('#c-level').text(level);
        $('#c-empName').text(empName);
        $('#c-empName2').text(empName);
        $('#c-startDate').text(startDate);
        $('#c-startDate2').text(startDate);

        // ---- Education ----
        const edu = data.education || {};
        const eduLevels = (edu.levels && edu.levels.length) ? edu.levels.join(', ') : '';
        const major = edu.major ? ' (สาขา ' + edu.major + ')' : '';
        $('#c-edu').text((eduLevels || '-') + major);

        // ---- Experience ----
        const exp = data.experience || [];
        $('#c-exp').text(exp.length ? exp.join(', ') : '-');

        // ---- Responsibilities ----
        const raw = (data.responsibilities || '').trim();
        const $list = $('#c-duties');
        if (raw) {
            // Split by newline and strip existing numbering (e.g. "1. ", "2. ")
            const lines = raw.split('\n')
                .map(l => l.replace(/^\d+\.\s*/, '').trim())
                .filter(l => l.length > 0);
            lines.forEach(function (line) {
                $list.append('<li>' + $('<span>').text(line).html() + '</li>');
            });
        } else {
            $list.append('<li>-</li>');
        }

        // ---- Signatures ----
        function setSig(imgId, nameId, src, name) {
            if (src) {
                $('#' + imgId).attr('src', src).show();
            }
            if (name) {
                $('#' + nameId).text(name);
            }
        }
        setSig('cSig1', 'cName1', sigs.requestedBy,  sigs.requestedByName);
        setSig('cSig2', 'cName2', sigs.hr,            sigs.hrName);
        setSig('cSig3', 'cName3', sigs.approver,      sigs.approverName);
        setSig('cSig4', 'cName4', sigs.employee,      data.employeeName);

    } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดในการโหลดเอกสาร');
    }
});

// ---- PDF Export ----
function exportContractPDF() {
    if (typeof html2pdf === 'undefined') { window.print(); return; }

    const positionEl = document.getElementById('c-position');
    const position = positionEl ? positionEl.textContent.trim() : 'JD';
    const today = new Date();
    const dateStr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
    const filename = 'Contract_' + position.replace(/\s+/g, '_') + '_' + dateStr + '.pdf';

    const noPrint = document.querySelectorAll('.no-print');
    noPrint.forEach(el => el.style.setProperty('display', 'none', 'important'));

    html2pdf()
        .set({
            margin: [8, 8, 8, 8],
            filename: filename,
            image: { type: 'jpeg', quality: 0.97 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#fff' },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        })
        .from(document.getElementById('contractPage'))
        .save()
        .then(() => noPrint.forEach(el => el.style.removeProperty('display')))
        .catch(err => {
            console.error(err);
            noPrint.forEach(el => el.style.removeProperty('display'));
            window.print();
        });
}
