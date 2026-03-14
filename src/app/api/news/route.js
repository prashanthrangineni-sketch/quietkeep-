export const runtime = 'edge';

// Multiple reliable feeds per category — tries each until one returns items
const FEEDS = {
  India: [
    'https://www.thehindu.com/news/national/feeder/default.rss',
    'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
    'https://indianexpress.com/feed/',
  ],
  Business: [
    'https://economictimes.indiatimes.com/rssfeedstopstories.cms',
    'https://www.business-standard.com/rss/latest.rss',
    'https://indianexpress.com/section/business/feed/',
  ],
  Tech: [
    'https://www.gadgetsnow.com/rss',
    'https://www.theverge.com/rss/index.xml',
    'https://feeds.arstechnica.com/arstechnica/index',
  ],
  Health: [
    'https://timesofindia.indiatimes.com/rssfeeds/3908999.cms',
    'https://indianexpress.com/section/lifestyle/health/feed/',
    'https://www.healthline.com/rss/health-news',
  ],
};

function extractText(block, tag) {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`),
  ];
  for (const re of patterns) {
    const m = block.match(re);
    if (m && m[1]) return m[1].replace(/<[^>]+>/g, '').trim();
  }
  return '';
}

function extractLink(block) {
  // Try <link> tag
  let link = extractText(block, 'link');
  if (link && link.startsWith('http')) return link;
  // Try href attribute
  const m = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  if (m) return m[1];
  // Try feedburner:origLink
  const fb = block.match(/feedburner:origLink>([^<]+)/);
  if (fb) return fb[1];
  return '';
}

function parseRSS(xml) {
  const items = [];
  const re = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/g;
  let m;
  while ((m = re.exec(xml)) !== null && items.length < 20) {
    const b = m[1];
    const title = extractText(b, 'title');
    if (!title || title.length < 5) continue;
    items.push({
      title,
      link: extractLink(b),
      pubDate: extractText(b, 'pubDate') || extractText(b, 'updated') || extractText(b, 'dc:date'),
      source: extractText(b, 'source') || '',
    });
  }
  return items;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const cat = searchParams.get('category') || 'India';
  const urls = FEEDS[cat];
  if (!urls) return Response.json({ error: 'Unknown category' }, { status: 400 });

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
          'Accept': 'application/rss+xml,application/xml,text/xml,*/*',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRSS(xml);
      if (items.length < 2) continue;
      return Response.json({ items }, {
        headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' },
      });
    } catch { continue; }
  }

  // All feeds failed — return empty with message
  return Response.json({
    items: [],
    message: 'News feeds temporarily unavailable. Try again shortly.',
  });
}
