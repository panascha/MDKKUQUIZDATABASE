// ─────────────────────────────────────────────────────
// JS/IMAGE-MATCHER.JS — T2.5 strict image auto-matcher (pure, no DOM)
// auto-assign เฉพาะหน้าที่มีรูป raster 1 รูป + แถว require_img 1 แถว; ที่เหลือ → manifest (ไม่ assign)
// ─────────────────────────────────────────────────────

const IMG_MATCH_MIN_SHORT_SIDE = 200;

// rows: [{rowIndex, pageHint, problem, figureNum}] (เฉพาะ require_img ที่ยังไม่ assign)
// images: extractedImages (page, source, width, height, _fp, decorative, assignedTo, figureOrdinal)
// ผลลัพธ์: { auto: [{rowIndex, imgIndex}], manifest: [case] } — case schema ตาม Phase 5 (decisions doc)
function planImageMatches(rows, images, sourcePdf) {
    const auto = [];
    const manifest = [];
    const pool = [];                                  // รูปที่ลงกรอบ candidate ได้ (ไม่ประดับ ไม่ถูก assign)
    images.forEach((img, imgIndex) => {
        if (!img.decorative && img.assignedTo == null) pool.push({ img, imgIndex });
    });
    const byPage = new Map();                         // page → [{img, imgIndex, imgId}]
    pool.forEach(c => {
        const arr = byPage.get(c.img.page) || [];
        c.imgId = `p${c.img.page}_i${arr.length}`;
        arr.push(c);
        byPage.set(c.img.page, arr);
    });
    const rowsPerPage = new Map();
    rows.forEach(r => rowsPerPage.set(r.pageHint, (rowsPerPage.get(r.pageHint) || 0) + 1));
    const fpCount = new Map();
    pool.forEach(c => c.img._fp && fpCount.set(c.img._fp, (fpCount.get(c.img._fp) || 0) + 1));

    const toCand = c => ({ imgId: c.imgId, imgIndex: c.imgIndex, w: c.img.width, h: c.img.height,
        fingerprint: c.img._fp || null, source: c.img.source });
    const addCase = (r, reason, cands) => {
        const fig = r.figureNum != null ? cands.find(c => c.img.figureOrdinal === r.figureNum) : null;
        manifest.push({
            caseId: `${sourcePdf || 'pdf'}#row${r.rowIndex}`, questionId: null, rowIndex: r.rowIndex,
            sourcePdf: sourcePdf || null, page: r.pageHint, reason,
            stem: String(r.problem || '').slice(0, 200), candidates: cands.map(toCand),
            suggested: fig ? fig.imgId : null, status: 'pending', decision: null, note: ''
        });
    };

    rows.forEach(r => {
        const cands = r.pageHint != null ? (byPage.get(r.pageHint) || []) : [];
        if (cands.length === 0) return addCase(r, 'NO_IMG_FOUND', []);
        if (cands.length > 1 || rowsPerPage.get(r.pageHint) > 1) return addCase(r, 'MULTI_IMG_PAGE', cands);
        const c = cands[0];
        if (c.img.source === 'render') return addCase(r, 'VECTOR_FALLBACK', cands);
        if (c.img._fp && fpCount.get(c.img._fp) > 1) return addCase(r, 'DUP_FINGERPRINT', cands);
        if (Math.min(c.img.width, c.img.height) < IMG_MATCH_MIN_SHORT_SIDE) return addCase(r, 'LOW_RES', cands);
        auto.push({ rowIndex: r.rowIndex, imgIndex: c.imgIndex });
    });

    // รูปบนหน้าที่ไม่มีแถว require_img เลย
    byPage.forEach((cs, page) => {
        if (rowsPerPage.has(page)) return;
        cs.forEach(c => manifest.push({
            caseId: `${sourcePdf || 'pdf'}#${c.imgId}`, questionId: null, rowIndex: null,
            sourcePdf: sourcePdf || null, page, reason: 'ORPHAN_IMG', stem: '', candidates: [toCand(c)],
            suggested: null, status: 'pending', decision: null, note: ''
        }));
    });
    return { auto, manifest };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { planImageMatches };
