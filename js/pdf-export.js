// pdf-export.js — Generate official A4 PDF from the document container

function exportPDF() {
    // Fallback to print dialog if html2pdf not loaded
    if (typeof html2pdf === 'undefined') {
        console.warn('html2pdf not loaded, falling back to window.print()');
        window.print();
        return;
    }

    const positionName = (document.getElementById('positionName') || {}).value || 'JD';
    const dept = (document.getElementById('DeptName') || {}).value || '';
    const today = new Date();
    const dateStr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
    const filename = 'JD_' + positionName.replace(/\s+/g, '_') +
        (dept ? '_' + dept.replace(/\s+/g, '_') : '') +
        '_' + dateStr + '.pdf';

    // Hide UI-only elements before rendering
    const hideSelectors = '.no-print, .btn-clear, .sig-controls, .sig-locked-note, .preview-note';
    const hiddenEls = document.querySelectorAll(hideSelectors);
    hiddenEls.forEach(el => el.style.setProperty('display', 'none', 'important'));

    const element = document.querySelector('.container');
    if (!element) {
        alert('ไม่พบ container — ไม่สามารถสร้าง PDF ได้');
        hiddenEls.forEach(el => el.style.removeProperty('display'));
        return;
    }

    // Replace input/textarea/select with plain text spans for PDF rendering
    const replacedFields = [];
    element.querySelectorAll('input:not([type=file]):not([type=checkbox]), textarea, select').forEach(function (el) {
        const value = el.tagName === 'SELECT'
            ? (el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : el.value)
            : el.value;
        const span = document.createElement('span');
        span.className = '__pdf-text-replacement';
        span.textContent = value;
        span.style.cssText = 'display:inline-block;min-width:60px;word-break:break-word;white-space:pre-wrap;font-family:inherit;font-size:inherit;color:inherit;';
        el.parentNode.insertBefore(span, el);
        el.style.setProperty('display', 'none', 'important');
        replacedFields.push({ el, span });
    });

    function restoreFields() {
        replacedFields.forEach(function ({ el, span }) {
            el.style.removeProperty('display');
            if (span.parentNode) span.parentNode.removeChild(span);
        });
    }

    const opt = {
        margin:      [10, 10, 10, 10],
        filename:    filename,
        image:       { type: 'jpeg', quality: 0.97 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            logging: false,
            backgroundColor: '#ffffff'
        },
        jsPDF: {
            unit: 'mm',
            format: 'a4',
            orientation: 'portrait'
        }
    };

    html2pdf()
        .set(opt)
        .from(element)
        .save()
        .then(function () {
            restoreFields();
            hiddenEls.forEach(el => el.style.removeProperty('display'));
        })
        .catch(function (err) {
            console.error('PDF export error:', err);
            restoreFields();
            hiddenEls.forEach(el => el.style.removeProperty('display'));
            alert('เกิดข้อผิดพลาดในการสร้าง PDF\nลองกด Ctrl+P (Print → Save as PDF) แทนได้ครับ');
        });
}
