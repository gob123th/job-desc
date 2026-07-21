const firebaseConfig = {
  apiKey: "AIzaSyAFczaY55KFKGY7wD4mOO048cQCoLrBye4",
  authDomain: "jd-online-2026.firebaseapp.com",
  projectId: "jd-online-2026",
  storageBucket: "jd-online-2026.firebasestorage.app",
  messagingSenderId: "599787831802",
  appId: "1:599787831802:web:6fd61924840e188091a443"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Offline persistence (IndexedDB). Documents already fetched are served from the local
// cache instead of costing another Firestore read on reload / back-navigation.
// Fails harmlessly when several tabs are open (failed-precondition) or the browser has no
// IndexedDB (unimplemented) — the app just falls back to network-only reads.
db.enablePersistence({ synchronizeTabs: true }).catch(function (err) {
  console.warn('Firestore offline persistence unavailable:', err.code);
});