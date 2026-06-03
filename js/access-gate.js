// Per-document access code: generation + the client-side unlock gate used by
// approval.html (step 2), preview.html (step 3), and contract.html (step 4).
//
// SECURITY NOTE: This is a STATIC site with no backend, so the code cannot be
// verified server-side — anyone who has the document ID (the link) could in
// principle read the raw document directly via the Firestore API and bypass the
// prompt. This gate + the unguessable 20-char document ID are therefore
// defense-in-depth, not a hard cryptographic wall. Because reads are already
// capability-based, the code is stored in plaintext (`accessCode`): hashing it
// would add no real protection while breaking code-forwarding between steps.
// To make this a real server-side gate, route reads through a Cloud Function
// (see SECURITY.md §5).
//
// Flow: index.html generates a code at submit time, stores it on the document,
// and emails it with the link. Each step prompts for the code (unless a verified
// admin is signed in, who bypasses the prompt). approval.js forwards the stored
// code to HR in the next email.
window.JDAccess = (function () {
    'use strict';

    // Unambiguous alphabet (no 0/O/1/I) so codes are easy to type from email.
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    function generateCode(len) {
        len = len || 8;
        const buf = new Uint32Array(len);
        crypto.getRandomValues(buf);
        let out = '';
        for (let i = 0; i < len; i++) out += ALPHABET[buf[i] % ALPHABET.length];
        return out;
    }

    function norm(s) { return (s || '').trim().toUpperCase(); }

    // Resolve the signed-in Firebase user once auth has initialized (or null).
    // Pages without firebase-auth loaded simply get null. A short timeout guards
    // against auth never firing so the gate can't hang forever.
    function currentUser(timeoutMs) {
        return new Promise(function (resolve) {
            if (!window.firebase || !firebase.auth) {
                resolve(null);
                return;
            }
            const auth = firebase.auth();
            let settled = false;
            function finish(u) {
                if (settled) return;
                settled = true;
                resolve(u || null);
            }
            auth.onAuthStateChanged(function (u) { finish(u); });
            setTimeout(function () { finish(auth.currentUser); }, timeoutMs || 2500);
        });
    }

    // Prompt for the access code and verify against the stored code.
    // Returns the normalized code on success, '' when no code is needed
    // (signed-in admin or legacy doc), or null if the user cancels / fails out.
    async function unlock(storedCode) {
        // Signed-in (verified) admins bypass the per-document code prompt entirely.
        const user = await currentUser();
        if (user && user.emailVerified) return norm(storedCode);

        if (!storedCode) return '';            // legacy docs created before codes existed
        const target = norm(storedCode);
        for (let attempt = 0; attempt < 5; attempt++) {
            const entry = window.prompt('กรุณากรอกรหัสเข้าถึงเอกสาร (ดูจากอีเมลที่ได้รับ):');
            if (entry === null) return null;   // user cancelled
            if (norm(entry) === target) return target;
            window.alert('รหัสไม่ถูกต้อง กรุณาลองใหม่ (เหลือ ' + (4 - attempt) + ' ครั้ง)');
        }
        return null;
    }

    return {
        generateCode: generateCode,
        normalize: norm,
        currentUser: currentUser,
        unlock: unlock
    };
})();
