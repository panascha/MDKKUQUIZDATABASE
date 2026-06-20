// ─────────────────────────────────────────────────────
// JS/ANNOUNCEMENTS.JS — Dynamic Announcements Manager
// ─────────────────────────────────────────────────────

window.renderAnnouncementsList = function () {
    const container = $('#announcements-list-body');
    if (!container.length) return;
    container.empty();

    const data = globalData.announcements || [];
    if (data.length === 0) {
        container.html('<tr><td colspan="6" class="text-center text-muted py-4">ไม่มีประกาศในฐานข้อมูล</td></tr>');
        return;
    }

    // เรียงลำดับความสำคัญ (Order) จากน้อยไปมาก
    data.sort((a, b) => (parseInt(a.Order) || 0) - (parseInt(b.Order) || 0));

    data.forEach(ann => {
        const isActive = String(ann.Active).trim().toUpperCase() === 'TRUE';
        const activeBadge = isActive 
            ? '<span class="badge bg-success">Active</span>' 
            : '<span class="badge bg-secondary">Inactive</span>';

        const typeBadges = {
            info: '<span class="badge bg-info">Info (Blue)</span>',
            warning: '<span class="badge bg-warning text-dark">Warning (Yellow)</span>',
            danger: '<span class="badge bg-danger">Danger (Red)</span>',
            success: '<span class="badge bg-success">Success (Green)</span>'
        };
        const typeBadge = typeBadges[String(ann.Type).trim().toLowerCase()] || typeBadges.info;

        const row = `
            <tr>
                <td class="font-monospace small align-middle">${ann.Id}</td>
                <td class="align-middle">${ann.Text}</td>
                <td class="align-middle">${typeBadge}</td>
                <td class="text-center align-middle">${activeBadge}</td>
                <td class="text-center align-middle">${ann.Order}</td>
                <td class="text-center align-middle">
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="openEditAnnouncementModal('${ann.Id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteAnnouncement('${ann.Id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            </tr>
        `;
        container.append(row);
    });
};

window.openAddAnnouncementModal = function () {
    if (!confirmAdmin()) return;

    Swal.fire({
        title: 'เพิ่มประกาศใหม่',
        html: `
            <div class="text-start">
                <div class="mb-3">
                    <label class="form-label small fw-bold">ID (เช่น ANN_3)</label>
                    <input id="swal-ann-id" class="form-control form-control-sm" placeholder="ANN_X" value="ANN_${Date.now().toString().slice(-4)}">
                </div>
                <div class="mb-3">
                    <label class="form-label small fw-bold">ข้อความประกาศ (HTML ได้)</label>
                    <textarea id="swal-ann-text" class="form-control form-control-sm" rows="3" placeholder="ข้อความประกาศ..."></textarea>
                </div>
                <div class="mb-3">
                    <label class="form-label small fw-bold">ประเภทสี</label>
                    <select id="swal-ann-type" class="form-select form-select-sm">
                        <option value="info">Info (Blue)</option>
                        <option value="warning">Warning (Yellow)</option>
                        <option value="danger">Danger (Red)</option>
                        <option value="success">Success (Green)</option>
                    </select>
                </div>
                <div class="mb-3">
                    <label class="form-label small fw-bold">สถานะใช้งาน</label>
                    <select id="swal-ann-active" class="form-select form-select-sm">
                        <option value="TRUE">เปิดใช้งาน (Active)</option>
                        <option value="FALSE">ปิดใช้งาน (Inactive)</option>
                    </select>
                </div>
                <div class="mb-3">
                    <label class="form-label small fw-bold">ลำดับการแสดงผล</label>
                    <input id="swal-ann-order" type="number" class="form-control form-control-sm" value="1">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'บันทึก',
        cancelButtonText: 'ยกเลิก',
        preConfirm: () => {
            const id = $('#swal-ann-id').val().trim();
            const text = $('#swal-ann-text').val().trim();
            const type = $('#swal-ann-type').val();
            const active = $('#swal-ann-active').val();
            const order = $('#swal-ann-order').val();

            if (!id || !text) {
                Swal.showValidationMessage('กรุณากรอกข้อมูล ID และข้อความประกาศให้ครบถ้วน');
                return false;
            }
            return { Id: id, Text: text, Type: type, Active: active, Order: parseInt(order) || 1 };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            // Optimistic Update ทันที
            if (!globalData.announcements) globalData.announcements = [];
            globalData.announcements.push(result.value);
            window.renderAnnouncementsList();

            try {
                await sendAdminAction('addAnnouncement', result.value);
            } catch (e) {
                console.error(e);
            }
        }
    });
};

window.openEditAnnouncementModal = function (id) {
    if (!confirmAdmin()) return;
    const ann = (globalData.announcements || []).find(a => a.Id === id);
    if (!ann) return;

    Swal.fire({
        title: 'แก้ไขประกาศ ' + id,
        html: `
            <div class="text-start">
                <div class="mb-3">
                    <label class="form-label small fw-bold">ข้อความประกาศ (HTML ได้)</label>
                    <textarea id="swal-ann-text" class="form-control form-control-sm" rows="3">${ann.Text}</textarea>
                </div>
                <div class="mb-3">
                    <label class="form-label small fw-bold">ประเภทสี</label>
                    <select id="swal-ann-type" class="form-select form-select-sm">
                        <option value="info" ${ann.Type === 'info' ? 'selected' : ''}>Info (Blue)</option>
                        <option value="warning" ${ann.Type === 'warning' ? 'selected' : ''}>Warning (Yellow)</option>
                        <option value="danger" ${ann.Type === 'danger' ? 'selected' : ''}>Danger (Red)</option>
                        <option value="success" ${ann.Type === 'success' ? 'selected' : ''}>Success (Green)</option>
                    </select>
                </div>
                <div class="mb-3">
                    <label class="form-label small fw-bold">สถานะใช้งาน</label>
                    <select id="swal-ann-active" class="form-select form-select-sm">
                        <option value="TRUE" ${String(ann.Active).toUpperCase() === 'TRUE' ? 'selected' : ''}>เปิดใช้งาน (Active)</option>
                        <option value="FALSE" ${String(ann.Active).toUpperCase() === 'FALSE' ? 'selected' : ''}>ปิดใช้งาน (Inactive)</option>
                    </select>
                </div>
                <div class="mb-3">
                    <label class="form-label small fw-bold">ลำดับการแสดงผล</label>
                    <input id="swal-ann-order" type="number" class="form-control form-control-sm" value="${ann.Order}">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'บันทึก',
        cancelButtonText: 'ยกเลิก',
        preConfirm: () => {
            const text = $('#swal-ann-text').val().trim();
            const type = $('#swal-ann-type').val();
            const active = $('#swal-ann-active').val();
            const order = $('#swal-ann-order').val();

            if (!text) {
                Swal.showValidationMessage('กรุณากรอกข้อความประกาศ');
                return false;
            }
            return { Id: id, Text: text, Type: type, Active: active, Order: parseInt(order) || 1 };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            // Optimistic Update ทันที
            const idx = globalData.announcements.findIndex(a => a.Id === id);
            if (idx !== -1) {
                globalData.announcements[idx] = result.value;
            }
            window.renderAnnouncementsList();

            try {
                await sendAdminAction('editAnnouncement', result.value);
            } catch (e) {
                console.error(e);
            }
        }
    });
};

window.deleteAnnouncement = async function (id) {
    if (!confirmAdmin()) return;

    const result = await Swal.fire({
        title: 'ยืนยันการลบประกาศ?',
        text: `ต้องการลบประกาศรหัส ${id} หรือไม่?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'ลบเลย',
        cancelButtonText: 'ยกเลิก'
    });

    if (result.isConfirmed) {
        // Optimistic Update ทันที
        globalData.announcements = globalData.announcements.filter(a => a.Id !== id);
        window.renderAnnouncementsList();

        try {
            await sendAdminAction('deleteAnnouncement', { Id: id });
        } catch (e) {
            console.error(e);
        }
    }
};
