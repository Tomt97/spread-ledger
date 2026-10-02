// Firebase sign-in + a small adapter that gives the tracker the same storage API it used on Claude.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, signOut, deleteUser, updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot,
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
const fs = getFirestore(app);

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
  try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { alertBox(nice(e)); }
});
$("#forgotBtn").addEventListener("click", async () => {
  const email = $("#email").value.trim();
  if (!email) return alertBox("Type your email above, then choose Forgot password.");
  try { await sendPasswordResetEmail(auth, email); alertBox(`Password reset email sent to ${email}.`); }
  catch (e) { alertBox(nice(e)); }
});
$("#signOutBtn").addEventListener("click", async () => { await signOut(auth); });

let started = false;
onAuthStateChanged(auth, u => {
  if (!u) {
    if (leaving) return;
    if (started) return location.reload();
    $("#login").hidden = false; $("#app").hidden = true; return;
  }
  $("#login").hidden = true; $("#app").hidden = false;
  $("#whoami").textContent = u.email || u.displayName || "";
  if (OWNER_UID.startsWith("PASTE")) {
    $("#ownerSetup").hidden = false;
    $("#myUid").textContent = u.uid;
  }
  if (!started) { started = true; window.startLedger(); }
});
