export default async function handler(req, res) {
  const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN;
  const { id } = req.query;

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!id) return res.status(400).json({ error: "Missing event id" });

  try {
    const headers = { Authorization: `Bearer ${EVENTBRITE_TOKEN}` };

    const [eventRes, contentRes] = await Promise.all([
      fetch(`https://www.eventbriteapi.com/v3/events/${id}/?expand=venue,description,organizer,format,ticket_classes`, { headers }),
      fetch(`https://www.eventbriteapi.com/v3/events/${id}/structured_content/`, { headers }),
    ]);

    const data = await eventRes.json();
    if (!eventRes.ok) return res.status(eventRes.status).json({ error: data.error_description || "Eventbrite API error" });

    if (contentRes.ok) {
      const content = await contentRes.json();
      data._structured = content; // debug: expose raw structured content
      const modules = content.modules || [];
      const speakers = [];
      modules.forEach(function (mod) {
        if (mod.type === 'speaker_list' && Array.isArray(mod.data.speakers)) {
          mod.data.speakers.forEach(function (s) {
            const p = s.profile || {};
            speakers.push({
              name: p.name || '',
              headline: p.headline || '',
              description: p.description && p.description.text ? p.description.text : '',
              image: p.image && p.image.url ? p.image.url : '',
            });
          });
        }
      });
      if (speakers.length) data.speakers = speakers;
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch event" });
  }
}
