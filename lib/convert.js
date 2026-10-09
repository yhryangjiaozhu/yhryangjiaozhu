// 转换与打包模块：图片下载、HTML/单文件HTML/Markdown/Word/PDF 生成、ZIP 打包
const fs = require('fs');
const path = require('path');
const os = require('os');
const archiver = require('archiver');
const TurndownService = require('turndown');
const turndownPluginGfm = require('turndown-plugin-gfm');
const cheerio = require('cheerio');
const htmlDocx = require('html-docx-js');

const { parseArticle, parseArticleStrict } = require('./parse');
const { fetchBuffer, UA } = require('./fetch');
const config = require('../config');

const gfm = turndownPluginGfm.gfm;

// ---------- 工具 ----------
function extFromUrl(url) {
  const m = url.match(/wx_fmt=([a-z0-9]+)/i);
  if (m) {
    const e = m[1].toLowerCase();
    return e === 'jpeg' ? 'jpg' : e;
  }
  const e = (url.split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1];
  return e ? e.toLowerCase() : 'jpg';
}

function sanitizeName(s) {
  return (s || 'article')
    .replace(/[\\/:*?"<>|\n\r\t]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mimeOf(ext) {
  ext = (ext || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'bmp') return 'image/bmp';
  return 'image/jpeg';
}

// ---------- 图片下载 ----------
// 微信图片地址归一到「原图高清」：
// - 去掉 tp=webp（有损压缩，看着发糊），强制返回 jpeg 原图（像素尺寸不变、画质更高）
// - 去掉 wx_lazy / wxfrom / wx_co 等懒加载/无关参数（不影响分辨率，但更干净）
// 注意：动图(gif)保持 tp=gif 不变，避免破坏动画。
function normalizeWeixinImageUrl(url) {
  if (typeof url !== 'string') return url;
  if (!/mmbiz\.(qpic|qq)\.cn/i.test(url)) return url;
  try {
    const u = new URL(url);
    const tp = u.searchParams.get('tp');
    if (tp === 'webp') u.searchParams.set('tp', 'jpg');
    u.searchParams.delete('wx_lazy');
    u.searchParams.delete('wxfrom');
    u.searchParams.delete('wx_co');
    u.searchParams.delete('idx');
    return u.toString();
  } catch (e) {
    return url;
  }
}

async function downloadImage(url, referer, destPath) {
  const realUrl = normalizeWeixinImageUrl(url);
  const buf = await fetchBuffer(realUrl, { referer });
  fs.writeFileSync(destPath, buf);
  return buf;
}

// 下载全部图片，返回 url -> 相对路径(images/xxx.ext) 的映射
async function downloadImages(urls, dir, referer) {
  fs.mkdirSync(dir, { recursive: true });
  const map = {};
  let i = 0;
  for (const u of urls) {
    if (map[u]) continue;
    const ext = extFromUrl(u);
    const fname = `img_${String(i + 1).padStart(3, '0')}.${ext}`;
    const fpath = path.join(dir, fname);
    try {
      await downloadImage(u, referer, fpath);
      map[u] = `images/${fname}`;
    } catch (e) {
      // 单张失败不影响整体，跳过
    }
    i++;
  }
  return map;
}

// 把正文 HTML 里的绝对图片地址替换为本地相对路径
function rewriteContentImages(contentHtml, map) {
  let h = contentHtml;
  for (const [u, local] of Object.entries(map)) {
    h = h.split(u).join(local);
  }
  return h;
}

// 把正文里的图片替换为 base64 data URI（用于 Word / 单文件HTML 内联）
function base64Images(contentHtml, dir, map) {
  let h = contentHtml;
  for (const [u, local] of Object.entries(map)) {
    const fpath = path.join(dir, path.basename(local));
    if (fs.existsSync(fpath)) {
      const b = fs.readFileSync(fpath);
      const ext = path.extname(fpath).replace('.', '');
      const dataUri = `data:${mimeOf(ext)};base64,${b.toString('base64')}`;
      h = h.split(u).join(dataUri);
      h = h.split(local).join(dataUri);
    }
  }
  return h;
}

// ---------- 生成各类文档 ----------
function buildHtml(meta, contentHtml, opts = {}) {
  const { withCover, coverSrc, singleFile } = opts;
  const coverHtml =
    withCover && coverSrc
      ? `<img class="cover" src="${coverSrc}" alt="封面">`
      : '';
  const metaLine = [
    meta.account && `公众号：${escapeHtml(meta.account)}`,
    meta.author && `作者：${escapeHtml(meta.author)}`,
    meta.publishTime && `发布：${escapeHtml(meta.publishTime)}`,
  ]
    .filter(Boolean)
    .join('　·　');
  const accent = config.accentColor || '#e8543f';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif;
         max-width: 760px; margin: 0 auto; padding: 28px 20px 60px; color: #2b2b2b; line-height: 1.85; font-size: 16px; }
  h1.title { font-size: 26px; line-height: 1.4; margin: 0 0 14px; }
  .meta { color: #999; font-size: 13px; border-bottom: 1px solid #eee; padding-bottom: 12px; margin-bottom: 22px; }
  .cover { width: 100%; border-radius: 8px; margin-bottom: 22px; }
  .content { word-break: break-word; }
  .content img { max-width: 100%; height: auto; display: block; margin: 18px auto; border-radius: 4px; }
  .content pre { background: #f6f6f6; padding: 14px 16px; border-radius: 8px; overflow: auto; font-size: 14px; line-height: 1.6; }
  .content code { background: #f2f2f2; padding: 2px 5px; border-radius: 4px; font-size: 14px; }
  .content blockquote { margin: 14px 0; padding: 8px 16px; background: #fafafa; border-left: 4px solid var(--accent); color: #555; }
  .content a { color: var(--accent); }
  .content table { border-collapse: collapse; width: 100%; margin: 14px 0; }
  .content th, .content td { border: 1px solid #e3e3e3; padding: 8px 10px; font-size: 14px; }
  .footer { margin-top: 48px; border-top: 1px solid #eee; padding-top: 14px; color: #bbb; font-size: 12px; text-align: center; }
</style>
</head>
<body>
  ${coverHtml}
  <h1 class="title">${escapeHtml(meta.title)}</h1>
  <div class="meta">${metaLine}</div>
  <div class="content">${contentHtml}</div>
  <div class="footer">由 ${escapeHtml(config.siteName)} 导出</div>
</body>
</html>`;
}

function toMarkdown(meta, contentHtmlLocal) {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  td.use(gfm);
  td.addRule('img', {
    filter: 'img',
    replacement: (content, node) =>
      `![${node.alt || ''}](${node.getAttribute('src') || ''})`,
  });
  // 微信常见需要忽略的内联 style/section 已在前端清理，这里再过滤一次空白
  let md = `# ${meta.title}\n\n`;
  if (meta.account) md += `> 公众号：${meta.account}\n`;
  if (meta.author) md += `> 作者：${meta.author}\n`;
  if (meta.publishTime) md += `> 发布时间：${meta.publishTime}\n`;
  md += '\n---\n\n';
  md += td.turndown(contentHtmlLocal);
  return md;
}

async function toWord(meta, contentHtmlBase64, coverDataUri) {
  const coverHtml = coverDataUri
    ? `<img src="${coverDataUri}" style="max-width:100%;margin-bottom:12px;"/>`
    : '';
  const header =
    `<h1>${escapeHtml(meta.title)}</h1>` +
    `<p style="color:#888;font-size:13px;">公众号：${escapeHtml(meta.account || '')}` +
    `${meta.author ? '　·　作者：' + escapeHtml(meta.author) : ''}` +
    `${meta.publishTime ? '　·　' + escapeHtml(meta.publishTime) : ''}</p>`;
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<style>body{font-family:'Microsoft YaHei',sans-serif;line-height:1.8;color:#2b2b2b;}</style>` +
    `</head><body>${coverHtml}${header}${contentHtmlBase64}</body></html>`;
  // html-docx-js 0.3.x 仅提供 asBlob，返回 Blob（arrayBuffer 为异步）
  const blob = htmlDocx.asBlob(html);
  const ab = await blob.arrayBuffer();
  return Buffer.from(ab);
}

async function toPdf(htmlFilePath) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    throw new Error('未安装 puppeteer，无法生成 PDF');
  }
  const exe = findChrome();
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: exe || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.goto('file://' + htmlFilePath, {
      waitUntil: 'networkidle0',
      timeout: 40000,
    });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '14mm', right: '14mm' },
    });
    return buf;
  } finally {
    if (browser) await browser.close();
  }
}

// 查找已安装的 Chromium 可执行文件（兼容版本号不一致的情况）
function findChrome() {
  try {
    const puppeteer = require('puppeteer');
    const p = puppeteer.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch (e) {}
  // 扫描 puppeteer 缓存目录，匹配任意已安装的 chrome
  const candidates = [];
  const cache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  if (fs.existsSync(cache)) {
    for (const ver of fs.readdirSync(cache)) {
      candidates.push(path.join(cache, ver, 'chrome-win64', 'chrome.exe'));
      candidates.push(path.join(cache, ver, 'chrome-linux64', 'chrome'));
      candidates.push(path.join(cache, ver, 'chrome-mac64', 'Chrome'));
    }
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

// 检测 PDF 是否可用（Chromium 是否已安装）
let _pdfOk = null;
function pdfAvailable() {
  if (_pdfOk !== null) return _pdfOk;
  _pdfOk = !!findChrome();
  return _pdfOk;
}

// ---------- 单篇处理 ----------
async function processOne(rawHtml, url, formats, options, outDir, index = 0) {
  const meta = parseArticleStrict(rawHtml, url);
  // 标题为空时用索引兜底，避免批量中多个失败项互相覆盖
  const safe = sanitizeName(meta.title) || ('article_' + (index + 1));
  const dir = path.join(outDir, safe);
  fs.mkdirSync(dir, { recursive: true });
  const imgDir = path.join(dir, 'images');

  const embed = options.embedImages !== false;
  let map = {};
  // 选了「仅图片」模式时，无论是否内嵌都必须下载原图到 images/ 目录
  const needImages = embed || formats.includes('images');
  if (needImages && meta.images.length) {
    map = await downloadImages(meta.images, imgDir, url);
  }

  // 封面
  let coverLocal = null;
  let coverDataUri = '';
  if (options.withCover && meta.cover) {
    const ext = extFromUrl(meta.cover);
    const cpath = path.join(imgDir, 'cover.' + ext);
    try {
      const b = await downloadImage(meta.cover, url, cpath);
      coverLocal = `images/cover.${ext}`;
      coverDataUri = `data:${mimeOf(ext)};base64,${b.toString('base64')}`;
    } catch (e) {
      // 封面失败忽略
    }
  }

  const contentForLocal = embed ? rewriteContentImages(meta.contentHtml, map) : meta.contentHtml;
  const contentForB64 = embed ? base64Images(meta.contentHtml, imgDir, map) : meta.contentHtml;

  if (formats.includes('html')) {
    fs.writeFileSync(
      path.join(dir, 'article.html'),
      buildHtml(meta, contentForLocal, { withCover: options.withCover, coverSrc: coverLocal, singleFile: false })
    );
  }
  if (formats.includes('single')) {
    fs.writeFileSync(
      path.join(dir, 'article_单文件.html'),
      buildHtml(meta, contentForB64, { withCover: options.withCover, coverSrc: coverDataUri, singleFile: true })
    );
  }
  if (formats.includes('markdown')) {
    fs.writeFileSync(path.join(dir, 'article.md'), toMarkdown(meta, contentForLocal));
  }
  if (formats.includes('word')) {
    fs.writeFileSync(path.join(dir, 'article.docx'), await toWord(meta, contentForB64, coverDataUri));
  }
  if (formats.includes('pdf')) {
    const hp = path.join(dir, '_pdf.html');
    fs.writeFileSync(
      hp,
      buildHtml(meta, embed ? contentForLocal : meta.contentHtml, {
        withCover: options.withCover,
        coverSrc: embed ? coverLocal : null,
        singleFile: false,
      })
    );
    try {
      const pdf = await toPdf(hp);
      fs.writeFileSync(path.join(dir, 'article.pdf'), pdf);
    } catch (e) {
      fs.writeFileSync(
        path.join(dir, '_pdf_failed.txt'),
        'PDF 生成失败：' + (e.message || e) +
          '\n请在部署服务器安装 Chromium（命令行执行：npx puppeteer browsers install chrome），或改用浏览器端导出。'
      );
    }
  }
  // 仅图片模式：images/ 目录已在 downloadImages 中生成

  return meta;
}

// ---------- 打包 ----------
function zipDir(dir, zipPath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', () => resolve(zipPath));
    archive.on('error', reject);
    archive.pipe(out);
    archive.directory(dir, false);
    archive.finalize();
  });
}

// ---------- 批量入口 ----------
async function run(rawItems, formats, options) {
  // 仅图片模式强制嵌入
  if (formats.length === 1 && formats[0] === 'images') options.embedImages = true;

  const id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const outDir = path.join(__dirname, '..', '.tmp', 'job_' + id);
  fs.mkdirSync(outDir, { recursive: true });

  const metas = [];
  let idx = 0;
  for (const it of rawItems) {
    if (!it || !it.html) {
      // 抓取阶段就失败
      if (it && it.url) metas.push({ title: '(抓取失败)', url: it.url, error: it.error || '未知错误' });
      continue;
    }
    try {
      const m = await processOne(it.html, it.url || '', formats, options, outDir, idx);
      m.url = it.url || '';
      metas.push(m);
    } catch (e) {
      // 单篇失败记录，不中断整体
      metas.push({ title: '(解析失败)', url: it.url || '', error: e.message });
    }
    idx++;
  }
  if (!metas.length) throw new Error('没有成功解析到任何文章');

  const zipPath = path.join(__dirname, '..', '.tmp', 'zip_' + id + '.zip');
  await zipDir(outDir, zipPath);
  return { zipPath, workDir: outDir, metas };
}

// 入参为链接数组（内部抓取）
async function exportByUrls(urls, formats, options) {
  const { fetchText } = require('./fetch');
  const items = [];
  for (const u of urls) {
    try {
      const html = await fetchText(u, { referer: u });
      items.push({ html, url: u });
    } catch (e) {
      items.push({ html: null, url: u, error: e.message });
    }
  }
  return run(items, formats, options);
}

// 入参为已抓取好的 HTML 数组（由路由层抓取后传入）
async function exportByHtml(htmls, formats, options) {
  const items = htmls
    .filter(Boolean)
    .map((h) => (typeof h === 'string' ? { html: h } : h));
  return run(items, formats, options);
}

module.exports = {
  processOne,
  exportByUrls,
  exportByHtml,
  pdfAvailable,
};
