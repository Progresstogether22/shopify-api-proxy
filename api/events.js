export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN;
  const ORG_ID = process.env.EVENTBRITE_ORG_ID;
  const type = req.query.type || 'all'; // 'all' | 'future' | 'past'

  const orderBy = type === 'past' ? 'start_desc' : 'start_asc';

  try {
    let allEvents = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(
        `https://www.eventbriteapi.com/v3/organizations/${ORG_ID}/events/?order_by=${orderBy}&status=live,started,ended,completed&page=${page}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${EVENTBRITE_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: data.error_description || data.error || 'Eventbrite API error' });
      }

      allEvents = allEvents.concat(data.events ?? []);
      hasMore = data.pagination?.has_more_items ?? false;
      page++;
    }

    const now = new Date();
    let events = allEvents.filter(ev => ev.status !== 'draft' && ev.status !== 'canceled');

    if (type === 'future') {
      events = events.filter(ev => new Date(ev.start.utc) >= now);
    } else if (type === 'past') {
      events = events.filter(ev => new Date(ev.start.utc) < now);
    }

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json(events);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch events' });
  }
}
