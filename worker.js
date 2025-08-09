// =================================================================================
// R2-UI-WORKER v8.7 (Critical Navigation Fix by AI Assistant)
// Features: Light/Dark Mode, Image Previews, Lightbox, Grid/List View, Mobile-First.
// Changelog:
// - (CRITICAL FIX) SPA ROUTING LOGIC: Corrected a fatal error in the `navigateTo`
//   function that improperly handled the root path. This bug caused the page to
//   reset to the root directory on refresh and broke browser back/forward navigation.
//   The routing is now stable, robust, and works as expected.
// - All other recent features (file size display fix, bottom progress bar) are maintained.
// =================================================================================

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return this.handleApiRequest(request, env, context);
    }

    if (url.pathname.length > 1 && !url.pathname.startsWith('/api')) {
      return this.handleFileDownload(request, env);
    }

    return new Response(this.generateHTML(env), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

  },

  async handleApiRequest(request, env, context) {
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
      const maxSizeBytes = 100 * 1024 * 1024;
      const contentLength = request.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
          return new Response('File size exceeds the 100MB limit.', { status: 413 });
      }

      const key = decodeURIComponent(url.pathname.substring('/api/upload/'.length));
      if (!key) return new Response('Filename missing.', { status: 400 });

      await BUCKET.put(key, request.body, { httpMetadata: request.headers });

      const escapedKey = this.escapeMarkdown(key);
      const message = `☁️ *新文件上传成功*\n\n*文件名:* \`${escapedKey}\``;
      context.waitUntil(this.sendTelegramNotification(env, request, key, message));

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

    if (request.method === 'POST' && url.pathname === '/api/create-folder') {
      try {
        const { folderName } = await request.json();
        const trimmedName = folderName.trim();
        if (!trimmedName || trimmedName.includes('/')) {
          return new Response('Invalid folder name. It cannot be empty or contain slashes.', { status: 400 });
        }
        const key = `${trimmedName}/`;
        const existing = await BUCKET.head(key);
        if (existing) {
          return new Response('An object with this name already exists.', { status: 409 });
        }
        await BUCKET.put(key, null);
        return new Response(`Folder ${key} created successfully.`, { status: 201 });
      } catch (e) {
        return new Response('Invalid request: ' + e.message, { status: 400 });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/move') {
      try {
        const { oldKey, newKey } = await request.json();
        if (!oldKey || !newKey) return new Response('Both oldKey and newKey are required.', { status: 400 });
        if (oldKey === newKey) return new Response('Source and destination are the same.', { status: 400 });

        const isFolder = oldKey.endsWith('/');
        if (isFolder) {
            if (newKey.startsWith(oldKey)) {
                return new Response('Invalid move. Cannot move a folder into itself.', { status: 400 });
            }
            const list = await BUCKET.list({ prefix: oldKey, limit: 1000 });
            let objectsToMove = list.objects;
            if (objectsToMove.length === 0) {
                const emptyFolderObject = await BUCKET.head(oldKey);
                if (emptyFolderObject) {
                    objectsToMove = [{ key: oldKey, size: emptyFolderObject.size }];
                }
            }
            if (objectsToMove.length === 0) {
                return new Response(`Folder ${oldKey} not found or is empty.`, { status: 200 });
            }
            for (const obj of objectsToMove) {
                const objectToCopy = await BUCKET.get(obj.key);
                if (objectToCopy) {
                    const newObjectKey = newKey + obj.key.substring(oldKey.length);
                    await BUCKET.put(newObjectKey, objectToCopy.body, {
                        httpMetadata: objectToCopy.httpMetadata,
                        customMetadata: objectToCopy.customMetadata,
                    });
                }
            }
            const keysToDelete = objectsToMove.map(obj => obj.key);
            await BUCKET.delete(keysToDelete);
        } else {
            const object = await BUCKET.get(oldKey);
            if (!object) return new Response('Object not found', { status: 404 });
            await BUCKET.put(newKey, object.body, { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata });
            await BUCKET.delete(oldKey);
        }

        const message = `➡️ *项目已移动*\n\n*从:* \`${this.escapeMarkdown(oldKey)}\`\n*到:* \`${this.escapeMarkdown(newKey)}\``;
        context.waitUntil(this.sendTelegramNotification(env, request, newKey, message));

        return new Response(`Moved ${oldKey} to ${newKey} successfully.`, { status: 200 });

      } catch (e) { return new Response('Error moving file: ' + e.message, { status: 500 }); }
    }

    return new Response('API endpoint not found.', { status: 404 });

  },

  async handleFileDownload(request, env) {
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    const object = await env.BUCKET.get(key);
    if (object === null) return new Response('Object Not Found', { status: 404 });

    if (object.size === 0 && key.endsWith('/')) {
      return new Response('This is a folder, not a downloadable file.', { status: 400 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'public, max-age=259200'); 
    return new Response(object.body, { headers });

  },
  
  isImageFile(key) {
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    const ext = key.split('.').pop().toLowerCase();
    return imageExtensions.includes(ext);
  },

  escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  },

  async sendTelegramNotification(env, request, key, text) {
    const { TG_BOT_TOKEN, TG_CHAT_ID } = env;
    if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
      return;
    }

    const baseUrl = new URL(request.url).origin;
    const fileUrl = `${baseUrl}/${encodeURIComponent(key)}`;
    const isImage = this.isImageFile(key);
    const caption = `${text}\n\n*链接:* [点击查看](${fileUrl})`;

    let apiUrl;
    let payload;

    if (isImage) {
      apiUrl = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`;
      payload = {
        chat_id: TG_CHAT_ID,
        photo: fileUrl,
        caption: caption,
        parse_mode: 'MarkdownV2',
      };
    } else {
      apiUrl = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
      payload = {
        chat_id: TG_CHAT_ID,
        text: caption,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: key.endsWith('/') // 文件夹不显示预览
      };
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`Telegram notification failed: ${response.status} ${response.statusText}`, await response.text());
      } else {
        console.log('Telegram notification sent successfully.');
      }
    } catch (error) {
      console.error('Error sending Telegram notification:', error);
    }

  },

  generateHTML(env) {
    const bgImageUrl = env.BACKGROUND_IMAGE_URL || '';
    const loginViewStyleAttribute = bgImageUrl ? `style="background-image: url('${bgImageUrl}');"` : '';
    
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudflare-R2</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>☁️</text></svg>">
  <link rel="apple-touch-icon" href="https://file.ikim.eu.org/PUB%2F0260eb1c1d2b11bcb9e94a8ed2a2614b.jpg">
  <style>
    :root {
      --c-dark-bg: #1a1b26; --c-dark-card: #24283b; --c-dark-text: #c0caf5; --c-dark-text-light: #a9b1d6; --c-dark-border: #414868;
      --c-light-bg: #eff1f5; --c-light-card: #ffffff; --c-light-text: #4c4f69; --c-light-text-light: #5c5f77; --c-light-border: #ccd0da;
      --c-primary: #7aa2f7; --c-success: #9ece6a; --c-error: #f7768e; --c-accent: #bb9af7;
      --c-ink-blue-light: #2c3e50; --c-ink-blue-dark: #a6c1ee; --c-deep-blue-light: #1d3557; --c-deep-blue-dark: #457b9d;
    }
    html[data-theme='dark'] {
      --bg-color: var(--c-dark-bg); --card-bg: var(--c-dark-card); --text-color: var(--c-dark-text); --text-light: var(--c-dark-text-light); --border-color: var(--c-dark-border);
      --ink-blue: var(--c-ink-blue-dark); --deep-blue: var(--c-deep-blue-dark); --uploader-bg: rgba(187, 154, 247, 0.05);
    }
    html[data-theme='light'] {
      --bg-color: var(--c-light-bg); --card-bg: var(--c-light-card); --text-color: var(--c-light-text); --text-light: var(--c-light-text-light); --border-color: var(--c-light-border);
      --ink-blue: var(--c-ink-blue-light); --deep-blue: var(--c-deep-blue-light); --uploader-bg: rgba(122, 162, 247, 0.1);
    }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; 
      background-color: var(--bg-color); color: var(--text-color); font-size: 16px; transition: background-color .3s, color .3s;
      touch-action: manipulation;
    }
    .hidden { display: none !important; }
    .page-header {
      position: fixed; top: 0; left: 0; width: 100%; height: 72px; padding: 0 25px; box-sizing: border-box;
      display: flex; align-items: center; justify-content: space-between;
      background-color: rgba(var(--card-bg-rgb), 0.8); backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px); border-bottom: 1px solid var(--border-color); z-index: 10;
    }
    html[data-theme='dark'] .page-header { background-color: rgba(36, 40, 59, 0.8); }
    html[data-theme='light'] .page-header { background-color: rgba(255, 255, 255, 0.8); }
    .logo-title-group { display: flex; align-items: center; }
    .page-header .logo { font-size: 2.2em; margin-right: 12px; line-height: 1; }
    .page-header .project-name { font-size: 1.2em; font-weight: 600; color: var(--ink-blue); }
    .page-footer { position: fixed; bottom: 0; left: 0; width: 100%; padding: 20px; box-sizing: border-box; text-align: center; z-index: 10; }
    .page-footer, .page-footer a { font-size: 0.85em; color: var(--text-light); text-decoration: none; }
    .page-footer a { font-weight: bold; color: var(--deep-blue); transition: opacity 0.2s; }
    .page-footer a:hover { opacity: 0.8; }
    #login-view {
      display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh;
      background-size: cover; background-position: center center; background-repeat: no-repeat;
    }
    .login-box { padding: 40px; background-color: var(--card-bg); border-radius: 12px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.1); width: 90%; max-width: 380px; box-sizing: border-box; transition: all .3s ease; }
    .login-logo { font-size: 4.5em; line-height: 1; margin-bottom: 5px; }
    .login-box h1 { color: var(--c-primary); margin: 0 0 8px 0; }
    .login-box .login-prompt { margin-top: 0; }
    .input-with-icon { position: relative; width: 100%; margin: 30px 0; }
    .input-with-icon .input-icon { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); color: var(--text-light); pointer-events: none; width: 20px; height: 20px; }
    .login-box input { width: 100%; box-sizing: border-box; padding: 12px 12px 12px 45px; background-color: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-color); font-size: 1em; }
    .login-box button { width: 100%; padding: 12px; background-color: var(--c-primary); border: none; border-radius: 8px; color: #fff; font-size: 1.1em; cursor: pointer; }
    #login-error { color: var(--c-error); margin-top: 10px; height: 20px; }
    #app-view { padding: 15px; max-width: 1400px; margin: 0 auto; padding-top: 92px; }
    header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; margin-bottom: 20px; }
    header h1 { color: var(--c-primary); margin: 0; font-size: 1.8em; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .actions button, .actions .menu-button-wrapper button, #bulk-actions-container button {
      height: 36px; padding: 0 12px; font-size: 0.9em; display: flex; align-items: center; justify-content: center;
      background: var(--card-bg); color: var(--text-light); border: 1px solid var(--border-color);
      border-radius: 8px; cursor: pointer; transition: all 0.2s; box-sizing: border-box;
    }
    .actions button:hover, .actions button.active, .actions .menu-button-wrapper button:hover, #bulk-actions-container button:hover { border-color: var(--c-primary); color: var(--c-primary); }
    #view-toggle-button { width: 36px; padding: 0; }
    #view-toggle-button svg { width: 20px; height: 20px; }
    #select-all-button, #deselect-all-button, #mobile-select-menu-trigger { background-color: var(--c-success); color: #fff; border-color: var(--c-success); }
    #bulk-actions-container #delete-button { background-color: var(--c-error); color: #fff; border-color: var(--c-error); }
    #bulk-actions-container #move-selected-button { background-color: var(--c-primary); color: #fff; border-color: var(--c-primary); }
    .sort-button-group { display: flex; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;}
    .sort-button-group:hover { border-color: var(--c-primary); }
    .sort-button-group button { border: none; border-radius: 0; }
    .sort-button-group button:first-child { border-right: 1px solid var(--border-color); }
    .sort-button-group button:last-child { width: 36px; padding: 0; }
    .sort-button-group button svg { width: 20px; height: 20px; }
    #breadcrumb { margin-bottom: 20px; padding: 10px 15px; background-color: var(--card-bg); border-radius: 8px; font-size: 0.9em; word-break: break-all;}
    #breadcrumb a { color: var(--c-primary); text-decoration: none; }
    #breadcrumb a:hover { text-decoration: underline; }
    #breadcrumb span { color: var(--text-light); }
    .search-wrapper { position: relative; margin-bottom: 20px; }
    .search-wrapper svg { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; color: var(--text-light); pointer-events: none; }
    #search-input { width: 100%; padding: 12px 15px 12px 45px; font-size: 1em; color: var(--text-color); background-color: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; box-sizing: border-box; }
    .uploader { border: 2px dashed var(--border-color); border-radius: 12px; padding: 20px; text-align: center; cursor: pointer; margin-bottom: 20px; background-color: var(--uploader-bg); }
    .uploader.dragging { background-color: var(--c-primary); color: #fff; }
    .file-container.list-view { display: block; }
    .file-container.list-view .file-item { display: flex; align-items: center; padding: 10px; background-color: var(--card-bg); border-radius: 8px; margin-bottom: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); position: relative; cursor: pointer; }
    .list-view .icon { flex-shrink: 0; width: 24px; height: 24px; display:flex; align-items:center; justify-content:center; margin: 0 10px; }
    .list-view .icon svg { width: 100%; height: 100%; color: var(--c-primary); }
    .list-view .info { flex-grow: 1; margin: 0 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .list-view .filename { font-weight: bold; }
    .list-view .filesize { font-size: 0.9em; color: var(--text-light); }
    .list-view .checkbox { margin-left: 0; margin-right: 10px; }
    .file-container.grid-view { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 15px; }
    .grid-view .file-item { position: relative; background: var(--card-bg); border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border: 2px solid transparent; transition: transform 0.2s, border-color 0.2s; cursor: pointer; }
    .grid-view .file-item.menu-active { z-index: 15; }
    .grid-view .file-item:hover { transform: translateY(-5px); }
    .grid-view .file-item.selected { border-color: var(--c-primary); transform: translateY(0) !important; }
    .grid-view .icon { height: 120px; display: flex; justify-content: center; align-items: center; background-color: var(--bg-color); border-top-left-radius: 10px; border-top-right-radius: 10px; }
    .grid-view .icon img, .grid-view .icon video { width: 100%; height: 100%; object-fit: cover; border-top-left-radius: 10px; border-top-right-radius: 10px; }
    .grid-view .icon svg { width: 40%; height: 40%; max-width: 64px; color: var(--c-primary); }
    .grid-view .info { padding: 15px; text-align: center; }
    .grid-view .filename { font-weight: bold; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
    .grid-view .filesize { font-size: 0.8em; color: var(--text-light); }
    .grid-view .checkbox { position: absolute; bottom: 5px; left: 5px; z-index: 5; opacity: 0; transition: opacity .2s ease-in-out; }
    .grid-view .file-item:hover .checkbox, .grid-view .file-item.selected .checkbox { opacity: 1; }
    .checkbox { width: 20px; height: 20px; accent-color: var(--c-primary); cursor: pointer; }
    #lightbox { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display: flex; justify-content: center; align-items: center; z-index: 5000; }
    #lightbox img { max-width: 90%; max-height: 90%; object-fit: contain; }
    .lightbox-nav { position: absolute; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: #fff; border: none; font-size: 2em; padding: 10px 15px; cursor: pointer; border-radius: 8px; }
    #lightbox-prev { left: 20px; } #lightbox-next { right: 20px; } #lightbox-close { top: 20px; right: 20px; transform: none; font-size: 1.5em; }
    .theme-toggle { position: fixed; bottom: 25px; right: 25px; padding: 8px 12px; background-color: var(--card-bg); border: 1px solid var(--border-color); border-radius: 20px; cursor: pointer; z-index: 1001; font-size: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .theme-toggle:hover { background-color: var(--c-primary); color: #fff; }
    .theme-toggle-header { background: none; border: none; cursor: pointer; font-size: 22px; padding: 8px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: background-color .2s; }
    .theme-toggle-header:hover { background-color: var(--border-color); }
    .list-view .file-actions { position: static; margin-left: auto; padding-left: 10px; }
    .list-view .menu-button { width: 20px; height: 20px; font-size: 14px; }
    .list-view .menu-items { right: 0; }
    .grid-view .file-actions { position: absolute; bottom: 5px; right: 5px; z-index: 10; opacity: 0; transition: opacity 0.2s ease-in-out; }
    .grid-view .file-item:hover .file-actions, .grid-view .file-item.selected .file-actions { opacity: 1; }
    .menu-button-wrapper { position: relative; }
    .menu-button { width: 20px; height: 20px; background-color: var(--card-bg); border-radius: 50%; display: flex; justify-content: center; align-items: center; cursor: pointer; opacity: 0.7; transition: opacity 0.3s; }
    .menu-button:hover { opacity: 1; background-color: var(--c-primary); color: white; }
    .menu-button::after { content: "⋮"; font-size: 16px; font-weight: bold; }
    .menu-items { position: absolute; background-color: var(--card-bg); border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 20; width: max-content; min-width: 120px; overflow: hidden; display: none; }
    .grid-view .menu-items { top: 110%; right: 0; }
    .grid-view .menu-items.menu-popup-up { top: auto; bottom: 110%; }
    .list-view .menu-items { top: 105%; }
    .list-view .menu-items.menu-popup-up { top: auto; bottom: 105%; }
    .menu-items.menu-popup-left { right: 100%; left: auto; }
    .actions .menu-items { right: 0; top: 42px; }
    .menu-items.show { display: block; }
    .menu-item { padding: 8px 12px; cursor: pointer; font-size: 14px; transition: background-color 0.2s; white-space: nowrap;}
    .menu-item:hover { background-color: var(--c-primary); color: white; }
    .menu-item.disabled { color: var(--text-light); background-color: transparent; cursor: not-allowed; }
    .menu-item.danger:hover { background-color: var(--c-error); color: white; }
    .dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: var(--card-bg); padding: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); z-index: 2000; display: none; width: 90%; max-width: 400px; box-sizing: border-box; }
    .dialog.show { display: block; }
    .dialog h3 { margin-top: 0; color: var(--text-color); }
    .dialog input, .dialog select { width: 100%; box-sizing: border-box; padding: 10px; margin-bottom: 15px; border: 1px solid var(--border-color); border-radius: 4px; background-color: var(--bg-color); color: var(--text-color); }
    .dialog-buttons { display: flex; justify-content: flex-end; gap: 10px; }
    
    #progress-bar-container {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 3px;
      z-index: 9998;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease-in-out;
    }
    #progress-bar-container.visible { opacity: 1; }
    #progress-bar {
      height: 100%;
      width: 0%;
      background-color: var(--c-primary);
      transition: width 0.1s linear, background-color 0.2s;
    }
    #progress-bar.success { background-color: var(--c-success); }
    
    .desktop-only, #bulk-actions-container { display: flex; }
    .mobile-only { display: none; }
    @media (min-width: 768px) {
      .login-box { max-width: 420px; padding: 50px; }
      .file-container.grid-view { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
      .actions .desktop-only, #bulk-actions-container { gap: 10px; align-items: center; }
    }
    @media (max-width: 767px) {
      .desktop-only { display: none !important; }
      .mobile-only { display: block; }
      #app-view { padding-top: 82px; }
      .page-header { flex-direction: row; align-items: center; padding: 0 15px; height: 60px;}
      .page-header .logo { font-size: 2em; margin-right: 8px;}
      .page-header .project-name { font-size: 1.1em; }
      .theme-toggle-header { font-size: 18px; padding: 6px; }
      .page-footer { font-size: 0.7em; }
      header { flex-direction: column; align-items: flex-start; gap: 20px; }
      .actions { flex-wrap: nowrap; justify-content: flex-end; width: 100%; gap: 8px;}
      .actions button, .actions .menu-button-wrapper button, .actions .sort-button-group button { height: 34px; padding: 0 10px; font-size: 13px; line-height: 1; white-space: nowrap;}
      #view-toggle-button, .sort-button-group button:last-child { width: 34px; padding: 0; }
      .grid-view .info { padding: 10px 5px; }
      .grid-view .filename { font-size: 0.8em; }
      .list-view .file-item { padding: 8px; }
      .list-view .filename { font-size: 0.9em; }
      .dialog { width: auto; min-width: 280px; max-width: 90%; }
      .theme-toggle { top: 15px; right: 15px; bottom: auto; left: auto; padding: 6px 10px; font-size: 14px; }
    }
    @media (max-width: 420px) {
      .actions { gap: 5px; }
      .actions button, .actions .menu-button-wrapper button, .actions .sort-button-group button { padding: 0 8px; font-size: 12px; }
      #view-toggle-button, .sort-button-group button:last-child { width: 32px; }
      .grid-view .icon { height: 100px; }
      .grid-view .filename { font-size: 0.75em; }
      .file-container.grid-view { grid-template-columns: repeat(auto-fill, minmax(85px, 1fr)); }
      .login-box { padding: 25px; }
    }
  </style>
</head>
<body>

  <header class="page-header hidden">
    <div class="logo-title-group">
      <span class="logo">☁️</span>
      <span class="project-name">Cloudflare-R2</span>
    </div>
    <button class="theme-toggle-header" id="header-theme-toggle" title="切换亮/暗模式">
      <span class="sun">☀️</span><span class="moon hidden">🌙</span>
    </button>
  </header>

  <button class="theme-toggle" id="global-theme-toggle" title="切换亮/暗模式"><span class="sun">☀️</span><span class="moon hidden">🌙</span></button>

  <div class="dialog" id="rename-dialog">
    <h3>重命名</h3><input type="text" id="new-filename" placeholder="新名称"><div class="dialog-buttons"><button id="rename-cancel">取消</button><button id="rename-confirm">确认</button></div>
  </div>
  <div class="dialog" id="create-folder-dialog">
    <h3>新建文件夹</h3><input type="text" id="new-folder-name" placeholder="文件夹名称 (不能包含'/')"><div class="dialog-buttons"><button id="create-folder-cancel">取消</button><button id="create-folder-confirm">确认</button></div>
  </div>
  <div class="dialog" id="move-dialog">
    <h3>移动项目</h3><p id="move-item-name" style="word-break: break-all; font-size: 0.9em; color: var(--text-light);"></p><label for="folder-destination">选择目标文件夹:</label><select id="folder-destination"></select><div class="dialog-buttons"><button id="move-cancel">取消</button><button id="move-confirm">确认</button></div>
  </div>

  <svg class="hidden"><defs>
    <symbol id="icon-search" viewBox="0 0 24 24"><path fill="currentColor" d="M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.61-.59 3.09-1.56 4.23l.27.27h.79l5 5l-1.5 1.5l-5-5v-.79l-.27-.27A6.5 6.5 0 0 1 9.5 16A6.5 6.5 0 0 1 3 9.5A6.5 6.5 0 0 1 9.5 3m0 2C7 5 5 7 5 9.5S7 14 9.5 14S14 12 14 9.5S12 5 9.5 5Z"/></symbol>
    <symbol id="icon-grid-view" viewBox="0 0 24 24"><path fill="currentColor" d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 13h8v-8h-8v8z"/></symbol>
    <symbol id="icon-list-view" viewBox="0 0 24 24"><path fill="currentColor" d="M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h18v2H3v-2z"/></symbol>
    <symbol id="icon-folder" viewBox="0 0 24 24"><path fill="currentColor" d="M10 4H4c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/></symbol>
    <symbol id="icon-file" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-video" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM10 15.5v-5l4 2.5l-4 2.5zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-audio" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-2 15a3 3 0 1 1 0-6a3 3 0 0 1 0 6zm0-8a1 1 0 0 0-1 1v2.55A3 3 0 0 0 9 14a3 3 0 0 0 6 0a3 3 0 0 0-2-2.82V9a1 1 0 0 0-1-1h-2zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-zip" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM9 18H7v-2h2v2zm0-4H7v-2h2v2zm0-4H7V8h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V8h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-doc" viewBox="0 0 24 24"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM16 18H8v-2h8v2zm0-4H8v-2h8v2zm-3-4H8V8h5v2zM6 20V4h7v5h5v11H6z"/></symbol>
    <symbol id="icon-arrow-up" viewBox="0 0 24 24"><path fill="currentColor" d="M7 14l5-5l5 5H7z"/></symbol>
    <symbol id="icon-arrow-down" viewBox="0 0 24 24"><path fill="currentColor" d="M7 10l5 5l5-5H7z"/></symbol>
    <symbol id="icon-lock" viewBox="0 0 24 24"><path fill="currentColor" d="M12 17a2 2 0 0 0 2-2a2 2 0 0 0-2-2a2 2 0 0 0-2 2a2 2 0 0 0 2 2m6-9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h1V6a5 5 0 0 1 5-5a5 5 0 0 1 5 5v2h1m-6-5a3 3 0 0 0-3 3v2h6V6a3 3 0 0 0-3-3Z"/></symbol>
  </defs></svg>

  <div id="login-view" ${loginViewStyleAttribute}>
    <div class="login-box">
      <div class="login-logo">☁️</div>
      <h1>Cloudflare-R2</h1>
      <p class="login-prompt" style="color:var(--text-light)">请输入访问密码</p>
      <div class="input-with-icon">
        <svg class="input-icon"><use xlink:href="#icon-lock"></use></svg>
        <input type="password" id="password-input" placeholder="输入访问密码">
      </div>
      <button id="login-button">授 权 访 问</button>
      <p id="login-error"></p>
    </div>
  </div>

  <div id="app-view" class="hidden">
    <header>
      <h1>文件列表</h1>
      <div class="actions">
        <button id="view-toggle-button" title="切换视图"></button>
        <div class="sort-button-group">
            <button id="sort-by-button"></button>
            <button id="sort-direction-button"></button>
        </div>
        <button id="create-folder-button">新建文件夹</button>
        <div class="desktop-only">
          <button id="select-all-button">全选</button>
          <div id="bulk-actions-container" class="hidden">
              <button id="delete-button">删除选中</button>
              <button id="move-selected-button">移动选中</button>
              <button id="deselect-all-button">取消全选</button>
          </div>
        </div>
        <div class="mobile-only menu-button-wrapper">
          <button id="mobile-select-menu-trigger">全选</button>
          <div id="mobile-select-menu" class="menu-items">
            <div class="menu-item disabled" data-action="move-selected">移动选中</div>
            <div class="menu-item disabled danger" data-action="delete-selected">删除选中</div>
          </div>
        </div>
        <button id="logout-button">登出</button>
      </div>
    </header>
    <div id="breadcrumb"></div>
    <div class="search-wrapper">
        <svg><use xlink:href="#icon-search"></use></svg>
        <input type="search" id="search-input" placeholder="搜索当前文件夹...">
    </div>
    <input type="file" id="file-input" multiple class="hidden">
    <div class="uploader" id="drop-zone"><p>拖拽文件到此处，或点击上传</p></div>
    <div id="file-container"></div>
  </div>

  <div id="lightbox" class="hidden"><button id="lightbox-close" class="lightbox-nav">&times;</button><button id="lightbox-prev" class="lightbox-nav">&#10094;</button><button id="lightbox-next" class="lightbox-nav">&#10095;</button><img id="lightbox-image" src="" alt="Image preview"></div>
  <div id="video-player" class="hidden" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display: flex; justify-content: center; align-items: center; z-index: 5000;">
    <button id="video-close" style="position: absolute; top: 20px; right: 20px; color: #fff; background: transparent; border: none; font-size: 2em; cursor: pointer; z-index: 5001;">&times;</button>
    <video id="video-element" controls style="max-width: 90%; max-height: 90%;" src=""></video>
  </div>
  
  <div id="progress-bar-container">
      <div id="progress-bar"></div>
  </div>

  <footer class="page-footer hidden">
    Copyright © 2025 <a href="https://github.com/6otho/Cloudflare-for-R2" target="_blank" rel="noopener noreferrer">CLOUDFLARE-R2</a> . All Rights Reserved.
  </footer>

<script>
document.addEventListener('DOMContentLoaded', () => {
  const G = {
    loginView: document.getElementById('login-view'), appView: document.getElementById('app-view'), fileContainer: document.getElementById('file-container'),
    loginButton: document.getElementById('login-button'), deleteButton: document.getElementById('delete-button'), viewToggleButton: document.getElementById('view-toggle-button'), selectAllButton: document.getElementById('select-all-button'),
    moveSelectedButton: document.getElementById('move-selected-button'), logoutButton: document.getElementById('logout-button'), passwordInput: document.getElementById('password-input'),
    fileInput: document.getElementById('file-input'), dropZone: document.getElementById('drop-zone'), lightbox: document.getElementById('lightbox'), lightboxImage: document.getElementById('lightbox-image'),
    lightboxClose: document.getElementById('lightbox-close'), lightboxPrev: document.getElementById('lightbox-prev'), lightboxNext: document.getElementById('lightbox-next'),
    themeToggle: document.getElementById('global-theme-toggle'), headerThemeToggle: document.getElementById('header-theme-toggle'),
    renameDialog: document.getElementById('rename-dialog'), newFilename: document.getElementById('new-filename'),
    renameCancel: document.getElementById('rename-cancel'), renameConfirm: document.getElementById('rename-confirm'), createFolderButton: document.getElementById('create-folder-button'),
    createFolderDialog: document.getElementById('create-folder-dialog'), newFolderName: document.getElementById('new-folder-name'), createFolderCancel: document.getElementById('create-folder-cancel'),
    createFolderConfirm: document.getElementById('create-folder-confirm'), moveDialog: document.getElementById('move-dialog'), moveItemName: document.getElementById('move-item-name'),
    folderDestination: document.getElementById('folder-destination'), moveCancel: document.getElementById('move-cancel'), moveConfirm: document.getElementById('move-confirm'),
    videoPlayer: document.getElementById('video-player'), videoElement: document.getElementById('video-element'), videoClose: document.getElementById('video-close'),
    breadcrumb: document.getElementById('breadcrumb'), pageHeader: document.querySelector('.page-header'), pageFooter: document.querySelector('.page-footer'),
    searchInput: document.getElementById('search-input'), sortByButton: document.getElementById('sort-by-button'), sortDirectionButton: document.getElementById('sort-direction-button'),
    mobileSelectMenuTrigger: document.getElementById('mobile-select-menu-trigger'),
    mobileSelectMenu: document.getElementById('mobile-select-menu'),
    bulkActionsContainer: document.getElementById('bulk-actions-container'),
    deselectAllButton: document.getElementById('deselect-all-button'),
    progressBarContainer: document.getElementById('progress-bar-container'),
    progressBar: document.getElementById('progress-bar'),
    password: '', files: [], imageFiles: [], currentImageIndex: -1, theme: localStorage.getItem('theme') || 'dark', viewMode: localStorage.getItem('viewMode') || 'grid',
    isAllSelected: false, currentFileKey: null, currentMenu: null, currentPath: '', keysToMove: [], searchTerm: '', sortBy: 'uploaded', sortDirection: 'desc',
    sortCycle: ['uploaded', 'name', 'size'], sortDisplayNames: { uploaded: '上传时间', name: '名称', size: '大小' },
    uploadState: { totalSize: 0, uploadedSize: 0, active: false }
  };

  const showToast = (message, type = 'accent', duration = 3000) => {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      Object.assign(toast.style, {
        position: 'fixed', left: '50%', bottom: '20px',
        transform: 'translateX(-50%)', color: '#fff', padding: '12px 25px',
        borderRadius: '8px', zIndex: '9999', opacity: '0',
        transition: 'opacity 0.3s, bottom 0.3s ease-in-out',
        boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
      });
      document.body.appendChild(toast);
    }
    const colors = { success: 'var(--c-success)', error: 'var(--c-error)', accent: 'var(--c-accent)' };
    toast.style.backgroundColor = colors[type] || colors.accent;
    toast.textContent = message; 
    
    requestAnimationFrame(() => {
        toast.style.bottom = '40px';
        toast.style.opacity = '1';
    });
    
    setTimeout(() => { 
        toast.style.opacity = '0'; 
        toast.style.bottom = '20px';
    }, duration);
  };
  
  const getFileIcon = (filename) => {
    if (filename.endsWith('/')) return '#icon-folder';
    const ext = filename.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
    if (['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '#icon-audio';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '#icon-zip';
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'md'].includes(ext)) return '#icon-doc';
    return '#icon-file';
  };
  
  const generateVideoThumbnail = (key) => new Promise((resolve, reject) => { const video = document.createElement('video'); const canvas = document.createElement('canvas'); const context = canvas.getContext('2d'); let resolved = false; video.crossOrigin = "anonymous"; video.src = \`/\${encodeURIComponent(key)}\`; video.currentTime = 1; const timeoutId = setTimeout(() => { if (!resolved) { cleanup(); reject(new Error('Thumbnail generation timed out')); } }, 5000); const cleanup = () => { video.removeEventListener('seeked', onSeeked); video.removeEventListener('error', onError); video.src = ''; clearTimeout(timeoutId); }; const onSeeked = () => { if (resolved) return; resolved = true; canvas.width = video.videoWidth; canvas.height = video.videoHeight; context.drawImage(video, 0, 0, canvas.width, canvas.height); const dataUrl = canvas.toDataURL('image/jpeg', 0.8); cleanup(); resolve(dataUrl); }; const onError = (e) => { if (resolved) return; resolved = true; cleanup(); reject(new Error('Failed to load video.')); }; video.addEventListener('seeked', onSeeked, { once: true }); video.addEventListener('error', onError, { once: true }); });
  
  const formatBytes = (bytes, d=2) => { 
    if (bytes === null || bytes === undefined || !isFinite(bytes)) return "信息获取中";
    if (bytes === 0) return "0 Bytes";
    const i = Math.floor(Math.log(bytes) / Math.log(1024)); 
    return \`\${parseFloat((bytes/Math.pow(1024,i)).toFixed(d))} \${["Bytes", "KB", "MB", "GB", "TB"][i]}\`;
  };

  const apiCall = async (endpoint, options = {}) => { const headers = { 'x-auth-password': G.password, ...options.headers }; const response = await fetch(endpoint, { ...options, headers }); if (!response.ok) throw new Error(await response.text() || \`HTTP error! \${response.status}\`); return response; };
  
  const applyTheme = () => {
    document.documentElement.setAttribute('data-theme', G.theme);
    const toggles = [G.themeToggle, G.headerThemeToggle];
    toggles.forEach(toggle => {
      if (!toggle) return;
      const sun = toggle.querySelector('.sun');
      const moon = toggle.querySelector('.moon');
      if (G.theme === 'dark') {
        sun.classList.add('hidden');
        moon.classList.remove('hidden');
      } else {
        sun.classList.remove('hidden');
        moon.classList.add('hidden');
      }
    });
  };

  const toggleTheme = () => { G.theme = G.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('theme', G.theme); applyTheme(); };
  const applyViewMode = () => { 
    G.fileContainer.className = \`file-container \${G.viewMode}-view\`; 
    G.viewToggleButton.innerHTML = G.viewMode === 'grid' ? '<svg><use xlink:href="#icon-grid-view"></use></svg>' : '<svg><use xlink:href="#icon-list-view"></use></svg>'; 
    renderFiles(); 
  };
  const toggleViewMode = () => { G.viewMode = G.viewMode === 'grid' ? 'list' : 'grid'; localStorage.setItem('viewMode', G.viewMode); applyViewMode(); };
  const openLightbox = (index) => { G.currentImageIndex = index; G.lightboxImage.src = \`/\${encodeURIComponent(G.imageFiles[G.currentImageIndex].key)}\`; G.lightbox.classList.remove('hidden'); document.body.style.overflow = 'hidden'; };
  const closeLightbox = () => { G.lightbox.classList.add('hidden'); document.body.style.overflow = 'auto'; };
  const showNextImage = () => openLightbox((G.currentImageIndex + 1) % G.imageFiles.length);
  const showPrevImage = () => openLightbox((G.currentImageIndex - 1 + G.imageFiles.length) % G.imageFiles.length);
  
  const getFolderList = () => {
    const folderSet = new Set(['']);
    G.files.forEach(file => { if (file.key.endsWith('/')) { folderSet.add(file.key); } else if (file.key.includes('/')) { folderSet.add(file.key.substring(0, file.key.lastIndexOf('/') + 1)); } });
    return Array.from(folderSet).sort();
  };
  
  const renderBreadcrumb = () => {
    let html = '<a href="#/" data-path="">根目录</a>'; let current = '';
    if (G.currentPath) { const parts = G.currentPath.slice(0, -1).split('/'); for (const part of parts) { current += part + '/'; html += \`<span> / </span><a href="#/\${current}" data-path="\${current}">\${part}</a>\`; } }
    G.breadcrumb.innerHTML = html;
  };
  
  const getPathFromHash = () => {
    const hash = window.location.hash;
    return hash.startsWith('#/') ? decodeURIComponent(hash.substring(2)) : '';
  };
  
  // --- CRITICAL FIX: Corrected SPA Navigation Logic ---
  const navigateTo = (path) => {
    if (G.currentPath === path) return;
    G.currentPath = path;
    const hash = \`#/\${path}\`; // Simplified and corrected hash creation
    history.pushState({ path }, '', hash);
    renderFiles();
    updateBulkActionsState();
  };

  const updateBulkActionsState = () => {
    const selectedCount = document.querySelectorAll('.checkbox:checked').length;
    const isAnythingSelected = selectedCount > 0;
    G.selectAllButton.classList.toggle('hidden', isAnythingSelected);
    G.bulkActionsContainer.classList.toggle('hidden', !isAnythingSelected);
    const buttonText = isAnythingSelected ? '取消全选' : '全选';
    G.mobileSelectMenuTrigger.textContent = buttonText;
    const moveItem = G.mobileSelectMenu.querySelector('[data-action="move-selected"]');
    const deleteItem = G.mobileSelectMenu.querySelector('[data-action="delete-selected"]');
    moveItem.classList.toggle('disabled', !isAnythingSelected);
    deleteItem.classList.toggle('disabled', !isAnythingSelected);
    if (!isAnythingSelected) G.mobileSelectMenu.classList.remove('show');
  };
  
  const updateSortUI = () => {
    G.sortByButton.textContent = G.sortDisplayNames[G.sortBy];
    const icon = G.sortDirection === 'asc' ? '#icon-arrow-up' : '#icon-arrow-down';
    G.sortDirectionButton.innerHTML = \`<svg><use xlink:href="\${icon}"></use></svg>\`;
  };

  const renderFiles = () => {
    G.fileContainer.innerHTML = ''; renderBreadcrumb();
    let itemsInCurrentPath = []; const foldersInCurrentPath = new Set();
    G.files.forEach(file => { if (file.key.startsWith(G.currentPath)) { const relativePath = file.key.substring(G.currentPath.length); if (relativePath === '') return; const parts = relativePath.split('/'); if (parts.length === 1) { if (relativePath !== '') itemsInCurrentPath.push(file); } else { const folderName = parts[0] + '/'; if (!foldersInCurrentPath.has(folderName)) { foldersInCurrentPath.add(folderName); itemsInCurrentPath.push({ key: G.currentPath + folderName, size: 0, uploaded: file.uploaded }); } } } });
    if (G.searchTerm) { const lowerCaseSearch = G.searchTerm.toLowerCase(); itemsInCurrentPath = itemsInCurrentPath.filter(file => file.key.toLowerCase().includes(lowerCaseSearch)); }
    if (G.currentPath !== '' && !G.searchTerm) { const parentPath = G.currentPath.substring(0, G.currentPath.lastIndexOf('/', G.currentPath.length - 2) + 1); itemsInCurrentPath.unshift({ key: '..', isNav: true, path: parentPath }); }
    if (itemsInCurrentPath.length === 0) { G.fileContainer.innerHTML = \`<p style="text-align:center;color:var(--text-light);">\${G.searchTerm ? '未找到匹配项' : '此文件夹为空'}。</p>\`; updateSortUI(); return; }
    G.imageFiles = itemsInCurrentPath.filter(f => !f.isNav && getFileIcon(f.key) === 'image');
    const sortedItems = itemsInCurrentPath.sort((a, b) => { if (a.isNav) return -1; if (b.isNav) return 1; const aIsFolder = a.key.endsWith('/'); const bIsFolder = b.key.endsWith('/'); if (aIsFolder && !bIsFolder) return -1; if (!aIsFolder && bIsFolder) return 1; let comparison = 0; if (G.sortBy === 'uploaded') { const dateA = a.uploaded ? new Date(a.uploaded) : new Date(0); const dateB = b.uploaded ? new Date(b.uploaded) : new Date(0); comparison = dateA - dateB; } else if (G.sortBy === 'name') { comparison = a.key.localeCompare(b.key); } else if (G.sortBy === 'size') { comparison = a.size - b.size; } return G.sortDirection === 'asc' ? comparison : -comparison; });
    sortedItems.forEach(file => {
      const isNavUp = file.isNav && file.key === '..';
      const displayName = isNavUp ? ".." : file.key.substring(G.currentPath.length);
      const fileTypeIdentifier = isNavUp ? '#icon-folder' : getFileIcon(file.key);
      const isFolder = file.key.endsWith('/') || isNavUp;
      const item = document.createElement('div'); item.className = 'file-item'; item.dataset.key = file.key; if (isNavUp) item.dataset.path = file.path;
      let iconHTML = '';
      if (G.viewMode === 'grid' && fileTypeIdentifier === 'image') { iconHTML = \`<img src="/\${encodeURIComponent(file.key)}" alt="\${displayName}" loading="lazy">\`; } else if (G.viewMode === 'grid' && fileTypeIdentifier === 'video') { iconHTML = \`<img class="video-thumbnail-placeholder" data-video-key="\${file.key}" alt="\${displayName}">\`; } else { let symbolId; switch (fileTypeIdentifier) { case 'image': symbolId = '#icon-file'; break; case 'video': symbolId = '#icon-video'; break; default: symbolId = fileTypeIdentifier; } iconHTML = \`<svg><use xlink:href="\${symbolId}"></use></svg>\`; }
      const actionsHTML = isNavUp ? '' : \` <div class="file-actions"> <div class="menu-button-wrapper"><div class="menu-button" data-key="\${file.key}"></div> <div class="menu-items" data-key="\${file.key}"> <div class="menu-item" data-action="rename">重命名</div> \${!isFolder ? '<div class="menu-item" data-action="download">下载</div>' : ''} <div class="menu-item" data-action="move">移动</div> \${!isFolder ? '<div class="menu-item" data-action="copy-link">复制链接</div>' : ''} <div class="menu-item danger" data-action="delete" style="color: var(--c-error);">删除</div> </div></div> </div>\`;
      const checkboxHTML = isNavUp ? '' : \`<input type="checkbox" class="checkbox" data-key="\${file.key}">\`;
      if (G.viewMode === 'grid') { item.innerHTML = \`<div class="icon">\${iconHTML}</div><div class="info"><div class="filename" title="\${displayName}">\${displayName}</div><div class="filesize">\${isFolder ? '文件夹' : formatBytes(file.size)}</div></div>\${checkboxHTML}\${actionsHTML}\`; } else { item.innerHTML = \`\${checkboxHTML}<div class="icon">\${iconHTML}</div><div class="info"><div class="filename" title="\${displayName}">\${displayName}</div><div class="filesize">\${isFolder ? '文件夹' : formatBytes(file.size)}</div></div>\${actionsHTML}\`; }
      G.fileContainer.appendChild(item);
    });
    if (G.viewMode === 'grid') { document.querySelectorAll('.video-thumbnail-placeholder').forEach(imgPlaceholder => { const key = imgPlaceholder.dataset.videoKey; generateVideoThumbnail(key) .then(thumbSrc => { imgPlaceholder.src = thumbSrc; }) .catch(err => { console.error(\`Failed to generate thumbnail for \${key}:\`, err); const iconContainer = imgPlaceholder.parentElement; if(iconContainer) { iconContainer.innerHTML = '<svg><use xlink:href="#icon-video"></use></svg>'; } }); }); }
    updateSortUI();
  };

  const handleFileAction = (action, key) => { G.currentFileKey = key; G.keysToMove = []; switch(action) { case 'rename': G.newFilename.value = key.endsWith('/') ? key.slice(0, -1).split('/').pop() : key.split('/').pop(); G.renameDialog.classList.add('show'); break; case 'download': const a = document.createElement('a'); a.href = \`/\${encodeURIComponent(key)}\`; a.download = key.split('/').pop(); document.body.appendChild(a); a.click(); document.body.removeChild(a); break; case 'move': const folders = getFolderList(); G.folderDestination.innerHTML = ''; folders.forEach(folder => { const option = document.createElement('option'); option.value = folder; option.textContent = folder === '' ? '(根目录)' : folder; G.folderDestination.appendChild(option); }); G.moveItemName.textContent = \`移动: \${key}\`; G.moveDialog.classList.add('show'); break; case 'copy-link': navigator.clipboard.writeText(\`\${window.location.origin}/\${encodeURIComponent(key)}\`).then(() => showToast('链接已复制')).catch(err => showToast('复制失败: ' + err, 'error')); break; case 'delete': if (confirm(\`确定删除 "\${key}" 吗？\`)) { handleDelete([key]); } break; } };
  const moveOrRenameFile = async (oldKey, newKey) => { if (!newKey || newKey === oldKey) { return; } await apiCall('/api/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldKey, newKey }) }); };
  const handleRename = async () => { const oldKey = G.currentFileKey; const newName = G.newFilename.value.trim(); G.renameDialog.classList.remove('show'); if (!newName) return; const isFolder = oldKey.endsWith('/'); const newKey = G.currentPath + newName + (isFolder ? '/' : ''); try { await moveOrRenameFile(oldKey, newKey); showToast(\`操作成功: "\${newKey}"\`, 'success'); await refreshFileList(); } catch(error) { showToast(\`操作失败: \${error.message}\`, 'error'); } };
  const handleMove = async () => { const oldKey = G.currentFileKey; if (!oldKey) return; const destination = G.folderDestination.value; G.moveDialog.classList.remove('show'); const filename = oldKey.endsWith('/') ? oldKey.slice(0, -1).split('/').pop() + '/' : oldKey.split('/').pop(); const newKey = destination + filename; try { await moveOrRenameFile(oldKey, newKey); showToast(\`成功移动到: "\${newKey}"\`, 'success'); await refreshFileList(); } catch (error) { showToast(\`移动失败: \${error.message}\`, 'error'); } };
  const handleCreateFolder = async () => {
    let folderName = G.newFolderName.value.trim();
    G.createFolderDialog.classList.remove('show');
    if (!folderName || folderName.includes('/')) { showToast('创建失败: 文件夹名称无效。', 'error'); return; }
    folderName = G.currentPath + folderName; 
    const selectedKeys = Array.from(document.querySelectorAll('.checkbox:checked')).map(cb => cb.dataset.key);
    try {
      await apiCall('/api/create-folder', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ folderName }) });
      const destinationFolder = \`\${folderName}/\`;
      if (selectedKeys.length > 0) {
        showToast(\`文件夹 "\${destinationFolder}" 创建成功。正在移动 \${selectedKeys.length} 个项目...\`, 'accent');
        const movePromises = selectedKeys.map(oldKey => { const baseName = oldKey.endsWith('/') ? oldKey.slice(0, -1).split('/').pop() + '/' : oldKey.split('/').pop(); const newKey = destinationFolder + baseName; return moveOrRenameFile(oldKey, newKey); });
        await Promise.all(movePromises); showToast(\`成功移动 \${selectedKeys.length} 个项目到 "\${destinationFolder}"\`, 'success');
      } else { showToast(\`文件夹 "\${destinationFolder}" 创建成功\`, 'success'); }
      G.newFolderName.value = ''; await refreshFileList();
    } catch(error) { showToast('操作失败: ' + error.message, 'error'); }
  };
  const handleBulkMove = async () => {
    const destination = G.folderDestination.value; const keys = G.keysToMove; G.moveDialog.classList.remove('show');
    if (!keys || keys.length === 0) return;
    showToast(\`正在移动 \${keys.length} 个项目...\`);
    try {
        const movePromises = keys.map(oldKey => { const filename = oldKey.endsWith('/') ? oldKey.slice(0, -1).split('/').pop() + '/' : oldKey.split('/').pop(); const newKey = destination + filename; return moveOrRenameFile(oldKey, newKey); });
        await Promise.all(movePromises); showToast(\`成功移动 \${keys.length} 个项目！\`, 'success');
    } catch (error) { showToast(\`移动失败: \${error.message}\`, 'error'); }
    finally { G.keysToMove = []; await refreshFileList(); }
  };

  const toggleSelectAll = (forceState) => {
    G.isAllSelected = (typeof forceState === 'boolean') ? forceState : !G.isAllSelected;
    document.querySelectorAll('.file-item:not([data-key=".."]) .checkbox').forEach(checkbox => { 
      checkbox.checked = G.isAllSelected; 
      checkbox.closest('.file-item').classList.toggle('selected', G.isAllSelected); 
    });
    updateBulkActionsState();
  };

  const refreshFileList = async () => {
    try { 
        const response = await apiCall('/api/list'); G.files = await response.json(); G.isAllSelected = false; 
        renderFiles(); 
        updateBulkActionsState();
    } catch (error) { console.error(error); showToast('刷新列表失败', 'error'); }
  };
  
  const handleLogin = async () => {
    const pw = G.passwordInput.value; if (!pw) return; G.password = pw; G.loginButton.textContent = "验证中..."; G.loginButton.disabled = true;
    try { 
      G.currentPath = getPathFromHash();
      await apiCall('/api/list'); localStorage.setItem('r2-password', pw);
      if (G.pageHeader) G.pageHeader.classList.remove('hidden'); 
      if (G.themeToggle) G.themeToggle.classList.add('hidden');
      if (G.pageFooter) G.pageFooter.classList.add('hidden');
      G.loginView.classList.add('hidden'); G.appView.classList.remove('hidden'); 
      await refreshFileList(); 
    } catch (error) { document.getElementById('login-error').textContent = '密码错误'; setTimeout(()=> document.getElementById('login-error').textContent = '', 3000); }
    finally { G.loginButton.textContent = "授 权 访 问"; G.loginButton.disabled = false; }
  };

  const handleLogout = () => { if (confirm('您确定要登出吗？')) { localStorage.removeItem('r2-password'); location.hash = ''; location.reload(); } };
  
  const showProgressBar = () => G.progressBarContainer.classList.add('visible');
  const hideProgressBar = () => {
      G.progressBarContainer.classList.remove('visible');
      setTimeout(() => { G.progressBar.style.width = '0%'; G.progressBar.classList.remove('success'); }, 300);
  };
  const updateProgressBar = (percent, state = 'primary') => {
      G.progressBar.style.width = percent + '%';
      G.progressBar.className = 'progress-bar';
      if(state === 'success') G.progressBar.classList.add('success');
  };
  
  const uploadFileWithProgress = (file, key, onProgress) => {
      return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.addEventListener('progress', e => {
              if (e.lengthComputable) onProgress(e.loaded);
          });
          xhr.addEventListener('load', () => {
              if (xhr.status >= 200 && xhr.status < 300) resolve(file.size);
              else reject(new Error(xhr.responseText || '上传失败，状态码: ' + xhr.status));
          });
          xhr.addEventListener('error', () => reject(new Error('上传时发生网络错误')));
          xhr.addEventListener('abort', () => reject(new Error('上传已取消')));
          xhr.open('PUT', \`/api/upload/\${encodeURIComponent(key)}\`, true);
          xhr.setRequestHeader('x-auth-password', G.password);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.send(file);
      });
  };

  const handleUpload = async (files) => {
    if (G.uploadState.active) { showToast("已有上传任务在进行中。", 'accent', 2000); return; }
    if (files.length === 0) return;
    
    G.uploadState.active = true;
    const MAX_SIZE = 100 * 1024 * 1024;
    let totalSize = 0;
    for (const file of files) {
        if (file.size > MAX_SIZE) {
            showToast('文件大于100MB上传不成功', 'error', 5000);
            G.uploadState.active = false;
            return;
        }
        totalSize += file.size;
    }
    
    G.uploadState.totalSize = totalSize;
    G.uploadState.uploadedSize = 0;
    updateProgressBar(0);
    showProgressBar();

    try {
        let uploadedSizeSoFar = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const uploadKey = G.currentPath + file.name;
            const onProgress = (loaded) => {
                const currentTotalUploaded = uploadedSizeSoFar + loaded;
                const percent = totalSize > 0 ? Math.round((currentTotalUploaded / totalSize) * 100) : 0;
                updateProgressBar(percent);
            };
            const sizeOfThisFile = await uploadFileWithProgress(file, uploadKey, onProgress);
            uploadedSizeSoFar += sizeOfThisFile;
        }
        
        updateProgressBar(100, 'success');
        showToast(\`\${files.length} 个文件全部上传成功！\`, 'success');
        await refreshFileList();
        
    } catch (error) {
        showToast(\`上传失败: \${error.message}\`, 'error', 5000);
        console.error("Upload failed:", error);
    } finally {
        setTimeout(hideProgressBar, 500);
        G.uploadState.active = false;
    }
  };

  const handleDelete = async (keys) => {
    if (!keys || keys.length === 0) keys = Array.from(document.querySelectorAll('.checkbox:checked')).map(cb => cb.dataset.key);
    if (keys.length === 0) { showToast("请先选择要删除的项目", 'accent'); return; }
    if (!confirm(\`你确定要删除选中的 \${keys.length} 个项目吗？此操作不可恢复。\`)) return;
    try { await apiCall('/api/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ keys }) }); showToast(\`成功删除 \${keys.length} 个项目\`, 'success'); await refreshFileList(); } catch (error) { showToast(\`删除失败: \${error.message}\`, 'error'); }
  };

  const setupEventListeners = () => {
    G.themeToggle.addEventListener('click', toggleTheme);
    G.headerThemeToggle.addEventListener('click', toggleTheme);
    G.loginButton.addEventListener('click', handleLogin);
    G.logoutButton.addEventListener('click', handleLogout);
    G.passwordInput.addEventListener('keypress', e => e.key === 'Enter' && handleLogin());
    
    G.createFolderButton.addEventListener('click', () => { G.newFolderName.value = ''; G.createFolderDialog.classList.add('show'); });
    G.viewToggleButton.addEventListener('click', toggleViewMode);
    
    G.selectAllButton.addEventListener('click', () => toggleSelectAll(true));
    G.deselectAllButton.addEventListener('click', () => toggleSelectAll(false));
    G.deleteButton.addEventListener('click', () => handleDelete());
    G.moveSelectedButton.addEventListener('click', () => {
        const selectedKeys = Array.from(document.querySelectorAll('.checkbox:checked')).map(cb => cb.dataset.key);
        if (selectedKeys.length === 0) { showToast("请先选择要移动的项目", 'accent'); return; }
        G.keysToMove = selectedKeys; G.currentFileKey = null;
        const folders = getFolderList(); G.folderDestination.innerHTML = '';
        folders.forEach(folder => { const option = document.createElement('option'); option.value = folder; option.textContent = folder === '' ? '(根目录)' : folder; G.folderDestination.appendChild(option); });
        G.moveItemName.textContent = \`移动 \${G.keysToMove.length} 个项目\`; G.moveDialog.classList.add('show');
    });

    G.mobileSelectMenuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelectAll(!G.isAllSelected);
        if (G.isAllSelected) G.mobileSelectMenu.classList.add('show');
        else G.mobileSelectMenu.classList.remove('show');
    });

    G.mobileSelectMenu.addEventListener('click', (e) => {
        const target = e.target.closest('.menu-item');
        if (!target || target.classList.contains('disabled')) return;
        const action = target.dataset.action;
        switch(action) {
            case 'move-selected': G.moveSelectedButton.click(); break;
            case 'delete-selected': handleDelete(); break; 
        }
        G.mobileSelectMenu.classList.remove('show');
    });

    G.dropZone.addEventListener('click', () => G.fileInput.click());
    G.fileInput.addEventListener('change', () => { handleUpload(G.fileInput.files); G.fileInput.value = ''; });
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => document.body.addEventListener(e, p => p.preventDefault()));
    ['dragenter', 'dragover'].forEach(eventName => G.dropZone.addEventListener(eventName, () => G.dropZone.classList.add('dragging')));
    ['dragleave', 'drop'].forEach(eventName => G.dropZone.addEventListener(eventName, () => G.dropZone.classList.remove('dragging')));
    G.dropZone.addEventListener('drop', e => handleUpload(e.dataTransfer.files));
    G.lightboxClose.addEventListener('click', closeLightbox);
    G.lightboxPrev.addEventListener('click', showPrevImage);
    G.lightboxNext.addEventListener('click', showNextImage);
    document.addEventListener('keydown', e => { if (!G.lightbox.classList.contains('hidden')) { if (e.key === 'Escape') closeLightbox(); if (e.key === 'ArrowLeft') showPrevImage(); if (e.key === 'ArrowRight') showNextImage(); } });
    G.renameCancel.addEventListener('click', () => G.renameDialog.classList.remove('show'));
    G.renameConfirm.addEventListener('click', handleRename);
    G.createFolderCancel.addEventListener('click', () => G.createFolderDialog.classList.remove('show'));
    G.createFolderConfirm.addEventListener('click', handleCreateFolder);
    G.moveCancel.addEventListener('click', () => G.moveDialog.classList.remove('show'));
    G.moveConfirm.addEventListener('click', () => { if (G.keysToMove.length > 0) { handleBulkMove(); } else { handleMove(); } });
    G.videoClose.addEventListener('click', () => { G.videoPlayer.classList.add('hidden'); G.videoElement.pause(); G.videoElement.src = ''; });
    
    G.breadcrumb.addEventListener('click', e => {
      e.preventDefault();
      const target = e.target.closest('a');
      if (target && typeof target.dataset.path !== 'undefined') navigateTo(target.dataset.path);
    });

    G.fileContainer.addEventListener('click', e => {
        const target = e.target;
        const fileItem = target.closest('.file-item');
        if (!fileItem) return;
        const key = fileItem.dataset.key;
        if (target.matches('.checkbox') || target.closest('.file-actions')) {
            if (target.matches('.checkbox')) {
                fileItem.classList.toggle('selected', target.checked);
                updateBulkActionsState();
            }
            if (target.closest('.menu-button')) {
                e.stopPropagation();
                const menuButton = target.closest('.menu-button');
                const menu = fileItem.querySelector('.menu-items');
                if (G.currentMenu && G.currentMenu !== menu) {
                    G.currentMenu.classList.remove('show', 'menu-popup-up', 'menu-popup-left');
                    G.currentMenu.closest('.file-item')?.classList.remove('menu-active');
                }
                const isNowVisible = !menu.classList.contains('show');
                menu.classList.toggle('show', isNowVisible);
                fileItem.classList.toggle('menu-active', isNowVisible);
                if (isNowVisible) {
                    const buttonRect = menuButton.getBoundingClientRect();
                    if (buttonRect.bottom + menu.offsetHeight > window.innerHeight) menu.classList.add('menu-popup-up'); 
                    else menu.classList.remove('menu-popup-up');
                    if (buttonRect.left + menu.offsetWidth > window.innerWidth) menu.classList.add('menu-popup-left'); 
                    else menu.classList.remove('menu-popup-left');
                    G.currentMenu = menu;
                } else { G.currentMenu = null; }
            }
            if (target.closest('.menu-item')) {
                e.stopPropagation();
                const action = target.closest('.menu-item').dataset.action;
                if (action) {
                    handleFileAction(action, key);
                    target.closest('.menu-items').classList.remove('show');
                    fileItem.classList.remove('menu-active');
                    G.currentMenu = null;
                }
            }
            return;
        }
        const isFolder = key.endsWith('/') || key === '..';
        if (G.viewMode === 'grid' && window.innerWidth <= 767 && !isFolder && target.closest('.info')) {
            const checkbox = fileItem.querySelector('.checkbox');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                fileItem.classList.toggle('selected', checkbox.checked);
                updateBulkActionsState();
            }
            return;
        }
        if (isFolder) {
            const newPath = (key === '..') ? fileItem.dataset.path : key;
            navigateTo(newPath);
        } else {
            const fileType = getFileIcon(key);
            if (fileType === 'image') {
                const imageIndex = G.imageFiles.findIndex(f => f.key === key);
                if (imageIndex > -1) openLightbox(imageIndex);
            } else if (fileType === 'video') {
                G.videoElement.src = \`/\${encodeURIComponent(key)}\`;
                G.videoPlayer.classList.remove('hidden');
                G.videoElement.play().catch(err => console.error("Video play failed:", err));
            }
        }
    });

    window.addEventListener('popstate', (e) => {
        const path = getPathFromHash();
        if (G.currentPath !== path) {
            G.currentPath = path;
            renderFiles();
            updateBulkActionsState();
        }
    });

    G.searchInput.addEventListener('input', e => { G.searchTerm = e.target.value; renderFiles(); });
    G.sortByButton.addEventListener('click', () => { const currentIndex = G.sortCycle.indexOf(G.sortBy); const nextIndex = (currentIndex + 1) % G.sortCycle.length; G.sortBy = G.sortCycle[nextIndex]; renderFiles(); });
    G.sortDirectionButton.addEventListener('click', () => { G.sortDirection = G.sortDirection === 'asc' ? 'desc' : 'asc'; renderFiles(); });

    document.addEventListener('click', (e) => {
        if (G.currentMenu && !e.target.closest('.menu-button-wrapper')) {
            G.currentMenu.classList.remove('show', 'menu-popup-up', 'menu-popup-left');
            G.currentMenu.closest('.file-item')?.classList.remove('menu-active');
            G.currentMenu = null;
        }
        if (G.mobileSelectMenu.classList.contains('show') && !e.target.closest('#mobile-select-menu-trigger')) {
            G.mobileSelectMenu.classList.remove('show');
        }
    });
    
    window.addEventListener('resize', () => {
      const isLoginPage = !G.loginView.classList.contains('hidden');
      if (isLoginPage) { G.themeToggle.classList.remove('hidden'); }
    });
  };
  
  const init = () => {
    applyTheme();
    const savedPassword = localStorage.getItem('r2-password');
    if (savedPassword) {
      G.passwordInput.value = savedPassword;
      handleLogin();
    } else {
      if (G.pageHeader) G.pageHeader.classList.remove('hidden');
      if (G.themeToggle) G.themeToggle.classList.add('hidden');
      if (G.pageFooter) G.pageFooter.classList.remove('hidden');
    }
    applyViewMode();
    setupEventListeners();
  };
  
  init();
});
</script>

</body>
</html>
`;
  }
};
