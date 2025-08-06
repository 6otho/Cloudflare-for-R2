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
  <title>R2 文件管理器</title>
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
    .uploader { border: 2px dashed var(--border-color); border-radius: 12px; padding: 20px; text-align: center; cursor: pointer; margin-bottom: 20px; }
    .uploader.dragging { background-color: var(--c-primary); color: #fff; }
    .file-container.list-view { display: block; }
    .file-container.list-view .file-item { display: flex; align-items: center; padding: 10px; background-color: var(--card-bg); border-radius: 8px; margin-bottom: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .list-view .icon { flex-shrink: 0; width: 40px; height: 40px; display:flex; align-items:center; justify-content:center; }
    .list-view .icon svg, .grid-view .icon svg { width: 32px; height: 32px; color: var(--c-primary); }
    .list-view .info { flex-grow: 1; margin: 0 15px; }
    .list-view .filename { font-weight: bold; }
    .list-view .filesize { font-size: 0.9em; color: var(--text-light); }
    .list-view .checkbox { margin-left: auto; }
    .file-container.grid-view { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 15px; }
    .grid-view .file-item { position: relative; background: var(--card-bg); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); transition: transform 0.2s; }
    .grid-view .file-item:hover { transform: translateY(-5px); }
    .grid-view .icon { height: 120px; display: flex; justify-content: center; align-items: center; background-color: rgba(0,0,0,0.1); }
    .grid-view .icon img { width: 100%; height: 100%; object-fit: cover; }
    .grid-view .info { padding: 15px; text-align: center; }
    .grid-view .filename { font-weight: bold; word-break: break-all; margin-bottom: 5px; }
    .grid-view .filesize { font-size: 0.8em; color: var(--text-light); }
    .grid-view .checkbox { position: absolute; top: 10px; right: 10px; }
    .checkbox { width: 20px; height: 20px; accent-color: var(--c-primary); cursor: pointer; }
    #lightbox { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display: flex; justify-content: center; align-items: center; z-index: 1000; }
    #lightbox img { max-width: 90%; max-height: 90%; object-fit: contain; }
    .lightbox-nav { position: absolute; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: #fff; border: none; font-size: 2em; padding: 10px 15px; cursor: pointer; border-radius: 8px; }
    #lightbox-prev { left: 20px; } #lightbox-next { right: 20px; } #lightbox-close { top: 20px; right: 20px; transform: none; font-size: 1.5em; }
    @media (max-width: 768px) {
      header { flex-direction: column; align-items: flex-start; gap: 20px; }
      header h1 { font-size: 1.5em; }
      .file-container.grid-view { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
      .list-view .info { margin: 0 10px; }
      .lightbox-nav { font-size: 1.5em; padding: 8px 12px; }
    }
  </style>
</head>
<body>

  <svg class="hidden"><defs>
    <symbol id="icon-file" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-video" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM10 15.5v-5l4 2.5l-4 2.5zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-audio" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-2 15a3 3 0 1 1 0-6a3 3 0 0 1 0 6zm0-8a1 1 0 0 0-1 1v2.55A3 3 0 0 0 9 14a3 3 0 0 0 6 0a3 3 0 0 0-2-2.82V9a1 1 0 0 0-1-1h-2zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-zip" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM9 18H7v-2h2v2zm0-4H7v-2h2v2zm0-4H7V8h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V8h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-doc" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM16 18H8v-2h8v2zm0-4H8v-2h8v2zm-3-4H8V8h5v2zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-theme-light" viewBox="0 0 24 24"><path fill="currentColor" d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5s5-2.24 5-5s-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.02-.39-1.41 0c-.39.39-.39 1.02 0 1.41l1.06 1.06c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.02-.39-1.41 0c-.39.39-.39 1.02 0 1.41l1.06 1.06c.39.39 1.02.39 1.41 0a.996.996 0 0 0 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.02 0-1.41a.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.02 0 1.41c.39.39 1.02.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.02 0-1.41a.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.02 0 1.41c.39.39 1.02.39 1.41 0l1.06-1.06z"/></symbol>
    <symbol id="icon-theme-dark" viewBox="0 0 24 24"><path fill="currentColor" d="M9.37 5.51A7.35 7.35 0 0 0 9 6c0 4.41 3.59 8 8 8c.36 0 .72-.03 1.07-.09a7.33 7.33 0 0 1-3.07 2.91A7.06 7.06 0 0 1 9.5 19c-3.86 0-7-3.14-7-7c0-2.93 1.81-5.45 4.37-6.49z"/></symbol>
    <symbol id="icon-list-view" viewBox="0 0 24 24"><path fill="currentColor" d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></symbol>
    <symbol id="icon-grid-view" viewBox="0 0 24 24"><path fill="currentColor" d="M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z"/></symbol>
  </defs></svg>

  <div id="login-view"><div class="login-box"><h1>R2 文件管理器</h1><input type="password" id="password-input" placeholder="请输入访问密码"><button id="login-button">进入</button><p id="login-error"></p></div></div>

  <div id="app-view" class="hidden">
    <header>
      <h1>文件列表</h1>
      <div class="actions">
        <button id="theme-toggle-button" title="切换主题"></button>
        <button id="view-toggle-button" title="切换视图"></button>
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
    themeToggleButton: document.getElementById('theme-toggle-button'),
    viewToggleButton: document.getElementById('view-toggle-button'),
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
    // State
    password: '',
    files: [],
    imageFiles: [],
    currentImageIndex: -1,
    theme: localStorage.getItem('theme') || 'dark',
    viewMode: localStorage.getItem('viewMode') || 'grid',
  };

  // --- UTILS ---
  const showToast = (message) => { /* Omitting for brevity, assumed to exist */ };
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
    G.themeToggleButton.innerHTML = G.theme === 'dark' ? '<svg><use xlink:href="#icon-theme-light"></use></svg>' : '<svg><use xlink:href="#icon-theme-dark"></use></svg>';
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
        // In grid view, image icon is replaced by preview, so use generic file icon if it's an image.
      if(isImage && G.viewMode === 'grid'){
         item.innerHTML = \`
          <div class="icon">\${iconHTML}</div>
          <div class="info">
            <div class="filename" title="\${file.key}">\${file.key}</div>
            <div class="filesize">\${formatBytes(file.size)}</div>
          </div>
          <input type="checkbox" class="checkbox" data-key="\${file.key}">
        \`;
      } else {
         item.innerHTML = \`
          <div class="icon"><svg><use xlink:href="\${isImage ? '#icon-file' : fileType}"></use></svg></div>
          <div class="info">
             <div class="filename">\${file.key}</div>
             <div class="filesize">\${formatBytes(file.size)}</div>
          </div>
          <input type="checkbox" class="checkbox" data-key="\${file.key}">
        \`;
      }

      G.fileContainer.appendChild(item);
    });
  };

  // --- LOGIC ---
  const refreshFileList = async () => {
    try {
      const response = await apiCall('/api/list');
      G.files = (await response.json()).sort((a,b) => new Date(b.uploaded) - new Date(a.uploaded));
      renderFiles();
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

  const handleDelete = async () => {
    const keys = Array.from(document.querySelectorAll('.checkbox:checked')).map(cb => cb.dataset.key);
    if (keys.length === 0 || !confirm(\`确定删除 \${keys.length} 个文件吗？\`)) return;
    try {
        await apiCall('/api/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ keys }) });
        await refreshFileList();
    } catch(error) { console.error('Delete failed', error); }
  };

  // --- INIT ---
  const init = () => {
    applyTheme(); applyViewMode();
    G.loginButton.addEventListener('click', handleLogin);
    G.passwordInput.addEventListener('keypress', e => e.key === 'Enter' && handleLogin());
    G.themeToggleButton.addEventListener('click', toggleTheme);
    G.viewToggleButton.addEventListener('click', toggleViewMode);
    G.deleteButton.addEventListener('click', handleDelete);
    G.dropZone.addEventListener('click', () => G.fileInput.click());
    G.fileInput.addEventListener('change', () => handleUpload(G.fileInput.files));
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => G.dropZone.addEventListener(ev, e => {e.preventDefault();e.stopPropagation();}));
    ['dragenter', 'dragover'].forEach(ev => G.dropZone.addEventListener(ev, () => G.dropZone.classList.add('dragging')));
    ['dragleave', 'drop'].forEach(ev => G.dropZone.addEventListener(ev, () => G.dropZone.classList.remove('dragging')));
    G.dropZone.addEventListener('drop', e => handleUpload(e.dataTransfer.files));
    G.lightboxClose.addEventListener('click', closeLightbox);
    G.lightboxPrev.addEventListener('click', showPrevImage);
    G.lightboxNext.addEventListener('click', showNextImage);
    document.addEventListener('keydown', e => e.key === 'Escape' && !G.lightbox.classList.contains('hidden') && closeLightbox());
    G.fileContainer.addEventListener('click', e => {
        const item = e.target.closest('.file-item');
        if (!item) return;
        const key = item.dataset.key;
        const isImage = getFileIcon(key) === 'image';
        if (isImage) {
            e.preventDefault();
            const imageIndex = G.imageFiles.findIndex(f => f.key === key);
            if (imageIndex > -1) openLightbox(imageIndex);
        } else {
            window.open(\`/\${encodeURIComponent(key)}\`, '_blank');
        }
    });

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
