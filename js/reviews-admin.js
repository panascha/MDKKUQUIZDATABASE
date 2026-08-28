// ─────────────────────────────────────────────────────
// JS/REVIEWS-ADMIN.JS — จัดการรีวิววิชา (subject reviews) จาก REAL
// อ่านทุกสถานะผ่าน GAS action:'getReviewsAdmin' + สั่ง hide/approve/reject ผ่าน 'updateReviewStatus'
// XSS: reviewText เป็น user-authored raw — escape ทุก cell เสมอ (esc ห่อ escapeHtml + String)
// ─────────────────────────────────────────────────────

function escReview(s) { return escapeHtml(String(s == null ? '' : s)); }

var _reviewsCache = [];
var _reviewsFilter = 'All'; // All | Approved | Hidden | Rejected

async function loadReviewsSection() {
    const body = document.getElementById('reviews-list-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="6" class="text-center py-4"><div class="spinner-border spinner-border-sm me-2"></div> กำลังโหลด...</td></tr>';
    try {
        const res = await sendWithRetry({
            action: 'getReviewsAdmin',
            username: currentUser.username,
            adminPass: adminPass
        });
        if (!res || res.result !== 'success') throw new Error((res && res.message) || 'unknown');
        _reviewsCache = res.reviews || [];
        renderReviewRows();
    } catch (err) {
        body.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">โหลดไม่สำเร็จ: ${escReview(err.message)}</td></tr>`;
    }
}

function setReviewFilter(status) {
    _reviewsFilter = status;
    document.querySelectorAll('#reviews-filter-bar .btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-filter') === status);
    });
    renderReviewRows();
}

function renderReviewRows() {
    const body = document.getElementById('reviews-list-body');
    if (!body) return;
    const statusBadge = { Approved: 'bg-success', Hidden: 'bg-secondary', Rejected: 'bg-danger' };
    const rows = _reviewsCache.filter(r => _reviewsFilter === 'All' || r.status === _reviewsFilter);
    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">ไม่มีรีวิวในสถานะนี้</td></tr>';
        return;
    }
    // ใหม่สุดขึ้นก่อน (ชีต append ท้ายเสมอ)
    body.innerHTML = rows.slice().reverse().map(r => {
        const nRating = Math.max(0, Math.min(5, Number(r.rating) || 0));
        const stars = '★'.repeat(nRating) + '☆'.repeat(5 - nRating);
        const who = r.isAnonymous
            ? '<span class="text-muted fst-italic">ไม่ระบุตัวตน</span>'
            : `${escReview(r.displayName)}${r.yearLabel ? ' <span class="small text-muted">(' + escReview(r.yearLabel) + ')</span>' : ''}`;
        return `<tr>
            <td class="small text-nowrap" data-label="เวลา">${escReview(formatDate(r.timestamp))}</td>
            <td class="small text-nowrap" data-label="วิชา">${escReview(r.subjectId)}</td>
            <td class="text-warning text-nowrap" data-label="คะแนน" title="${nRating}/5">${stars}</td>
            <td style="white-space: pre-wrap; max-width: 360px;" data-label="รีวิว">${escReview(r.reviewText)}<div class="small text-muted mt-1">${who}</div></td>
            <td data-label="สถานะ"><span class="badge ${statusBadge[r.status] || 'bg-light text-dark'}">${escReview(r.status)}</span>${r.adminNote ? '<div class="small text-muted mt-1" style="white-space:pre-wrap;">' + escReview(r.adminNote) + '</div>' : ''}</td>
            <td class="text-nowrap" data-label="จัดการ">
                <button class="btn btn-sm btn-outline-success rev-act mb-1" data-row="${r.rowIndex}" data-status="Approved" title="อนุมัติ/แสดง"><i class="fas fa-check"></i></button>
                <button class="btn btn-sm btn-outline-secondary rev-act mb-1" data-row="${r.rowIndex}" data-status="Hidden" title="ซ่อน"><i class="fas fa-eye-slash"></i></button>
                <button class="btn btn-sm btn-outline-danger rev-act mb-1" data-row="${r.rowIndex}" data-status="Rejected" title="ปฏิเสธ"><i class="fas fa-ban"></i></button>
                <button class="btn btn-sm btn-outline-primary rev-note mb-1" data-row="${r.rowIndex}" data-status="${escReview(r.status)}" title="เพิ่มโน้ต"><i class="fas fa-pen"></i></button>
            </td>
        </tr>`;
    }).join('');
}

async function updateReviewStatusUI(rowIndex, status, note) {
    const payload = { action: 'updateReviewStatus', rowIndex: rowIndex, status: status, username: currentUser.username, adminPass: adminPass };
    if (note) payload.note = note;
    try {
        const res = await sendWithRetry(payload);
        if (!res || res.result !== 'success') throw new Error((res && res.message) || 'unknown');
        await loadReviewsSection();
    } catch (err) {
        Swal.fire('ไม่สำเร็จ', escReview(err.message), 'error');
    }
}

$(document).on('click', '.rev-act', function () {
    const row = Number(this.getAttribute('data-row'));
    const status = this.getAttribute('data-status');
    updateReviewStatusUI(row, status);
});

$(document).on('click', '.rev-note', async function () {
    const row = Number(this.getAttribute('data-row'));
    const status = this.getAttribute('data-status');
    const { value: note } = await Swal.fire({
        title: 'เพิ่มโน้ตแอดมิน',
        input: 'textarea',
        inputPlaceholder: 'ข้อความจะถูกเติมวันเวลาให้อัตโนมัติ',
        showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก'
    });
    if (note && note.trim()) updateReviewStatusUI(row, status, note.trim());
});
