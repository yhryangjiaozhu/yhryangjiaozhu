// 前端交互逻辑
(function () {
  'use strict';

  // ---------- 品牌配置注入 ----------
  let CFG = {
    siteName: '公众号文章导出',
    siteSlogan: '粘贴文章链接，一键导出并打包下载',
    footerText: '',
    accentColor: '#e8543f',
    contact: '',
    maxBatch: 20,
    maxCollection: 30,
    pdf: true,
  };

  async function loadConfig() {
    try {
      const r = await fetch('/api/config');
      CFG = Object.assign(CFG, await r.json());
    } catch (e) {}
    applyBrand();
  }

  function applyBrand() {
    document.documentElement.style.setProperty('--accent', CFG.accentColor);
    document.title = CFG.siteName;
    document.getElementById('siteName').textContent = CFG.siteName;
    document.getElementById('siteSlogan').textContent = CFG.siteSlogan;
    document.getElementById('footerText').textContent = CFG.footerText;
    const cr = document.getElementById('copyright');
    cr.textContent = CFG.contact
      ? `${CFG.siteName} · ${CFG.contact}`
      : `© ${new Date().getFullYear()} ${CFG.siteName}`;
    document.getElementById('maxBatch').textContent = CFG.maxBatch;
    document.getElementById('maxCollection').textContent = CFG.maxCollection;
    if (!CFG.pdf) {
      document.getElementById('pdfHint').style.display = 'block';
      const pdfCb = document.querySelector('#formatChecks input[value="pdf"]');
      if (pdfCb) {
        pdfCb.disabled = true;
        pdfCb.checked = false;
      }
    }
  }

  // ---------- Tab 切换 ----------
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tab-panel');
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      panels.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      document.querySelector(`.tab-panel[data-panel="${t.dataset.tab}"]`).classList.add('active');
    })
  );

  // ---------- 读取选项 ----------
  function getFormats() {
    return [...document.querySelectorAll('#formatChecks input:checked')].map((c) => c.value);
  }
  function getOptions() {
    return {
      withCover: document.getElementById('optCover').checked,
      embedImages: document.getElementById('optEmbed').checked,
    };
  }

  // ---------- 进度条 ----------
  const progressPanel = document.getElementById('progressPanel');
  const progressText = document.getElementById('progressText');
  function showProgress(text) {
    progressText.textContent = text || '正在抓取并生成，请稍候…';
    progressPanel.style.display = 'flex';
  }
  function hideProgress() {
    progressPanel.style.display = 'none';
  }

  // ---------- 下载工具 ----------
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function postZip(api, body, filename, loadingText) {
    showProgress(loadingText);
    setButtons(true);
    try {
      const res = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = '请求失败';
        try {
          msg = (await res.json()).error || msg;
        } catch (e) {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      triggerDownload(blob, filename + '.zip');
      // 读取每篇解析状态，汇总成功/失败
      let summary = '';
      const metaRaw = res.headers.get('X-Export-Meta');
      if (metaRaw) {
        try {
          const metas = JSON.parse(decodeURIComponent(metaRaw));
          const okCount = metas.filter((m) => !m.error).length;
          const fail = metas.filter((m) => m.error);
          if (fail.length) {
            summary =
              `导出完成：${okCount} 篇成功，${fail.length} 篇失败。\n` +
              fail
                .slice(0, 3)
                .map((f) => '· ' + (f.url || f.title || '未知') + '：' + (f.error || ''))
                .join('\n');
            if (fail.length > 3) summary += `\n…等 ${fail.length} 篇`;
          }
        } catch (e) {}
      }
      if (summary) setTimeout(() => alert(summary), 300);
      return true;
    } finally {
      hideProgress();
      setButtons(false);
    }
  }

  function setButtons(disabled) {
    document.querySelectorAll('button.btn, button.tab').forEach((b) => (b.disabled = disabled));
  }

  // ---------- 任务记录 ----------
  const REC_KEY = 'gzh_exporter_records';
  function getRecords() {
    try {
      return JSON.parse(localStorage.getItem(REC_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }
  function addRecord(title, status) {
    const list = getRecords();
    list.unshift({ title, status, time: new Date().toLocaleString('zh-CN') });
    localStorage.setItem(REC_KEY, JSON.stringify(list.slice(0, 30)));
    renderRecords();
  }
  function renderRecords() {
    const ul = document.getElementById('recordList');
    const list = getRecords();
    if (!list.length) {
      ul.innerHTML = '<li class="empty">暂无任务，下载记录只在本浏览器可见。</li>';
      return;
    }
    ul.innerHTML = list
      .map(
        (r) =>
          `<li><span class="r-title ${r.status === 'error' ? 'r-err' : ''}">${escapeHtml(
            r.title
          )}</span><span class="r-time">${r.time}</span></li>`
      )
      .join('');
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  document.getElementById('clearRecords').addEventListener('click', () => {
    localStorage.removeItem(REC_KEY);
    renderRecords();
  });

  // ---------- 单篇 ----------
  document.getElementById('btnSingle').addEventListener('click', async () => {
    const url = document.getElementById('singleUrl').value.trim();
    if (!url) return alert('请粘贴文章链接');
    const formats = getFormats();
    if (!formats.length) return alert('请至少选择一种导出格式');
    try {
      const ok = await postZip(
        '/api/article',
        { url, formats, ...getOptions() },
        'article',
        '正在抓取文章并生成文件…'
      );
      if (ok) addRecord(url.slice(0, 60), 'done');
    } catch (e) {
      addRecord('失败：' + e.message, 'error');
      alert('导出失败：' + e.message);
    }
  });

  // ---------- 批量 ----------
  document.getElementById('btnBatch').addEventListener('click', async () => {
    const raw = document.getElementById('batchUrls').value.trim();
    if (!raw) return alert('请粘贴链接，每行一条');
    const urls = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return alert('没有有效链接');
    const formats = getFormats();
    if (!formats.length) return alert('请至少选择一种导出格式');
    const max = CFG.maxBatch || 20;
    if (urls.length > max) {
      if (!confirm(`共 ${urls.length} 条，超过上限 ${max} 条，将只处理前 ${max} 条。继续？`)) return;
    }
    try {
      const ok = await postZip(
        '/api/batch',
        { urls, formats, ...getOptions() },
        'batch',
        `正在批量抓取 ${Math.min(urls.length, max)} 篇文章…`
      );
      if (ok) addRecord(`批量 ${Math.min(urls.length, max)} 篇`, 'done');
    } catch (e) {
      addRecord('失败：' + e.message, 'error');
      alert('导出失败：' + e.message);
    }
  });

  // ---------- 合集 ----------
  let collectionArticles = [];
  document.getElementById('btnList').addEventListener('click', async () => {
    const url = document.getElementById('collectionUrl').value.trim();
    if (!url) return alert('请粘贴合集链接');
    showProgress('正在解析合集文章列表…');
    setButtons(true);
    try {
      const res = await fetch('/api/collection/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '解析失败');
      collectionArticles = data.articles || [];
      renderCollection();
    } catch (e) {
      alert('合集解析失败：' + e.message + '\n（微信合集列表有时需登录态，可改用「单篇/批量」模式粘贴具体文章链接）');
    } finally {
      hideProgress();
      setButtons(false);
    }
  });

  function renderCollection() {
    const box = document.getElementById('collectionResult');
    const listEl = document.getElementById('articleList');
    document.getElementById('crCount').textContent = `共 ${collectionArticles.length} 篇`;
    if (!collectionArticles.length) {
      box.style.display = 'block';
      listEl.innerHTML = '<div style="padding:14px;color:#888;font-size:13px;">未解析到文章。该合集可能需要微信登录态，或链接非「复制链接」得到的合集地址。</div>';
      return;
    }
    box.style.display = 'block';
    listEl.innerHTML = collectionArticles
      .map(
        (a, i) =>
          `<label class="article-item"><input type="checkbox" data-i="${i}" checked><span>${escapeHtml(
            a.title || a.url
          )}</span></label>`
      )
      .join('');
  }

  document.getElementById('selAll').addEventListener('click', () =>
    document.querySelectorAll('#articleList input').forEach((c) => (c.checked = true))
  );
  document.getElementById('selNone').addEventListener('click', () =>
    document.querySelectorAll('#articleList input').forEach((c) => (c.checked = false))
  );

  document.getElementById('btnDownloadSel').addEventListener('click', async () => {
    const sel = [...document.querySelectorAll('#articleList input:checked')].map((c) => collectionArticles[+c.dataset.i]);
    if (!sel.length) return alert('请至少选择一篇文章');
    const max = CFG.maxCollection || 30;
    let chosen = sel;
    if (sel.length > max) {
      if (!confirm(`已选 ${sel.length} 篇，超过上限 ${max} 篇，将只处理前 ${max} 篇。继续？`)) return;
      chosen = sel.slice(0, max);
    }
    const formats = getFormats();
    if (!formats.length) return alert('请至少选择一种导出格式');
    try {
      const ok = await postZip(
        '/api/collection/download',
        { articles: chosen.map((a) => a.url), formats, ...getOptions() },
        'collection',
        `正在下载 ${chosen.length} 篇合集文章…`
      );
      if (ok) addRecord(`合集 ${chosen.length} 篇`, 'done');
    } catch (e) {
      addRecord('失败：' + e.message, 'error');
      alert('导出失败：' + e.message);
    }
  });

  // ---------- 初始化 ----------
  loadConfig();
  renderRecords();
})();
