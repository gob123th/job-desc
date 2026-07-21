// Shared config layer for the JD app: department / position master lists.
//
// Firestore layout — BOTH lists live in ONE document, so loading the dropdowns costs a
// single read instead of one read per item (~110 before):
//   app_config/master -> { departments: [{ id, name }], positions: [{ id, name }], updatedAt }
//
// LEGACY layout (one doc per item, collections "departments" / "positions") is still read
// as a fallback when app_config/master does not exist yet, and an admin visit migrates it
// into the single doc automatically. The old collections are left in place untouched.
//
// Used by:
//   - index.html  : populate the <datalist> dropdowns on the JD form
//   - admin.html  : manage (add / edit / delete) the items
//
// The form loads exactly what's in Firestore — no fallback. An empty list means an empty
// dropdown. DEFAULTS below is used ONLY by the admin "seed" buttons (a manual action),
// never automatically.
window.JDConfig = (function () {
    // Legacy per-item collection name per config type (read-only fallback / migration source).
    const COLLECTION = { departments: 'departments', positions: 'positions' };

    // The single document holding both master lists.
    const MASTER_PATH = { collection: 'app_config', doc: 'master' };
    function masterRef() { return db.collection(MASTER_PATH.collection).doc(MASTER_PATH.doc); }

    // Built-in starter lists for the admin "seed" buttons (mirrors what used to be
    // hardcoded in index.html). Not used on the JD form.
    const DEFAULTS = {
        departments: [
            'Account', 'Bill Collector', 'BL - Paints', 'BL - Plastics',
            'BL - Cosmetics & Pharmaceutical', 'BL - Food & Basic Chemical', 'BL - IA & Rubber',
            'BL - Instruments (BGG) & Machinery', 'BL - Paint & Graphic Arts',
            'BU - Sugar & Water Treatment', 'Daily Warehouse', 'Finance', 'General Affairs',
            'Human Resources', 'Information Technology', 'Laboratory', 'Management',
            'Procurement Domestic', 'Procurement Overseas', 'Sales & Marketing',
            'Sales Coordinator', 'Sales Secretary', 'Shipping', 'Technical Service',
            'WH - Administration', 'WH - Delivery', 'WH - Operation', 'WH - Quality Control'
        ],
        positions: [
            'Account Costing Officer', 'Account General Ledger Officer', 'Account Manager',
            'Account Payable Officer', 'Account Payable Supervisor', 'Account Receivable Officer',
            'Account Receivables Supervisor', 'Administration Officer', 'Assistant Accounting Manager',
            'Assistant Deputy Managing Director', 'Assistant Laboratory Manager', 'Assistant Sales Manager',
            'Assistant Technical Officer', 'Assistant Warehouse Manager', 'BU Manager',
            'Business Data Analysis Officer', 'Business Data Analysis Supervisor',
            'Business Development Director', 'Business Line Manager', 'Chemist', 'Collector / Messenger',
            'Company Driver', 'Credit Control Officer', 'Delivery Administration Officer',
            'Delivery Officer', 'Deputy Managing Director', 'Document Control Center Officer',
            'Executive Secretary', 'Finance Manager', 'Finance Officer', 'General Affairs Supervisor',
            'General Services/Messengers', 'Human Resource Manager', 'IT Manager',
            'IT Support & Security Officer', 'Laboratory Director', 'Laboratory Officer',
            'Managing Director', 'Marketing Manager', 'Marketing Officer', 'Officer Maid',
            'Operation Manager', 'President & CEO', 'Procurement Manager', 'Procurement Officer',
            'Receptionist and Operator', 'Sales & Marketing Manager', 'Sales Coordinator',
            'Sales Coordinator Supervisor', 'Sales Engineer', 'Sales Engineer Executive',
            'Sales Executive', 'Sales Manager', 'Sales Representative', 'Sales Supervisor',
            'Secretary- Performance Chemicals', 'Secretary- Speciality Chemicals', 'Senior Admin Officer',
            'Senior Business Line Manager', 'Senior Finance Officer', 'Senior Human Resource Officer',
            'Senior Laboratory Officer', 'Senior Procurement Officer', 'Senior Programmer',
            'Senior Safety Officer', 'Senior Sales & Marketing Manager', 'Senior Sales Manager',
            'Senior Shipping Officer', 'Senior System Analysis', 'Senior Technical Service Manager',
            'Shipping Messenger', 'Shipping Officer', 'System Analysis Officer', 'Technical Officer',
            'Technical Sales Executive', 'Technical Sales Representative',
            'Technical Service Assistant Manager', 'Technical Service Manager',
            'Technical Service Supervisor', 'Technical Supervisor', 'Warehouse Maid',
            'Warehouse Manager', 'Supervisor Operation', 'Senior Operation Officer',
            'Operation & Inventory Officer', 'Inventory and Center Officer', 'Repack Officer'
        ]
    };

    function now() { return firebase.firestore.FieldValue.serverTimestamp(); }

    // ---------- localStorage cache (master lists only) ----------
    // The departments / positions master lists are read on EVERY index.html load but
    // change rarely, so we cache the parsed result in localStorage with a TTL. Any admin
    // mutation (add/update/delete/seed) clears the cache so the next form load refetches.
    const CACHE_PREFIX = 'jdcfg:';
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

    function cacheKey(type) { return CACHE_PREFIX + COLLECTION[type]; }

    function readCache(type) {
        try {
            const raw = localStorage.getItem(cacheKey(type));
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || !Array.isArray(obj.items)) return null;
            if (Date.now() - obj.t > CACHE_TTL_MS) return null; // expired
            return obj.items;
        } catch (e) { return null; } // bad JSON / private mode
    }

    function writeCache(type, items) {
        try {
            localStorage.setItem(cacheKey(type), JSON.stringify({ t: Date.now(), items: items }));
        } catch (e) { /* quota exceeded / private mode — caching is best-effort */ }
    }

    // Invalidate cached lists. clearCache() with no arg clears every type.
    function clearCache(type) {
        try {
            if (type) localStorage.removeItem(cacheKey(type));
            else Object.keys(COLLECTION).forEach(function (k) { localStorage.removeItem(cacheKey(k)); });
        } catch (e) { /* ignore */ }
    }

    // ---------- Master document I/O ----------
    function sortByName(items) {
        return items.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    }

    // Stable per-item id. Only needs to be unique within the list (the admin uses it to
    // address rows); Firestore no longer assigns one since items aren't documents anymore.
    function genId() {
        return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // Normalise whatever is stored under a field into [{ id, name }].
    function toItems(raw) {
        if (!Array.isArray(raw)) return null;
        const out = [];
        raw.forEach(function (entry) {
            const name = (typeof entry === 'string') ? entry : entry?.name;
            if (!name) return;
            out.push({ id: entry?.id || genId(), name: name });
        });
        return sortByName(out);
    }

    // One in-flight read of app_config/master shared by both types, so loading the two
    // dropdowns on a cold cache costs exactly one Firestore read (not two). Cleared by
    // saveItems() so a mutation is followed by a fresh read.
    let masterPromise = null;
    function readMaster() {
        masterPromise ||= masterRef().get()
            .then(function (doc) { return doc.exists ? (doc.data() || {}) : null; })
            .catch(function (err) {
                console.error('JDConfig: failed to read ' + MASTER_PATH.collection + '/' + MASTER_PATH.doc, err);
                return null;
            });
        return masterPromise;
    }

    // Read the legacy one-doc-per-item collection (pre-migration data / older deployments).
    function readLegacy(type) {
        return db.collection(COLLECTION[type]).get()
            .then(function (snap) {
                const out = [];
                snap.forEach(function (doc) {
                    const name = doc.get('name');
                    if (name) out.push({ id: doc.id, name: name });
                });
                return sortByName(out);
            })
            .catch(function (err) {
                console.error('JDConfig: failed to load legacy collection ' + COLLECTION[type], err);
                return [];
            });
    }

    // ---------- Public read / write ----------
    // Returns Promise<[{ id, name }]> sorted by name; [] on error.
    // When useCache is true, a fresh localStorage copy is returned without hitting Firestore.
    // Every successful network read refreshes the cache so it stays warm for the form.
    function loadItems(type, useCache) {
        if (useCache) {
            const cached = readCache(type);
            if (cached) return Promise.resolve(cached);
        }
        return readMaster().then(function (data) {
            const items = data ? toItems(data[type]) : null;
            if (items) {
                writeCache(type, items);
                return items;
            }
            // No master doc (or no field for this type) yet — fall back to the legacy
            // collection and migrate it into the master doc. The migration write is
            // best-effort: it only succeeds for a signed-in admin, and the public form
            // keeps working off the legacy read either way.
            return readLegacy(type).then(function (legacy) {
                writeCache(type, legacy);
                if (legacy.length) saveItems(type, legacy).catch(function () { /* not an admin */ });
                return legacy;
            });
        });
    }

    // Persist the full list for a type into the master document. Takes [{ id, name }] (items
    // without an id get one) and resolves with the normalised, sorted list that was written.
    // The whole list is written at once — item-level add/edit/delete happen in memory in the
    // admin, then land here as a single write.
    function saveItems(type, items) {
        const clean = sortByName(items.map(function (i) {
            return { id: i.id || genId(), name: i.name };
        }));
        const payload = { updatedAt: now() };
        payload[type] = clean;
        return masterRef().set(payload, { merge: true }).then(function () {
            masterPromise = null;   // force a fresh read next time
            writeCache(type, clean);
            return clean;
        });
    }

    // Build items from a list of names and persist them (used by the admin seed buttons).
    function addMany(type, names) {
        return saveItems(type, names.map(function (name) {
            return { id: genId(), name: name };
        }));
    }

    // ---------- Submitted JD forms (admin status list) ----------
    // Read one PAGE of submissions instead of the whole collection — the admin list used to
    // cost one Firestore read per submitted form on every visit.
    //
    // opts: { status: 'ALL'|<status>, cursor: <last doc snapshot>|null, pageSize: number }
    // Resolves with { items, cursor, hasMore }; items are
    // [{ id, positionName, department, employeeName, status, createdAt:Date|null }] newest first.
    // Note: ordering is by createdAt, which every submission gets on create (js/script.js).
    const SUBS_PAGE_SIZE = 30;

    function loadSubmissions(opts) {
        const o = opts || {};
        const pageSize = o.pageSize || SUBS_PAGE_SIZE;

        let q = db.collection('job_descriptions');
        if (o.status && o.status !== 'ALL') q = q.where('status', '==', o.status);
        q = q.orderBy('createdAt', 'desc');
        if (o.cursor) q = q.startAfter(o.cursor);
        q = q.limit(pageSize);

        return q.get()
            .then(function (snap) {
                const items = [];
                snap.forEach(function (doc) {
                    const d = doc.data() || {};
                    items.push({
                        id: doc.id,
                        positionName: d.positionName || '',
                        department: d.department || '',
                        employeeName: d.employeeName || '',
                        status: d.status || '',
                        createdAt: d.createdAt?.toDate ? d.createdAt.toDate() : null
                    });
                });
                return {
                    items: items,
                    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
                    hasMore: snap.docs.length === pageSize
                };
            })
            .catch(function (err) {
                console.error('JDConfig: failed to load job_descriptions', err);
                return { items: [], cursor: null, hasMore: false };
            });
    }

    // Permanently delete one submitted JD document. Admin-only (enforced by the
    // Firestore `allow delete: if isAdmin()` rule) — the admin page is the only
    // caller. Resolves on success, rejects on failure so the UI can report it.
    function deleteSubmission(id) {
        return db.collection('job_descriptions').doc(id).delete();
    }

    // NOTE: there is deliberately no total-count helper here. Firestore's COUNT aggregation
    // is modular-SDK only — the compat build this app uses does not expose it — and counting
    // by reading the collection is exactly the cost this paging was added to avoid. The admin
    // shows how many rows are currently loaded instead.

    // ---------- Datalist population (index.html) ----------
    function fillDatalist(datalistId, names) {
        const $dl = $('#' + datalistId);
        if (!$dl.length) return;
        $dl.empty();
        names.forEach(function (name) {
            $('<option>').attr('value', name).appendTo($dl);
        });
    }

    // Fill the form dropdowns — served from the localStorage cache when fresh, so a repeat
    // visitor loads the lists without re-reading every Firestore doc.
    function populateDatalists() {
        loadItems('departments', true).then(function (items) {
            fillDatalist('deptList', items.map(function (i) { return i.name; }));
        });
        loadItems('positions', true).then(function (items) {
            fillDatalist('posList', items.map(function (i) { return i.name; }));
        });
    }

    return {
        DEFAULTS: DEFAULTS,
        loadItems: loadItems,
        saveItems: saveItems,
        addMany: addMany,
        clearCache: clearCache,
        SUBS_PAGE_SIZE: SUBS_PAGE_SIZE,
        loadSubmissions: loadSubmissions,
        deleteSubmission: deleteSubmission,
        fillDatalist: fillDatalist,
        populateDatalists: populateDatalists
    };
})();

$(document).ready(function () {
    // Only auto-populate when the form datalists are present (i.e. on index.html).
    if (window.JDConfig && document.getElementById('deptList')) {
        window.JDConfig.populateDatalists();
    }
});
