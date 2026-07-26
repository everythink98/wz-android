function cleanSha256(value) {
  const digest = String(value || '').replace(/:/g, '').toLowerCase();
  return /^[a-f0-9]{64}$/.test(digest) ? digest : '';
}

function singleApkSignerSha256(output) {
  const numbered = [...String(output || '').matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([a-fA-F0-9:]+)/g)]
    .map((match) => cleanSha256(match[1]));
  if (numbered.length) {
    return numbered.length === 1 ? numbered[0] : '';
  }
  const legacy = [...String(output || '').matchAll(/V\d+(?:\.\d+)? Signer: certificate SHA-256 digest:\s*([a-fA-F0-9:]+)/g)]
    .map((match) => cleanSha256(match[1]));
  const unique = [...new Set(legacy.filter(Boolean))];
  return unique.length === 1 ? unique[0] : '';
}

module.exports = { singleApkSignerSha256 };
