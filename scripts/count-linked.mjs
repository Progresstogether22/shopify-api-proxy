/**
 * count-linked.mjs — counts member_file metaobjects with/without file or URL
 * Usage: SHOPIFY_CLIENT_ID=xxx SHOPIFY_CLIENT_SECRET=yyy node scripts/count-linked.mjs
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
  let linked = 0, unlinked = [], cursor = null;

  while (true) {
    const data = await gql(token, `
      query ($cursor: String) {
        metaobjects(type: "member_file", first: 250, after: $cursor) {
          edges {
            cursor
            node { fields { key value } }
          }
          pageInfo { hasNextPage }
        }
      }
    `, { cursor });

    for (const edge of data.metaobjects.edges) {
      const fields = edge.node.fields;
      const file  = fields.find(f => f.key === 'file')?.value;
      const url   = fields.find(f => f.key === 'url')?.value;
      const title = fields.find(f => f.key === 'title')?.value || '(no title)';
      const hasFile = file && file !== 'null';
      const hasUrl  = url  && url  !== 'null' && url !== '';
      if (hasFile || hasUrl) { linked++; } else { unlinked.push(title); }
      cursor = edge.cursor;
    }

    if (!data.metaobjects.pageInfo.hasNextPage) break;
  }

  const total = linked + unlinked.length;
  console.log(`Total:   ${total}`);
  console.log(`Linked:  ${linked}`);
  console.log(`Missing: ${unlinked.length}`);
  if (unlinked.length) {
    console.log('\nMissing file/URL:');
    unlinked.forEach(t => console.log(`  - ${t}`));
  }
}

main().catch(err => { console.error('Fatal error:', err.message); process.exit(1); });
