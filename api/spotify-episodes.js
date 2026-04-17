export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
  const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
  const showId        = req.query.show_id || '6Cb7hc3LnYTU8rPfJxfJi4';
  const limit         = Math.min(parseInt(req.query.limit || '12', 10), 50);

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'Spotify credentials not configured' });
  }

  try {
    // Client credentials token
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
      },
      body: 'grant_type=client_credentials'
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(tokenRes.status).json({ error: 'Token fetch failed: ' + err });
    }

    const { access_token } = await tokenRes.json();

    // Fetch episodes
    const epRes = await fetch(
      `https://api.spotify.com/v1/shows/${encodeURIComponent(showId)}/episodes?limit=${limit}&market=GB`,
      {
        headers: { 'Authorization': 'Bearer ' + access_token }
      }
    );

    if (!epRes.ok) {
      const err = await epRes.text();
      return res.status(epRes.status).json({ error: 'Episodes fetch failed: ' + err });
    }

    const data = await epRes.json();
    const episodes = (data.items || []).map(ep => ({
      id:          ep.id,
      name:        ep.name,
      description: ep.description,
      published:   ep.release_date,
      duration_ms: ep.duration_ms,
      thumbnail:   ep.images && ep.images[0] && ep.images[0].url,
      url:         ep.external_urls && ep.external_urls.spotify
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ episodes });

  } catch (err) {
    console.error('spotify-episodes error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
