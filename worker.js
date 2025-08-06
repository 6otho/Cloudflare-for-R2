// =================================================================================
// R2-UI-WORKER v3.0 - The Ultimate Single-File Worker for Cloudflare R2.
// Features: Light/Dark Mode, Image Previews, Lightbox, Grid/List View, Mobile-First.
// =================================================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return this.handleApiRequest(request, env);
    }
    
    if (url.pathname.length > 1 && !url.pathname.startsWith('/api')) {
      return this.handleFileDownload(request, env);
    }
    
    return new Response(this.generateHTML(env.WORKER_NAME), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  },

  async handleApiRequest(request, env) {
    const url = new URL(request.url);
    const password = request.headers.get('x-auth-password');
    const { BUCKET, AUTH_PASSWORD } = env;

    if (!AUTH_PASSWORD || password !== AUTH_PASSWORD) {
      return new Response('Invalid Password', { status: 401 });
    }

    if (url.pathname === '/api/list' && request.method === 'GET') {
      const listing = await BUCKET.list({ limit: 1000, include: ['httpMetadata'] });
      return new Response(JSON.stringify(listing.objects), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'PUT' && url.pathname.startsWith('/api/upload/')) {
      const key = decodeURIComponent(url.pathname.substring('/api/upload/'.length));
      if (!key) return new Response('Filename missing.', { status: 400 });
      await BUCKET.put(key, request.body, { httpMetadata: request.headers });
      return new Response(`Uploaded ${key} successfully.`, { status: 201 });
    }

    if (request.method === 'POST' && url.pathname === '/api/delete') {
      try {
        const { keys } = await request.json();
        if (!Array.isArray(keys) || keys.length === 0) return new Response('Keys array is required.', { status: 400 });
        await BUCKET.delete(keys);
        return new Response(`Deleted ${keys.length} objects.`, { status: 200 });
      } catch (e) { return new Response('Invalid JSON format.', { status: 400 }); }
    }

    // 新增重命名API
    if (request.method === 'POST' && url.pathname === '/api/rename') {
      try {
        const { oldKey, newKey } = await request.json();
        if (!oldKey || !newKey) return new Response('Both oldKey and newKey are required.', { status: 400 });
        
        const object = await BUCKET.get(oldKey);
        if (!object) return new Response('Object not found', { status: 404 });
        
        await BUCKET.put(newKey, object.body, {
          httpMetadata: object.httpMetadata,
          customMetadata: object.customMetadata
        });
        
        await BUCKET.delete(oldKey);
        
        return new Response(`Renamed ${oldKey} to ${newKey} successfully.`, { status: 200 });
      } catch (e) { return new Response('Error renaming file', { status: 500 }); }
    }

    return new Response('API endpoint not found.', { status: 404 });
  },

  async handleFileDownload(request, env) {
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const object = await env.BUCKET.get(key);
    if (object === null) return new Response('Object Not Found', { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'public, max-age=259200'); // 缓存3天
    return new Response(object.body, { headers });
  },

  generateHTML() {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudflare-R2圖床</title>
  <style>
    :root {
      --c-dark-bg: #1a1b26; --c-dark-card: #24283b; --c-dark-text: #c0caf5; --c-dark-text-light: #a9b1d6; --c-dark-border: #414868;
      --c-light-bg: #eff1f5; --c-light-card: #ffffff; --c-light-text: #4c4f69; --c-light-text-light: #5c5f77; --c-light-border: #ccd0da;
      --c-primary: #7aa2f7; --c-success: #9ece6a; --c-error: #f7768e; --c-accent: #bb9af7;
    }
    html[data-theme='dark'] {
      --bg-color: var(--c-dark-bg); --card-bg: var(--c-dark-card); --text-color: var(--c-dark-text); --text-light: var(--c-dark-text-light); --border-color: var(--c-dark-border);
    }
    html[data-theme='light'] {
      --bg-color: var(--c-light-bg); --card-bg: var(--c-light-card); --text-color: var(--c-light-text); --text-light: var(--c-light-text-light); --border-color: var(--c-light-border);
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; background-color: var(--bg-color); color: var(--text-color); font-size: 16px; transition: background-color .3s, color .3s; }
    .hidden { display: none !important; }
    #login-view { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; }
    .login-box { padding: 40px; background-color: var(--card-bg); border-radius: 12px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.1); width: 90%; max-width: 350px; }
    .login-box h1 { color: var(--c-primary); margin-top: 0; }
    .login-box input { width: 100%; box-sizing: border-box; padding: 12px; margin: 10px 0; background-color: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-color); font-size: 1em; }
    .login-box button { width: 100%; padding: 12px; background-color: var(--c-primary); border: none; border-radius: 8px; color: #fff; font-size: 1.1em; cursor: pointer; }
    #login-error { color: var(--c-error); margin-top: 10px; height: 20px; }
    #app-view { padding: 15px; max-width: 1400px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; margin-bottom: 20px; }
    header h1 { color: var(--c-primary); margin: 0; font-size: 1.8em; }
    .actions { display: flex; gap: 10px; align-items: center; }
    .actions button { background: var(--card-bg); color: var(--text-light); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 15px; cursor: pointer; transition: all 0.2s; font-size: 1em; }
    .actions button:hover { border-color: var(--c-primary); color: var(--c-primary); }
    .actions button.active { background-color: var(--c-primary); color: #fff; border-color: var(--c-primary); }
    #delete-button { background-color: var(--c-error); color: #fff; border-color: var(--c-error); }
    #select-all-button { background-color: var(--c-success); color: #fff; border-color: var(--c-success); }
    .uploader { border: 2px dashed var(--border-color); border-radius: 12px; padding: 20px; text-align: center; cursor: pointer; margin-bottom: 20px; }
    .uploader.dragging { background-color: var(--c-primary); color: #fff; }
    .file-container.list-view { display: block; }
    .file-container.list-view .file-item { display: flex; align-items: center; padding: 10px; background-color: var(--card-bg); border-radius: 8px; margin-bottom: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); position: relative; }
    /* 列表视图图标缩小到16px */
    .list-view .icon { flex-shrink: 0; width: 20px; height: 20px; display:flex; align-items:center; justify-content:center; margin: 0 10px; }
    .list-view .icon svg, .grid-view .icon svg { width: 16px; height: 16px; color: var(--c-primary); }
    .list-view .info { flex-grow: 1; margin: 0 10px; }
    .list-view .filename { font-weight: bold; }
    .list-view .filesize { font-size: 0.9em; color: var(--text-light); }
    /* 选择框向前移动 */
    .list-view .checkbox { margin-left: 0; margin-right: 10px; }
    .file-container.grid-view { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 15px; }
    .grid-view .file-item { position: relative; background: var(--card-bg); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); transition: transform 0.2s; }
    .grid-view .file-item:hover { transform: translateY(-5px); }
    .grid-view .icon { height: 80px; display: flex; justify-content: center; align-items: center; background-color: rgba(0,0,0,0.1); }
    .grid-view .icon img { width: 100%; height: 100%; object-fit: cover; }
    .grid-view .info { padding: 15px; text-align: center; }
    .grid-view .filename { font-weight: bold; word-break: break-all; margin-bottom: 5px; }
    .grid-view .filesize { font-size: 0.8em; color: var(--text-light); }
    /* 网格视图选择框位置调整 */
    .grid-view .checkbox { position: absolute; top: 5px; left: 5px; }
    .checkbox { width: 20px; height: 20px; accent-color: var(--c-primary); cursor: pointer; }
    #lightbox { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display: flex; justify-content: center; align-items: center; z-index: 1000; }
    #lightbox img { max-width: 90%; max-height: 90%; object-fit: contain; }
    .lightbox-nav { position: absolute; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: #fff; border: none; font-size: 2em; padding: 10px 15px; cursor: pointer; border-radius: 8px; }
    #lightbox-prev { left: 20px; } #lightbox-next { right: 20px; } #lightbox-close { top: 20px; right: 20px; transform: none; font-size: 1.5em; }
    
    /* 主题切换按钮样式 */
    .theme-toggle {
      position: fixed;
      top: 10px;
      right: 10px;
      padding: 8px 12px;
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 20px;
      cursor: pointer;
      z-index: 1000;
      font-size: 16px;
    }
    .theme-toggle:hover {
      background-color: var(--c-primary);
      color: #fff;
    }
    
    /* 文件操作菜单 - 列表视图调整 */
    .list-view .file-actions {
      position: static;
      margin-left: auto;
    }
    .list-view .menu-button {
      width: 20px;
      height: 20px;
      font-size: 14px;
    }
    .list-view .menu-items {
      bottom: auto;
      top: 30px;
      right: 0;
    }
    
    /* 文件操作菜单 - 网格视图调整 */
    .grid-view .file-actions {
      position: absolute;
      bottom: 5px;
      right: 5px;
      z-index: 10;
    }
    .menu-button {
      width: 20px;
      height: 20px;
      background-color: var(--card-bg);
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
      cursor: pointer;
      opacity: 0.7;
      transition: opacity 0.3s;
    }
    .menu-button:hover {
      opacity: 1;
      background-color: var(--c-primary);
      color: white;
    }
    .menu-button::after {
      content: "⋮";
      font-size: 16px;
      font-weight: bold;
    }
    .menu-items {
      position: absolute;
      bottom: 30px;
      right: 0;
      background-color: var(--card-bg);
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      z-index: 20;
      width: 120px;
      overflow: hidden;
      display: none;
    }
    .menu-items.show {
      display: block;
    }
    .menu-item {
      padding: 8px 12px;
      cursor: pointer;
      font-size: 14px;
      transition: background-color 0.2s;
    }
    .menu-item:hover {
      background-color: var(--c-primary);
      color: white;
    }
    
    /* 重命名对话框 */
    .rename-dialog {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: var(--card-bg);
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      z-index: 2000;
      display: none;
      width: 90%;
      max-width: 400px;
    }
    .rename-dialog.show {
      display: block;
    }
    .rename-dialog input {
      width: 100%;
      padding: 10px;
      margin-bottom: 15px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background-color: var(--bg-color);
      color: var(--text-color);
    }
    .rename-dialog-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    
    @media (max-width: 768px) {
      header { flex-direction: column; align-items: flex-start; gap: 20px; }
      header h1 { font-size: 1.5em; }
      .file-container.grid-view { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
      .list-view .info { margin: 0 10px; }
      .lightbox-nav { font-size: 1.5em; padding: 8px 12px; }
      .actions { flex-wrap: wrap; }
      .actions button { padding: 8px 10px; font-size: 0.9em; }
      .list-view .icon { 
        width: 18px; 
        height: 18px; 
        margin: 0 8px;
      }
      .list-view .icon svg, .grid-view .icon svg { 
        width: 14px; 
        height: 14px; 
      }
    }
    @media (max-width: 480px) {
      .grid-view .icon { height: 60px; }
      .list-view .icon { width: 16px; height: 16px; }
      .file-container.grid-view { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); }
      .theme-toggle {
        top: 5px;
        right: 5px;
        padding: 6px 10px;
        font-size: 14px;
      }
      .menu-items {
        width: 100px;
      }
      .menu-item {
        padding: 6px 10px;
        font-size: 12px;
      }
      .list-view .checkbox { 
        margin-right: 5px;
      }
    }
  </style>
</head>
<body>

  <!-- 全局主题切换按钮 -->
  <button class="theme-toggle" id="global-theme-toggle">
    <span class="sun">☀️</span>
    <span class="moon hidden">🌙</span>
  </button>

  <!-- 重命名对话框 -->
  <div class="rename-dialog" id="rename-dialog">
    <h3>重命名文件</h3>
    <input type="text" id="new-filename" placeholder="新文件名">
    <div class="rename-dialog-buttons">
      <button id="rename-cancel">取消</button>
      <button id="rename-confirm">确认</button>
    </div>
  </div>

  <svg class="hidden"><defs>
    <symbol id="icon-file" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-video" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM10 15.5v-5l4 2.5l-4 2.5zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-audio" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-2 15a3 3 0 1 1 0-6a3 3 0 0 1 0 6zm0-8a1 1 0 0 0-1 1v2.55A3 3 0 0 0 9 14a3 3 0 0 0 6 0a3 3 0 0 0-2-2.82V9a1 1 0 0 0-1-1h-2zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-zip" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM9 18H7v-2h2v2zm0-4H7v-2h2v2zm0-4H7V8h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V8h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-doc" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM16 18H8v-2h8v2zm0-4H8v-2h8v2zm-3-4H8V8h5v2zM6 20V4h7v5h5v11H6z"/></symbol>
  </defs></svg>

  <div id="login-view"><div class="login-box"><h1>Cloudflare-R2圖床</h1><input type="password" id="password-input" placeholder="请输入访问密码"><button id="login-button">进入</button><p id="login-error"></p></div></div>

  <div id="app-view" class="hidden">
    <header>
      <h1>文件列表</h1>
      <div class="actions">
        <button id="view-toggle-button" title="切换视图"></button>
        <button id="select-all-button">全选</button>
        <button id="delete-button">删除选中</button>
      </div>
    </header>
    <input type="file" id="file-input" multiple class="hidden">
    <div class="uploader" id="drop-zone"><p>拖拽文件到此处，或点击上传</p></div>
    <div id="file-container"></div>
  </div>

  <div id="lightbox" class="hidden">
    <button id="lightbox-close" class="lightbox-nav">&times;</button>
    <button id="lightbox-prev" class="lightbox-nav">&#10094;</button>
    <button id="lightbox-next" class="lightbox-nav">&#10095;</button>
    <img id="lightbox-image" src="" alt="Image preview">
  </div>

<script>
document.addEventListener('DOMContentLoaded', () => {
  const G = {
    // Views & Containers
    loginView: document.getElementById('login-view'),
    appView: document.getElementById('app-view'),
    fileContainer: document.getElementById('file-container'),
    // Buttons
    loginButton: document.getElementById('login-button'),
    deleteButton: document.getElementById('delete-button'),
    viewToggleButton: document.getElementById('view-toggle-button'),
    selectAllButton: document.getElementById('select-all-button'),
    // Inputs
    passwordInput: document.getElementById('password-input'),
    fileInput: document.getElementById('file-input'),
    // Uploader & Lightbox
    dropZone: document.getElementById('drop-zone'),
    lightbox: document.getElementById('lightbox'),
    lightboxImage: document.getElementById('lightbox-image'),
    lightboxClose: document.getElementById('lightbox-close'),
    lightboxPrev: document.getElementById('lightbox-prev'),
    lightboxNext: document.getElementById('lightbox-next'),
    // Theme toggle
    themeToggle: document.getElementById('global-theme-toggle'),
    // Rename dialog
    renameDialog: document.getElementById('rename-dialog'),
    newFilename: document.getElementById('new-filename'),
    renameCancel: document.getElementById('rename-cancel'),
    renameConfirm: document.getElementById('rename-confirm'),
    // State
    password: '',
    files: [],
    imageFiles: [],
    currentImageIndex: -1,
    theme: localStorage.getItem('theme') || 'dark',
    viewMode: localStorage.getItem('viewMode') || 'grid',
    isAllSelected: false,
    currentFileKey: null, // 当前操作的文件key
    currentMenu: null, // 当前打开的文件菜单
  };

  // --- UTILS ---
  const showToast = (message, duration = 3000) => {
    // 创建或获取toast元素
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    
    toast.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  };
  
  const getFileIcon = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
    if (['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext)) return '#icon-video';
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '#icon-audio';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '#icon-zip';
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'md'].includes(ext)) return '#icon-doc';
    return '#icon-file';
  };
  
  const formatBytes = (bytes, d=2) => {
    if(!+bytes)return"0 Bytes";const i=Math.floor(Math.log(bytes)/Math.log(1024));
    return \`\${parseFloat((bytes/Math.pow(1024,i)).toFixed(d))} \${"Bytes,KB,MB,GB,TB"[i]}\`
  };

  // --- API ---
  const apiCall = async (endpoint, options = {}) => {
    const headers = { 'x-auth-password': G.password, ...options.headers };
    const response = await fetch(endpoint, { ...options, headers });
    if (!response.ok) throw new Error(await response.text() || \`HTTP error! \${response.status}\`);
    return response;
  };

  // --- THEME & VIEW ---
  const applyTheme = () => {
    document.documentElement.setAttribute('data-theme', G.theme);
    // 更新主题切换按钮图标
    const sun = G.themeToggle.querySelector('.sun');
    const moon = G.themeToggle.querySelector('.moon');
    if (G.theme === 'dark') {
      sun.classList.add('hidden');
      moon.classList.remove('hidden');
    } else {
      sun.classList.remove('hidden');
      moon.classList.add('hidden');
    }
  };
  
  const toggleTheme = () => {
    G.theme = G.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', G.theme);
    applyTheme();
  };
  
  const applyViewMode = () => {
    G.fileContainer.className = \`file-container \${G.viewMode}-view\`;
    G.viewToggleButton.innerHTML = G.viewMode === 'grid' ? '<svg><use xlink:href="#icon-list-view"></use></svg>' : '<svg><use xlink:href="#icon-grid-view"></use></svg>';
    renderFiles();
  };
  
  const toggleViewMode = () => {
    G.viewMode = G.viewMode === 'grid' ? 'list' : 'grid';
    localStorage.setItem('viewMode', G.viewMode);
    applyViewMode();
  };

  // --- LIGHTBOX ---
  const openLightbox = (index) => {
    G.currentImageIndex = index;
    G.lightboxImage.src = encodeURIComponent(G.imageFiles[G.currentImageIndex].key);
    G.lightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  };
  
  const closeLightbox = () => {
    G.lightbox.classList.add('hidden');
    document.body.style.overflow = 'auto';
  };
  
  const showNextImage = () => openLightbox((G.currentImageIndex + 1) % G.imageFiles.length);
  const showPrevImage = () => openLightbox((G.currentImageIndex - 1 + G.imageFiles.length) % G.imageFiles.length);

  // --- RENDER ---
  const renderFiles = () => {
    G.fileContainer.innerHTML = '';
    if (G.files.length === 0) {
      G.fileContainer.innerHTML = '<p style="text-align:center;color:var(--text-light);">存储桶为空。</p>'; return;
    }
    G.imageFiles = G.files.filter(f => getFileIcon(f.key) === 'image');
    G.files.forEach(file => {
      const fileType = getFileIcon(file.key);
      const isImage = fileType === 'image';
      const item = document.createElement('div');
      item.className = 'file-item';
      item.dataset.key = file.key;
      
      const iconHTML = isImage && G.viewMode === 'grid'
        ? \`<img src="/\${encodeURIComponent(file.key)}" alt="\${file.key}" loading="lazy">\`
        : \`<svg><use xlink:href="\${isImage ? '#icon-file' : fileType}"></use></svg>\`;
        
      // 添加操作按钮和菜单
      const actionsHTML = \`
        <div class="file-actions">
          <div class="menu-button" data-key="\${file.key}"></div>
          <div class="menu-items" data-key="\${file.key}">
            <div class="menu-item" data-action="rename">重命名</div>
            <div class="menu-item" data-action="download">下载</div>
            <div class="menu-item" data-action="copy">复制</div>
            <div class="menu-item" data-action="move">移动</div>
            <div class="menu-item" data-action="copy-link">复制链接</div>
            <div class="menu-item" data-action="delete">删除</div>
          </div>
        </div>
      \`;
      
      if(isImage && G.viewMode === 'grid'){
         item.innerHTML = \`
          <div class="icon">\${iconHTML}</div>
          <div class="info">
            <div class="filename" title="\${file.key}">\${file.key}</div>
            <div class="filesize">\${formatBytes(file.size)}</div>
          </div>
          <input type="checkbox" class="checkbox" data-key="\${file.key}" \${G.isAllSelected ? 'checked' : ''}>
          \${actionsHTML}
        \`;
      } else {
         item.innerHTML = \`
          <div class="icon"><svg><use xlink:href="\${isImage ? '#icon-file' : fileType}"></use></svg></div>
          <div class="info">
             <div class="filename">\${file.key}</div>
             <div class="filesize">\${formatBytes(file.size)}</div>
          </div>
          <input type="checkbox" class="checkbox" data-key="\${file.key}" \${G.isAllSelected ? 'checked' : ''}>
          \${actionsHTML}
        \`;
      }

      G.fileContainer.appendChild(item);
    });
  };

  // --- FILE ACTIONS ---
  const handleFileAction = (action, key) => {
    G.currentFileKey = key;
    
    switch(action) {
      case 'rename':
        G.newFilename.value = key;
        G.renameDialog.classList.add('show');
        break;
      case 'download':
        const downloadUrl = \`\${window.location.origin}/\${encodeURIComponent(key)}\`;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = key;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        break;
      case 'copy':
        showToast('复制功能正在开发中');
        break;
      case 'move':
        showToast('移动功能正在开发中');
        break;
      case 'copy-link':
        const fileUrl = \`\${window.location.origin}/\${encodeURIComponent(key)}\`;
        navigator.clipboard.writeText(fileUrl)
          .then(() => showToast('链接已复制到剪贴板'))
          .catch(err => showToast('复制失败: ' + err));
        break;
      case 'delete':
        if (confirm(\`确定删除文件 "\${key}" 吗？\`)) {
          handleDelete([key]);
        }
        break;
    }
  };
  
  const renameFile = async () => {
    const oldKey = G.currentFileKey;
    const newKey = G.newFilename.value;
    
    if (!newKey || newKey === oldKey) {
      G.renameDialog.classList.remove('show');
      return;
    }
    
    try {
      const response = await apiCall('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldKey, newKey })
      });
      
      if (response.ok) {
        showToast(\`文件已重命名为 "\${newKey}"\`);
        await refreshFileList();
      } else {
        showToast(\`重命名失败: \${await response.text()}\`);
      }
    } catch (error) {
      showToast(\`重命名失败: \${error.message}\`);
    }
    
    G.renameDialog.classList.remove('show');
  };

  // --- SELECT ALL ---
  const toggleSelectAll = () => {
    G.isAllSelected = !G.isAllSelected;
    document.querySelectorAll('.checkbox').forEach(checkbox => {
      checkbox.checked = G.isAllSelected;
    });
    G.selectAllButton.textContent = G.isAllSelected ? '取消全选' : '全选';
  };

  // --- LOGIC ---
  const refreshFileList = async () => {
    try {
      const response = await apiCall('/api/list');
      G.files = (await response.json()).sort((a,b) => new Date(b.uploaded) - new Date(a.uploaded));
      renderFiles();
      // 刷新后重置全选状态
      G.isAllSelected = false;
      G.selectAllButton.textContent = '全选';
    } catch (error) { console.error(error); }
  };
  
  const handleLogin = async () => {
    const pw = G.passwordInput.value;
    if (!pw) return; G.password = pw;
    G.loginButton.textContent = "验证中..."; G.loginButton.disabled = true;
    try {
      await apiCall('/api/list');
      G.loginView.classList.add('hidden');
      G.appView.classList.remove('hidden');
      sessionStorage.setItem('r2-password', pw);
      await refreshFileList();
    } catch (error) {
      document.getElementById('login-error').textContent = '密码错误';
      setTimeout(()=> document.getElementById('login-error').textContent = '', 3000);
    } finally {
        G.loginButton.textContent = "进入"; G.loginButton.disabled = false;
    }
  };
  
  const handleUpload = async (files) => {
    for (const file of files) {
        try {
            await apiCall(\`/api/upload/\${encodeURIComponent(file.name)}\`, { method: 'PUT', body: file });
        } catch (error) { console.error(\`Upload failed for \${file.name}\`, error); }
    }
    await refreshFileList();
  };

  const handleDelete = async (keys) => {
    if (!keys || keys.length === 0) {
      keys = Array.from(document.querySelectorAll('.checkbox:checked')).map(cb => cb.dataset.key);
    }
    
    if (keys.length === 0 || !confirm(\`确定删除 \${keys.length} 个文件吗？\`)) return;
    
    try {
        await apiCall('/api/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ keys }) });
        await refreshFileList();
    } catch(error) { 
        console.error('Delete failed', error);
        showToast('删除失败: ' + error.message);
    }
  };

  // --- INIT ---
  const init = () => {
    applyTheme();
    applyViewMode();
    
    // 绑定主题切换事件
    G.themeToggle.addEventListener('click', toggleTheme);
    
    // 绑定登录相关事件
    G.loginButton.addEventListener('click', handleLogin);
    G.passwordInput.addEventListener('keypress', e => e.key === 'Enter' && handleLogin());
    
    // 绑定视图切换事件
    G.viewToggleButton.addEventListener('click', toggleViewMode);
    
    // 绑定选择事件
    G.selectAllButton.addEventListener('click', toggleSelectAll);
    G.deleteButton.addEventListener('click', () => handleDelete());
    
    // 绑定上传事件
    G.dropZone.addEventListener('click', () => G.fileInput.click());
    G.fileInput.addEventListener('change', () => handleUpload(G.fileInput.files));
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => G.dropZone.addEventListener(ev, e => {e.preventDefault();e.stopPropagation();}));
    ['dragenter', 'dragover'].forEach(ev => G.dropZone.addEventListener(ev, () => G.dropZone.classList.add('dragging')));
    ['dragleave', 'drop'].forEach(ev => G.dropZone.addEventListener(ev, () => G.dropZone.classList.remove('dragging')));
    G.dropZone.addEventListener('drop', e => handleUpload(e.dataTransfer.files));
    
    // 绑定图片预览事件
    G.lightboxClose.addEventListener('click', closeLightbox);
    G.lightboxPrev.addEventListener('click', showPrevImage);
    G.lightboxNext.addEventListener('click', showNextImage);
    document.addEventListener('keydown', e => e.key === 'Escape' && !G.lightbox.classList.contains('hidden') && closeLightbox());
    
    // 绑定文件操作事件
    document.addEventListener('click', e => {
      // 关闭所有菜单
      if (G.currentMenu && !e.target.closest('.menu-items') && !e.target.classList.contains('menu-button')) {
        G.currentMenu.classList.remove('show');
        G.currentMenu = null;
      }
      
      // 处理菜单按钮点击
      if (e.target.classList.contains('menu-button')) {
        const menu = e.target.nextElementSibling;
        
        // 关闭其他菜单
        if (G.currentMenu && G.currentMenu !== menu) {
          G.currentMenu.classList.remove('show');
        }
        
        // 切换当前菜单
        menu.classList.toggle('show');
        G.currentMenu = menu.classList.contains('show') ? menu : null;
        
        e.stopPropagation();
        return;
      }
      
      // 处理菜单项点击
      if (e.target.classList.contains('menu-item')) {
        const menu = e.target.closest('.menu-items');
        const key = menu.dataset.key;
        const action = e.target.dataset.action;
        
        menu.classList.remove('show');
        G.currentMenu = null;
        
        handleFileAction(action, key);
        return;
      }
    });
    
    // 绑定文件选择功能
    G.fileContainer.addEventListener('click', e => {
      // 处理复选框点击
      if (e.target.classList.contains('checkbox')) {
        const anyUnchecked = Array.from(document.querySelectorAll('.checkbox')).some(cb => !cb.checked);
        G.isAllSelected = !anyUnchecked;
        G.selectAllButton.textContent = G.isAllSelected ? '取消全选' : '全选';
        return;
      }
      
      // 处理文件项点击
      const item = e.target.closest('.file-item');
      if (!item) return;
      
      const key = item.dataset.key;
      const isImage = getFileIcon(key) === 'image';
      
      if (e.target.tagName === 'IMG' || e.target.classList.contains('icon')) {
        if (isImage) {
          const imageIndex = G.imageFiles.findIndex(f => f.key === key);
          if (imageIndex > -1) openLightbox(imageIndex);
        } else {
          window.open(\`/\${encodeURIComponent(key)}\`, '_blank');
        }
      } else {
        // 点击文件项时切换选择状态
        const checkbox = item.querySelector('.checkbox');
        if (checkbox && !e.target.classList.contains('menu-button')) {
          checkbox.checked = !checkbox.checked;
          const anyUnchecked = Array.from(document.querySelectorAll('.checkbox')).some(cb => !cb.checked);
          G.isAllSelected = !anyUnchecked;
          G.selectAllButton.textContent = G.isAllSelected ? '取消全选' : '全选';
        }
      }
    });

    // 绑定重命名事件
    G.renameCancel.addEventListener('click', () => {
      G.renameDialog.classList.remove('show');
    });
    
    G.renameConfirm.addEventListener('click', renameFile);
    
    G.newFilename.addEventListener('keypress', e => {
      if (e.key === 'Enter') renameFile();
    });

    // 自动登录
    const savedPassword = sessionStorage.getItem('r2-password');
    if (savedPassword) { G.passwordInput.value = savedPassword; handleLogin(); }
  };

  init();
});
</script>
</body>
</html>
    `;
  },
};
