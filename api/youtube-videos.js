export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const channelId  = req.query.channel_id || '';
  const playlistId = req.query.playlist_id || '';
  const limit      = parseInt(req.query.limit || '12', 10);

  if (!channelId && !playlistId) {
    return res.status(400).json({ error: 'channel_id or playlist_id is required' });
  }

  const feedUrl = channelId
    ? 'https://www.youtube.com/feeds/videos.xml?channel_id=' + encodeURIComponent(channelId)
    : 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + encodeURIComponent(playlistId);

  try {
    const response = await fetch(feedUrl);
    if (!response.ok) throw new Error('Feed responded with ' + response.status);
    const xml = await response.text();

    const videos = [];
    let start = 0;

    while (videos.length < limit) {
      const entryStart = xml.indexOf('<entry>', start);
      if (entryStart === -1) break;
      const entryEnd = xml.indexOf('</entry>', entryStart);
      if (entryEnd === -1) break;

      const entry = xml.slice(entryStart, entryEnd + 8);
      start = entryEnd + 8;

      const videoId   = extract(entry, '<yt:videoId>', '</yt:videoId>');
      const title     = decodeEntities(extract(entry, '<title>', '</title>'));
      const published = extract(entry, '<published>', '</published>');
      const thumb     = extractAttr(entry, 'media:thumbnail', 'url');

      if (!videoId) continue;

      videos.push({
        id:        videoId,
        title:     title,
        published: published,
        thumbnail: thumb || ('https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg'),
        url:       'https://www.youtube.com/watch?v=' + videoId
      });
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ videos: videos });

  } catch (err) {
    console.error('youtube-videos error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

function extract(str, open, close) {
  const s = str.indexOf(open);
  if (s === -1) return '';
  const e = str.indexOf(close, s + open.length);
  if (e === -1) return '';
  return str.slice(s + open.length, e);
}

function extractAttr(str, tag, attr) {
  const tagStart = str.indexOf('<' + tag);
  if (tagStart === -1) return '';
  const tagEnd = str.indexOf('>', tagStart);
  const tagStr = str.slice(tagStart, tagEnd);
  const attrIndex = tagStr.indexOf(attr + '="');
  if (attrIndex === -1) return '';
  const valStart = attrIndex + attr.length + 2;
  const valEnd = tagStr.indexOf('"', valStart);
  return valEnd === -1 ? '' : tagStr.slice(valStart, valEnd);
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}
