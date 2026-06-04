// ai-generate.js — "Generate with AI" for the Specific Duties field (index page).
//
// Uses Firebase AI Logic with the Gemini Developer API backend, which runs on
// the no-cost Spark plan (no billing / credit card required) and keeps the
// Gemini key on Google's backend — nothing secret is shipped to the browser.
//
// REQUIRES one-time setup in the Firebase console (project "jd-online-2026"):
//   Build → AI Logic → Get started → choose "Gemini Developer API".
// Until that is enabled the button will show a friendly error. See SECURITY.md.
//
// Loaded as an ES module so it can use the modular Firebase v11 SDK alongside
// the page's existing compat v9 SDK (they keep separate app registries).

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-ai.js";

// Same public config as js/firebase-config.js (these values are not secret).
const firebaseConfig = {
    apiKey: "AIzaSyAFczaY55KFKGY7wD4mOO048cQCoLrBye4",
    authDomain: "jd-online-2026.firebaseapp.com",
    projectId: "jd-online-2026",
    storageBucket: "jd-online-2026.firebasestorage.app",
    messagingSenderId: "599787831802",
    appId: "1:599787831802:web:6fd61924840e188091a443"
};

const MAX_ITEMS = 10;

// Lazily build the model only on first use (avoids cost/work if button unused).
let _model = null;
function getModel() {
    if (_model) return _model;
    const app = initializeApp(firebaseConfig, "ai-logic");
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    _model = getGenerativeModel(ai, { model: "gemini-2.5-flash" });
    return _model;
}

function buildPrompt(position, department, hint) {
    const lines = [
        'คุณเป็นผู้เชี่ยวชาญด้านทรัพยากรบุคคล (HR) ของบริษัทในประเทศไทย',
        'ช่วยร่าง "งานหลักและหน้าที่เฉพาะทาง" (Specific Duties) สำหรับตำแหน่งงานต่อไปนี้',
        '',
        'ชื่อตำแหน่ง: ' + position,
        'แผนก/ฝ่าย: ' + department
    ];
    if (hint) {
        lines.push('', 'คำสั่งเพิ่มเติมจากผู้ใช้ (ให้น้ำหนักความสำคัญ): ' + hint);
    }
    lines.push(
        '',
        'ข้อกำหนด:',
        '- เขียนเป็นภาษาไทย กระชับ ชัดเจน เป็นทางการ',
        '- ระบุเฉพาะงานหลักที่สอดคล้องกับตำแหน่งและแผนกข้างต้นโดยตรง',
        '- ไม่เกิน ' + MAX_ITEMS + ' ข้อ',
        '- ห้ามใส่หน้าที่มาตรฐานทั่วไป เช่น ISO 9001/14001 หรือ "งานอื่นๆ ตามที่ได้รับมอบหมาย"',
        '- ตอบกลับเป็นรายการลำดับเลขเท่านั้น รูปแบบ "1. ...", "2. ..." แต่ละข้อขึ้นบรรทัดใหม่',
        '- ห้ามมีข้อความเกริ่นนำหรือสรุปท้าย ตอบเฉพาะรายการลำดับเลข'
    );
    return lines.join('\n');
}

// Normalise the model output into a clean, renumbered 1..MAX_ITEMS list.
function cleanToNumberedList(text) {
    const raw = (text || '').replace(/\r/g, '').split('\n');
    const items = [];
    for (const line of raw) {
        let s = line.trim();
        if (!s) continue;
        // Strip a leading bullet/number marker and any markdown emphasis.
        s = s.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s*/, '').replace(/\*\*/g, '').trim();
        if (s) items.push(s);
        if (items.length >= MAX_ITEMS) break;
    }
    return items.map((s, i) => (i + 1) + '. ' + s).join('\n');
}

async function handleClick(btn) {
    const positionEl = document.getElementById('positionName');
    const deptEl = document.getElementById('DeptName');
    const respEl = document.getElementById('responsibilities');
    const hintEl = document.getElementById('aiHint');
    const position = (positionEl && positionEl.value || '').trim();
    const department = (deptEl && deptEl.value || '').trim();
    const hint = (hintEl && hintEl.value || '').trim();

    if (!position || !department) {
        window.JDUI.warning('กรุณากรอก "ชื่อตำแหน่ง" และ "แผนก/ฝ่าย" ก่อน เพื่อให้ AI ร่างได้ตรงกับตำแหน่งงาน',
            { title: 'ต้องการข้อมูลเพิ่มเติม' });
        return;
    }

    // Confirm before overwriting text the user has already typed.
    if (respEl && respEl.value.trim()) {
        const ok = await window.JDUI.confirm(
            'มีข้อความอยู่ในช่องนี้แล้ว ต้องการให้ AI สร้างใหม่ทับของเดิมหรือไม่?',
            { title: 'ยืนยันการสร้างใหม่', okText: 'สร้างใหม่' });
        if (!ok) return;
    }

    const label = btn.querySelector('.btn-ai-label');
    const prevLabel = label ? label.textContent : '';
    btn.disabled = true;
    btn.classList.add('is-loading');
    if (label) label.textContent = 'กำลังสร้าง...';

    try {
        const result = await getModel().generateContent(buildPrompt(position, department, hint));
        const text = cleanToNumberedList(result.response.text());
        if (!text) throw new Error('empty response');

        respEl.value = text;
        // Fire the auto-expand handler in script.js so the box grows to fit.
        respEl.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (err) {
        console.error('AI generate failed:', err);
        window.JDUI.error(
            'สร้างข้อความด้วย AI ไม่สำเร็จ — โปรดลองอีกครั้ง\n' +
            '(หากเพิ่งตั้งค่า ตรวจสอบว่าได้เปิดใช้ Firebase AI Logic ในคอนโซลแล้ว)',
            { title: 'AI ไม่พร้อมใช้งาน' });
    } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        if (label) label.textContent = prevLabel;
    }
}

function wire() {
    const btn = document.getElementById('btnGenAI');
    if (btn) btn.addEventListener('click', () => handleClick(btn));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
} else {
    wire();
}
