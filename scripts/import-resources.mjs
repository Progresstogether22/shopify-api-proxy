/**
 * import-resources.mjs
 * Bulk import/upsert member_file metaobjects from a CSV spreadsheet.
 *
 * Usage:
 *   SHOPIFY_CLIENT_ID=xxx SHOPIFY_CLIENT_SECRET=yyy node scripts/import-resources.mjs /path/to/file.csv
 *
 * Dependencies:
 *   npm install csv-parse
 */

import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

const STORE = 'krywbf-rv.myshopify.com';
const API_VERSION = '2025-01';
const CSV_PATH = process.argv[2];

if (!CSV_PATH) {
  console.error('Usage: node scripts/import-resources.mjs /path/to/file.csv');
  process.exit(1);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

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

// ── GraphQL helper ────────────────────────────────────────────────────────────

async function gql(token, query, variables = {}) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// ── Fetch all Shopify files (keyed by filename) ───────────────────────────────

async function fetchShopifyFiles(token) {
  const files = {};
  let cursor = null;

  while (true) {
    const data = await gql(token, `
      query Files($cursor: String) {
        files(first: 250, after: $cursor) {
          edges {
            cursor
            node {
              ... on GenericFile {
                id
                url
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `, { cursor });

    for (const edge of data.files.edges) {
      if (edge.node.url) {
        const filename = decodeURIComponent(edge.node.url.split('/').pop().split('?')[0]);
        files[normaliseFilename(filename)] = edge.node.id;
      }
      cursor = edge.cursor;
    }

    if (!data.files.pageInfo.hasNextPage) break;
  }

  console.log(`  Found ${Object.keys(files).length} files in Shopify\n`);
  return files;
}

// ── Fetch existing metaobjects (keyed by title field value) ───────────────────

async function fetchExistingMetaobjects(token) {
  const existing = {};
  let cursor = null;

  while (true) {
    const data = await gql(token, `
      query Metaobjects($cursor: String) {
        metaobjects(type: "member_file", first: 250, after: $cursor) {
          edges {
            cursor
            node {
              id
              fields { key value }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `, { cursor });

    for (const edge of data.metaobjects.edges) {
      const titleField = edge.node.fields.find(f => f.key === 'title');
      if (titleField?.value) existing[titleField.value] = edge.node.id;
      cursor = edge.cursor;
    }

    if (!data.metaobjects.pageInfo.hasNextPage) break;
  }

  console.log(`  Found ${Object.keys(existing).length} existing metaobjects\n`);
  return existing;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Normalise filenames the same way Shopify does on upload, so we can match
// spreadsheet filenames (with spaces/special chars) to Shopify file IDs.
function normaliseFilename(name) {
  const dotIdx = name.lastIndexOf('.');
  const ext  = dotIdx !== -1 ? name.slice(dotIdx).toLowerCase() : '';
  const base = dotIdx !== -1 ? name.slice(0, dotIdx) : name;
  return base
    .replace(/\u200b/g, '')            // remove zero-width spaces
    .replace(/[–—]/g, '')              // remove en/em dashes
    .replace(/[\u2018\u2019'''`]/g, '') // remove curly + straight single quotes
    .replace(/[\u201c\u201d"""]/g, '') // remove curly + straight double quotes
    .replace(/[&]/g, '_')              // ampersand → underscore (matches Shopify's D&I → D_I)
    .replace(/[()[\];:!?]/g, '')       // remove brackets and punctuation
    .replace(/[-\s]+/g, '_')           // spaces/hyphens → underscores
    .replace(/_+/g, '_')               // collapse multiple underscores
    .replace(/^_|_$/g, '')             // trim leading/trailing underscores
    .toLowerCase()
    + ext;
}

function isYouTube(link) {
  return Boolean(link && (link.includes('youtube.com') || link.includes('youtu.be')));
}

function filenameFromLink(link) {
  if (!link) return null;
  // Handle bare filenames (no slashes), full URLs, or SharePoint URLs
  const part = link.split('/').pop().split('?')[0];
  return decodeURIComponent(part) || null;
}

function buildTags(row) {
  return [
    row['Resource Type'],
    row['Format'],
    row['Source activity'],
    row['Collaborating organisation'],
    row['Audience Maturity'],
    row['Keywords'],
    row['keywords_1'],
    row['keywords_2'],
  ]
    .map(v => v?.trim())
    .filter(Boolean)
    .join(',');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔑 Getting Shopify token...');
  const token = await getToken();

  console.log('📁 Fetching Shopify files...');
  const shopifyFiles = await fetchShopifyFiles(token);

  console.log('📦 Fetching existing metaobjects...');
  const existing = await fetchExistingMetaobjects(token);

  // Parse CSV — name unnamed columns by index to handle empty headers
  const csvText = readFileSync(CSV_PATH, 'utf8');
  const rows = parse(csvText, {
    columns: (headers) =>
      headers.map((h, i) => {
        const clean = h.trim();
        if (clean) return clean;
        // Map the two unnamed keyword columns by their known position
        if (i === 9) return 'keywords_1';
        if (i === 10) return 'keywords_2';
        return `_col${i}`;
      }),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  let created = 0, updated = 0, skipped = 0;
  const noFile = [];

  console.log(`📝 Processing ${rows.length} rows...\n`);

  for (const row of rows) {
    const title = row['Title']?.trim();
    if (!title) { skipped++; continue; }

    const link = row['Link']?.trim();
    const tags = buildTags(row);

    const fields = [
      { key: 'title',       value: title },
      { key: 'description', value: row['Description']?.trim() || '' },
      { key: 'category',    value: row['Category']?.trim() || '' },
      { key: 'tag',         value: tags },
      { key: 'members_only', value: 'false' },
    ];

    if (isYouTube(link)) {
      fields.push({ key: 'url', value: link });
    } else if (link) {
      const filename = filenameFromLink(link);
      const fileId = filename ? shopifyFiles[normaliseFilename(filename)] : null;
      if (fileId) {
        fields.push({ key: 'file', value: fileId });
      } else {
        noFile.push({ title, filename });
        console.log(`  ⚠️  File not found in Shopify: "${filename}"`);
      }
    }

    try {
      const existingId = existing[title];

      if (existingId) {
        const result = await gql(token, `
          mutation Update($id: ID!, $metaobject: MetaobjectUpdateInput!) {
            metaobjectUpdate(id: $id, metaobject: $metaobject) {
              metaobject { id }
              userErrors { field message }
            }
          }
        `, { id: existingId, metaobject: { fields } });

        const errors = result.metaobjectUpdate.userErrors;
        if (errors.length) {
          console.log(`  ❌ Update error for "${title}": ${JSON.stringify(errors)}`);
        } else {
          console.log(`  ✅ Updated: ${title}`);
          updated++;
        }
      } else {
        const result = await gql(token, `
          mutation Create($metaobject: MetaobjectCreateInput!) {
            metaobjectCreate(metaobject: $metaobject) {
              metaobject { id }
              userErrors { field message }
            }
          }
        `, { metaobject: { type: 'member_file', fields } });

        const errors = result.metaobjectCreate.userErrors;
        if (errors.length) {
          console.log(`  ❌ Create error for "${title}": ${JSON.stringify(errors)}`);
        } else {
          console.log(`  ✨ Created: ${title}`);
          created++;
        }
      }
    } catch (err) {
      console.log(`  ❌ Error for "${title}": ${err.message}`);
    }

    // Avoid hitting Shopify rate limits
    await sleep(300);
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`✨ Created:  ${created}`);
  console.log(`✅ Updated:  ${updated}`);
  console.log(`⏭️  Skipped:  ${skipped}`);
  if (noFile.length) {
    console.log(`\n⚠️  ${noFile.length} resources need a file attached manually:`);
    noFile.forEach(({ title, filename }) =>
      console.log(`   - ${title}${filename ? ` (looking for: ${filename})` : ''}`)
    );
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
