// ─────────────────────────────────────────────────────
// JS/CONVERTER-EDIT.JS
// แก้ไขข้อสอบที่ AI แปลงมา ก่อนบันทึกลงฐานข้อมูล
// เขียนกลับลง converterStorage.ques[rowIndex] โดยตรง (ยังไม่แตะ DB)
// row model: [qId, problem, img, choices('a///b'), answer, explain, categoryJSON]
// answer ผูกกับ choices เสมอ (radio เลือกจาก choices ที่มีอยู่) — กัน answer ∉ choices
// ─────────────────────────────────────────────────────

let _convEditRow = null; // rowIndex ที่กำลังแก้อยู่

// เปิด modal + เติมข้อมูลจากแถวปัจจุบัน
function openConverterEditModal(rowIndex) {
    const row = converterStorage.ques[rowIndex];
    if (!row) return;
    _convEditRow = rowIndex;

    document.getElementById('conv-edit-problem').value = row[1] || '';
    document.getElementById('conv-edit-explain').value = row[5] || '';

    // choices + answer (radio ติ๊กช่องที่ตรงกับ answer)
    const answer = String(row[4] || '').trim();
    const choices = String(row[3] || '').split('///').map(c => c.trim()).filter(c => c !== '');
    const $box = $('#conv-edit-choices').empty();
    if (choices.length === 0) choices.push('', '');
    choices.forEach(c => convEditAddChoice(c, c !== '' && c === answer));
    // ถ้าไม่มีช่องไหนตรง answer ให้ติ๊กช่องแรกที่ไม่ว่าง
    if (!$('#conv-edit-choices .conv-choice-radio:checked').length) {
        $('#conv-edit-choices .conv-choice-row').filter(function () {
            return $(this).find('.conv-choice-text').val().trim() !== '';
        }).first().find('.conv-choice-radio').prop('checked', true);
    }

    // category
    let cats = [];
    try { cats = JSON.parse(row[6]); } catch (e) { if (row[6]) cats = [row[6]]; }
    if (!Array.isArray(cats)) cats = [cats];
    document.getElementById('conv-edit-cat0').value = cats[0] || '';
    _convEditPopulateCat1(cats[1] || '');

    // require_img toggle — จัดการเฉพาะตอน img เป็น '' หรือ 'require_img' (ยังไม่มี URL จริง)
    const img = String(row[2] || '').trim();
    const hasRealImg = /^https?:|drive\.google\.com|^<svg/i.test(img) || img.includes('///');
    const $chk = $('#conv-edit-requireimg');
    $chk.prop('checked', img === 'require_img').prop('disabled', hasRealImg);
    $('#conv-edit-requireimg-note').toggleClass('d-none', !hasRealImg);

    _convEditModal().show();
}

// เติม dropdown หัวข้อบรรยาย (category[1]) จากหัวข้อจริงของวิชานี้
function _convEditPopulateCat1(currentCat1) {
    const subjId = (document.getElementById('subjID').value ||
        (document.getElementById('conv-edit-cat0').value.split('_')[0] || '')).trim();
    const allowed = (typeof getExistingCategoriesForSubject === 'function')
        ? getExistingCategoriesForSubject(subjId) : [];

    const $sel = $('#conv-edit-cat1-select').empty();
    $sel.append('<option value="">— ไม่ระบุ —</option>');
    const known = new Set();
    allowed.forEach(c => {
        const id = String(c.CategoryID);
        known.add(id);
        $sel.append(`<option value="${_convEsc(id)}">${_convEsc(c.CategoryName || id)} (${_convEsc(id)})</option>`);
    });
    // ค่าปัจจุบันที่ไม่อยู่ในรายการ — คงไว้ไม่ให้หาย
    const cur = String(currentCat1 || '').trim();
    if (cur && !known.has(cur)) {
        $sel.append(`<option value="${_convEsc(cur)}">${_convEsc(cur)} (ปัจจุบัน)</option>`);
    }
    $sel.append('<option value="__custom__">พิมพ์ CategoryID เอง…</option>');
    $sel.val(cur || '');
    $('#conv-edit-cat1-custom').addClass('d-none').val('');
}

function convEditCat1Changed() {
    const isCustom = document.getElementById('conv-edit-cat1-select').value === '__custom__';
    $('#conv-edit-cat1-custom').toggleClass('d-none', !isCustom);
    if (isCustom) document.getElementById('conv-edit-cat1-custom').focus();
}

// เพิ่มแถวตัวเลือก 1 แถว (radio = เป็นคำตอบที่ถูก, text = ข้อความตัวเลือก)
function convEditAddChoice(text, checked) {
    const $row = $(`
      <div class="conv-choice-row d-flex align-items-center gap-2 mb-2">
        <input type="radio" name="conv-edit-answer" class="form-check-input conv-choice-radio flex-shrink-0 mt-0" title="ตั้งเป็นคำตอบที่ถูก">
        <input type="text" class="form-control form-control-sm conv-choice-text" placeholder="ข้อความตัวเลือก">
        <button type="button" class="btn btn-sm btn-outline-danger flex-shrink-0" onclick="convEditRemoveChoice(this)" title="ลบตัวเลือก">
          <i class="fas fa-times"></i>
        </button>
      </div>`);
    $row.find('.conv-choice-text').val(text || '');   // .val() = ปลอดภัยกับอักขระพิเศษ
    if (checked) $row.find('.conv-choice-radio').prop('checked', true);
    $('#conv-edit-choices').append($row);
}

function convEditRemoveChoice(btn) {
    const $row = $(btn).closest('.conv-choice-row');
    const wasChecked = $row.find('.conv-choice-radio').is(':checked');
    $row.remove();
    // ถ้าลบช่องที่เป็นคำตอบไป ให้เลื่อนไปติ๊กช่องแรกที่ไม่ว่าง
    if (wasChecked && !$('#conv-edit-choices .conv-choice-radio:checked').length) {
        $('#conv-edit-choices .conv-choice-row').filter(function () {
            return $(this).find('.conv-choice-text').val().trim() !== '';
        }).first().find('.conv-choice-radio').prop('checked', true);
    }
}

// ตรวจ + เขียนกลับ converterStorage.ques[_convEditRow]
function saveConverterEdit() {
    if (_convEditRow == null) return;
    const row = converterStorage.ques[_convEditRow];
    if (!row) return;

    const problem = document.getElementById('conv-edit-problem').value.trim();
    if (!problem) { Swal.fire('ยังไม่ครบ', 'กรุณากรอกโจทย์', 'warning'); return; }

    // choices — เก็บช่องที่ไม่ว่าง, ห้ามมี /// ในตัวเลือกเดียว (กันคั่นข้อมูลเพี้ยน)
    const choices = [];
    let answer = '';
    let badSep = false;
    $('#conv-edit-choices .conv-choice-row').each(function () {
        const text = $(this).find('.conv-choice-text').val().trim();
        if (text === '') return;
        if (text.includes('///')) badSep = true;
        choices.push(text);
        if ($(this).find('.conv-choice-radio').is(':checked')) answer = text;
    });

    if (badSep) { Swal.fire('รูปแบบผิด', 'ห้ามมีเครื่องหมาย /// ภายในตัวเลือกเดียว (เป็นตัวคั่นข้อมูล)', 'error'); return; }
    if (choices.length < 2) { Swal.fire('ยังไม่ครบ', 'ต้องมีตัวเลือกอย่างน้อย 2 ตัว', 'warning'); return; }
    if (!answer) { Swal.fire('ยังไม่เลือกคำตอบ', 'กรุณาติ๊กวงกลมหน้าตัวเลือกที่เป็นคำตอบที่ถูก', 'warning'); return; }

    // category
    const cat0 = document.getElementById('conv-edit-cat0').value.trim();
    const selVal = document.getElementById('conv-edit-cat1-select').value;
    const cat1 = (selVal === '__custom__')
        ? document.getElementById('conv-edit-cat1-custom').value.trim()
        : selVal.trim();
    const cats = [cat0 || (choices[0] || ''), cat1 || cat0 || (choices[0] || '')];

    // require_img — แตะเฉพาะเมื่อ checkbox ใช้งานได้ (img ยังไม่มี URL จริง)
    if (!$('#conv-edit-requireimg').is(':disabled')) {
        row[2] = $('#conv-edit-requireimg').is(':checked') ? 'require_img' : '';
    }

    row[1] = problem;
    row[3] = choices.join('///');
    row[4] = answer;
    row[5] = document.getElementById('conv-edit-explain').value.trim();
    row[6] = JSON.stringify(cats);

    _convEditModal().hide();
    renderPreview();      // สถานะ EXISTING→UPDATED คำนวณใหม่ทันที
    saveCheckpoint();     // ให้การแก้รอด reload

    Swal.fire({ toast: true, icon: 'success', position: 'top-end', title: 'บันทึกการแก้ไขในตัวอย่างแล้ว', timer: 1800, showConfirmButton: false });
}

// ── helpers ──
let _convEditModalInst = null;
function _convEditModal() {
    if (!_convEditModalInst) _convEditModalInst = new bootstrap.Modal(document.getElementById('converterEditModal'));
    return _convEditModalInst;
}
function _convEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
