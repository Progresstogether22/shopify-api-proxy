export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { channel_id, playlist_id, limit = '12' } = req.query;

  if (!channel_id && !playlist_id) {
    return res.status(400).json({ error: 'channel_id or playlist_id is required' });
  }

  try {
    const feedUrl = channel_id
      ? `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel_id)}`
      : `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlist_id)}`;

    const response = await fetch(feedUrl);
    if (!response.ok) throw new Error(`YouTube feed responded with ${response.status}`);

    const xml = await response.text();

    // Parse entries from the Atom feed
    const entries = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1];

      const videoIdMatch   = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
      const titleMatch     = entry.match(/<title>(.*?)<\/title>/);
      const publishedMatch = entry.match(/<published>(.*?)<\/published>/);
      const thumbMatch     = entry.match(/<media:thumbnail\s+url="([^"]+)"/);
      const descMatch      = entry.match(/<media:description>([\s\S]*?)<\/media:description>/);

      if (!videoIdMatch) continue;

      const videoId = videoIdMatch[1];
      entries.push({
        id:          videoId,
        title:       titleMatch ? titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"') : '',
        published:   publishedMatch ? publishedMatch[1] : null,
        thumbnail:   thumbMatch ? thumbMatch[1] : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url:         `https://www.youtube.com/watch?v=${videoId}`,
        description: descMatch ? descMatch[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : ''
      });

      if (entries.length >= parseInt(limit, 10)) break;
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ videos: entries });

  } catch (err) {
    console.error('youtube-videos error:', err);
    return res.status(500).json({ error: err.message });
  }
}
