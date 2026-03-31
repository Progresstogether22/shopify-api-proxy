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
  return json.access_token;
}

async function gql(token, query, variables = {}) {
  const res = await fetch(`https://${STORE}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function main() {
  const token = await getToken();
  if (!token) { console.error('No token'); process.exit(1); }

  // Find member_file metaobjects with handle "empty"
  const find = await gql(token, `{
    metaobjects(type: "member_file", first: 250) {
      edges {
        node {
          id
          handle
          fields { key value }
        }
      }
    }
  }`);

  const all = find.data?.metaobjects?.edges || [];
  const toDelete = all.filter(e =>
    e.node.handle === 'empty' ||
    e.node.fields.find(f => f.key === 'title' && f.value?.toLowerCase() === 'empty')
  );

  if (!toDelete.length) {
    console.log('No member_file metaobject called "empty" found.');
    return;
  }

  for (const { node } of toDelete) {
    console.log(`Deleting: ${node.id} (handle: ${node.handle})`);
    const del = await gql(token, `
      mutation($id: ID!) {
        metaobjectDelete(id: $id) {
          deletedId
          userErrors { field message }
        }
      }
    `, { id: node.id });
    const result = del.data?.metaobjectDelete;
    if (result?.userErrors?.length) {
      console.error('Error:', result.userErrors);
    } else {
      console.log('Deleted:', result?.deletedId);
    }
  }
}

main().catch(console.error);
