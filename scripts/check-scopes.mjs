const STORE = 'krywbf-rv.myshopify.com';

async function getToken() {
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  const json = await res.json();
  console.log('Token response:', JSON.stringify(json, null, 2));
  return json.access_token;
}

async function main() {
  const token = await getToken();
  if (!token) { console.error('No token'); process.exit(1); }

  // Check scopes via REST
  const res = await fetch(`https://${STORE}/admin/api/2025-01/shop.json`, {
    headers: { 'X-Shopify-Access-Token': token },
  });
  console.log('\nShop API status:', res.status);

  // Try metaobjects directly
  const gqlRes = await fetch(`https://${STORE}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: `{ metaobjects(type: "member_file", first: 1) { edges { node { id } } } }` }),
  });
  const gql = await gqlRes.json();
  console.log('\nMetaobjects query result:', JSON.stringify(gql, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
