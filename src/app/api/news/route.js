// Server-side RSS proxy - avoids CORS + allorigins issues on client
export const runtime = 'edge';

const FEEDS = {
  India:    'https://news.google.com/rss/headlines/section/geo/IN?hl=en-IN&gl=IN&ceid=IN:en',
  Business: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-IN&gl=IN&ceid=IN:en',
  Tech:     'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-IN&gl=IN&ceid=IN:en',
  Health:   'https://news.google.com/rss/headlines/section/topic/HEALTH?hl=en-IN&gl=IN&ceid=IN:en',
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category') || 'India';
  const feedUrl = FEEDS[category];
  if (!feedUrl) return Response.json({ error: 'Unknown category' }, { status: 400 });

  try {
    const res = await fetch(feedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuietKeep/1.0)' },
    });
    if (!res.ok) return Response.json({ error: 'Feed unavailable' }, { status: 502 });

    const xml = await res.text();

    // Parse XML items server-side
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 20) {
      const block = match[1];
      const get = (tag) => {
        const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`));
        return m ? (m[1] || m[2] || '').trim() : '';
      };
      const link = get('link') || block.match(/<link\s*\/>[\s\S]*?<([^>]+)>/)?.[1] || '';
      items.push({
        title: get('title'),
        link: get('link'),
        pubDate: get('pubDate'),
        source: get('source'),
      });
    }

    return Response.json({ items }, {
      headers: { 'Cache-Control': 'public, max-age=900, s-maxage=900' },
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
