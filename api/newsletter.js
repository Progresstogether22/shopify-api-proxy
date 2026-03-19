function getMailchimpAuth() {
  const apiKey = process.env.MAILCHIMP_API_KEY;
  if (!apiKey) throw new Error('Missing MAILCHIMP_API_KEY');
  const dc = apiKey.split('-').pop();
  const auth = Buffer.from(`anystring:${apiKey}`).toString('base64');
  return { dc, auth };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing campaign id' });

  try {
    const { dc, auth } = getMailchimpAuth();
    const headers = { Authorization: `Basic ${auth}` };

    const [campaignRes, contentRes] = await Promise.all([
      fetch(`https://${dc}.api.mailchimp.com/3.0/campaigns/${id}`, { headers }),
      fetch(`https://${dc}.api.mailchimp.com/3.0/campaigns/${id}/content`, { headers }),
    ]);

    const campaign = await campaignRes.json();
    const content = await contentRes.json();

    if (!campaignRes.ok) throw new Error(campaign.detail || 'Campaign not found');

    return res.status(200).json({
      id: campaign.id,
      subject: campaign.settings?.subject_line,
      preview_text: campaign.settings?.preview_text,
      send_time: campaign.send_time,
      archive_url: campaign.archive_url,
      html: content.html || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
