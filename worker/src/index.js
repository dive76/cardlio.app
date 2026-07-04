/**
 * cardlio pass signer — Cloudflare Worker.
 *
 * POST /sign  { name, title?, company?, email?, phone?, mobile?, website?,
 *               addressLines?: string[], notes?, barcodeMessage, photoBase64? }
 *   → application/vnd.apple.pkpass
 *
 * Builds a Wallet "generic" pass for the caller's business card, signs the
 * manifest with the cardlio Pass Type ID certificate (Worker secrets), and
 * streams the .pkpass back. Nothing is logged or stored — the card exists
 * only for the lifetime of the request.
 *
 * Secrets (wrangler secret put …):
 *   PASS_CERT_PEM  — Pass Type ID certificate, PEM
 *   PASS_KEY_PEM   — its private key, PEM (unencrypted)
 *   WWDR_PEM       — Apple WWDR intermediate (G4), PEM
 * Vars (wrangler.toml):
 *   PASS_TYPE_ID, TEAM_ID, ORG_NAME
 */

import forge from "node-forge";

const MAX_BODY = 64 * 1024;          // biggest legitimate card ≈ 10 KB
const ICON_SIDE = { "icon.png": 29, "icon@2x.png": 58, "icon@3x.png": 87 };

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "https://cardlio.app",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/sign") {
      return new Response("cardlio pass signer", { status: 404, headers: cors });
    }
    if ((request.headers.get("content-length") | 0) > MAX_BODY) {
      return new Response("payload too large", { status: 413, headers: cors });
    }

    let card;
    try {
      card = await request.json();
    } catch {
      return new Response("bad json", { status: 400, headers: cors });
    }
    if (!card || typeof card.name !== "string" || !card.name.trim()) {
      return new Response("name required", { status: 400, headers: cors });
    }

    try {
      const pkpass = buildPass(card, env);
      return new Response(pkpass, {
        headers: {
          ...cors,
          "Content-Type": "application/vnd.apple.pkpass",
          "Content-Disposition": `attachment; filename="card.pkpass"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return new Response(`signing failed: ${e.message}`, { status: 500, headers: cors });
    }
  },
};

// ---------------------------------------------------------------- pass.json

function field(key, label, value) {
  return { key, label, value };
}

function buildPassJSON(card, env) {
  const name = card.name.trim();
  const secondary = [];
  if (card.title) secondary.push(field("title", "TITLE", card.title));
  if (card.company) secondary.push(field("company", "COMPANY", card.company));
  const auxiliary = [];
  if (card.phone) auxiliary.push(field("phone", "PHONE", card.phone));
  const back = [];
  if (card.email) back.push(field("email", "Email", card.email));
  if (card.mobile) back.push(field("mobile", "Mobile", card.mobile));
  if (card.website) back.push(field("website", "Website", card.website));
  const address = (card.addressLines || []).map(s => String(s).trim()).filter(Boolean).join("\n");
  if (address) back.push(field("address", "Address", address));
  if (card.notes) back.push(field("notes", "Notes", card.notes));

  const generic = { primaryFields: [field("name", "NAME", name)] };
  if (secondary.length) generic.secondaryFields = secondary;
  if (auxiliary.length) generic.auxiliaryFields = auxiliary;
  if (back.length) generic.backFields = back;

  const pass = {
    formatVersion: 1,
    passTypeIdentifier: env.PASS_TYPE_ID,
    serialNumber: crypto.randomUUID(),
    teamIdentifier: env.TEAM_ID,
    organizationName: env.ORG_NAME || "cardlio",
    description: `Contact card for ${name}`,
    logoText: name,
    foregroundColor: "rgb(255,255,255)",
    backgroundColor: "rgb(64,58,180)",     // cardlio indigo, slightly deepened
    labelColor: "rgb(199,189,255)",
    generic,
  };
  if (card.barcodeMessage) {
    pass.barcodes = [{
      format: "PKBarcodeFormatQR",
      message: String(card.barcodeMessage),
      messageEncoding: "iso-8859-1",
      altText: "Scan to open this card",
    }];
  }
  return JSON.stringify(pass);
}

// -------------------------------------------------------------- pass icons
// Wallet requires icon.png/@2x/@3x with exact pixel sizes. A solid cardlio-
// indigo square reads fine at 29–87 px; encoded here as minimal PNGs.

function makeIconPNG(side) {
  // Build an uncompressed-idat PNG: indigo RGB square.
  const w = side, h = side;
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const p = row + 1 + x * 3;
      raw[p] = 0x4f; raw[p + 1] = 0x46; raw[p + 2] = 0xe5;
    }
  }
  const idat = deflateStore(raw);
  return pngFromChunks(w, h, idat);
}

function pngFromChunks(w, h, idatData) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  const chunks = [
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = sig.length + chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  out.set(sig, 0);
  let off = sig.length;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib container with stored (uncompressed) deflate blocks. */
function deflateStore(data) {
  const blocks = [];
  const CM = new Uint8Array([0x78, 0x01]);
  blocks.push(CM);
  for (let i = 0; i < data.length; i += 65535) {
    const slice = data.subarray(i, Math.min(i + 65535, data.length));
    const last = i + 65535 >= data.length ? 1 : 0;
    const hdr = new Uint8Array(5);
    hdr[0] = last;
    hdr[1] = slice.length & 0xff; hdr[2] = slice.length >> 8;
    hdr[3] = ~slice.length & 0xff; hdr[4] = (~slice.length >> 8) & 0xff;
    blocks.push(hdr, slice);
  }
  const adler = adler32(data);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, adler);
  blocks.push(tail);
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) { out.set(b, off); off += b.length; }
  return out;
}

// ------------------------------------------------------------ sign + zip

function buildPass(card, env) {
  const files = new Map();
  files.set("pass.json", new TextEncoder().encode(buildPassJSON(card, env)));
  for (const [name, side] of Object.entries(ICON_SIDE)) {
    files.set(name, makeIconPNG(side));
  }
  if (card.photoBase64) {
    const photo = b64ToBytes(String(card.photoBase64));
    if (photo.length > 0 && photo.length < 300 * 1024) {
      files.set("thumbnail.png", photo);   // Wallet accepts JPEG bytes here too
      files.set("thumbnail@2x.png", photo);
    }
  }

  const manifest = {};
  for (const [name, data] of files) manifest[name] = sha1Hex(data);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  files.set("manifest.json", manifestBytes);
  files.set("signature", cmsSign(manifestBytes, env));
  return zip(files);
}

function cmsSign(content, env) {
  const cert = forge.pki.certificateFromPem(env.PASS_CERT_PEM);
  const key = forge.pki.privateKeyFromPem(env.PASS_KEY_PEM);
  const wwdr = forge.pki.certificateFromPem(env.WWDR_PEM);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(bytesToBinaryString(content));
  p7.addCertificate(wwdr);
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },   // auto-computed
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  return binaryStringToBytes(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

// Minimal ZIP (stored entries; passd accepts stored when sizes/CRCs are
// correct — signpass emits deflate, but stored is spec-valid and keeps
// this Worker dependency-free).
function zip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const [name, data] of files) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, 0, true);              // method: stored
    dv.setUint16(10, now.time, true);
    dv.setUint16(12, now.date, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    parts.push(local, data);

    const c = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 0x031e, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, now.time, true);
    cv.setUint16(14, now.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(38, 0o100644 << 16, true);
    cv.setUint32(42, offset, true);
    c.set(nameBytes, 46);
    central.push(c);
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of [...parts, ...central, end]) { out.set(p, pos); pos += p.length; }
  return out;
}

// ---------------------------------------------------------------- helpers

function sha1Hex(bytes) {
  const md = forge.md.sha1.create();
  md.update(bytesToBinaryString(bytes));
  return md.digest().toHex();
}

function bytesToBinaryString(bytes) {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
}

function binaryStringToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function b64ToBytes(b64) {
  try {
    const bin = atob(b64.replace(/\s/g, ""));
    return binaryStringToBytes(bin);
  } catch { return new Uint8Array(0); }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function dosDateTime(d) {
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  return { date, time };
}
