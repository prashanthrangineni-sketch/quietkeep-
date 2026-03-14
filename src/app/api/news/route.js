export const runtime = 'edge';

const FEEDS = {
  India: [
    'https://feeds.feedburner.com/ndtvnews-india-news',
    'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
    'https://www.thehindu.com/news/national/feeder/default.rss',
  ],
  Business: [
    'https://economictimes.indiatimes.com/rssfeedstopstories.cms',
    'https://feeds.feedburner.com/ndtvprofit-latest-news',
    'https://www.business-standard.com/rss/latest.rss',
  ],
  Tech: [
    'https://feeds.feedburner.com/gadgets360-latest',
    'https://timesofindia.indiatimes.com/rssfeeds/66949542.cms',
    'https://www.theverge.com/rss/index.xml',
  ],
  Health: [
    'https://timesofindia.indiatimes.com/rssfeeds/3908999.cms',
    'https://www.medicalnewstoday.com/rss',
    'https://feeds.feedburner.com/ndtv/health',
  ],
};

function parseItems(xml) {
  const items = [];
  // Handle both RSS <item> and Atom <entry>
  const regex = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g;
  let match;
  while ((match = regex.exec(xml)) !== null && items.length < 15) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(
        `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`
      ));
      return m ? (m[1] || m[2] || '').replace(/<[^>]+>/g, '').trim() : '';
    };
    // Handle link variations
    let link = get('link');
    if (!link) {
      const lm = block.match(/<link[^>]+href="([^"]+)"/);
      if (lm) link = lm[1];
    }
    const title = get('title');
    if (!title) continue;
    items.push({
      title,
      link: link || '',
      pubDate: get('pubDate') || get('updated') || get('published'),
      source: get('source') || '',
    });
  }
  return items;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category') || 'India';
  const feedUrls = FEEDS[category];
  if (!feedUrls) return Response.json({ error: 'Unknown category' }, { status: 400 });

  // Try each feed URL until one works
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  };

  for (const url of feedUrls) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseItems(xml);
      if (items.length === 0) continue;
      return Response.json({ items, source: url }, {
        headers: { 'Cache-Control': 'public, max-age=900, s-maxage=900' },
      });
    } catch { continue; }
  }

  return Response.json({ items: [], error: 'All feeds unavailable' }, { status: 200 });
}
