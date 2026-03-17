let sfToken = null;
let sfTokenExpiry = 0;
const SF_TOKEN_TTL = 55 * 60 * 1000; // 55 minutes (tokens last 1 hour)

async function getSalesforceToken() {
  if (sfToken && Date.now() < sfTokenExpiry) return sfToken;

  const params = new URLSearchParams({
    grant_type: 'password',
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
    username: process.env.SF_USERNAME,
    password: process.env.SF_PASSWORD + process.env.SF_TOKEN,
  });

  // Sandbox orgs use test.salesforce.com for OAuth
  const res = await fetch('https://test.salesforce.com/services/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'Salesforce auth failed');

  sfToken = { access_token: data.access_token, instance_url: data.instance_url };
  sfTokenExpiry = Date.now() + SF_TOKEN_TTL;
  return sfToken;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, url, title } = req.body;
  if (!email || !url) return res.status(400).json({ error: 'Missing email or url' });

  try {
    const { access_token, instance_url } = await getSalesforceToken();
    const apiBase = `${instance_url}/services/data/v58.0`;

    // Look up Contact by email
    const query = `SELECT Id FROM Contact WHERE Email = '${email.replace(/'/g, "\\'")}' LIMIT 1`;
    const contactRes = await fetch(`${apiBase}/query?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const contactData = await contactRes.json();
    const contact = contactData.records?.[0];

    // Create Task
    const taskBody = {
      Subject: `Downloaded: ${title || url}`,
      Status: 'Completed',
      ActivityDate: new Date().toISOString().split('T')[0],
      Description: url,
    };
    if (contact) taskBody.WhoId = contact.Id;

    const taskRes = await fetch(`${apiBase}/sobjects/Task/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(taskBody),
    });

    const taskData = await taskRes.json();
    if (!taskRes.ok) return res.status(500).json({ error: taskData[0]?.message || 'Task creation failed' });

    return res.status(200).json({ success: true, taskId: taskData.id, contactFound: !!contact });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to track download' });
  }
}
