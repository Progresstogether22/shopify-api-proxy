export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const RSS_URL = 'https://anchor.fm/s/10a987e10/podcast/rss';
  const limit   = Math.min(parseInt(req.query.limit || '12', 10), 50);

  try {
    const rssRes = await fetch(RSS_URL);
    if (!rssRes.ok) throw new Error('RSS fetch failed: HTTP ' + rssRes.status);
    const xml = await rssRes.text();

    function between(str, open, close, from) {
      var s = str.indexOf(open, from);
      if (s === -1) return '';
      s += open.length;
      var e = str.indexOf(close, s);
      return e === -1 ? '' : str.slice(s, e).trim();
    }

    function stripCdata(s) {
      return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
    }

    // Split into <item> blocks
    var episodes = [];
    var pos = 0;
    while (episodes.length < limit) {
      var start = xml.indexOf('<item>', pos);
      if (start === -1) break;
      var end = xml.indexOf('</item>', start);
      if (end === -1) break;
      var item = xml.slice(start, end + 7);
      pos = end + 7;

      var title       = stripCdata(between(item, '<title>', '</title>'));
      var pubDate     = between(item, '<pubDate>', '</pubDate>');
      var description = stripCdata(between(item, '<description>', '</description>'));
      var duration    = between(item, '<itunes:duration>', '</itunes:duration>');
      var url         = between(item, '<enclosure url="', '"');
      var link        = between(item, '<link>', '</link>');
      var thumbnail   = between(item, '<itunes:image href="', '"');

      // Spotify episode link from <guid>
      var guid = between(item, '<guid>', '</guid>');

      episodes.push({
        title,
        published: pubDate ? new Date(pubDate).toISOString().split('T')[0] : '',
        description: description.replace(/<[^>]+>/g, '').slice(0, 200),
        duration,
        thumbnail: thumbnail || null,
        url: link || guid || url || null
      });
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ episodes });

  } catch (err) {
    console.error('spotify-episodes error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
