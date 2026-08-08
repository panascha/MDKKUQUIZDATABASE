// ─────────────────────────────────────────────────────
// JS/SPLITTER.JS  — PDF batch-split logic
// ─────────────────────────────────────────────────────

// Returns an array of batch descriptors [{start, end}].
// ส่งทั้งไฟล์ครั้งเดียวเสมอ (All-in-one) — ไม่ถามผู้ใช้ให้เลือกแบ่งชุดแล้ว
// การแบ่งเป็นชุดยังเหลืออยู่ในเส้นทางกู้คืน RECITATION ของ runGeminiConversion (เรียก renderPagesAsBase64 เอง)
async function checkAndSplitPDF(pdfDoc) {
    return [{ start: 1, end: pdfDoc.numPages }];
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
