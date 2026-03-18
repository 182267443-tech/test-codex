# 小红书 Playwright 抓取脚本（第一版，去掉额外 npm 依赖）

这个版本继续保留 **Playwright 抓取** 方案，但去掉了 `xlsx` 这类额外 npm 依赖，避免因为多装一个包而增加失败面。现在项目只依赖 `playwright` 一个包。

## 这次修复了什么

- 去掉 `xlsx` 依赖，改成：
  - `CSV` 明细文件
  - `Excel 兼容的 .xls XML 文件`
- 保留两份明细导出：
  - 笔记明细
  - 评论明细
- 保留基础分析输出：
  - 高频痛点
  - 高频卖点
  - 高频品牌提及
  - 品牌被推荐原因
  - 高互动内容方向
- 增强了评论展开、时间解析和 selector 容错。

## 安装

```bash
npm install
npx playwright install chromium
```

> 如果你的网络环境对 npm registry 有限制，这个项目层面已经把 `xlsx` 依赖去掉了；剩下只需要安装 `playwright`。如果你的环境仍然无法访问 npm registry，那是机器网络/代理策略问题，不是脚本本身的依赖冲突。

## 运行

```bash
npm run scrape
```

运行流程：
1. 脚本打开浏览器。
2. 你手动登录小红书。
3. 回到终端按回车继续。
4. 脚本开始按关键词抓取。

## 默认关键词

- 洗脸巾
- 一次性洗脸巾
- 棉柔巾
- 洗脸巾推荐
- 洗脸巾哪个好
- 洗脸巾测评
- 洗脸巾红黑榜
- 洗脸巾掉絮
- 洗脸巾敏感肌
- 洗脸巾婴儿

## 可选环境变量

```bash
XHS_MAX_NOTES=10
XHS_MAX_DAYS=30
XHS_MAX_COMMENTS=80
npm run scrape
```

## 输出目录

输出文件会放在 `output/`：

- `xhs_notes_<timestamp>.csv`
- `xhs_notes_<timestamp>.xls`
- `xhs_comments_<timestamp>.csv`
- `xhs_comments_<timestamp>.xls`
- `xhs_analysis_<timestamp>.json`
- `xhs_scrape_log_<timestamp>.json`

## 字段说明

### 笔记明细
- 搜索关键词
- 笔记标题
- 笔记正文
- 发布时间
- 作者昵称
- 点赞数
- 收藏数
- 评论数
- 笔记链接

### 评论明细
- 搜索关键词
- 笔记链接
- 评论内容
- 评论者昵称（尽量抓）
- 评论点赞数（尽量抓）

## 当前版本说明

由于小红书页面结构、登录态、反爬策略和实验样式会变化，第一版仍然可能出现：

- 某些字段抓不到
- 某些评论无法完全展开
- 发布时间格式不统一导致部分帖子无法判定时间
- 页面结构变化后需要微调 selector

但相较上一版，这一版已经把**非必要的 npm 依赖移除**，更适合先快速落地运行。
