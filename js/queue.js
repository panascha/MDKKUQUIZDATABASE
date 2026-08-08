// ─────────────────────────────────────────────────────
// JS/QUEUE.JS  — Batched image upload queue
// ─────────────────────────────────────────────────────

// Upload a chunk of images (≤10) to GAS uploadImagesBatch action
// items: array of {entry, rowIndex, imgIndex, questionId, subject, year}
// questionId/type ต้องส่งไปด้วย — backend ใช้ตั้งชื่อไฟล์ Q_<id>_<type>_<uniq> (ไม่งั้นได้ Q_undefined_undefined_)
// subject/year = hint ปลายทางโฟลเดอร์ — ตอนอัปโหลดข้อยังไม่อยู่ในชีต backend จึงหาเองไม่ได้
// (ถ้าไม่ส่ง = อ่าน Questions/Category/Structure ทั้งใบต่อรูป → ช้าจนหลุด timeout 25s และไฟล์ไปกอง YUnknown/General)
// Returns parsed JSON response
const UPLOAD_BATCH_TIMEOUT_MS = 25000;

async function uploadBatch(items) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPLOAD_BATCH_TIMEOUT_MS);
    try {
        const response = await fetch(APPSCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                action: 'uploadImagesBatch',
                username: currentUser.username,
                adminPass: adminPass,
                sessionToken: (typeof sessionToken === 'string' && sessionToken) || undefined,
                images: items.map(item => ({
                    base64: item.entry.base64,
                    questionId: item.questionId,
                    type: 'Main',
                    subject: item.subject,
                    year: item.year
                }))
            }),
            redirect: 'follow',
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        if (e.name === 'AbortError') throw new Error(`uploadBatch timed out after ${UPLOAD_BATCH_TIMEOUT_MS / 1000}s`);
        throw e;
    } finally {
        clearTimeout(timeoutId);
    }
}

// Upload all images assigned via imgAssignments (batch=5, concurrency=2, retry×3, backoff)
// imgAssignments: Map<rowIndex, [{base64, fileId, url, status, page}]>
// onProgress: optional fn({done, total, failed, elapsedSec, etaSec}) — เรียกตอนเริ่มและหลังจบแต่ละ batch
// ปลายทางโฟลเดอร์ของชุดที่กำลังแปลง — จาก struct row ที่ processAll สร้างไว้ ([year, subjectID, …])
// ไม่มี struct (เช่นโหลด checkpoint มา) → ถอยไปอ่านช่องกรอกบนหน้าจอ
function getConverterRouteHints() {
    const struct = (converterStorage.struct || [])[0] || [];
    const yearEl = document.getElementById('yearVal');
    const subjEl = document.getElementById('subjID');
    return {
        year: String(struct[0] || (yearEl && yearEl.value) || '').trim(),
        subject: String(struct[1] || (subjEl && subjEl.value) || '').trim().toUpperCase()
    };
}

async function startUploadQueue(onProgress) {
    const toUpload = [];
    const hints = getConverterRouteHints();
    imgAssignments.forEach((entries, rowIndex) => {
        // อ่าน QuestionID สดจากแถวตอนสร้างคิว (ไม่เก็บใน entry — entry ถูก saveCheckpoint เก็บลง localStorage
        // ค่าเก่าจะค้างเมื่อผู้ใช้แก้หมวดหมู่แล้ว QuestionID เปลี่ยน)
        const row = converterStorage.ques[rowIndex];
        const questionId = row ? String(row[0] || '') : '';
        entries.forEach((entry, imgIndex) => {
            if (entry.status !== 'Ready') {
                toUpload.push({ rowIndex, imgIndex, entry, questionId, subject: hints.subject, year: hints.year });
            }
        });
    });

    if (toUpload.length === 0) return;

    const BATCH_SIZE = 5;
    const CONCURRENCY = 2;
    const MAX_RETRY = 3;
    const HARD_TIMEOUT_MS = 60000;

    let settled = false;
    const failsafeTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        let forcedAny = false;
        toUpload.forEach(({ entry }) => {
            if (entry.status === 'Uploading' || entry.status === 'Waiting') {
                entry.status = 'Failed';
                forcedAny = true;
            }
        });
        renderImageTray();
        updateSaveButtonState();
        if (forcedAny) {
            Swal.fire({
                icon: 'error',
                title: 'อัปโหลดใช้เวลานานเกินไป',
                text: `การอัปโหลดรูปภาพเกิน ${HARD_TIMEOUT_MS / 1000} วินาที ระบบยกเลิกรายการที่ค้างและตีเป็น "ล้มเหลว" — กรุณาลองอัปโหลดใหม่อีกครั้ง`
            });
        }
    }, HARD_TIMEOUT_MS);

    // ความคืบหน้าละเอียดได้แค่ระดับ batch — uploadBatch รอทั้งชุดก่อนตอบ
    const startTime = Date.now();
    let done = 0;
    let failed = 0;
    const report = () => {
        if (!onProgress) return;
        const elapsedSec = (Date.now() - startTime) / 1000;
        const finished = done + failed;
        const avgSecPerImage = finished > 0 ? elapsedSec / finished : 0;
        const etaSec = avgSecPerImage > 0 ? Math.round(avgSecPerImage * (toUpload.length - finished)) : null;
        onProgress({ done, failed, total: toUpload.length, elapsedSec: Math.round(elapsedSec), etaSec });
    };

    async function processChunk(chunk) {
        // Mark all items in this chunk as Uploading
        chunk.forEach(({ entry }) => { entry.status = 'Uploading'; });
        renderImageTray();

        let chunkDone = false;
        for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
            try {
                const res = await uploadBatch(chunk);
                if (res.result === 'success') {
                    // Walk urls array in input order; a failed item is an object {error}
                    (res.urls || []).forEach((urlResult, idx) => {
                        const { entry, rowIndex } = chunk[idx];
                        if (typeof urlResult === 'string') {
                            entry.url = urlResult;
                            entry.status = 'Ready';
                            saveCheckpoint();
                        } else {
                            // {error: "..."} — mark failed, no per-item retry
                            console.warn(`uploadImagesBatch: item failed for row ${rowIndex}:`, urlResult && urlResult.error);
                            entry.status = 'Failed';
                        }
                    });
                    renderImageTray();
                    chunkDone = true;
                    break;
                }
                // result:'error' (auth/validation failure) → retry whole chunk
                throw new Error(res.message || 'uploadImagesBatch: result error');
            } catch (e) {
                console.warn(`upload chunk attempt ${attempt + 1} failed:`, e);
                if (attempt < MAX_RETRY - 1) {
                    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
                }
            }
        }

        if (!chunkDone) {
            // All retries exhausted — mark remaining Uploading items in chunk as Failed
            chunk.forEach(({ entry }) => {
                if (entry.status === 'Uploading') entry.status = 'Failed';
            });
            renderImageTray();
        }

        chunk.forEach(({ entry }) => {
            if (entry.status === 'Ready') done++;
            else failed++;
        });
        report();
    }

    const chunks = [];
    for (let i = 0; i < toUpload.length; i += BATCH_SIZE) chunks.push(toUpload.slice(i, i + BATCH_SIZE));

    try {
        // ย่อรูปฝั่ง client ก่อนอัปโหลด (ลด payload/เวลาอัปโหลด) — ข้ามรายการที่ย่อไปแล้วตอน retry
        await Promise.all(toUpload.map(async ({ entry }) => {
            if (entry._compressed) return;
            entry.base64 = await compressImage(entry.base64, 1200, 1200, 0.75);
            entry._compressed = true;
        }));

        report();
        // Up to CONCURRENCY chunk requests in flight at once
        for (let i = 0; i < chunks.length; i += CONCURRENCY) {
            await Promise.all(chunks.slice(i, i + CONCURRENCY).map(processChunk));
        }
    } finally {
        // ป้องกันปุ่ม/สถานะค้าง "กำลังอัปโหลด" ถ้ามี error หลุดออกมากลางทาง (เช่น network/timeout) —
        // รายการที่ยังค้างสถานะ Uploading ถือว่าไม่จบ ให้ตีเป็น Failed แทน
        clearTimeout(failsafeTimer);
        settled = true;
        toUpload.forEach(({ entry }) => {
            if (entry.status === 'Uploading') entry.status = 'Failed';
        });
        renderImageTray();
        updateSaveButtonState();
    }
}

// Lock/unlock the "อัปโหลดและบันทึก" button based on upload status
function updateSaveButtonState() {
    const btn = document.getElementById('btn-upload-and-save');
    if (!btn) return;

    // ปุ่มเดียวเสมอ — มีรูปรออัปโหลดหรือไม่ แค่เปลี่ยนป้าย/สถานะ ไม่ซ่อนปุ่ม
    const hasImages = [...imgAssignments.values()].some(arr => arr.length > 0);

    let hasFailed = false;
    let hasUploading = false;
    imgAssignments.forEach(entries => {
        entries.forEach(entry => {
            if (entry.status === 'Failed') hasFailed = true;
            if (entry.status === 'Uploading') hasUploading = true;
        });
    });

    if (hasUploading) {
        btn.disabled = true;
        btn.textContent = 'กำลังอัปโหลด…';
    } else if (hasFailed) {
        btn.disabled = false;
        btn.classList.add('btn-warning');
        btn.classList.remove('btn-success');
        btn.textContent = '⚠️ บางรูปล้มเหลว — ลองอีกครั้ง';
    } else {
        btn.disabled = false;
        btn.classList.add('btn-success');
        btn.classList.remove('btn-warning');
        btn.textContent = hasImages ? '💾 อัปโหลดและบันทึก' : '💾 บันทึก';
    }
}
