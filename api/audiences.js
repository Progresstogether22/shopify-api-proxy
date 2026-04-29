function getMailchimpAuth() {
  const apiKey = process.env.MAILCHIMP_API_KEY;
  if (!apiKey) throw new Error('Missing MAILCHIMP_API_KEY');
  const dc = apiKey.split('-').pop();
  const auth = Buffer.from(`anystring:${apiKey}`).toString('base64');
  return { dc, auth };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { dc, auth } = getMailchimpAuth();
    const mcRes = await fetch(
      `https://${dc}.api.mailchimp.com/3.0/lists?fields=lists.id,lists.name,lists.stats.member_count&count=100`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    const data = await mcRes.json();
    if (!mcRes.ok) throw new Error(data.detail || 'Mailchimp API error');
    return res.status(200).json({ lists: data.lists || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
