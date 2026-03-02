module.exports = async function handler(req, res) {
  const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN;
  const ORG_ID = process.env.EVENTBRITE_ORG_ID;

  const response = await fetch(
    `https://www.eventbriteapi.com/v3/organizations/${ORG_ID}/events/?status=live`,
    {
      headers: {
        Authorization: `Bearer ${EVENTBRITE_TOKEN}`,
      },
    }
  );

  const data = await response.json();
  res.status(200).json(data);
};