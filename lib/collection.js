// 合集（专栏）解析：粘贴微信内「复制链接」得到的 appmsgalbum 链接，列出其中文章
// 说明：微信合集页为 SSR，但完整文章列表有时需通过内部接口获取（带 cookie）。
// 这里做「尽力而为」的解析：先试页面内嵌 JSON，再退化为扫描页面里的文章链接。
const cheerio = require('cheerio');
const { fetchText } = require('./fetch');

function extractVar(html, name) {
  const re = new RegExp('var\\s+' + name + '\\s*=\\s*([\\s\\S]*?);', 'i');
  const m = html.match(re);
  return m ? m[1].trim() : '';
}

// 从内嵌 JSON 里递归找文章列表（兼容不同字段名）
function digArticles(obj, out) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const it of obj) digArticles(it, out);
    return;
  }
  // 命中文章对象的特征：有 link/url 且有 title
  if ((obj.title || obj.title_desc) && (obj.link || obj.url || obj.content_url)) {
    const url = obj.link || obj.url || obj.content_url;
    out.push({ title: obj.title || obj.title_desc || '', url });
    return;
  }
  for (const k of Object.keys(obj)) {
    if (k === 'article_list' || k === 'articleList' || k === 'list' || k === 'items') {
      digArticles(obj[k], out);
    } else if (typeof obj[k] === 'object') {
      digArticles(obj[k], out);
    }
  }
}

async function listCollection(url) {
  const html = await fetchText(url, { referer: url });

  const articles = [];

  // 方法1：页面内嵌 JSON（album_list / __initData 等）
  const jsonCandidates = [];
  const m1 = html.match(/var\s+album_list\s*=\s*(\{[\s\S]*?\});/);
  if (m1) jsonCandidates.push(m1[1]);
  const m2 = html.match(/window\.__initData\s*=\s*(\{[\s\S]*?\});/);
  if (m2) jsonCandidates.push(m2[1]);
  const m3 = html.match(/var\s+album_info\s*=\s*(\{[\s\S]*?\});/);
  if (m3) jsonCandidates.push(m3[1]);

  for (const j of jsonCandidates) {
    try {
      const obj = JSON.parse(j);
      digArticles(obj, articles);
    } catch (e) {
      // 解析失败忽略，继续
    }
  }

  // 方法2：扫描页面里的文章链接
  if (articles.length === 0) {
    const $ = cheerio.load(html);
    $('a').each((i, el) => {
      const href = $(el).attr('href') || '';
      const ok =
        /mp\.weixin\.qq\.com\/s(\?|%3F|$)/i.test(href) ||
        /mp\.weixin\.qq\.com\/s\?__biz/i.test(href);
      if (ok) {
        const title = $(el).text().trim();
        if (href && title) articles.push({ title, url: href });
      }
    });
  }

  // 去重（按 url）
  const seen = new Set();
  const out = [];
  for (const a of articles) {
    if (!a.url || seen.has(a.url)) continue;
    seen.add(a.url);
    out.push(a);
  }
  return out.slice(0, 200);
}

module.exports = { listCollection };
