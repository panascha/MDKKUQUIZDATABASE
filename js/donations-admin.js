// ─────────────────────────────────────────────────────
// JS/DONATIONS-ADMIN.JS — Slip Verification & Donation Dashboard
// อ่านผ่าน GAS action:'getDonations' (รวม slipDriveUrl — admin only) + override status ผ่าน 'updateDonationStatus'
// Card-based inspection layout: KPI summary + status tabs + slip thumbnails + donor-list export
// XSS: message/donorName/note/ref เป็น user-authored raw — escape ทุกจุดด้วย escDon()
// ─────────────────────────────────────────────────────

function escDon(s) { return escapeHtml(String(s == null ? '' : s)); }

var _donationsCache = [];
var _donTab = 'pending'; // pending | verified | rejected | all

// PendingAdmin + SlipReviewed → 'pending' (ยังไม่ finalize); Verified → 'verified'; Rejected → 'rejected'; อื่น (Hidden/Deleted) → 'other'
function donBucket(status) {
    if (status === 'PendingAdmin' || status === 'SlipReviewed') return 'pending';
    if (status === 'Verified') return 'verified';
    if (status === 'Rejected') return 'rejected';
    return 'other';
}

function donAmount(r) {
    const n = parseFloat(String(r.amount == null ? '' : r.amount).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
}

function donMoney(n) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// tab='all' → ทุกอย่างยกเว้น Deleted; อื่น → ตรง bucket
function donInTab(r, tab) {
    if (tab === 'all') return r.status !== 'Deleted';
    return donBucket(r.status) === tab;
}

function donSetText(id, t) { const e = document.getElementById(id); if (e) e.textContent = t; }

async function loadDonationsSection() {
    const wrap = document.getElementById('donations-cards');
    if (!wrap) return;
    wrap.innerHTML = '<div class="text-center py-5"><div class="spinner-border spinner-border-sm me-2"></div> กำลังโหลด...</div>';
    try {
        const res = await sendWithRetry({
            action: 'getDonations',
            username: currentUser.username,
            adminPass: adminPass
        });
        if (!res || res.result !== 'success') throw new Error((res && res.message) || 'unknown');
        _donationsCache = res.donations || [];
        renderDonations();
    } catch (err) {
        wrap.innerHTML = `<div class="text-center text-danger py-5">โหลดไม่สำเร็จ: ${escDon(err.message)}</div>`;
    }
}

function donCardHtml(r) {
    const url = r.slipDriveUrl ? transformUrl(r.slipDriveUrl) : '';
    const thumb = url
        ? `<img class="don-thumb" src="${escDon(url)}" loading="lazy" alt="สลิป" onclick="viewFullImage(this.src)">`
        : '<div class="don-thumb-empty"><i class="fas fa-receipt"></i></div>';
    const who = r.isAnonymous
        ? '<span class="text-muted fst-italic">ผู้ไม่ประสงค์ออกนาม</span>'
        : escDon(r.donorName || 'ไม่ระบุ');
    const matchKey = String(r.recipientMatch || '').toLowerCase();
    const matchBadge = { high: 'bg-success', low: 'bg-warning text-dark', none: 'bg-danger' };
    const statusBadge = { Verified: 'bg-success', SlipReviewed: 'bg-info text-dark', PendingAdmin: 'bg-warning text-dark', Rejected: 'bg-danger', Hidden: 'bg-secondary', Deleted: 'bg-dark' };
    const statusLabel = { Verified: 'ยืนยันแล้ว', SlipReviewed: 'AI อ่านแล้ว', PendingAdmin: 'รอแอดมินตรวจ', Rejected: 'ปฏิเสธ', Hidden: 'ซ่อน', Deleted: 'ลบแล้ว' };
    const msg = r.message ? `<div class="don-msg">💬 ${escDon(r.message)}</div>` : '';
    const note = r.adminNote ? `<div class="small text-muted mt-2" style="white-space:pre-wrap;"><i class="fas fa-pen me-1"></i>${escDon(r.adminNote)}</div>` : '';
    return `<div class="don-card">
        <div>${thumb}</div>
        <div>
            <div class="d-flex align-items-center flex-wrap gap-2">
                <span class="don-amount">฿ ${escDon(donMoney(donAmount(r)))}</span>
                <span class="badge ${statusBadge[r.status] || 'bg-light text-dark'}">${escDon(statusLabel[r.status] || r.status)}</span>
                <span class="badge ${matchBadge[matchKey] || 'bg-light text-dark'}">AI Match: ${escDon(r.recipientMatch || '—')}</span>
            </div>
            <div class="mt-2"><i class="fas fa-user me-1 text-muted"></i>${who}</div>
            ${msg}
            <div class="small text-muted mt-2"><i class="far fa-clock me-1"></i>${escDon(formatDate(r.timestamp))}${r.transRef ? ' · Ref: ' + escDon(r.transRef) : ''}</div>
            ${note}
        </div>
        <div class="don-actions">
            <button class="btn btn-sm btn-success don-act" data-row="${r.rowIndex}" data-status="Verified"><i class="fas fa-check me-1"></i>อนุมัติ</button>
            <button class="btn btn-sm btn-outline-danger don-act" data-row="${r.rowIndex}" data-status="Rejected"><i class="fas fa-ban me-1"></i>ปฏิเสธ</button>
            <button class="btn btn-sm btn-outline-secondary don-note" data-row="${r.rowIndex}" data-status="${escDon(r.status)}"><i class="fas fa-pen me-1"></i>โน้ต</button>
            <button class="btn btn-sm btn-outline-dark don-del" data-row="${r.rowIndex}"><i class="fas fa-trash me-1"></i>ลบ</button>
        </div>
    </div>`;
}

function renderDonations() {
    const wrap = document.getElementById('donations-cards');
    if (!wrap) return;
    let pending = 0, verified = 0, rejected = 0, all = 0, donors = 0, total = 0;
    _donationsCache.forEach(r => {
        if (r.status === 'Deleted') return;
        all++; donors++;
        const b = donBucket(r.status);
        if (b === 'pending') pending++; else if (b === 'verified') verified++; else if (b === 'rejected') rejected++;
        if (r.status === 'Verified' || r.status === 'SlipReviewed') total += donAmount(r);
    });
    donSetText('kpi-total', '฿ ' + donMoney(total));
    donSetText('kpi-donors', String(donors));
    donSetText('kpi-pending', String(pending));
    donSetText('kpi-verified', String(verified));
    donSetText('cnt-pending', String(pending));
    donSetText('cnt-verified', String(verified));
    donSetText('cnt-rejected', String(rejected));
    donSetText('cnt-all', String(all));
    const pk = document.getElementById('kpi-pending-card');
    if (pk) pk.classList.toggle('pulse', pending > 0);
    document.querySelectorAll('#don-tabs .don-tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === _donTab));

    const rows = _donationsCache.filter(r => donInTab(r, _donTab)).reverse(); // ใหม่สุดขึ้นก่อน
    if (!rows.length) {
        wrap.innerHTML = '<div class="text-center text-muted py-5"><i class="fas fa-inbox fa-2x mb-2 d-block"></i>ไม่มีรายการในหมวดนี้</div>';
        return;
    }
    wrap.innerHTML = rows.map(donCardHtml).join('');
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

function donToastCopied() {
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'คัดลอกแล้ว', showConfirmButton: false, timer: 1500 });
}

function donCopyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(donToastCopied, () => donFallbackCopy(text));
    } else {
        donFallbackCopy(text);
    }
}

function donFallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); donToastCopied(); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
}

// ── Event handlers ──────────────────────────────────

$(document).on('click', '#don-tabs .don-tab-btn', function () {
    _donTab = this.getAttribute('data-tab');
    renderDonations();
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

$(document).on('click', '#don-donor-list', function () {
    const rows = _donationsCache.filter(r => r.status === 'Verified' || r.status === 'SlipReviewed');
    if (!rows.length) { Swal.fire('ยังไม่มีข้อมูล', 'ยังไม่มีผู้บริจาคที่ยืนยันแล้ว', 'info'); return; }
    let total = 0;
    const plainLines = rows.map(r => {
        const amt = donAmount(r); total += amt;
        const name = r.isAnonymous ? 'ผู้ไม่ประสงค์ออกนาม' : (r.donorName || 'ไม่ระบุ');
        const m = r.message ? ' — "' + r.message + '"' : '';
        return `${name} — ฿${donMoney(amt)}${m}`;
    });
    const plain = '🙏 ขอบคุณผู้สนับสนุนทุกท่าน\n\n' + plainLines.join('\n') + `\n\nรวม ฿${donMoney(total)} จาก ${rows.length} รายการ`;
    const htmlList = rows.map(r => {
        const amt = donAmount(r);
        const name = r.isAnonymous ? '<i class="text-muted">ผู้ไม่ประสงค์ออกนาม</i>' : escDon(r.donorName || 'ไม่ระบุ');
        const m = r.message ? ' <span class="text-muted">— "' + escDon(r.message) + '"</span>' : '';
        return `<div class="d-flex justify-content-between border-bottom py-1"><span>${name}${m}</span><span class="fw-bold text-success text-nowrap ms-2">฿${escDon(donMoney(amt))}</span></div>`;
    }).join('');
    Swal.fire({
        title: 'สรุปรายชื่อผู้บริจาค',
        html: `<div style="max-height:50vh;overflow:auto;text-align:left;">${htmlList}</div>`
            + `<div class="mt-2 fw-bold text-end">รวม ฿${escDon(donMoney(total))} · ${rows.length} รายการ</div>`,
        width: 600, showCloseButton: true, confirmButtonText: '<i class="fas fa-copy"></i> คัดลอกข้อความขอบคุณ'
    }).then(res => { if (res.isConfirmed) donCopyText(plain); });
});
