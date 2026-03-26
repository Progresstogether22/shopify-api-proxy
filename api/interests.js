const STORE_DOMAIN = 'krywbf-rv.myshopify.com';
const API_VERSION = '2025-01';

// In-memory token cache (best-effort within a warm function instance)
let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const response = await fetch(
    `https://${STORE_DOMAIN}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      }),
    }
  );

  if (!response.ok) throw new Error(`Token request failed: ${response.status}`);

  const { access_token, expires_in } = await response.json();
  cachedToken = access_token;
  tokenExpiresAt = Date.now() + expires_in * 1000;
  return cachedToken;
}

async function shopifyHeaders() {
  const token = await getToken();
  return {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const customerId = req.method === 'GET' ? req.query.customerId : req.body?.customerId;
  const email      = req.method === 'GET' ? req.query.email      : req.body?.email;

  if (!customerId && !email) return res.status(400).json({ error: 'Missing customerId or email' });

  try {
    const headers = await shopifyHeaders();

    let resolvedId = customerId;

    if (!resolvedId) {
      const searchRes = await fetch(
        `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/search.json?query=email:${encodeURIComponent(email)}&limit=1`,
        { headers }
      );
      const searchData = await searchRes.json();
      const customer = searchData.customers?.[0];
      if (!customer) return res.status(404).json({ error: 'Customer not found' });
      resolvedId = customer.id;
    }

    if (req.method === 'GET') {
      const mfRes = await fetch(
        `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/${resolvedId}/metafields.json?namespace=custom&key=interests`,
        { headers }
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
        { headers }
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
            headers,
            body: JSON.stringify({ metafield: { id: existing.id, value, type: 'json' } }),
          }
        );
      } else {
        mfRes = await fetch(
          `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/${resolvedId}/metafields.json`,
          {
            method: 'POST',
            headers,
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
