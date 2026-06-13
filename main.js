import { app, BrowserWindow, ipcMain, shell, nativeImage } from 'electron';
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
const activeWatchers = new Map(); // path -> fs.FSWatcher
const windowVisiblePaths = new Map(); // winWebContentsId -> Set of paths
let appClipboard = null; // { paths: [], action: 'copy' | 'cut' }

function updateDirectoryWatchers(allWatchedPaths) {
  // Remove watchers for paths that are no longer watched
  for (const [watchedPath, watcher] of activeWatchers.entries()) {
    if (!allWatchedPaths.has(watchedPath)) {
      watcher.close();
      activeWatchers.delete(watchedPath);
    }
  }

  // Add watchers for new paths
  for (const path of allWatchedPaths) {
    if (!activeWatchers.has(path)) {
      try {
        if (!fs.existsSync(path)) continue;
        const watcher = fs.watch(path, (eventType, filename) => {
          for (const win of windows) {
            if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
              win.webContents.send('directory-changed', path);
            }
          }
        });
        activeWatchers.set(path, watcher);
      } catch (err) {
        console.error(`Error watching directory ${path}:`, err);
      }
    }
  }
}

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
  const webContentsId = win.webContents.id;
  win.on('closed', () => {
    windows.delete(win);
    windowVisiblePaths.delete(webContentsId);
    
    // Recalculate watchers
    const allPaths = new Set();
    for (const paths of windowVisiblePaths.values()) {
      for (const p of paths) {
        allPaths.add(p);
      }
    }
    updateDirectoryWatchers(allPaths);
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

ipcMain.handle('create-directory', async (event, dirPath) => {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    return true;
  } catch (error) {
    console.error('Error creating directory:', error);
    return false;
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
    if (error.code === 'EXDEV') {
      try {
        await fs.promises.cp(source, target, { recursive: true });
        await fs.promises.rm(source, { recursive: true, force: true });
        return true;
      } catch (err) {
        console.error('Error moving file across volumes:', err);
        return false;
      }
    }
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

ipcMain.handle('check-path', async (event, targetPath) => {
  try {
    const stats = await fs.promises.stat(targetPath);
    return { exists: true, isDirectory: stats.isDirectory() };
  } catch (error) {
    return { exists: false };
  }
});

ipcMain.handle('get-info', async (event, filePath) => {
  try {
    execFile('osascript', [
      '-e', 'tell application "Finder"',
      '-e', 'activate',
      '-e', `open information window of (POSIX file "${filePath}" as alias)`,
      '-e', 'end tell'
    ]);
    return true;
  } catch (err) {
    console.error('Error in get-info:', err);
    return false;
  }
});

ipcMain.handle('rename-file', async (event, oldPath, newName) => {
  try {
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName);
    await fs.promises.rename(oldPath, newPath);
    return newPath;
  } catch (error) {
    console.error('Error renaming file:', error);
    return null;
  }
});

ipcMain.handle('toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

ipcMain.handle('new-window', () => {
  createWindow();
});

const dragIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');

let currentDraggingPaths = [];

ipcMain.on('drag-start', (event, paths) => {
  try {
    const filePaths = Array.isArray(paths) ? paths : [paths];
    currentDraggingPaths = filePaths;
    event.sender.startDrag({
      files: filePaths,
      file: filePaths[0],
      icon: dragIcon
    });
  } catch (e) {
    console.error('Error starting drag', e);
  }
});

ipcMain.handle('get-dragging-paths', () => {
  return currentDraggingPaths;
});

ipcMain.handle('set-clipboard', (event, data) => {
  appClipboard = data;
  return true;
});

ipcMain.handle('get-clipboard', () => {
  return appClipboard;
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

ipcMain.on('update-visible-paths', (event, pathsArray) => {
  const winId = event.sender.id;
  windowVisiblePaths.set(winId, new Set(pathsArray));
  
  const allPaths = new Set();
  for (const paths of windowVisiblePaths.values()) {
    for (const p of paths) {
      allPaths.add(p);
    }
  }
  updateDirectoryWatchers(allPaths);
});
