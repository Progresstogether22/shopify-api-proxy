/**
 * generate-pdf-thumbs.mjs
 * Generates and uploads cover thumbnails for member_file metaobjects
 * that have a PDF file but no thumbnail image.
 *
 * Uses macOS built-in qlmanage — no installation required.
 *
 * Usage:
 *   SHOPIFY_CLIENT_ID=xxx SHOPIFY_CLIENT_SECRET=yyy node scripts/generate-pdf-thumbs.mjs
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const STORE = 'krywbf-rv.myshopify.com';
const API_VERSION = '2025-01';
const PROXY_URL = 'https://shopify-api-proxy-gules.vercel.app';

// ─── Auth ────────────────────────────────────────────────────────────────────

async function getToken() {
  // Prefer a direct access token (shpat_xxx) if provided
  if (process.env.SHOPIFY_ACCESS_TOKEN) {
    return process.env.SHOPIFY_ACCESS_TOKEN;
  }
  // Fall back to OAuth client credentials
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

// ─── Fetch metaobjects missing thumbnails ────────────────────────────────────

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

async function getMissingThumbItems(token) {
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

  const missing = [];

  for (const item of items) {
    const field = k => item.fields.find(f => f.key === k)?.value;
    const title    = field('title') || item.handle;
    const fileGid  = field('file');
    const thumbGid = field('thumbnail');

    if (!fileGid || thumbGid) continue;

    const fileUrl = await resolveFileUrl(token, fileGid);
    if (!fileUrl) continue;

    const isPdf = fileUrl.split('?')[0].toLowerCase().endsWith('.pdf');
    if (!isPdf) continue;

    missing.push({ id: item.id, handle: item.handle, title, fileUrl });
  }

  return missing;
}

// ─── PDF → PNG via macOS qlmanage ────────────────────────────────────────────

function renderPdfFirstPage(pdfPath, outDir) {
  // qlmanage -t renders a Quick Look thumbnail; -s sets max dimension in pixels.
  // Output is written as <filename>.png inside outDir.
  const result = spawnSync('qlmanage', [
    '-t',
    '-s', '800',
    '-o', outDir,
    pdfPath,
  ], { timeout: 30_000 });

  // qlmanage exits 0 even on partial success; check for the output file.
  const basename = path.basename(pdfPath);
  const outFile  = path.join(outDir, basename + '.png');
  if (!fs.existsSync(outFile)) {
    const stderr = result.stderr?.toString() || '';
    throw new Error(`qlmanage produced no output: ${stderr.slice(0, 200)}`);
  }
  return outFile;
}

// ─── Upload image via proxy ───────────────────────────────────────────────────

async function uploadImageToShopify(_token, imagePath, filename) {
  const fileBuffer = fs.readFileSync(imagePath);
  const mimeType   = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const dataBase64 = fileBuffer.toString('base64');

  const res = await fetch(`${PROXY_URL}/api/upload-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, mimeType, dataBase64 }),
  });

  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || json.detail || 'Upload failed');
  if (!json.fileGid) throw new Error('No fileGid returned from proxy');
  return json.fileGid;
}

// ─── Update metaobject thumbnail field ───────────────────────────────────────

async function setThumbnail(token, metaobjectId, fileGid) {
  const result = await gql(token, `
    mutation($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }
  `, {
    id: metaobjectId,
    metaobject: {
      fields: [{ key: 'thumbnail', value: fileGid }],
    },
  });

  const errs = result.data?.metaobjectUpdate?.userErrors;
  if (errs?.length) throw new Error('metaobjectUpdate: ' + errs.map(e => e.message).join(', '));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const debugMode = process.argv.includes('--debug');

  // Check qlmanage is available (built-in on macOS)
  const check = spawnSync('which', ['qlmanage']);
  if (check.status !== 0) {
    console.error('❌  qlmanage not found. This script requires macOS.');
    process.exit(1);
  }

  const token = await getToken();
  if (!token) { console.error('No access token'); process.exit(1); }
  if (debugMode) console.log('Token:', token.slice(0, 8) + '…');

  console.log('Fetching metaobjects missing thumbnails…');
  const items = await getMissingThumbItems(token);

  if (!items.length) {
    console.log('All PDFs already have thumbnails!');
    return;
  }

  console.log(`Found ${items.length} PDFs without thumbnails.\n`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-thumbs-'));
  let succeeded = 0;
  let failed    = 0;

  try {
    for (let i = 0; i < items.length; i++) {
      const item   = items[i];
      const prefix = `[${i + 1}/${items.length}]`;
      process.stdout.write(`${prefix} ${item.title.slice(0, 60)}… `);

      const pdfPath = path.join(tmpDir, `${item.handle}.pdf`);

      try {
        // Download PDF
        const pdfRes = await fetch(item.fileUrl);
        if (!pdfRes.ok) throw new Error(`PDF download failed (HTTP ${pdfRes.status})`);
        fs.writeFileSync(pdfPath, Buffer.from(await pdfRes.arrayBuffer()));

        // Render first page to PNG via qlmanage
        const imagePath = renderPdfFirstPage(pdfPath, tmpDir);

        // Upload to Shopify
        const filename = `thumb-${item.handle}.png`;
        const fileGid  = await uploadImageToShopify(token, imagePath, filename);

        // Give Shopify a moment to process the file before referencing it
        await delay(2000);

        // Update metaobject
        await setThumbnail(token, item.id, fileGid);

        console.log('✓');
        succeeded++;
      } catch (err) {
        console.log(`✗  ${err.message}`);
        failed++;
        if (debugMode) break; // stop after first failure in debug mode
      }

      // Clean up per-item files
      for (const f of fs.readdirSync(tmpDir)) {
        if (f.startsWith(item.handle)) {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
        }
      }

      // Brief pause between items to stay well within API rate limits
      if (i < items.length - 1) await delay(500);
    }
  } finally {
    try { fs.rmdirSync(tmpDir); } catch {}
  }

  console.log(`\nFinished: ${succeeded} succeeded, ${failed} failed.`);
  if (failed) {
    console.log('Re-run the script to retry failed items (it skips any that already have a thumbnail).');
  }
}

main().catch(console.error);
