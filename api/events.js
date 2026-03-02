export default async function handler(req, res) {
    // API key stored in Vercel environment variables - never exposed
    const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN;
    const ORG_ID = process.env.EVENTBRITE_ORG_ID;

    try {
      const response = await fetch(
        `https://www.eventbriteapi.com/v3/organizations/${ORG_ID}/events/?status=live`,
        {
          headers: {
            Authorization: `Bearer ${EVENTBRITE_TOKEN}`,
          },
        }
      );
  
      const data = await response.json();
  
      // Allow requests from your Shopify store only
      res.setHeader("Access-Control-Allow-Origin", "https://a-siege-of-herons-ltd.myshopify.com");
      res.status(200).json(data.events);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch events" });
    }
  }
