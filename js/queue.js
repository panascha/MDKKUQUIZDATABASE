// ─────────────────────────────────────────────────────
// JS/QUEUE.JS  — Concurrent image upload queue
// ─────────────────────────────────────────────────────

// Upload a single base64 image to GAS uploadImage action
// Returns {result, fileId, url} on success
async function uploadOnce(base64) {
    const response = await fetch(APPSCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
            action: 'uploadImage',
            username: currentUser.username,
            adminPass: adminPass,
            data: { base64 }
        }),
        redirect: 'follow'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

// Upload all images assigned via imgAssignments (concurrency=2, retry×3, backoff)
// imgEntries: array of {rowIndex, entry} where entry = {base64, fileId, status, page}
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

    const CONCURRENCY = 2;
    const MAX_RETRY = 3;
    const pending = [...toUpload];
    const active = [];

    async function runOne(item) {
        const { rowIndex, entry } = item;
        for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
            try {
                entry.status = 'Uploading';
                renderImageTray();
                const res = await uploadOnce(entry.base64);
                if (res.result === 'success' || res.fileId) {
                    entry.fileId = res.fileId;
                    entry.url = res.url || '';
                    entry.status = 'Ready';
                    saveCheckpoint();
                    renderImageTray();
                    return;
                }
            } catch (e) {
                console.warn(`upload attempt ${attempt + 1} failed for row ${rowIndex}:`, e);
            }
            if (attempt < MAX_RETRY - 1) {
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
            }
        }
        entry.status = 'Failed';
        renderImageTray();
    }

    while (pending.length || active.length) {
        while (active.length < CONCURRENCY && pending.length) {
            const task = runOne(pending.shift());
            active.push(task);
            task.finally(() => {
                const idx = active.indexOf(task);
                if (idx !== -1) active.splice(idx, 1);
            });
        }
        if (active.length > 0) await Promise.race(active);
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
