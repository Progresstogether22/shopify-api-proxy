let sfToken = null;
let sfTokenExpiry = 0;
const SF_TOKEN_TTL = 55 * 60 * 1000;

async function getSalesforceToken() {
  if (sfToken && Date.now() < sfTokenExpiry) return sfToken;

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
  });

  const res = await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));

  sfToken = { access_token: data.access_token, instance_url: data.instance_url };
  sfTokenExpiry = Date.now() + SF_TOKEN_TTL;
  return sfToken;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    const { access_token, instance_url } = await getSalesforceToken();
    const apiBase = `${instance_url}/services/data/v58.0`;

    const query = `SELECT Membership_Start_Date__c, Membership_Renewal_Month__c FROM Contact WHERE Email = '${email.replace(/'/g, "\\'")}' LIMIT 1`;
    const contactRes = await fetch(`${apiBase}/query?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const contactData = await contactRes.json();

    if (!contactRes.ok) {
      const message = Array.isArray(contactData) ? contactData.map(e => e.message).join('; ') : JSON.stringify(contactData);
      return res.status(502).json({ error: 'Salesforce query failed: ' + message });
    }

    const contact = contactData.records?.[0];

    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    return res.status(200).json({
      membership_start_date: contact.Membership_Start_Date__c,
      renewal_month: contact.Membership_Renewal_Month__c,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch contact' });
  }
}
