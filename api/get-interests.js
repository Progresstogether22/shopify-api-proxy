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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    const searchRes = await fetch(
      `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/search.json?query=email:${encodeURIComponent(email)}&limit=1`,
      { headers: shopifyHeaders() }
    );
    const searchData = await searchRes.json();
    const customer = searchData.customers?.[0];
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const mfRes = await fetch(
      `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/${customer.id}/metafields.json?namespace=custom&key=interests`,
      { headers: shopifyHeaders() }
    );
    const mfData = await mfRes.json();
    const metafield = mfData.metafields?.[0];

    const interests = metafield ? JSON.parse(metafield.value) : [];
    return res.status(200).json({ interests });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
