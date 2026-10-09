# 羊小白魔法 · 公众号文章导出工具

一个可部署、可分享的「公众号文章下载器」白标版。功能对标 [gzh.jikefuye.cn](https://gzh.jikefuye.cn)：粘贴公众号文章 / 合集链接，一键导出 **HTML / Markdown / PDF / Word / 单文件 HTML / 仅图片**，并打包成 ZIP 下载到本机。

> 这是参考站的「换成你自己的品牌」版本：界面、站点名、主题色、页脚都可在 `config.js` 一处改成你自己的，别人也能访问使用。

---

## 功能

- **单篇下载**：粘贴一篇文章链接 → 导出多种格式并打包。
- **批量下载**：每行一条链接，一次最多 20 篇，打包为一个 ZIP。
- **合集下载**：粘贴合集（专栏）链接 → 列出文章 → 勾选 → 打包下载（最多 30 篇）。
- **导出格式**：HTML、Markdown、PDF、Word(.docx)、单文件 HTML（图片内联）、仅图片。
- **附加内容**：可选包含封面图；图片默认内嵌（离线也能看）。
- **任务记录**：本浏览器本地保存下载历史。

### 与参考站的区别 / 已知限制

- 参考站里「精选留言、文章数据」需要微信登录态，**本工具不抓取**（合规且技术上需要 cookie，不做）。封面、正文、图片不受影响。
- **合集解析**尽力而为：微信合集页有时需登录态才能拿到完整列表，若解析为空，请改用「单篇 / 批量」模式直接粘贴具体文章链接。
- 抓取频率请克制，遵守微信平台规范与内容版权。

---

## 快速开始（本地运行）

要求 **Node.js ≥ 18**（推荐 20+）。

```bash
# 1. 安装依赖
npm install

# 2.（可选）启用 PDF：安装 Chromium
#    不装则 PDF 功能不可用，其余格式正常
npx puppeteer browsers install chrome

# 3. 启动
npm start
# 打开 http://localhost:3000
```

---

## 品牌自定义（改成你自己的）

只改 `config.js` 一处即可：

```js
module.exports = {
  siteName: '羊小白魔法 · 公众号文章导出',   // 站点名（标题/页头/导出页脚）
  siteSlogan: '粘贴文章链接，一键导出 …',     // 标语
  brandOwner: '羊小白魔法',                    // 品牌归属（页脚展示）
  footerText: '本站为免费在线工具 …',           // 页脚说明
  accentColor: '#f5a623',                     // 主题色（魔法橙黄）
  contact: '',                                // 你的联系方式/公众号
  qrcode: '/images/qrcode.jpg',               // 页脚公众号二维码（相对 public 目录，留空则不显示）
  qrcodeAlt: '扫码关注羊小白魔法',             // 二维码 alt 文案
  defaultBiz: '',                             // 你自己的 __biz（合集默认带入，可留空）
  maxBatch: 20,                               // 批量上限
  maxCollection: 30,                          // 合集上限
  port: process.env.PORT || 3000,
};
```

页脚二维码：把你的二维码图片放到 `public/images/qrcode.jpg`（或用 `qrcode` 指向其它路径），前端会在页脚左侧展示品牌说明、右侧展示二维码，响应式自适应。留空 `qrcode` 则页脚不显示二维码区。

改完重启服务即可生效，前端会自动从 `/api/config` 读取并应用。

---

## 部署到服务器（让别人也能用）

这是一个需要后端的标准 Node 服务（浏览器跨域无法直接抓取微信）。选一种方式：

### 方式 A：自有 VPS + pm2（最稳）

```bash
# 服务器上
git clone <你的仓库> gzh-exporter && cd gzh-exporter
npm install
npx puppeteer browsers install chrome   # PDF 支持
npm install -g pm2
pm2 start server.js --name gzh-exporter
pm2 save
# 用 Nginx/Caddy 反代 3000 端口到你的域名，并配置 HTTPS
```

Nginx 片段示例：

```nginx
server {
  listen 443 ssl;
  server_name your-domain.com;
  ssl_certificate     /path/fullchain.pem;
  ssl_certificate_key /path/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

### 方式 B：Render / Fly.io / Railway（无需自有服务器）

1. 把本目录推到 GitHub。
2. 在平台新建 Web Service，构建命令 `npm install && npx puppeteer browsers install chrome`，启动命令 `npm start`，环境变量 `PORT` 由平台注入（代码已支持）。
3. 绑定你的域名。

> 注意：部分免费层磁盘/内存较小，PDF（Chromium）可能较吃资源；若不需要 PDF，可去掉该步骤，前端会自动隐藏 PDF 选项。

---

## 目录结构

```
gzh-exporter/
├── config.js            # 品牌配置（改这里）
├── server.js            # Express 服务与 API
├── lib/
│   ├── fetch.js         # 带 UA/Referer 抓取微信页
│   ├── parse.js         # 解析标题/公众号/作者/时间/封面/正文/图片
│   ├── convert.js       # 图片下载 + 各格式生成 + ZIP 打包
│   └── collection.js    # 合集解析
└── public/              # 前端（index.html / css / js）
```

---

## 合规与版权

- 本站仅作个人学习与资料存档用途。
- 请尊重原作者版权，遵守微信公众平台规范，控制抓取频率，勿用于商业分发或侵权用途。
- 导出内容的所有权归原作者所有。
