export default async function handler(req, res) {
  const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN;
  const { id } = req.query;

  res.setHeader("Access-Control-Allow-Origin", "https://krywbf-rv.myshopify.com");

  if (!id) return res.status(400).json({ error: "Missing event id" });

  try {
    const response = await fetch(
      `https://www.eventbriteapi.com/v3/events/${id}/?expand=venue,description`,
      { headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` } }
    );
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error_description || "Eventbrite API error" });
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch event" });
  }
}
