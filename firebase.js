// Firebase sign-in + a small adapter that gives the tracker the same storage API it used on Claude.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, sendPasswordResetEmail, signOut, deleteUser, updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, OWNER_UID } from "./config.js";

const $ = s => document.querySelector(s);
const configured = !String(firebaseConfig.apiKey).startsWith("PASTE");
if (!configured) {
  $("#loginMsg").textContent = "Setup needed: add your Firebase config to config.js (see README).";
  $("#loginForm").hidden = true;
  throw new Error("Firebase config missing");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Home-screen apps on iPhone often block Firestore's default streaming connection, which leaves the
// dashboard empty. Installed apps use long polling; browsers auto-detect when they need it.
const standaloneApp = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const fs = initializeFirestore(app, standaloneApp ? { experimentalForceLongPolling: true } : { experimentalAutoDetectLongPolling: true });

/* ---- error mapping to the codes the tracker understands ---- */
const mapErr = e => ({
  code: e && e.code === "permission-denied" ? "invalid_argument"
      : e && e.code === "resource-exhausted" ? "quota_exceeded" : "unavailable",
  message: (e && e.message) || String(e),
});
const guard = p => p.catch(e => { throw mapErr(e); });

/* ---- adapter: collection/doc refs with get/set/update/delete/onSnapshot ---- */
const wrapDoc = s => ({ id: s.id, exists: s.exists(), data: () => s.data(), metadata: s.metadata });
const wrapQuery = q => ({ docs: q.docs.map(wrapDoc), size: q.size, empty: q.empty, docChanges: () => [], metadata: q.metadata });
function docRef(path) {
  const r = doc(fs, path);
  return {
    id: r.id, path,
    get: () => guard(getDoc(r)).then(wrapDoc),
    set: d => guard(setDoc(r, d)),
    update: d => guard(updateDoc(r, d)),
    delete: () => guard(deleteDoc(r)),
    onSnapshot: (next, err) => onSnapshot(r, s => next(wrapDoc(s)), e => err && err(mapErr(e))),
    collection: p => colRef(`${path}/${p}`),
  };
}
function colRef(path) {
  const r = collection(fs, path);
  return {
    path,
    doc: id => docRef(`${path}/${id || doc(r).id}`),
    get: () => guard(getDocs(r)).then(wrapQuery),
    onSnapshot: (next, err) => onSnapshot(r, q => next(wrapQuery(q)), e => err && err(mapErr(e))),
    add: async d => { const x = docRef(`${path}/${doc(r).id}`); await x.set(d); return x; },
  };
}
const db = { doc: docRef, collection: colRef };
const user = {
  id: async () => auth.currentUser && auth.currentUser.uid,
  isOwner: async () => !!auth.currentUser && auth.currentUser.uid === OWNER_UID,
  profiles: async () => ({}),
  memberInfo: () => {
    const u = auth.currentUser;
    return { name: u.displayName || pendingName || (u.email || "").split("@")[0] || "Member", email: u.email || "" };
  },
};
window.LEDGER_APPROVAL = true;
window.claude = { use: async name => (name === "db" ? db : name === "user" ? user : null) };

/* ---- account deletion (after the tracker erased the member's data) ---- */
let leaving = false;
window.__afterLeave = async () => {
  leaving = true;
  try { await deleteUser(auth.currentUser); }
  catch (e) {
    const box = document.querySelector(".wrap .empty");
    if (box) box.insertAdjacentHTML("beforeend", "<p>Your login itself is still active because you signed in a while ago. Sign in again and use Delete my membership once more to remove it too.</p>");
  }
  await signOut(auth);
};

/* ---- login screen ---- */
function alertBox(msg) { $("#loginMsg").textContent = msg; }
const nice = e => ({
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/user-not-found": "No account with that email. Choose Create account.",
  "auth/email-already-in-use": "That email already has an account. Choose Sign in.",
  "auth/weak-password": "Use a password with at least 6 characters.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/popup-closed-by-user": "Google sign-in was closed before finishing.",
  "auth/unauthorized-domain": "This site's domain isn't allowed yet. Add it in Firebase → Authentication → Settings → Authorized domains.",
}[e.code] || e.message);

let signupMode = false, pendingName = "";
function setMode(up) {
  signupMode = up;
  $("#loginTitle").textContent = up ? "Create your account" : "Sign in";
  $("#nameRow").hidden = !up;
  $("#loginGo").textContent = up ? "Create account" : "Sign in";
  $("#loginSwap").textContent = up ? "Have an account? Sign in" : "New here? Create an account";
  $("#password").autocomplete = up ? "new-password" : "current-password";
  alertBox("");
}
$("#loginSwap").addEventListener("click", () => setMode(!signupMode));
$("#loginForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const email = $("#email").value.trim(), pw = $("#password").value;
  $("#loginGo").disabled = true; alertBox("");
  try {
    if (signupMode) {
      pendingName = $("#displayName").value.trim();
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      const name = $("#displayName").value.trim();
      if (name) await updateProfile(cred.user, { displayName: name });
    } else {
      await signInWithEmailAndPassword(auth, email, pw);
    }
  } catch (e) { alertBox(nice(e)); }
  $("#loginGo").disabled = false;
});
$("#googleBtn").addEventListener("click", async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) {
    // Installed apps (home-screen mode) often can't open popups; fall back to a full-page redirect.
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) {
      try { await signInWithRedirect(auth, new GoogleAuthProvider()); return; } catch (e2) { return alertBox(nice(e2)); }
    }
    alertBox(nice(e));
  }
});
$("#forgotBtn").addEventListener("click", async () => {
  const email = $("#email").value.trim();
  if (!email) return alertBox("Type your email above, then choose Forgot password.");
  try { await sendPasswordResetEmail(auth, email); alertBox(`Password reset email sent to ${email}.`); }
  catch (e) { alertBox(nice(e)); }
});
getRedirectResult(auth).catch(e => alertBox(nice(e)));
$("#signOutBtn").addEventListener("click", async () => { await signOut(auth); });

/* ---- approval gate: new members wait until the owner approves them ---- */
const ownerSet = !OWNER_UID.startsWith("PASTE");
function gate(kind, u) {
  $("#app").hidden = true; $("#gate").hidden = false;
  $("#gateWho").textContent = u.email || u.displayName || "";
  const t = {
    setup: ["Finish setup", `Your user ID is <code>${u.uid}</code>. Paste it into <code>config.js</code> (OWNER_UID) and <code>firestore.rules</code>, publish the rules in Firebase, then reload this page.`],
    pending: ["Waiting for approval", "Your account was created. The owner needs to approve it before you can use the tracker. This page opens automatically once you're approved."],
    declined: ["Access not approved", "The owner hasn't approved this account. If you think this is a mistake, contact them."],
    error: ["Can't check your access", "Couldn't reach the database. Check your connection and reload. If this keeps happening, the owner may need to publish the latest firestore.rules."],
  }[kind];
  $("#gateTitle").textContent = t[0];
  $("#gateText").innerHTML = t[1];
}
let started = false, stopWatch = null, lastStatus = null;
function enterApp() {
  $("#gate").hidden = true; $("#app").hidden = false;
  if (!started) { started = true; window.startLedger(); }
}
async function checkAccess(u) {
  if (!ownerSet) return gate("setup", u);
  if (u.uid === OWNER_UID) {
    const ref = doc(fs, `members/${u.uid}`);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) await setDoc(ref, { joinedAt: Date.now(), ...user.memberInfo(), status: "approved" });
      else if (snap.data().status !== "approved") await updateDoc(ref, { status: "approved" });
    } catch (e) { return gate("error", u); }
    return enterApp();
  }
  const ref = doc(fs, `members/${u.uid}`);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) await setDoc(ref, { joinedAt: Date.now(), ...user.memberInfo(), status: "pending" });
  } catch (e) { return gate("error", u); }
  stopWatch = onSnapshot(ref, s => {
    if (!s.exists()) return;                       // membership deleted
    const st = s.data().status || "pending";
    if (st === "approved") {
      if (lastStatus && lastStatus !== "approved") location.reload();
      else enterApp();
    } else {
      if (started) return location.reload();       // access was removed while using the app
      gate(st === "declined" ? "declined" : "pending", u);
    }
    lastStatus = st;
  }, () => gate("error", u));
}
$("#gateSignOut").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, u => {
  if (!u) {
    if (stopWatch) { stopWatch(); stopWatch = null; }
    if (leaving) return;
    if (started) return location.reload();
    $("#login").hidden = false; $("#app").hidden = true; $("#gate").hidden = true; return;
  }
  $("#login").hidden = true;
  $("#whoami").textContent = `${u.email || u.displayName || ""} · ID …${u.uid.slice(-6)}`;
  checkAccess(u);
});
