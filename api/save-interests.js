const STORE_DOMAIN = 'krywbf-rv.myshopify.com';
const API_VERSION = '2025-01';

function shopifyHeaders() {
  return {
    'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN,
    'Content-Type': 'application/json',
  };
}

async function findCustomerByEmail(email) {
  const res = await fetch(
    `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/search.json?query=email:${encodeURIComponent(email)}&limit=1`,
    { headers: shopifyHeaders() }
  );
  const data = await res.json();
  return data.customers?.[0] ?? null;
}

async function getExistingMetafield(customerId) {
  const res = await fetch(
    `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/${customerId}/metafields.json?namespace=custom&key=interests`,
    { headers: shopifyHeaders() }
  );
  const data = await res.json();
  return data.metafields?.[0] ?? null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, interests } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Missing email' });
  if (!Array.isArray(interests)) return res.status(400).json({ error: 'interests must be an array' });

  try {
    const customer = await findCustomerByEmail(email);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const existing = await getExistingMetafield(customer.id);
    const value = JSON.stringify(interests);

    let mfRes;
    if (existing) {
      mfRes = await fetch(
        `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/${customer.id}/metafields/${existing.id}.json`,
        {
          method: 'PUT',
          headers: shopifyHeaders(),
          body: JSON.stringify({ metafield: { id: existing.id, value, type: 'json' } }),
        }
      );
    } else {
      mfRes = await fetch(
        `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/customers/${customer.id}/metafields.json`,
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
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
