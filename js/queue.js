// ─────────────────────────────────────────────────────
// JS/QUEUE.JS  — Batched image upload queue
// ─────────────────────────────────────────────────────

// Upload a chunk of images (≤10) to GAS uploadImagesBatch action
// items: array of {entry, rowIndex, imgIndex}
// Returns parsed JSON response
async function uploadBatch(items) {
    const response = await fetch(APPSCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
            action: 'uploadImagesBatch',
            username: currentUser.username,
            adminPass: adminPass,
            sessionToken: (typeof sessionToken === 'string' && sessionToken) || undefined,
            images: items.map(item => ({ base64: item.entry.base64 }))
        }),
        redirect: 'follow'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

// Upload all images assigned via imgAssignments (batch ≤10 per request, retry×3, backoff)
// imgAssignments: Map<rowIndex, [{base64, fileId, url, status, page}]>
async function startUploadQueue() {
    const toUpload = [];
    imgAssignments.forEach((entries, rowIndex) => {
        entries.forEach((entry, imgIndex) => {
            if (entry.status !== 'Ready') {
                toUpload.push({ rowIndex, imgIndex, entry });
            }
        });
    });

    if (toUpload.length === 0) return;

    const BATCH_SIZE = 10;
    const MAX_RETRY = 3;

    // Process chunks sequentially (one batch request in flight at a time)
    for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
        const chunk = toUpload.slice(i, i + BATCH_SIZE);

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
    }

    updateSaveButtonState();
}

// Lock/unlock the "อัปโหลดและบันทึก" button based on upload status
function updateSaveButtonState() {
    const btn = document.getElementById('btn-upload-and-save');
    if (!btn) return;

    // Show the dedicated upload-and-save button only when there are image assignments
    btn.style.display = [...imgAssignments.values()].some(arr => arr.length > 0) ? '' : 'none';

    let hasFailed = false;
    let hasUploading = false;
    imgAssignments.forEach(entries => {
        entries.forEach(entry => {
            if (entry.status === 'Failed') hasFailed = true;
            if (entry.status === 'Uploading' || entry.status === 'Waiting') hasUploading = true;
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
        btn.textContent = '💾 อัปโหลดและบันทึก';
    }
}
