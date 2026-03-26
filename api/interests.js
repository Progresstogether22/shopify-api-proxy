const STORE_DOMAIN = 'krywbf-rv.myshopify.com';
const API_VERSION = '2025-01';

function shopifyHeaders() {
  return {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
    'Content-Type': 'application/json',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Accept customerId directly (preferred) or fall back to email search
  const customerId = req.method === 'GET' ? req.query.customerId : req.body?.customerId;
  const email      = req.method === 'GET' ? req.query.email      : req.body?.email;

  if (!customerId && !email) return res.status(400).json({ error: 'Missing customerId or email' });

  try {
    let resolvedId = customerId;

    if (!resolvedId) {
      const searchRes = await fetch(
        `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/search.json?query=email:${encodeURIComponent(email)}&limit=1`,
        { headers: shopifyHeaders() }
      );
      const searchData = await searchRes.json();
      const customer = searchData.customers?.[0];
      if (!customer) return res.status(404).json({ error: 'Customer not found' });
      resolvedId = customer.id;
    }

    if (req.method === 'GET') {
      const mfRes = await fetch(
        `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/${resolvedId}/metafields.json?namespace=custom&key=interests`,
        { headers: shopifyHeaders() }
      );
      const mfData = await mfRes.json();
      const metafield = mfData.metafields?.[0];
      const interests = metafield ? JSON.parse(metafield.value) : [];
      return res.status(200).json({ interests });
    }

    if (req.method === 'POST') {
      const { interests } = req.body || {};
      if (!Array.isArray(interests)) return res.status(400).json({ error: 'interests must be an array' });

      const mfListRes = await fetch(
        `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/${resolvedId}/metafields.json?namespace=custom&key=interests`,
        { headers: shopifyHeaders() }
      );
      const mfListData = await mfListRes.json();
      const existing = mfListData.metafields?.[0];
      const value = JSON.stringify(interests);

      let mfRes;
      if (existing) {
        mfRes = await fetch(
          `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/${resolvedId}/metafields/${existing.id}.json`,
          {
            method: 'PUT',
            headers: shopifyHeaders(),
            body: JSON.stringify({ metafield: { id: existing.id, value, type: 'json' } }),
          }
        );
      } else {
        mfRes = await fetch(
          `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/${resolvedId}/metafields.json`,
          {
            method: 'POST',
            headers: shopifyHeaders(),
            body: JSON.stringify({
              metafield: { namespace: 'custom', key: 'interests', value, type: 'json' },
            }),
          }
        );
      }

      if (!mfRes.ok) {
        const err = await mfRes.json();
        return res.status(500).json({ error: err.errors || 'Failed to save metafield' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
