// 抓取模块：带微信需要的 UA / Referer，获取文章与合集页面 HTML
// 微信文章页、合集页为服务端渲染(SSR)，标准请求即可拿到完整内容，无需登录态。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 抓取网页文本
 * @param {string} url
 * @param {object} opts {referer, timeout}
 * @returns {Promise<string>}
 */
async function fetchText(url, opts = {}) {
  const referer = opts.referer || 'https://mp.weixin.qq.com/';
  const timeout = opts.timeout || 25000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: referer,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('抓取失败，HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 下载二进制（图片），带回退：失败时再试一次不带 referer
 * @returns {Promise<Buffer>}
 */
async function fetchBuffer(url, opts = {}) {
  const referer = opts.referer || 'https://mp.weixin.qq.com/';
  const timeout = opts.timeout || 20000;

  async function tryFetch(ref) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: ref },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    return await tryFetch(referer);
  } catch (e) {
    // 部分图床不需要 referer，再试一次
    return await tryFetch('https://mp.weixin.qq.com/');
  }
}

module.exports = { UA, fetchText, fetchBuffer };
