/* App navigation: Home · Trades · Market · Stats · More.
   Each dashboard section carries data-views="..." naming the tabs it shows on; this file switches between them.
   Phones get a bottom tab bar (like most trading apps), iPads and computers get tabs under the header.
   Settings and less-used actions (fees, accounts, share, export, members, admin, sign out) live in the More menu. */
(function(){
  const VIEWS = [
    ["home", "Home", '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>'],
    ["trades", "Trades", '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 9h8M8 13h8M8 17h5"/>'],
    ["market", "Market", '<path d="M4 19h16"/><path d="M6 15l4-5 3 3 5-7"/><path d="M15 6h3v3"/>'],
    ["stats", "Stats", '<path d="M5 20V11M10 20V5M15 20v-7M20 20V8"/>'],
    ["more", "More", '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>'],
  ];
  const LSget = () => { try { return localStorage.getItem("spread-ledger-view"); } catch { return null; } };
  const LSset = v => { try { localStorage.setItem("spread-ledger-view", v); } catch {} };
  let view = (location.hash.slice(1) && VIEWS.some(v => v[0] === location.hash.slice(1) && v[0] !== "more")) ? location.hash.slice(1) : (LSget() || "home");
  if (!VIEWS.some(v => v[0] === view) || view === "more") view = "home";

  const css = `
#appnav{display:flex;gap:4px;background:var(--sunk);padding:4px;border-radius:12px;width:max-content;max-width:100%}
#appnav button{display:flex;align-items:center;gap:7px;border:none;background:none;padding:8px 14px;border-radius:9px;font:inherit;font-size:14px;font-weight:650;color:var(--muted);cursor:pointer}
#appnav button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
#appnav button[data-view="more"] svg{fill:currentColor;stroke:none}
#appnav button[aria-current="page"]{background:var(--surface);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.12)}
#appnav button .dot{width:7px;height:7px;border-radius:50%;background:var(--loss);display:none}
#appnav button.alerting .dot{display:inline-block}
/* show each section only on its tabs */
${VIEWS.map(([v]) => `body[data-view="${v}"] #dash > [data-views]:not([data-views~="${v}"])`).join(",\n")}{display:none!important}
body[data-view="home"] #outlook > details{display:none}
/* alerts (expiring trades, auto-closes) come right after the account tabs */
#dash > .acctbar{order:-2} #dash > #alert{order:-1}
body:not([data-view="home"]) #outlook .ol-golink{display:none}
#outlook .ol-golink{justify-self:start;margin-top:2px}
/* moved into More */
header.top .userbar, #dash .acctbar > .actions, #ownerBar .ownerbar{display:none!important}
header.top{align-items:center}
#morePanel{position:fixed;inset:0;z-index:30;background:rgba(10,16,13,.45);display:flex;justify-content:flex-end;align-items:flex-start}
#morePanel .menu{background:var(--surface);border:1px solid var(--line);border-radius:14px;margin:70px 16px 0 16px;width:min(340px,100%);padding:8px;display:grid;gap:2px;box-shadow:0 20px 50px rgba(0,0,0,.25);max-height:calc(100vh - 100px);overflow-y:auto}
#morePanel .who{padding:10px 12px 8px;font-size:13px;color:var(--muted);border-bottom:1px solid var(--line);margin-bottom:4px;overflow-wrap:anywhere}
#morePanel .who b{color:var(--ink);display:block;font-size:14px}
#morePanel .item{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;border:none;background:none;padding:11px 12px;border-radius:9px;font:inherit;font-size:15px;font-weight:600;color:var(--ink);cursor:pointer}
#morePanel .item:hover,#morePanel .item:focus-visible{background:var(--sunk)}
#morePanel .item .hint{font-weight:500}
#morePanel .item.danger{color:var(--loss)}
#morePanel .sep{height:1px;background:var(--line);margin:4px 6px}
@media (max-width:760px){
  #appnav{position:fixed;left:0;right:0;bottom:0;z-index:15;width:auto;max-width:none;border-radius:0;background:var(--surface);border-top:1px solid var(--line);
    padding:6px 6px calc(6px + env(safe-area-inset-bottom,0px));justify-content:space-around;gap:0;box-shadow:0 -4px 14px rgba(0,0,0,.06)}
  #appnav button{flex:1;flex-direction:column;gap:3px;padding:6px 2px;font-size:11px;font-weight:600;border-radius:8px;position:relative}
  #appnav button svg{width:23px;height:23px}
  #appnav button[aria-current="page"]{background:none;box-shadow:none;color:var(--accent)}
  #appnav button .dot{position:absolute;top:4px;left:calc(50% + 8px)}
  body{padding-bottom:calc(74px + env(safe-area-inset-bottom,0px))}
  header.top .muted{display:none}
  #morePanel{align-items:flex-end}
  #morePanel .menu{margin:0;width:100%;border-radius:16px 16px 0 0;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));max-height:85vh}
}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  function mount(){
    const header = document.querySelector("header.top"); if (!header || document.getElementById("appnav")) return;
    const nav = document.createElement("nav"); nav.id = "appnav"; nav.setAttribute("aria-label", "Sections");
    nav.innerHTML = VIEWS.map(([v, label, icon]) => `<button type="button" data-view="${v}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span><i class="dot" aria-hidden="true"></i></button>`).join("");
    header.after(nav);
    nav.addEventListener("click", ev => { const b = ev.target.closest("[data-view]"); if (!b) return; b.dataset.view === "more" ? openMore() : go(b.dataset.view); });
    document.addEventListener("click", ev => { const g = ev.target.closest("[data-goview]"); if (g){ ev.preventDefault(); go(g.dataset.goview); } }, true);
    window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (h && h !== view && VIEWS.some(v => v[0] === h && h !== "more")) go(h, true); });
    apply(false);
    // Members page and member dashboards are switched by the app; keep the tab highlight in sync and flag what needs attention.
    setInterval(sync, 1000);
  }
  function apply(scroll){
    document.body.dataset.view = view;
    document.querySelectorAll("#appnav [data-view]").forEach(b => b.setAttribute("aria-current", b.dataset.view === view && !onMembers() ? "page" : "false"));
    if (scroll) window.scrollTo({top: 0});
  }
  const app = () => window.LedgerApp ? window.LedgerApp.state() : {};
  const onMembers = () => !!app().members;
  function go(v, fromHash){
    view = v; LSset(v);
    if (!fromHash && location.hash !== "#" + v) history.replaceState(null, "", "#" + v);
    if (onMembers() && window.LedgerApp) window.LedgerApp.backToMine();
    apply(true);
    // charts measure their width when drawn; redraw now that the section is visible
    if (window.LedgerApp) try { window.LedgerApp.render(); } catch {}
    window.dispatchEvent(new Event("resize"));
  }
  function sync(){
    const want = document.body.dataset.view;
    if (want !== view) apply(false);
    const alerting = !!document.querySelector("#alert .alert");
    const homeBtn = document.querySelector('#appnav [data-view="home"]'); if (homeBtn) homeBtn.classList.toggle("alerting", alerting && view !== "home");
    const more = document.querySelector('#appnav [data-view="more"]');
    const a = app(); if (more) more.classList.toggle("alerting", a.owner && a.pending > 0);
    document.querySelectorAll("#appnav [data-view]").forEach(b => { if (b.dataset.view !== "more") b.setAttribute("aria-current", b.dataset.view === view && !onMembers() ? "page" : "false"); });
  }

  /* ---------- More menu ---------- */
  function openMore(){
    closeMore();
    const a = app(), owner = !!a.owner, admin = !!a.admin, db = !!a.db, ro = !!a.readOnly, pending = a.pending || 0, viewingOther = !!a.viewingOther;
    const who = document.getElementById("whoami")?.textContent || "", sync = document.getElementById("sync")?.textContent || "";
    const canInstall = document.getElementById("installBtn") && !document.getElementById("installBtn").hidden;
    const item = (attrs, label, hint, cls) => `<button type="button" class="item ${cls || ""}" ${attrs}><span>${label}</span>${hint ? `<span class="hint">${hint}</span>` : ""}</button>`;
    const items = [
      who ? `<div class="who"><b>${esc(who.split(" · ")[0])}</b>${esc(sync)}</div>` : "",
      viewingOther || onMembers() ? item('data-page="mine"', "My dashboard") : "",
      owner ? item('data-page="members"', "Members", pending ? `<span class="pill due">${pending} pending</span>` : "") : "",
      owner ? item('data-act="toggleAdmin"', "Admin mode", admin ? "On · Edit and Remove shown" : "Off") : "",
      owner && "Notification" in window && Notification.permission === "default" ? item('data-act="enableAlerts"', "Turn on sign-up alerts") : "",
      owner ? '<div class="sep"></div>' : "",
      !ro || a.adminOK ? item('data-act="feeSettings"', "Fees per contract") : "",
      !ro ? item('data-act="manageAccts"', "Manage accounts") : "",
      db && !ro ? item('data-act="shareOpen"', "Share progress", "read-only link") : "",
      item('data-act="exportXlsx"', "Export to Excel"),
      '<div class="sep"></div>',
      canInstall ? item('data-more="install"', "Install app") : "",
      db ? item('data-more="signout"', "Sign out", "", "danger") : "",
    ].join("");
    const el = document.createElement("div"); el.id = "morePanel"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "More");
    el.innerHTML = `<div class="menu">${items}</div>`;
    document.body.appendChild(el);
    el.addEventListener("click", ev => {
      if (ev.target === el){ closeMore(); return; }
      const m = ev.target.closest("[data-more]");
      if (m){ ev.stopPropagation(); closeMore(); (m.dataset.more === "install" ? document.getElementById("installBtn") : document.getElementById("signOutBtn"))?.click(); return; }
      if (ev.target.closest("[data-act],[data-page]")){
        // let the app's own click handler run, then close the menu (Members switches the page, so leave the tab highlight)
        setTimeout(() => { closeMore(); if (ev.target.closest('[data-page="mine"]')) apply(false); }, 0);
      }
    });
    el.querySelector(".item")?.focus();
  }
  function closeMore(){ document.getElementById("morePanel")?.remove(); }
  document.addEventListener("keydown", ev => { if (ev.key === "Escape") closeMore(); });
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
