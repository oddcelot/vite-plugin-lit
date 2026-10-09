/**
 * Packs a zip into a CRX3 file signed with an RSA key, and reads one back.
 *
 * The Chrome Web Store takes only signed CRX uploads once an item has opted
 * in to verified uploads, so `package-extension.mjs` writes one next to the
 * zip. The format is small enough to write by hand rather than pull in a
 * packer (Chromium's `components/crx_file/crx3.proto`):
 *
 *     "Cr24" | uint32le 3 | uint32le header length | CrxFileHeader | zip
 *
 * where the header is a protobuf holding the signed data (the 16-byte CRX id,
 * the SHA-256 of the public key's DER cut to 16 bytes) and one
 * `sha256_with_rsa` proof: the public key and its PKCS#1 v1.5 signature over
 * `"CRX3 SignedData\0" | uint32le signed data length | signed data | zip`.
 */

import {createHash, createPublicKey, sign, verify} from 'node:crypto';

const MAGIC = Buffer.from('Cr24');
const SIGNED_PREFIX = Buffer.from('CRX3 SignedData\0');

const varint = (n) => {
  const bytes = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return Buffer.from(bytes);
};

/** One length-delimited protobuf field. */
const field = (number, bytes) =>
  Buffer.concat([varint((number << 3) | 2), varint(bytes.length), bytes]);

/** The length-delimited fields of a protobuf message, as `[number, bytes]`. */
const fields = function* (buf) {
  let at = 0;
  const read = () => {
    let n = 0;
    let shift = 0;
    let byte;
    do {
      byte = buf[at++];
      n += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return n;
  };
  while (at < buf.length) {
    const tag = read();
    if ((tag & 7) !== 2) throw new Error(`Unexpected wire type in CRX header`);
    const length = read();
    yield [tag >>> 3, buf.subarray(at, at + length)];
    at += length;
  }
};

const uint32le = (n) => {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n);
  return buf;
};

const signedMessage = (signedData, zip) =>
  Buffer.concat([SIGNED_PREFIX, uint32le(signedData.length), signedData, zip]);

/** The extension id Chrome derives from a public key's DER: hex as a–p. */
const extensionId = (crxId) =>
  [...crxId.toString('hex')]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join('');

/**
 * `zip` signed with `privateKeyPem` as a CRX3 file, and the extension id the
 * key gives it.
 */
export const packCrx3 = (zip, privateKeyPem) => {
  const publicKey = createPublicKey(privateKeyPem).export({
    type: 'spki',
    format: 'der',
  });
  const crxId = createHash('sha256').update(publicKey).digest().subarray(0, 16);
  const signedData = field(1, crxId);
  const signature = sign(
    'sha256',
    signedMessage(signedData, zip),
    privateKeyPem
  );
  const header = Buffer.concat([
    field(2, Buffer.concat([field(1, publicKey), field(2, signature)])),
    field(10000, signedData),
  ]);
  return {
    crx: Buffer.concat([
      MAGIC,
      uint32le(3),
      uint32le(header.length),
      header,
      zip,
    ]),
    id: extensionId(crxId),
  };
};

/**
 * Checks a CRX3 file the way Chrome does: a proof whose key hashes to the
 * declared id, and whose signature holds over the archive. Returns the id
 * and the archive; throws on anything else.
 */
export const readCrx3 = (crx) => {
  if (!crx.subarray(0, 4).equals(MAGIC) || crx.readUInt32LE(4) !== 3) {
    throw new Error('Not a CRX3 file');
  }
  const headerEnd = 12 + crx.readUInt32LE(8);
  const header = crx.subarray(12, headerEnd);
  const zip = crx.subarray(headerEnd);
  let signedData;
  const proofs = [];
  for (const [number, bytes] of fields(header)) {
    if (number === 10000) signedData = bytes;
    if (number === 2) proofs.push(Object.fromEntries(fields(bytes)));
  }
  if (!signedData) throw new Error('CRX header has no signed data');
  const crxId = Object.fromEntries(fields(signedData))[1];
  const message = signedMessage(signedData, zip);
  const ok = proofs.some(
    ({1: publicKey, 2: signature}) =>
      createHash('sha256')
        .update(publicKey)
        .digest()
        .subarray(0, 16)
        .equals(crxId) &&
      verify(
        'sha256',
        message,
        createPublicKey({key: publicKey, format: 'der', type: 'spki'}),
        signature
      )
  );
  if (!ok) throw new Error('No CRX proof matches its id and archive');
  return {id: extensionId(crxId), zip};
};
