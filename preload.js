const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDirectoryContents: (path) => ipcRenderer.invoke('get-directory-contents', path),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  openFile: (path) => ipcRenderer.invoke('open-file', path),
  getFileIcon: (path) => ipcRenderer.invoke('get-file-icon', path),
  getFilePreview: (path) => ipcRenderer.invoke('get-file-preview', path),
  trashFile: (path) => ipcRenderer.invoke('trash-file', path),
  moveFile: (source, target) => ipcRenderer.invoke('move-file', source, target),
  copyFile: (source, target) => ipcRenderer.invoke('copy-file', source, target),
  newWindow: () => ipcRenderer.invoke('new-window'),
  startDrag: (path) => ipcRenderer.send('drag-start', path),
  showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path),
  searchDirectory: (path, query) => ipcRenderer.invoke('search-directory', path, query),
  openWith: (path, appName) => ipcRenderer.invoke('open-with', path, appName),
  getOpenWithApps: (path) => ipcRenderer.invoke('get-open-with-apps', path),
  renameFile: (oldPath, newName) => ipcRenderer.invoke('rename-file', oldPath, newName),
  showGetInfo: (path) => ipcRenderer.invoke('get-info', path),
  checkPath: (path) => ipcRenderer.invoke('check-path', path),
  toggleMaximize: () => ipcRenderer.invoke('toggle-maximize'),
});
