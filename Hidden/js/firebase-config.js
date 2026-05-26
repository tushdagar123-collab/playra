/* ══════════════════════════════════════════
   PLAYRA — FIREBASE CONFIGURATION
   ══════════════════════════════════════════ */

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAEWStonVGV68RTWSu6HQNgRrYavQIjT2M",
  authDomain: "playra-89957.firebaseapp.com",
  projectId: "playra-89957",
  storageBucket: "playra-89957.firebasestorage.app",
  messagingSenderId: "870310071750",
  appId: "1:870310071750:web:c34c77118f926f59a436c7",
  measurementId: "G-YJE0TKH1QD"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };
