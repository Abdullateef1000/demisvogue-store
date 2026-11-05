function detectProofExtension(buffer) {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return '.pdf';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return '.gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return null;
}

module.exports = { detectProofExtension };
