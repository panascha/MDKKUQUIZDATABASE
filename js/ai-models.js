// ─────────────────────────────────────────────────────
// AI Models registry panel (Phase 2 step 4; split out of admin-tools.js, M6 polish)
// อ่าน getAIModels (public GET) → ตาราง; ตั้ง RPD/Priority → setModelRpd (DEVELOPER POST, auth เหมือน runBatchAction)
// RPD = human go-live gate (Q1/Q5): Active แต่ RPD ว่าง/0 = ยังไม่ขึ้นใช้จริง → ต้องจัดการ
// โหลดหลัง admin-tools.js, ก่อน app.js (ui.js เรียก renderAiModelsPanel / refreshAiModelsBadge ตอน runtime)
// ─────────────────────────────────────────────────────

let aiModelsData = [];
let aiModelsTab = 'active';                 // 'active' | 'attention' | 'inactive'
let aiModelsQueue = Promise.resolve();      // คิวบันทึกทีละแถว (sequential)

const AI_MODELS_COLS = 5;

function aiModelIsActive(m) { return String(m.status).trim() === 'Active'; }

// needs-RPD: Active แต่ RPD ว่าง/0 (Number("") === 0 ครอบทั้งค่าว่างและ 0)
function aiModelNeedsRpd(m) {
    return aiModelIsActive(m) && (String(m.rpd).trim() === '' || Number(m.rpd) === 0);
}
// needs-priority: ranker เจอ ID ที่ parse ไม่ได้ → ฝาก token ไว้ใน Notes (สัญญา cross-step, ห้ามเพี้ยน)
// นับเฉพาะ Active — แถว Deprecated/Disabled ไม่ต้องดันตัวเลข badge ค้างตลอด
function aiModelNeedsPriority(m) {
    return aiModelIsActive(m) && String(m.notes || '').includes('needs-manual-priority');
}
function aiModelNeedsAttention(m) {
    return aiModelNeedsRpd(m) || aiModelNeedsPriority(m);
}

// ranker ฝั่ง backend (_parseGeminiRank_) parse id นี้ได้ → มันเขียน Priority ทับเสมอ → ล็อก input
function aiModelPriorityLocked(id) {
    return /^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash|pro)(?:-.*)?$/i.test(String(id || ''));
}

// จัดชนิด Notes → badge สั้น (full text อยู่ใน popover). คืน null ถ้าไม่เข้าชนิดใด
function aiModelNoteKind(m) {
    const notes = String(m.notes || '');
    if (/tool-incapable/i.test(notes)) return { label: 'Tool-incapable', cls: 'bg-danger' };
    if (String(m.status).trim() === 'Deprecated' || /deprecat|no longer|not found|404/i.test(notes)) return { label: 'Deprecated', cls: 'bg-secondary' };
    if (/quota|429|exhaust|rate.?limit|free tier|RPD\s*=/i.test(notes)) return { label: 'Quota', cls: 'bg-warning text-dark' };
    return null;
}

// Deprecated ไปท้ายสุด; ที่เหลือคงลำดับชีต (Array.sort เสถียร)
function aiModelsSorted(models) {
    const rank = m => (String(m.status).trim() === 'Deprecated' ? 1 : 0);
    return models.slice().sort((a, b) => rank(a) - rank(b));
}

function aiModelsForTab(models, tab) {
    const rows = models.filter(m =>
        tab === 'attention' ? aiModelNeedsAttention(m)
            : tab === 'inactive' ? !aiModelIsActive(m)
                : aiModelIsActive(m));
    return aiModelsSorted(rows);
}

// เทียบ input กับค่าที่โหลด/บันทึกล่าสุด → คืนเฉพาะ field ที่เปลี่ยนจริง (rpd ที่ไม่เปลี่ยนห้ามส่ง:
// backend setModelRpd refill _Remaining เต็มทุกครั้งที่ payload มี rpd). ค่าว่าง = ไม่แก้ (backend ลบค่าไม่ได้)
// คืน { fields:{rpd?,priority?} } หรือ { error } ถ้า format ผิด
function aiModelChangedFields(m, rpdRaw, prioRaw, prioLocked) {
    const fields = {};
    const rpd = String(rpdRaw).trim(), prio = String(prioRaw).trim();
    const curRpd = (m.rpd === 0 || m.rpd) ? String(m.rpd).trim() : '';
    const curPrio = (m.priority === 0 || m.priority) ? String(m.priority).trim() : '';
    if (rpd !== '') {
        if (!/^\d+$/.test(rpd)) return { error: 'RPD ต้องเป็นจำนวนเต็มไม่ติดลบ' };
        if (parseInt(rpd, 10) !== Number(curRpd) || curRpd === '') fields.rpd = parseInt(rpd, 10);
    }
    if (!prioLocked && prio !== '') {
        if (!/^-?\d+$/.test(prio)) return { error: 'Priority ต้องเป็นจำนวนเต็ม' };
        if (parseInt(prio, 10) !== Number(curPrio) || curPrio === '') fields.priority = parseInt(prio, 10);
    }
    return { fields };
}

function aiModelsCount(tab) { return aiModelsForTab(aiModelsData, tab).length; }

function updateAiModelsBadge(models) {
    const n = (models || []).filter(aiModelNeedsAttention).length;
    $('#sidebar-ai-models-count').text(n).toggle(n > 0);
}

function aiModelsStatus(html) { $('#ai-models-status').html(html); }

function aiModelsToast(icon, title) {
    Swal.fire({ icon: icon, title: title, toast: true, position: 'top-end', showConfirmButton: false, timer: 2500 });
}

// fetch เดียว (fetchGAS จัดการ retry + HTML-instead-of-JSON เอง) → เก็บ cache + อัปเดต badge
async function fetchAIModels() {
    await initialSyncReady; // app.js — ไม่ยิงซ้อนกับ data sync รอบแรกตอนเปิดหน้า
    const data = await fetchGAS(`${APPSCRIPT_URL}?action=getAIModels`);
    if (!data || data.result !== 'success' || !Array.isArray(data.models)) {
        throw new Error(data && data.message ? data.message : 'getAIModels: bad response');
    }
    aiModelsData = data.models;
    updateAiModelsBadge(aiModelsData);
    return aiModelsData;
}

// เรียกตอนกลายเป็นแอดมิน (updateAuthUI) — เติม badge โดยไม่ต้องเปิดพาเนล (badge = การแจ้งเตือน P2-Q6)
async function refreshAiModelsBadge() {
    try { await fetchAIModels(); }
    catch (e) { console.warn('[ai-models] badge refresh failed:', e.message); }
}

function aiModelFlagsHtml(m) {
    const flags = [];
    if (aiModelNeedsRpd(m)) flags.push('<span class="badge bg-danger ms-1">needs RPD</span>');
    if (aiModelNeedsPriority(m)) flags.push('<span class="badge bg-warning text-dark ms-1">needs priority</span>');
    return flags.join('');
}

function aiModelNotesHtml(m) {
    const notes = String(m.notes || '');
    const kind = aiModelNoteKind(m);
    if (!kind) return escapeHtml(notes);
    return `<span class="badge ${kind.cls} ai-model-note-badge" role="button" tabindex="0" data-bs-toggle="popover" data-bs-trigger="focus" data-bs-placement="left" data-bs-content="${escapeHtml(notes)}" title="${escapeHtml(notes)}">${kind.label}</span>`;
}

function renderAiModelsTabs() {
    const tabs = [['active', 'Active'], ['attention', 'Needs attention'], ['inactive', 'Deprecated / Disabled']];
    $('#ai-models-tabs').html(tabs.map(([k, label]) =>
        `<li class="nav-item"><a href="#" class="nav-link ${k === aiModelsTab ? 'active' : ''}" data-tab="${k}">${label} <span class="badge ${k === 'attention' && aiModelsCount(k) > 0 ? 'bg-warning text-dark' : 'bg-secondary'} ms-1">${aiModelsCount(k)}</span></a></li>`
    ).join(''));
}

function renderAiModelsTable() {
    renderAiModelsTabs();
    const tb = $('#ai-models-tbody');
    const rows = aiModelsForTab(aiModelsData, aiModelsTab);
    if (!rows.length) {
        tb.html(`<tr><td colspan="${AI_MODELS_COLS}" class="text-center text-muted py-4">ไม่มีโมเดลในหมวดนี้</td></tr>`);
        return;
    }
    let html = '';
    rows.forEach(m => {
        // rpd/priority เป็นตัวเลขหรือ "" — อย่าส่งเข้า escapeHtml (มันเรียก .replace, พังกับ number); String() ก่อน
        const rpdVal = (m.rpd === 0 || m.rpd) ? String(m.rpd) : '';
        const prioVal = (m.priority === 0 || m.priority) ? String(m.priority) : '';
        const locked = aiModelPriorityLocked(m.model);
        html += `<tr class="${aiModelNeedsAttention(m) ? 'table-warning' : ''}" data-model="${escapeHtml(String(m.model))}">
            <td class="fw-bold" data-label="Model">${escapeHtml(String(m.model))} <span class="ai-model-flags">${aiModelFlagsHtml(m)}</span></td>
            <td data-label="RPD Limit"><input type="number" min="0" step="1" class="form-control form-control-sm ai-model-rpd" value="${escapeHtml(rpdVal)}"></td>
            <td data-label="Priority"><input type="number" step="1" class="form-control form-control-sm ai-model-prio" value="${escapeHtml(prioVal)}"${locked ? ' disabled title="จัดลำดับอัตโนมัติโดย ranker"' : ''}></td>
            <td data-label="Status">${escapeHtml(String(m.status))}</td>
            <td class="small text-muted" data-label="Notes">${aiModelNotesHtml(m)}</td>
        </tr>`;
    });
    tb.html(html);
    if (typeof bootstrap !== 'undefined' && bootstrap.Popover) {
        tb.find('[data-bs-toggle="popover"]').each(function () { new bootstrap.Popover(this); });
    }
}

function aiModelsSummaryStatus() {
    const n = aiModelsData.filter(aiModelNeedsAttention).length;
    aiModelsStatus(n > 0
        ? `<span class="text-warning"><i class="fas fa-exclamation-triangle"></i> ${n} โมเดลต้องจัดการ (ตั้ง RPD / Priority)</span>`
        : '<span class="text-success"><i class="fas fa-check-circle"></i> ทุกโมเดลเรียบร้อย</span>');
}

// เปิดพาเนล / กดรีเฟรช — โหลดสด + วาดตาราง
async function renderAiModelsPanel() {
    aiModelsStatus('<span class="text-muted"><i class="fas fa-spinner fa-spin"></i> กำลังโหลดทะเบียนโมเดล…</span>');
    $('#ai-models-refresh-btn').prop('disabled', true);
    try {
        await fetchAIModels();
        renderAiModelsTable();
        aiModelsSummaryStatus();
    } catch (e) {
        aiModelsStatus(`<span class="text-danger"><i class="fas fa-times-circle"></i> โหลดไม่สำเร็จ: ${escapeHtml(String(e.message))}</span>`);
        $('#ai-models-tbody').html(`<tr><td colspan="${AI_MODELS_COLS}" class="text-center text-danger py-4">โหลดข้อมูลไม่ได้</td></tr>`);
    } finally {
        $('#ai-models-refresh-btn').prop('disabled', false);
    }
}

// POST เดียว ไม่ retry (setModelRpd refill _Remaining — retry จะ refill ซ้ำ) — auth triple เหมือน runBatchAction
// ข้อความ error 'forbidden' ต้องแยกจาก session_expired/token_expired: fetch ตรงนี้ไม่ผ่าน sendWithRetry จึงไม่ logout
async function postSetModelRpd(model, fields) {
    const payload = Object.assign({
        action: 'setModelRpd', model: model,
        username: currentUser.username, adminPass: adminPass,
        sessionToken: (typeof sessionToken === 'string' && sessionToken) || undefined
    }, fields);
    const resp = await fetch(APPSCRIPT_URL, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    });
    return resp.json();
}

function aiModelErrorText(data) {
    const msg = String((data && data.message) || JSON.stringify(data));
    if (msg === 'forbidden') return 'ไม่มีสิทธิ์ (เฉพาะ DEVELOPER)';
    if (msg === 'session_expired' || msg === 'token_expired') return 'เซสชันหมดอายุ — ล็อกอินใหม่แล้วลองอีกครั้ง';
    return msg;
}

// auto-save หนึ่งแถว — รันใน queue; คำนวณ diff ตอนรันจริงเทียบค่าล่าสุดใน aiModelsData (change+Enter ซ้ำ = no-op)
async function saveAiModelRow($tr) {
    const model = String($tr.attr('data-model'));
    const m = aiModelsData.find(x => String(x.model) === model);
    if (!m) return;
    const $rpd = $tr.find('.ai-model-rpd'), $prio = $tr.find('.ai-model-prio');
    const diff = aiModelChangedFields(m, $rpd.val(), $prio.val(), $prio.prop('disabled'));
    const revert = () => {
        $rpd.val((m.rpd === 0 || m.rpd) ? String(m.rpd) : '');
        $prio.val((m.priority === 0 || m.priority) ? String(m.priority) : '');
    };
    if (diff.error) { revert(); aiModelsToast('error', diff.error); return; }
    if (!Object.keys(diff.fields).length) return;   // ไม่เปลี่ยน → ไม่ยิง request
    if (!confirmAdmin()) { revert(); return; }

    $tr.find('input').prop('disabled', true);
    try {
        const data = await postSetModelRpd(model, diff.fields);
        if (data.result === 'success') {
            if ('rpd' in diff.fields) m.rpd = diff.fields.rpd;
            if ('priority' in diff.fields) m.priority = diff.fields.priority;
            $tr.toggleClass('table-warning', aiModelNeedsAttention(m));
            $tr.find('.ai-model-flags').html(aiModelFlagsHtml(m));
            updateAiModelsBadge(aiModelsData);
            renderAiModelsTabs();
            aiModelsSummaryStatus();
            const bk = data.backfilledKeys ? ` (backfill ${data.backfilledKeys} keys)` : '';
            aiModelsToast('success', `บันทึก ${model} แล้ว${bk}`);
        } else {
            revert();
            aiModelsToast('error', `${model}: ${aiModelErrorText(data)}`);
        }
    } catch (e) {
        revert();
        aiModelsToast('error', `${model}: ${e.message}`);
    } finally {
        $tr.find('.ai-model-rpd').prop('disabled', false);
        $tr.find('.ai-model-prio').prop('disabled', aiModelPriorityLocked(model));
    }
}

function queueAiModelSave($tr) {
    aiModelsQueue = aiModelsQueue.then(() => saveAiModelRow($tr)).catch(e => console.warn('[ai-models] save queue:', e));
    return aiModelsQueue;
}

if (typeof $ === 'function' && typeof document !== 'undefined') {
    $(document).on('change', '#ai-models-tbody .ai-model-rpd, #ai-models-tbody .ai-model-prio', function () {
        queueAiModelSave($(this).closest('tr'));
    });
    $(document).on('keydown', '#ai-models-tbody .ai-model-rpd, #ai-models-tbody .ai-model-prio', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); queueAiModelSave($(this).closest('tr')); }
    });
    $(document).on('click', '#ai-models-tabs [data-tab]', function (e) {
        e.preventDefault();
        aiModelsTab = $(this).attr('data-tab');
        renderAiModelsTable();
    });
}
