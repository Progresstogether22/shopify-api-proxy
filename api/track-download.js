let sfToken = null;
let sfTokenExpiry = 0;
const SF_TOKEN_TTL = 55 * 60 * 1000; // 55 minutes (tokens last 1 hour)

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, url, title } = req.body;
  if (!email || !url) return res.status(400).json({ error: 'Missing email or url' });

  try {
    const { access_token, instance_url } = await getSalesforceToken();
    const apiBase = `${instance_url}/services/data/v58.0`;

    const safeEmail = email.replace(/'/g, "\\'");

    // Look up Contact by email
    const contactRes = await fetch(`${apiBase}/query?q=${encodeURIComponent(`SELECT Id FROM Contact WHERE Email = '${safeEmail}' LIMIT 1`)}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const contactData = await contactRes.json();
    const contact = contactData.records?.[0];

    let whoId = contact?.Id;

    // No contact found — look up or create a Lead so name+email are captured
    if (!whoId && email) {
      const leadRes = await fetch(`${apiBase}/query?q=${encodeURIComponent(`SELECT Id FROM Lead WHERE Email = '${safeEmail}' LIMIT 1`)}`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const leadData = await leadRes.json();
      const existingLead = leadData.records?.[0];

      if (existingLead) {
        whoId = existingLead.Id;
      } else if (name) {
        const parts = name.trim().split(/\s+/);
        const lastName  = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
        const firstName = parts.length > 1 ? parts[0] : '';
        const newLeadRes = await fetch(`${apiBase}/sobjects/Lead/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ FirstName: firstName, LastName: lastName, Email: email, Company: 'Unknown', LeadSource: 'Web' }),
        });
        const newLeadData = await newLeadRes.json();
        if (newLeadRes.ok) whoId = newLeadData.id;
      }
    }

    // Create Task
    const taskBody = {
      Subject: `Downloaded: ${title || url}`,
      Status: 'Completed',
      ActivityDate: new Date().toISOString().split('T')[0],
      Description: url,
      isDownload__c: true,
      Web_Asset_Name__c: title || url,
    };
    if (whoId) taskBody.WhoId = whoId;

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

    return res.status(200).json({ success: true, taskId: taskData.id, contactFound: !!contact, whoId: whoId || null });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to track download' });
  }
}
