// The Skarbnik site app: the routes, the redirects from the old routes, the theme button (System, Light, Dark; System
// on a first visit, following the device; the visitor's choice remembered in this browser), the phone menu, and the
// screens. Routes: #/ (Home, seven sections; #problem, #how, #proof, #paths, #rules, #check open a section, and the
// old Home section links #mechanism, #example, #why, #verify and #next are replaced by their new place),
// #/how-it-works, #/bounties,
// #/bounties/<id>[/<tab>], #/raw/<id>, #/evidence[/<tab>], #/judge[/<tab>], #/agents[/<tab>], #/vendors[/<tab>],
// #/account[/<name>[/<tab>]]. The tabs of For agents and For vendors also open from short links (#connect, #host ...).
// Old routes: #/ledger, #/arena, #/verify and #/agent redirect to their new place; #/evidence/ledger and
// #/evidence/checker open the Bounties and Proofs tabs. A saved copy at a real path (/judge/)
// opens its #/ route (and /agents/#connect its tab). Live screens read the testnet
// contract with view calls (js/chain.js); recorded parts read data/recorded.json. No sample data.
import { CONTRACT, EXPLORER_ACCOUNT } from './chain.js';
import { $, esc, initUi, tabNav } from './ui.js';
import { initAccountUi, accountPage } from './account-ui.js';
import { initDismiss } from './dismiss.js';
import { home, HOME_IDS, OLD_IDS, showSection } from './pages/home.js';
import { how } from './pages/how.js';
import { bounties } from './pages/bounties.js';
import { bounty, raw } from './pages/bounty.js';
import { evidence } from './pages/evidence.js';
import { judge } from './pages/judge.js';
import { agents } from './pages/agents.js';
import { vendors } from './pages/vendors.js';

// ---------- the theme: System, Light, Dark ----------
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } } };
// One button cycles System → Light → Dark → System. System follows the device setting, live; the choice is kept in this
// browser ('skarbnik-mode': light or dark; no entry means System, the first visit's mode). The icon shows the current
// mode; the label says it and what the next click does.
const NEXT = { system: 'light', light: 'dark', dark: 'system' };
const NAME = { system: 'System', light: 'Light', dark: 'Dark' };
const deviceLight = matchMedia('(prefers-color-scheme: light)');
let pref = ['light', 'dark'].includes(store.get('skarbnik-mode')) ? store.get('skarbnik-mode') : 'system';
function applyMode() {
  const m = pref === 'system' ? (deviceLight.matches ? 'light' : 'dark') : pref;
  for (const el of [document.documentElement, document.body]) { el.setAttribute('data-md', m); el.setAttribute('data-pref', pref); }
  const b = $('#modeBtn'), label = `Theme: ${NAME[pref]} (click for ${NAME[NEXT[pref]]})`;
  b.setAttribute('aria-label', label); b.title = label;
  const tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.content = m === 'light' ? '#EEE9DF' : '#12120C';
}
applyMode();
deviceLight.addEventListener('change', () => { if (pref === 'system') applyMode(); });
$('#modeBtn').addEventListener('click', () => {
  pref = NEXT[pref];
  if (pref === 'system') { try { localStorage.removeItem('skarbnik-mode'); } catch { /* storage blocked */ } } else store.set('skarbnik-mode', pref);
  applyMode();
  $('#live').textContent = `Theme: ${NAME[pref]}`;
});

// ---------- phone menu ----------
const menuBtn = $('#menuBtn'), sheet = $('#menuSheet');
const openMenu = (open) => { sheet.hidden = !open; menuBtn.setAttribute('aria-expanded', open); };
menuBtn.addEventListener('click', () => openMenu(sheet.hidden));
sheet.addEventListener('click', (e) => { if (e.target.closest('a')) openMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) { openMenu(false); menuBtn.focus(); } });

$('#footContract').href = EXPLORER_ACCOUNT + CONTRACT;

// ---------- router ----------
const TITLES = { 'how-it-works': 'How it works', bounties: 'Bounties', evidence: 'Proof and evidence', judge: 'Judge guide', agents: 'For agents', vendors: 'For vendors', account: 'Account', raw: 'Raw data' };
const OLD = { ledger: '#/evidence/bounties', verify: '#/evidence/proofs' };
// Short links to the tabs of For agents and For vendors (#connect, /agents/#connect): each opens its tab.
const TAB_LINKS = { connect: 'agents', key: 'agents', fees: 'agents', developers: 'agents', host: 'vendors', setup: 'vendors', privacy: 'vendors', compute: 'vendors', limits: 'vendors', need: 'vendors', private: 'vendors', proving: 'vendors' };
// Short links to a way inside a tab (#way-link ...): the page, its tab and the way.
const WAY_LINKS = { 'way-link': 'agents/connect', 'way-local': 'agents/connect', 'way-guide': 'agents/connect', 'way-ai': 'vendors/host', 'way-cmd': 'vendors/host' };

let routeGen = 0;
let onHome = false;
async function route() {
  const my = ++routeGen;
  const hash = location.hash;
  // Home and its sections: '', '#', '#/', '#top', '#problem' ... '#check'; an old section link is replaced in place
  const sec = hash.replace(/^#/, '');
  if (OLD_IDS[sec]) { location.replace(`#${OLD_IDS[sec]}`); return null; }
  if (TAB_LINKS[sec]) { location.replace(`#/${TAB_LINKS[sec]}/${sec}`); return null; }
  if (WAY_LINKS[sec]) { location.replace(`#/${WAY_LINKS[sec]}/${sec}`); return null; }
  if (!hash || hash === '#' || hash === '#/' || HOME_IDS.includes(sec)) {
    const i = Math.max(0, HOME_IDS.indexOf(sec));
    if (onHome && $('main.home')) { showSection(i, true); return null; }
    return render(my, '', [], () => home($('#view'), i));
  }
  const h = hash.replace(/^#\/?/, '').split('?')[0];
  const [page, ...rest] = h.split('/');
  // redirects from the old routes
  if (OLD[page]) { location.replace(OLD[page]); return null; }
  if (page === 'arena') { location.replace('#/evidence/lab'); return null; }
  if (page === 'agent') { location.replace('#/account'); return null; }
  if (page === 'bounties' && /^\d+$/.test(rest[0] || '') && rest[1] === 'attempts') { location.replace(`#/bounties/${rest[0]}/overview`); return null; }
  if (page === 'bounties' && /^\d+$/.test(rest[0] || '') && rest[1] === 'proof') { location.replace(`#/bounties/${rest[0]}/privacy`); return null; }
  // another tab of the page on screen (the back button, or a tab link): show it without drawing the page again
  if (tabNav.base === `#/${page}` && tabNav.ids.includes(rest[0]) && tabNav.el && tabNav.el.isConnected) {
    tabNav.show(rest[0], false, true);
    if (rest[1] && tabNav.onSub) tabNav.onSub(rest[1]);
    return null;
  }
  const view = $('#view');
  const screens = {
    'how-it-works': () => how(view, rest[0]),
    bounties: () => (/^\d+$/.test(rest[0] || '') ? bounty(view, rest[0], rest[1]) : bounties(view)),
    raw: () => raw(view, rest[0]),
    evidence: () => evidence(view, rest[0]),
    judge: () => judge(view, rest[0]),
    agents: () => agents(view, rest[0], rest[1]),
    vendors: () => vendors(view, rest[0], rest[1]),
    account: () => accountPage(view, decodeURIComponent(rest[0] || ''), rest[1]),
  };
  return render(my, page, rest, screens[page] || (() => { view.innerHTML = `<main id="main" class="p-gen" tabindex="-1"><section class="ph"><div class="wrap"><h1>Not found</h1><p class="lead" style="margin-top:20px"><a class="lnk" href="#/">Go to the home page</a></p></div></section></main>`; }));
}

async function render(my, page, rest, draw) {
  onHome = page === '';
  document.title = page === '' ? 'Skarbnik · Fix what you can’t see'
    : page === 'bounties' && /^\d+$/.test(rest[0] || '') ? `Bounty ${rest[0]} · Skarbnik` : `${TITLES[page] || 'Not found'} · Skarbnik`;
  const navKey = page === 'raw' ? 'bounties' : page;
  document.querySelectorAll('[data-nav]').forEach((a) => (a.dataset.nav === navKey ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  openMenu(false);
  try { await draw(); } catch (e) {
    if (my !== routeGen) return null;
    document.title = 'Something went wrong · Skarbnik';
    $('#view').innerHTML = `<main id="main" class="p-gen" tabindex="-1"><section class="ph"><div class="wrap"><h1>Something went wrong</h1><div class="note" role="alert" style="margin-top:24px"><p>This page could not be shown: ${esc(e.message)}</p></div></div></section></main>`;
  }
  if (my !== routeGen) return null;
  const h1 = $('#view h1');
  $('#live').textContent = `${h1 ? h1.textContent : ''} page`;
  window.scrollTo(0, 0);
  return h1;
}

// A saved copy of a page (scripts/snapshot_pages.mjs) lives at a real path such as /judge/ or /bounties/24/: with
// JavaScript, that path becomes its #/ route and the live page is drawn over the copy.
const savedPath = location.pathname.replace(/^\/+|\/+$/g, '');
const savedHash = location.hash.slice(1);
if (savedPath && savedPath !== 'index.html' && (!savedHash || TAB_LINKS[savedHash] === savedPath || (WAY_LINKS[savedHash] || '').startsWith(`${savedPath}/`))) {
  history.replaceState(null, '', `/#/${WAY_LINKS[savedHash] && WAY_LINKS[savedHash].startsWith(`${savedPath}/`) ? WAY_LINKS[savedHash] : savedPath}${savedHash && !TAB_LINKS[savedHash] && !WAY_LINKS[savedHash] ? '' : savedHash ? `/${savedHash}` : ''}`);
}
window.addEventListener('hashchange', async () => { const h1 = await route(); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); } });
initUi();
initDismiss();
initAccountUi();
route();
