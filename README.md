# 小红书近 5 天关键词帖子检索脚本

这个脚本会使用 **你自己的小红书账号登录态**，自动检索这两个关键词：
- 张凌赫
- 全棉时代

并提取最近 5 天的：
- 帖子热度（点赞 / 收藏 / 评论数）
- 帖子正文原声（原文文本）
- 评论区原声（原文文本）

> ⚠️ 页面选择器可能随小红书改版失效，需要按实际页面结构微调。

## 1) 安装依赖

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install playwright
python -m playwright install chromium
```

## 2) 运行

```bash
python xiaohongshu_monitor.py --login-wait-seconds 120 --max-posts-per-keyword 30 --max-comments-per-post 50
```

运行后会弹出浏览器：
1. 你手动登录小红书（扫码/验证码）。
2. 脚本自动搜索关键词并抓取数据。

## 3) 输出文件

默认在 `output/`：
- `xiaohongshu_posts_last5days.json`
- `xiaohongshu_posts_last5days.csv`

字段说明：
- `keyword`: 关键词
- `title`: 帖子标题
- `author`: 作者昵称
- `post_url`: 帖子链接
- `publish_time_raw`: 页面展示的原始发布时间
- `publish_time_iso`: 解析后的时间（ISO）
- `likes`: 点赞数（已做“万/千”归一化）
- `collects`: 收藏数
- `comments_count`: 评论数
- `post_raw_text`: 帖子正文原文
- `comments_raw_text`: 评论区原文（多行文本）

## 4) 合规提醒

请仅在合法、合规、符合平台服务条款的前提下使用，并妥善处理隐私数据。
