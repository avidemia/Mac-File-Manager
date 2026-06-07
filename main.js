import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec, execFile } from 'child_process';

const CONFIG_PATH = path.join(os.homedir(), '.finder-alt-config.json');

const DEFAULT_CONFIG = {
  sidebar: [
    { name: 'Home', path: os.homedir() },
    { name: 'Documents', path: path.join(os.homedir(), 'Documents') },
    { name: 'Downloads', path: path.join(os.homedir(), 'Downloads') },
    { name: 'Desktop', path: path.join(os.homedir(), 'Desktop') },
  ],
  folderSettings: {}, // { [folderPath]: { sortRule: 'name', notes: '', pinned: [] } }
  showHidden: false
};

const windows = new Set();

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    },
  });

  windows.add(win);
  win.on('closed', () => {
    windows.delete(win);
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
  }

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[RENDERER-CONSOLE] Level ${level}: ${message} at ${sourceId}:${line}`);
  });

  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      try {
        if (win.isDestroyed() || win.webContents.isDestroyed()) return;
        const image = await win.webContents.capturePage();
        const screenshotPath = path.join(os.homedir(), '.gemini', 'antigravity-ide', 'scratch', 'finder-alternative', 'screenshot.png');
        fs.writeFileSync(screenshotPath, image.toPNG());
        console.log(`[SCREENSHOT] Saved to ${screenshotPath}`);
      } catch (err) {
        console.error("Screenshot failed", err);
      }
    }, 2000);
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('get-directory-contents', async (event, dirPath) => {
  try {
    const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    // Get stats for all files
    const fileStatsPromises = files.map(async (file) => {
      const fullPath = path.join(dirPath, file.name);
      try {
        const stats = await fs.promises.stat(fullPath);
        return {
          name: file.name,
          path: fullPath,
          isDirectory: file.isDirectory(),
          size: stats.size,
          created: stats.birthtimeMs,
          modified: stats.mtimeMs,
          extension: path.extname(file.name).toLowerCase(),
        };
      } catch (err) {
        console.error(`Error statting ${fullPath}:`, err);
        return null;
      }
    });

    const fileStats = (await Promise.all(fileStatsPromises)).filter(Boolean);
    return fileStats;
  } catch (error) {
    console.error('Error reading directory:', error);
    throw error;
  }
});

ipcMain.handle('get-config', async () => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = await fs.promises.readFile(CONFIG_PATH, 'utf-8');
      return JSON.parse(data);
    }
    return DEFAULT_CONFIG;
  } catch (error) {
    console.error('Error reading config:', error);
    return DEFAULT_CONFIG;
  }
});

ipcMain.handle('save-config', async (event, config) => {
  try {
    await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
});

ipcMain.handle('get-home-dir', () => os.homedir());

ipcMain.handle('open-file', async (event, filePath) => {
  try {
    await shell.openPath(filePath);
    return true;
  } catch (error) {
    console.error('Error opening file:', error);
    return false;
  }
});

ipcMain.handle('get-file-icon', async (event, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.icns'].includes(ext)) {
      let mimeType = `image/${ext.slice(1)}`;
      if (ext === '.jpg') mimeType = 'image/jpeg';
      if (ext === '.svg') mimeType = 'image/svg+xml';
      
      const data = await fs.promises.readFile(filePath);
      return `data:${mimeType};base64,${data.toString('base64')}`;
    } else {
      // By returning null, the frontend will automatically fall back to rendering
      // generic Lucide-react icons (e.g., <FileText /> or <Folder />)
      // This completely avoids the Chromium/Electron native icon parser crash.
      return null;
    }
  } catch (error) {
    console.error('Error getting file icon:', error);
    return null;
  }
});

ipcMain.handle('get-file-preview', async (event, filePath) => {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) return null;
    
    const ext = path.extname(filePath).toLowerCase();

    // Known binary extensions that we can preview natively in Chromium
    const fileUrl = 'file://' + encodeURI(filePath).replace(/#/g, '%23').replace(/\?/g, '%3F');

    if (['.pdf'].includes(ext)) {
      return { type: 'pdf', src: fileUrl };
    }
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.ico'].includes(ext)) {
      return { type: 'image', src: fileUrl };
    }
    if (['.mp4', '.webm', '.ogg'].includes(ext)) {
      return { type: 'video', src: fileUrl };
    }
    if (['.mp3', '.wav'].includes(ext)) {
      return { type: 'audio', src: fileUrl };
    }

    const binaryExts = ['.zip', '.rar', '.exe', '.dmg', '.pkg', '.doc', '.docx', '.xls', '.xlsx'];
    if (binaryExts.includes(ext)) return null;

    const fd = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await fd.read(buffer, 0, 4096, 0);
    await fd.close();
    
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return null; // null byte -> likely binary
    }
    
    const text = buffer.toString('utf8', 0, bytesRead);
    return { type: 'text', content: text + (bytesRead === 4096 ? '...' : '') };
  } catch (error) {
    return null;
  }
});

ipcMain.handle('trash-file', async (event, filePath) => {
  try {
    await shell.trashItem(filePath);
    return true;
  } catch (error) {
    console.error('Error trashing file:', error);
    return false;
  }
});

ipcMain.handle('move-file', async (event, source, target) => {
  try {
    await fs.promises.rename(source, target);
    return true;
  } catch (error) {
    console.error('Error moving file:', error);
    return false;
  }
});

ipcMain.handle('copy-file', async (event, source, target) => {
  try {
    await fs.promises.cp(source, target, { recursive: true });
    return true;
  } catch (error) {
    console.error('Error copying file:', error);
    return false;
  }
});

ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('new-window', () => {
  createWindow();
});

ipcMain.on('drag-start', async (event, filePath) => {
  try {
    const icon = await app.getFileIcon(filePath);
    event.sender.startDrag({
      file: filePath,
      icon: icon
    });
  } catch (e) {
    console.error('Error starting drag', e);
  }
});

ipcMain.handle('search-directory', async (event, dirPath, query) => {
  return new Promise((resolve) => {
    exec(`find "${dirPath}" -maxdepth 4 -iname "*${query}*" | head -n 100`, async (error, stdout) => {
      if (error && stdout.trim() === '') {
        resolve([]);
        return;
      }
      const lines = stdout.split('\n').filter(l => l.trim().length > 0);
      const results = [];
      for (const fullPath of lines) {
        if (fullPath === dirPath) continue;
        try {
          const stats = await fs.promises.stat(fullPath);
          results.push({
            name: path.basename(fullPath),
            path: fullPath,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            created: stats.birthtimeMs,
            modified: stats.mtimeMs,
            extension: path.extname(fullPath).toLowerCase()
          });
        } catch(e) {}
      }
      resolve(results);
    });
  });
});

ipcMain.handle('get-open-with-apps', async (event, filePath) => {
  return new Promise((resolve) => {
    const scriptPath = path.join(app.getPath('userData'), 'get_apps.swift');
    fs.writeFileSync(scriptPath, `import AppKit\nif CommandLine.arguments.count < 2 { exit(1) }\nlet apps = NSWorkspace.shared.urlsForApplications(toOpen: URL(fileURLWithPath: CommandLine.arguments[1]))\nfor app in apps { print(app.path) }`);
    
    execFile('swift', [scriptPath, filePath], (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const apps = stdout.trim().split('\n').filter(Boolean).map(p => {
         return { name: path.basename(p, '.app'), path: p };
      });
      const uniqueApps = [];
      const seen = new Set();
      for (const a of apps) {
         if (!seen.has(a.name)) {
            seen.add(a.name);
            uniqueApps.push(a);
         }
      }
      resolve(uniqueApps);
    });
  });
});

ipcMain.handle('open-with', async (event, filePath, appPath) => {
  try {
    execFile('open', ['-a', appPath, filePath]);
    return true;
  } catch (err) {
    return false;
  }
});
