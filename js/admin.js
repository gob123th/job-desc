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

    // Submitted JD forms view-state.
    const subs = { all: [], filter: 'ALL', q: '' };

    // status -> { label, css class, page to open }. Clicking a row goes to the page for its status.
    const STATUS = {
        APPLICANT_SUBMITTED: { label: 'รอผู้จัดการอนุมัติ', cls: 'amber', page: 'approval.html' },
        APPROVED:            { label: 'รอ HR ลงนาม',       cls: 'blue',  page: 'preview.html' },
        COMPLETED:           { label: 'เสร็จสิ้น',          cls: 'green', page: 'contract.html' }
    };
    function statusMeta(s) {
        return STATUS[s] || { label: s || 'ไม่ทราบสถานะ', cls: 'gray', page: 'preview.html' };
    }

    // ---------- Auth ----------
    function showAdmin() {
        $('#loginScreen').hide();
        $('#adminScreen').addClass('show');
        loadAll();
        loadSubs();
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

    function sortState(type) {
        state[type].sort(function (a, b) { return a.name.localeCompare(b.name); });
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

    // ---------- Mutations (persist immediately) ----------
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
        window.JDConfig.addItem(type, name).then(function (ref) {
            state[type].push({ id: ref.id, name: name });
            sortState(type);
            $input.val('').prop('disabled', false).focus();
            render(type);
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
        window.JDConfig.updateItem(type, id, newName).then(function () {
            item.name = newName;
            sortState(type);
            render(type);
            flash($c, '✓ บันทึกแล้ว', 'ok');
        }).catch(function (err) {
            $input.val(item.name);
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
            window.JDConfig.deleteItem(type, id).then(function () {
                state[type] = state[type].filter(function (i) { return i.id !== id; });
                render(type);
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
        window.JDConfig.addMany(type, names).then(function () {
            loadOne(type);
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

    function loadSubs() {
        $('#subsList').html('<div class="subs-loading"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>');
        window.JDConfig.loadSubmissions().then(function (items) {
            subs.all = items;
            updateChipCounts();
            renderSubs();
        });
    }

    function updateChipCounts() {
        const counts = { ALL: subs.all.length, APPLICANT_SUBMITTED: 0, APPROVED: 0, COMPLETED: 0 };
        subs.all.forEach(function (it) {
            if (counts[it.status] !== undefined) counts[it.status]++;
        });
        $('.chip-count').each(function () {
            const key = $(this).data('c');
            $(this).text(counts[key] !== undefined ? counts[key] : 0);
        });
    }

    function renderSubs() {
        const $list = $('#subsList');
        $list.empty();

        const rows = subs.all.filter(function (it) {
            if (subs.filter !== 'ALL' && it.status !== subs.filter) return false;
            if (!subs.q) return true;
            const hay = (it.positionName + ' ' + it.department + ' ' + it.employeeName).toLowerCase();
            return hay.indexOf(subs.q) !== -1;
        });

        if (!rows.length) {
            const msg = subs.all.length ? 'ไม่พบรายการที่ตรงกับเงื่อนไข' : 'ยังไม่มีฟอร์ม JD ที่ถูกส่งเข้ามา';
            $('<div class="subs-empty"></div>')
                .append('<div class="big">📭</div>')
                .append($('<div></div>').text(msg))
                .appendTo($list);
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
            $list.append($a);
        });
    }

    // ---------- Wire up ----------
    $(document).ready(function () {
        $('#loginForm').on('submit', handleLogin);
        $('#logoutBtn').on('click', logout);

        // Tabs
        $('.tab').on('click', function () {
            const t = $(this).data('tab');
            $('.tab').removeClass('active');
            $(this).addClass('active');
            $('.tab-panel').removeClass('active');
            $('#tab-' + t).addClass('active');
        });

        // Submissions: search / filter / refresh
        $('.subsSearch').on('input', function () { subs.q = this.value.trim().toLowerCase(); renderSubs(); });
        $('.chip').on('click', function () {
            $('.chip').removeClass('active');
            $(this).addClass('active');
            subs.filter = $(this).data('status');
            renderSubs();
        });
        $('.subsRefresh').on('click', loadSubs);

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
