const { app, BrowserWindow, ipcMain, screen, globalShortcut, Menu, Tray, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const APP_DISPLAY_NAME = 'graber';
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let filterWindows = [];
let isFilterVisible = false;
let tray = null;
let isQuitting = false;
let launcherAppsCatalog = [];

function getRuntimeFilePath(relativePath) {
  const candidates = [
    path.join(app.getAppPath(), relativePath),
    path.join(__dirname, relativePath),
    path.join(process.resourcesPath, relativePath)
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    } catch (_error) {
      // ignore
    }
  }

  return '';
}

function normalizeAppName(name) {
  return String(name || '').trim().toLowerCase();
}

function sanitizeCatalogItem(item, source) {
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
    source
  };
}

async function readManualAppsFromJson() {
  const filePath = getRuntimeFilePath('apps.json') || path.join(__dirname, 'apps.json');
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => sanitizeCatalogItem(item, 'manual'))
      .filter(Boolean);
  } catch (error) {
    console.warn('Failed to read apps.json. Continuing with auto apps only.', error);
    return [];
  }
}

function getAutoLaunchEnabled() {
  try {
    const settings = app.getLoginItemSettings();
    return Boolean(settings && settings.openAtLogin);
  } catch (error) {
    console.warn('Failed to get login item settings:', error);
    return false;
  }
}

function setAutoLaunchEnabled(enabled) {
  try {
    const desired = Boolean(enabled);
    if (process.platform === 'win32') {
      app.setLoginItemSettings(
        desired
          ? {
              openAtLogin: true,
              openAsHidden: true
            }
          : {
              openAtLogin: false
            }
      );
    }

    return {
      ok: true,
      enabled: getAutoLaunchEnabled()
    };
  } catch (error) {
    console.error('Failed to set auto launch setting:', error);
    return {
      ok: false,
      enabled: getAutoLaunchEnabled(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function collectShortcutFiles(rootDir) {
  const results = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    try {
      const entries = await fs.promises.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        if (path.extname(entry.name).toLowerCase() !== '.lnk') {
          continue;
        }

        const name = path.basename(entry.name, '.lnk').trim();
        if (!name) {
          continue;
        }

        results.push({
          name,
          path: fullPath,
          source: 'auto'
        });
      }
    } catch (error) {
      console.warn('Start menu scan skipped for directory:', current, error);
    }
  }

  return results;
}

function getStartMenuDirectories() {
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  let userStartMenu = '';
  try {
    userStartMenu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  } catch (error) {
    console.warn('Failed to resolve user start menu path from appData:', error);
  }

  return [
    path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    userStartMenu
  ].filter((item, index, self) => item && self.indexOf(item) === index);
}

async function scanStartMenuApps() {
  const roots = getStartMenuDirectories();
  const all = [];
  for (const root of roots) {
    const items = await collectShortcutFiles(root);
    all.push(...items);
  }
  return all;
}

function mergeAppCatalogs(manualApps, autoApps) {
  const merged = new Map();
  for (const appItem of autoApps) {
    const normalized = normalizeAppName(appItem.name);
    if (!normalized || merged.has(normalized)) {
      continue;
    }

    merged.set(normalized, appItem);
  }

  for (const appItem of manualApps) {
    const normalized = normalizeAppName(appItem.name);
    if (!normalized) {
      continue;
    }

    merged.set(normalized, appItem);
  }

  return Array.from(merged.values());
}

async function initializeLauncherAppsCatalog() {
  try {
    const [manualApps, autoApps] = await Promise.all([readManualAppsFromJson(), scanStartMenuApps()]);
    launcherAppsCatalog = mergeAppCatalogs(manualApps, autoApps);
  } catch (error) {
    console.warn('Failed to initialize launcher app catalog:', error);
    launcherAppsCatalog = [];
  }
}

function notifyFilterStateChanged() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('privacy-filter-state', isFilterVisible);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 600,
    minWidth: 520,
    minHeight: 600,
    center: true,
    show: false,
    title: APP_DISPLAY_NAME,
    opacity: 0.9,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html')).catch((err) => {
    console.error('Failed to load index.html:', err);
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      hidePrivacyFilter();
      return;
    }

    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createFilterWindowForDisplay(display) {
  try {
    const { x, y, width, height } = display.bounds;
    const filterWindow = new BrowserWindow({
      x,
      y,
      width,
      height,
      fullscreen: true,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    filterWindow.setMenuBarVisibility(false);
    filterWindow.setIgnoreMouseEvents(true);
    filterWindow.loadFile(path.join(__dirname, 'filter.html')).catch((err) => {
      console.error('Failed to load filter.html:', err);
    });

    filterWindow.once('ready-to-show', () => {
      try {
        filterWindow.showInactive();
      } catch (error) {
        console.error('Failed to show filter window:', error);
      }
    });

    filterWindow.on('closed', () => {
      filterWindows = filterWindows.filter((win) => win !== filterWindow);
    });

    return filterWindow;
  } catch (error) {
    console.error('Failed to create filter window:', error);
    return null;
  }
}

function showLauncherWindow() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
    }

    mainWindow.setAlwaysOnTop(true);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(false);

    if (mainWindow.webContents.isLoadingMainFrame()) {
      mainWindow.webContents.once('did-finish-load', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('launcher-window-shown');
        }
      });
    } else {
      mainWindow.webContents.send('launcher-window-shown');
    }
    return true;
  } catch (error) {
    console.error('Failed to show launcher window:', error);
    return false;
  }
}

function hideLauncherWindow() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }

    mainWindow.hide();
    return true;
  } catch (error) {
    console.error('Failed to hide launcher window:', error);
    return false;
  }
}

function toggleLauncherWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return showLauncherWindow();
  }

  if (mainWindow.isVisible()) {
    hideLauncherWindow();
    return false;
  }

  return showLauncherWindow();
}

function showPrivacyFilter() {
  if (isFilterVisible && filterWindows.length > 0) {
    return true;
  }

  try {
    const displays = screen.getAllDisplays();
    const windows = displays
      .map((display) => createFilterWindowForDisplay(display))
      .filter(Boolean);

    filterWindows = windows;
    isFilterVisible = filterWindows.length > 0;
    return isFilterVisible;
  } catch (error) {
    console.error('Failed to show privacy filter:', error);
    isFilterVisible = false;
    filterWindows = [];
    return false;
  }
}

function hidePrivacyFilter() {
  const windowsToClose = [...filterWindows];
  filterWindows = [];

  for (const win of windowsToClose) {
    try {
      if (!win.isDestroyed()) {
        win.close();
      }
    } catch (error) {
      console.error('Failed to close filter window:', error);
    }
  }

  isFilterVisible = false;
  return true;
}

function togglePrivacyFilter() {
  if (isFilterVisible) {
    hidePrivacyFilter();
    return false;
  }

  return showPrivacyFilter();
}

function sanitizeAppPath(appPath) {
  if (typeof appPath !== 'string') {
    throw new Error('Invalid app path: path must be a string.');
  }

  const trimmed = appPath.trim();
  if (!trimmed) {
    throw new Error('Invalid app path: path cannot be empty.');
  }

  return trimmed;
}

function isWindowsShortcut(filePath) {
  return path.extname(filePath).toLowerCase() === '.lnk';
}

function pathLooksAbsolute(filePath) {
  return /^[a-zA-Z]:\\/.test(filePath) || filePath.startsWith('\\\\');
}

function getExecutableName(appPath) {
  const normalized = appPath.replace(/"/g, '').trim();
  const base = path.basename(normalized);
  return base.toLowerCase().endsWith('.exe') ? base : `${base}.exe`;
}

function tryFocusLaunchedApp(appPath) {
  if (process.platform !== 'win32') {
    return;
  }

  if (isWindowsShortcut(appPath)) {
    return;
  }

  const exeName = getExecutableName(appPath);
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$targetExe = '${exeName.replace(/'/g, "''")}'
$shell = New-Object -ComObject WScript.Shell
$focused = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 100
  $proc = Get-Process | Where-Object { $_.Name -ieq [System.IO.Path]::GetFileNameWithoutExtension($targetExe) } | Sort-Object StartTime -Descending | Select-Object -First 1
  if ($null -ne $proc) {
    if ($shell.AppActivate($proc.Id)) {
      $focused = $true
      break
    }
  }
}
if (-not $focused) { exit 1 }
`;

  const focusProcess = spawn('powershell.exe', ['-NoProfile', '-Command', psScript], {
    windowsHide: true,
    stdio: 'ignore'
  });

  focusProcess.on('error', (error) => {
    console.warn('Focus helper failed to start:', error);
  });
}

function launchApp(appPath) {
  return new Promise((resolve) => {
    try {
      const safePath = sanitizeAppPath(appPath);
      const shortcut = isWindowsShortcut(safePath);

      if (pathLooksAbsolute(safePath) && !fs.existsSync(safePath)) {
        resolve({ ok: false, error: `Path not found: ${safePath}` });
        return;
      }

      const launchViaShortcut = shortcut && process.platform === 'win32';
      if (launchViaShortcut) {
        shell
          .openPath(safePath)
          .then((errorMessage) => {
            if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
              resolve({ ok: false, error: errorMessage.trim() });
              return;
            }

            resolve({ ok: true });
          })
          .catch((error) => {
            console.error('Failed to launch shortcut via shell.openPath:', error);
            resolve({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            });
          });
        return;
      }

      const child = spawn(safePath, [], {
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: true
      });

      let settled = false;
      const finish = (result) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(result);
      };

      child.once('error', (error) => {
        console.error('Failed to launch app:', error);
        finish({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

      child.once('spawn', () => {
        child.unref();
        tryFocusLaunchedApp(safePath);
        finish({ ok: true });
      });
    } catch (error) {
      console.error('Failed to launch app:', error);
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

function registerLauncherShortcuts() {
  const primary = globalShortcut.register('Control+Space', () => {
    toggleLauncherWindow();
  });
  if (!primary) {
    console.warn('Failed to register global shortcut: Ctrl+Space');
  }

  const fallback = globalShortcut.register('Control+Shift+Space', () => {
    toggleLauncherWindow();
  });
  if (!fallback) {
    console.warn('Failed to register global shortcut: Ctrl+Shift+Space');
  }

  const escape = globalShortcut.register('Escape', () => {
    if (!isFilterVisible) {
      return;
    }

    hidePrivacyFilter();
    notifyFilterStateChanged();
  });
  if (!escape) {
    console.warn('Failed to register global shortcut: Escape');
  }
}

function getTrayIcon() {
  const iconCandidates = [
    getRuntimeFilePath(path.join('build', 'icon.ico')),
    getRuntimeFilePath(path.join('build', 'icon.png')),
    getRuntimeFilePath('tray.png'),
    getRuntimeFilePath('icon.png')
  ];

  const runtimeBuildDirCandidates = [path.join(app.getAppPath(), 'build'), path.join(process.resourcesPath, 'build')];
  for (const buildDir of runtimeBuildDirCandidates) {
    try {
      if (!buildDir || !fs.existsSync(buildDir)) {
        continue;
      }

      const entries = fs.readdirSync(buildDir);
      for (const entry of entries) {
        const ext = path.extname(entry).toLowerCase();
        if (ext !== '.ico' && ext !== '.png') {
          continue;
        }

        iconCandidates.push(path.join(buildDir, entry));
      }
    } catch (error) {
      console.warn('Failed to inspect build directory for tray icons:', buildDir, error);
    }
  }

  for (const iconPath of iconCandidates) {
    try {
      if (!fs.existsSync(iconPath)) {
        continue;
      }

      const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
      if (!image.isEmpty()) {
        console.log('Tray icon loaded from:', iconPath);
        return image;
      }
    } catch (error) {
      console.warn('Failed to load tray icon candidate:', iconPath, error);
    }
  }

  console.warn('No tray icon file could be loaded. Falling back to executable icon.');
  const exeIcon = nativeImage.createFromPath(process.execPath);
  if (!exeIcon.isEmpty()) {
    return exeIcon.resize({ width: 16, height: 16 });
  }

  return nativeImage.createEmpty();
}

function createTray() {
  try {
    const trayIcon = getTrayIcon();
    tray = new Tray(trayIcon);
    tray.setToolTip(APP_DISPLAY_NAME);

    const buildMenu = () =>
      Menu.buildFromTemplate([
        {
          label: 'ランチャー表示',
          click: () => {
            showLauncherWindow();
          }
        },
        {
          label: 'プライバシーフィルター ON/OFF',
          click: () => {
            togglePrivacyFilter();
            notifyFilterStateChanged();
          }
        },
        { type: 'separator' },
        {
          label: '終了',
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ]);

    tray.setContextMenu(buildMenu());
    tray.on('click', () => {
      toggleLauncherWindow();
    });
  } catch (error) {
    console.warn('Tray initialization failed. App will continue without tray.', error);
    tray = null;
  }
}

function setupIpcHandlers() {
  ipcMain.handle('get-auto-launch-enabled', () => {
    return { enabled: getAutoLaunchEnabled() };
  });

  ipcMain.handle('set-auto-launch-enabled', (_event, enabled) => {
    return setAutoLaunchEnabled(enabled);
  });

  ipcMain.handle('get-launcher-apps', () => {
    return {
      apps: Array.isArray(launcherAppsCatalog) ? launcherAppsCatalog : []
    };
  });

  ipcMain.handle('show-window', () => {
    const visible = showLauncherWindow();
    return { visible };
  });

  ipcMain.handle('hide-window', () => {
    hideLauncherWindow();
    const visible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
    return { visible };
  });

  ipcMain.handle('toggle-window', () => {
    const visible = toggleLauncherWindow();
    return { visible };
  });

  ipcMain.handle('show-privacy-filter', () => {
    const visible = showPrivacyFilter();
    notifyFilterStateChanged();
    return { visible };
  });

  ipcMain.handle('hide-privacy-filter', () => {
    hidePrivacyFilter();
    notifyFilterStateChanged();
    return { visible: false };
  });

  ipcMain.handle('toggle-privacy-filter', () => {
    const visible = togglePrivacyFilter();
    notifyFilterStateChanged();
    return { visible };
  });

  ipcMain.handle('is-privacy-filter-visible', () => {
    return { visible: isFilterVisible };
  });

  ipcMain.handle('launch-app', async (_event, appPath) => {
    return launchApp(appPath);
  });
}

function setupDisplayChangeHandlers() {
  const safeRefresh = () => {
    try {
      if (!isFilterVisible) {
        return;
      }

      hidePrivacyFilter();
      showPrivacyFilter();
      notifyFilterStateChanged();
    } catch (error) {
      console.error('Failed to refresh filter on display change:', error);
    }
  };

  screen.on('display-added', safeRefresh);
  screen.on('display-removed', safeRefresh);
  screen.on('display-metrics-changed', safeRefresh);
}

app.on('second-instance', () => {
  showLauncherWindow();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }

  await initializeLauncherAppsCatalog();
  Menu.setApplicationMenu(null);
  createMainWindow();
  setupIpcHandlers();
  setupDisplayChangeHandlers();
  registerLauncherShortcuts();
  createTray();

  app.on('activate', () => {
    showLauncherWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  hidePrivacyFilter();
});
