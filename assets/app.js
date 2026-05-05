/* =============================================================
   Modern Social Detroit — SEO Audit Dashboard
   Monday.com Live Sync  |  Board 18407794764
   ============================================================= */

const BOARD_ID   = '18407794764';
const MONDAY_API = 'https://api.monday.com/v2';
const AUTO_REFRESH_MS = 300000; // 5 minutes

// ── Status classification ────────────────────────────────────
const DONE_LABELS    = ['done','complete','completed','finished','closed'];
const WORKING_LABELS = ['working on it','in progress','working','started','in review','active'];
const STUCK_LABELS   = ['stuck','blocked','on hold','waiting','paused'];

function classify(label) {
  const v = (label || '').toLowerCase().trim();
  if (!v) return 'not_started';
  if (DONE_LABELS.some(d    => v === d || v.includes(d)))   return 'done';
  if (WORKING_LABELS.some(w => v === w || v.includes(w)))  return 'working';
  if (STUCK_LABELS.some(s   => v === s || v.includes(s)))  return 'stuck';
  return 'not_started';
}

// ── Priority classification ──────────────────────────────────
const PRIORITY_HIGH     = ['high','urgent','important'];
const PRIORITY_CRITICAL = ['critical','blocker','must fix','asap'];
const PRIORITY_LOW      = ['low','minor','nice to have'];

function classifyPriority(label) {
  const v = (label || '').toLowerCase().trim();
  if (!v) return 'medium';
  if (PRIORITY_CRITICAL.some(c => v.includes(c))) return 'critical';
  if (PRIORITY_HIGH.some(h => v.includes(h)))     return 'high';
  if (PRIORITY_LOW.some(l => v.includes(l)))      return 'low';
  return 'medium';
}

function extractLabel(col) {
  if (!col) return '';
  if (col.text && col.text.trim()) return col.text.trim();
  try {
    const v = JSON.parse(col.value || '{}');
    if (v?.label?.text) return v.label.text;
    if (v?.text)        return v.text;
  } catch {}
  return '';
}

// ── Token ─────────────────────────────────────────────────────
const LS_KEY = 'msd_monday_token';
function getToken()   { return localStorage.getItem(LS_KEY) || ''; }
function saveToken(t) { localStorage.setItem(LS_KEY, t.trim()); }
function clearToken() { localStorage.removeItem(LS_KEY); }

// ── DOM refs ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const syncPill         = $('syncPill');
const syncStatusEl     = $('syncStatus');
const refreshBtn       = $('refreshBtn');
const refreshIcon      = $('refreshIcon');
const exportBtn        = $('exportBtn');
const settingsBtn      = $('settingsBtn');
const themeToggle      = $('themeToggle');
const themeIcon        = $('themeIcon');
const drawer           = $('settingsDrawer');
const drawerOverlay    = $('drawerOverlay');
const drawerCloseBtn   = $('drawerCloseBtn');
const tokenInput       = $('tokenInput');
const saveTokenBtn     = $('saveTokenBtn');
const clearTokenBtn    = $('clearTokenBtn');
const tasksTableBody   = $('tasksTableBody');
const taskCountEl      = $('taskCount');
const sectionBarsEl    = $('sectionBars');
const donutLegendEl    = $('donutLegend');
const statCompleted    = $('statCompleted');
const statInProgress   = $('statInProgress');
const statNotStarted   = $('statNotStarted');
const statPercent      = $('statPercent');
const statOverdue      = $('statOverdue');
const statHighPriority = $('statHighPriority');
const barCompleted     = $('barCompleted');
const barInProgress    = $('barInProgress');
const barNotStarted    = $('barNotStarted');
const barPercent       = $('barPercent');
const barOverdue       = $('barOverdue');
const barHighPriority  = $('barHighPriority');
const filterStatus     = $('filterStatus');
const filterPriority   = $('filterPriority');
const filterSection    = $('filterSection');
const filterDue        = $('filterDue');
const clearFilters     = $('clearFilters');
const filterResult     = $('filterResult');

let donutChartInstance = null;
let lineChartInstance  = null;
let autoRefreshTimer   = null;
let allTasksGlobal     = [];
let allGroupsGlobal    = [];

// ── Theme Toggle ───────────────────────────────────────────────
const SUN_SVG  = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
const MOON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

const THEME_KEY = 'msd_theme';

function getStoredTheme() {
  return localStorage.getItem(THEME_KEY);
}

function getCurrentTheme() {
  // if nothing stored, default to light
  return document.documentElement.getAttribute('data-theme') ||
         getStoredTheme() ||
         'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  themeIcon.innerHTML = theme === 'dark' ? MOON_SVG : SUN_SVG;

  // Re-render charts with new colors if data exists
  if (allTasksGlobal.length) renderCharts(allTasksGlobal, allGroupsGlobal);
}

// initialize theme on load
applyTheme(getCurrentTheme());

themeToggle.addEventListener('click', () => {
  const current = getCurrentTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
});

// ── Drawer ─────────────────────────────────────────────────────
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
  startAutoRefresh();
  fetchBoard();
});

clearTokenBtn.addEventListener('click', () => {
  clearToken();
  stopAutoRefresh();
  tokenInput.value = '';
  setSyncState('error', 'Token cleared');
  renderNoToken();
});

// ── Auto-refresh ───────────────────────────────────────────────
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(fetchBoard, AUTO_REFRESH_MS);
}
function stopAutoRefresh() {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
}

// ── Sync pill ──────────────────────────────────────────────────
function setSyncState(state, label) {
  syncPill.className = 'sync-pill sync-' + state;
  const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  syncStatusEl.textContent = label + ' · ' + t;
}
function setSpinner(on) {
  refreshIcon.style.animation = on ? 'spin 0.8s linear infinite' : '';
  refreshBtn.disabled = on;
}

// ── GQL helper ─────────────────────────────────────────────────
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
    if (json.error_code)     throw new Error(json.error_code + ': ' + (json.error_message || ''));
    if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join(' | '));
    return json.data;
  });
}

// ── GraphQL queries ────────────────────────────────────────────
const GROUPS_QUERY = `
query Groups($ids: [ID!]!) {
  boards(ids: $ids) {
    name
    groups { id title }
  }
}`;

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
  let cursor = null, all = [];
  do {
    const data  = await gqlRequest(ITEMS_QUERY, { boardId, groupId, cursor });
    const page  = data?.boards?.[0]?.groups?.[0]?.items_page;
    if (!page) break;
    all    = all.concat(page.items || []);
    cursor = page.cursor || null;
  } while (cursor);
  return all;
}

// ── Column pickers ─────────────────────────────────────────────
const STATUS_TYPES    = ['status', 'color'];
const STATUS_KEYWORDS = ['status','stage','completed','complete','task','progress','state','done'];

function pickStatusCol(cols) {
  const byKeyword = cols.find(c =>
    STATUS_TYPES.includes(c.type) &&
    STATUS_KEYWORDS.some(k => c.id.toLowerCase().includes(k))
  );
  if (byKeyword) return byKeyword;
  return cols.find(c => STATUS_TYPES.includes(c.type)) || null;
}

function pickPriorityCol(cols) {
  return cols.find(c =>
    (STATUS_TYPES.includes(c.type) || c.type === 'dropdown') &&
    ['priority','prio','urgency','importance'].some(k => c.id.toLowerCase().includes(k))
  ) || null;
}

function pickDateCol(cols) {
  return cols.find(c =>
    c.type === 'date' &&
    ['due','deadline','date','end','target'].some(k => c.id.toLowerCase().includes(k))
  ) || cols.find(c => c.type === 'date') || null;
}

function extractDate(col) {
  if (!col) return null;
  if (col.text && col.text.trim()) return col.text.trim();
  try {
    const v = JSON.parse(col.value || '{}');
    if (v?.date) return v.date;
  } catch {}
  return null;
}

// ── Due date helpers ───────────────────────────────────────────
function isOverdue(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const today = new Date(); today.setHours(0,0,0,0);
  return d < today;
}

function isThisWeek(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const today = new Date(); today.setHours(0,0,0,0);
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
  return d >= today && d <= weekEnd;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Main fetch ─────────────────────────────────────────────────
async function fetchBoard() {
  if (!getToken()) {
    setSyncState('error', 'No token');
    renderNoToken();
    return;
  }

  setSpinner(true);
  setSyncState('loading', 'Syncing');

  try {
    const boardData = await gqlRequest(GROUPS_QUERY, { ids: [BOARD_ID] });
    const board     = boardData?.boards?.[0];
    if (!board) throw new Error('Board not found. Check Board ID and token permissions.');

    const groups   = board.groups || [];
    const allTasks = [];
    let loggedFirst = false;

    for (const group of groups) {
      const items = await fetchGroupItems(BOARD_ID, group.id);

      items.forEach(item => {
        const sCol     = pickStatusCol(item.column_values);
        const pCol     = pickPriorityCol(item.column_values);
        const dCol     = pickDateCol(item.column_values);
        const aCol     = item.column_values.find(c => c.type === 'people' || c.type === 'multiple-person');
        const rawLabel = extractLabel(sCol);
        const rawPrio  = extractLabel(pCol);
        const rawDate  = extractDate(dCol);

        if (!loggedFirst) {
          loggedFirst = true;
          console.log('[MSD] Cols:', item.column_values.map(c => `${c.id}(${c.type})="${c.text}"`).join(' | '));
        }

        allTasks.push({
          id: item.id,
          name: item.name,
          section: group.title,
          rawLabel,
          rawPrio,
          status: classify(rawLabel),
          priority: classifyPriority(rawPrio),
          dueDate: rawDate,
          overdue: isOverdue(rawDate),
          assignee: aCol ? (aCol.text || tryPeople(aCol.value)) : '—'
        });
      });
    }

    allTasksGlobal  = allTasks;
    allGroupsGlobal = groups;

    // Populate section filter
    const sectionSel = $('filterSection');
    const existing   = [...sectionSel.options].map(o => o.value);
    groups.forEach(g => {
      if (!existing.includes(g.title)) {
        const opt = document.createElement('option');
        opt.value = g.title; opt.textContent = g.title;
        sectionSel.appendChild(opt);
      }
    });

    renderAll(allTasks, groups);
    window.__msdTasks = allTasks;
    setSyncState('live', 'Synced');

   } catch (err) {
     console.error('[MSD] Fetch error:', err.message);
   
     const msg = err.message || '';
     const isDailyLimit =
       msg.includes('Daily limit exceeded') ||
       msg.includes('DAILY_LIMIT_EXCEEDED');
   
     if (isDailyLimit) {
       stopAutoRefresh();
       setSyncState('error', 'Daily limit reached');
       renderError('Monday daily API limit reached. Resets at midnight UTC.');
       return;
     }
   
     setSyncState('error', 'Sync failed');
     renderError(err.message);
   } finally {
     setSpinner(false);
   }

function tryPeople(raw) {
  try {
    const v    = JSON.parse(raw);
    const list = v?.personsAndTeams || v?.persons_and_teams || [];
    return list.map(p => p.name || p.id).filter(Boolean).join(', ');
  } catch { return ''; }
}

// ── Render all ─────────────────────────────────────────────────
function renderAll(tasks, groups) {
  const done       = tasks.filter(t => t.status === 'done').length;
  const working    = tasks.filter(t => t.status === 'working').length;
  const stuck      = tasks.filter(t => t.status === 'stuck').length;
  const notStarted = tasks.filter(t => t.status === 'not_started').length;
  const total      = tasks.length;
  const pct        = total ? Math.round(done / total * 100) : 0;
  const overdueCnt = tasks.filter(t => t.overdue && t.status !== 'done').length;
  const highPrioCnt = tasks.filter(t => (t.priority === 'high' || t.priority === 'critical') && t.status !== 'done').length;

  // Stat cards
  animateCount(statCompleted,    done);
  animateCount(statInProgress,   working);
  animateCount(statNotStarted,   notStarted);
  statPercent.textContent    = pct + '%';
  animateCount(statOverdue,      overdueCnt);
  animateCount(statHighPriority, highPrioCnt);

  const pctOf = n => total ? (n / total * 100).toFixed(1) + '%' : '0%';
  barCompleted.style.width     = pctOf(done);
  barInProgress.style.width    = pctOf(working);
  barNotStarted.style.width    = pctOf(notStarted);
  barPercent.style.width       = pct + '%';
  barOverdue.style.width       = total ? (overdueCnt / total * 100).toFixed(1) + '%' : '0%';
  barHighPriority.style.width  = total ? (highPrioCnt / total * 100).toFixed(1) + '%' : '0%';

  renderCharts(tasks, groups);
  applyFiltersAndRender();
  taskCountEl.textContent = total + ' task' + (total !== 1 ? 's' : '');
}

// ── Animate count ──────────────────────────────────────────────
function animateCount(el, target) {
  const start = parseInt(el.textContent) || 0;
  const diff  = target - start;
  const steps = 20;
  let i = 0;
  const tick = () => {
    i++;
    el.textContent = Math.round(start + diff * (i / steps));
    if (i < steps) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── Charts ─────────────────────────────────────────────────────
function renderCharts(tasks, groups) {
  renderDonut(tasks);
  renderSectionBars(groups, tasks);
  renderLineChart(tasks);
}

function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  return {
    text:   isDark ? '#8b91a8' : '#555b72',
    grid:   isDark ? '#2e3347' : '#e2e5ef',
    bg:     isDark ? '#22263a' : '#f0f2fa'
  };
}

function renderDonut(tasks) {
  const done       = tasks.filter(t => t.status === 'done').length;
  const working    = tasks.filter(t => t.status === 'working').length;
  const stuck      = tasks.filter(t => t.status === 'stuck').length;
  const ns         = tasks.filter(t => t.status === 'not_started').length;
  const ctx        = $('donutChart').getContext('2d');
  const colors     = ['#22c55e','#f59e0b','#ef4444','#6b7280'];
  const labels     = ['Completed','In Progress','Stuck','Not Started'];
  const vals       = [done, working, stuck, ns];
  if (donutChartInstance) donutChartInstance.destroy();
  donutChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: { cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed}` } } } }
  });
  donutLegendEl.innerHTML = labels.map((l,i) =>
    `<div class="legend-item"><span class="legend-dot" style="background:${colors[i]}"></span>${l} <strong>${vals[i]}</strong></div>`
  ).join('');
}

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

function renderLineChart(tasks) {
  // Group completed tasks by month (last 6 months)
  const now     = new Date();
  const months  = [];
  const counts  = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
    counts.push(0);
  }

  // Use tasks with a due date that are done as a proxy for "completed that month"
  tasks.filter(t => t.status === 'done' && t.dueDate).forEach(t => {
    const d = new Date(t.dueDate);
    for (let i = 0; i < 6; i++) {
      const base = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const end  = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      if (d >= base && d <= end) { counts[i]++; break; }
    }
  });

  const cc  = getChartColors();
  const ctx = $('lineChart').getContext('2d');
  if (lineChartInstance) lineChartInstance.destroy();
  lineChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        label: 'Tasks Completed',
        data: counts,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.12)',
        borderWidth: 2,
        pointBackgroundColor: '#6366f1',
        pointRadius: 4,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y} tasks completed` } } },
      scales: {
        x: { ticks: { color: cc.text, font: { size: 11 } }, grid: { color: cc.grid } },
        y: { beginAtZero: true, ticks: { color: cc.text, font: { size: 11 }, stepSize: 1 }, grid: { color: cc.grid } }
      }
    }
  });
}

// ── Filters ────────────────────────────────────────────────────
[filterStatus, filterPriority, filterSection, filterDue].forEach(el => {
  el.addEventListener('change', applyFiltersAndRender);
});

clearFilters.addEventListener('click', () => {
  filterStatus.value   = 'all';
  filterPriority.value = 'all';
  filterSection.value  = 'all';
  filterDue.value      = 'all';
  applyFiltersAndRender();
});

function applyFiltersAndRender() {
  const fStatus   = filterStatus.value;
  const fPriority = filterPriority.value;
  const fSection  = filterSection.value;
  const fDue      = filterDue.value;

  let filtered = allTasksGlobal;

  if (fStatus !== 'all')   filtered = filtered.filter(t => t.status === fStatus);
  if (fPriority !== 'all') filtered = filtered.filter(t => t.priority === fPriority);
  if (fSection !== 'all')  filtered = filtered.filter(t => t.section === fSection);
  if (fDue === 'overdue')    filtered = filtered.filter(t => t.overdue && t.status !== 'done');
  if (fDue === 'this_week')  filtered = filtered.filter(t => isThisWeek(t.dueDate));
  if (fDue === 'no_date')    filtered = filtered.filter(t => !t.dueDate);

  const isFiltered = fStatus !== 'all' || fPriority !== 'all' || fSection !== 'all' || fDue !== 'all';
  filterResult.textContent = isFiltered ? `Showing ${filtered.length} of ${allTasksGlobal.length} tasks` : '';

  renderTable(filtered);
  taskCountEl.textContent = filtered.length + ' task' + (filtered.length !== 1 ? 's' : '');
}

// ── Priority badges ────────────────────────────────────────────
const PRIO_MAP = {
  critical: ['prio-critical', '🚨 Critical'],
  high:     ['prio-high',     '🔴 High'],
  medium:   ['prio-medium',   '🟡 Medium'],
  low:      ['prio-low',      '🟢 Low']
};

// ── Status badges ──────────────────────────────────────────────
const BADGES = {
  done:        ['badge-done',        '✓ Done'],
  working:     ['badge-working',     '⚡ In Progress'],
  stuck:       ['badge-stuck',       '🚫 Stuck'],
  not_started: ['badge-not-started', '○ Not Started']
};

// ── Avatar initials ────────────────────────────────────────────
const AVATAR_COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#ec4899','#8b5cf6','#14b8a6'];
const avatarColorCache = {};

function getAvatarColor(name) {
  if (!avatarColorCache[name]) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    avatarColorCache[name] = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }
  return avatarColorCache[name];
}

function renderAvatar(assignee) {
  if (!assignee || assignee === '—') return '<span class="avatar-empty">—</span>';
  const names = assignee.split(',').map(s => s.trim()).filter(Boolean);
  return names.slice(0, 2).map(name => {
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const color    = getAvatarColor(name);
    return `<span class="avatar" style="background:${color}" title="${h(name)}">${initials}</span>`;
  }).join('');
}

// ── Table render ───────────────────────────────────────────────
function renderTable(tasks) {
  if (!tasks.length) {
    tasksTableBody.innerHTML = `<tr><td colspan="7" class="empty-state"><div class="empty-icon">🔍</div>No tasks match your filters.</td></tr>`;
    return;
  }

  tasksTableBody.innerHTML = tasks.map(t => {
    const [sCls, sLbl]  = BADGES[t.status] || BADGES.not_started;
    const [pCls, pLbl]  = PRIO_MAP[t.priority] || PRIO_MAP.medium;
    const dueCls  = (t.overdue && t.status !== 'done') ? 'due-overdue' : (isThisWeek(t.dueDate) ? 'due-soon' : '');
    const dueStr  = t.dueDate ? formatDate(t.dueDate) : '—';
    const overdueBadge = (t.overdue && t.status !== 'done') ? ' <span class="badge-overdue">⚠ Overdue</span>' : '';

    return `
    <tr class="task-row" data-id="${t.id}">
      <td class="expand-cell">
        <button class="expand-btn" aria-label="Expand" data-id="${t.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </td>
      <td class="task-name-cell">${h(t.name)}</td>
      <td><span class="section-tag">${h(t.section)}</span></td>
      <td><span class="badge ${pCls}">${pLbl}</span></td>
      <td><span class="badge ${sCls}">${sLbl}</span></td>
      <td class="${dueCls}">${dueStr}${overdueBadge}</td>
      <td><div class="avatar-group">${renderAvatar(t.assignee)}</div></td>
    </tr>
    <tr class="task-detail-row" id="detail-${t.id}" style="display:none">
      <td colspan="7" class="detail-cell">
        <div class="detail-body">
          <span class="detail-label">Section:</span> ${h(t.section)}
          &nbsp;·&nbsp; <span class="detail-label">Priority:</span> ${pLbl}
          &nbsp;·&nbsp; <span class="detail-label">Status:</span> ${h(t.rawLabel || t.status)}
          &nbsp;·&nbsp; <span class="detail-label">Due:</span> ${dueStr}
          &nbsp;·&nbsp; <span class="detail-label">Assigned:</span> ${h(t.assignee)}
        </div>
      </td>
    </tr>`;
  }).join('');

  // Expand/collapse rows
  tasksTableBody.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id     = btn.dataset.id;
      const detail = $('detail-' + id);
      const row    = btn.closest('tr');
      const open   = detail.style.display !== 'none';
      detail.style.display = open ? 'none' : 'table-row';
      row.classList.toggle('row-expanded', !open);
      btn.classList.toggle('btn-rotated', !open);
    });
  });
}

// ── Empty / Error states ───────────────────────────────────────
function renderNoToken() {
  tasksTableBody.innerHTML = `<tr><td colspan="7" class="empty-state">
    <div class="empty-icon">🔑</div>
    <strong>No API token connected</strong><br>
    <span>Click the <strong>⚙️ Settings</strong> button in the top right to paste your Monday API token and load your SEO board.</span>
  </td></tr>`;
}

function renderError(msg) {
  tasksTableBody.innerHTML = `<tr><td colspan="7" class="empty-state error-state">
    <div class="empty-icon">⚠️</div>
    <strong>Sync Error</strong><br>
    <code style="font-size:11px;word-break:break-all;display:block;margin:8px 0;">${h(msg)}</code>
    <small>Open DevTools → Console (F12) for details</small>
  </td></tr>`;
}

function h(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── CSV export ─────────────────────────────────────────────────
exportBtn.addEventListener('click', () => {
  const tasks = window.__msdTasks || [];
  if (!tasks.length) { alert('No data to export yet.'); return; }
  const rows = [['Task Name','Section','Priority','Status (Monday)','Classified','Due Date','Overdue','Assigned To'],
    ...tasks.map(t => [t.name, t.section, t.priority, t.rawLabel, t.status, t.dueDate || '', t.overdue ? 'Yes' : 'No', t.assignee])];
  const csv  = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: 'msd-seo-audit.csv'
  });
  a.click();
});

// ── Refresh + init ─────────────────────────────────────────────
refreshBtn.addEventListener('click', fetchBoard);

document.addEventListener('DOMContentLoaded', () => {
  if (getToken()) {
    startAutoRefresh();
    fetchBoard();
  } else {
    setSyncState('error', 'No token');
    renderNoToken();
  }
});
