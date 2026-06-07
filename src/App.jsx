import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, File, ChevronRight, Pin, Plus, HardDrive, Home, Star, FileText, Eye, EyeOff, Search, Trash2, Scissors, ClipboardPaste, ExternalLink, X } from 'lucide-react';

function App() {
  const [config, setConfig] = useState(null);
  const [columns, setColumns] = useState([]); // Array of paths representing columns
  const [activePath, setActivePath] = useState(null); // The currently selected item across all columns
  const [fileCache, setFileCache] = useState({}); // path -> file stats
  const [activeFileIcon, setActiveFileIcon] = useState(null);
  const [activeFilePreview, setActiveFilePreview] = useState(null);
  const [clipboard, setClipboard] = useState(null); // { path: '...', action: 'copy' | 'cut' }
  const [contextMenu, setContextMenu] = useState(null);
  const [showOpenWith, setShowOpenWith] = useState(false);
  const mainContentRef = useRef(null);

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null);
    window.addEventListener('click', closeContextMenu);
    return () => window.removeEventListener('click', closeContextMenu);
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
      }
    }
    init();
  }, []);

  // Save config wrapper
  const saveConfig = useCallback(async (newConfig) => {
    setConfig(newConfig);
    if (window.electronAPI) {
      await window.electronAPI.saveConfig(newConfig);
    }
  }, []);

  const handleSelect = (filePath, isDirectory, columnIndex) => {
    setActivePath(filePath);
    
    // If it's a directory, open it in the next column
    if (isDirectory) {
      setColumns(prev => {
        const newCols = prev.slice(0, columnIndex + 1);
        newCols.push(filePath);
        return newCols;
      });
    } else {
      // If it's a file, just truncate the columns to this point
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
    if (activePath && window.electronAPI) {
      const success = await window.electronAPI.trashFile(activePath);
      if (success) {
        const parent = activePath.substring(0, activePath.lastIndexOf('/'));
        setActivePath(parent);
        refreshFolder(parent);
      }
    }
  };

  const handleCopy = () => {
    if (activePath) setClipboard({ path: activePath, action: 'copy' });
  };

  const handleCut = () => {
    if (activePath) setClipboard({ path: activePath, action: 'cut' });
  };

  const handlePaste = async () => {
    const activeFolder = columns[columns.length - 1];
    if (clipboard && activeFolder && window.electronAPI) {
      const fileName = clipboard.path.split('/').pop();
      const targetPath = activeFolder + '/' + fileName;
      let success = false;
      if (clipboard.action === 'copy') {
        success = await window.electronAPI.copyFile(clipboard.path, targetPath);
      } else {
        success = await window.electronAPI.moveFile(clipboard.path, targetPath);
      }
      
      if (success) {
        if (clipboard.action === 'cut') setClipboard(null);
        refreshFolder(activeFolder);
        const sourceParent = clipboard.path.substring(0, clipboard.path.lastIndexOf('/'));
        if (sourceParent !== activeFolder) refreshFolder(sourceParent);
      }
    }
  };

  const handleContextMenu = async (e, file, columnIndex) => {
    e.preventDefault();
    handleSelect(file.path, file.isDirectory, columnIndex);
    setContextMenu({ x: e.clientX, y: e.clientY, path: file.path, isDirectory: file.isDirectory, apps: null });
    setShowOpenWith(false);
    
    if (!file.isDirectory && window.electronAPI) {
       const apps = await window.electronAPI.getOpenWithApps(file.path);
       setContextMenu(prev => prev ? { ...prev, apps } : null);
    }
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
      if (!activePath) return;
      
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
  }, [activePath, clipboard, columns]);

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

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div 
        className="sidebar"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const droppedPath = e.dataTransfer.files[0]?.path;
          if (droppedPath) {
             const itemName = droppedPath.split('/').pop();
             if (!config.sidebar.some(f => f.path === droppedPath)) {
               saveConfig({ ...config, sidebar: [...config.sidebar, { name: itemName, path: droppedPath }] });
             }
          }
        }}
      >
        <div className="sidebar-title">Favorites</div>
        {config.sidebar.map((item, idx) => (
          <div 
            key={idx} 
            className={`sidebar-item ${columns[0] === item.path ? 'active' : ''}`}
            onClick={() => {
              setColumns([item.path]);
              setActivePath(item.path);
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
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', background: 'var(--sidebar-bg)', whiteSpace: 'nowrap', overflowX: 'auto', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {activePath || 'No path selected'}
        </div>
        
        {/* Main Miller Columns Area */}
        <div className="main-content" ref={mainContentRef} style={{ flex: 1, display: 'flex', overflowX: 'auto', background: 'var(--bg-color)' }}>
          {columns.map((dirPath, idx) => (
            <Column 
              key={dirPath}
              dirPath={dirPath}
              columnIndex={idx}
              config={config}
              activePath={activePath}
              onSelect={handleSelect}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              saveConfig={saveConfig}
              fileCache={fileCache}
              setFileCache={setFileCache}
            />
          ))}
        </div>
      </div>

      {/* Right Info / Notes Panel */}
      <div className="info-panel" style={{ borderLeft: 'none' }}>
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
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, background: 'var(--bg-color)', border: '1px solid var(--border-color)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', borderRadius: '6px', zIndex: 1000, padding: '0.25rem 0', minWidth: '150px' }}>
          <div style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => handleDoubleClick(contextMenu.path, contextMenu.isDirectory)} onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }} onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}>Open</div>
          {!contextMenu.isDirectory && (
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
          <div style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => window.electronAPI.showItemInFolder(contextMenu.path)} onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }} onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}>Reveal in Finder</div>
          <div style={{ borderBottom: '1px solid var(--border-color)', margin: '0.25rem 0' }}></div>
          <div style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => toggleFavorite(contextMenu.path, contextMenu.path.split('/').pop())} onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }} onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}>
            {config.sidebar.some(f => f.path === contextMenu.path) ? 'Remove from Favorites' : 'Add to Favorites'}
          </div>
          <div style={{ borderBottom: '1px solid var(--border-color)', margin: '0.25rem 0' }}></div>
          <div style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => setClipboard({ path: contextMenu.path, action: 'copy' })} onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }} onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}>Copy</div>
          <div style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => setClipboard({ path: contextMenu.path, action: 'cut' })} onMouseEnter={(e) => { e.target.style.background='var(--accent)'; e.target.style.color='white'; }} onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color='var(--text-main)'; }}>Cut</div>
          <div style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem', color: clipboard ? 'var(--text-main)' : 'var(--text-muted)' }} onClick={handlePaste} onMouseEnter={(e) => { if(clipboard){ e.target.style.background='var(--accent)'; e.target.style.color='white'; } }} onMouseLeave={(e) => { e.target.style.background='transparent'; e.target.style.color=clipboard ? 'var(--text-main)' : 'var(--text-muted)'; }}>Paste Here</div>
          <div style={{ borderBottom: '1px solid var(--border-color)', margin: '0.25rem 0' }}></div>
          <div style={{ padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem', color: '#dc2626' }} onClick={handleTrash} onMouseEnter={(e) => { e.target.style.background='#fee2e2'; }} onMouseLeave={(e) => { e.target.style.background='transparent'; }}>Delete</div>
        </div>
      )}
    </div>
  );
}

function Column({ dirPath, columnIndex, config, activePath, onSelect, onDoubleClick, onContextMenu, saveConfig, fileCache, setFileCache }) {
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
    // If not doing a recursive search, we filter locally just in case
    if (searchQuery && !searchResults) {
      const query = searchQuery.toLowerCase();
      const matchesName = file.name.toLowerCase().includes(query);
      const matchesKind = (file.extension || '').toLowerCase().includes(query);
      return matchesName || matchesKind;
    }
    return true;
  });

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    const aPinned = pinned.includes(a.path);
    const bPinned = pinned.includes(b.path);
    
    // Pinned items always on top
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    // Then sort by rule
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
      <div className="column-header">
        <span>{sortedFiles.length} items</span>
        <select value={sortRule} onChange={updateSortRule}>
          <option value="name">Name</option>
          <option value="kind">Kind</option>
          <option value="date">Date Created</option>
        </select>
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
      <div 
        className="column-content"
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          const droppedPath = e.dataTransfer.files[0]?.path;
          if (droppedPath && !droppedPath.startsWith(dirPath + '/') && window.electronAPI) {
             const fileName = droppedPath.split('/').pop();
             const target = dirPath + '/' + fileName;
             const success = await window.electronAPI.moveFile(droppedPath, target);
             if (success) {
               const contents = await window.electronAPI.getDirectoryContents(dirPath);
               setFileCache(prev => ({ ...prev, [dirPath]: contents }));
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
              className={`file-item ${activePath === file.path ? 'active' : ''}`}
              onClick={() => onSelect(file.path, file.isDirectory, columnIndex)}
              onDoubleClick={() => onDoubleClick(file.path, file.isDirectory)}
              onContextMenu={(e) => onContextMenu(e, file, columnIndex)}
              draggable={true}
              onDragStart={(e) => {
                e.preventDefault();
                if (window.electronAPI) window.electronAPI.startDrag(file.path);
              }}
              onDragOver={(e) => {
                if (file.isDirectory) e.preventDefault(); // allow drop
              }}
              onDrop={async (e) => {
                if (file.isDirectory) {
                  e.preventDefault();
                  e.stopPropagation();
                  const droppedPath = e.dataTransfer.files[0]?.path;
                  if (droppedPath && droppedPath !== file.path && window.electronAPI) {
                    const fileName = droppedPath.split('/').pop();
                    const target = file.path + '/' + fileName;
                    const success = await window.electronAPI.moveFile(droppedPath, target);
                    if (success) {
                      setFileCache(prev => {
                        const newCache = { ...prev };
                        delete newCache[file.path]; // force refresh if open
                        return newCache;
                      });
                      // Also refresh the parent column
                      const contents = await window.electronAPI.getDirectoryContents(dirPath);
                      setFileCache(prev => ({ ...prev, [dirPath]: contents }));
                    }
                  }
                }
              }}
            >
              <div className="file-icon">
                {file.isDirectory ? <Folder size={18} fill={activePath === file.path ? "white" : "var(--accent)"} /> : <FileText size={18} />}
              </div>
              <div className="file-name">
                {file.name}
                {searchResults && file.parentPath && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px', wordBreak: 'break-all' }}>
                    {file.parentPath.replace(dirPath, '') || '/'}
                  </div>
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
