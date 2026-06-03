// pdf-export.js — Save the document as PDF using the browser's native print
// dialog (Print → Save as PDF). The native renderer handles Thai fonts, A4
// pagination and form fields correctly, driven by the @media print rules in
// css/style.css — far more reliable than rasterizing with html2canvas.

function exportPDF() {
    window.print();
}
