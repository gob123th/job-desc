// Shared Thai date formatter. Turns an ISO date string (yyyy-mm-dd, as stored
// in Firestore startDate) into Thai Buddhist-era text, e.g. "1 มกราคม 2568".
// Returns '' for empty input and the raw string if it isn't a parsable date.
//
// Some stored dates already carry a Buddhist-era year (users type the Thai
// year into the native date picker, e.g. "2565-01-02"). A Gregorian year that
// large won't occur in real data, so any year >= 2400 is treated as BE and
// converted back before formatting — otherwise 543 would be added twice
// (2565 -> 3108).
window.formatThaiDate = function (iso) {
    if (!iso) return '';
    var d = new Date(window.normalizeStartDate(iso));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
};

// Normalize a yyyy-mm-dd string typed with a Buddhist-era year to Gregorian
// (2569-01-02 -> 2026-01-02). Used before saving startDate to Firestore.
window.normalizeStartDate = function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (m && +m[1] >= 2400) return (+m[1] - 543) + '-' + m[2] + '-' + m[3];
    return iso;
};
