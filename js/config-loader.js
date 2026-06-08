// Shared config layer for the JD app: department / position master lists.
//
// Firestore layout — one document per item:
//   collection "departments" / <auto-id> -> { name: "Finance",  createdAt: <ts> }
//   collection "positions"   / <auto-id> -> { name: "IT Manager", createdAt: <ts> }
//
// Used by:
//   - index.html  : populate the <datalist> dropdowns on the JD form
//   - admin.html  : manage (add / edit / delete) the items, one Firestore doc each
//
// The form loads exactly what's in Firestore — no fallback. An empty collection means an
// empty dropdown. DEFAULTS below is used ONLY by the admin "seed" buttons (a manual action),
// never automatically.
window.JDConfig = (function () {
    // Firestore collection name per config type.
    const COLLECTION = { departments: 'departments', positions: 'positions' };

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

    // Overwrite the cached list for a type with a known-good list ([{ id, name }]).
    // Lets the admin push its in-memory state straight into the cache after a mutation,
    // so the next form load is served entirely from cache with zero Firestore reads.
    function setCache(type, items) {
        if (Array.isArray(items)) writeCache(type, items);
    }

    // Invalidate cached lists. clearCache() with no arg clears every type.
    function clearCache(type) {
        try {
            if (type) localStorage.removeItem(cacheKey(type));
            else Object.keys(COLLECTION).forEach(function (k) { localStorage.removeItem(cacheKey(k)); });
        } catch (e) { /* ignore */ }
    }

    // ---------- Per-document CRUD ----------
    // Read every doc in a collection. Returns Promise<[{ id, name }]> sorted by name; [] on error.
    // When useCache is true, a fresh localStorage copy is returned without hitting Firestore.
    // Every successful network read refreshes the cache so it stays warm for the form.
    function loadItems(type, useCache) {
        if (useCache) {
            const cached = readCache(type);
            if (cached) return Promise.resolve(cached);
        }
        return db.collection(COLLECTION[type]).get()
            .then(function (snap) {
                const out = [];
                snap.forEach(function (doc) {
                    const name = doc.get('name');
                    if (name) out.push({ id: doc.id, name: name });
                });
                out.sort(function (a, b) { return a.name.localeCompare(b.name); });
                writeCache(type, out);
                return out;
            })
            .catch(function (err) {
                console.error('JDConfig: failed to load collection ' + COLLECTION[type], err);
                return [];
            });
    }

    function addItem(type, name) {
        return db.collection(COLLECTION[type]).add({ name: name, createdAt: now() })
            .then(function (ref) { clearCache(type); return ref; });
    }

    function updateItem(type, id, name) {
        return db.collection(COLLECTION[type]).doc(id).update({ name: name, updatedAt: now() })
            .then(function (res) { clearCache(type); return res; });
    }

    function deleteItem(type, id) {
        return db.collection(COLLECTION[type]).doc(id).delete()
            .then(function (res) { clearCache(type); return res; });
    }

    // Bulk-create docs for a list of names (used by the admin seed buttons). Returns Promise.
    function addMany(type, names) {
        const batch = db.batch();
        const col = db.collection(COLLECTION[type]);
        names.forEach(function (name) {
            batch.set(col.doc(), { name: name, createdAt: now() });
        });
        return batch.commit().then(function (res) { clearCache(type); return res; });
    }

    // ---------- Submitted JD forms (admin status list) ----------
    // Returns Promise<[{ id, positionName, department, employeeName, status, createdAt:Date|null }]>
    // sorted newest first; [] on error.
    function loadSubmissions() {
        return db.collection('job_descriptions').get()
            .then(function (snap) {
                const out = [];
                snap.forEach(function (doc) {
                    const d = doc.data() || {};
                    out.push({
                        id: doc.id,
                        positionName: d.positionName || '',
                        department: d.department || '',
                        employeeName: d.employeeName || '',
                        status: d.status || '',
                        createdAt: (d.createdAt && d.createdAt.toDate) ? d.createdAt.toDate() : null
                    });
                });
                out.sort(function (a, b) {
                    return (b.createdAt ? b.createdAt.getTime() : 0) - (a.createdAt ? a.createdAt.getTime() : 0);
                });
                return out;
            })
            .catch(function (err) {
                console.error('JDConfig: failed to load job_descriptions', err);
                return [];
            });
    }

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
        addItem: addItem,
        updateItem: updateItem,
        deleteItem: deleteItem,
        addMany: addMany,
        setCache: setCache,
        clearCache: clearCache,
        loadSubmissions: loadSubmissions,
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
