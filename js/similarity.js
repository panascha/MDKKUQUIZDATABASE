// Shared text-similarity helpers (loaded before tables.js / converter.js; plain declarations, not window.*).
// Trigram/Dice similarity — cheap, no CDN dependency, good enough for an 85% threshold (doesn't
// need real edit-distance precision) and works on Thai text with no inter-word spaces.
function normalizeForSimilarity(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function textTrigrams(text) {
    const t = normalizeForSimilarity(text);
    const grams = new Set();
    if (t.length < 3) { if (t) grams.add(t); return grams; }
    for (let i = 0; i <= t.length - 3; i++) grams.add(t.substring(i, i + 3));
    return grams;
}

function gramSimilarity(a, b) {
    if (a.norm === b.norm) return a.norm ? 1 : 0;
    if (!a.grams.size || !b.grams.size) return 0;
    let intersect = 0;
    a.grams.forEach(g => { if (b.grams.has(g)) intersect++; });
    return (2 * intersect) / (a.grams.size + b.grams.size);
}

// category-name key: trim, collapse whitespace, lowercase
function normalizeCatKey(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// All pairs with gramSimilarity >= threshold. items: [{ id, text }]. Returns { pairs:[{a,b,sim}] (a,b = indexes
// into items, sim desc), truncated }. Self-contained apart from the three functions above (it is also run
// inside a Web Worker built from their source — keep it free of other globals).
// Exact (no false negatives): length pre-filter (Dice >= t needs min/max >= t/(2-t)) + prefix filtering on
// the rarest trigrams (any pair reaching t shares >= ceil(t*a/(2-t)) grams, so one lies in each rare prefix).
function findSimilarPairs(items, threshold, maxPairs) {
    const ratio = threshold / (2 - threshold);
    const docs = [];
    items.forEach((it, idx) => {
        const norm = normalizeForSimilarity(it.text);
        if (!norm) return;
        docs.push({ idx: idx, norm: norm, grams: textTrigrams(it.text) });
    });
    const freq = new Map();
    docs.forEach(d => d.grams.forEach(g => freq.set(g, (freq.get(g) || 0) + 1)));
    docs.forEach(d => {
        const sorted = Array.from(d.grams).sort((x, y) => (freq.get(x) - freq.get(y)) || (x < y ? -1 : x > y ? 1 : 0));
        const minOverlap = Math.max(1, Math.ceil(ratio * sorted.length - 1e-9));
        d.prefix = sorted.slice(0, sorted.length - minOverlap + 1);
    });
    const index = new Map(); // gram -> docs positions
    const pairs = [];
    let truncated = false;
    for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        const cand = new Set();
        d.prefix.forEach(g => { const p = index.get(g); if (p) p.forEach(j => cand.add(j)); });
        cand.forEach(j => {
            const o = docs[j];
            const lo = Math.min(d.grams.size, o.grams.size), hi = Math.max(d.grams.size, o.grams.size);
            if (lo / hi < ratio - 1e-9) return;
            const sim = gramSimilarity(d, o);
            if (sim >= threshold) pairs.push({ a: o.idx, b: d.idx, sim: sim });
        });
        d.prefix.forEach(g => { const p = index.get(g); if (p) p.push(i); else index.set(g, [i]); });
    }
    pairs.sort((x, y) => y.sim - x.sim);
    if (maxPairs && pairs.length > maxPairs) { pairs.length = maxPairs; truncated = true; }
    return { pairs: pairs, truncated: truncated };
}
