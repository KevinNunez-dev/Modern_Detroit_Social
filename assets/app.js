/* =============================================================
   Modern Social Detroit — SEO Audit Dashboard
   Monday.com Live Sync  |  Board 18407794764
   ============================================================= */

const BOARD_ID = '18407794764';
const MONDAY_API = 'https://api.monday.com/v2';

// ── Status classification ────────────────────────────────────
const DONE_LABELS     = ['done', 'complete', 'completed', 'finished'];
const WORKING_LABELS  = ['working on it', 'in progress', 'working', 'started', 'in review'];
const STUCK_LABELS    = ['stuck', 'blocked', 'on hold', 'waiting'];

function classify(label) {
  const v = (label || '').toLowerCase().trim();
  if (DONE_LABELS.includes(v))    return 'done';
  if (WORKING_LABELS.includes(v)) return 'working';
  if (STUCK_LABELS.includes(v))   return 'stuck';
  return 'not_started';
}

// ── Token ─────────────────────────────────────────────────
const LS_KEY = 'msd_monday_token';
function getToken()   { return localStorage.getItem(LS_KEY) || ''; }
function saveToken(t) { localStorage.setItem(LS_KEY, t.trim()); }
function clearToken() { localStorage.removeItem(LS_KEY); }

// ── DOM ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const syncPill       = $('syncPill');
const syncStatusEl   = $('syncStatus');
const refreshBtn     = $('refreshBtn');
const refreshIcon    = $('refreshIcon');
const exportBtn      = $('exportBtn');
const settingsBtn    = $('settingsBtn');
const drawer         = $('settingsDrawer');
const drawerOverlay  = $('drawerOverlay');
const drawerCloseBtn = $('drawerCloseBtn');
const tokenInput     = $('tokenInput');
const saveTokenBtn   = $('saveTokenBtn');
const clearTokenBtn  = $('clearTokenBtn');
const tasksTableBody = $('tasksTableBody');
const taskCountEl    = $('taskCount');
const sectionBarsEl  = $('sectionBars');
const donutLegendEl  = $('donutLegend');
const statCompleted  = $('statCompleted');
const statInProgress = $('statInProgress');
const statNotStarted = $('statNotStarted');
const statPercent    = $('statPercent');
const barCompleted   = $('barCompleted');
const barInProgress  = $('barInProgress');
const barNotStarted  = $('barNotStarted');
const barPercent     = $('barPercent');

let donutChartInstance = null;

// ── Drawer ───────────────────────────────────────────────
function openDrawer()  { drawer.classList.add('open');    drawerOverlay.classList.add('open'); }
function closeDrawer() { drawer.classList.remove('open'); drawerOverlay.classList.remove('open'); }

settingsBtn.addEventListener('click',  () => { tokenInput.value = getToken(); openDrawer(); });
drawerCloseBtn.addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click',  closeDrawer);

saveTokenBtn.addEventListener('click', () => {
  const t = tokenInput.value.trim();
  if (!t) { alert('Paste your Monday API token first.'); return; }
  saveToken(t);
  closeDrawer();
  fetchBoard();
});

clearTokenBtn.addEventListener('click', () => {
  clearToken();
  tokenInput.value = '';
  setSyncState('error', 'Token cleared — open ⚙️ to reconnect');
  renderEmpty('Token cleared. Click ⚙️ Settings to reconnect.');
});

// ── Pill state ────────────────────────────────────────────
function setSyncState(state, label) {
  syncPill.className = 'sync-pill sync-' + state;
  const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  syncStatusEl.textContent = label + ' · ' + t;
}

function setSpinner(on) {
  refreshIcon.style.animation = on ? 'spin 0.8s linear infinite' : '';
  refreshBtn.disabled = on;
}

// ── GQL query (2024-01 schema with items_page) ──────────────
const QUERY = `
query GetBoard($ids: [ID!]!) {
  boards(ids: $ids) {
    name
    groups {
      id
      title
      items_page(limit: 500) {
        items {
          id
          name
          column_values { id type text value }
        }
      }
    }
  }
}`;

// ── Fetch ─────────────────────────────────────────────────
async function fetchBoard() {
  const token = getToken();
  if (!token) {
    setSyncState('error', 'No token');
    renderEmpty('Click ⚙️ Settings and paste your Monday API token.');
    return;
  }

  setSpinner(true);
  setSyncState('loading', 'Syncing');
  console.log('[MSD] Requesting board', BOARD_ID);

  try {
    const res = await fetch(MONDAY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,          // Monday personal token: no Bearer prefix
        'API-Version':   '2024-01'       // required for items_page
      },
      body: JSON.stringify({ query: QUERY, variables: { ids: [BOARD_ID] } })
    });

    const raw = await res.text();
    console.log('[MSD] HTTP', res.status, '|', raw.slice(0, 600));

    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ': ' + raw.slice(0, 200));
    }

    let json;
    try { json = JSON.parse(raw); }
    catch (e) { throw new Error('Bad JSON from Monday: ' + raw.slice(0, 200)); }

    if (json.errors?.length) {
      throw new Error(json.errors.map(e => e.message).join(' | '));
    }
    if (json.error_code) {
      throw new Error(json.error_code + ': ' + (json.error_message || json.status_code));
    }

    const board = json.data?.boards?.[0];
    if (!board) throw new Error('No board data returned. Check board ID and token permissions.');

    processBoard(board);
    setSyncState('live', 'Synced');
    console.log('[MSD] Done');

  } catch (err) {
    console.error('[MSD] Error:', err.message);
    setSyncState('error', 'Sync failed');
    renderError(err.message);
  } finally {
    setSpinner(false);
  }
}

// ── Parse column value ──────────────────────────────────────
function parseVal(col) {
  try { return JSON.parse(col.value); } catch { return null; }
}

function getStatusText(col) {
  if (col.text) return col.text;
  const v = parseVal(col);
  return v?.label || v?.text || '';
}

function getAssigneeText(col) {
  const v = parseVal(col);
  if (!v) return col.text || '';
  const list = v.personsAndTeams || v.persons_and_teams || [];
  return list.map(p => p.name || p.id).filter(Boolean).join(', ');
}

// ── Process ────────────────────────────────────────────────
function processBoard(board) {
  const tasks = [];

  board.groups.forEach(g => {
    (g.items_page?.items || []).forEach(item => {
      // Pick first status-type column
      const sCols = item.column_values.filter(c =>
        c.type === 'color' ||
        c.id.toLowerCase().includes('status') ||
        c.id.toLowerCase().includes('stage')
      );
      const sCol     = sCols[0] || null;
      const rawLabel = sCol ? getStatusText(sCol) : '';

      // Pick first people-type column
      const pCol    = item.column_values.find(c => c.type === 'people');
      const assignee = pCol ? (getAssigneeText(pCol) || '—') : '—';

      tasks.push({
        id: item.id, name: item.name,
        section: g.title, rawLabel,
        status: classify(rawLabel), assignee
      });
    });
  });

  console.log('[MSD] Tasks:', tasks.length);
  renderAll(tasks, board.groups);
  window.__msdTasks = tasks;
}

// ── Render all ─────────────────────────────────────────────
function renderAll(tasks, groups) {
  const done       = tasks.filter(t => t.status === 'done').length;
  const working    = tasks.filter(t => t.status === 'working').length;
  const stuck      = tasks.filter(t => t.status === 'stuck').length;
  const notStarted = tasks.filter(t => t.status === 'not_started').length;
  const total      = tasks.length;
  const pct        = total ? Math.round(done / total * 100) : 0;

  statCompleted.textContent  = done;
  statInProgress.textContent = working;
  statNotStarted.textContent = notStarted;
  statPercent.textContent    = pct + '%';

  const w = v => total ? (v / total * 100).toFixed(1) + '%' : '0%';
  barCompleted.style.width  = w(done);
  barInProgress.style.width = w(working);
  barNotStarted.style.width = w(notStarted);
  barPercent.style.width    = pct + '%';

  renderDonut(done, working, stuck, notStarted);
  renderSectionBars(groups, tasks);
  renderTable(tasks);
  taskCountEl.textContent = total + ' task' + (total !== 1 ? 's' : '');
}

// ── Donut ─────────────────────────────────────────────────
function renderDonut(done, working, stuck, ns) {
  const ctx    = $('donutChart').getContext('2d');
  const colors = ['#22c55e','#f59e0b','#ef4444','#6b7280'];
  const labels = ['Completed','In Progress','Stuck','Not Started'];
  const vals   = [done, working, stuck, ns];

  if (donutChartInstance) donutChartInstance.destroy();
  donutChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed}` } }
      }
    }
  });

  donutLegendEl.innerHTML = labels.map((l, i) =>
    `<div class="legend-item"><span class="legend-dot" style="background:${colors[i]}"></span>${l} <strong>${vals[i]}</strong></div>`
  ).join('');
}

// ── Section bars ──────────────────────────────────────────
function renderSectionBars(groups, tasks) {
  sectionBarsEl.innerHTML = groups.map(g => {
    const gt  = tasks.filter(t => t.section === g.title);
    const gd  = gt.filter(t => t.status === 'done').length;
    const pct = gt.length ? Math.round(gd / gt.length * 100) : 0;
    return `<div class="section-bar-row">
      <div class="section-bar-label"><span>${g.title}</span><span>${gd}/${gt.length}</span></div>
      <div class="section-bar-track"><div class="section-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

// ── Table ─────────────────────────────────────────────────
const BADGES = {
  done:        ['badge-done',        '✓ Done'],
  working:     ['badge-working',     '⚡ In Progress'],
  stuck:       ['badge-stuck',       '🚫 Stuck'],
  not_started: ['badge-not-started', '○ Not Started']
};

function renderTable(tasks) {
  if (!tasks.length) { renderEmpty('No tasks found on this board.'); return; }
  tasksTableBody.innerHTML = tasks.map(t => {
    const [cls, lbl] = BADGES[t.status] || BADGES.not_started;
    return `<tr>
      <td>${h(t.name)}</td>
      <td><span class="section-tag">${h(t.section)}</span></td>
      <td><span class="badge ${cls}">${lbl}</span></td>
      <td>${h(t.assignee)}</td>
    </tr>`;
  }).join('');
}

function h(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderEmpty(msg) {
  tasksTableBody.innerHTML = `<tr><td colspan="4" class="empty-state">${msg}</td></tr>`;
}

function renderError(msg) {
  tasksTableBody.innerHTML = `
    <tr><td colspan="4" class="empty-state error-state">
      <strong>⚠️ Sync Error</strong><br>
      <code style="font-size:12px;word-break:break-all;">${h(msg)}</code><br><br>
      <small>Steps to fix:<br>
      1. Open ⚙️ Settings → paste your token from
      <a href="https://rptclinic.monday.com/apps/manage/tokens" target="_blank" rel="noreferrer">monday.com/apps/manage/tokens</a><br>
      2. Make sure your token has <strong>boards:read</strong> permission<br>
      3. Open DevTools (F12) → Console for full details</small>
    </td></tr>`;
}

// ── CSV export ───────────────────────────────────────────
exportBtn.addEventListener('click', () => {
  const tasks = window.__msdTasks || [];
  if (!tasks.length) { alert('No data to export yet.'); return; }
  const rows = [['Task Name','Section','Status','Assigned To'],
    ...tasks.map(t => [t.name, t.section, t.rawLabel || t.status, t.assignee])];
  const csv  = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: 'msd-seo-audit.csv'
  });
  a.click();
});

// ── Refresh ─────────────────────────────────────────────────
refreshBtn.addEventListener('click', fetchBoard);

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (getToken()) {
    fetchBoard();
  } else {
    setSyncState('error', 'No token');
    renderEmpty('Click ⚙️ Settings and paste your Monday API token to load tasks.');
  }
});
