// ─────────────────────────────────────────────────────
// JS/EXTRACTOR.JS  — PDF image extraction via PDF.js
// ─────────────────────────────────────────────────────

// Returns a 128-char hex string from an 8×8 thumbnail of the canvas
function fingerprintCanvas(canvas) {
    const tmp = document.createElement('canvas');
    tmp.width = 8; tmp.height = 8;
    tmp.getContext('2d').drawImage(canvas, 0, 0, 8, 8);
    return Array.from(tmp.getContext('2d').getImageData(0, 0, 8, 8).data)
        .map(v => v.toString(16).padStart(2, '0')).join('');
}

// Extract embedded image objects from one PDF page using getOperatorList
// Returns array of {base64, width, height, page, source:'object'} or empty array
async function extractObjectsFromPage(pdfPage, pageNum) {
    const objs = [];
    const opList = await pdfPage.getOperatorList();
    const seen = new Set();

    for (let i = 0; i < opList.fnArray.length; i++) {
        // OPS.paintImageXObject = 85, paintJpegXObject = 82
        if (opList.fnArray[i] !== pdfjsLib.OPS.paintImageXObject &&
            opList.fnArray[i] !== pdfjsLib.OPS.paintJpegXObject) continue;

        const imgName = opList.argsArray[i][0];

        // Use callback API so pdf.js waits until the image object is settled.
        // _objs direct access returns the {capability, data} wrapper, not the image — don't use it.
        let imgData = await new Promise((resolve) => {
            let resolved = false;
            const settle = (d) => { if (!resolved) { resolved = true; resolve(d || null); } };
            setTimeout(() => settle(null), 500);
            try { pdfPage.objs.get(imgName, settle); } catch {}
            try { pdfPage.commonObjs.get(imgName, settle); } catch {}
        });
        if (!imgData) continue;

        const { width, height } = imgData;
        if (!width || !height || width < 50 || height < 50) continue;

        try {
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');

            if (imgData.bitmap) {
                // pdf.js 3.x: ImageBitmap — do NOT close; the bitmap is shared internal state;
                // closing it detaches it for any subsequent page.render() call on the same page.
                ctx.drawImage(imgData.bitmap, 0, 0);
            } else if (imgData.data && imgData.data.length === width * height * 4) {
                // Decoded RGBA pixels (pdf.js 2.x or FlateDecode images)
                ctx.putImageData(new ImageData(new Uint8ClampedArray(imgData.data), width, height), 0, 0);
            } else if (imgData.data) {
                // Raw encoded bytes (JPEG/PNG) — decode via browser Image element
                const mime = (imgData.data[0] === 0xFF && imgData.data[1] === 0xD8) ? 'image/jpeg' : 'image/png';
                const url = URL.createObjectURL(new Blob([imgData.data], { type: mime }));
                await new Promise((res, rej) => {
                    const img = new Image();
                    img.onload = () => { ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url); res(); };
                    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode failed')); };
                    img.src = url;
                });
            } else {
                continue;
            }

            const fp = fingerprintCanvas(canvas);
            if (seen.has(fp)) continue;
            seen.add(fp);

            objs.push({ base64: canvas.toDataURL('image/jpeg', 0.85), width, height, page: pageNum, source: 'object', _fp: fp });
        } catch (e) {
            console.warn(`extractor: skip image ${imgName} on page ${pageNum}:`, e.message);
        }
    }
    return objs;
}

// Fallback: render the full page at 1.5× scale as a single image
async function renderPageAsFallback(pdfPage, pageNum) {
    const viewport = pdfPage.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return { base64: canvas.toDataURL('image/jpeg', 0.8), width: canvas.width, height: canvas.height, page: pageNum, source: 'render' };
}

// Extract all images from a PDF document (a pdfjsLib document object)
// Updates extractedImages global and calls renderImageTray() when done
async function extractImagesFromPDF(pdfDoc) {
    extractedImages = [];
    const seenFingerprints = new Set();
    const statusEl = document.getElementById('pdf-status');
    const total = pdfDoc.numPages;

    const progressEl = document.getElementById('pdf-progress');
    if (progressEl) { progressEl.classList.remove('d-none'); progressEl.max = total; progressEl.value = 0; }

    try {
        for (let p = 1; p <= total; p++) {
            statusEl.textContent = `กำลังดึงภาพจากหน้า ${p}/${total}…`;
            if (progressEl) progressEl.value = p;
            const pdfPage = await pdfDoc.getPage(p);
            let pageObjs = [];
            try {
                pageObjs = await extractObjectsFromPage(pdfPage, p);
            } catch (e) {
                console.warn(`extractor: page ${p} object extraction failed:`, e);
            }

            // Dedup across pages using stored _fp (computed synchronously in extractObjectsFromPage)
            const uniqueObjs = pageObjs.filter(img => {
                const fp = img._fp;
                if (!fp || seenFingerprints.has(fp)) return false;
                seenFingerprints.add(fp);
                return true;
            });

            if (uniqueObjs.length > 0) {
                extractedImages.push(...uniqueObjs);
            }
            // Pages with no embedded XObjects are skipped — admin uses "อัปโหลดรูป" for scanned PDFs.
        }
    } finally {
        if (progressEl) progressEl.classList.add('d-none');
    }
    statusEl.textContent = `✅ ดึงภาพสำเร็จ ${extractedImages.length} รูป`;
    renderPreviewCards();
}
