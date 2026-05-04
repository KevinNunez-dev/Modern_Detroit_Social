/* =============================================================
   Modern Social Detroit — SEO Audit Dashboard
   Monday.com Live Sync  |  Board 18407794764
   ============================================================= */

const BOARD_ID   = '18407794764';
const MONDAY_API = 'https://api.monday.com/v2';

// ── Status classification ────────────────────────────────────
const DONE_LABELS    = ['done','complete','completed','finished'];
const WORKING_LABELS = ['working on it','in progress','working','started','in review'];
const STUCK_LABELS   = ['stuck','blocked','on hold','waiting'];

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

settingsBtn.addEventListener('click', () => { tokenInput.value = getToken(); openDrawer(); });
drawerCloseBtn.addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);

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
  setSyncState('error', 'Token cleared');
  renderEmpty('Token cleared. Click ⚙️ Settings to reconnect.');
});

// ── Pill ──────────────────────────────────────────────────
function setSyncState(state, label) {
  syncPill.className = 'sync-pill sync-' + state;
  const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  syncStatusEl.textContent = label + ' · ' + t;
}

function setSpinner(on) {
  refreshIcon.style.animation = on ? 'spin 0.8s linear infinite' : '';
  refreshBtn.disabled = on;
}

// ── GQL helpers ───────────────────────────────────────────
function gqlRequest(query, variables = {}) {
  return fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getToken(),
      'API-Version':   '2024-01'
    },
    body: JSON.stringify({ query, variables })
  })
  .then(async res => {
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('Non-JSON: ' + text.slice(0, 200)); }
    if (json.error_code) throw new Error(json.error_code + ': ' + (json.error_message || ''));
    if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join(' | '));
    return json.data;
  });
}

// ── Step 1: fetch groups only (very cheap query) ──────────────
const GROUPS_QUERY = `
query Groups($ids: [ID!]!) {
  boards(ids: $ids) {
    name
    groups { id title }
  }
}`;

// ── Step 2: fetch items for ONE group at a time (low complexity) ─
const ITEMS_QUERY = `
query Items($boardId: ID!, $groupId: String!, $cursor: String) {
  boards(ids: [$boardId]) {
    groups(ids: [$groupId]) {
      items_page(limit: 50, cursor: $cursor) {
        cursor
        items {
          id name
          column_values { id type text value }
        }
      }
    }
  }
}`;

async function fetchGroupItems(boardId, groupId) {
  let cursor   = null;
  let allItems = [];

  do {
    const data = await gqlRequest(ITEMS_QUERY, { boardId, groupId, cursor });
    const page  = data?.boards?.[0]?.groups?.[0]?.items_page;
    if (!page) break;
    allItems = allItems.concat(page.items || []);
    cursor   = page.cursor || null;
  } while (cursor);

  return allItems;
}

// ── Main fetch ────────────────────────────────────────────
async function fetchBoard() {
  if (!getToken()) {
    setSyncState('error', 'No token');
    renderEmpty('Click ⚙️ Settings and paste your Monday API token.');
    return;
  }

  setSpinner(true);
  setSyncState('loading', 'Syncing');
  console.log('[MSD] Starting fetch for board', BOARD_ID);

  try {
    // 1. Get all groups (cheap)
    const boardData = await gqlRequest(GROUPS_QUERY, { ids: [BOARD_ID] });
    const board     = boardData?.boards?.[0];
    if (!board) throw new Error('Board not found. Check Board ID and token permissions.');

    const groups = board.groups || [];
    console.log('[MSD] Groups:', groups.map(g => g.title).join(', '));

    // 2. Fetch items group by group (keeps complexity low)
    const allTasks = [];
    for (const group of groups) {
      console.log('[MSD] Fetching group:', group.title);
      const items = await fetchGroupItems(BOARD_ID, group.id);
      items.forEach(item => {
        const sCol    = item.column_values.find(c =>
          c.type === 'color' ||
          c.id.toLowerCase().includes('status') ||
          c.id.toLowerCase().includes('stage')
        );
        const pCol    = item.column_values.find(c => c.type === 'people');
        const rawLabel = sCol ? (sCol.text || tryLabel(sCol.value)) : '';
        const assignee = pCol ? (pCol.text || tryPeople(pCol.value)) : '—';

        allTasks.push({
          id: item.id, name: item.name,
          section: group.title, rawLabel,
          status: classify(rawLabel),
          assignee: assignee || '—'
        });
      });
    }

    console.log('[MSD] Total tasks:', allTasks.length);
    renderAll(allTasks, groups);
    window.__msdTasks = allTasks;
    setSyncState('live', 'Synced');

  } catch (err) {
    console.error('[MSD] Error:', err.message);
    setSyncState('error', 'Sync failed');
    renderError(err.message);
  } finally {
    setSpinner(false);
  }
}

// ── JSON value parsers ──────────────────────────────────────
function tryLabel(raw) {
  try { const v = JSON.parse(raw); return v?.label || v?.text || ''; } catch { return ''; }
}
function tryPeople(raw) {
  try {
    const v    = JSON.parse(raw);
    const list = v?.personsAndTeams || v?.persons_and_teams || [];
    return list.map(p => p.name || p.id).filter(Boolean).join(', ');
  } catch { return ''; }
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

  const pctOf = n => total ? (n / total * 100).toFixed(1) + '%' : '0%';
  barCompleted.style.width  = pctOf(done);
  barInProgress.style.width = pctOf(working);
  barNotStarted.style.width = pctOf(notStarted);
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

function renderEmpty(msg) {
  tasksTableBody.innerHTML = `<tr><td colspan="4" class="empty-state">${msg}</td></tr>`;
}

function renderError(msg) {
  tasksTableBody.innerHTML = `<tr><td colspan="4" class="empty-state error-state">
    <strong>⚠️ Sync Error</strong><br>
    <code style="font-size:11px;word-break:break-all;display:block;margin:8px 0;">${h(msg)}</code>
    <small>Open DevTools → Console (F12) for details</small>
  </td></tr>`;
}

function h(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── CSV ─────────────────────────────────────────────────
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

// ── Refresh + init ─────────────────────────────────────────
refreshBtn.addEventListener('click', fetchBoard);

document.addEventListener('DOMContentLoaded', () => {
  if (getToken()) {
    fetchBoard();
  } else {
    setSyncState('error', 'No token');
    renderEmpty('Click ⚙️ Settings and paste your Monday API token.');
  }
});
