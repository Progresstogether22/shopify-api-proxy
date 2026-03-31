/**
 * list-missing-thumbs.mjs
 * Lists member_file metaobjects that have a PDF file but no thumbnail.
 *
 * Usage:
 *   SHOPIFY_CLIENT_ID=xxx SHOPIFY_CLIENT_SECRET=yyy node scripts/list-missing-thumbs.mjs
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
  const json = await res.json();
  return json.access_token;
}

async function gql(token, query, variables = {}) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function getAllMetaobjects(token) {
  const items = [];
  let cursor = null;

  do {
    const data = await gql(token, `
      query($cursor: String) {
        metaobjects(type: "member_file", first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              handle
              fields { key value }
            }
          }
        }
      }
    `, { cursor });

    const page = data.data?.metaobjects;
    page.edges.forEach(e => items.push(e.node));
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  return items;
}

async function resolveFileUrl(token, gid) {
  if (!gid) return null;
  const data = await gql(token, `
    query($id: ID!) {
      node(id: $id) {
        ... on GenericFile { url }
        ... on MediaImage { image { url } }
      }
    }
  `, { id: gid });
  return data.data?.node?.url || data.data?.node?.image?.url || null;
}

async function main() {
  const token = await getToken();
  if (!token) { console.error('No token'); process.exit(1); }

  console.log('Fetching metaobjects…');
  const items = await getAllMetaobjects(token);
  console.log(`Total metaobjects: ${items.length}\n`);

  const missing = [];

  for (const item of items) {
    const field = k => item.fields.find(f => f.key === k)?.value;
    const title     = field('title') || item.handle;
    const fileGid   = field('file');
    const thumbGid  = field('thumbnail');

    if (!fileGid) continue; // no file at all

    // Resolve file URL to check if it's a PDF
    const fileUrl = await resolveFileUrl(token, fileGid);
    if (!fileUrl) continue;

    const isPdf = fileUrl.split('?')[0].toLowerCase().endsWith('.pdf');
    if (!isPdf) continue;

    if (!thumbGid) {
      missing.push({ title, handle: item.handle, fileUrl });
    }
  }

  if (!missing.length) {
    console.log('All PDFs have thumbnails!');
    return;
  }

  console.log(`PDFs missing thumbnails (${missing.length}):\n`);
  missing.forEach((m, i) => {
    console.log(`${i + 1}. ${m.title}`);
    console.log(`   Handle: ${m.handle}`);
    console.log(`   File:   ${m.fileUrl}\n`);
  });
}

main().catch(console.error);
