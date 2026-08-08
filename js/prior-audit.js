// ─────────────────────────────────────────────────────
// JS/PRIOR-AUDIT.JS — Prior Year Audit & Structural Checklist (Dashboard)
// เตือนแอดมินถ้าวิชาใดยังไม่มีข้อสอบ "รุ่นก่อนหน้า" (เลขรุ่นสอบฝังใน categoryId เช่น CVS_52FMT1)
// + เทียบกลุ่มข้อสอบ (MCQ1/MCQ2/FMT ฯลฯ) ระหว่างรุ่นล่าสุดกับรุ่นก่อนหน้า — ข้อมูลมาจาก GAS action=checkPriorYearAudit
// ─────────────────────────────────────────────────────

let priorAuditCache = null;
let priorAuditFetchedAt = 0;
const PRIOR_AUDIT_TTL_MS = 5 * 60 * 1000; // สอดคล้องกับ cache 30 นาทีฝั่ง backend — กันยิงซ้ำถี่เกินเวลาสลับเมนู

let _priorAuditSubjects = []; // subjects พร้อม meta (_status/_diffSets) คำนวณครั้งเดียวตอน render
let _priorAuditFilter = 'all'; // 'all' | 'missing' | 'shift' | 'matched'
let _priorAuditSearch = '';

const PRIOR_AUDIT_EXAM_TYPE_TOOLTIPS = {
    FMT: 'Formative Assessment',
    MCQ: 'Multiple Choice Question',
    LAB: 'Laboratory Exam',
    QUIZ: 'Quiz'
};

async function loadPriorYearAudit(force = false) {
    if (!force && priorAuditCache && (Date.now() - priorAuditFetchedAt < PRIOR_AUDIT_TTL_MS)) {
        renderPriorYearAudit(priorAuditCache);
        return;
    }

    $('#prior-audit-summary').html('<div class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>กำลังตรวจสอบ...</div>');
    $('#prior-audit-body').html('');

    try {
        const res = await fetchGAS(() => `${APPSCRIPT_URL}?action=checkPriorYearAudit&_=${Date.now()}`);
        if (!res || res.status !== 'success') throw new Error((res && res.message) || 'โหลดข้อมูลตรวจสอบล้มเหลว');
        priorAuditCache = res;
        priorAuditFetchedAt = Date.now();
        renderPriorYearAudit(res);
    } catch (e) {
        console.error('[prior-audit] load failed:', e);
        $('#prior-audit-summary').html(`<div class="alert alert-danger mb-0 w-100">โหลดข้อมูลตรวจสอบไม่สำเร็จ: ${e.message}</div>`);
        $('#prior-audit-body').html('<tr><td colspan="6" class="text-center text-danger py-4">โหลดข้อมูลไม่สำเร็จ</td></tr>');
    }
}

// เติม _status ('missing'/'shift'/'matched') และ diff sets ให้แต่ละวิชา ครั้งเดียวตอนโหลดข้อมูล
function _computePriorAuditMeta(s) {
    const diff = s.structuralDiff || { onlyInLatest: [], onlyInPrior: [], matched: [] };
    const onlyLatestSet = new Set(diff.onlyInLatest || []);
    const onlyPriorSet = new Set(diff.onlyInPrior || []);
    const matchedSet = new Set(diff.matched || []);
    const hasShift = onlyLatestSet.size > 0 || onlyPriorSet.size > 0;

    s._diff = diff;
    s._onlyLatestSet = onlyLatestSet;
    s._onlyPriorSet = onlyPriorSet;
    s._matchedSet = matchedSet;
    s._status = !s.priorYearExists ? 'missing' : (hasShift ? 'shift' : 'matched');
    return s;
}

function renderPriorYearAudit(res) {
    _priorAuditSubjects = (res.subjects || []).map(_computePriorAuditMeta);
    renderPriorAuditSummary();
    renderPriorAuditTable();
}

function renderPriorAuditSummary() {
    const subjects = _priorAuditSubjects;
    if (subjects.length === 0) {
        $('#prior-audit-summary').html('<div class="alert alert-secondary mb-0 w-100">ไม่พบวิชาที่มีรหัสรุ่นสอบ (เช่น _52MCQ1) ให้ตรวจสอบ</div>');
        return;
    }

    const missing = subjects.filter(s => s._status === 'missing');
    const shift = subjects.filter(s => s._status === 'shift');
    const matched = subjects.filter(s => s._status === 'matched');

    const statCard = (icon, gradientClass, label, count, extraHtml = '') => `
        <div class="col-6 col-md-3">
            <div class="d-flex align-items-start gap-2 p-2 rounded h-100" style="background:#f8f9fc;">
                <div class="stat-icon ${gradientClass}" style="width:36px;height:36px;font-size:1rem;flex-shrink:0;"><i class="fas ${icon}"></i></div>
                <div class="flex-grow-1 min-width-0">
                    <div class="small text-muted">${label}</div>
                    <div class="h5 mb-0 fw-bold">${count}</div>
                    ${extraHtml}
                </div>
            </div>
        </div>`;

    const missingTags = missing.map(s =>
        `<span class="badge bg-danger-subtle text-danger border border-danger-subtle rounded-pill px-2 py-1 me-1 mb-1 prior-audit-tag" onclick="scrollToPriorAuditRow('${_convEsc(s.subjectId)}')" title="${_convEsc(s.subjectName)} — คลิกเพื่อดูแถว">[${_convEsc(s.subjectId)}]</span>`
    ).join('');

    const html = statCard('fa-list', 'bg-gradient-primary', 'ทั้งหมด', subjects.length) +
        statCard('fa-exclamation-triangle', 'bg-gradient-danger', 'ขาดรุ่นก่อนหน้า', missing.length,
            missing.length > 0 ? `<div class="mt-1 d-flex flex-wrap">${missingTags}</div>` : '') +
        statCard('fa-random', 'bg-gradient-warning', 'รูปแบบเปลี่ยน', shift.length) +
        statCard('fa-check-circle', 'bg-gradient-success', 'ตรงกัน', matched.length);

    $('#prior-audit-summary').html(html);
}

function setPriorAuditFilter(filter, btnEl) {
    _priorAuditFilter = filter;
    if (btnEl && btnEl.parentElement) {
        Array.from(btnEl.parentElement.children).forEach(b => b.classList.remove('active'));
        btnEl.classList.add('active');
    }
    renderPriorAuditTable();
}

function setPriorAuditSearch(value) {
    _priorAuditSearch = String(value || '').trim().toLowerCase();
    renderPriorAuditTable();
}

// เลื่อนไปแถวของวิชา + ไฮไลต์ชั่วคราว — รีเซ็ต filter/search ก่อนถ้าแถวนั้นถูกซ่อนอยู่
function scrollToPriorAuditRow(subjectId) {
    _priorAuditFilter = 'all';
    _priorAuditSearch = '';
    const searchInput = document.getElementById('prior-audit-search');
    if (searchInput) searchInput.value = '';
    const tabs = document.querySelectorAll('#prior-audit-body') && document.querySelector('.btn-group.btn-group-sm');
    if (tabs) {
        Array.from(tabs.children).forEach(b => b.classList.remove('active'));
        const allBtn = tabs.querySelector('[onclick*="\'all\'"]');
        if (allBtn) allBtn.classList.add('active');
    }
    renderPriorAuditTable();

    const row = document.getElementById(`prior-audit-row-${subjectId}`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('prior-audit-row-highlight');
    void row.offsetWidth; // force reflow เพื่อ retrigger animation ถ้าเคยไฮไลต์มาก่อน
    row.classList.add('prior-audit-row-highlight');
    setTimeout(() => row.classList.remove('prior-audit-row-highlight'), 1700);
}

function _priorAuditExamTypeTooltip(g) {
    const m = String(g).match(/FMT|MCQ|LAB|QUIZ/i);
    return m ? PRIOR_AUDIT_EXAM_TYPE_TOOLTIPS[m[0].toUpperCase()] : '';
}

// Badge chip: เขียว=matched, ฟ้า=ใหม่ในรุ่นล่าสุด, แดง=ขาดหาย — พร้อม tooltip อธิบายชื่อย่อ
function _priorAuditBadge(g, role, s) {
    const isMatched = s._matchedSet.has(g);
    const isOnlyLatest = s._onlyLatestSet.has(g);
    const isOnlyPrior = s._onlyPriorSet.has(g);
    let cls = 'bg-light text-dark border-light';
    if (isMatched) cls = 'bg-success-subtle text-success border-success-subtle';
    else if (role === 'latest' && isOnlyLatest) cls = 'bg-info-subtle text-info border-info-subtle';
    else if (role === 'prior' && isOnlyPrior) cls = 'bg-danger-subtle text-danger border-danger-subtle';
    const tip = _priorAuditExamTypeTooltip(g);
    return `<span class="badge ${cls} border rounded-pill px-2 py-1 me-1 mb-1"${tip ? ` title="${_convEsc(tip)}"` : ''}>${_convEsc(String(g))}</span>`;
}

function _priorAuditStatusBadge(s) {
    if (s._status === 'missing') return '<span class="badge bg-danger-subtle text-danger border border-danger-subtle rounded-pill px-3">ขาดรุ่นก่อนหน้า</span>';
    if (s._status === 'shift') return '<span class="badge bg-warning-subtle text-warning border border-warning-subtle rounded-pill px-3 text-dark">รูปแบบต่างจากรุ่นก่อน</span>';
    return '<span class="badge bg-success-subtle text-success border border-success-subtle rounded-pill px-3">ตรงกัน</span>';
}

// ปุ่มดำเนินการรวมไว้คอลัมน์เดียว — นำเข้ารุ่นก่อนหน้าที่ขาด หรือแปลงกลุ่มข้อสอบที่หายไปในรุ่นล่าสุด
function _priorAuditActions(s) {
    if (s._status === 'missing') {
        return `<button class="btn btn-sm btn-outline-danger" onclick="goToConverterWithPrefill('${_convEsc(s.subjectId)}','${_convEsc(String(s.priorYear))}','')">
            <i class="fas fa-plus me-1"></i>Import Year ${_convEsc(String(s.priorYear))}</button>`;
    }
    if (s._diff.onlyInPrior && s._diff.onlyInPrior.length > 0) {
        return s._diff.onlyInPrior.map(g =>
            `<button class="btn btn-sm btn-outline-primary mb-1 me-1" onclick="goToConverterWithPrefill('${_convEsc(s.subjectId)}','${_convEsc(String(s.latestYear))}','${_convEsc(String(g))}')">Convert ${_convEsc(String(g))}</button>`
        ).join('');
    }
    return '<span class="text-muted small">-</span>';
}

function renderPriorAuditTable() {
    const subjects = _priorAuditSubjects;
    if (subjects.length === 0) {
        $('#prior-audit-body').html('<tr><td colspan="6" class="text-center text-muted py-4">-</td></tr>');
        return;
    }

    const filtered = subjects.filter(s => {
        if (_priorAuditFilter !== 'all' && s._status !== _priorAuditFilter) return false;
        if (_priorAuditSearch) {
            const haystack = `${s.subjectId} ${s.subjectName}`.toLowerCase();
            if (!haystack.includes(_priorAuditSearch)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        $('#prior-audit-body').html('<tr><td colspan="6" class="text-center text-muted py-4">ไม่พบวิชาที่ตรงกับตัวกรอง</td></tr>');
        return;
    }

    const rows = filtered.map(s => {
        const latestBadges = (s.latestGroups || []).map(g => _priorAuditBadge(g, 'latest', s)).join('');
        const priorBadges = (s.priorGroups || []).map(g => _priorAuditBadge(g, 'prior', s)).join('');

        return `<tr id="prior-audit-row-${_convEsc(s.subjectId)}">
            <td><strong>${_convEsc(s.subjectName)}</strong><br><span class="small text-muted">${_convEsc(s.subjectId)}</span></td>
            <td>
              <span class="badge bg-primary-subtle text-primary border border-primary-subtle rounded-pill px-2 py-1 me-1 mb-1">รุ่น ${_convEsc(String(s.latestYear))}</span>
              ${latestBadges}
            </td>
            <td>
              ${s.priorYearExists
                ? `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle rounded-pill px-2 py-1 me-1 mb-1">รุ่น ${_convEsc(String(s.priorYear))}</span>${priorBadges}`
                : `<span class="badge bg-danger-subtle text-danger border border-danger-subtle rounded-pill px-2 py-1">ไม่พบรุ่น ${_convEsc(String(s.priorYear))}</span>`
              }
            </td>
            <td class="small text-muted">${_convEsc((s.years || []).join(', '))}</td>
            <td class="text-center">${_priorAuditStatusBadge(s)}</td>
            <td class="text-end">${_priorAuditActions(s)}</td>
        </tr>`;
    }).join('');

    $('#prior-audit-body').html(rows);
}

// Prefill converter and jump to PDF dropzone for a missing group
// พารามิเตอร์ `batch` = รุ่นข้อสอบ 2 หลัก (latestYear/priorYear ของ backend มาจากเลขใน categoryId เช่น CVS_52MCQ1)
//   — ไม่ใช่ชั้นปี! ชั้นปีต้องหาจาก globalData.structure ด้วย subjectId
// `missingGroup` มาจาก structuralDiff ซึ่งตัดเลขรุ่นออกแล้ว เช่น "MCQ2" → ชิป MCQ + ครั้งที่ 2
function goToConverterWithPrefill(subjectId, batch, missingGroup) {
    try {
        // open converter section
        if (typeof showSection === 'function') showSection('converter');

        // ชั้นปี + ชื่อวิชา จากทะเบียนโครงสร้าง (แถวแรกที่ SubjectID ตรง)
        const structRow = (typeof globalData === 'object' && Array.isArray(globalData.structure))
            ? globalData.structure.find(s => String(s.SubjectID).trim() === String(subjectId).trim())
            : null;
        const curriculumYear = structRow ? String(structRow.Year).trim() : '';
        const subjName = structRow ? String(structRow.SubjectName || '') : '';
        // ไม่มีแถวใน Structure = เติมชั้นปี/ชื่อวิชาให้ไม่ได้ — ต้องบอก ไม่ใช่เติมครึ่งๆ เงียบๆ
        if (!structRow) {
            Swal.fire({
                toast: true, icon: 'warning', position: 'top-end',
                title: `ไม่พบวิชา ${subjectId} ในทะเบียนโครงสร้าง — กรุณาเลือกชั้นปี/วิชาเอง`,
                timer: 5000, showConfirmButton: false
            });
        }

        // ตั้งชั้นปี → onConvYearChange เติม options ของวิชาแบบ synchronous (ไม่ต้องหน่วงเวลา)
        const yearSel = document.getElementById('conv-year-select');
        if (yearSel && curriculumYear) {
            yearSel.value = curriculumYear;
            try { onConvYearChange(curriculumYear); } catch (e) { /* non-fatal */ }
        }

        const subjSel = document.getElementById('conv-subject-select');
        if (subjSel) {
            for (let i = 0; i < subjSel.options.length; i++) {
                if (subjSel.options[i].value === subjectId) { subjSel.selectedIndex = i; break; }
            }
        }
        // เขียน mirror ครั้งเดียวจากค่าที่หาได้จริง — ไม่เรียก onConvSubjectChange
        // (ถ้าหาวิชาใน dropdown ไม่เจอ มันจะถูกเรียกด้วยค่าว่างแล้วล้าง #yearVal/#subjID/#subjName ทิ้ง)
        try { setConvSubjectMirror(curriculumYear, subjectId, subjName); } catch (e) { /* ignore */ }

        // รุ่น/ปีข้อสอบ เช่น "52"
        const batchEl = document.getElementById('conv-group-batch');
        if (batchEl) batchEl.value = String(batch).slice(-2);

        // กลุ่มข้อสอบ: แยก "MCQ2" → ประเภท MCQ + ครั้งที่ 2 ให้ตรงกับชิป/ช่องครั้งที่ใน UI
        const groupRaw = String(missingGroup || '').trim().toUpperCase();
        const roundEl = document.getElementById('conv-group-round');
        const gm = groupRaw.match(/^([A-Z]+)(\d*)$/);
        const chip = gm ? document.querySelector(`#conv-group-picker .conv-chip[data-group="${gm[1]}"]`) : null;
        // ครั้งที่ต้องมีใน dropdown จริง ไม่งั้นเลขจะหายไปจาก categoryId → ตกไปใช้ช่องพิมพ์เองแทน
        const roundOk = gm && (!gm[2] || (roundEl && [...roundEl.options].some(o => o.value === gm[2])));
        if (chip && roundOk) {
            chip.classList.remove('active'); // pickConvGroup toggle ปิดถ้าชิป active อยู่แล้ว (prefill ซ้ำ)
            try { pickConvGroup(chip); } catch (e) { chip.classList.add('active'); _convGroupType = gm[1]; }
            if (roundEl) roundEl.value = gm[2] || '';
        } else if (groupRaw) {
            // ไม่มีชิปตรง (หรือครั้งที่เกินตัวเลือก) → ใช้ช่องพิมพ์เอง
            document.querySelectorAll('#conv-group-picker .conv-chip').forEach(b => b.classList.remove('active', 'suggested'));
            const customChip = document.querySelector('#conv-group-picker .conv-chip[data-group="__custom__"]');
            if (customChip) customChip.classList.add('active');
            const custom = document.getElementById('conv-group-custom');
            if (custom) { custom.classList.remove('d-none'); custom.value = groupRaw; }
            _convGroupType = '__custom__';
            if (roundEl) roundEl.value = '';
        }

        try { updateConvGroupReadout(); } catch (e) { /* best effort */ }

        const drop = document.getElementById('pdf-drop-zone');
        if (drop) drop.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
        console.warn('goToConverterWithPrefill failed', err);
    }
}
