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
// 2026-09-24: 15 → 10 — ชุด 15 ข้อ (6 หน้า) ชน GAS 360s timeout จริง (HTTP 404 กลางคันที่ชุด 2/4)
// Gemini ออก 15 ข้อ + explain ยาว ใช้เวลาหลายนาที ถ้า retry ซ้ำอีกรอบก็เกิน 6 นาที
const CONV_MAX_Q_PER_BATCH = 10;
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
// ไฟล์หลายตอน (Spot 1-29 แล้ว MCQ 1-74, หรือข้อสอบหลายชุดในไฟล์เดียว) เลขข้อเริ่ม 1 ใหม่ — เดิมนับแค่ run แรก
// ตอนหลังถูกนับเป็น 0 ข้อ/หน้า → ถูกยัดรวมชุดเดียวกับหน้าอื่นพร้อม prompt "เริ่มข้อ 26 อย่างน้อย 4 ข้อ" โมเดลจึงคืนแค่นั้น
// (เคสจริง 2026-10-20: MD50_C_ENT_MCQ ข้อ MCQ 1-23 หายทั้งช่วง)
// จึงแยกเป็นหลาย run: เลข 1 เปิด run ใหม่ เลขที่ต่อได้ให้ run ล่าสุดที่รอเลขนั้นอยู่
// นับเฉพาะ run ที่ยาว ≥ CONV_MIN_SECTION_Q — กันรายการ 1-5 ในตัวเลือก/ข้อย่อยถูกนับเป็นตอนใหม่
// ไม่มี run ไหนถึงเกณฑ์ → ใช้ run ที่ยาวสุด (พฤติกรรมเดิมของไฟล์ตอนเดียว)
// ต่อ run ได้เฉพาะเลขที่อยู่ห่างจากข้อล่าสุดของ run ≤ CONV_SECTION_MAX_PAGE_GAP หน้า — กันเลขขยะ ("2." ในบรรทัด Ans)
// ร้อยข้ามไฟล์ 9-34 หน้าจนกลายเป็นตอนปลอม (เคส MD49 ENT Spot/OSCE); ข้อจริงห่างกันได้ถึง 4 หน้า (หน้ารูปคั่น, Research MD50)
const CONV_MIN_SECTION_Q = 10;
const CONV_SECTION_MAX_PAGE_GAP = 5;

// คืน { expected, contentPages, perPage, items, sections } — expected = 0 แปลว่านับไม่ได้ ให้ข้ามการตรวจไปเลย
// items: [{ n, page, section }] เลขข้อที่นับ ตามลำดับการอ่าน (ใช้หาเลขข้อแรกของแต่ละชุด)
async function detectQuestionCount(pdfDoc) {
    const candidates = [];
    for (let p = 1; p <= pdfDoc.numPages; p++) {
        const text = await extractPageText(pdfDoc, p);
        // เลขข้ออาจไม่มีเว้นวรรคตามหลัง (พบจริง: "2)โดน", "4)Which") — ห้ามบังคับ \s ท้าย pattern
        const re = /(?:^|[\s\n])(\d{1,3})\s*[.)]/g;
        let m;
        while ((m = re.exec(text)) !== null) candidates.push({ n: parseInt(m[1], 10), page: p });
    }

    const runs = [];
    for (const c of candidates) {
        let run = null;
        for (let r = runs.length - 1; r >= 0; r--) {
            const rr = runs[r];
            if (rr.expect === c.n && c.page - rr.items[rr.items.length - 1].page <= CONV_SECTION_MAX_PAGE_GAP) { run = rr; break; }
        }
        if (!run && c.n === 1) { run = { expect: 1, items: [] }; runs.push(run); }
        if (!run) continue;
        run.items.push(c);
        run.expect++;
    }
    let counted = runs.filter(r => r.items.length >= CONV_MIN_SECTION_Q);
    if (counted.length === 0 && runs.length > 0) counted = [runs.reduce((a, b) => (b.items.length > a.items.length ? b : a))];

    // เรียงตามลำดับการอ่าน — run ต่างตอนอาจสลับหน้ากันได้ (ไฟล์ Spot/OSCE ปนกัน)
    const order = new Map(candidates.map((c, i) => [c, i]));
    const items = [];
    counted.forEach((r, s) => r.items.forEach(c => items.push({ n: c.n, page: c.page, section: s, at: order.get(c) })));
    items.sort((a, b) => a.at - b.at);
    const perPage = new Map();
    items.forEach(it => perPage.set(it.page, (perPage.get(it.page) || 0) + 1));

    return { expected: items.length, contentPages: perPage.size, perPage, items, sections: counted.length };
}

// Returns an array of batch descriptors [{start, end}].
// ไฟล์เล็ก/ข้อน้อย → ชุดเดียว (คงเส้นทาง native PDF ที่คุณภาพ OCR ดีที่สุดไว้เหมือนเดิม)
// ไฟล์ที่ข้อเกิน CONV_MAX_Q_PER_BATCH → อัดหน้าทีละหน้าจาก perPage จริง (ไม่ใช้ความหนาแน่นเฉลี่ย)
// เพดานจริง: ชุดใดข้อเกิน 10 ได้เฉพาะเมื่อ "หน้าเดียว" มีเกิน 10 ข้อ (ตัดกลางหน้าไม่ได้)
// เดิมใช้ค่าเฉลี่ย + ขั้นต่ำ 2 หน้า → หน้าแน่น 8 ข้อ × 2 หน้า = 16 ข้อ/ชุด หลุดเพดาน
async function checkAndSplitPDF(pdfDoc, detected) {
    const total = pdfDoc.numPages;
    const counted = detected && detected.expected > 0 && detected.perPage;

    const batches = [];
    if (!counted) {
        // นับไม่ได้ (PDF สแกน) — ชุดละ CONV_FALLBACK_PAGES_PER_BATCH หน้าเท่าเดิม
        if (total <= CONV_FALLBACK_PAGES_PER_BATCH) return [{ start: 1, end: total }];
        for (let s = 1; s <= total; s += CONV_FALLBACK_PAGES_PER_BATCH) {
            batches.push({ start: s, end: Math.min(s + CONV_FALLBACK_PAGES_PER_BATCH - 1, total) });
        }
        return batches;
    }

    // การนับหยุดที่เลขข้อแรกที่อ่านไม่ได้ (เช่นเลขข้อเป็นรูป) → หน้าหลังจากนั้นดูเหมือน 0 ข้อทั้งที่เต็มไปด้วยข้อสอบ
    // หน้าหลังหน้าสุดท้ายที่นับได้ → ประมาณด้วยความหนาแน่นเฉลี่ย (หน้าท้ายที่เป็นเฉลยจริงแค่ทำให้ชุดเล็กลง ไม่เสียหาย)
    const lastCounted = Math.max(...detected.perPage.keys());
    const avgPerPage = Math.ceil(detected.expected / detected.perPage.size);
    const weight = p => detected.perPage.get(p) || (p > lastCounted ? avgPerPage : 0);

    // ประมาณทั้งไฟล์ได้ไม่เกินเพดานต่อชุด → ส่งทีเดียว (native PDF คุณภาพ OCR ดีสุด)
    let estTotal = 0;
    for (let p = 1; p <= total; p++) estTotal += weight(p);
    if (estTotal <= CONV_MAX_Q_PER_BATCH) return [{ start: 1, end: total }];

    let start = 1, qCount = 0;
    for (let p = 1; p <= total; p++) {
        const n = weight(p);
        const pagesInBatch = p - start;
        if (pagesInBatch > 0 && (qCount + n > CONV_MAX_Q_PER_BATCH || pagesInBatch >= CONV_MAX_PAGES_PER_BATCH)) {
            batches.push({ start, end: p - 1 });
            start = p;
            qCount = 0;
        }
        qCount += n;
    }
    batches.push({ start, end: total });
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
