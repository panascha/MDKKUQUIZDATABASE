// ─────────────────────────────────────────────────────
// JS/DONATIONS-ADMIN.JS — จัดการสลิปบริจาค (donations) จาก REAL
// อ่านผ่าน GAS action:'getDonations' (รวม slipDriveUrl — admin only) + override status ผ่าน 'updateDonationStatus'
// XSS: message/donorName เป็น user-authored raw — escape ทุก cell (esc ห่อ escapeHtml + String)
// ─────────────────────────────────────────────────────

function escDon(s) { return escapeHtml(String(s == null ? '' : s)); }

var _donationsCache = [];

async function loadDonationsSection() {
    const body = document.getElementById('donations-list-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm me-2"></div> กำลังโหลด...</td></tr>';
    try {
        const res = await sendWithRetry({
            action: 'getDonations',
            username: currentUser.username,
            adminPass: adminPass
        });
        if (!res || res.result !== 'success') throw new Error((res && res.message) || 'unknown');
        _donationsCache = res.donations || [];
        renderDonationRows();
    } catch (err) {
        body.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">โหลดไม่สำเร็จ: ${escDon(err.message)}</td></tr>`;
    }
}

function renderDonationRows() {
    const body = document.getElementById('donations-list-body');
    if (!body) return;
    if (!_donationsCache.length) {
        body.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">ยังไม่มีการบริจาคเข้ามา</td></tr>';
        return;
    }
    const matchBadge = { high: 'bg-success', low: 'bg-warning text-dark', none: 'bg-danger' };
    const statusBadge = { Verified: 'bg-success', SlipReviewed: 'bg-info text-dark', PendingAdmin: 'bg-warning text-dark', Rejected: 'bg-danger', Hidden: 'bg-secondary', Deleted: 'bg-dark' };
    // ใหม่สุดขึ้นก่อน
    body.innerHTML = _donationsCache.slice().reverse().map(r => {
        const who = r.isAnonymous
            ? '<span class="text-muted fst-italic">ไม่ระบุตัวตน</span>'
            : escDon(r.donorName);
        const matchKey = String(r.recipientMatch || '').toLowerCase();
        const slipBtn = r.slipDriveUrl
            ? `<button class="btn btn-sm btn-outline-info don-slip" data-url="${escDon(r.slipDriveUrl)}"><i class="fas fa-receipt"></i> ดูสลิป</button>`
            : '<span class="small text-muted">—</span>';
        return `<tr>
            <td class="small text-nowrap" data-label="เวลา">${escDon(formatDate(r.timestamp))}</td>
            <td class="small" data-label="ผู้บริจาค">${who}</td>
            <td class="text-nowrap" data-label="จำนวน">${escDon(r.amount)} ฿</td>
            <td class="small text-nowrap" data-label="อ้างอิง">${escDon(r.transRef)}<div><span class="badge ${matchBadge[matchKey] || 'bg-light text-dark'}">match: ${escDon(r.recipientMatch)}</span></div></td>
            <td style="white-space: pre-wrap; max-width: 260px;" data-label="ข้อความ">${escDon(r.message)}</td>
            <td data-label="สลิป/สถานะ">${slipBtn}<div class="mt-1"><span class="badge ${statusBadge[r.status] || 'bg-light text-dark'}">${escDon(r.status)}</span></div>${r.adminNote ? '<div class="small text-muted mt-1" style="white-space:pre-wrap;">' + escDon(r.adminNote) + '</div>' : ''}</td>
            <td class="text-nowrap" data-label="จัดการ">
                <button class="btn btn-sm btn-outline-success don-act mb-1" data-row="${r.rowIndex}" data-status="Verified" title="ยืนยัน"><i class="fas fa-check"></i></button>
                <button class="btn btn-sm btn-outline-danger don-act mb-1" data-row="${r.rowIndex}" data-status="Rejected" title="ปฏิเสธ"><i class="fas fa-ban"></i></button>
                <button class="btn btn-sm btn-outline-secondary don-act mb-1" data-row="${r.rowIndex}" data-status="Hidden" title="ซ่อน"><i class="fas fa-eye-slash"></i></button>
                <button class="btn btn-sm btn-outline-dark don-del mb-1" data-row="${r.rowIndex}" title="ลบ (soft-delete)"><i class="fas fa-trash"></i></button>
                <button class="btn btn-sm btn-outline-primary don-note mb-1" data-row="${r.rowIndex}" data-status="${escDon(r.status)}" title="เพิ่มโน้ต"><i class="fas fa-pen"></i></button>
            </td>
        </tr>`;
    }).join('');
}

async function updateDonationStatusUI(rowIndex, status, note) {
    const payload = { action: 'updateDonationStatus', rowIndex: rowIndex, status: status, username: currentUser.username, adminPass: adminPass };
    if (note) payload.note = note;
    try {
        const res = await sendWithRetry(payload);
        if (!res || res.result !== 'success') throw new Error((res && res.message) || 'unknown');
        await loadDonationsSection();
    } catch (err) {
        Swal.fire('ไม่สำเร็จ', escDon(err.message), 'error');
    }
}

$(document).on('click', '.don-slip', function () {
    const url = this.getAttribute('data-url');
    Swal.fire({ imageUrl: transformUrl(url), imageAlt: 'สลิปบริจาค', width: 520, showConfirmButton: false, showCloseButton: true });
});

$(document).on('click', '.don-act', function () {
    const row = Number(this.getAttribute('data-row'));
    const status = this.getAttribute('data-status');
    updateDonationStatusUI(row, status);
});

$(document).on('click', '.don-del', async function () {
    const row = Number(this.getAttribute('data-row'));
    const ok = await Swal.fire({
        title: 'ลบรายการบริจาค?', text: 'ตั้งสถานะเป็น Deleted (soft-delete — แถวยังอยู่ในชีต ไม่ถูกลบจริง)',
        icon: 'warning', showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#dc3545'
    });
    if (ok.isConfirmed) updateDonationStatusUI(row, 'Deleted');
});

$(document).on('click', '.don-note', async function () {
    const row = Number(this.getAttribute('data-row'));
    const status = this.getAttribute('data-status');
    const { value: note } = await Swal.fire({
        title: 'เพิ่มโน้ตแอดมิน', input: 'textarea',
        inputPlaceholder: 'ข้อความจะถูกเติมวันเวลาให้อัตโนมัติ',
        showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก'
    });
    if (note && note.trim()) updateDonationStatusUI(row, status, note.trim());
});
