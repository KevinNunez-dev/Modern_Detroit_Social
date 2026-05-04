/* =========================================================
   Modern Social Detroit — SEO Audit Dashboard
   Live Monday.com sync  |  Board 18407794764
   ========================================================= */

const BOARD_ID = '18407794764';
const MONDAY_API = 'https://api.monday.com/v2';
const MONDAY_API_VERSION = '2024-01';

// ── Status label helpers ──────────────────────────────────
const STATUS_DONE        = ['done', 'complete', 'completed', 'finished'];
const STATUS_WORKING     = ['working on it', 'in progress', 'working', 'started'];
const STATUS_STUCK       = ['stuck', 'blocked', 'on hold'];

function classify(label) {
  const v = (label || '').toLowerCase().trim();
  if (STATUS_DONE.includes(v))    return 'done';
  if (STATUS_WORKING.includes(v)) return 'working';
  if (STATUS_STUCK.includes(v))   return 'stuck';
  return 'not_started';
}

// ── Token storage ─────────────────────────────────────────
function getToken()   { return localStorage.getItem('msd_monday_token') || ''; }
function saveToken(t) { localStorage.setItem('msd_monday_token', t); }
function clearToken() { localStorage.removeItem('msd_monday_token'); }

// ── DOM refs ──────────────────────────────────────────────
const syncPill       = document.getElementById('syncPill');
const syncStatusEl   = document.getElementById('syncStatus');
const refreshBtn     = document.getElementById('refreshBtn');
const refreshIcon    = document.getElementById('refreshIcon');
const exportBtn      = document.getElementById('exportBtn');
const settingsBtn    = document.getElementById('settingsBtn');
const drawer         = document.getElementById('settingsDrawer');
const drawerOverlay  = document.getElementById('drawerOverlay');
const drawerCloseBtn = document.getElementById('drawerCloseBtn');
const tokenInput     = document.getElementById('tokenInput');
const saveTokenBtn   = document.getElementById('saveTokenBtn');
const clearTokenBtn  = document.getElementById('clearTokenBtn');
const tasksTableBody = document.getElementById('tasksTableBody');
const taskCountEl    = document.getElementById('taskCount');
const sectionBarsEl  = document.getElementById('sectionBars');
const donutLegendEl  = document.getElementById('donutLegend');

const statCompleted  = document.getElementById('statCompleted');
const statInProgress = document.getElementById('statInProgress');
const statNotStarted = document.getElementById('statNotStarted');
const statPercent    = document.getElementById('statPercent');
const barCompleted   = document.getElementById('barCompleted');
const barInProgress  = document.getElementById('barInProgress');
const barNotStarted  = document.getElementById('barNotStarted');
const barPercent     = document.getElementById('barPercent');

let donutChartInstance = null;

// ── Settings drawer ───────────────────────────────────────
function openDrawer()  { drawer.classList.add('open'); drawerOverlay.classList.add('open'); }
function closeDrawer() { drawer.classList.remove('open'); drawerOverlay.classList.remove('open'); }

settingsBtn.addEventListener('click', () => { tokenInput.value = getToken(); openDrawer(); });
drawerCloseBtn.addEventListener('click', closeDrawer);
drawerOverlay.addEventListener('click', closeDrawer);

saveTokenBtn.addEventListener('click', () => {
  const t = tokenInput.value.trim();
  if (!t) { alert('Please paste your Monday API token first.'); return; }
  saveToken(t);
  closeDrawer();
  fetchBoard();
});

clearTokenBtn.addEventListener('click', () => {
  clearToken();
  tokenInput.value = '';
  setSyncState('error', 'Token cleared');
});

// ── Sync pill ────────────────────────────────────────────
function setSyncState(state, label) {
  syncPill.className = 'sync-pill sync-' + state;
  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (syncStatusEl) syncStatusEl.textContent = label + ' ' + time;
}

// ── Spinner ───────────────────────────────────────────────
function setSpinner(on) {
  refreshIcon.style.animation = on ? 'spin 0.8s linear infinite' : '';
  refreshBtn.disabled = on;
}

// ── GraphQL — plain column_values, no inline fragments ───────
const GQL_QUERY = `
  query GetBoard($boardId: [ID!]!) {
    boards(ids: $boardId) {
      name
      groups {
        id
        title
        items_page(limit: 500) {
          items {
            id
            name
            column_values {
              id
              text
              type
              value
            }
          }
        }
      }
    }
  }
`;

async function fetchBoard() {
  const token = getToken();
  if (!token) {
    setSyncState('error', 'No token — open ⚙️');
    renderEmpty('Click ⚙️ Settings and paste your Monday API token to load tasks.');
    return;
  }

  setSpinner(true);
  setSyncState('loading', 'Syncing...');
  console.log('[MSD] Fetching board', BOARD_ID);

  try {
    const res = await fetch(MONDAY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Monday accepts both bare token and "Bearer <token>" — we send both formats via one header
        'Authorization': token.startsWith('Bearer ') ? token : token,
        'API-Version': MONDAY_API_VERSION
      },
      body: JSON.stringify({
        query: GQL_QUERY,
        variables: { boardId: [BOARD_ID] }
      })
    });

    console.log('[MSD] HTTP status:', res.status);
    if (!res.ok) {
      const errText = await res.text();
      console.error('[MSD] HTTP error body:', errText);
      throw new Error('HTTP ' + res.status + ' — ' + errText.slice(0, 120));
    }

    const json = await res.json();
    console.log('[MSD] API response:', JSON.stringify(json).slice(0, 500));

    if (json.errors && json.errors.length) {
      throw new Error(json.errors.map(e => e.message).join('; '));
    }

    const boards = json.data?.boards;
    if (!boards || !boards.length) {
      throw new Error('No board returned — check board ID or token permissions.');
    }

    processBoard(boards[0]);
    setSyncState('live', 'Synced');
    console.log('[MSD] Sync complete');
  } catch (err) {
    console.error('[MSD] Fetch error:', err.message);
    setSyncState('error', 'Failed — see console');
    renderEmpty('⚠️ Sync failed: ' + err.message + '<br><small>Open DevTools → Console for details.</small>');
  } finally {
    setSpinner(false);
  }
}

// ── Parse column_values.value (JSON string) to get label/people ──
function parseColValue(col) {
  try { return JSON.parse(col.value || 'null'); } catch { return null; }
}

function getStatusLabel(col) {
  // col.text is the most reliable for status columns
  if (col.text) return col.text;
  const v = parseColValue(col);
  if (v && typeof v.label === 'string') return v.label;
  if (v && typeof v.text  === 'string') return v.text;
  return '';
}

function getPeopleNames(col) {
  const v = parseColValue(col);
  if (!v) return '';
  // v.personsAndTeams or v.persons_and_teams
  const list = v.personsAndTeams || v.persons_and_teams || [];
  return list.map(p => p.name || p.id).join(', ');
}

// ── Process board data ────────────────────────────────────
function processBoard(board) {
  const allTasks = [];

  board.groups.forEach(group => {
    (group.items_page?.items || []).forEach(item => {
      // Status: find first status-type column, fall back to col named "status"
      const statusCol = item.column_values.find(c =>
        c.type === 'color' ||
        c.id.toLowerCase().includes('status') ||
        c.id.toLowerCase().includes('stage')
      ) || item.column_values[0];

      const rawLabel = statusCol ? getStatusLabel(statusCol) : '';

      // People: find first people-type column
      const peopleCol = item.column_values.find(c => c.type === 'people');
      const assignee  = peopleCol ? (getPeopleNames(peopleCol) || peopleCol.text || '—') : '—';

      allTasks.push({
        id:       item.id,
        name:     item.name,
        section:  group.title,
        rawLabel,
        status:   classify(rawLabel),
        assignee
      });
    });
  });

  console.log('[MSD] Tasks loaded:', allTasks.length);
  renderAll(allTasks, board.groups);
  window.__msdTasks = allTasks;
}

// ── Render all ────────────────────────────────────────────
function renderAll(tasks, groups) {
  const done       = tasks.filter(t => t.status === 'done').length;
  const working    = tasks.filter(t => t.status === 'working').length;
  const stuck      = tasks.filter(t => t.status === 'stuck').length;
  const notStarted = tasks.filter(t => t.status === 'not_started').length;
  const total      = tasks.length;
  const pct        = total ? Math.round((done / total) * 100) : 0;

  statCompleted.textContent  = done;
  statInProgress.textContent = working;
  statNotStarted.textContent = notStarted;
  statPercent.textContent    = pct + '%';

  barCompleted.style.width  = total ? (done  / total * 100) + '%' : '0%';
  barInProgress.style.width = total ? (working / total * 100) + '%' : '0%';
  barNotStarted.style.width = total ? (notStarted / total * 100) + '%' : '0%';
  barPercent.style.width    = pct + '%';

  renderDonut(done, working, stuck, notStarted);
  renderSectionBars(groups, tasks);
  renderTable(tasks);
  taskCountEl.textContent = total + ' task' + (total !== 1 ? 's' : '');
}

// ── Donut chart ───────────────────────────────────────────
function renderDonut(done, working, stuck, notStarted) {
  const ctx    = document.getElementById('donutChart').getContext('2d');
  const colors = ['#22c55e', '#f59e0b', '#ef4444', '#6b7280'];
  const labels = ['Completed', 'In Progress', 'Stuck', 'Not Started'];
  const values = [done, working, stuck, notStarted];

  if (donutChartInstance) donutChartInstance.destroy();
  donutChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }]
    },
    options: {
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed}` } }
      }
    }
  });

  donutLegendEl.innerHTML = labels.map((l, i) =>
    `<div class="legend-item"><span class="legend-dot" style="background:${colors[i]}"></span>${l} <strong>${values[i]}</strong></div>`
  ).join('');
}

// ── Section bars ──────────────────────────────────────────
function renderSectionBars(groups, tasks) {
  sectionBarsEl.innerHTML = groups.map(g => {
    const gTasks = tasks.filter(t => t.section === g.title);
    const gDone  = gTasks.filter(t => t.status === 'done').length;
    const gTotal = gTasks.length;
    const gPct   = gTotal ? Math.round((gDone / gTotal) * 100) : 0;
    return `
      <div class="section-bar-row">
        <div class="section-bar-label"><span>${g.title}</span><span>${gDone}/${gTotal}</span></div>
        <div class="section-bar-track"><div class="section-bar-fill" style="width:${gPct}%"></div></div>
      </div>`;
  }).join('');
}

// ── Table ─────────────────────────────────────────────────
const BADGE = {
  done:        { cls: 'badge-done',        label: '✓ Done' },
  working:     { cls: 'badge-working',     label: '⚡ In Progress' },
  stuck:       { cls: 'badge-stuck',       label: '🚫 Stuck' },
  not_started: { cls: 'badge-not-started', label: '○ Not Started' }
};

function renderTable(tasks) {
  if (!tasks.length) { renderEmpty('No tasks found on this board.'); return; }
  tasksTableBody.innerHTML = tasks.map(t => {
    const b = BADGE[t.status] || BADGE.not_started;
    return `<tr>
      <td>${escHtml(t.name)}</td>
      <td><span class="section-tag">${escHtml(t.section)}</span></td>
      <td><span class="badge ${b.cls}">${b.label}</span></td>
      <td>${escHtml(t.assignee)}</td>
    </tr>`;
  }).join('');
}

function renderEmpty(msg) {
  tasksTableBody.innerHTML = `<tr><td colspan="4" class="empty-state">${msg}</td></tr>`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Export CSV ────────────────────────────────────────────
exportBtn.addEventListener('click', () => {
  const tasks = window.__msdTasks || [];
  if (!tasks.length) { alert('No data to export yet.'); return; }
  const rows = [['Task Name', 'Section', 'Status', 'Assigned To']];
  tasks.forEach(t => rows.push([t.name, t.section, t.rawLabel || t.status, t.assignee]));
  const csv  = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'msd-seo-audit.csv' });
  a.click();
  URL.revokeObjectURL(url);
});

// ── Refresh & init ─────────────────────────────────────────
refreshBtn.addEventListener('click', fetchBoard);

document.addEventListener('DOMContentLoaded', () => {
  if (getToken()) {
    fetchBoard();
  } else {
    setSyncState('error', 'No token — open ⚙️');
    renderEmpty('Click ⚙️ Settings and paste your Monday API token to load tasks.');
  }
});
