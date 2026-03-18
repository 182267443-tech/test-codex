import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { chromium } from 'playwright';

const CONFIG = {
  baseUrl: 'https://www.xiaohongshu.com',
  outputDir: path.resolve('output'),
  userDataDir: path.resolve('.playwright', 'xhs-user-data'),
  maxNotes: Number(process.env.XHS_MAX_NOTES || 10),
  maxDays: Number(process.env.XHS_MAX_DAYS || 30),
  maxCommentsPerNote: Number(process.env.XHS_MAX_COMMENTS || 80),
  searchKeywords: [
    '洗脸巾',
    '一次性洗脸巾',
    '棉柔巾',
    '洗脸巾推荐',
    '洗脸巾哪个好',
    '洗脸巾测评',
    '洗脸巾红黑榜',
    '洗脸巾掉絮',
    '洗脸巾敏感肌',
    '洗脸巾婴儿',
  ],
  painPointKeywords: [
    '掉絮', '掉毛', '起屑', '薄', '太薄', '粗糙', '刺痛', '过敏', '泛红', '闷痘', '有味道', '异味', '贵', '太贵', '不耐用', '尺寸小', '容易破', '刺激', '搓泥', '潮湿', '烂脸'
  ],
  sellingPointKeywords: [
    '柔软', '厚实', '不掉絮', '亲肤', '吸水', '干湿两用', '性价比', '便宜', '耐用', '大张', '敏感肌', '无刺激', '棉柔', '方便', '干净', '无荧光', '可降解', '婴儿可用', '回购'
  ],
  brandKeywords: [
    '全棉时代', '洁丽雅', '可心柔', '棉花秘密', 'babycare', '德佑', '维达', '心相印', '尔木萄', 'hygienix', 'ito', '好孩子', '十月结晶', 'purcotton'
  ],
  engagementKeywords: [
    '测评', '红黑榜', '避雷', '推荐', '回购', '平替', '敏感肌', '婴儿', '成分', '对比', '排行榜', '真实反馈', '踩雷', '空瓶', '种草'
  ],
};

const SELECTORS = {
  noteCards: ['section.note-item', '.note-item', '[data-testid="note-item"]', '.feeds-container section'],
  noteTitle: ['.title', '.note-title', 'h1', 'h2'],
  noteContent: ['.desc', '.note-content', '#detail-desc', '.content', '.note-scroller'],
  noteDate: ['.date', '.publish-date', '.note-date', '.bottom-container .date', '.publish-time'],
  authorName: ['.author .name', '.user-name', '.author-name', '.username', '.author-wrapper .name'],
  likeCount: ['.like-wrapper .count', '.like .count', '[data-testid="like-count"]'],
  collectCount: ['.collect-wrapper .count', '.collect .count', '[data-testid="collect-count"]'],
  commentCount: ['.comment-wrapper .count', '.comment .count', '[data-testid="comment-count"]'],
  comments: ['.comment-item', '.list-container .comment-item', '[data-testid="comment-item"]', '.comments-container .comment-inner-container'],
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseChineseCount(raw) {
  if (!raw) return null;
  const text = String(raw).replace(/[,\s]/g, '').trim().toLowerCase();
  if (!text) return null;
  const match = text.match(/([\d.]+)(万|千|k)?/i);
  if (!match) return null;
  const num = Number(match[1]);
  if (Number.isNaN(num)) return null;
  const unit = match[2];
  if (unit === '万') return Math.round(num * 10000);
  if (unit === '千' || unit === 'k') return Math.round(num * 1000);
  return Math.round(num);
}

function parseDate(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  const now = new Date();
  if (/\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(text)) return new Date(text.replace(/[.-]/g, '/'));
  if (/\d{1,2}[./-]\d{1,2}/.test(text)) {
    const [m, d] = text.match(/\d{1,2}/g).map(Number);
    return new Date(now.getFullYear(), m - 1, d);
  }
  if (/\d+天前/.test(text)) return new Date(Date.now() - Number(text.match(/\d+/)[0]) * 86400000);
  if (/\d+小时前/.test(text)) return new Date(Date.now() - Number(text.match(/\d+/)[0]) * 3600000);
  if (/\d+分钟前/.test(text)) return new Date(Date.now() - Number(text.match(/\d+/)[0]) * 60000);
  if (/昨天/.test(text)) return new Date(Date.now() - 86400000);
  if (/前天/.test(text)) return new Date(Date.now() - 2 * 86400000);
  return null;
}

function withinLastDays(date, maxDays) {
  if (!date) return false;
  return Date.now() - date.getTime() <= maxDays * 86400000;
}

async function firstText(root, selectors) {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    if (await locator.count()) {
      const text = (await locator.textContent())?.trim();
      if (text) return text;
    }
  }
  return '';
}

async function firstAttr(root, selectors, attr) {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    if (await locator.count()) {
      const value = await locator.getAttribute(attr);
      if (value) return value;
    }
  }
  return '';
}

async function ensureLoggedIn(page) {
  await page.goto(CONFIG.baseUrl, { waitUntil: 'domcontentloaded' });
  console.log('\n请在打开的浏览器中手动登录小红书账号。');
  console.log('登录完成后，回到终端按回车继续。\n');
  await prompt('按回车继续抓取...');
  await page.goto(CONFIG.baseUrl, { waitUntil: 'domcontentloaded' });
}

async function searchKeyword(page, keyword) {
  await page.goto(`${CONFIG.baseUrl}/search_result?keyword=${encodeURIComponent(keyword)}`, { waitUntil: 'domcontentloaded' });
  await wait(3000);
  const cardSelector = SELECTORS.noteCards.join(', ');
  await page.waitForSelector(cardSelector, { timeout: 15000 }).catch(() => {});
}

async function collectNoteCards(page, keyword, seenUrls, remaining) {
  const results = [];
  let stagnant = 0;
  while (results.length < remaining && stagnant < 6) {
    const before = results.length;
    const cards = page.locator(SELECTORS.noteCards.join(', '));
    const count = await cards.count();
    for (let i = 0; i < count && results.length < remaining; i += 1) {
      const card = cards.nth(i);
      const href = await firstAttr(card, ['a'], 'href');
      const title = await firstText(card, SELECTORS.noteTitle);
      const url = href ? new URL(href, CONFIG.baseUrl).toString() : '';
      if (!url || seenUrls.has(url) || !/xiaohongshu\.com/.test(url)) continue;
      seenUrls.add(url);
      results.push({ keyword, url, cardTitle: title });
    }
    stagnant = results.length === before ? stagnant + 1 : 0;
    await page.mouse.wheel(0, 3200);
    await wait(1800);
  }
  return results;
}

async function expandCommentsIfPossible(page) {
  const moreButtons = [
    'text=展开',
    'text=查看更多评论',
    'text=更多评论',
    'text=全部评论',
  ];
  for (const selector of moreButtons) {
    const buttons = page.locator(selector);
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 5); i += 1) {
      await buttons.nth(i).click({ timeout: 2000 }).catch(() => {});
      await wait(500);
    }
  }
}

async function scrapeComments(page, noteUrl) {
  const comments = [];
  const seen = new Set();
  await expandCommentsIfPossible(page);
  for (let i = 0; i < 8; i += 1) {
    await page.mouse.wheel(0, 2200);
    await wait(1000);
  }
  const items = page.locator(SELECTORS.comments.join(', '));
  const count = Math.min(await items.count(), CONFIG.maxCommentsPerNote);
  for (let i = 0; i < count; i += 1) {
    const item = items.nth(i);
    const content = ((await firstText(item, ['.content', '.note-text', '.comment-content'])) || (await item.textContent()) || '').trim();
    if (!content || seen.has(content)) continue;
    seen.add(content);
    const nickname = await firstText(item, ['.author', '.name', '.user-name', '.nickname']);
    const likeText = await firstText(item, ['.like-count', '.count', '.interactions .count']);
    comments.push({
      noteUrl,
      commentContent: content,
      commentAuthor: nickname || '',
      commentLikes: parseChineseCount(likeText),
    });
  }
  return comments;
}

async function scrapeNote(context, keyword, noteMeta) {
  const page = await context.newPage();
  try {
    await page.goto(noteMeta.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(2500);
    const publishedText = await firstText(page, SELECTORS.noteDate);
    const publishedAt = parseDate(publishedText);
    if (publishedAt && !withinLastDays(publishedAt, CONFIG.maxDays)) {
      return { skipped: true, reason: 'older_than_limit' };
    }
    const title = await firstText(page, SELECTORS.noteTitle);
    const content = await firstText(page, SELECTORS.noteContent);
    const authorName = await firstText(page, SELECTORS.authorName);
    const likes = parseChineseCount(await firstText(page, SELECTORS.likeCount));
    const collects = parseChineseCount(await firstText(page, SELECTORS.collectCount));
    const commentsCount = parseChineseCount(await firstText(page, SELECTORS.commentCount));
    const comments = await scrapeComments(page, noteMeta.url);
    return {
      skipped: false,
      note: {
        keyword,
        title: title || noteMeta.cardTitle || '',
        content,
        publishedAt: publishedAt ? publishedAt.toISOString() : publishedText,
        authorName,
        likes,
        collects,
        commentsCount,
        noteUrl: noteMeta.url,
      },
      comments,
    };
  } catch (error) {
    return { skipped: true, reason: error.message };
  } finally {
    await page.close();
  }
}

function hitKeywords(text, candidates) {
  const source = (text || '').toLowerCase();
  return candidates.filter((item) => source.includes(item.toLowerCase()));
}

function summarizeReasons(rows, brands) {
  return brands.map((brand) => {
    const matchedTexts = rows
      .filter((row) => (row.content || '').includes(brand) || (row.commentContent || '').includes(brand))
      .map((row) => `${row.content || ''} ${row.commentContent || ''}`)
      .join(' | ');
    const reasons = hitKeywords(matchedTexts, CONFIG.sellingPointKeywords);
    return { brand, reasons: [...new Set(reasons)].join('、') || '未提炼到明显原因' };
  });
}

function countHits(texts, keywords) {
  const stats = new Map();
  for (const text of texts) {
    for (const hit of hitKeywords(text, keywords)) {
      stats.set(hit, (stats.get(hit) || 0) + 1);
    }
  }
  return [...stats.entries()].sort((a, b) => b[1] - a[1]).map(([keyword, count]) => ({ keyword, count }));
}

function buildAnalysis(notes, comments) {
  const noteTexts = notes.map((n) => `${n.title} ${n.content}`);
  const commentTexts = comments.map((c) => c.commentContent || '');
  const allTexts = [...noteTexts, ...commentTexts];
  const topNotes = [...notes]
    .map((note) => ({ ...note, engagement: (note.likes || 0) + (note.collects || 0) + (note.commentsCount || 0) }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 5);

  return {
    highFrequencyPainPoints: countHits(allTexts, CONFIG.painPointKeywords).slice(0, 10),
    highFrequencySellingPoints: countHits(allTexts, CONFIG.sellingPointKeywords).slice(0, 10),
    highFrequencyBrands: countHits(allTexts, CONFIG.brandKeywords).slice(0, 10),
    brandReasons: summarizeReasons([...notes, ...comments], countHits(allTexts, CONFIG.brandKeywords).slice(0, 10).map((item) => item.keyword)),
    highEngagementDirections: countHits(topNotes.map((n) => `${n.title} ${n.content}`), CONFIG.engagementKeywords).slice(0, 10),
  };
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  return lines.join('\n');
}

function toExcelXml(rows, sheetName) {
  const headers = rows.length ? [...new Set(rows.flatMap((row) => Object.keys(row)))] : ['message'];
  const dataRows = rows.length ? rows : [{ message: 'No data' }];
  const headerXml = headers.map((header) => `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`).join('');
  const bodyXml = dataRows.map((row) => {
    const cells = headers.map((header) => {
      const value = row[header] ?? '';
      const type = typeof value === 'number' ? 'Number' : 'String';
      return `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
    }).join('');
    return `<Row>${cells}</Row>`;
  }).join('');

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="${escapeXml(sheetName)}">
  <Table>
   <Row>${headerXml}</Row>
   ${bodyXml}
  </Table>
 </Worksheet>
</Workbook>`;
}

function writeTableExports(baseName, rows, sheetName) {
  const csvPath = path.join(CONFIG.outputDir, `${baseName}.csv`);
  const excelPath = path.join(CONFIG.outputDir, `${baseName}.xls`);
  fs.writeFileSync(csvPath, toCsv(rows), 'utf8');
  fs.writeFileSync(excelPath, toExcelXml(rows, sheetName), 'utf8');
  return { csvPath, excelPath };
}

async function main() {
  ensureDir(CONFIG.outputDir);
  ensureDir(path.dirname(CONFIG.userDataDir));

  const context = await chromium.launchPersistentContext(CONFIG.userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] || await context.newPage();

  await ensureLoggedIn(page);

  const seenUrls = new Set();
  const notes = [];
  const comments = [];
  const scrapeLog = [];

  for (const keyword of CONFIG.searchKeywords) {
    if (notes.length >= CONFIG.maxNotes) break;
    console.log(`\n开始搜索关键词: ${keyword}`);
    await searchKeyword(page, keyword);
    const cards = await collectNoteCards(page, keyword, seenUrls, CONFIG.maxNotes - notes.length);
    console.log(`候选帖子数: ${cards.length}`);

    for (const card of cards) {
      if (notes.length >= CONFIG.maxNotes) break;
      console.log(`抓取帖子: ${card.url}`);
      const result = await scrapeNote(context, keyword, card);
      if (result.skipped) {
        scrapeLog.push({ keyword, noteUrl: card.url, status: 'skipped', reason: result.reason });
        continue;
      }
      notes.push(result.note);
      comments.push(...result.comments.map((comment) => ({ keyword, ...comment })));
      scrapeLog.push({ keyword, noteUrl: card.url, status: 'ok', reason: '' });
    }
  }

  const analysis = buildAnalysis(notes, comments);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const notesFiles = writeTableExports(`xhs_notes_${timestamp}`, notes, 'Notes');
  const commentsFiles = writeTableExports(`xhs_comments_${timestamp}`, comments, 'Comments');
  fs.writeFileSync(path.join(CONFIG.outputDir, `xhs_analysis_${timestamp}.json`), JSON.stringify(analysis, null, 2), 'utf8');
  fs.writeFileSync(path.join(CONFIG.outputDir, `xhs_scrape_log_${timestamp}.json`), JSON.stringify(scrapeLog, null, 2), 'utf8');

  console.log('\n抓取完成。');
  console.log(`笔记数: ${notes.length}`);
  console.log(`评论数: ${comments.length}`);
  console.log(`笔记导出: ${notesFiles.excelPath} / ${notesFiles.csvPath}`);
  console.log(`评论导出: ${commentsFiles.excelPath} / ${commentsFiles.csvPath}`);
  console.log(`分析文件: ${path.join(CONFIG.outputDir, `xhs_analysis_${timestamp}.json`)}`);

  await context.close();
}

main().catch((error) => {
  console.error('脚本执行失败:', error);
  process.exitCode = 1;
});
