// my dumbah made the repo but forgot the script, a week later someone asked for it and I had to search for it :/

// ---------- CRC32 core (pure JS) ----------
function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}
const CRC32_TABLE = makeCrc32Table();

function crc32ForString(str) {
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(str) : Buffer.from(str, 'utf8');
  let crc = 0xFFFFFFFF >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    crc = (CRC32_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function parseTargetCrc(target) {
  if (typeof target === 'number' && Number.isFinite(target)) return (target >>> 0);
  if (typeof target === 'string') {
    let s = target.trim().toLowerCase();
    if (s.startsWith('0x')) s = s.slice(2);
    if (/^[0-9a-f]+$/.test(s)) return Number.parseInt(s, 16) >>> 0;
    if (/^[0-9]+$/.test(s)) return Number.parseInt(s, 10) >>> 0;
  }
  throw new Error('Unsupported target CRC format. Use number, decimal string or hex (e.g. "deadbeef" or "0xDEADBEEF").');
}

// ---------- helper to normalize allowed chars ----------
/**
 * normalizeAllowedChars: accepts:
 *  - a single string of characters: "0123456789"
 *  - an array of single-char strings: ["0","1","2",...]
 *  - an array with a single string element: ["0123..."]
 * returns array of single characters.
 */
function normalizeAllowedChars(allowed) {
  if (typeof allowed === 'string') return Array.from(allowed);
  if (Array.isArray(allowed)) {
    if (allowed.length === 1 && typeof allowed[0] === 'string') return Array.from(allowed[0]);
    // assume array of single-character strings
    if (allowed.every(ch => typeof ch === 'string' && ch.length === 1)) return allowed.slice();
  }
  throw new Error('allowedChars must be a string or array of single-character strings.');
}

// ---------- Core brute-force function ----------
/**
 * Brute-force generator to find a string matching a CRC32.
 *
 * Options:
 *  - requiredPrefix: string to prefix every candidate (default: "")
 *  - requiredSuffix: string to suffix every candidate (default: "")
 *  - minLen: minimum length of the variable part (excluding prefix/suffix) (default: 1)
 *  - maxLen: maximum length of the variable part (excluding prefix/suffix) (default: 6)
 *  - allowedChars: string or array of characters to use for the variable part (default: "0123456789")
 *  - chunkSize: number of iterations between yields to event loop (default: 5000)
 *  - onProgress: function(triedCount, currentCandidate) called occasionally
 *
 * Returns: Promise<string|null> first matching full string (prefix+var+suffix) or null if not found.
 */
async function bruteForceCrc32(targetCrc, options = {}) {
  const {
    requiredPrefix = '',
    requiredSuffix = '',
    minLen = 1,
    maxLen = 6,
    allowedChars = '0123456789',
    chunkSize = 5000,
    onProgress = null,
  } = options;

  const target = parseTargetCrc(targetCrc);
  const chars = normalizeAllowedChars(allowedChars);
  const radix = chars.length;

  if (!(Number.isInteger(minLen) && Number.isInteger(maxLen) && minLen >= 0 && maxLen >= minLen)) {
    throw new Error('Invalid minLen/maxLen values.');
  }
  if (radix === 0) throw new Error('allowedChars must include at least one character.');

  let totalTried = 0;

  // iterate over length from minLen to maxLen
  for (let len = minLen; len <= maxLen; len++) {
    // special case len === 0 -> empty variable part
    if (len === 0) {
      const candidate = requiredPrefix + '' + requiredSuffix;
      totalTried++;
      if (crc32ForString(candidate) === target) return candidate;
      if (onProgress) onProgress(totalTried, candidate);
      continue;
    }

    // initialize index array for odometer: [0,0,...,0] length = len
    const idx = new Array(len).fill(0);
    const lastIndex = len - 1;

    // total combinations for this length (may be large)
    const combos = Math.pow(radix, len);

    for (let comboI = 0; comboI < combos; comboI++) {
      // build variable string using idx
      let varStr = '';
      // unrolled-ish loop for speed (still simple)
      for (let p = 0; p < len; p++) varStr += chars[idx[p]];

      const candidate = requiredPrefix + varStr + requiredSuffix;
      totalTried++;

      if (crc32ForString(candidate) === target) {
        return candidate;
      }

      if (onProgress && (totalTried % chunkSize === 0)) {
        try { onProgress(totalTried, candidate); } catch (e) { /* ignore callback errors */ }
      }

      // increment odometer
      for (let pos = lastIndex; pos >= 0; pos--) {
        idx[pos]++;
        if (idx[pos] < radix) break;
        // carry
        idx[pos] = 0;
      }

      // yield to event loop periodically to keep UI responsive
      if (totalTried % chunkSize === 0) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(res => setTimeout(res, 0));
      }
    } // end combos loop
  } // end lengths loop

  return null; // not found
}

// ---------- Example Wrapper for BaseIDs----------
/**
 * findParaByCrc32(targetCrc, isYW1 = false)
 *
 * - requiredPrefix: "para_y"
 * - allowedChars: digits only ("0123456789")
 * - variable length: 6 if isYW1 === false, else 3
 * - returns the full matched string (e.g. "para_y012345") or null
 */
async function findParaByCrc32(targetCrc, isYW1 = false, opts = {}) {
  const varLen = isYW1 ? 3 : 6;
  const mergedOpts = Object.assign({
    requiredPrefix: 'para_y',
    requiredSuffix: '',
    minLen: varLen,
    maxLen: varLen,
    allowedChars: '0123456789',
    chunkSize: 5000,
    onProgress: null,
  }, opts);

  return bruteForceCrc32(targetCrc, mergedOpts);
}

// ---------- Example usage ----------
/*
(async () => {
  // compute CRC32 of a known candidate for testing:
  const test = 'para_y000123';
  console.log('crc of', test, crc32ForString(test).toString(16));

  // find using wrapper
  const target = crc32ForString(test); // a number
  console.time('search');
  const found = await findParaByCrc32(target, false, {
    chunkSize: 20000,
    onProgress: (count, current) => {
      if (count % 100000 === 0) console.log('tried', count, 'last:', current);
    },
  });
  console.timeEnd('search');
  console.log('found:', found);
})();
*/

