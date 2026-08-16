// Admin console for managing JD config (departments / positions) in Firestore.
// Each item is its own Firestore document; add / edit / delete persist immediately.
// Shared data helpers live in js/config-loader.js (window.JDConfig).
//
// AUTH: real Firebase Email/Password authentication. Any account that exists in
// Firebase Auth and can sign in is an admin — firestore.rules (isAdmin) enforces
// "must be signed in" server-side. No email-verification or allowlist required.
// Manage admins by adding/removing users in Firebase Console → Authentication.
// IMPORTANT: disable client self sign-up (Auth → Settings → User actions) so
// strangers can't self-register into admin.
(function () {
    'use strict';

    const auth = firebase.auth();

    const DOCS = ['departments', 'positions'];

    // In-memory mirror of Firestore, per type: [{ id, name }].
    const state = { departments: [], positions: [] };

    // Submitted JD forms view-state. `all` holds only the pages loaded so far; `cursor` is the
    // last Firestore snapshot of the current page, used to fetch the next one.
    const subs = { all: [], filter: 'ALL', q: '', cursor: null, hasMore: false, loading: false };

    // status -> { label, css class, page to open }. Clicking a row goes to the page for its status.
    const STATUS = {
        PENDING_EMPLOYEE:    { label: 'รอพนักงานลงนาม',    cls: 'gray',  page: 'sign.html' },
        APPLICANT_SUBMITTED: { label: 'รอผู้จัดการอนุมัติ', cls: 'amber', page: 'approval.html' },
        APPROVED:            { label: 'รอ HR ลงนาม',       cls: 'blue',  page: 'preview.html' },
        COMPLETED:           { label: 'เสร็จสิ้น',          cls: 'green', page: 'contract.html' }
    };
    function statusMeta(s) {
        return STATUS[s] || { label: s || 'ไม่ทราบสถานะ', cls: 'gray', page: 'preview.html' };
    }

    // Which email is still outstanding for a document, per status — this is what the
    // per-row resend button re-sends. `emailField` is the document field holding the
    // recipient; null means the recipient is the fixed HR address in MAILJS_CONFIG.
    // COMPLETED is absent on purpose: a finished document has no pending email.
    const RESEND = {
        PENDING_EMPLOYEE:    { page: 'sign.html',     emailField: 'recipientEmail', who: 'พนักงานผู้ลงนามรับทราบ' },
        APPLICANT_SUBMITTED: { page: 'approval.html', emailField: 'approverEmail',  who: 'ผู้อนุมัติ' },
        APPROVED:            { page: 'preview.html',  emailField: null,             who: 'ฝ่าย HR' }
    };

    // ---------- Auth ----------
    function showAdmin() {
        $('#loginScreen').hide();
        $('#adminScreen').addClass('show');
        loadAll();
        loadSubs();
        refreshQuota();      // the only place the Gmail daily cap is visible
        refreshQueueCount(); // surfaces a backlog without opening the queue tab
    }

    function showLogin(msg) {
        $('#adminScreen').removeClass('show');
        $('#loginScreen').show();
        if (msg) {
            $('#loginError').text(msg);
            $('.login-card').addClass('shake');
            setTimeout(function () { $('.login-card').removeClass('shake'); }, 500);
        }
    }

    function loginFailed(msg) {
        $('#loginBtn').prop('disabled', false);
        showLogin(msg);
    }

    function handleLogin(e) {
        e.preventDefault();
        const email = ($('#adminUser').val() || '').trim();
        const pass = $('#adminPass').val() || '';
        $('#loginError').text('');
        $('#loginBtn').prop('disabled', true);

        auth.signInWithEmailAndPassword(email, pass)
            .then(function () {
                $('#adminPass').val('');
                $('#loginBtn').prop('disabled', false);
                // Any account that exists in Firebase Auth is an admin (enforced
                // server-side by firestore.rules). onAuthStateChanged reveals the
                // admin screen.
            })
            .catch(function (err) {
                console.error('Login failed', err);
                loginFailed('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
            });
    }

    function logout() {
        auth.signOut().then(function () { location.reload(); });
    }

    // ---------- Helpers ----------
    function $card(type) { return $('.card[data-doc="' + type + '"]'); }

    function status($c, text, cls) {
        $c.find('.saveState').attr('class', 'saveState ' + (cls || '')).text(text || '');
    }
    function flash($c, text, cls) {
        status($c, text, cls);
        clearTimeout($c.data('flashT'));
        $c.data('flashT', setTimeout(function () { status($c, '', ''); }, 2600));
    }

    function nameExists(type, name, exceptId) {
        const lc = name.toLowerCase();
        return state[type].some(function (i) { return i.id !== exceptId && i.name.toLowerCase() === lc; });
    }

    // ---------- Rendering ----------
    function render(type) {
        const $c = $card(type);
        const $list = $c.find('.list');
        const items = state[type];
        const filter = ($c.find('.searchInput').val() || '').trim().toLowerCase();

        $c.find('.count').text(items.length);
        $list.empty();

        if (!items.length) {
            const $empty = $('<li class="empty empty-state"></li>');
            $('<div class="empty-ico">📭</div>').appendTo($empty);
            $('<div>ยังไม่มีข้อมูลใน Firestore</div>').appendTo($empty);
            $('<button class="btn btn-primary btn-sm seedCardBtn">นำเข้าค่าตั้งต้น</button>')
                .appendTo($empty);
            $list.append($empty);
            return;
        }

        const visible = items.filter(function (o) {
            return !filter || o.name.toLowerCase().indexOf(filter) !== -1;
        });
        if (!visible.length) {
            $('<li class="empty"></li>').text('ไม่พบรายการที่ตรงกับ “' + filter + '”').appendTo($list);
            return;
        }

        visible.forEach(function (o, i) {
            const $li = $('<li>').attr('data-id', o.id);
            const $num = $('<span class="num"></span>').text(i + 1);
            const $input = $('<input type="text" class="name">').val(o.name).attr('data-id', o.id);
            const $del = $('<button class="icon-btn del" title="ลบรายการนี้">✕</button>');
            $li.append($num).append($input).append($del);
            $list.append($li);
        });
    }

    // ---------- Load ----------
    function loadAll() { DOCS.forEach(loadOne); }

    function loadOne(type) {
        const $c = $card(type);
        $c.addClass('loading');
        status($c, 'กำลังโหลด...', '');
        window.JDConfig.loadItems(type).then(function (items) {
            state[type] = items;
            $c.removeClass('loading');
            render(type);
            status($c, '', '');
        });
    }

    // ---------- Mutations ----------
    // Both lists live in a single Firestore document, so every mutation is: change the
    // in-memory list, then write the whole list back once (JDConfig.saveItems). It resolves
    // with the normalised list, which becomes the new state and the new cache.
    function persist(type, items) {
        return window.JDConfig.saveItems(type, items).then(function (saved) {
            state[type] = saved;
            render(type);
            return saved;
        });
    }

    function addOne(type) {
        const $c = $card(type);
        const $input = $c.find('.addInput');
        const name = $input.val().trim();
        if (!name) return;
        if (nameExists(type, name, null)) {
            flash($c, 'มีรายการ "' + name + '" อยู่แล้ว', 'err');
            return;
        }
        $input.prop('disabled', true);
        status($c, 'กำลังเพิ่ม...', '');
        persist(type, state[type].concat([{ name: name }])).then(function () {
            $input.val('').prop('disabled', false).focus();
            flash($c, '✓ เพิ่ม "' + name + '" แล้ว', 'ok');
        }).catch(function (err) {
            $input.prop('disabled', false);
            flash($c, 'เพิ่มไม่สำเร็จ: ' + err.message, 'err');
        });
    }

    function editOne(type, id, $input) {
        const $c = $card(type);
        const item = state[type].find(function (i) { return i.id === id; });
        if (!item) return;
        const newName = $input.val().trim();

        if (newName === item.name) return;               // unchanged
        if (!newName) {                                   // empty -> revert
            $input.val(item.name);
            flash($c, 'ชื่อต้องไม่ว่าง', 'err');
            return;
        }
        if (nameExists(type, newName, id)) {              // duplicate -> revert
            $input.val(item.name);
            flash($c, 'มีชื่อ "' + newName + '" อยู่แล้ว', 'err');
            return;
        }

        status($c, 'กำลังบันทึก...', '');
        const oldName = item.name;
        const next = state[type].map(function (i) {
            return (i.id === id) ? { id: i.id, name: newName } : i;
        });
        persist(type, next).then(function () {
            flash($c, '✓ บันทึกแล้ว', 'ok');
        }).catch(function (err) {
            $input.val(oldName);
            flash($c, 'บันทึกไม่สำเร็จ: ' + err.message, 'err');
        });
    }

    function deleteOne(type, id) {
        const $c = $card(type);
        const item = state[type].find(function (i) { return i.id === id; });
        if (!item) return;
        JDUI.confirm('ต้องการลบ "' + item.name + '" ออกจากรายการใช่หรือไม่?', {
            title: 'ยืนยันการลบ',
            okText: 'ลบ',
            danger: true,
            variant: 'warning'
        }).then(function (ok) {
            if (!ok) return;
            status($c, 'กำลังลบ...', '');
            const next = state[type].filter(function (i) { return i.id !== id; });
            persist(type, next).then(function () {
                flash($c, '✓ ลบ "' + item.name + '" แล้ว', 'ok');
            }).catch(function (err) {
                flash($c, 'ลบไม่สำเร็จ: ' + err.message, 'err');
            });
        });
    }

    // Seed one card from the built-in DEFAULTS (manual, only shown when collection is empty).
    function seedCard(type) {
        const $c = $card(type);
        const names = window.JDConfig.DEFAULTS[type];
        status($c, 'กำลังนำเข้า...', '');
        $c.find('.seedCardBtn').prop('disabled', true);
        window.JDConfig.addMany(type, names).then(function (saved) {
            state[type] = saved;                 // returned by the write — no re-read needed
            render(type);
            flash($c, '✓ นำเข้า ' + names.length + ' รายการแล้ว', 'ok');
        }).catch(function (err) {
            $c.find('.seedCardBtn').prop('disabled', false);
            flash($c, 'นำเข้าไม่สำเร็จ: ' + err.message, 'err');
        });
    }

    // ---------- Submitted JD forms ----------
    function fmtDate(d) {
        if (!d) return '—';
        return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) +
            ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    }

    // (Re)load the first page for the active status filter. The status filter is applied by
    // the Firestore query, so switching chips starts a fresh paged load.
    function loadSubs() {
        $('#subsList').html('<div class="subs-loading"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>');
        subs.all = [];
        subs.cursor = null;
        subs.hasMore = false;
        subs.loading = true;

        window.JDConfig.loadSubmissions({ status: subs.filter }).then(function (page) {
            subs.all = page.items;
            subs.cursor = page.cursor;
            subs.hasMore = page.hasMore;
            subs.loading = false;
            renderSubs();
        });
    }

    // Append the next page to what is already on screen.
    function loadMoreSubs() {
        if (subs.loading || !subs.hasMore) return;
        subs.loading = true;
        $('.subsMore').prop('disabled', true).text('กำลังโหลด...');

        window.JDConfig.loadSubmissions({ status: subs.filter, cursor: subs.cursor }).then(function (page) {
            subs.all = subs.all.concat(page.items);
            subs.cursor = page.cursor || subs.cursor;
            subs.hasMore = page.hasMore;
            subs.loading = false;
            renderSubs();
        });
    }


    function renderSubs() {
        const $list = $('#subsList');
        $list.empty();

        // The status filter is applied by the Firestore query; only the free-text search
        // narrows the rows client-side — and it can only see the pages loaded so far.
        const rows = subs.all.filter(function (it) {
            if (!subs.q) return true;
            const hay = (it.positionName + ' ' + it.department + ' ' + it.employeeName).toLowerCase();
            return hay.includes(subs.q);
        });

        if (!rows.length) {
            const msg = subs.all.length ? 'ไม่พบรายการที่ตรงกับเงื่อนไข' : 'ยังไม่มีฟอร์ม JD ที่ถูกส่งเข้ามา';
            $('<div class="subs-empty"></div>')
                .append('<div class="big">📭</div>')
                .append($('<div></div>').text(msg))
                .appendTo($list);
            renderMoreBar($list);
            return;
        }

        rows.forEach(function (it) {
            const m = statusMeta(it.status);
            const $a = $('<a class="sub-row"></a>').addClass(m.cls)
                .attr('href', m.page + '?id=' + encodeURIComponent(it.id));
            $('<div class="sub-accent"></div>').appendTo($a);

            const $main = $('<div class="sub-main"></div>');
            const $pos = $('<div class="sub-pos"></div>');
            if (it.positionName) $pos.text(it.positionName);
            else $pos.html('<span class="muted-pos">(ไม่ระบุตำแหน่ง)</span>');
            $main.append($pos);

            const $sub = $('<div class="sub-sub"></div>');
            $('<span></span>').text('🏢 ' + (it.department || '—')).appendTo($sub);
            if (it.employeeName) $('<span></span>').text('👤 ' + it.employeeName).appendTo($sub);
            $main.append($sub);
            $a.append($main);

            const $meta = $('<div class="sub-meta"></div>');
            $('<span class="badge"></span>').addClass(m.cls).text(m.label).appendTo($meta);
            $('<span class="sub-date"></span>').text(fmtDate(it.createdAt)).appendTo($meta);
            $a.append($meta);

            $('<span class="sub-arrow">›</span>').appendTo($a);

            // Resend + delete are nested in the row link, so their handlers stop the
            // click from navigating to the document page (see the handlers below).
            // A COMPLETED document has no pending email, so it gets no resend button.
            if (RESEND[it.status]) {
                $('<button class="sub-resend no-print">✉</button>')
                    .attr('title', 'ส่งอีเมลซ้ำไปยัง' + RESEND[it.status].who)
                    .attr('aria-label', 'ส่งอีเมลซ้ำ')
                    .attr('data-id', it.id)
                    .attr('data-name', it.positionName || '')
                    .appendTo($a);
            }

            $('<button class="sub-del no-print" title="ลบรายการนี้" aria-label="ลบรายการนี้">🗑</button>')
                .attr('data-id', it.id)
                .attr('data-name', it.positionName || '')
                .appendTo($a);

            $list.append($a);
        });

        renderMoreBar($list);
    }

    // ---------- Resend the pending email for one document ----------
    function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || ''); }

    // Ask for the recipient when the document doesn't carry one. Documents created
    // before the approver email was stored on the doc land here; whatever the admin
    // types is written back, so the next resend needs no prompt.
    function askRecipient(doc, meta) {
        return JDUI.prompt('ไม่พบอีเมล' + meta.who + 'ในเอกสารนี้ กรุณากรอกอีเมลปลายทาง', {
            title: 'ระบุอีเมลปลายทาง',
            placeholder: 'name@company.com'
        }).then(function (input) {
            const email = (input || '').trim();
            if (!email) return null;                       // cancelled
            if (!isEmail(email)) {
                JDUI.error('รูปแบบอีเมลไม่ถูกต้อง', { title: 'อีเมลไม่ถูกต้อง' });
                return null;
            }
            if (!meta.emailField) return email;
            const patch = {};
            patch[meta.emailField] = email;
            return window.JDConfig.updateSubmission(doc.id, patch)
                .catch(function (err) { console.warn('Could not store recipient on the document', err); })
                .then(function () { return email; });
        });
    }

    // Dispatch to the mail helper that matches the status. Each helper drives its own
    // loading overlay and result dialog, except sendEmployeeAckEmail (built for batch
    // sending), so that one gets the overlay and dialogs here.
    function sendFor(status, url, doc, recipient) {
        const requester = (doc.signatures && doc.signatures.requestedByName) || 'ไม่ระบุชื่อผู้จัดทำ';
        const code = doc.accessCode || '';

        if (status === 'APPLICANT_SUBMITTED') {
            return window.sendApprovalEmail(url, requester, recipient, code);
        }
        if (status === 'APPROVED') {
            return window.sendEmailToHR(url, doc.employeeName || requester, true, code);
        }
        JDUI.loading.show('กำลังส่งอีเมลให้พนักงานอีกครั้ง');
        return window.sendEmployeeAckEmail(url, recipient, requester, code)
            .then(function (res) {
                JDUI.loading.hide();
                JDUI.success('ส่งอีเมลซ้ำไปยัง ' + recipient + ' เรียบร้อยแล้ว', { title: 'ส่งอีเมลสำเร็จ' });
                return res;
            })
            .catch(function (err) {
                JDUI.loading.hide();
                JDUI.error('ส่งอีเมลไม่สำเร็จ: ' + (err.message || 'กรุณาลองใหม่อีกครั้ง'), { title: 'ส่งอีเมลไม่สำเร็จ' });
                throw err;
            });
    }

    // Re-send the email the document is currently waiting on, to the same recipient
    // and with the same access code — nothing about the document changes, so this is
    // safe to press more than once.
    async function resendSub(id, name) {
        const label = name || '(ไม่ระบุตำแหน่ง)';
        let doc;
        try {
            JDUI.loading.show('กำลังอ่านข้อมูลเอกสาร');
            doc = await window.JDConfig.getSubmission(id);
            JDUI.loading.hide();
        } catch (err) {
            JDUI.loading.hide();
            console.error(err);
            JDUI.error(err.message || 'อ่านข้อมูลเอกสารไม่สำเร็จ', { title: 'ส่งอีเมลซ้ำไม่สำเร็จ' });
            return;
        }

        const meta = RESEND[doc.status];
        if (!meta) {
            JDUI.info('เอกสาร "' + label + '" เสร็จสมบูรณ์แล้ว จึงไม่มีอีเมลที่ต้องส่งซ้ำ', { title: 'ไม่มีอีเมลค้างส่ง' });
            return;
        }

        let recipient = meta.emailField ? (doc[meta.emailField] || '').trim() : MAILJS_CONFIG.defaultTo;
        if (!recipient) {
            recipient = await askRecipient(doc, meta);
            if (!recipient) return;
        }

        const confirmed = await JDUI.confirm(
            'ส่งอีเมลสำหรับ "' + label + '" ซ้ำไปยัง' + meta.who + ' (' + recipient + ') ใช่หรือไม่?\n' +
            'ลิงก์และรหัสเข้าใช้งานเดิมจะถูกส่งไปอีกครั้ง ผู้รับอาจได้รับอีเมลซ้ำกัน',
            { title: 'ยืนยันการส่งอีเมลซ้ำ', okText: 'ส่งซ้ำ' }
        );
        if (!confirmed) return;

        try {
            await sendFor(doc.status, meta.page + '?id=' + doc.id, doc, recipient);
        } catch (err) {
            console.error('Resend failed', err);   // sendFor already told the user
        }
    }

    // Permanently delete one submitted JD document, then drop it from the loaded
    // page and re-render (no full reload needed).
    function deleteSub(id, name) {
        const label = name || '(ไม่ระบุตำแหน่ง)';
        JDUI.confirm('ต้องการลบแบบฟอร์ม JD "' + label + '" ออกอย่างถาวรใช่หรือไม่?\nการลบไม่สามารถย้อนกลับได้', {
            title: 'ยืนยันการลบเอกสาร',
            okText: 'ลบถาวร',
            danger: true,
            variant: 'warning'
        }).then(function (ok) {
            if (!ok) return;
            JDUI.loading.show('กำลังลบเอกสาร');
            window.JDConfig.deleteSubmission(id).then(function () {
                subs.all = subs.all.filter(function (i) { return i.id !== id; });
                JDUI.loading.hide();
                renderSubs();
                JDUI.success('ลบเอกสาร "' + label + '" เรียบร้อยแล้ว', { title: 'ลบสำเร็จ' });
            }).catch(function (err) {
                JDUI.loading.hide();
                console.error(err);
                JDUI.error('ลบไม่สำเร็จ: ' + (err.message || 'กรุณาลองใหม่อีกครั้ง'), { title: 'ลบไม่สำเร็จ' });
            });
        });
    }

    // Footer under the list: "load more" while further pages exist, plus a note that the
    // search box only covers what has been loaded so far.
    function renderMoreBar($list) {
        const $bar = $('<div class="subs-more"></div>');

        if (subs.hasMore) {
            $('<button class="btn btn-ghost btn-sm subsMore"></button>')
                .text('โหลดเพิ่ม ' + window.JDConfig.SUBS_PAGE_SIZE + ' รายการ')
                .appendTo($bar);
        }

        // The chips carry no totals (Firestore's COUNT aggregation isn't in the compat SDK,
        // and tallying by reading every document is what the paging avoids) — so the note
        // below the list is where the user finds out how much is on screen.
        const label = (subs.filter === 'ALL') ? 'รายการ' : statusMeta(subs.filter).label;
        let note;
        if (subs.q) {
            note = 'ค้นหาจาก ' + subs.all.length + ' ' + label + 'ที่โหลดแล้ว';
            if (subs.hasMore) note += ' — กด "โหลดเพิ่ม" เพื่อค้นย้อนหลัง';
        } else {
            note = 'แสดง ' + subs.all.length + ' ' + label + (subs.hasMore ? ' ล่าสุด (ยังมีเพิ่มเติม)' : ' ทั้งหมด');
        }
        $('<div class="subs-more-note"></div>').text(note).appendTo($bar);

        $list.append($bar);
    }

    // ═══════════════ Gmail daily-cap badge ═══════════════
    // Google exposes no UI for this number, so the admin console is the only place
    // it can be seen. -1 means the mailer did not answer — say so rather than
    // showing a number that would be wrong.
    function refreshQuota() {
        const $b = $('#quotaBadge');
        $b.removeClass('low empty').text('อีเมลคงเหลือวันนี้: …');

        return window.JDMail.getQuota().then(function (n) {
            if (n < 0) {
                $b.text('ตรวจสอบโควตาอีเมลไม่ได้');
                return n;
            }
            $b.text('อีเมลคงเหลือวันนี้: ' + n);
            if (n === 0) $b.addClass('empty');
            else if (n <= 20) $b.addClass('low');
            return n;
        });
    }

    // ═══════════════ Mail queue ═══════════════

    const queue = { all: [], filter: 'PENDING', q: '', loading: false };

    const QSTATUS = {
        PENDING: { label: 'รอส่ง', cls: 'pending' },
        SENT:    { label: 'ส่งแล้ว', cls: 'sent' },
        FAILED:  { label: 'ส่งไม่สำเร็จ', cls: 'failed' }
    };
    const QKIND = {
        employee_ack: 'พนักงานลงนาม',
        approval:     'ผู้อนุมัติ',
        hr:           'ฝ่าย HR'
    };

    function fmtTime(ts) {
        const d = ts?.toDate ? ts.toDate() : null;
        if (!d) return '—';
        return d.toLocaleString('th-TH', {
            day: '2-digit', month: 'short', year: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    }

    // Sorted client-side rather than with orderBy so the query stays a single
    // equality filter, which Firestore serves from its automatic index — no
    // composite index to create and keep in sync.
    function loadQueue() {
        if (queue.loading) return Promise.resolve();
        queue.loading = true;
        $('#queueList').html('<div class="empty-note">กำลังโหลด…</div>');

        let ref = db.collection('mail_queue');
        if (queue.filter !== 'ALL') ref = ref.where('status', '==', queue.filter);

        return ref.limit(300).get()
            .then(function (snap) {
                queue.all = snap.docs.map(function (d) {
                    return Object.assign({ id: d.id }, d.data());
                });
                queue.all.sort(function (a, b) {
                    const p = (a.priority || 5) - (b.priority || 5);
                    if (p !== 0) return p;
                    return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
                });
                renderQueue();
                refreshQueueCount();
            })
            .catch(function (err) {
                console.error(err);
                JDLog.error('firestore', 'loadQueue', err);
                $('#queueList').html('<div class="empty-note">โหลดคิวไม่สำเร็จ</div>');
            })
            .finally(function () { queue.loading = false; });
    }

    // Badge on the tab so a backlog is visible without opening the tab.
    function refreshQueueCount() {
        return db.collection('mail_queue').where('status', '==', 'PENDING').limit(300).get()
            .then(function (snap) {
                const $c = $('#queueCount');
                if (snap.size) $c.text(snap.size).addClass('show');
                else $c.text('').removeClass('show');
            })
            .catch(function () { /* the badge is cosmetic — never block on it */ });
    }

    function renderQueue() {
        const $list = $('#queueList').empty();
        const rows = queue.all.filter(function (it) {
            if (!queue.q) return true;
            return (it.to + ' ' + (it.subject || '') + ' ' + (it.requesterName || ''))
                .toLowerCase().includes(queue.q);
        });

        if (!rows.length) {
            $list.html('<div class="empty-note">ไม่มีรายการในคิว</div>');
            return;
        }

        rows.forEach(function (it) {
            const st = QSTATUS[it.status] || { label: it.status, cls: 'pending' };
            const $row = $('<div class="q-row"></div>');
            const $main = $('<div class="q-main"></div>').appendTo($row);

            $('<div class="q-to"></div>').text(it.to || '—').appendTo($main);
            $('<div class="q-meta"></div>')
                .text('เข้าคิวเมื่อ ' + fmtTime(it.createdAt) +
                      (it.attempts ? ' • พยายามส่งแล้ว ' + it.attempts + ' ครั้ง' : '') +
                      (it.status === 'SENT' ? ' • ส่งเมื่อ ' + fmtTime(it.sentAt) : ''))
                .appendTo($main);
            if (it.status === 'FAILED' && it.lastError) {
                $('<div class="q-err"></div>').text(it.lastError).appendTo($main);
            }

            $('<span class="q-badge kind"></span>').text(QKIND[it.kind] || it.kind).appendTo($row);
            $('<span class="q-badge ' + st.cls + '"></span>').text(st.label).appendTo($row);

            if (it.status !== 'SENT') {
                $('<button class="icon-btn q-send" title="ส่งรายการนี้ตอนนี้">▶</button>')
                    .attr('data-id', it.id).appendTo($row);
            }
            $('<button class="icon-btn del q-del" title="ลบออกจากคิว">🗑</button>')
                .attr('data-id', it.id).appendTo($row);

            $list.append($row);
        });
    }

    // Send one queued message and fold the outcome back into its own row. Never
    // enqueues again — the row already exists.
    function sendQueued(item) {
        return window.JDMail.sendNow({
            to: item.to,
            requester_name: item.requesterName,
            review_url: item.reviewUrl,
            access_code: item.accessCode,
            subject: item.subject
        }).then(function () {
            return db.collection('mail_queue').doc(item.id).update({
                status: 'SENT',
                sentAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastError: '',
                lastCode: ''
            }).then(function () { return { ok: true }; });
        }, function (err) {
            // The daily cap is not this message's fault — leave it PENDING and do
            // not count an attempt against it, otherwise a busy day would burn
            // through MAX attempts and mark good addresses as permanently failed.
            if (err.code === 'QUOTA_EXCEEDED') return { ok: false, quota: true, err: err };

            const attempts = (item.attempts || 0) + 1;
            return db.collection('mail_queue').doc(item.id).update({
                status: attempts >= 5 ? 'FAILED' : 'PENDING',
                attempts: attempts,
                lastError: String(err.message || err).slice(0, 500),
                lastCode: err.code || 'SEND_FAILED',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(function () { return { ok: false, err: err }; });
        });
    }

    // Drain as much of the backlog as today's remaining quota allows. The hourly
    // Apps Script trigger does the same thing on its own — this is for when nobody
    // wants to wait for the next hour.
    async function drainQueueNow() {
        const pending = queue.all.filter(function (it) { return it.status === 'PENDING'; });
        if (!pending.length) {
            JDUI.info('ไม่มีอีเมลค้างส่งในคิว', { title: 'คิวว่าง' });
            return;
        }

        const quota = await refreshQuota();
        if (quota === 0) {
            JDUI.warning('โควตาอีเมลของวันนี้เต็มแล้ว ระบบจะส่งคิวที่เหลือให้อัตโนมัติเมื่อโควตากลับมา',
                { title: 'ส่งตอนนี้ไม่ได้' });
            return;
        }

        const confirmed = await JDUI.confirm(
            'มีอีเมลค้างส่ง ' + pending.length + ' ฉบับ และวันนี้ยังส่งได้อีก ' +
            (quota < 0 ? 'ไม่ทราบจำนวน' : quota + ' ฉบับ') + '\nเริ่มส่งเลยหรือไม่?',
            { title: 'ส่งคิวตอนนี้', okText: 'ส่งเลย' }
        );
        if (!confirmed) return;

        let budget = quota < 0 ? pending.length : quota;
        let sent = 0, failed = 0, stoppedByQuota = false;

        JDUI.loading.show('กำลังส่งอีเมลในคิว');
        for (const item of pending) {
            if (budget <= 0) { stoppedByQuota = true; break; }
            const r = await sendQueued(item);
            if (r.ok) { sent++; budget--; }
            else if (r.quota) { stoppedByQuota = true; break; }
            else failed++;
        }
        JDUI.loading.hide();

        await loadQueue();
        await refreshQuota();

        let msg = 'ส่งสำเร็จ ' + sent + ' ฉบับ';
        if (failed) msg += ' • ส่งไม่สำเร็จ ' + failed + ' ฉบับ (ดูรายละเอียดในรายการ)';
        if (stoppedByQuota) msg += '\n\nโควตาของวันนี้หมดแล้ว ส่วนที่เหลือระบบจะส่งให้อัตโนมัติในวันถัดไป';

        if (failed) JDUI.warning(msg, { title: 'ส่งคิวเสร็จสิ้นบางส่วน' });
        else JDUI.success(msg, { title: 'ส่งคิวเรียบร้อย' });
    }

    function deleteQueueItem(id) {
        JDUI.confirm('ลบรายการนี้ออกจากคิว? อีเมลฉบับนี้จะไม่ถูกส่งอีก', {
            title: 'ยืนยันการลบ', okText: 'ลบ'
        }).then(function (ok) {
            if (!ok) return;
            return db.collection('mail_queue').doc(id).delete().then(loadQueue);
        }).catch(function (err) {
            console.error(err);
            JDUI.error('ลบไม่สำเร็จ', { title: 'เกิดข้อผิดพลาด' });
        });
    }

    // ═══════════════ Hourly trigger heartbeat ═══════════════
    //
    // The Apps Script trigger runs on Google's servers with no visibility from
    // here, so it stamps app_config/mailer_status on every run. What matters is not
    // what the last run did but WHEN it was: a timestamp older than ~2 hours means
    // the trigger was never installed, was deleted, or is failing to run at all.
    const MAILER_STALE_MS = 2 * 60 * 60 * 1000;

    function loadMailerStatus() {
        const $el = $('#mailerStatus');

        return db.collection('app_config').doc('mailer_status').get()
            .then(function (doc) {
                $el.removeClass('good stale bad');

                if (!doc.exists) {
                    $el.addClass('bad').html(
                        '<b>⚠️ ตัวส่งอัตโนมัติยังไม่เคยทำงาน</b><br>' +
                        'ยังไม่ได้ติดตั้ง trigger ใน Apps Script (กด Run ฟังก์ชัน <b>createHourlyTrigger</b> หนึ่งครั้ง) ' +
                        'ระหว่างนี้คิวจะถูกส่งเมื่อกดปุ่ม “ส่งคิวตอนนี้” เท่านั้น'
                    );
                    return;
                }

                const d = doc.data();
                const last = d.lastRunAt?.toDate ? d.lastRunAt.toDate() : null;
                if (!last) {
                    $el.addClass('bad').text('⚠️ ไม่พบเวลาทำงานล่าสุดของตัวส่งอัตโนมัติ');
                    return;
                }

                const ageMs = Date.now() - last.getTime();
                const mins = Math.round(ageMs / 60000);
                const ago = mins < 60 ? mins + ' นาทีที่แล้ว' : Math.round(mins / 60) + ' ชั่วโมงที่แล้ว';
                const detail = 'ทำงานล่าสุด ' + fmtTime(d.lastRunAt) + ' (' + ago + ')' +
                               (d.lastNote ? '<br>' + escapeText(d.lastNote) : '');

                if (ageMs > MAILER_STALE_MS) {
                    $el.addClass('stale').html(
                        '<b>⚠️ ตัวส่งอัตโนมัติไม่ได้ทำงานมานาน</b><br>' + detail +
                        '<br>ควรตรวจสอบที่ Apps Script → Executions'
                    );
                } else if (d.lastOk === false) {
                    $el.addClass('bad').html('<b>⚠️ ตัวส่งอัตโนมัติทำงานแต่มีข้อผิดพลาด</b><br>' + detail);
                } else {
                    $el.addClass('good').html('<b>✅ ตัวส่งอัตโนมัติทำงานปกติ</b><br>' + detail);
                }
            })
            .catch(function (err) {
                console.error(err);
                $el.removeClass('good stale bad').text('ตรวจสอบสถานะตัวส่งอัตโนมัติไม่ได้');
            });
    }

    // The status line is built with .html() so it can carry <br> and <b>; anything
    // coming from the Apps Script side goes through here first.
    function escapeText(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ═══════════════ System log ═══════════════

    const logs = { all: [], level: 'ALL', q: '', loading: false };
    const LOG_LIMIT = 200;

    function loadLogs() {
        if (logs.loading) return Promise.resolve();
        logs.loading = true;
        $('#logList').html('<div class="empty-note">กำลังโหลด…</div>');

        // One orderBy on a single field — served by the automatic index.
        return db.collection('app_logs').orderBy('ts', 'desc').limit(LOG_LIMIT).get()
            .then(function (snap) {
                logs.all = snap.docs.map(function (d) {
                    return Object.assign({ id: d.id }, d.data());
                });
                renderLogs();
            })
            .catch(function (err) {
                console.error(err);
                $('#logList').html('<div class="empty-note">โหลด log ไม่สำเร็จ</div>');
            })
            .finally(function () { logs.loading = false; });
    }

    function renderLogs() {
        const $list = $('#logList').empty();
        const rows = logs.all.filter(function (it) {
            if (logs.level !== 'ALL' && it.level !== logs.level) return false;
            if (!logs.q) return true;
            return ((it.message || '') + ' ' + (it.action || '') + ' ' + (it.jdId || '') + ' ' + (it.service || ''))
                .toLowerCase().includes(logs.q);
        });

        if (!rows.length) {
            $list.html('<div class="empty-note">ไม่มีรายการ</div>');
            return;
        }

        rows.forEach(function (it) {
            const $row = $('<div class="log-row ' + (it.level || 'info') + '"></div>');
            $('<div class="log-time"></div>').text(fmtTime(it.ts)).appendTo($row);

            const $body = $('<div class="log-body"></div>').appendTo($row);
            const $head = $('<div class="log-head"></div>').appendTo($body);
            $('<span class="log-tag"></span>').text(it.service || 'app').appendTo($head);
            $head.append(document.createTextNode(
                (it.action || '') + (it.code ? ' • ' + it.code : '')
            ));

            if (it.message) $('<div class="log-msg"></div>').text(it.message).appendTo($body);

            // The page is always worth showing: for an uncaught error it is often
            // the only clue about where the failure happened.
            const where = (it.jdId ? 'เอกสาร: ' + it.jdId + ' • ' : '') + 'หน้า: ' + (it.page || '—');
            $('<div class="log-msg"></div>').text(where).appendTo($body);

            $list.append($row);
        });
    }

    // Housekeeping so the collection does not grow without bound. Deletes only what
    // is currently loaded and older than the cut-off, so it is safe to press twice.
    async function purgeLogs() {
        const days = 30;
        const confirmed = await JDUI.confirm('ลบ log ที่เก่ากว่า ' + days + ' วันทั้งหมด?', {
            title: 'ล้าง log เก่า', okText: 'ลบ'
        });
        if (!confirmed) return;

        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        JDUI.loading.show('กำลังลบ log เก่า');
        try {
            const snap = await db.collection('app_logs').where('ts', '<', cutoff).limit(400).get();
            // Firestore caps a batch at 500 writes; 400 keeps a margin and the button
            // can simply be pressed again for a larger backlog.
            const batch = db.batch();
            snap.docs.forEach(function (d) { batch.delete(d.ref); });
            await batch.commit();
            JDUI.loading.hide();
            JDUI.success('ลบ log เก่าแล้ว ' + snap.size + ' รายการ' +
                (snap.size === 400 ? ' (ยังมีเหลือ กดซ้ำได้อีก)' : ''), { title: 'ล้าง log เรียบร้อย' });
            loadLogs();
        } catch (err) {
            JDUI.loading.hide();
            console.error(err);
            JDUI.error('ลบ log ไม่สำเร็จ', { title: 'เกิดข้อผิดพลาด' });
        }
    }

    // ---------- Wire up ----------
    $(document).ready(function () {
        $('#loginForm').on('submit', handleLogin);
        $('#logoutBtn').on('click', logout);

        // Tabs. The queue and log tabs load lazily — no reason to read those
        // collections for an admin who only came to edit the department list.
        $('.tab').on('click', function () {
            const t = $(this).data('tab');
            $('.tab').removeClass('active');
            $(this).addClass('active');
            $('.tab-panel').removeClass('active');
            $('#tab-' + t).addClass('active');
            if (t === 'queue') {
                loadMailerStatus();                     // always re-check: staleness is the signal
                if (!queue.all.length) loadQueue();
            }
            if (t === 'logs' && !logs.all.length) loadLogs();
        });

        // Submissions: search / filter / refresh.
        // Scoped to this panel: the queue and log tabs use .chip too, and an
        // unscoped selector would fire this handler for those as well.
        $('.subsSearch').on('input', function () { subs.q = this.value.trim().toLowerCase(); renderSubs(); });
        $('#tab-forms .chip').on('click', function () {
            $('#tab-forms .chip').removeClass('active');
            $(this).addClass('active');
            subs.filter = $(this).data('status');
            loadSubs();                       // the filter is part of the Firestore query now
        });
        $('.subsRefresh').on('click', loadSubs);
        $('#subsList').on('click', '.subsMore', loadMoreSubs);
        // The resend/delete buttons sit inside the row's link — block navigation.
        $('#subsList').on('click', '.sub-resend', function (e) {
            e.preventDefault();
            e.stopPropagation();
            resendSub($(this).data('id'), $(this).data('name'));
        });
        $('#subsList').on('click', '.sub-del', function (e) {
            e.preventDefault();
            e.stopPropagation();
            deleteSub($(this).data('id'), $(this).data('name'));
        });

        // Mail queue
        $('#queueRefresh').on('click', function () { loadQueue(); loadMailerStatus(); refreshQuota(); });
        $('#queueDrainBtn').on('click', drainQueueNow);
        $('#queueSearch').on('input', function () { queue.q = this.value.trim().toLowerCase(); renderQueue(); });
        $('.qchip').on('click', function () {
            $('.qchip').removeClass('active');
            $(this).addClass('active');
            queue.filter = $(this).data('qstatus');
            loadQueue();
        });
        $('#queueList').on('click', '.q-send', function () {
            const id = $(this).data('id');
            const item = queue.all.find(function (x) { return x.id === id; });
            if (!item) return;
            JDUI.loading.show('กำลังส่งอีเมล');
            sendQueued(item).then(function (r) {
                JDUI.loading.hide();
                if (r.ok) JDUI.success('ส่งอีเมลไปยัง ' + item.to + ' เรียบร้อยแล้ว', { title: 'ส่งสำเร็จ' });
                else if (r.quota) JDUI.warning('โควตาอีเมลของวันนี้เต็มแล้ว ระบบจะส่งให้อัตโนมัติในวันถัดไป', { title: 'ยังส่งไม่ได้' });
                else JDUI.error(String(r.err?.message || 'ส่งไม่สำเร็จ'), { title: 'ส่งไม่สำเร็จ' });
                loadQueue();
                refreshQuota();
            });
        });
        $('#queueList').on('click', '.q-del', function () { deleteQueueItem($(this).data('id')); });

        // System log
        $('#logRefresh').on('click', loadLogs);
        $('#logPurgeBtn').on('click', purgeLogs);
        $('#logSearch').on('input', function () { logs.q = this.value.trim().toLowerCase(); renderLogs(); });
        $('.lchip').on('click', function () {
            $('.lchip').removeClass('active');
            $(this).addClass('active');
            logs.level = $(this).data('level');
            renderLogs();
        });

        $('.addBtn').on('click', function () {
            addOne($(this).closest('.card').data('doc'));
        });
        $('.addInput').on('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); addOne($(this).closest('.card').data('doc')); }
        });

        $('.searchInput').on('input', function () {
            render($(this).closest('.card').data('doc'));
        });

        // Commit edit on blur/Enter (change fires on blur when the value differs).
        $('.list').on('change', '.name', function () {
            editOne($(this).closest('.card').data('doc'), $(this).data('id'), $(this));
        });
        $('.list').on('keydown', '.name', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
        });

        $('.list').on('click', '.del', function () {
            deleteOne($(this).closest('.card').data('doc'), $(this).closest('li').data('id'));
        });
        $('.list').on('click', '.seedCardBtn', function () {
            seedCard($(this).closest('.card').data('doc'));
        });

        // Drive the UI off Firebase Auth state. Persists across reloads via
        // Firebase's own session, and any rule rejection still blocks data access.
        auth.onAuthStateChanged(function (user) {
            if (user) {
                showAdmin();
            } else {
                showLogin();
            }
        });
    });
})();
