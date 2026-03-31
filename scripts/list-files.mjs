/**
 * list-files.mjs — lists all files currently in Shopify
 * Usage: SHOPIFY_CLIENT_ID=xxx SHOPIFY_CLIENT_SECRET=yyy node scripts/list-files.mjs
 */

const STORE = 'krywbf-rv.myshopify.com';
const API_VERSION = '2025-01';

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
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const { access_token } = await res.json();
  return access_token;
}

async function gql(token, query, variables = {}) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function main() {
  const token = await getToken();
  const files = [];
  let cursor = null;

  while (true) {
    const data = await gql(token, `
      query ($cursor: String) {
        files(first: 250, after: $cursor) {
          edges {
            cursor
            node {
              ... on GenericFile { id url }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `, { cursor });

    for (const edge of data.files.edges) {
      if (edge.node.url) {
        const filename = decodeURIComponent(edge.node.url.split('/').pop().split('?')[0]);
        files.push({ id: edge.node.id, filename });
      }
      cursor = edge.cursor;
    }

    if (!data.files.pageInfo.hasNextPage) break;
  }

  console.log(`Found ${files.length} files:\n`);
  files.forEach(f => console.log(f.filename));
}

main().catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
