export default async function handler(req, res) {
  const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN;
  const { event_id, email } = req.query;

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!event_id || !email) return res.status(400).json({ error: "Missing event_id or email" });

  try {
    const response = await fetch(
      `https://www.eventbriteapi.com/v3/events/${event_id}/attendees/?search=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` } }
    );
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error_description || "Eventbrite API error" });

    const attendees = data.attendees || [];
    const match = attendees.find(
      a => a.profile && a.profile.email && a.profile.email.toLowerCase() === email.toLowerCase()
        && a.cancelled === false
    );

    if (match) {
      res.status(200).json({ booked: true, order_id: match.order_id });
    } else {
      res.status(200).json({ booked: false });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to check booking" });
  }
}
