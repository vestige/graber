const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  getAutoLaunchEnabled: () => ipcRenderer.invoke('get-auto-launch-enabled'),
  setAutoLaunchEnabled: (enabled) => ipcRenderer.invoke('set-auto-launch-enabled', enabled),
  getLauncherApps: () => ipcRenderer.invoke('get-launcher-apps'),
  showWindow: () => ipcRenderer.invoke('show-window'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  toggleWindow: () => ipcRenderer.invoke('toggle-window'),
  showPrivacyFilter: () => ipcRenderer.invoke('show-privacy-filter'),
  hidePrivacyFilter: () => ipcRenderer.invoke('hide-privacy-filter'),
  togglePrivacyFilter: () => ipcRenderer.invoke('toggle-privacy-filter'),
  isPrivacyFilterVisible: () => ipcRenderer.invoke('is-privacy-filter-visible'),
  launchApp: (appPath) => ipcRenderer.invoke('launch-app', appPath),
  searchWeb: (query) => ipcRenderer.invoke('search-web', query),
  onWindowShown: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = () => {
      callback();
    };

    ipcRenderer.on('launcher-window-shown', listener);
    return () => {
      ipcRenderer.removeListener('launcher-window-shown', listener);
    };
  },
  onPrivacyFilterStateChanged: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, visible) => {
      callback(Boolean(visible));
    };

    ipcRenderer.on('privacy-filter-state', listener);
    return () => {
      ipcRenderer.removeListener('privacy-filter-state', listener);
    };
  }
});
