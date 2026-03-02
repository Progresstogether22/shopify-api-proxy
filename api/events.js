module.exports = async function handler(req, res) {
  const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN;
  const ORG_ID = process.env.EVENTBRITE_ORG_ID;

  res.status(200).json({
    hasToken: !!EVENTBRITE_TOKEN,
    tokenLength: EVENTBRITE_TOKEN ? EVENTBRITE_TOKEN.length : 0,
    hasOrgId: !!ORG_ID,
    orgId: ORG_ID
  });
};