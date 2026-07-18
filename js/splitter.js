// ─────────────────────────────────────────────────────
// JS/SPLITTER.JS  — PDF batch-split logic
// ─────────────────────────────────────────────────────

// Returns an array of batch descriptors [{start, end}].
// If numPages <= batchLimit: single-element array (no modal).
// If numPages > batchLimit: show SplitSuggestionModal and let user choose
//   "ส่งทีละชุด" (batched) or "ส่งทั้งหมด" (single call).
// Resolves with the chosen batch array.
async function checkAndSplitPDF(pdfDoc) {
    const batchLimitEl = document.getElementById('batch-limit'); // ยังไม่มีใน UI — ใช้ default 15
    const batchLimit = parseInt(batchLimitEl && batchLimitEl.value) || 15;
    const total = pdfDoc.numPages;

    if (total <= batchLimit) {
        return [{ start: 1, end: total }];
    }

    return new Promise((resolve) => {
        const batches = [];
        for (let s = 1; s <= total; s += batchLimit) {
            batches.push({ start: s, end: Math.min(s + batchLimit - 1, total) });
        }

        Swal.fire({
            title: 'PDF ขนาดใหญ่',
            html: `PDF ของคุณมี <strong>${total} หน้า</strong><br>
                   แนะนำแบ่งส่ง Gemini ทีละ <strong>${batchLimit} หน้า</strong> (${batches.length} ชุด)<br>
                   <small class="text-muted">การส่งทั้งหมดในครั้งเดียวอาจเกิน token limit</small>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: `✅ ส่งทีละชุด (${batches.length} ชุด)`,
            cancelButtonText: '⚡ ส่งทั้งหมดครั้งเดียว',
            reverseButtons: false
        }).then(result => {
            if (result.isConfirmed) {
                resolve(batches);
            } else {
                resolve([{ start: 1, end: total }]);
            }
        });
    });
}

// Convert a batch of PDF pages to base64 data URLs using PDF.js
// Renders at reduced scale + quality to minimise Gemini token cost on free tier
// Returns array of { pageNum, dataUrl } objects
async function renderPagesAsBase64(pdfDoc, batch) {
    const MAX_SIDE = 900; // cap longest dimension — keeps tokens low while text stays readable
    const pages = [];
    for (let p = batch.start; p <= batch.end; p++) {
        const page = await pdfDoc.getPage(p);
        // Scale so that the longest side ≤ MAX_SIDE
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1.0, MAX_SIDE / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        pages.push({ pageNum: p, dataUrl: canvas.toDataURL('image/jpeg', 0.65) });
    }
    return pages;
}
