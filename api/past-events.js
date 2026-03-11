export default async function handler(req, res) {
  const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN;
  const ORG_ID = process.env.EVENTBRITE_ORG_ID;

  try {
    const response = await fetch(
      `https://www.eventbriteapi.com/v3/organizations/${ORG_ID}/events/?time_filter=past&order_by=start_desc`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${EVENTBRITE_TOKEN}`,
          'Content-Type': 'application/json'
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(response.status).json({ error: data.error_description || data.error || "Eventbrite API error" });
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data.events ?? []);
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(500).json({ error: "Failed to fetch past events" });
  }
}
