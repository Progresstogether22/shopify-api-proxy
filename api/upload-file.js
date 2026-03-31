const STORE_DOMAIN = 'krywbf-rv.myshopify.com';
const API_VERSION = '2025-01';

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;
  const response = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  const { access_token, expires_in } = await response.json();
  cachedToken = access_token;
  tokenExpiresAt = Date.now() + expires_in * 1000;
  return cachedToken;
}

async function gql(token, query, variables = {}) {
  const res = await fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { filename, mimeType, dataBase64 } = req.body || {};
  if (!filename || !mimeType || !dataBase64) {
    return res.status(400).json({ error: 'Missing filename, mimeType, or dataBase64' });
  }

  try {
    const token = await getToken();
    const fileBuffer = Buffer.from(dataBase64, 'base64');
    const fileSize = String(fileBuffer.length);

    // 1. Request staged upload target
    const stagedRes = await gql(token, `
      mutation($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { field message }
        }
      }
    `, {
      input: [{ resource: 'IMAGE', filename, mimeType, fileSize, httpMethod: 'POST' }],
    });

    const userErrors = stagedRes.data?.stagedUploadsCreate?.userErrors;
    if (userErrors?.length) return res.status(400).json({ error: userErrors.map(e => e.message).join(', ') });

    const target = stagedRes.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target) return res.status(500).json({ error: 'No staged upload target returned', detail: stagedRes });

    // 2. Upload to S3
    const form = new FormData();
    target.parameters.forEach(p => form.append(p.name, p.value));
    form.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
    const uploadRes = await fetch(target.url, { method: 'POST', body: form });
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      return res.status(500).json({ error: `S3 upload failed (${uploadRes.status})`, detail: text.slice(0, 300) });
    }

    // 3. Register file in Shopify
    const fileRes = await gql(token, `
      mutation($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { id }
          userErrors { field message }
        }
      }
    `, {
      files: [{ contentType: 'IMAGE', originalSource: target.resourceUrl, filename }],
    });

    const fileErrors = fileRes.data?.fileCreate?.userErrors;
    if (fileErrors?.length) return res.status(400).json({ error: fileErrors.map(e => e.message).join(', ') });

    const fileGid = fileRes.data?.fileCreate?.files?.[0]?.id;
    if (!fileGid) return res.status(500).json({ error: 'No file GID returned' });

    return res.status(200).json({ fileGid });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
