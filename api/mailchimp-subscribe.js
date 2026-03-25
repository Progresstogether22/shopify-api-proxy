function getMailchimpAuth() {
  const apiKey = process.env.MAILCHIMP_API_KEY;
  if (!apiKey) throw new Error('Missing MAILCHIMP_API_KEY');
  const dc = apiKey.split('-').pop();
  const auth = Buffer.from(`anystring:${apiKey}`).toString('base64');
  return { dc, auth };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, company } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Missing email' });

  const listId = process.env.MAILCHIMP_AUDIENCE_ID;
  if (!listId) return res.status(500).json({ error: 'Missing MAILCHIMP_AUDIENCE_ID' });

  try {
    const { dc, auth } = getMailchimpAuth();

    const mcRes = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: email,
        status: 'subscribed',
        merge_fields: {
          ...(name    ? { FNAME: name }    : {}),
          ...(company ? { MMERGE3: company } : {}),
        },
      }),
    });

    const data = await mcRes.json();

    if (mcRes.ok) return res.status(200).json({ success: true });

    // Already subscribed is not an error
    if (data.title === 'Member Exists') return res.status(200).json({ success: true, already: true });

    return res.status(400).json({ error: data.detail || data.title || 'Could not subscribe' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
