// ─────────────────────────────────────────────────────
// JS/FEEDBACK-ADMIN.JS — ตารางอ่านอย่างเดียวของ App Feedback (แจ้งปัญหา/เสนอฟีเจอร์จาก REAL)
// v1 อ่านผ่าน GAS action:'getFeedback' เท่านั้น — แก้ Status/AdminNote ในชีต Feedback โดยตรง
// ─────────────────────────────────────────────────────

function escapeFeedbackHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadFeedbackSection() {
    const body = document.getElementById('feedback-list-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm me-2"></div> กำลังโหลด...</td></tr>';
    try {
        const res = await sendWithRetry({
            action: 'getFeedback',
            username: currentUser.username,
            adminPass: adminPass
        });
        if (!res || res.result !== 'success') throw new Error((res && res.message) || 'unknown');
        renderFeedbackRows(res.feedback || []);
    } catch (err) {
        body.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">โหลดไม่สำเร็จ: ${escapeFeedbackHtml(err.message)}</td></tr>`;
    }
}

function renderFeedbackRows(rows) {
    const body = document.getElementById('feedback-list-body');
    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">ยังไม่มีฟีดแบ็กเข้ามา</td></tr>';
        return;
    }
    const typeBadge = { Bug: 'bg-danger', Feature: 'bg-primary', Other: 'bg-secondary' };
    const statusBadge = { New: 'bg-warning text-dark', Ack: 'bg-info text-dark', Done: 'bg-success', Rejected: 'bg-secondary' };
    // ใหม่สุดขึ้นก่อน (ชีต append ท้ายเสมอ)
    body.innerHTML = rows.slice().reverse().map(r => {
        let ctx = {};
        try { ctx = JSON.parse(r.context || '{}'); } catch (e) { }
        const ctxHtml = [
            ctx.subject ? 'วิชา: ' + escapeFeedbackHtml(ctx.subject) : '',
            ctx.questionId ? 'ข้อ: ' + escapeFeedbackHtml(ctx.questionId) : '',
            ctx.appVersion ? 'เวอร์ชัน: ' + escapeFeedbackHtml(ctx.appVersion) : '',
            ctx.viewport ? 'จอ: ' + escapeFeedbackHtml(ctx.viewport) : ''
        ].filter(Boolean).join('<br>');
        const imgsHtml = String(r.images || '').split('///').filter(u => u && u.indexOf('http') === 0)
            .map(u => `<a href="${escapeFeedbackHtml(u)}" target="_blank" rel="noopener"><img src="${escapeFeedbackHtml(transformUrl(u))}" style="width:60px;height:60px;object-fit:cover;border-radius:4px;margin:2px;" loading="lazy"></a>`)
            .join('');
        return `<tr>
            <td class="small text-nowrap">${escapeFeedbackHtml(formatDate(r.timestamp))}</td>
            <td><span class="badge ${typeBadge[r.type] || 'bg-secondary'}">${escapeFeedbackHtml(r.type)}</span></td>
            <td style="white-space: pre-wrap; max-width: 380px;">${escapeFeedbackHtml(r.description)}</td>
            <td class="small">${escapeFeedbackHtml(r.email)}</td>
            <td class="small">${ctxHtml}</td>
            <td>${imgsHtml}</td>
            <td><span class="badge ${statusBadge[r.status] || 'bg-light text-dark'}">${escapeFeedbackHtml(r.status)}</span>${r.adminNote ? '<div class="small text-muted mt-1">' + escapeFeedbackHtml(r.adminNote) + '</div>' : ''}</td>
        </tr>`;
    }).join('');
}
