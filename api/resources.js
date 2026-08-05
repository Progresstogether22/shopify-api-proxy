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
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token request failed: ${response.status} — ${body}`);
  }
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
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// Resolve a batch of GIDs (file + image references) in one query
async function resolveNodes(token, ids) {
  if (!ids.length) return {};
  const data = await gql(token, `
    query ($ids: [ID!]!) {
      nodes(ids: $ids) {
        id
        ... on GenericFile { url }
        ... on MediaImage   { image { url } }
      }
    }
  `, { ids });

  const map = {};
  for (const node of data.nodes || []) {
    if (!node) continue;
    map[node.id] = node.url || node.image?.url || null;
  }
  return map;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = await getToken();
    const rawResources = [];
    let cursor = null;

    // 1. Fetch all metaobjects
    while (true) {
      const data = await gql(token, `
        query ($cursor: String) {
          metaobjects(type: "member_file", first: 250, after: $cursor) {
            edges {
              cursor
              node {
                handle
                fields { key value }
              }
            }
            pageInfo { hasNextPage }
          }
        }
      `, { cursor });

      for (const edge of data.metaobjects.edges) {
        const fields = {};
        for (const f of edge.node.fields) fields[f.key] = f.value;
        rawResources.push({ handle: edge.node.handle, fields });
        cursor = edge.cursor;
      }

      if (!data.metaobjects.pageInfo.hasNextPage) break;
    }

    // 2. Collect all file/thumbnail GIDs for batch resolution
    const fileIds      = [...new Set(rawResources.map(r => r.fields.file).filter(v => v && v !== 'null'))];
    const thumbnailIds = [...new Set(rawResources.map(r => r.fields.thumbnail).filter(v => v && v !== 'null'))];
    const allIds = [...fileIds, ...thumbnailIds];

    // Resolve in chunks of 250
    const urlMap = {};
    for (let i = 0; i < allIds.length; i += 250) {
      const chunk = allIds.slice(i, i + 250);
      Object.assign(urlMap, await resolveNodes(token, chunk));
    }

    // 3. Build intermediate resource list (exclude hidden items)
    const resources = rawResources.filter(({ fields }) => fields.hidden !== 'true').map(({ handle, fields }) => ({
      handle,
      title:        fields.title       || '',
      description:  fields.description || '',
      category:     (fields.category   || '').trim(),
      tags:         (() => {
        const raw = (fields.tag || '').trim();
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed)
            ? parsed.map(t => String(t).trim().toLowerCase()).filter(Boolean)
            : [String(parsed).trim().toLowerCase()].filter(Boolean);
        } catch (_) {
          return raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        }
      })(),
      file_url:      urlMap[fields.file]       || '',
      video_url:     fields.url               || '',
      thumbnail:     urlMap[fields.thumbnail]  || null,
      publish_date:  fields.publish_date       || null,
      members_only: fields.public_file !== undefined
        ? fields.public_file === 'false'   // new key: false = not public = members-only
        : fields.members_only === 'false', // old key, now relabelled "Public File": false = not public = members-only
    }));

    // 3b. Sort by publish date, most recent first (undated resources sort last)
    resources.sort((a, b) => {
      const aTime = a.publish_date ? Date.parse(a.publish_date) : NaN;
      const bTime = b.publish_date ? Date.parse(b.publish_date) : NaN;
      if (isNaN(aTime) && isNaN(bTime)) return 0;
      if (isNaN(aTime)) return 1;
      if (isNaN(bTime)) return -1;
      return bTime - aTime;
    });

    // 4. Fetch YouTube descriptions for video resources with no manual description
    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
    if (YOUTUBE_API_KEY) {
      function extractYouTubeId(url) {
        if (!url) return null;
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/))([^?&"'>]+)/);
        return match ? match[1] : null;
      }

      // Collect video IDs for resources without a description
      const videoIdMap = {}; // ytId -> resource index
      resources.forEach((r, i) => {
        if (r.video_url && !r.description) {
          const ytId = extractYouTubeId(r.video_url);
          if (ytId) videoIdMap[ytId] = i;
        }
      });

      const videoIds = Object.keys(videoIdMap);
      if (videoIds.length) {
        // YouTube API allows up to 50 IDs per request
        for (let i = 0; i < videoIds.length; i += 50) {
          const chunk = videoIds.slice(i, i + 50);
          try {
            const ytRes = await fetch(
              `https://www.googleapis.com/youtube/v3/videos?id=${chunk.join(',')}&part=snippet&key=${YOUTUBE_API_KEY}`
            );
            if (ytRes.ok) {
              const ytData = await ytRes.json();
              for (const item of (ytData.items || [])) {
                const idx = videoIdMap[item.id];
                if (idx !== undefined && item.snippet && item.snippet.description) {
                  resources[idx].description = item.snippet.description;
                }
              }
            }
          } catch (_) {}
        }
      }
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ resources });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
