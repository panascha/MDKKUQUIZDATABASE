// ─────────────────────────────────────────────────────
// JS/ADMIN-TOOLS.JS — AI Generate panel (run*BatchManual)
// ─────────────────────────────────────────────────────

const AI_GEN_ACTIONS = {
    runRelationsBatchManual: { label: 'Related Questions', llm: false, fields: ['relationRows'] },
    runGlossaryBatchManual: { label: 'Glossary', llm: true, fields: ['termsWritten'] },
    runHighYieldBatchManual: { label: 'High-Yield Cram Sheet', llm: true, fields: ['categoriesWritten'] },
    runKeywordIndexBatchManual: { label: 'Keyword Index', llm: false, fields: ['categoriesProcessed', 'rowsWritten'] }
};

// เกิน ~800 ข้อเสี่ยงชน admin lock 25s + GAS 6-min limit → ต้องใช้ nightly batch แทน
const AI_GEN_MAX_QUESTIONS = 800;

let aiGenBusy = false;
let aiGenTimerId = null;

// นับจำนวนข้อต่อวิชา: q.category (array ของ categoryId) → category.SubjectRef
function aiGenSubjectCounts() {
    const catToSubj = {};
    (globalData.category || []).forEach(c => { catToSubj[c.CategoryID] = c.SubjectRef; });
    const counts = {};
    (globalData.questions || []).forEach(q => {
        const cats = Array.isArray(q.category) ? q.category : [];
        const subjSet = new Set(cats.map(id => catToSubj[id]).filter(Boolean));
        subjSet.forEach(s => counts[s] = (counts[s] || 0) + 1);
    });
    return counts;
}

function renderAiGeneratePanel() {
    const counts = aiGenSubjectCounts();
    const subjects = [...new Set((globalData.structure || []).map(s => s.SubjectID))].sort();
    const sel = $('#ai-gen-subject');
    const prev = sel.val();
    let opts = '<option value="">-- เลือกวิชา --</option>';
    subjects.forEach(s => {
        const n = counts[s] || 0;
        opts += `<option value="${s}" data-count="${n}">${s} (${n} ข้อ)</option>`;
    });
    sel.html(opts);
    if (prev && subjects.includes(prev)) sel.val(prev);

    renderCatAiPanel(); // categorizer.js — card แยกหัวข้อเลคเชอร์ในหน้าเดียวกัน
}

function aiGenSetBusy(busy) {
    aiGenBusy = busy;
    $('#sec-ai-generate .ai-gen-btn').prop('disabled', busy);
    $('#ai-gen-subject').prop('disabled', busy);
}

function aiGenStatus(html) { $('#ai-gen-status').html(html); }

async function runBatchAction(action) {
    if (aiGenBusy) return;
    if (!confirmAdmin()) return;

    const cfg = AI_GEN_ACTIONS[action];
    const sel = $('#ai-gen-subject');
    const subject = sel.val();
    if (!subject) {
        Swal.fire('เลือกวิชาก่อน', 'กรุณาเลือกวิชาที่จะ generate', 'warning');
        return;
    }
    const count = parseInt(sel.find(':selected').attr('data-count'), 10) || 0;

    if (count > AI_GEN_MAX_QUESTIONS) {
        Swal.fire('วิชาใหญ่เกินไป',
            `${subject} มี ${count} ข้อ (เกิน ${AI_GEN_MAX_QUESTIONS}) — เสี่ยงชน GAS 6-min limit ต้องใช้ nightly batch แทน`,
            'error');
        return;
    }

    if (cfg.llm) {
        const res = await Swal.fire({
            title: `ยืนยัน generate: ${cfg.label}?`,
            html: `วิชา <b>${subject}</b> (${count} ข้อ)<br>ใช้ LLM จริง — เสียโควตา และอาจใช้เวลาหลายนาที`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'รันเลย',
            cancelButtonText: 'ยกเลิก'
        });
        if (!res.isConfirmed) return;
    }

    aiGenSetBusy(true);
    const t0 = Date.now();
    aiGenStatus(`<span class="text-primary"><i class="fas fa-spinner fa-spin"></i> กำลังรัน ${cfg.label} (${subject})… <span id="ai-gen-elapsed">0s</span></span>`);
    aiGenTimerId = setInterval(() => {
        $('#ai-gen-elapsed').text(Math.floor((Date.now() - t0) / 1000) + 's');
    }, 1000);

    try {
        // fetch เดียว ไม่ retry (retry จะยิง generation ซ้ำ = เปลืองโควตา LLM + ต่อคิว lock)
        const resp = await fetch(APPSCRIPT_URL, {
            method: 'POST',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: action, subject: subject, username: currentUser.username, adminPass: adminPass, sessionToken: (typeof sessionToken === 'string' && sessionToken) || undefined })
        });
        const data = await resp.json();
        const secs = Math.floor((Date.now() - t0) / 1000);
        if (data.result === 'success') {
            const detail = cfg.fields.map(f => `${f}: ${data[f] !== undefined ? data[f] : '-'}`).join(', ');
            aiGenStatus(`<span class="text-success"><i class="fas fa-check-circle"></i> ${cfg.label} (${subject}) สำเร็จใน ${secs}s — ${detail}</span>`);
        } else {
            aiGenStatus(`<span class="text-danger"><i class="fas fa-times-circle"></i> ${cfg.label} (${subject}) ล้มเหลวใน ${secs}s — ${data.message || JSON.stringify(data)}</span>`);
        }
    } catch (e) {
        aiGenStatus(`<span class="text-danger"><i class="fas fa-times-circle"></i> ${cfg.label} (${subject}) error: ${e.message}</span>`);
    } finally {
        clearInterval(aiGenTimerId);
        aiGenSetBusy(false);
    }
}

// ─────────────────────────────────────────────────────
// AI Models registry panel (Phase 2 step 4)
// อ่าน getAIModels (public GET) → ตาราง; ตั้ง RPD/Priority → setModelRpd (admin POST, auth เหมือน runBatchAction)
// RPD = human go-live gate (Q1/Q5): Active แต่ RPD ว่าง/0 = ยังไม่ขึ้นใช้จริง → ต้องจัดการ
// ─────────────────────────────────────────────────────

let aiModelsData = [];
let aiModelsBusy = false;

// needs-RPD: Active แต่ RPD ว่าง/0 (Number("") === 0 ครอบทั้งค่าว่างและ 0)
function aiModelNeedsRpd(m) {
    return String(m.status).trim() === 'Active' && (String(m.rpd).trim() === '' || Number(m.rpd) === 0);
}
// needs-priority: ranker เจอ ID ที่ parse ไม่ได้ → ฝาก token ไว้ใน Notes (สัญญา cross-step, ห้ามเพี้ยน)
function aiModelNeedsPriority(m) {
    return String(m.notes || '').includes('needs-manual-priority');
}
function aiModelNeedsAttention(m) {
    return aiModelNeedsRpd(m) || aiModelNeedsPriority(m);
}

function updateAiModelsBadge(models) {
    const n = (models || []).filter(aiModelNeedsAttention).length;
    $('#sidebar-ai-models-count').text(n).toggle(n > 0);
}

function aiModelsStatus(html) { $('#ai-models-status').html(html); }

// fetch เดียว (fetchGAS จัดการ retry + HTML-instead-of-JSON เอง) → เก็บ cache + อัปเดต badge
async function fetchAIModels() {
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

function renderAiModelsTable() {
    const tb = $('#ai-models-tbody');
    if (!aiModelsData.length) {
        tb.html('<tr><td colspan="6" class="text-center text-muted py-4">ไม่มีข้อมูลโมเดล</td></tr>');
        return;
    }
    let html = '';
    aiModelsData.forEach(m => {
        const needAttn = aiModelNeedsAttention(m);
        const flags = [];
        if (aiModelNeedsRpd(m)) flags.push('<span class="badge bg-danger ms-1">needs RPD</span>');
        if (aiModelNeedsPriority(m)) flags.push('<span class="badge bg-warning text-dark ms-1">needs priority</span>');
        // rpd/priority เป็นตัวเลขหรือ "" — อย่าส่งเข้า escapeHtml (มันเรียก .replace, พังกับ number); String() ก่อน
        const rpdVal = (m.rpd === 0 || m.rpd) ? String(m.rpd) : '';
        const prioVal = (m.priority === 0 || m.priority) ? String(m.priority) : '';
        html += `<tr class="${needAttn ? 'table-warning' : ''}">
            <td class="fw-bold">${escapeHtml(String(m.model))} ${flags.join('')}</td>
            <td><input type="number" min="0" step="1" class="form-control form-control-sm ai-model-rpd" data-model="${escapeHtml(String(m.model))}" value="${escapeHtml(rpdVal)}"></td>
            <td><input type="number" step="1" class="form-control form-control-sm ai-model-prio" value="${escapeHtml(prioVal)}"></td>
            <td>${escapeHtml(String(m.status))}</td>
            <td class="small text-muted">${escapeHtml(String(m.notes || ''))}</td>
            <td><button class="btn btn-sm btn-primary ai-model-save-btn" onclick="saveModelRpd(this)"><i class="fas fa-save"></i></button></td>
        </tr>`;
    });
    tb.html(html);
}

// เปิดพาเนล / กดรีเฟรช — โหลดสด + วาดตาราง
async function renderAiModelsPanel() {
    aiModelsStatus('<span class="text-muted"><i class="fas fa-spinner fa-spin"></i> กำลังโหลดทะเบียนโมเดล…</span>');
    $('#ai-models-refresh-btn').prop('disabled', true);
    try {
        await fetchAIModels();
        renderAiModelsTable();
        const n = aiModelsData.filter(aiModelNeedsAttention).length;
        aiModelsStatus(n > 0
            ? `<span class="text-warning"><i class="fas fa-exclamation-triangle"></i> ${n} โมเดลต้องจัดการ (ตั้ง RPD / Priority)</span>`
            : '<span class="text-success"><i class="fas fa-check-circle"></i> ทุกโมเดลเรียบร้อย</span>');
    } catch (e) {
        aiModelsStatus(`<span class="text-danger"><i class="fas fa-times-circle"></i> โหลดไม่สำเร็จ: ${escapeHtml(String(e.message))}</span>`);
        $('#ai-models-tbody').html('<tr><td colspan="6" class="text-center text-danger py-4">โหลดข้อมูลไม่ได้</td></tr>');
    } finally {
        $('#ai-models-refresh-btn').prop('disabled', false);
    }
}

// Save แถวเดียว — อ่าน RPD/Priority จาก inputs ในแถวนั้น (btn = ปุ่มที่กด) → POST setModelRpd
async function saveModelRpd(btn) {
    if (aiModelsBusy) return;
    if (!confirmAdmin()) return;

    const $row = $(btn).closest('tr');
    const model = $row.find('.ai-model-rpd').data('model');
    const rpdRaw = String($row.find('.ai-model-rpd').val()).trim();
    const prioRaw = String($row.find('.ai-model-prio').val()).trim();

    if (rpdRaw === '' && prioRaw === '') {
        Swal.fire('ไม่มีอะไรจะบันทึก', 'ใส่ RPD หรือ Priority อย่างน้อยหนึ่งช่อง', 'warning');
        return;
    }
    // validate ฝั่ง client (backend validate ซ้ำ): RPD = จำนวนเต็มไม่ติดลบ, Priority = จำนวนเต็ม (ติดลบได้ = flagship)
    if (rpdRaw !== '' && !/^\d+$/.test(rpdRaw)) {
        Swal.fire('RPD ไม่ถูกต้อง', 'RPD ต้องเป็นจำนวนเต็มไม่ติดลบ', 'error'); return;
    }
    if (prioRaw !== '' && !/^-?\d+$/.test(prioRaw)) {
        Swal.fire('Priority ไม่ถูกต้อง', 'Priority ต้องเป็นจำนวนเต็ม', 'error'); return;
    }

    aiModelsBusy = true;
    $('.ai-model-save-btn').prop('disabled', true);
    aiModelsStatus(`<span class="text-primary"><i class="fas fa-spinner fa-spin"></i> กำลังบันทึก ${escapeHtml(String(model))}…</span>`);

    try {
        // fetch เดียว ไม่ retry (setModelRpd backfill _Remaining — retry จะ backfill ซ้ำ) — auth triple เหมือน runBatchAction
        const payload = {
            action: 'setModelRpd', model: model,
            username: currentUser.username, adminPass: adminPass,
            sessionToken: (typeof sessionToken === 'string' && sessionToken) || undefined
        };
        if (rpdRaw !== '') payload.rpd = parseInt(rpdRaw, 10);
        if (prioRaw !== '') payload.priority = parseInt(prioRaw, 10);

        const resp = await fetch(APPSCRIPT_URL, {
            method: 'POST', redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (data.result === 'success') {
            const bk = data.backfilledKeys ? ` — serve ทันที (backfill ${data.backfilledKeys} keys)` : '';
            aiModelsStatus(`<span class="text-success"><i class="fas fa-check-circle"></i> บันทึก ${escapeHtml(String(model))} สำเร็จ${bk}</span>`);
            await fetchAIModels();   // re-read → badge + ตารางตรงกับชีต
            renderAiModelsTable();
        } else {
            aiModelsStatus(`<span class="text-danger"><i class="fas fa-times-circle"></i> ${escapeHtml(String(model))} ล้มเหลว — ${escapeHtml(String(data.message || JSON.stringify(data)))}</span>`);
        }
    } catch (e) {
        aiModelsStatus(`<span class="text-danger"><i class="fas fa-times-circle"></i> ${escapeHtml(String(model))} error: ${escapeHtml(String(e.message))}</span>`);
    } finally {
        aiModelsBusy = false;
        $('.ai-model-save-btn').prop('disabled', false);
    }
}
