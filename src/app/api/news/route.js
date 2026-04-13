export const runtime = 'nodejs';

// Using nodejs runtime (not edge) for better RSS fetch compatibility
// Feeds verified to work from server-side
const FEEDS = {
  India: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
  Business: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms',
  Tech: 'https://www.theverge.com/rss/index.xml',
  Health: 'https://timesofindia.indiatimes.com/rssfeeds/3908999.cms',
};

function parseRSS(xml) {
  const items = [];
  const re = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/g;
  let m;
  while ((m = re.exec(xml)) !== null && items.length < 20) {
    const b = m[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`);
      const x = b.match(r);
      return x ? x[1].replace(/<[^>]+>/g, '').trim() : '';
    };
    // Link: try plain tag, then href attr, then feedburner
    let link = get('link');
    if (!link || !link.startsWith('http')) {
      const h = b.match(/<link[^>]+href=["']([^"']+)["']/i);
      link = h ? h[1] : '';
    }
    if (!link || !link.startsWith('http')) {
      const fb = b.match(/origLink>([^<]+)/);
      link = fb ? fb[1] : '';
    }
    const title = get('title');
    if (!title || title.length < 5) continue;
    items.push({
      title,
      link,
      pubDate: get('pubDate') || get('updated') || '',
      source: get('source') || '',
    });
  }
  return items;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const cat = searchParams.get('category') || 'India';
  const url = FEEDS[cat];
  if (!url) return Response.json({ error: 'Unknown category' }, { status: 400 });

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuietKeepBot/1.0)' },
      next: { revalidate: 600 },
    });
    if (!res.ok) return Response.json({ items: [], message: `Feed returned ${res.status}` });
    const xml = await res.text();
    const items = parseRSS(xml);
    return Response.json({ items });
  } catch (e) {
    return Response.json({ items: [], message: e.message });
  }
}
