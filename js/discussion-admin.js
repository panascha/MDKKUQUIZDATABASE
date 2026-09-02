// ─────────────────────────────────────────────────────
// JS/DISCUSSION-ADMIN.JS — Moderation กระทู้พูดคุยรายข้อ (Feature 5 Peer Discussion จาก REAL)
// อ่านทุกแถว (รวม deleted) ผ่าน GAS action:'getDiscussionAdmin' + ลบ (soft-delete) ผ่าน 'deleteComment'
// XSS: nickname/text เป็น user-authored raw — escape ทุก cell เสมอ. ฟังก์ชันไม่อยู่บน window.* (สไตล์ DATABASE)
// หมายเหตุ backend รองรับแค่ set 'deleted' (ยังไม่มี restore) → v1 ลบอย่างเดียว, แถวที่ลบแล้วปิดปุ่ม
// ─────────────────────────────────────────────────────

function escDisc(s) { return escapeHtml(String(s == null ? '' : s)); }

async function loadDiscussionSection() {
    const body = document.getElementById('discussion-list-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="6" class="text-center py-4"><div class="spinner-border spinner-border-sm me-2"></div> กำลังโหลด...</td></tr>';
    try {
        const res = await sendWithRetry({
            action: 'getDiscussionAdmin',
            username: currentUser.username,
            adminPass: adminPass
        });
        if (!res || res.result !== 'success') throw new Error((res && res.message) || 'unknown');
        renderDiscussionRows(res.discussion || []);
    } catch (err) {
        body.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">โหลดไม่สำเร็จ: ${escDisc(err.message)}</td></tr>`;
    }
}

function renderDiscussionRows(rows) {
    const body = document.getElementById('discussion-list-body');
    if (!body) return;
    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">ยังไม่มีความคิดเห็น</td></tr>';
        return;
    }
    // ใหม่สุดขึ้นก่อน (ชีต append ท้ายเสมอ)
    body.innerHTML = rows.slice().reverse().map(r => {
        const isDeleted = r.status === 'deleted';
        const who = `${escDisc(r.nickname)}${r.tag ? ' <span class="small text-muted">#' + escDisc(r.tag) + '</span>' : ''}`;
        const statusBadge = isDeleted ? 'bg-secondary' : 'bg-success';
        // qid+timestamp เป็น key ลบ (backend match ด้วยค่านี้เป๊ะ) — เก็บใน data-attr, ไม่ inline onclick
        const delBtn = isDeleted
            ? '<span class="small text-muted">ลบแล้ว</span>'
            : `<button class="btn btn-sm btn-outline-danger disc-del" data-qid="${escDisc(r.qid)}" data-ts="${escDisc(r.timestamp)}" title="ลบความคิดเห็น"><i class="fas fa-trash"></i></button>`;
        return `<tr${isDeleted ? ' class="text-muted"' : ''}>
            <td class="small text-nowrap" data-label="เวลา">${escDisc(formatDate(r.timestamp))}</td>
            <td class="small text-nowrap" data-label="ข้อ">${escDisc(r.qid)}</td>
            <td class="small" data-label="ผู้โพสต์">${who}<div class="small text-muted">${escDisc(r.email)}</div></td>
            <td style="white-space: pre-wrap; max-width: 380px;" data-label="ข้อความ">${escDisc(r.text)}</td>
            <td data-label="สถานะ"><span class="badge ${statusBadge}">${escDisc(r.status)}</span></td>
            <td class="text-nowrap" data-label="จัดการ">${delBtn}</td>
        </tr>`;
    }).join('');
}

async function deleteDiscussionCommentUI(qid, timestamp) {
    const payload = { action: 'deleteComment', qid: qid, timestamp: timestamp, username: currentUser.username, adminPass: adminPass };
    try {
        const res = await sendWithRetry(payload);
        if (!res || res.result !== 'success') throw new Error((res && res.message) || 'unknown');
        await loadDiscussionSection();
    } catch (err) {
        Swal.fire('ลบไม่สำเร็จ', escDisc(err.message), 'error');
    }
}

$(document).on('click', '.disc-del', async function () {
    const qid = this.getAttribute('data-qid');
    const ts = this.getAttribute('data-ts');
    const r = await Swal.fire({
        title: 'ลบความคิดเห็นนี้?',
        text: 'จะซ่อนจากกระทู้ฝั่งผู้ใช้ (soft-delete)',
        icon: 'warning',
        showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#e74a3b'
    });
    if (r.isConfirmed) deleteDiscussionCommentUI(qid, ts);
});
