const STORE_DOMAIN = 'krywbf-rv.myshopify.com';
const API_VERSION  = '2025-01';
let _sfToken = null, _sfTokenExp = 0;

async function getShopifyToken() {
  if (process.env.SHOPIFY_ACCESS_TOKEN) return process.env.SHOPIFY_ACCESS_TOKEN;
  if (_sfToken && Date.now() < _sfTokenExp - 60_000) return _sfToken;
  const r = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET }),
  });
  const { access_token, expires_in } = await r.json();
  _sfToken = access_token; _sfTokenExp = Date.now() + expires_in * 1000;
  return _sfToken;
}

async function shopifyGql(token, query, variables = {}) {
  const r = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

export default async function handler(req, res) {
  const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — check if email is booked for an event
  if (req.method === 'GET') {
    const { event_id, email } = req.query;
    if (!event_id || !email) return res.status(400).json({ error: 'Missing event_id or email' });

    try {
      // Fetch all orders and filter by email
      const ordersRes = await fetch(
        `https://www.eventbriteapi.com/v3/events/${event_id}/orders/`,
        { headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` } }
      );
      const ordersData = await ordersRes.json();
      if (ordersRes.ok) {
        const orders = ordersData.orders || [];
        const match = orders.find(o => o.email?.toLowerCase() === email.toLowerCase() && o.status !== 'cancelled' && o.status !== 'refunded');
        if (match) return res.status(200).json({ booked: true, order_id: match.id });
      }

      // Fallback: fetch all attendees and filter by email
      const attRes = await fetch(
        `https://www.eventbriteapi.com/v3/events/${event_id}/attendees/`,
        { headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` } }
      );
      const attData = await attRes.json();
      if (attRes.ok) {
        const attendees = (attData.attendees || []).filter(a => a.cancelled === false);
        const att = attendees.find(a => a.profile?.email?.toLowerCase() === email.toLowerCase());
        if (att && att.order_id) return res.status(200).json({ booked: true, order_id: att.order_id });
      }

      return res.status(200).json({ booked: false });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to check booking' });
    }
  }

  // POST — upload a file to Shopify (used by generate-pdf-thumbs script)
  if (req.method === 'POST') {
    const { filename, mimeType, dataBase64 } = req.body || {};
    if (!filename || !mimeType || !dataBase64) return res.status(400).json({ error: 'Missing filename, mimeType, or dataBase64' });

    try {
      const token = await getShopifyToken();
      const fileBuffer = Buffer.from(dataBase64, 'base64');
      const fileSize   = String(fileBuffer.length);

      const stagedRes = await shopifyGql(token, `
        mutation($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { field message }
          }
        }
      `, { input: [{ resource: 'IMAGE', filename, mimeType, fileSize, httpMethod: 'POST' }] });

      const ue1 = stagedRes.data?.stagedUploadsCreate?.userErrors;
      if (ue1?.length) return res.status(400).json({ error: ue1.map(e => e.message).join(', ') });
      const target = stagedRes.data?.stagedUploadsCreate?.stagedTargets?.[0];
      if (!target) return res.status(500).json({ error: 'No staged upload target', detail: stagedRes });

      const form = new FormData();
      target.parameters.forEach(p => form.append(p.name, p.value));
      form.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
      const uploadRes = await fetch(target.url, { method: 'POST', body: form });
      if (!uploadRes.ok) return res.status(500).json({ error: `S3 upload failed (${uploadRes.status})` });

      const fileRes = await shopifyGql(token, `
        mutation($files: [FileCreateInput!]!) {
          fileCreate(files: $files) { files { id } userErrors { field message } }
        }
      `, { files: [{ contentType: 'IMAGE', originalSource: target.resourceUrl, filename }] });

      const ue2 = fileRes.data?.fileCreate?.userErrors;
      if (ue2?.length) return res.status(400).json({ error: ue2.map(e => e.message).join(', ') });
      const fileGid = fileRes.data?.fileCreate?.files?.[0]?.id;
      if (!fileGid) return res.status(500).json({ error: 'No file GID returned' });
      return res.status(200).json({ fileGid });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
