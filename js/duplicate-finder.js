// Admin duplicate finder (Database tab): near-duplicate pairs inside the selected subject.
// Compute runs in a Web Worker built from similarity.js function source (no build step -> Blob worker).
const DUP_FINDER_THRESHOLD = 0.85; // same as converter DUP_SIMILARITY_THRESHOLD
const DUP_FINDER_MAX_PAIRS = 300;
let dupFinderState = { items: [], pairs: [], running: false };

function dupFinderRunInWorker(items) {
    return new Promise((resolve, reject) => {
        let worker;
        try {
            const src = [normalizeForSimilarity, textTrigrams, gramSimilarity, findSimilarPairs].map(f => f.toString()).join('\n') +
                '\nself.onmessage = function (e) { self.postMessage(findSimilarPairs(e.data.items, e.data.threshold, e.data.maxPairs)); };';
            const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
            worker = new Worker(url);
            URL.revokeObjectURL(url);
        } catch (err) { reject(err); return; }
        worker.onmessage = e => { worker.terminate(); resolve(e.data); };
        worker.onerror = e => { worker.terminate(); reject(new Error(e.message || 'worker error')); };
        worker.postMessage({ items: items, threshold: DUP_FINDER_THRESHOLD, maxPairs: DUP_FINDER_MAX_PAIRS });
    });
}

function dupFinderStem(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return escapeHtml(t.length > 240 ? t.slice(0, 240) + '…' : t);
}

function renderDupFinderResults(subject, truncated) {
    const { items, pairs } = dupFinderState;
    $('#dup-finder-title').text(`Duplicates in ${subject}: ${pairs.length} pair(s) from ${items.length} questions` +
        (truncated ? ` (showing top ${DUP_FINDER_MAX_PAIRS})` : ''));
    if (!pairs.length) {
        $('#dup-finder-body').html('<div class="text-muted">ไม่พบข้อที่ซ้ำ/คล้ายกันเกิน 85%</div>');
        return;
    }
    const side = (p, which) => {
        const it = items[p[which]];
        return `<div class="col-md-6"><div class="border rounded p-2 h-100">
            <div class="d-flex align-items-center gap-2 mb-1">
                <code>${escapeHtml(it.id)}</code>
                <button type="button" class="btn btn-sm btn-primary ms-auto js-dup-edit" data-id="${escapeHtml(it.id)}"><i class="fas fa-edit"></i> Edit</button>
                <button type="button" class="btn btn-sm btn-outline-danger js-dup-del" data-id="${escapeHtml(it.id)}"><i class="fas fa-trash"></i> Delete</button>
            </div>
            <div class="small">${dupFinderStem(it.text)}</div>
        </div></div>`;
    };
    $('#dup-finder-body').html(pairs.map(p => `<div class="mb-3">
        <div class="mb-1"><span class="badge ${p.sim >= 0.999 ? 'bg-danger' : 'bg-warning text-dark'}">${Math.round(p.sim * 100)}%</span></div>
        <div class="row g-2">${side(p, 'a')}${side(p, 'b')}</div></div>`).join(''));
}

async function findDuplicatesInSubject() {
    if (dupFinderState.running) return;
    const subject = String($('#db-subject-filter').val() || '').trim();
    if (!subject) { Swal.fire('เลือกวิชาก่อน', 'เลือก Subject ในตัวกรองก่อนกด Find duplicates', 'info'); return; }
    const key = subject.toUpperCase();
    const items = (globalData.questions || [])
        .filter(q => String(getSubjectFromCategory(q.category)).trim().toUpperCase() === key)
        .map(q => ({ id: String(q.questionId), text: q.problem }));
    dupFinderState.running = true;
    const btn = $('#db-find-dups-btn').prop('disabled', true);
    $('#dup-finder-panel').removeClass('d-none');
    $('#dup-finder-title').text('Duplicates');
    $('#dup-finder-body').html(`<div class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i> กำลังเทียบ ${items.length} ข้อ...</div>`);
    try {
        let res;
        try { res = await dupFinderRunInWorker(items); }
        catch (err) { console.warn('duplicate-finder: worker unavailable, running inline', err); res = findSimilarPairs(items, DUP_FINDER_THRESHOLD, DUP_FINDER_MAX_PAIRS); }
        dupFinderState.items = items;
        dupFinderState.pairs = res.pairs;
        renderDupFinderResults(subject, res.truncated);
    } catch (err) {
        $('#dup-finder-body').html(`<div class="text-danger">เกิดข้อผิดพลาด: ${escapeHtml(err.message || err)}</div>`);
    } finally {
        dupFinderState.running = false;
        btn.prop('disabled', false);
    }
}

async function deleteDuplicateQuestion(id) {
    if (!confirmAdmin()) return;
    const it = dupFinderState.items.find(x => x.id === id);
    const r = await Swal.fire({
        icon: 'warning', title: `ลบข้อ ${id}?`, text: String(it && it.text || '').slice(0, 160),
        showCancelButton: true, confirmButtonText: 'ลบ', confirmButtonColor: '#dc3545', cancelButtonText: 'ยกเลิก'
    });
    if (!r.isConfirmed) return;
    const q = (globalData.questions || []).find(x => String(x.questionId) === id);
    if (!q) return;
    dupFinderState.pairs = dupFinderState.pairs.filter(p =>
        dupFinderState.items[p.a].id !== id && dupFinderState.items[p.b].id !== id);
    renderDupFinderResults($('#db-subject-filter').val(), false);
    await sendAdminAction('deleteQuestion', { id: q.questionId });
}

$(document).on('click', '#db-find-dups-btn', () => checkAuthBeforeAction(findDuplicatesInSubject));
$(document).on('click', '#dup-finder-close', () => $('#dup-finder-panel').addClass('d-none'));
$(document).on('click', '.js-dup-edit', function () {
    const id = $(this).attr('data-id');
    checkAuthBeforeAction(() => openEditModal(id));
});
$(document).on('click', '.js-dup-del', function () {
    const id = $(this).attr('data-id');
    checkAuthBeforeAction(() => deleteDuplicateQuestion(id));
});
