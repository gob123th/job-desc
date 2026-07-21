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
            $list.append($a);
        });

        renderMoreBar($list);
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
            loadSubs();                       // the filter is part of the Firestore query now
        });
        $('.subsRefresh').on('click', loadSubs);
        $('#subsList').on('click', '.subsMore', loadMoreSubs);

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
