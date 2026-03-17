#!/usr/bin/env python3
"""
小红书近 5 天舆情检索脚本（Playwright）

功能：
1. 使用你自己的账号登录（脚本会打开可见浏览器，支持扫码/验证码登录）。
2. 检索关键词："张凌赫"、"全棉时代"。
3. 仅保留近 5 天发布的帖子。
4. 输出每条帖子的热度指标（点赞/收藏/评论）。
5. 抽取帖子正文原文与评论区原文（按可见内容）。

注意：
- 页面结构变化频繁，选择器可能需要微调。
- 请遵守平台服务条款、隐私和数据使用规范。
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable, List, Optional

from playwright.sync_api import BrowserContext, Page, Playwright, sync_playwright

SEARCH_KEYWORDS = ["张凌赫", "全棉时代"]
BASE_URL = "https://www.xiaohongshu.com"


@dataclasses.dataclass
class PostRecord:
    keyword: str
    title: str
    author: str
    post_url: str
    publish_time_raw: str
    publish_time_iso: str
    likes: str
    collects: str
    comments_count: str
    post_raw_text: str
    comments_raw_text: str


def normalize_cn_num(num_text: str) -> str:
    """将 1.2万 / 3千 统一转成整数文本，转换失败则返回原文。"""
    if not num_text:
        return ""

    txt = num_text.strip().replace(",", "")
    m = re.match(r"^([0-9]+(?:\.[0-9]+)?)([万千]?)$", txt)
    if not m:
        return txt

    value = float(m.group(1))
    unit = m.group(2)
    factor = 1
    if unit == "万":
        factor = 10000
    elif unit == "千":
        factor = 1000

    return str(int(value * factor))


def parse_publish_time(raw: str) -> Optional[datetime]:
    """尽量兼容常见中文时间格式。"""
    raw = (raw or "").strip()
    if not raw:
        return None

    now = datetime.now()

    if raw == "刚刚":
        return now

    m = re.match(r"^(\d+)分钟前$", raw)
    if m:
        return now - timedelta(minutes=int(m.group(1)))

    m = re.match(r"^(\d+)小时前$", raw)
    if m:
        return now - timedelta(hours=int(m.group(1)))

    m = re.match(r"^(\d+)天前$", raw)
    if m:
        return now - timedelta(days=int(m.group(1)))

    # 2026-03-17 13:00 或 2026/03/17
    for fmt in ["%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d %H:%M", "%Y/%m/%d"]:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            pass

    # 03-17 13:00 / 03-17 -> 默认当年
    m = re.match(r"^(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?$", raw)
    if m:
        month, day = int(m.group(1)), int(m.group(2))
        hour = int(m.group(3) or 0)
        minute = int(m.group(4) or 0)
        return datetime(now.year, month, day, hour, minute)

    return None


def within_last_days(raw_time: str, days: int) -> bool:
    dt = parse_publish_time(raw_time)
    if not dt:
        return False
    return dt >= datetime.now() - timedelta(days=days)


def ensure_login(page: Page, wait_seconds: int) -> None:
    page.goto(BASE_URL, wait_until="domcontentloaded")
    print("请在打开的小红书页面中完成登录（扫码/手机验证码等）。")
    print(f"等待 {wait_seconds} 秒让你手动登录...")
    page.wait_for_timeout(wait_seconds * 1000)


def do_search(page: Page, keyword: str) -> None:
    page.goto(BASE_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(1500)

    search_input = page.locator('input[placeholder*="搜索"]').first
    search_input.click(timeout=10000)
    search_input.fill(keyword)
    search_input.press("Enter")
    page.wait_for_timeout(2500)


def collect_post_links(page: Page, max_posts: int) -> List[str]:
    """在搜索结果页滚动抓取帖子链接。"""
    urls: list[str] = []
    seen = set()

    for _ in range(15):
        cards = page.locator('a[href*="/explore/"]')
        count = cards.count()
        for idx in range(count):
            href = cards.nth(idx).get_attribute("href")
            if not href:
                continue
            if href.startswith("/"):
                href = BASE_URL + href
            if "/explore/" not in href:
                continue
            if href in seen:
                continue
            seen.add(href)
            urls.append(href)
            if len(urls) >= max_posts:
                return urls

        page.mouse.wheel(0, 3000)
        page.wait_for_timeout(1200)

    return urls


def safe_text(page: Page, selectors: Iterable[str]) -> str:
    for sel in selectors:
        loc = page.locator(sel).first
        if loc.count() > 0:
            try:
                txt = loc.inner_text(timeout=2000).strip()
                if txt:
                    return txt
            except Exception:
                pass
    return ""


def collect_comments_text(page: Page, max_comments: int) -> str:
    texts: list[str] = []

    for _ in range(10):
        comment_nodes = page.locator(
            '[class*="comment"] [class*="content"], [class*="comment"] p, [class*="Comment"] [class*="content"]'
        )
        count = comment_nodes.count()
        for idx in range(count):
            if len(texts) >= max_comments:
                break
            try:
                t = comment_nodes.nth(idx).inner_text(timeout=1200).strip()
                if t and t not in texts:
                    texts.append(t)
            except Exception:
                continue

        if len(texts) >= max_comments:
            break

        page.mouse.wheel(0, 2000)
        page.wait_for_timeout(900)

    return "\n".join(texts)


def scrape_post(page: Page, keyword: str, url: str, max_comments: int) -> Optional[PostRecord]:
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(2200)

    title = safe_text(page, ["h1", '[class*="title"]', '[class*="Title"]'])
    author = safe_text(page, ['[class*="author"]', '[class*="user-name"]', '[class*="nickname"]'])
    publish_time_raw = safe_text(page, ['time', '[class*="date"]', '[class*="time"]'])

    if not within_last_days(publish_time_raw, 5):
        return None

    likes = normalize_cn_num(
        safe_text(page, ['[class*="like"] [class*="count"]', 'button:has-text("赞")'])
    )
    collects = normalize_cn_num(
        safe_text(page, ['[class*="collect"] [class*="count"]', 'button:has-text("收藏")'])
    )
    comments_count = normalize_cn_num(
        safe_text(page, ['[class*="comment"] [class*="count"]', 'button:has-text("评论")'])
    )

    post_raw_text = safe_text(
        page,
        ['[class*="note-content"]', '[class*="desc"]', 'article', '[class*="content"]'],
    )
    comments_raw_text = collect_comments_text(page, max_comments=max_comments)

    publish_dt = parse_publish_time(publish_time_raw)

    return PostRecord(
        keyword=keyword,
        title=title,
        author=author,
        post_url=url,
        publish_time_raw=publish_time_raw,
        publish_time_iso=publish_dt.isoformat() if publish_dt else "",
        likes=likes,
        collects=collects,
        comments_count=comments_count,
        post_raw_text=post_raw_text,
        comments_raw_text=comments_raw_text,
    )


def save_results(records: List[PostRecord], outdir: Path) -> None:
    outdir.mkdir(parents=True, exist_ok=True)

    json_path = outdir / "xiaohongshu_posts_last5days.json"
    csv_path = outdir / "xiaohongshu_posts_last5days.csv"

    payload = [dataclasses.asdict(r) for r in records]
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    header = [f.name for f in dataclasses.fields(PostRecord)]
    lines = [",".join(header)]
    for r in records:
        row = []
        for k in header:
            v = str(getattr(r, k, "")).replace('"', '""')
            row.append(f'"{v}"')
        lines.append(",".join(row))
    csv_path.write_text("\n".join(lines), encoding="utf-8")

    print(f"已输出 JSON: {json_path}")
    print(f"已输出 CSV : {csv_path}")


def run(playwright: Playwright, args: argparse.Namespace) -> None:
    context: BrowserContext = playwright.chromium.launch_persistent_context(
        user_data_dir=args.user_data_dir,
        headless=args.headless,
        viewport={"width": 1440, "height": 900},
    )

    page = context.new_page()
    ensure_login(page, wait_seconds=args.login_wait_seconds)

    all_records: list[PostRecord] = []

    for keyword in SEARCH_KEYWORDS:
        print(f"\n=== 检索关键词: {keyword} ===")
        do_search(page, keyword)
        urls = collect_post_links(page, max_posts=args.max_posts_per_keyword)
        print(f"候选帖子数: {len(urls)}")

        for idx, url in enumerate(urls, start=1):
            print(f"[{keyword}] 处理 {idx}/{len(urls)}: {url}")
            try:
                record = scrape_post(page, keyword, url, max_comments=args.max_comments_per_post)
                if record is not None:
                    all_records.append(record)
            except Exception as exc:
                print(f"  跳过（异常）: {exc}")
                continue
            time.sleep(0.8)

    context.close()

    all_records.sort(key=lambda x: (x.keyword, x.publish_time_iso), reverse=True)
    save_results(all_records, Path(args.output_dir))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="抓取小红书近 5 天指定关键词帖子及评论原文")
    parser.add_argument("--user-data-dir", default=".xhs_profile", help="浏览器用户数据目录（用于保留登录态）")
    parser.add_argument("--output-dir", default="output", help="输出目录")
    parser.add_argument("--max-posts-per-keyword", type=int, default=30, help="每个关键词最多抓取帖子数")
    parser.add_argument("--max-comments-per-post", type=int, default=50, help="每条帖子最多抓取评论条数")
    parser.add_argument("--login-wait-seconds", type=int, default=90, help="手动登录等待秒数")
    parser.add_argument("--headless", action="store_true", help="启用无头模式（调试时建议关闭）")
    return parser


if __name__ == "__main__":
    parser = build_parser()
    args = parser.parse_args()
    with sync_playwright() as p:
        run(p, args)
