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

    // ---------- Per-document CRUD ----------
    // Read every doc in a collection. Returns Promise<[{ id, name }]> sorted by name; [] on error.
    function loadItems(type) {
        return db.collection(COLLECTION[type]).get()
            .then(function (snap) {
                const out = [];
                snap.forEach(function (doc) {
                    const name = doc.get('name');
                    if (name) out.push({ id: doc.id, name: name });
                });
                out.sort(function (a, b) { return a.name.localeCompare(b.name); });
                return out;
            })
            .catch(function (err) {
                console.error('JDConfig: failed to load collection ' + COLLECTION[type], err);
                return [];
            });
    }

    function addItem(type, name) {
        return db.collection(COLLECTION[type]).add({ name: name, createdAt: now() });
    }

    function updateItem(type, id, name) {
        return db.collection(COLLECTION[type]).doc(id).update({ name: name, updatedAt: now() });
    }

    function deleteItem(type, id) {
        return db.collection(COLLECTION[type]).doc(id).delete();
    }

    // Bulk-create docs for a list of names (used by the admin seed buttons). Returns Promise.
    function addMany(type, names) {
        const batch = db.batch();
        const col = db.collection(COLLECTION[type]);
        names.forEach(function (name) {
            batch.set(col.doc(), { name: name, createdAt: now() });
        });
        return batch.commit();
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

    // Fill the form dropdowns straight from Firestore — empty collection => empty dropdown.
    function populateDatalists() {
        loadItems('departments').then(function (items) {
            fillDatalist('deptList', items.map(function (i) { return i.name; }));
        });
        loadItems('positions').then(function (items) {
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
