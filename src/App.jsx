import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, File, ChevronRight, Pin, Plus, HardDrive, Home, Star, FileText, Eye, EyeOff, Search, Trash2, Scissors, ClipboardPaste, ExternalLink, X } from 'lucide-react';

function App() {
  const [config, setConfig] = useState(null);
  const [columns, setColumns] = useState([]); // Array of paths representing columns
  const [activePath, setActivePath] = useState(null); // The currently selected item across all columns
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [columnFilters, setColumnFilters] = useState({}); // dirPath -> filter string
  const [fileCache, setFileCache] = useState({}); // path -> file stats
  const [activeFileIcon, setActiveFileIcon] = useState(null);
  const [activeFilePreview, setActiveFilePreview] = useState(null);
  const [clipboard, setClipboard] = useState(null); // { paths: [...], action: 'copy' | 'cut' }
  const [contextMenu, setContextMenu] = useState(null);
  const [showOpenWith, setShowOpenWith] = useState(false);
  const [renamingPath, setRenamingPath] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const mainContentRef = useRef(null);

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null);
    window.addEventListener('click', closeContextMenu);
    
    const preventDefault = (e) => e.preventDefault();
    window.addEventListener('dragover', preventDefault, false);
    window.addEventListener('drop', preventDefault, false);
    
    return () => {
      window.removeEventListener('click', closeContextMenu);
      window.removeEventListener('dragover', preventDefault, false);
      window.removeEventListener('drop', preventDefault, false);
    };
  }, []);

  useEffect(() => {
    if (mainContentRef.current) {
      mainContentRef.current.scrollLeft = mainContentRef.current.scrollWidth;
    }
  }, [columns]);

  useEffect(() => {
    if (activePath && window.electronAPI) {
      window.electronAPI.getFileIcon(activePath).then(iconData => {
        setActiveFileIcon(iconData);
      });
      window.electronAPI.getFilePreview(activePath).then(previewData => {
        setActiveFilePreview(previewData);
      });
    } else {
      setActiveFileIcon(null);
      setActiveFilePreview(null);
    }
    setAddressInput(activePath || '');
  }, [activePath]);

  // Load initial config and home dir
  useEffect(() => {
    async function init() {
      if (window.electronAPI) {
        const conf = await window.electronAPI.getConfig();
        setConfig(conf);
        const home = await window.electronAPI.getHomeDir();
        setColumns([home]);
        setActivePath(home);
        setSelectedPaths([home]);
      }
    }
    init();
  }, []);

  // Clean up column filters when columns are closed
  useEffect(() => {
    setColumnFilters(prev => {
      const copy = { ...prev };
      let changed = false;
      for (const path of Object.keys(copy)) {
        if (!columns.includes(path)) {
          delete copy[path];
          changed = true;
        }
      }
      return changed ? copy : prev;
    });
  }, [columns]);

  // Keep Electron main process updated with visible paths for directory watching
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.updateVisiblePaths) {
      window.electronAPI.updateVisiblePaths(columns);
    }
  }, [columns]);

  // Listen for directory changes from the main process FS watchers to clear caches and update UI
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onDirectoryChanged) {
      const unsubscribe = window.electronAPI.onDirectoryChanged((dirPath) => {
        setFileCache(prev => {
          const copy = { ...prev };
          delete copy[dirPath];
          return copy;
        });
      });
      return unsubscribe;
    }
  }, []);

  // Save config wrapper
  const saveConfig = useCallback(async (newConfig) => {
    setConfig(newConfig);
    if (window.electronAPI) {
      await window.electronAPI.saveConfig(newConfig);
    }
  }, []);

  const handleSelect = (e, filePath, isDirectory, columnIndex, columnFiles) => {
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
    const isCmd = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;

    let newSelected = [];
    let newActive = filePath;
    let newAnchor = selectionAnchor;

    if (isCmd) {
      if (selectedPaths.includes(filePath)) {
        newSelected = selectedPaths.filter(p => p !== filePath);
        newActive = newSelected.length > 0 ? newSelected[newSelected.length - 1] : null;
      } else {
        const currentParent = selectedPaths.length > 0 ? selectedPaths[0].substring(0, selectedPaths[0].lastIndexOf('/')) : null;
        if (currentParent && currentParent !== parentDir) {
          newSelected = [filePath];
        } else {
          newSelected = [...selectedPaths, filePath];
        }
      }
      newAnchor = filePath;
    } else if (isShift) {
      const anchorParent = selectionAnchor ? selectionAnchor.substring(0, selectionAnchor.lastIndexOf('/')) : null;
      if (anchorParent === parentDir && selectionAnchor) {
        const filePaths = columnFiles.map(f => f.path);
        const idx1 = filePaths.indexOf(selectionAnchor);
        const idx2 = filePaths.indexOf(filePath);

        if (idx1 !== -1 && idx2 !== -1) {
          const start = Math.min(idx1, idx2);
          const end = Math.max(idx1, idx2);
          newSelected = filePaths.slice(start, end + 1);
        } else {
          newSelected = [filePath];
        }
      } else {
        newSelected = [filePath];
        newAnchor = filePath;
      }
    } else {
      newSelected = [filePath];
      newAnchor = filePath;
    }

    setSelectedPaths(newSelected);
    setActivePath(newActive);
    setSelectionAnchor(newAnchor);

    if (newSelected.length === 1 && isDirectory) {
      setColumns(prev => {
        const newCols = prev.slice(0, columnIndex + 1);
        newCols.push(filePath);
        return newCols;
      });
    } else {
      setColumns(prev => prev.slice(0, columnIndex + 1));
    }
  };

  const handleDoubleClick = async (filePath, isDirectory) => {
    if (!isDirectory && window.electronAPI) {
      await window.electronAPI.openFile(filePath);
    }
  };

  const refreshFolder = async (dirPath) => {
    if (window.electronAPI) {
      const contents = await window.electronAPI.getDirectoryContents(dirPath);
      setFileCache(prev => ({ ...prev, [dirPath]: contents }));
    }
  };

  const handleTrash = async () => {
    if (selectedPaths.length > 0 && window.electronAPI) {
      const promises = selectedPaths.map(p => window.electronAPI.trashFile(p));
      const results = await Promise.all(promises);
      if (results.some(Boolean)) {
        const parent = selectedPaths[0].substring(0, selectedPaths[0].lastIndexOf('/'));
        setSelectedPaths([]);
        setActivePath(parent);
        refreshFolder(parent);
      }
    }
  };

  const handleCopy = () => {
    if (selectedPaths.length > 0) {
      const clip = { paths: selectedPaths, action: 'copy' };
      setClipboard(clip);
      if (window.electronAPI) window.electronAPI.setClipboard(clip);
    }
  };

  const handleCut = () => {
    if (selectedPaths.length > 0) {
      const clip = { paths: selectedPaths, action: 'cut' };
      setClipboard(clip);
      if (window.electronAPI) window.electronAPI.setClipboard(clip);
    }
  };

  const handlePaste = async () => {
    const clip = window.electronAPI ? await window.electronAPI.getClipboard() : clipboard;
    const activeFolder = columns[columns.length - 1];
    if (clip && clip.paths && clip.paths.length > 0 && activeFolder && window.electronAPI) {
      let successCount = 0;
      const affectedParents = new Set([activeFolder]);
      for (const srcPath of clip.paths) {
        const fileName = srcPath.split('/').pop();
        const targetPath = activeFolder + '/' + fileName;
        let success = false;
        if (clip.action === 'copy') {
          success = await window.electronAPI.copyFile(srcPath, targetPath);
        } else {
          success = await window.electronAPI.moveFile(srcPath, targetPath);
        }
        if (success) {
          successCount++;
          const sourceParent = srcPath.substring(0, srcPath.lastIndexOf('/'));
          affectedParents.add(sourceParent);
        }
      }
      if (successCount > 0) {
        if (clip.action === 'cut') {
          setClipboard(null);
          window.electronAPI.setClipboard(null);
        }
        for (const parent of affectedParents) {
          await refreshFolder(parent);
        }
      }
    }
  };

  const handleContextMenu = async (e, file, columnIndex, columnFiles) => {
    e.preventDefault();
    if (!selectedPaths.includes(file.path)) {
      handleSelect(e, file.path, file.isDirectory, columnIndex, columnFiles);
    }

    const anchorBottom = e.clientY > window.innerHeight / 2;
    const anchorRight = e.clientX > window.innerWidth / 2;

    if (window.electronAPI) {
      const clip = await window.electronAPI.getClipboard();
      setClipboard(clip);
    }

    setContextMenu({ x: e.clientX, y: e.clientY, anchorBottom, anchorRight, path: file.path, isDirectory: file.isDirectory, apps: null });
    setShowOpenWith(false);
    
    if (!file.isDirectory && window.electronAPI) {
       const apps = await window.electronAPI.getOpenWithApps(file.path);
       setContextMenu(prev => prev ? { ...prev, apps } : null);
    }
  };

  const handleColumnContextMenu = (e, dirPath, columnIndex) => {
    e.preventDefault();
    setSelectedPaths([]);
    setActivePath(dirPath);
    setSelectionAnchor(null);

    const anchorBottom = e.clientY > window.innerHeight / 2;
    const anchorRight = e.clientX > window.innerWidth / 2;

    if (window.electronAPI) {
      window.electronAPI.getClipboard().then(clip => setClipboard(clip));
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      anchorBottom,
      anchorRight,
      path: dirPath,
      isColumn: true,
      columnIndex
    });
  };

  const handleCreateFolder = async (dirPath) => {
    if (window.electronAPI) {
      const contents = fileCache[dirPath] || await window.electronAPI.getDirectoryContents(dirPath);
      let folderName = 'untitled folder';
      let counter = 2;
      while (contents.some(f => f.name.toLowerCase() === folderName.toLowerCase())) {
        folderName = `untitled folder ${counter}`;
        counter++;
      }
      const newFolderPath = `${dirPath}/${folderName}`;
      const success = await window.electronAPI.createDirectory(newFolderPath);
      if (success) {
        await refreshFolder(dirPath);
        setRenamingPath(newFolderPath);
        setRenameValue(folderName);
        setSelectedPaths([newFolderPath]);
        setActivePath(newFolderPath);
      }
    }
  };

  const handleOpenSelected = async () => {
    if (window.electronAPI) {
      for (const p of selectedPaths) {
        const parent = p.substring(0, p.lastIndexOf('/'));
        const contents = fileCache[parent] || [];
        const item = contents.find(f => f.path === p);
        if (item && !item.isDirectory) {
          await window.electronAPI.openFile(p);
        }
      }
    }
  };

  const handleGetInfoSelected = () => {
    if (window.electronAPI) {
      selectedPaths.forEach(p => window.electronAPI.showGetInfo(p));
    }
  };

  const handleRenameSubmit = async () => {
    if (renamingPath && renameValue) {
      const newPath = await window.electronAPI.renameFile(renamingPath, renameValue);
      if (newPath) {
        setFileCache({});
        setSelectedPaths([newPath]);
        setActivePath(newPath);
      }
    }
    setRenamingPath(null);
  };

  const toggleFavorite = (itemPath, itemName) => {
    const isFav = config.sidebar.some(f => f.path === itemPath);
    let newSidebar;
    if (isFav) {
       newSidebar = config.sidebar.filter(f => f.path !== itemPath);
    } else {
       newSidebar = [...config.sidebar, { name: itemName, path: itemPath }];
    }
    saveConfig({ ...config, sidebar: newSidebar });
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        window.electronAPI.newWindow();
        return;
      }

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        const targetDir = columns[columns.length - 1];
        if (targetDir) handleCreateFolder(targetDir);
        return;
      }

      if (e.key === 'Escape') {
        const activeDir = columns[columns.length - 1];
        if (activeDir && columnFilters[activeDir]) {
          e.preventDefault();
          setColumnFilters(prev => {
            const copy = { ...prev };
            delete copy[activeDir];
            return copy;
          });
          return;
        }
      }

      if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const activeDir = columns[columns.length - 1];
        if (activeDir && columnFilters[activeDir]) {
          e.preventDefault();
          setColumnFilters(prev => {
            const current = prev[activeDir] || '';
            const next = current.slice(0, -1);
            const copy = { ...prev };
            if (next) {
              copy[activeDir] = next;
            } else {
              delete copy[activeDir];
            }
            return copy;
          });
          return;
        }
      }

      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const activeDir = columns[columns.length - 1];
        if (activeDir) {
          setColumnFilters(prev => {
            const current = prev[activeDir] || '';
            return { ...prev, [activeDir]: current + e.key };
          });
        }
        return;
      }
      
      if (selectedPaths.length === 0) return;
      
      if ((e.metaKey || e.ctrlKey) && e.key === 'Backspace') {
        e.preventDefault();
        handleTrash();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault();
        handleCopy();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'x') {
        e.preventDefault();
        handleCut();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        e.preventDefault();
        handlePaste();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPaths, clipboard, columns, fileCache, columnFilters]);

  if (!config) return <div>Loading...</div>;

  const activeFolder = columns[columns.length - 1]; // The rightmost open folder
  const activeItemSettings = config.folderSettings[activePath] || { sortRule: 'name', notes: '', pinned: [] };

  const updateActiveItemSettings = (newSettings) => {
    saveConfig({
      ...config,
      folderSettings: {
        ...config.folderSettings,
        [activePath]: {
          ...activeItemSettings,
          ...newSettings
        }
      }
    });
  };

  const handleAddressSubmit = async (e) => {
    e.preventDefault();
    if (!addressInput) return;
    
    if (window.electronAPI && window.electronAPI.checkPath) {
      const info = await window.electronAPI.checkPath(addressInput);
      if (info.exists) {
        if (info.isDirectory) {
          setColumns([addressInput]);
          setActivePath(addressInput);
          setSelectedPaths([addressInput]);
        } else {
          // If it's a file, open the parent directory and select the file
          const parent = addressInput.substring(0, addressInput.lastIndexOf('/')) || '/';
          setColumns([parent]);
          setActivePath(addressInput);
          setSelectedPaths([addressInput]);
        }
      } else {
        // Revert to current path if invalid
        setAddressInput(activePath || '');
      }
    }
  };

  const multiStats = { fileCount: 0, folderCount: 0, totalSize: 0 };
  if (selectedPaths.length > 1) {
    selectedPaths.forEach(path => {
      const parent = path.substring(0, path.lastIndexOf('/'));
      const contents = fileCache[parent] || [];
      const item = contents.find(f => f.path === path);
      if (item) {
        if (item.isDirectory) {
          multiStats.folderCount++;
        } else {
          multiStats.fileCount++;
          multiStats.totalSize += item.size || 0;
        }
      }
    });
  }

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="app-container">
      <div className="title-bar-drag-area" onDoubleClick={() => window.electronAPI && window.electronAPI.toggleMaximize && window.electronAPI.toggleMaximize()} />
      {/* Sidebar */}
      <div 
        className="sidebar"
        onDragEnter={(e) => e.preventDefault()}
        onDragOver={(e) => e.preventDefault()}
        onDoubleClick={() => window.electronAPI && window.electronAPI.toggleMaximize && window.electronAPI.toggleMaximize()}
        onDrop={async (e) => {
          e.preventDefault();
          let paths = [];
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            paths = Array.from(e.dataTransfer.files).map(f => f.path).filter(Boolean);
          }
          if (paths.length === 0 && window.electronAPI) {
            paths = await window.electronAPI.getDraggingPaths();
          }
          
          if (paths.length > 0) {
            let newSidebar = [...config.sidebar];
            let changed = false;
            for (const droppedPath of paths) {
              if (droppedPath) {
                const itemName = droppedPath.split('/').pop();
                if (!newSidebar.some(s => s.path === droppedPath)) {
                  newSidebar.push({ name: itemName, path: droppedPath });
                  changed = true;
                }
              }
            }
            if (changed) {
              saveConfig({ ...config, sidebar: newSidebar });
            }
          }
        }}
      >
        <div className="sidebar-title" style={{ WebkitAppRegion: 'drag' }}>Favorites</div>
        {config.sidebar.map((item, idx) => (
          <div 
            key={idx} 
            className={`sidebar-item ${columns[0] === item.path ? 'active' : ''}`}
            onClick={() => {
              setColumns([item.path]);
              setActivePath(item.path);
              setSelectedPaths([item.path]);
            }}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <Star size={16} />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
            </div>
            <div 
               style={{ padding: '4px', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', opacity: 0.6 }}
               onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(item.path, item.name);
               }}
               onMouseEnter={e => { e.currentTarget.style.background = 'var(--item-hover)'; e.currentTarget.style.opacity = 1; }}
               onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = 0.6; }}
               title="Remove from Favorites"
            >
               <X size={14} />
            </div>
          </div>
        ))}
        
        <div style={{ marginTop: 'auto', padding: '1rem' }}>
          <div 
            className="sidebar-item" 
            onClick={() => window.electronAPI && window.electronAPI.newWindow()}
            style={{ marginBottom: '0.5rem' }}
          >
            <ExternalLink size={16} />
            <span style={{ marginLeft: '0.75rem' }}>New Window</span>
          </div>
          <div 
            className="sidebar-item" 
            onClick={() => saveConfig({ ...config, showHidden: !config.showHidden })}
          >
            {config.showHidden ? <Eye size={16} /> : <EyeOff size={16} />}
            <span style={{ marginLeft: '0.75rem' }}>{config.showHidden ? 'Hide Hidden Files' : 'Show Hidden Files'}</span>
          </div>
        </div>
      </div>

      {/* Middle Area Wrapper */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--border-color)' }}>
        {/* Breadcrumb Top Bar */}
        <div 
          onDoubleClick={() => window.electronAPI && window.electronAPI.toggleMaximize && window.electronAPI.toggleMaximize()}
          style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', background: 'var(--sidebar-bg)', whiteSpace: 'nowrap', overflowX: 'auto', fontSize: '0.85rem', color: 'var(--text-muted)', WebkitAppRegion: 'drag' }}
        >
          <form onSubmit={handleAddressSubmit} style={{ margin: 0, padding: 0, display: 'flex', WebkitAppRegion: 'no-drag' }}>
            <input 
              type="text" 
              value={addressInput} 
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="Enter path here..."
              style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-main)', outline: 'none', width: '100%', fontSize: '0.85rem' }}
            />
          </form>
        </div>
        
        {/* Main Miller Columns Area */}
        <div className="main-content" ref={mainContentRef} style={{ flex: 1, display: 'flex', overflowX: 'auto', background: 'var(--bg-color)' }}>
          {columns.map((dirPath, index) => (
          <Column 
            key={dirPath}
            dirPath={dirPath}
            columnIndex={index}
            selectedPaths={selectedPaths}
            quickFilter={columnFilters[dirPath] || ''}
            onSelect={handleSelect}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
            onColumnContextMenu={handleColumnContextMenu}
            onCreateFolder={handleCreateFolder}
            config={config}
            saveConfig={saveConfig}
            fileCache={fileCache}
            setFileCache={setFileCache}
            renamingPath={renamingPath}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            handleRenameSubmit={handleRenameSubmit}
            setRenamingPath={setRenamingPath}
          />
        ))}
        </div>
      </div>

      {/* Right Info / Notes Panel */}
      <div className="info-panel" style={{ borderLeft: 'none' }}>
        {selectedPaths.length > 1 ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem', minHeight: '100px', alignItems: 'center' }}>
              <div style={{ display: 'flex', position: 'relative' }}>
                <FileText size={64} color="var(--text-muted)" style={{ position: 'absolute', left: '-15px', top: '-10px', opacity: 0.5 }} />
                <FileText size={64} color="var(--text-muted)" style={{ position: 'absolute', left: '-5px', top: '-5px', opacity: 0.75 }} />
                <FileText size={64} color="var(--accent)" style={{ position: 'relative', zIndex: 1 }} />
              </div>
            </div>
            <div className="info-title" style={{ wordBreak: 'break-all', textAlign: 'center' }}>
              {selectedPaths.length} items selected
            </div>
            <div className="info-meta" style={{ textAlign: 'center', marginTop: '0.5rem' }}>
              {multiStats.folderCount > 0 && multiStats.fileCount > 0 ? (
                `${multiStats.folderCount} folders, ${multiStats.fileCount} files`
              ) : multiStats.folderCount > 0 ? (
                `${multiStats.folderCount} folders`
              ) : (
                `${multiStats.fileCount} files`
              )}
            </div>
            {multiStats.fileCount > 0 && (
              <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', textAlign: 'center', marginTop: '0.5rem', fontWeight: 500 }}>
                Total size: {formatSize(multiStats.totalSize)}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem', minHeight: '100px', alignItems: 'center' }}>
              {activeFileIcon ? (
                <img src={activeFileIcon} alt="Icon" style={{ maxWidth: '100px', maxHeight: '100px' }} />
              ) : (
                <FileText size={64} color="var(--text-muted)" />
              )}
            </div>
            <div className="info-title" style={{ wordBreak: 'break-all' }}>
              {activePath ? activePath.split('/').pop() || '/' : 'Select an item'}
            </div>
            <div className="info-meta">
              {activeFolder === activePath ? 'Directory' : 'File'}
            </div>
            
            {/* Text Preview for files */}
            {activeFilePreview && activeFolder !== activePath && (
              <div className="info-notes" style={{ marginBottom: '1.5rem' }}>
                <label>File Preview</label>
                <div style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.75rem', fontSize: '0.8rem', color: 'var(--text-main)', overflowY: 'auto', maxHeight: '400px', overflowX: 'hidden' }}>
                  {activeFilePreview.type === 'text' && (
                    <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                      {activeFilePreview.content}
                    </div>
                  )}
                  {activeFilePreview.type === 'pdf' && (
                    <iframe src={activeFilePreview.src} style={{ width: '100%', height: '350px', border: 'none' }} title="PDF Preview" />
                  )}
                  {activeFilePreview.type === 'image' && (
                    <img src={activeFilePreview.src} style={{ width: '100%', height: 'auto', display: 'block' }} alt="Preview" />
                  )}
                  {activeFilePreview.type === 'video' && (
                    <video src={activeFilePreview.src} controls style={{ width: '100%', height: 'auto', display: 'block' }} />
                  )}
                  {activeFilePreview.type === 'audio' && (
                    <audio src={activeFilePreview.src} controls style={{ width: '100%', display: 'block' }} />
                  )}
                </div>
              </div>
            )}
            
            {/* Notes section for files and folders */}
            <div className="info-notes">
              <label>{activeFolder === activePath ? 'Folder Notes' : 'File Notes'}</label>
              <textarea 
                value={activeItemSettings.notes || ''} 
                onChange={(e) => updateActiveItemSettings({ notes: e.target.value })}
                placeholder={`Add notes for this ${activeFolder === activePath ? 'folder' : 'file'}...`}
              />
            </div>
          </>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div style={{ 
          position: 'fixed', 
          ...(contextMenu.anchorBottom ? { bottom: window.innerHeight - contextMenu.y } : { top: contextMenu.y }),
          ...(contextMenu.anchorRight ? { right: window.innerWidth - contextMenu.x } : { left: contextMenu.x }),
          background: 'var(--bg-color)', border: '1px solid var(--border-color)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', borderRadius: '6px', zIndex: 1000, padding: '0.25rem 0', minWidth: '150px' 
        }}>
          {contextMenu.isColumn ? (
            <>
              <div 
                style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} 
                onClick={() => { handleCreateFolder(contextMenu.path); setContextMenu(null); }}
                onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }}
                onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}
              >
                New Folder
              </div>
              <div style={{ borderBottom: '1px solid var(--border-color)', margin: '0.25rem 0' }}></div>
              <div 
                style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem', color: clipboard ? 'var(--text-main)' : 'var(--text-muted)' }} 
                onClick={() => { handlePaste(); setContextMenu(null); }}
                onMouseEnter={(e) => { if(clipboard){ e.target.style.background='var(--accent)'; e.target.style.color='white'; } }}
                onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color=clipboard ? 'var(--text-main)' : 'var(--text-muted)'; }}
              >
                Paste
              </div>
            </>
          ) : (
            <>
              <div 
                style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} 
                onClick={() => { handleOpenSelected(); setContextMenu(null); }} 
                onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }} 
                onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}
              >
                Open
              </div>
              {selectedPaths.length <= 1 && !contextMenu.isDirectory && (
                <div 
                   style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem', position: 'relative' }} 
                   onMouseEnter={(e) => { e.currentTarget.style.background='var(--accent)'; e.currentTarget.style.color='white'; setShowOpenWith(true); }} 
                   onMouseLeave={(e) => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--text-main)'; setShowOpenWith(false); }}
                >
                  Open With...
                  {showOpenWith && (
                    <div style={{ position: 'absolute', left: '100%', top: '-0.25rem', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '6px', minWidth: '160px', color: 'var(--text-main)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', padding: '0.25rem 0', maxHeight: '300px', overflowY: 'auto' }}>
                      {contextMenu.apps === null ? (
                        <div style={{ padding: '0.5rem 1rem', color: 'var(--text-muted)' }}>Loading...</div>
                      ) : contextMenu.apps.length > 0 ? contextMenu.apps.map(app => (
                        <div key={app.path} style={{ padding: '0.5rem 1rem', cursor: 'pointer', whiteSpace: 'nowrap' }} 
                             onClick={() => window.electronAPI.openWith(contextMenu.path, app.path)}
                             onMouseEnter={e => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }}
                             onMouseLeave={e => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}
                        >
                          {app.name}
                        </div>
                      )) : (
                        <div style={{ padding: '0.5rem 1rem', color: 'var(--text-muted)' }}>No default app</div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div style={{ borderBottom: '1px solid var(--border-color)', margin: '0.25rem 0' }}></div>
              <div 
                style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} 
                onClick={() => { handleGetInfoSelected(); setContextMenu(null); }} 
                onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }} 
                onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}
              >
                Get Info
              </div>
              {selectedPaths.length <= 1 && (
                <div 
                  style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} 
                  onClick={() => { setRenamingPath(contextMenu.path); setRenameValue(contextMenu.path.split('/').pop()); setContextMenu(null); }} 
                  onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }} 
                  onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}
                >
                  Rename
                </div>
              )}
              <div style={{ borderBottom: '1px solid var(--border-color)', margin: '0.25rem 0' }}></div>
              <div 
                style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} 
                onClick={() => { selectedPaths.forEach(p => window.electronAPI.showItemInFolder(p)); setContextMenu(null); }} 
                onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }} 
                onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}
              >
                Reveal in Finder
              </div>
              {selectedPaths.length <= 1 && (
                <>
                  <div style={{ borderBottom: '1px solid var(--border-color)', margin: '0.25rem 0' }}></div>
                  <div 
                    style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} 
                    onClick={() => toggleFavorite(contextMenu.path, contextMenu.path.split('/').pop())} 
                    onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }} 
                    onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}
                  >
                    {config.sidebar.some(f => f.path === contextMenu.path) ? 'Remove from Favorites' : 'Add to Favorites'}
                  </div>
                </>
              )}
              <div style={{ borderBottom: '1px solid var(--border-color)', margin: '0.25rem 0' }}></div>
              <div 
                style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} 
                onClick={() => { handleCopy(); setContextMenu(null); }} 
                onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }} 
                onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}
              >
                Copy
              </div>
              <div 
                style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} 
                onClick={() => { handleCut(); setContextMenu(null); }} 
                onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }} 
                onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}
              >
                Cut
              </div>
              <div 
                style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem', color: clipboard ? 'var(--text-main)' : 'var(--text-muted)' }} 
                onClick={() => { handlePaste(); setContextMenu(null); }} 
                onMouseEnter={(e) => { if(clipboard){ e.target.style.background='var(--accent)'; e.target.style.color='white'; } }} 
                onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color=clipboard ? 'var(--text-main)' : 'var(--text-muted)'; }}
              >
                Paste Here
              </div>
              <div style={{ borderBottom: '1px solid var(--border-color)', margin: '0.25rem 0' }}></div>
              <div 
                style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem', color: '#dc2626' }} 
                onClick={() => { handleTrash(); setContextMenu(null); }} 
                onMouseEnter={(e) => { e.target.style.background='#fee2e2'; }} 
                onMouseLeave={(e) => { e.target.style.background='transparent'; }}
              >
                Delete
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Column({ 
  dirPath, 
  columnIndex, 
  config, 
  selectedPaths, 
  quickFilter,
  onSelect, 
  onDoubleClick, 
  onContextMenu, 
  onColumnContextMenu,
  onCreateFolder,
  saveConfig, 
  fileCache, 
  setFileCache, 
  renamingPath, 
  renameValue, 
  setRenameValue, 
  handleRenameSubmit, 
  setRenamingPath 
}) {
  const [files, setFiles] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const folderSettings = config.folderSettings[dirPath] || { sortRule: 'name', pinned: [] };
  const sortRule = folderSettings.sortRule || 'name';
  const pinned = folderSettings.pinned || [];

  useEffect(() => {
    let active = true;
    async function fetchDir() {
      if (searchQuery && window.electronAPI) {
        setLoading(true);
        try {
          const results = await window.electronAPI.searchDirectory(dirPath, searchQuery);
          if (active) {
            setSearchResults(results);
            setLoading(false);
          }
        } catch (e) {
          if (active) setLoading(false);
        }
      } else {
        setSearchResults(null);
        if (fileCache[dirPath]) {
          setFiles(fileCache[dirPath]);
          setLoading(false);
        } else if (window.electronAPI) {
          setLoading(true);
          try {
            const contents = await window.electronAPI.getDirectoryContents(dirPath);
            if (active) {
              setFiles(contents);
              setFileCache(prev => ({ ...prev, [dirPath]: contents }));
            }
          } catch (e) {
            console.error(e);
          } finally {
            if (active) setLoading(false);
          }
        }
      }
    }
    fetchDir();
    return () => { active = false; };
  }, [dirPath, fileCache, setFileCache, searchQuery]);

  const updateSortRule = (e) => {
    saveConfig({
      ...config,
      folderSettings: {
        ...config.folderSettings,
        [dirPath]: {
          ...folderSettings,
          sortRule: e.target.value
        }
      }
    });
  };

  const togglePin = (e, filePath) => {
    e.stopPropagation();
    const newPinned = pinned.includes(filePath) 
      ? pinned.filter(p => p !== filePath)
      : [...pinned, filePath];
      
    saveConfig({
      ...config,
      folderSettings: {
        ...config.folderSettings,
        [dirPath]: {
          ...folderSettings,
          pinned: newPinned
        }
      }
    });
  };

  const activeFiles = searchResults || files;

  const filteredFiles = activeFiles.filter(file => {
    if (!config.showHidden && file.name.startsWith('.')) return false;
    
    if (searchQuery && !searchResults) {
      const query = searchQuery.toLowerCase();
      const matchesName = file.name.toLowerCase().includes(query);
      const matchesKind = (file.extension || '').toLowerCase().includes(query);
      if (!matchesName && !matchesKind) return false;
    }

    if (quickFilter) {
      const q = quickFilter.toLowerCase();
      const matchesName = file.name.toLowerCase().includes(q);
      if (!matchesName) return false;
    }

    return true;
  });

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    const aPinned = pinned.includes(a.path);
    const bPinned = pinned.includes(b.path);
    
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    if (sortRule === 'name') return a.name.localeCompare(b.name);
    if (sortRule === 'kind') {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return (a.extension || '').localeCompare(b.extension || '');
    }
    if (sortRule === 'date') return b.created - a.created;
    return 0;
  });

  return (
    <div className="column">
      <div className="column-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{sortedFiles.length} items</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={() => onCreateFolder(dirPath)}
            title="New Folder"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
              borderRadius: '4px'
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            <Plus size={16} />
          </button>
          <select value={sortRule} onChange={updateSortRule} style={{ fontSize: '0.8rem', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-main)', padding: '2px 4px', cursor: 'pointer' }}>
            <option value="name">Name</option>
            <option value="kind">Kind</option>
            <option value="date">Date Created</option>
          </select>
        </div>
      </div>
      <div className="column-search" style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center' }}>
        <Search size={14} style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }} />
        <input 
          type="text" 
          placeholder="Search name, kind..." 
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-main)', width: '100%', fontSize: '0.85rem' }}
        />
      </div>
      {quickFilter && (
        <div style={{
          padding: '6px 12px',
          background: 'var(--item-active)',
          borderBottom: '1px solid var(--border-color)',
          fontSize: '0.8rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--accent)',
          fontWeight: 500
        }}>
          <span>Filter: "{quickFilter}"</span>
          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Press Esc to clear</span>
        </div>
      )}
      <div 
        className="column-content"
        onContextMenu={(e) => {
          if (!e.target.closest('.file-item')) {
            onColumnContextMenu(e, dirPath, columnIndex);
          }
        }}
        onDragEnter={(e) => e.preventDefault()}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={async (e) => {
          e.preventDefault();
          if (window.electronAPI) {
            let paths = [];
            let isExternal = false;
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              paths = Array.from(e.dataTransfer.files).map(f => f.path).filter(Boolean);
              isExternal = true;
            }
            if (paths.length === 0) {
              paths = await window.electronAPI.getDraggingPaths();
              isExternal = false;
            }

            if (paths.length > 0) {
              let changed = false;
              for (const droppedPath of paths) {
                if (!droppedPath) continue;
                const sourceParent = droppedPath.substring(0, droppedPath.lastIndexOf('/'));
                if (sourceParent !== dirPath || isExternal) {
                  const fileName = droppedPath.split('/').pop();
                  let target = dirPath + '/' + fileName;
                  if (droppedPath === target) continue;
                  
                  let success = false;
                  if (isExternal) {
                    success = await window.electronAPI.copyFile(droppedPath, target);
                  } else {
                    success = await window.electronAPI.moveFile(droppedPath, target);
                  }
                  if (success) changed = true;
                }
              }
              if (changed) {
                const contents = await window.electronAPI.getDirectoryContents(dirPath);
                setFileCache(prev => ({ ...prev, [dirPath]: contents }));
              }
            }
          }
        }}
      >
        {loading ? (
          <div style={{ padding: '1rem', color: 'var(--text-muted)' }}>Loading...</div>
        ) : (
          sortedFiles.map(file => (
            <div 
              key={file.path} 
              className={`file-item ${selectedPaths.includes(file.path) ? 'active' : ''}`}
              onClick={(e) => onSelect(e, file.path, file.isDirectory, columnIndex, sortedFiles)}
              onDoubleClick={() => onDoubleClick(file.path, file.isDirectory)}
              onContextMenu={(e) => onContextMenu(e, file, columnIndex, sortedFiles)}
              draggable={true}
              onDragStart={(e) => {
                e.preventDefault();
                if (window.electronAPI) {
                  const pathsToDrag = selectedPaths.includes(file.path) ? selectedPaths : [file.path];
                  window.electronAPI.startDrag(pathsToDrag);
                }
              }}
              onDragEnter={(e) => e.preventDefault()}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={async (e) => {
                if (file.isDirectory) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (window.electronAPI) {
                    let paths = [];
                    let isExternal = false;
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      paths = Array.from(e.dataTransfer.files).map(f => f.path).filter(Boolean);
                      isExternal = true;
                    }
                    if (paths.length === 0) {
                      paths = await window.electronAPI.getDraggingPaths();
                      isExternal = false;
                    }
                    if (paths.length > 0) {
                      let changed = false;
                      for (const droppedPath of paths) {
                        if (!droppedPath) continue;
                        const sourceParent = droppedPath.substring(0, droppedPath.lastIndexOf('/'));
                        if (sourceParent !== file.path && droppedPath !== file.path) {
                          const fileName = droppedPath.split('/').pop();
                          const target = file.path + '/' + fileName;
                          if (droppedPath === target) continue;

                          let success = false;
                          if (isExternal) {
                            success = await window.electronAPI.copyFile(droppedPath, target);
                          } else {
                            success = await window.electronAPI.moveFile(droppedPath, target);
                          }
                          if (success) {
                            setFileCache(prev => {
                              const newCache = { ...prev };
                              delete newCache[file.path]; // invalidate cache of the target directory
                              return newCache;
                            });
                            changed = true;
                          }
                        }
                      }
                      if (changed) {
                        const contents = await window.electronAPI.getDirectoryContents(dirPath);
                        setFileCache(prev => ({ ...prev, [dirPath]: contents }));
                      }
                    }
                  }
                }
              }}
            >
              <div className="file-icon">
                {file.isDirectory ? <Folder size={18} fill={selectedPaths.includes(file.path) ? "white" : "var(--accent)"} /> : <FileText size={18} />}
              </div>
              <div className="file-name" style={{ flex: 1, minWidth: 0 }}>
                {renamingPath === file.path ? (
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameSubmit();
                      if (e.key === 'Escape') setRenamingPath(null);
                    }}
                    onBlur={handleRenameSubmit}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%',
                      background: 'var(--bg-color)',
                      color: 'var(--text-main)',
                      border: '1px solid var(--accent)',
                      borderRadius: '4px',
                      padding: '2px 4px',
                      outline: 'none'
                    }}
                  />
                ) : (
                  <>
                    {file.name}
                    {searchResults && file.parentPath && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px', wordBreak: 'break-all' }}>
                        {file.parentPath.replace(dirPath, '') || '/'}
                      </div>
                    )}
                  </>
                )}
              </div>
              
              <div 
                className={`pin-icon ${pinned.includes(file.path) ? 'pinned' : ''}`}
                onClick={(e) => togglePin(e, file.path)}
              >
                <Pin size={14} fill={pinned.includes(file.path) ? "currentColor" : "none"} />
              </div>

              {file.isDirectory && (
                <div className="file-arrow">
                  <ChevronRight size={16} />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;
