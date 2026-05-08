const STORAGE_KEYS = {
  usageCounts: 'launcherUsageCountsV1',
  recentPaths: 'launcherRecentPathsV1'
};

const MAX_RECENTS = 10;

let allApps = [];
let filteredApps = [];
let selectedIndex = 0;
let usageCounts = {};
let recentPaths = [];

let searchInputEl;
let filterStatusEl;
let filterToggleButtonEl;
let itemsListEl;
let messageEl;
let autoLaunchCheckboxEl;

function safeParseJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function loadUsageCounts() {
  try {
    const parsed = safeParseJson(localStorage.getItem(STORAGE_KEYS.usageCounts), {});
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const next = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key !== 'string') {
        continue;
      }

      const count = Number(value);
      if (Number.isFinite(count) && count > 0) {
        next[key] = Math.floor(count);
      }
    }

    return next;
  } catch (_error) {
    return {};
  }
}

function saveUsageCounts() {
  try {
    localStorage.setItem(STORAGE_KEYS.usageCounts, JSON.stringify(usageCounts));
  } catch (_error) {
    // ignore storage errors
  }
}

function loadRecentPaths() {
  try {
    const parsed = safeParseJson(localStorage.getItem(STORAGE_KEYS.recentPaths), []);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(0, MAX_RECENTS);
  } catch (_error) {
    return [];
  }
}

function saveRecentPaths() {
  try {
    localStorage.setItem(STORAGE_KEYS.recentPaths, JSON.stringify(recentPaths));
  } catch (_error) {
    // ignore storage errors
  }
}

function setMessage(text, type = '') {
  if (!messageEl) {
    return;
  }

  messageEl.textContent = text;
  messageEl.classList.remove('success', 'error');
  if (type) {
    messageEl.classList.add(type);
  }
}

function setFilterStatus(visible) {
  if (!filterStatusEl) {
    return;
  }

  if (visible) {
    filterStatusEl.textContent = 'プライバシーフィルター: ON';
    filterStatusEl.classList.remove('off');
    filterStatusEl.classList.add('on');
  } else {
    filterStatusEl.textContent = 'プライバシーフィルター: OFF';
    filterStatusEl.classList.remove('on');
    filterStatusEl.classList.add('off');
  }
}

function getUsageCount(appItem) {
  return Number(usageCounts[appItem.path] || 0);
}

function sortByUsageThenName(items) {
  return [...items].sort((a, b) => {
    const diff = getUsageCount(b) - getUsageCount(a);
    if (diff !== 0) {
      return diff;
    }

    return a.name.localeCompare(b.name, 'ja');
  });
}

function applyQueryFilter(items, query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    return [...items];
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return [...items];
  }

  return items.filter((item) => {
    const haystack = String(item.name || '').toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

function resolveDisplayApps(query) {
  const normalized = String(query || '').trim();
  if (normalized.length > 0) {
    return sortByUsageThenName(applyQueryFilter(allApps, normalized));
  }

  const appByPath = new Map(allApps.map((item) => [item.path, item]));
  const recentApps = [];
  const seen = new Set();

  for (const recentPath of recentPaths) {
    const appItem = appByPath.get(recentPath);
    if (!appItem) {
      continue;
    }

    recentApps.push(appItem);
    seen.add(appItem.path);
  }

  const remaining = allApps.filter((item) => !seen.has(item.path));
  const used = sortByUsageThenName(remaining.filter((item) => getUsageCount(item) > 0));
  const others = sortByUsageThenName(remaining.filter((item) => getUsageCount(item) <= 0));

  return [...recentApps, ...used, ...others];
}

function rebuildFilteredApps() {
  const query = searchInputEl ? searchInputEl.value : '';
  filteredApps = resolveDisplayApps(query);
}

function getPreferredSelectionIndex() {
  return 0;
}

function buildActions() {
  return filteredApps.map((appItem, idx) => ({
    id: `app-${idx}`,
    type: 'app',
    label: appItem.name,
    app: appItem
  }));
}

function normalizeSelection() {
  const actions = buildActions();
  if (selectedIndex < 0) {
    selectedIndex = 0;
  }

  if (selectedIndex >= actions.length) {
    selectedIndex = Math.max(0, actions.length - 1);
  }
}

function highlightSelection() {
  const buttons = itemsListEl.querySelectorAll('.item');
  buttons.forEach((button) => {
    button.classList.remove('selected');
  });

  const selected = itemsListEl.querySelector(`.item[data-index="${selectedIndex}"]`);
  if (selected) {
    selected.classList.add('selected');
    selected.scrollIntoView({ block: 'nearest' });
  }
}

function renderItems() {
  if (!itemsListEl) {
    return;
  }

  itemsListEl.innerHTML = '';
  const actions = buildActions();
  normalizeSelection();

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'item';
    button.dataset.index = String(i);

    if (action.app && action.app.source === 'auto') {
      button.textContent = `${action.label} (Auto)`;
    } else {
      button.textContent = action.label;
    }

    if (i === selectedIndex) {
      button.classList.add('selected');
    }

    button.addEventListener('mouseenter', () => {
      selectedIndex = i;
      highlightSelection();
    });

    button.addEventListener('click', async () => {
      selectedIndex = i;
      highlightSelection();
      await executeAction(action);
    });

    itemsListEl.appendChild(button);
  }

  if (actions.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = '一致するアプリがありません。';
    empty.style.color = '#6b7280';
    empty.style.fontSize = '13px';
    itemsListEl.appendChild(empty);
  }
}

function incrementUsage(appItem) {
  if (!appItem || typeof appItem.path !== 'string') {
    return;
  }

  const nextCount = Number(usageCounts[appItem.path] || 0) + 1;
  usageCounts[appItem.path] = nextCount;
  saveUsageCounts();
}

function updateRecents(appItem) {
  if (!appItem || typeof appItem.path !== 'string') {
    return;
  }

  recentPaths = recentPaths.filter((entry) => entry !== appItem.path);
  recentPaths.unshift(appItem.path);
  recentPaths = recentPaths.slice(0, MAX_RECENTS);
  saveRecentPaths();
}

async function executeAction(action) {
  if (!action) {
    return;
  }

  if (action.type === 'app') {
    try {
      const result = await window.launcher.launchApp(action.app.path);
      if (result && result.ok) {
        incrementUsage(action.app);
        updateRecents(action.app);
        setMessage(`起動: ${action.app.name}`, 'success');
        await window.launcher.hideWindow();
      } else {
        const errorText = result && result.error ? result.error : '不明なエラー';
        setMessage(`起動失敗: ${action.app.name} (${errorText})`, 'error');
      }
    } catch (error) {
      setMessage(`起動失敗: ${action.app.name} (${String(error)})`, 'error');
    }
  }
}

function resetSearchAndFocus() {
  if (!searchInputEl) {
    return;
  }

  searchInputEl.value = '';
  rebuildFilteredApps();
  selectedIndex = getPreferredSelectionIndex();
  renderItems();
  searchInputEl.focus();
}

function moveSelection(delta) {
  const actions = buildActions();
  if (actions.length === 0) {
    return;
  }

  selectedIndex += delta;
  if (selectedIndex < 0) {
    selectedIndex = actions.length - 1;
  }

  if (selectedIndex >= actions.length) {
    selectedIndex = 0;
  }

  highlightSelection();
}

async function executeSelected() {
  const actions = buildActions();
  normalizeSelection();
  await executeAction(actions[selectedIndex]);
}

async function togglePrivacyFilterFromButton() {
  try {
    const result = await window.launcher.togglePrivacyFilter();
    const visible = Boolean(result && result.visible);
    setFilterStatus(visible);
    setMessage(`プライバシーフィルター: ${visible ? 'ON' : 'OFF'}`, 'success');
  } catch (error) {
    setMessage(`フィルター操作に失敗: ${String(error)}`, 'error');
  }
}

function setupKeyboardHandlers() {
  document.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      try {
        const result = await window.launcher.hidePrivacyFilter();
        setFilterStatus(Boolean(result && result.visible));
      } catch (error) {
        setMessage(`Esc操作に失敗: ${String(error)}`, 'error');
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      await executeSelected();
    }
  });
}

async function initAutoLaunchSetting() {
  if (!autoLaunchCheckboxEl) {
    return;
  }

  try {
    const state = await window.launcher.getAutoLaunchEnabled();
    autoLaunchCheckboxEl.checked = Boolean(state && state.enabled);
  } catch (error) {
    autoLaunchCheckboxEl.checked = false;
    setMessage(`自動起動状態の取得に失敗: ${String(error)}`, 'error');
  }

  autoLaunchCheckboxEl.addEventListener('change', async () => {
    const desired = Boolean(autoLaunchCheckboxEl.checked);
    try {
      const result = await window.launcher.setAutoLaunchEnabled(desired);
      const enabled = Boolean(result && result.enabled);
      autoLaunchCheckboxEl.checked = enabled;
      if (result && result.ok) {
        setMessage(`自動起動: ${enabled ? 'ON' : 'OFF'}`, 'success');
      } else {
        const detail = result && result.error ? ` (${result.error})` : '';
        setMessage(`自動起動設定に失敗${detail}`, 'error');
      }
    } catch (error) {
      autoLaunchCheckboxEl.checked = !desired;
      setMessage(`自動起動設定に失敗: ${String(error)}`, 'error');
    }
  });
}

async function loadAppsCatalog() {
  try {
    const response = await window.launcher.getLauncherApps();
    if (!response || !Array.isArray(response.apps)) {
      return [];
    }

    return response.apps
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        if (typeof item.name !== 'string' || typeof item.path !== 'string') {
          return null;
        }

        const name = item.name.trim();
        const appPath = item.path.trim();
        if (!name || !appPath) {
          return null;
        }

        return {
          name,
          path: appPath,
          source: item.source === 'manual' ? 'manual' : 'auto'
        };
      })
      .filter(Boolean);
  } catch (error) {
    setMessage(`アプリ一覧取得に失敗: ${String(error)}`, 'error');
    return [];
  }
}

async function init() {
  searchInputEl = document.getElementById('searchInput');
  filterStatusEl = document.getElementById('filterStatus');
  filterToggleButtonEl = document.getElementById('filterToggleButton');
  itemsListEl = document.getElementById('itemsList');
  messageEl = document.getElementById('message');
  autoLaunchCheckboxEl = document.getElementById('autoLaunchCheckbox');

  if (!searchInputEl || !filterStatusEl || !filterToggleButtonEl || !itemsListEl || !messageEl || !autoLaunchCheckboxEl) {
    return;
  }

  usageCounts = loadUsageCounts();
  recentPaths = loadRecentPaths();

  allApps = await loadAppsCatalog();
  rebuildFilteredApps();
  renderItems();

  searchInputEl.addEventListener('input', () => {
    rebuildFilteredApps();
    selectedIndex = getPreferredSelectionIndex();
    renderItems();
  });
  filterToggleButtonEl.addEventListener('click', () => {
    togglePrivacyFilterFromButton();
  });

  setupKeyboardHandlers();
  await initAutoLaunchSetting();

  try {
    const state = await window.launcher.isPrivacyFilterVisible();
    setFilterStatus(Boolean(state && state.visible));
  } catch (error) {
    setFilterStatus(false);
    setMessage(`初期状態取得に失敗: ${String(error)}`, 'error');
  }

  window.launcher.onPrivacyFilterStateChanged((visible) => {
    setFilterStatus(Boolean(visible));
  });

  window.launcher.onWindowShown(() => {
    resetSearchAndFocus();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    setMessage(`初期化エラー: ${String(error)}`, 'error');
  });
});
