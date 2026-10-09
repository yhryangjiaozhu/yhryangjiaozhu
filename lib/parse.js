// 解析模块：从微信文章 HTML 中抽取标题、公众号、作者、时间、封面、正文、图片
const cheerio = require('cheerio');

// 从 var xxx = '...' 提取变量。只接受「带引号的字符串」或「纯数字」，
// 避免误匹配混淆后的函数调用（如 var ct = et(r,G) / var nickname = htmlDecode(...)）。
function extractVar(html, name) {
  let m = html.match(new RegExp('var\\s+' + name + '\\s*=\\s*[\'"]([^\'"]*)[\'"]', 'i'));
  if (m) return m[1].trim();
  m = html.match(new RegExp('var\\s+' + name + '\\s*=\\s*(\\d+)', 'i'));
  if (m) return m[1].trim();
  return '';
}

// 取第一个数字型时间戳变量（兼容不同字段名/混淆）
function firstNumericVar(html, names) {
  for (const n of names) {
    const m = html.match(new RegExp('var\\s+' + n + '\\s*=\\s*(\\d+)', 'i'));
    if (m) return m[1];
  }
  return '';
}

// 解码常见 HTML 实体
function decode(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// 清洗元信息文本：折叠空白、去除重复词（如 "A A"）
function cleanText(s) {
  if (!s) return '';
  s = decode(s).replace(/\s+/g, ' ').trim();
  const parts = s.split(' ');
  if (parts.length >= 2 && parts.every((p) => p === parts[0])) return parts[0];
  return s;
}

// 提取发布时间，兼容两种格式：
//   1) 对象字面量：create_time: '2018-10-21 18:49'
//   2) 变量赋值：var ct = 1540118632（10位秒 / 13位毫秒时间戳）
function extractDate(html) {
  let m = html.match(/create_time[:=]\s*['"]?(\d{4}-\d{2}-\d{2}[^'"，,\n]*)/i);
  if (m) return m[1].trim();
  m = html.match(/var\s+(?:ct|publish_time)\s*=\s*(\d{10,13})/i);
  if (m) {
    try {
      const ts = parseInt(m[1], 10);
      const d = new Date(ts * (ts > 1e11 ? 1 : 1000));
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (e) {
      return '';
    }
  }
  return '';
}

/**
 * 解析文章 HTML
 * @param {string} html 文章页完整 HTML
 * @returns {{title,account,author,publishTime,cover,contentHtml,images:string[]}}
 */
function parseArticle(html) {
  const $ = cheerio.load(html, { decodeEntities: true });

  const title =
    cleanText(extractVar(html, 'msg_title')) ||
    cleanText($('meta[property="og:title"]').attr('content')) ||
    cleanText($('#activity-name').text()) ||
    cleanText($('title').text());

  const account =
    cleanText($('#js_name').text()) || cleanText(extractVar(html, 'nickname')) || '';

  const cover =
    cleanText(extractVar(html, 'msg_cdn_url')) ||
    cleanText($('meta[property="og:image"]').attr('content')) ||
    '';

  let publishTime = extractDate(html);

  // 作者：优先 #js_author，否则取 rich_media_meta_text 的第二个（第一个通常是公众号名）
  let author = cleanText($('#js_author').text());
  if (!author) {
    const metas = [];
    $('.rich_media_meta_text').each((i, el) => {
      const t = cleanText($(el).text());
      if (t) metas.push(t);
    });
    author = metas.length > 1 ? metas[1] : metas[0] || '';
  }

  // 正文
  const $content = $('#js_content').clone();
  $content.find('script, style').remove();
  // 移除隐藏占位元素
  $content
    .find('[style*="display:none"], [style*="display: none"]')
    .remove();
  // 移除二维码/赞赏等无关块（按常见 class 过滤）
  $content
    .find('.qr_code, .reward_area, .js_reply, .rich_media_tool, .code-snippet__fix')
    .remove();

  // 收集图片（优先 data-src，微信懒加载实际地址在 data-src）
  const images = [];
  $content.find('img').each((i, el) => {
    const ds = $(el).attr('data-src');
    const sr = $(el).attr('src');
    let u = ds || sr || '';
    if (u && !/^data:/i.test(u) && /^https?:\/\//i.test(u)) {
      images.push(u);
    }
  });

  const contentHtml = $content.html() || '';

  return {
    title,
    account,
    author,
    publishTime,
    cover,
    contentHtml,
    images: [...new Set(images)],
    // 用于判断是否为“验证页/已删除”的无效抓取：去掉标签后的纯文本长度
    textLength: ($content.text() || '').replace(/\s+/g, '').length,
  };
}

/**
 * 严格解析：正文为空（微信验证页/文章已删除/需登录）时抛出明确错误，
 * 便于批量/合集模式下把失败项清晰地反馈给用户，而不是生成空文件。
 */
function parseArticleStrict(html, url) {
  const meta = parseArticle(html);
  if (!meta.contentHtml || meta.textLength < 30) {
    throw new Error(
      '正文解析为空（可能是微信验证页、文章已删除或需登录才能查看）。请确认链接可公开访问，或在手机微信内打开后「复制链接」再粘贴。'
    );
  }
  return meta;
}

module.exports = { parseArticle, parseArticleStrict, decode };
