// Module-level cache — persists across requests on the same Vercel instance
let attendeeCache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export default async function handler(req, res) {
  const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN;
  const ORG_ID = process.env.EVENTBRITE_ORG_ID;

  res.setHeader("Access-Control-Allow-Origin", "*");

  const organisation = req.query.organisation;
  if (!organisation) {
    return res.status(400).json({ error: "Missing organisation query parameter" });
  }

  const orgLower = organisation.trim().toLowerCase();

  try {
    // Use cached attendees if still valid
    if (attendeeCache && Date.now() < cacheExpiry) {
      return res.status(200).json(filterAndBuildResponse(attendeeCache, orgLower, EVENTBRITE_TOKEN));
    }

    // Fetch all attendees across all pages
    let allAttendees = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(
        `https://www.eventbriteapi.com/v3/organizations/${ORG_ID}/attendees/?expand=answers&page=${page}`,
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
        return res.status(response.status).json({ error: data.error_description || data.error || "Eventbrite API error" });
      }

      allAttendees = allAttendees.concat(data.attendees ?? []);
      hasMore = data.pagination?.has_more_items ?? false;
      page++;
    }

    // Store in cache
    attendeeCache = allAttendees;
    cacheExpiry = Date.now() + CACHE_TTL_MS;

    return res.status(200).json(await filterAndBuildResponse(allAttendees, orgLower, EVENTBRITE_TOKEN));

  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch org events" });
  }
}

async function filterAndBuildResponse(allAttendees, orgLower, token) {
  const matchingEventIds = new Set();

  allAttendees.forEach(attendee => {
    const answers = attendee.answers ?? [];
    const matched = answers.some(a =>
      typeof a.answer === 'string' && a.answer.trim().toLowerCase() === orgLower
    );
    if (matched) {
      matchingEventIds.add(attendee.event_id);
    }
  });

  if (matchingEventIds.size === 0) return [];

  const eventRequests = Array.from(matchingEventIds).map(eventId =>
    fetch(`https://www.eventbriteapi.com/v3/events/${eventId}/?expand=venue`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.json())
  );

  const events = await Promise.all(eventRequests);
  const now = new Date();
  return events
    .filter(ev => !ev.error && new Date(ev.start.utc) >= now)
    .sort((a, b) => new Date(a.start.utc) - new Date(b.start.utc));
}
