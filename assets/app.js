/* =========================================================
   Modern Social Detroit — SEO Audit Dashboard
   Live Monday.com sync  |  Board 18407794764
   ========================================================= */

const BOARD_ID = '18407794764';
const MONDAY_API = 'https://api.monday.com/v2';

// ── Status label helpers ──────────────────────────────────
const STATUS_DONE       = ['done', 'complete', 'completed', 'finished'];
const STATUS_WORKING    = ['working on it', 'in progress', 'working', 'started'];
const STATUS_STUCK      = ['stuck', 'blocked', 'on hold'];
const STATUS_NOT_STARTED = ['not started', '', null, undefined];

function classify(label) {
  const v = (label || '').toLowerCase().trim();
  if (STATUS_DONE.includes(v))        return 'done';
  if (STATUS_WORKING.includes(v))     return 'working';
  if (STATUS_STUCK.includes(v))       return 'stuck';
  return 'not_started';
}

// ── Token storage ─────────────────────────────────────────
function getToken()  { return localStorage.getItem('msd_monday_token') || ''; }
function saveToken(t){ localStorage.setItem('msd_monday_token', t); }
function clearToken(){ localStorage.removeItem('msd_monday_token'); }

// ── DOM refs ──────────────────────────────────────────────
const syncPill       = document.getElementById('syncPill');
const syncDot        = document.getElementById('syncDot');
const syncStatusEl   = document.getElementById('syncStatus');
const syncTimeEl     = document.getElementById('syncTime');
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

// stat cards
const statCompleted  = document.getElementById('statCompleted');
const statInProgress = document.getElementById('statInProgress');
const statNotStarted = document.getElementById('statNotStarted');
const statPercent    = document.getElementById('statPercent');
const barCompleted   = document.getElementById('barCompleted');
const barInProgress  = document.getElementById('barInProgress');
const barNotStarted  = document.getElementById('barNotStarted');
const barPercent     = document.getElementById('barPercent');

// ── Chart instance ────────────────────────────────────────
let donutChartInstance = null;

// ── Settings drawer ───────────────────────────────────────
function openDrawer()  { drawer.classList.add('open'); drawerOverlay.classList.add('open'); }
function closeDrawer() { drawer.classList.remove('open'); drawerOverlay.classList.remove('open'); }

settingsBtn.addEventListener('click', () => {
  tokenInput.value = getToken();
  openDrawer();
});
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

// ── Sync pill states ──────────────────────────────────────
function setSyncState(state, label) {
  syncPill.className = 'sync-pill sync-' + state;
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (syncTimeEl) syncTimeEl.textContent = time;
  if (syncStatusEl) syncStatusEl.innerHTML = label + ' <span id="syncTime">' + time + '</span>';
}

// ── Spinner ───────────────────────────────────────────────
function setSpinner(on) {
  if (on) { refreshIcon.style.animation = 'spin 0.8s linear infinite'; }
  else    { refreshIcon.style.animation = ''; }
  refreshBtn.disabled = on;
}

// ── GraphQL query ─────────────────────────────────────────
const GQL_QUERY = `
  query BoardData($boardId: [ID!]!) {
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
              ... on StatusValue { label }
              ... on PeopleValue  { persons_and_teams { name } }
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
    setSyncState('error', 'No token — open ⚙️ to connect');
    renderEmpty('Click ⚙️ Settings and paste your Monday API token to load tasks.');
    return;
  }

  setSpinner(true);
  setSyncState('loading', 'Syncing...');

  try {
    const res = await fetch(MONDAY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      },
      body: JSON.stringify({
        query: GQL_QUERY,
        variables: { boardId: [BOARD_ID] }
      })
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0].message);

    const board = json.data.boards[0];
    processBoard(board);
    setSyncState('live', 'Synced');
  } catch (err) {
    console.error('[MSD] Fetch error:', err);
    setSyncState('error', 'Sync failed — check token');
    renderEmpty('⚠️ Could not load data. Check your Monday token in ⚙️ Settings.');
  } finally {
    setSpinner(false);
  }
}

// ── Process board data ────────────────────────────────────
function processBoard(board) {
  const allTasks = [];

  board.groups.forEach(group => {
    (group.items_page?.items || []).forEach(item => {
      // Find status column
      const statusCol = item.column_values.find(c =>
        c.type === 'color' || c.id.includes('status') || c.id.includes('Status')
      );
      const rawLabel = statusCol?.label || statusCol?.text || '';

      // Find assigned-to column
      const peopleCol = item.column_values.find(c => c.type === 'people');
      const assignees = (peopleCol?.persons_and_teams || []).map(p => p.name).join(', ');

      allTasks.push({
        id:       item.id,
        name:     item.name,
        section:  group.title,
        rawLabel,
        status:   classify(rawLabel),
        assignee: assignees || '—'
      });
    });
  });

  renderAll(allTasks, board.groups);
  window.__msdTasks = allTasks; // cache for CSV export
}

// ── Render everything ─────────────────────────────────────
function renderAll(tasks, groups) {
  const done       = tasks.filter(t => t.status === 'done').length;
  const working    = tasks.filter(t => t.status === 'working').length;
  const stuck      = tasks.filter(t => t.status === 'stuck').length;
  const notStarted = tasks.filter(t => t.status === 'not_started').length;
  const total      = tasks.length;
  const pct        = total ? Math.round((done / total) * 100) : 0;

  // Stat cards
  statCompleted.textContent  = done;
  statInProgress.textContent = working;
  statNotStarted.textContent = notStarted;
  statPercent.textContent    = pct + '%';

  barCompleted.style.width  = total ? (done / total * 100) + '%' : '0%';
  barInProgress.style.width = total ? (working / total * 100) + '%' : '0%';
  barNotStarted.style.width = total ? (notStarted / total * 100) + '%' : '0%';
  barPercent.style.width    = pct + '%';

  // Donut chart
  renderDonut(done, working, stuck, notStarted);

  // Section bars
  renderSectionBars(groups, tasks);

  // Table
  renderTable(tasks);
  taskCountEl.textContent = total + ' task' + (total !== 1 ? 's' : '');
}

// ── Donut chart ───────────────────────────────────────────
function renderDonut(done, working, stuck, notStarted) {
  const ctx = document.getElementById('donutChart').getContext('2d');
  const data = {
    labels: ['Completed', 'In Progress', 'Stuck', 'Not Started'],
    datasets: [{
      data: [done, working, stuck, notStarted],
      backgroundColor: ['#22c55e', '#f59e0b', '#ef4444', '#6b7280'],
      borderWidth: 0,
      hoverOffset: 6
    }]
  };

  if (donutChartInstance) donutChartInstance.destroy();
  donutChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data,
    options: {
      cutout: '68%',
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: ctx => ` ${ctx.label}: ${ctx.parsed}`
      }}}}
  });

  // Legend
  const colors = ['#22c55e','#f59e0b','#ef4444','#6b7280'];
  const labels = ['Completed','In Progress','Stuck','Not Started'];
  const values = [done, working, stuck, notStarted];
  donutLegendEl.innerHTML = labels.map((l,i) =>
    `<div class="legend-item"><span class="legend-dot" style="background:${colors[i]}"></span>${l} <strong>${values[i]}</strong></div>`
  ).join('');
}

// ── Section bars ──────────────────────────────────────────
function renderSectionBars(groups, tasks) {
  sectionBarsEl.innerHTML = groups.map(g => {
    const gTasks  = tasks.filter(t => t.section === g.title);
    const gDone   = gTasks.filter(t => t.status === 'done').length;
    const gTotal  = gTasks.length;
    const gPct    = gTotal ? Math.round((gDone / gTotal) * 100) : 0;
    return `
      <div class="section-bar-row">
        <div class="section-bar-label">
          <span>${g.title}</span>
          <span>${gDone}/${gTotal}</span>
        </div>
        <div class="section-bar-track">
          <div class="section-bar-fill" style="width:${gPct}%"></div>
        </div>
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
    return `
      <tr>
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
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Export CSV ────────────────────────────────────────────
exportBtn.addEventListener('click', () => {
  const tasks = window.__msdTasks || [];
  if (!tasks.length) { alert('No data to export yet.'); return; }
  const rows = [['Task Name','Section','Status','Assigned To']];
  tasks.forEach(t => rows.push([t.name, t.section, t.rawLabel || t.status, t.assignee]));
  const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'msd-seo-audit.csv' });
  a.click();
  URL.revokeObjectURL(url);
});

// ── Refresh button ────────────────────────────────────────
refreshBtn.addEventListener('click', fetchBoard);

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const saved = getToken();
  if (saved) {
    fetchBoard();
  } else {
    setSyncState('error', 'No token — open ⚙️ to connect');
    renderEmpty('Click ⚙️ Settings and paste your Monday API token to load tasks.');
  }
});
