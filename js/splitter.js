// ─────────────────────────────────────────────────────
// JS/SPLITTER.JS  — PDF batch-split logic + question-count detection
// ─────────────────────────────────────────────────────
//
// 2026-08-09 — เลิกส่งทั้งไฟล์ครั้งเดียวแบบไม่มีเงื่อนไข
// เคสจริง: MD52_SKIN_MCQ2.pdf (20 หน้า / 90 ข้อ) ส่งครั้งเดียว → Gemini คืนมาแค่ 10 ข้อ
// โดย finishReason = STOP และ JSON ปิดครบ (ไม่ใช่ MAX_TOKENS) = โมเดล "ขี้เกียจ" ออกข้อไม่ครบเอง
// (output 10 ข้อ ≈ 7-8k tokens ห่างจากเพดาน maxOutputTokens 65536 มาก จึงไม่ใช่การถูกตัด)
// วิธีแก้: ซอยเป็นชุดให้แต่ละคำขอออกข้อ ~15 ข้อ + นับจำนวนข้อจริงไว้เทียบผลลัพธ์
// ─────────────────────────────────────────────────────

// เป้าหมายจำนวนข้อต่อ 1 คำขอ — ยิ่งขอเยอะต่อครั้ง โมเดลยิ่งออกข้อไม่ครบ
const CONV_MAX_Q_PER_BATCH = 15;
const CONV_MIN_PAGES_PER_BATCH = 2;
const CONV_MAX_PAGES_PER_BATCH = 6;
// ใช้เมื่อนับจำนวนข้อไม่ได้ (PDF สแกน ไม่มี text layer) — ตรงกับขนาดชุดของเส้นทางกู้คืน RECITATION เดิม
const CONV_FALLBACK_PAGES_PER_BATCH = 4;

// ดึงข้อความทั้งหน้าออกจาก text layer ของ PDF (pdf.js)
// ใช้ hasEOL เพื่อคงการขึ้นบรรทัดใหม่ — เลขข้อมักอยู่ต้นบรรทัด การรวมเป็นบรรทัดเดียวทำให้แยกยาก
async function extractPageText(pdfDoc, pageNum) {
    try {
        const page = await pdfDoc.getPage(pageNum);
        const tc = await page.getTextContent();
        return (tc.items || []).map(it => String(it.str || '') + (it.hasEOL ? '\n' : ' ')).join('');
    } catch (e) {
        return ''; // หน้าไหนอ่านไม่ได้ ให้ข้ามไป — การนับเป็นแค่ค่าประมาณขั้นต่ำ
    }
}

// นับจำนวนข้อจริงใน PDF จาก text layer — ใช้เป็น "จำนวนที่คาดหวัง" ไว้เทียบกับผลแปลง
//
// นับจำนวน match ตรง ๆ ไม่ได้ เพราะมีเลขอื่นปนเยอะ (ค่า lab "3.5", "6 เดือน", เลขหน้า, พ.ศ.)
// จึงเก็บผู้สมัครทุกตัวตามลำดับการอ่าน แล้วรับเฉพาะตัวที่ไล่ต่อเนื่อง 1,2,3,… เท่านั้น
//
// **เป็นค่าขั้นต่ำ (lower bound) โดยตั้งใจ** — ถ้า text layer ตกเลขข้อไป run จะหยุดก่อนแล้วนับได้น้อยกว่าจริง
// ยอมให้นับขาดดีกว่านับเกิน เพราะนับเกิน = เตือน "ข้อหาย" ทั้งที่ครบ (false alarm) ซึ่งแย่กว่า
// จงใจไม่ใส่ gap tolerance ด้วยเหตุผลเดียวกัน — เลขขยะอาจกระโดดข้าม counter ไปทำให้นับเกินได้
//
// คืน { expected, contentPages, perPage } — expected = 0 แปลว่านับไม่ได้ ให้ข้ามการตรวจไปเลย
async function detectQuestionCount(pdfDoc) {
    const candidates = [];
    for (let p = 1; p <= pdfDoc.numPages; p++) {
        const text = await extractPageText(pdfDoc, p);
        // เลขข้ออาจไม่มีเว้นวรรคตามหลัง (พบจริง: "2)โดน", "4)Which") — ห้ามบังคับ \s ท้าย pattern
        const re = /(?:^|[\s\n])(\d{1,3})\s*[.)]/g;
        let m;
        while ((m = re.exec(text)) !== null) candidates.push({ n: parseInt(m[1], 10), page: p });
    }

    let expect = 1;
    const perPage = new Map();
    for (const c of candidates) {
        if (c.n !== expect) continue;
        perPage.set(c.page, (perPage.get(c.page) || 0) + 1);
        expect++;
    }

    return { expected: expect - 1, contentPages: perPage.size, perPage };
}

// คำนวณจำนวนหน้าต่อชุดจากความหนาแน่นของข้อ (ข้อ/หน้า) ให้ได้ ~CONV_MAX_Q_PER_BATCH ข้อต่อชุด
function pagesPerBatchFor(detected) {
    if (!detected || detected.expected <= 0 || detected.contentPages <= 0) {
        return CONV_FALLBACK_PAGES_PER_BATCH;
    }
    const density = detected.expected / detected.contentPages; // ข้อต่อหน้า (เฉพาะหน้าที่มีข้อ)
    const per = Math.floor(CONV_MAX_Q_PER_BATCH / density);
    if (!isFinite(per) || per < 1) return CONV_MIN_PAGES_PER_BATCH;
    return Math.max(CONV_MIN_PAGES_PER_BATCH, Math.min(CONV_MAX_PAGES_PER_BATCH, per));
}

// Returns an array of batch descriptors [{start, end}].
// ไฟล์เล็ก/ข้อน้อย → ชุดเดียว (คงเส้นทาง native PDF ที่คุณภาพ OCR ดีที่สุดไว้เหมือนเดิม)
// ไฟล์ที่ข้อเกิน CONV_MAX_Q_PER_BATCH → ซอยตามความหนาแน่นของข้อ
async function checkAndSplitPDF(pdfDoc, detected) {
    const total = pdfDoc.numPages;

    // นับข้อได้ และน้อยกว่าเพดานต่อชุด → ส่งทีเดียวได้ ไม่ต้องซอย
    if (detected && detected.expected > 0 && detected.expected <= CONV_MAX_Q_PER_BATCH) {
        return [{ start: 1, end: total }];
    }

    const per = pagesPerBatchFor(detected);
    if (total <= per) return [{ start: 1, end: total }];

    const batches = [];
    for (let s = 1; s <= total; s += per) {
        batches.push({ start: s, end: Math.min(s + per - 1, total) });
    }
    return batches;
}

// Convert a batch of PDF pages to base64 data URLs using PDF.js
// Returns array of { pageNum, dataUrl } objects
//
// ความละเอียดปรับตามขนาดชุด: เดิมตั้ง 900px/JPEG0.65 ไว้เพราะชุดละ 15 หน้า ต้องกดต้นทุน token
// ตอนนี้ชุดละ 2-6 หน้า จึงเพิ่มความละเอียดได้ — สำคัญมากกับข้อสอบไทยตัวหนังสือเล็ก
// (900px บนกระดาษ A4 ≈ 107 DPI อ่านตัวเล็กพลาดได้; 1400px ≈ 170 DPI ชัดกว่าชัดเจน)
// ต้นทุน input token ต่อหน้าที่ 1400px ≈ 1.5k เทียบกับเพดาน input ที่เหลือเฟือ — คุ้มกว่าเสี่ยงอ่านผิด
async function renderPagesAsBase64(pdfDoc, batch) {
    const pageCount = batch.end - batch.start + 1;
    const MAX_SIDE = pageCount <= CONV_MAX_PAGES_PER_BATCH ? 1400 : 900;
    const quality = pageCount <= CONV_MAX_PAGES_PER_BATCH ? 0.8 : 0.65;
    const pages = [];
    for (let p = batch.start; p <= batch.end; p++) {
        const page = await pdfDoc.getPage(p);
        // Scale so that the longest side ≤ MAX_SIDE
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2.0, MAX_SIDE / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        pages.push({ pageNum: p, dataUrl: canvas.toDataURL('image/jpeg', quality) });
    }
    return pages;
}
