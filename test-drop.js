const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({ webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.loadFile('test-drop.html');
});
