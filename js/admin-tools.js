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
            body: JSON.stringify({ action: action, subject: subject, username: currentUser.username, adminPass: adminPass })
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
