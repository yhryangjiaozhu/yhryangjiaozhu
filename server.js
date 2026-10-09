// 后端服务：提供文章/批量/合集导出 API 与前端静态托管
const express = require('express');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const { fetchText } = require('./lib/fetch');
const { exportByHtml, pdfAvailable } = require('./lib/convert');
const { listCollection } = require('./lib/collection');

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查（前端据此判断是否可用 PDF）
app.get('/health', (req, res) => {
  res.json({ pdf: pdfAvailable(), siteName: config.siteName });
});

// 品牌配置（前端据此渲染站点名/标语/主题色，单一数据源在 config.js）
app.get('/api/config', (req, res) => {
  res.json({
    siteName: config.siteName,
    siteSlogan: config.siteSlogan,
    brandOwner: config.brandOwner,
    footerText: config.footerText,
    accentColor: config.accentColor,
    contact: config.contact,
    qrcode: config.qrcode,
    qrcodeAlt: config.qrcodeAlt,
    defaultBiz: config.defaultBiz,
    maxBatch: config.maxBatch,
    maxCollection: config.maxCollection,
    pdf: pdfAvailable(),
  });
});

// 单篇文章
app.post('/api/article', async (req, res) => {
  try {
    const { url, formats = ['html', 'markdown'], withCover = false, embedImages = true } = req.body || {};
    if (!url) return res.status(400).json({ error: '缺少文章链接' });
    const html = await fetchText(url, { referer: url });
    const { zipPath, workDir, metas } = await exportByHtml([html], formats, {
      withCover,
      embedImages,
    });
    streamZip(res, zipPath, workDir, 'article', metas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 批量（最多 maxBatch 条）
app.post('/api/batch', async (req, res) => {
  try {
    let { urls = [], formats = ['html', 'markdown'], withCover = false, embedImages = true } = req.body || {};
    urls = urls.filter(Boolean).slice(0, config.maxBatch);
    if (!urls.length) return res.status(400).json({ error: '没有有效的链接' });
    const htmls = [];
    for (const u of urls) {
      try {
        htmls.push(await fetchText(u, { referer: u }));
      } catch (e) {
        htmls.push({ html: null, url: u, error: e.message });
      }
    }
    const { zipPath, workDir, metas } = await exportByHtml(htmls, formats, {
      withCover,
      embedImages,
    });
    if (!metas.length) return res.status(400).json({ error: '全部链接抓取失败，请检查链接是否正确' });
    streamZip(res, zipPath, workDir, 'batch', metas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 合集：列出文章
app.post('/api/collection/list', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: '缺少合集链接' });
    const articles = await listCollection(url);
    res.json({ articles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 合集：下载选中文章
app.post('/api/collection/download', async (req, res) => {
  try {
    const { articles = [], formats = ['html', 'markdown'], withCover = false, embedImages = true } = req.body || {};
    const urls = articles
      .map((a) => (typeof a === 'string' ? a : a.url))
      .filter(Boolean)
      .slice(0, config.maxCollection);
    if (!urls.length) return res.status(400).json({ error: '没有选中的文章' });
    const htmls = [];
    for (const u of urls) {
      try {
        htmls.push(await fetchText(u, { referer: u }));
      } catch (e) {
        htmls.push({ html: null, url: u, error: e.message });
      }
    }
    const { zipPath, workDir, metas } = await exportByHtml(htmls, formats, {
      withCover,
      embedImages,
    });
    if (!metas.length) return res.status(400).json({ error: '全部文章抓取失败' });
    streamZip(res, zipPath, workDir, 'collection', metas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 流式返回 zip，结束后清理临时文件
function streamZip(res, zipPath, workDir, name, metas) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(name)}.zip"`
  );
  // 把每篇文章的解析状态（含失败原因/链接）通过响应头回传，供前端展示
  if (metas && metas.length) {
    res.setHeader('X-Export-Meta', encodeURIComponent(JSON.stringify(metas)));
  }
  const stream = fs.createReadStream(zipPath);
  stream.on('end', () => cleanup(zipPath, workDir));
  stream.on('error', () => cleanup(zipPath, workDir));
  stream.pipe(res);
}

function cleanup(zipPath, workDir) {
  try {
    if (zipPath) fs.unlinkSync(zipPath);
  } catch (e) {}
  try {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  } catch (e) {}
}

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`✅ ${config.siteName} 已启动： http://localhost:${PORT}`);
  console.log(`   PDF 支持：${pdfAvailable() ? '已就绪(Chromium)' : '未安装 Chromium（PDF 将跳过，详见 README）'}`);
});
