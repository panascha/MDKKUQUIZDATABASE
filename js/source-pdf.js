// ─────────────────────────────────────────────────────
// JS/SOURCE-PDF.JS — ลิงก์ PDF ต้นฉบับ (ข้อสอบ/เฉลย) ต่อหัวข้อ (Category sheet cols E/F)
// เขียนผ่าน GAS action `setCategorySourcePdf` (data: [{CategoryID, exam?, key?}], ค่า = Drive ID คั่นด้วย '///')
// ─────────────────────────────────────────────────────

// รูปแบบเดียวกับ backend (maintenance.gs setCategorySourcePdfData)
const SP_ID_RE = /^[A-Za-z0-9_-]{25,}$/;

// โฟลเดอร์ปีบน SAMO Drive (ที่มา: Notion SAMO academic database, กล่องแดง)
const SP_SAMO_FOLDERS = [
    ['ปี 1', '1SYkVxMQiOQxF81ySHq3ectxwtcwikA-M'],
    ['ปี 2', '1C7H5To6oXZrw53mIQj0drDK7gCeCdDyA'],
    ['ปี 3', '1FvZIcu0w4jI5hBVUHT_VNudG_-U3hBku'],
    ['ปี 4', '1ENQSq7fguEJ3fUPtHKSo2fIxmjMqA3UY'],
    ['ปี 5', '1k-PRazYVADoqaczolP89oaEbcdS61sMp'],
    ['ปี 6', '1RwICYFbWe447nwrP56T8qHKlj3-mzfnY'],
    ['COMPRE + NLE', '1X6ruVTj0q3k6-pFEf3IGUuUbQ9BhU3ME']
];

// อ่านค่าจาก category object — Supabase v_categories ใช้ SourceExamDriveID, GAS header ใช้ Source_Exam_Drive_ID
function spGetIds(cat, which) {
    if (!cat) return [];
    const raw = which === 'exam'
        ? (cat.SourceExamDriveID ?? cat.Source_Exam_Drive_ID)
        : (cat.SourceKeyDriveID ?? cat.Source_Key_Drive_ID);
    return String(raw || '').split('///').map(s => s.trim()).filter(Boolean);
}

function spCount(cat) {
    return spGetIds(cat, 'exam').length + spGetIds(cat, 'key').length;
}

// รับลิงก์ Drive หรือ ID เปล่า (คั่นด้วยขึ้นบรรทัดใหม่/ช่องว่าง/คอมมา/`///`) → { ids, bad }
function spParseInput(text) {
    const ids = [], bad = [];
    String(text || '').split(/[\s,]+|\/\/\//).map(s => s.trim()).filter(Boolean).forEach(tok => {
        const m = tok.match(/\/d\/([A-Za-z0-9_-]+)/) || tok.match(/[?&]id=([A-Za-z0-9_-]+)/);
        const id = m ? m[1] : tok;
        if (SP_ID_RE.test(id)) { if (!ids.includes(id)) ids.push(id); } else bad.push(tok);
    });
    return { ids, bad };
}

function spFileUrl(id) { return 'https://drive.google.com/file/d/' + id + '/view'; }

function spSetLocal(catId, exam, key) {
    (globalData.category || []).forEach(c => {
        if (String(c.CategoryID) !== String(catId)) return;
        if (exam !== undefined) { c.SourceExamDriveID = exam; c.Source_Exam_Drive_ID = exam; }
        if (key !== undefined) { c.SourceKeyDriveID = key; c.Source_Key_Drive_ID = key; }
    });
}

// 📎 modal ต่อหัวข้อ (Structure)
async function openSourcePdfModal(catId) {
    const cat = (globalData.category || []).find(c => String(c.CategoryID) === String(catId));
    if (!cat) return;
    const val = which => spGetIds(cat, which).join('\n');

    const result = await Swal.fire({
        title: 'PDF ต้นฉบับ — ' + escapeHtml(catId),
        width: 640,
        html: `
        <div class="text-start small">
            <p class="text-muted mb-2">วางลิงก์ Google Drive (หรือ File ID) ไฟล์ละบรรทัด — ไฟล์ต้องแชร์ให้บัญชี KKU เปิดได้ ·
                <a href="#" onclick="openSourcePdfGuide();return false;">ดูคู่มือ</a></p>
            <label class="fw-semibold mt-2">ข้อสอบ (Exam)</label>
            <textarea id="sp-exam" class="form-control form-control-sm" rows="3" placeholder="https://drive.google.com/file/d/…/view">${escapeHtml(val('exam')) || ''}</textarea>
            <button type="button" class="btn btn-outline-secondary btn-sm mt-1" onclick="spTestOpen('sp-exam')">ตรวจลิงก์ ↗</button>
            <label class="fw-semibold mt-3 d-block">เฉลย (Key)</label>
            <textarea id="sp-key" class="form-control form-control-sm" rows="3" placeholder="https://drive.google.com/file/d/…/view">${escapeHtml(val('key')) || ''}</textarea>
            <button type="button" class="btn btn-outline-secondary btn-sm mt-1" onclick="spTestOpen('sp-key')">ตรวจลิงก์ ↗</button>
            <div class="text-muted mt-2">เว้นช่องว่าง = ล้างลิงก์ของช่องนั้น</div>
        </div>`,
        showCancelButton: true,
        confirmButtonText: 'บันทึก',
        cancelButtonText: 'ยกเลิก',
        focusConfirm: false,
        preConfirm: () => {
            const exam = spParseInput(document.getElementById('sp-exam').value);
            const key = spParseInput(document.getElementById('sp-key').value);
            const bad = exam.bad.concat(key.bad);
            if (bad.length) {
                Swal.showValidationMessage('ลิงก์/ID ไม่ถูกต้อง: ' + bad.slice(0, 3).join(', ').slice(0, 120));
                return false;
            }
            return { exam: exam.ids.join('///'), key: key.ids.join('///') };
        }
    });
    if (!result.isConfirmed || !result.value) return;
    if (!confirmAdmin()) return;

    const { exam, key } = result.value;
    try {
        const res = await sendAdminAction('setCategorySourcePdf', [{ CategoryID: catId, exam, key }], true, true);
        if (res && res.missing && res.missing.length) {
            Swal.fire('ไม่พบหัวข้อในชีต', res.missing.join(', '), 'warning');
            return;
        }
        spSetLocal(catId, exam, key);
        await setCacheDB('global_admin_data', globalData);
        renderStructureTree($('#struct-subject-filter').val());
    } catch (e) { /* sendAdminAction แจ้งผิดพลาดแล้ว */ }
}

// ปุ่ม "ตรวจลิงก์" — เปิดทุกไฟล์ในช่องนั้นในแท็บใหม่ (ไม่เรียก Drive ฝั่งเซิร์ฟเวอร์)
function spTestOpen(textareaId) {
    const { ids, bad } = spParseInput(document.getElementById(textareaId).value);
    if (bad.length) { Swal.showValidationMessage('ลิงก์/ID ไม่ถูกต้อง: ' + bad[0].slice(0, 80)); return; }
    ids.forEach(id => window.open(spFileUrl(id), '_blank', 'noopener'));
}

// คู่มือ (ภาษาไทย 4 ขั้นตอน) — เปิดจากหัว Converter และ sidebar
function openSourcePdfGuide() {
    const folders = SP_SAMO_FOLDERS.map(([label, id]) =>
        `<a class="btn btn-outline-primary btn-sm me-1 mb-1" target="_blank" rel="noopener" href="https://drive.google.com/drive/folders/${id}">${label} ↗</a>`
    ).join('');
    Swal.fire({
        title: 'คู่มือเพิ่มลิงก์ PDF ต้นฉบับ',
        width: 640,
        confirmButtonText: 'เข้าใจแล้ว',
        html: `
        <ol class="text-start small" style="line-height:1.7">
            <li><b>หาไฟล์บน SAMO Drive</b> — เปิดโฟลเดอร์ของชั้นปีที่ต้องการ แล้วหาไฟล์ข้อสอบ (และเฉลย ถ้ามี) ของชุดนั้น<br>${folders}</li>
            <li><b>คัดลอกลิงก์</b> — คลิกขวาที่ไฟล์ &rarr; แชร์ &rarr; คัดลอกลิงก์ (ไฟล์ต้องเปิดได้ด้วยบัญชี KKU)</li>
            <li><b>วางลิงก์ที่หัวข้อ</b> — เมนู โครงสร้างวิชา &rarr; กดไอคอน 📎 ที่แถวหัวข้อ &rarr; วางลิงก์ในช่อง ข้อสอบ / เฉลย (หลายไฟล์ = ไฟล์ละบรรทัด)
                <br>หรือตอนใช้ Converter: ถ้านำเข้าหัวข้อเดียว กรอกช่อง "ลิงก์ PDF ต้นฉบับ" ได้เลย ระบบบันทึกให้หลังนำเข้าสำเร็จ</li>
            <li><b>ตรวจลิงก์</b> — กด "ตรวจลิงก์ ↗" เพื่อเปิดไฟล์ดูว่าถูกต้อง แล้วกดบันทึก ปุ่ม "ดู PDF ต้นฉบับ" ในแอปนักเรียนจะแสดงทันทีหลังรีโหลด</li>
        </ol>`
    });
}

// ── Converter fields (D9) ───────────────────────────────

// หมวดทั้งหมดที่ผลแปลงอ้างถึง (ไม่นับ *_Uncategorized) — ใช้ตัดสินว่ากรอกลิงก์ได้ไหม
function spConverterKeys() {
    const keys = new Set();
    (converterStorage.ques || []).forEach(row => {
        let cats = row[6];
        if (typeof cats === 'string') { try { cats = JSON.parse(cats); } catch (e) { cats = [cats]; } }
        (Array.isArray(cats) ? cats : [cats]).forEach(c => { if (c) keys.add(String(c)); });
    });
    if (!keys.size) (converterStorage.category || []).forEach(r => { if (r[0]) keys.add(String(r[0])); });
    return [...keys].filter(k => !/_Uncategorized$/.test(k));
}

function spRefreshConverterFields() {
    const box = document.getElementById('conv-sp-box');
    if (!box) return;
    const keys = spConverterKeys();
    const exam = document.getElementById('conv-sp-exam');
    const key = document.getElementById('conv-sp-key');
    const hint = document.getElementById('conv-sp-hint');
    const ok = keys.length === 1;
    exam.disabled = key.disabled = !ok;
    hint.textContent = keys.length === 0 ? ''
        : ok ? 'บันทึกให้หัวข้อ ' + keys[0] + ' หลังนำเข้าสำเร็จ'
            : 'มี ' + keys.length + ' หัวข้อ — ใช้ 📎 ใน โครงสร้างวิชา';
}

// เรียกหลัง adminImport สำเร็จ (ก่อน handleSaveResult ล้าง storage) — ล้มเหลวไม่ทำให้การนำเข้าล้ม
async function spSaveConverterLinks() {
    const examEl = document.getElementById('conv-sp-exam');
    const keyEl = document.getElementById('conv-sp-key');
    if (!examEl || !keyEl || examEl.disabled) return;
    const keys = spConverterKeys();
    if (keys.length !== 1) return;
    const exam = spParseInput(examEl.value), key = spParseInput(keyEl.value);
    if (!examEl.value.trim() && !keyEl.value.trim()) return;
    if (exam.bad.length || key.bad.length) {
        Swal.fire({ icon: 'warning', title: 'ลิงก์ PDF ต้นฉบับไม่ถูกต้อง — ไม่ได้บันทึก', text: 'นำเข้าข้อสอบสำเร็จแล้ว ใช้ 📎 ใน โครงสร้างวิชา เพื่อเพิ่มลิงก์ภายหลัง', toast: true, position: 'top-end', showConfirmButton: false, timer: 6000 });
        return;
    }
    const item = { CategoryID: keys[0] };
    if (examEl.value.trim()) item.exam = exam.ids.join('///');
    if (keyEl.value.trim()) item.key = key.ids.join('///');
    try {
        const res = await sendWithRetry({
            action: 'setCategorySourcePdf',
            username: currentUser.username,
            adminPass: adminPass,
            user: currentUser.displayName,
            data: [item],
            metadata: navigator.userAgent
        });
        if (res.result !== 'success' || (res.missing && res.missing.length)) {
            throw new Error(res.message || 'ไม่พบหัวข้อในชีต');
        }
        spSetLocal(item.CategoryID, item.exam, item.key);
        examEl.value = keyEl.value = '';
    } catch (e) {
        console.error('spSaveConverterLinks', e);
        Swal.fire({ icon: 'warning', title: 'บันทึกลิงก์ PDF ต้นฉบับไม่สำเร็จ', text: 'นำเข้าข้อสอบสำเร็จแล้ว ใช้ 📎 ใน โครงสร้างวิชา เพื่อเพิ่มลิงก์ภายหลัง', toast: true, position: 'top-end', showConfirmButton: false, timer: 6000 });
    }
}
