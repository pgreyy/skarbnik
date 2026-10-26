// The Skarbnik site app: the routes, the redirects from the old routes, the dark and light toggle (dark by default,
// the visitor's choice remembered in this browser), the phone menu, and the screens. Routes: #/ (Home, seven
// sections; #mechanism, #example, #why, #paths, #verify, #next open a section), #/how-it-works, #/bounties,
// #/bounties/<id>[/<tab>], #/raw/<id>, #/evidence[/<tab>], #/judge[/<tab>], #/agents, #/account[/<name>[/<tab>]].
// Old routes: #/ledger, #/arena, #/verify and #/agent redirect to their new place. Live screens read the testnet
// contract with view calls (js/chain.js); recorded parts read data/recorded.json. No sample data.
import { CONTRACT, EXPLORER_ACCOUNT } from './chain.js';
import { $, esc, initUi } from './ui.js';
import { initAccountUi, accountPage } from './account-ui.js';
import { home, HOME_IDS, showSection } from './pages/home.js';
import { how } from './pages/how.js';
import { bounties } from './pages/bounties.js';
import { bounty, raw } from './pages/bounty.js';
import { evidence } from './pages/evidence.js';
import { judge } from './pages/judge.js';
import { agents } from './pages/agents.js';

// ---------- dark and light ----------
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } } };
function applyMode(m) {
  document.documentElement.setAttribute('data-md', m);
  document.body.setAttribute('data-md', m);
  const b = $('#modeBtn'), label = m === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  b.setAttribute('aria-label', label); b.title = label;
}
applyMode(store.get('skarbnik-mode') === 'light' ? 'light' : 'dark');
$('#modeBtn').addEventListener('click', () => { const m = document.body.getAttribute('data-md') === 'dark' ? 'light' : 'dark'; store.set('skarbnik-mode', m); applyMode(m); });

// ---------- phone menu ----------
const menuBtn = $('#menuBtn'), sheet = $('#menuSheet');
const openMenu = (open) => { sheet.hidden = !open; menuBtn.setAttribute('aria-expanded', open); };
menuBtn.addEventListener('click', () => openMenu(sheet.hidden));
sheet.addEventListener('click', (e) => { if (e.target.closest('a')) openMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) { openMenu(false); menuBtn.focus(); } });

$('#footContract').href = EXPLORER_ACCOUNT + CONTRACT;

// ---------- router ----------
const TITLES = { 'how-it-works': 'How it works', bounties: 'Bounties', evidence: 'Evidence', judge: 'Judge guide', agents: 'For agents', account: 'Account', raw: 'Raw data' };
const OLD = { ledger: '#/evidence/ledger', verify: '#/evidence/checker' };

let routeGen = 0;
let onHome = false;
async function route() {
  const my = ++routeGen;
  const hash = location.hash;
  // Home and its sections: '', '#', '#/', '#top', '#mechanism' ... '#next'
  const sec = hash.replace(/^#/, '');
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
  const view = $('#view');
  const screens = {
    'how-it-works': () => how(view),
    bounties: () => (/^\d+$/.test(rest[0] || '') ? bounty(view, rest[0], rest[1]) : bounties(view)),
    raw: () => raw(view, rest[0]),
    evidence: () => evidence(view, rest[0]),
    judge: () => judge(view, rest[0]),
    agents: () => agents(view),
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

window.addEventListener('hashchange', async () => { const h1 = await route(); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); } });
initUi();
initAccountUi();
route();
