// 1) Paste your Firebase web app config here (Firebase console → Project settings → Your apps → Web app).
//    These values are safe to publish: access is controlled by firestore.rules, not by hiding them.
export const firebaseConfig = {
  apiKey: "AIzaSyCp3ppaGQBRrpj5VxLshIOO-xyIPPJrydA",
  authDomain: "spread-ledger.firebaseapp.com",
  projectId: "spread-ledger",
  storageBucket: "spread-ledger.firebasestorage.app",
  messagingSenderId: "497665517719",
  appId: "1:497665517719:web:00abbca264dbacce2521d2",
};

// 2) After you sign up on the site the first time, it shows "Your user ID". Paste it here
//    AND in firestore.rules so your account becomes the master account.
export const OWNER_UID = "owe2stqvSHZFvSqISvgwsh7tLUg2";

// 3) Optional: get an email when someone signs up. Create a free form at https://formspree.io
//    (sign in with the email that should receive alerts), then paste the form ID here,
//    e.g. "xpzgkqjw" from https://formspree.io/f/xpzgkqjw. Leave "" to turn email alerts off.
export const SIGNUP_ALERT_FORMSPREE = "";
