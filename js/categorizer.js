// ─────────────────────────────────────────────────────
// JS/CATEGORIZER.JS — AI batch categorize (แยกหัวข้อเลคเชอร์)
// แทนที่ forced auto-vote ใน REAL: AI เสนอ LEC category ต่อข้อ
// → admin review → bulk apply ผ่าน GAS bulkAddQuestionCategories
// เกณฑ์ target เดียวกับ auto-vote เดิม (quiz-core.js REAL):
//   มี category จริง ≤ 1 และไม่อยู่ในกลุ่ม LEC / BY AI / (EXTRACTED) / MODULE / COMMED
// ─────────────────────────────────────────────────────

const CAT_AI_GEMINI_CHUNK = 30;   // ข้อต่อ 1 Gemini call
const CAT_AI_APPLY_CHUNK = 40;    // ข้อต่อ 1 POST (backend cap 100)

let catAiBusy = false;
let catAiProposals = [];          // [{id, problem, currentCatName, categoryId, categoryName, valid}]

function catAiStatus(html) { $('#cat-ai-status').html(html); }

function renderCatAiPanel() {
    // Subject select — นับข้อเหมือน aiGenSubjectCounts (admin-tools.js)
    const counts = aiGenSubjectCounts();
    const subjects = [...new Set((globalData.structure || []).map(s => s.SubjectID))].sort();
    const sel = $('#cat-ai-subject');
    const prev = sel.val();
    let opts = '<option value="">-- เลือกวิชา --</option>';
    subjects.forEach(s => {
        opts += `<option value="${s}">${s} (${counts[s] || 0} ข้อ)</option>`;
    });
    sel.html(opts);
    if (prev && subjects.includes(prev)) sel.val(prev);

    // Prefill Gemini key จาก sessionStorage (key เดียวกับ converter)
    const keyEl = document.getElementById('cat-ai-key');
    if (keyEl && !keyEl.value) keyEl.value = sessionStorage.getItem('mdkku_gemini_key') || '';
}

function catAiSaveKey() {
    const v = (document.getElementById('cat-ai-key') || {}).value || '';
    sessionStorage.setItem('mdkku_gemini_key', v.trim());
}

// หา target questions + LEC categories ของวิชา — เกณฑ์เดียวกับ auto-vote เดิมใน REAL
function scanCatAiTargets(subject) {
    const catInfo = {};
    (globalData.category || []).forEach(c => { catInfo[c.CategoryID] = c; });

    const lecCats = (globalData.category || []).filter(c =>
        c.SubjectRef === subject &&
        String(c.AccordionGroup || '').toUpperCase().includes('LEC')
    );

    const targets = [];
    (globalData.questions || []).forEach(q => {
        const cats = Array.isArray(q.category) ? q.category : [];
        if (!cats.some(id => catInfo[id] && catInfo[id].SubjectRef === subject)) return;

        const realCats = cats.filter(c => c && c !== 'Uncategorized');
        if (realCats.length > 1) return;

        let isExcluded = false;
        realCats.forEach(catId => {
            const c = catInfo[catId];
            if (!c) return;
            const group = String(c.AccordionGroup || '').toUpperCase();
            const name = String(c.CategoryName || '').toUpperCase();
            if (group.includes('LEC') || group.includes('BY AI') || group.includes('(EXTRACTED)') ||
                name.includes('MODULE') || name.includes('COMMED')) {
                isExcluded = true;
            }
        });
        if (isExcluded) return;

        targets.push({
            id: q.questionId,
            problem: String(q.problem || ''),
            choices: String(q.choices || ''),
            answer: String(q.answer || ''),
            currentCatName: realCats.map(c => (catInfo[c] ? catInfo[c].CategoryName : c)).join(', ') || '(ไม่มี)'
        });
    });

    return { targets, lecCats };
}

// 1 Gemini call: chunk ของข้อสอบ + รายการ LEC categories → [{id, categoryId}]
// ตัด completion tag ที่ไม่ใช่เนื้อหาคลินิก (category-rewriter discipline)
function stripCompletionTags(s) {
    return String(s || '').replace(/\[⚠️[^\]]*\]/g, '').trim();
}

async function callGeminiClassify(chunk, lecCats, model, key) {
    const catList = lecCats.map(c => `${c.CategoryID} | ${c.CategoryName}`).join('\n');
    const items = chunk.map(q => ({
        id: q.id,
        problem: stripCompletionTags(q.problem).substring(0, 600),
        choices: stripCompletionTags(q.choices).replace(/https?:\/\/\S+/g, '[รูปภาพ]').substring(0, 400),
        answer: stripCompletionTags(q.answer).replace(/https?:\/\/\S+/g, '[รูปภาพ]').substring(0, 150)
    }));

    const prompt = `คุณเป็น AI จำแนกข้อสอบแพทย์เข้าหัวข้อเลคเชอร์ (lecture) ที่ถูกต้องหัวข้อเดียว
รายการหัวข้อที่ใช้ได้ (categoryId | ชื่อหัวข้อ):
${catList}

ข้อสอบ (JSON — ใช้ problem + choices + answer ในการจำแนก):
${JSON.stringify(items)}

ส่งกลับ JSON array เท่านั้น — ไม่มี markdown, ไม่มีข้อความอื่น:
[{"id": "<id เดิมของข้อสอบ>", "categoryId": "<categoryId จากรายการ>"}]

กฎการจำแนก (เข้มงวด):
1. เลือก categoryId จากรายการด้านบน "เท่านั้น" ห้ามแต่ง id หรือชื่อหัวข้อใหม่
2. จำแนกจากเนื้อหาที่โจทย์กำลังทดสอบจริง (problem + choices + answer) — ไม่ใช่จากคำที่ปรากฏผ่านๆ
3. เลือกหัวข้อที่ "ตรงที่สุดหัวข้อเดียว" ต่อ 1 ข้อ
4. ถ้าไม่มีหัวข้อใดเข้าใกล้เนื้อหาเลย ให้ใส่ categoryId เป็น "" (อย่าเดามั่ว) — แต่ถ้ามีหัวข้อที่ใกล้เคียงพอ ให้เลือกอันที่ใกล้ที่สุด
5. ต้องตอบครบทุก id`;

    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: 'application/json', temperature: 0.1, max_output_tokens: 8192 }
    };

    const url = `${GEMINI_API_BASE}${model}:generateContent?key=${key}`;
    const MAX_RETRY = 3;
    let res;
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.status !== 429) break;
    }
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error ${res.status}: ${errText.substring(0, 200)}`);
    }

    const json = await res.json();
    const candidate = json.candidates && json.candidates[0];
    if (!candidate) throw new Error('Gemini ไม่ส่งผลลัพธ์กลับมา');
    const rawText = candidate.content.parts.map(p => p.text || '').join('');

    // parse: ตรง → หา [] ชั้นนอก
    try { return JSON.parse(rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()); }
    catch (e) { }
    const fb = rawText.indexOf('['), lb = rawText.lastIndexOf(']');
    if (fb !== -1 && lb > fb) {
        try { return JSON.parse(rawText.substring(fb, lb + 1)); } catch (e) { }
    }
    throw new Error('Gemini ส่ง JSON ไม่ถูกต้อง: ' + rawText.substring(0, 200));
}

async function runCatAiClassify() {
    if (catAiBusy) return;
    if (!confirmAdmin()) return;

    const subject = $('#cat-ai-subject').val();
    if (!subject) { Swal.fire('เลือกวิชาก่อน', 'กรุณาเลือกวิชาที่จะแยกหัวข้อ', 'warning'); return; }

    catAiSaveKey();
    const key = sessionStorage.getItem('mdkku_gemini_key') || '';
    if (!key) { Swal.fire('ไม่มี API Key', 'กรุณากรอก Gemini API Key', 'warning'); return; }

    const { targets, lecCats } = scanCatAiTargets(subject);
    if (lecCats.length === 0) {
        Swal.fire('ไม่มีหัวข้อ LEC', `วิชา ${subject} ยังไม่มี category กลุ่ม LEC — เพิ่มหัวข้อเลคเชอร์ก่อน (เช่นผ่าน /parse-elearning)`, 'error');
        return;
    }
    if (targets.length === 0) {
        Swal.fire('ไม่มีข้อที่ต้องแยก', `วิชา ${subject} ไม่มีข้อที่เข้าเกณฑ์ (category ≤ 1 และยังไม่มีเลคเชอร์)`, 'info');
        return;
    }

    const nCalls = Math.ceil(targets.length / CAT_AI_GEMINI_CHUNK);
    const res = await Swal.fire({
        title: 'ยืนยันจำแนกด้วย AI?',
        html: `วิชา <b>${subject}</b><br>ข้อที่เข้าเกณฑ์: <b>${targets.length}</b> ข้อ · หัวข้อ LEC: ${lecCats.length}<br>จะเรียก Gemini <b>${nCalls}</b> ครั้ง (เสียโควตา key ของคุณ)`,
        icon: 'warning', showCancelButton: true, confirmButtonText: 'รันเลย', cancelButtonText: 'ยกเลิก'
    });
    if (!res.isConfirmed) return;

    catAiBusy = true;
    $('#sec-ai-generate .cat-ai-btn, #cat-ai-subject').prop('disabled', true);
    catAiProposals = [];
    $('#cat-ai-review').empty();

    const model = $('#cat-ai-model').val() || 'gemini-3.5-flash';
    const lecById = {};
    lecCats.forEach(c => { lecById[c.CategoryID] = c; });

    try {
        for (let i = 0; i < targets.length; i += CAT_AI_GEMINI_CHUNK) {
            const chunk = targets.slice(i, i + CAT_AI_GEMINI_CHUNK);
            const callNo = Math.floor(i / CAT_AI_GEMINI_CHUNK) + 1;
            catAiStatus(`<span class="text-primary"><i class="fas fa-spinner fa-spin"></i> Gemini call ${callNo}/${nCalls} (${chunk.length} ข้อ)…</span>`);

            let mapped;
            try {
                mapped = await callGeminiClassify(chunk, lecCats, model, key);
            } catch (e) {
                console.warn('[CatAI] chunk failed:', e);
                catAiStatus(`<span class="text-warning">chunk ${callNo} ล้มเหลว (${e.message}) — ข้ามไป chunk ถัดไป</span>`);
                mapped = [];
            }

            const byId = {};
            (Array.isArray(mapped) ? mapped : []).forEach(m => { if (m && m.id) byId[m.id] = m.categoryId; });

            chunk.forEach(q => {
                const catId = byId[q.id] || '';
                const valid = !!lecById[catId]; // กัน AI แต่ง id นอกรายการ
                catAiProposals.push({
                    id: q.id, problem: q.problem, currentCatName: q.currentCatName,
                    categoryId: valid ? catId : '',
                    categoryName: valid ? lecById[catId].CategoryName : '',
                    valid: valid
                });
            });
        }

        const nValid = catAiProposals.filter(p => p.valid).length;
        catAiStatus(`<span class="text-success"><i class="fas fa-check-circle"></i> จำแนกเสร็จ — เสนอได้ ${nValid}/${catAiProposals.length} ข้อ · ตรวจแล้วกด Apply</span>`);
        renderCatAiReview();
    } finally {
        catAiBusy = false;
        $('#sec-ai-generate .cat-ai-btn, #cat-ai-subject').prop('disabled', false);
    }
}

function renderCatAiReview() {
    const $box = $('#cat-ai-review');
    if (catAiProposals.length === 0) { $box.empty(); return; }

    let rows = '';
    catAiProposals.forEach((p, idx) => {
        const dis = p.valid ? '' : 'disabled';
        const chk = p.valid ? 'checked' : '';
        const proposed = p.valid
            ? `<span class="badge bg-primary">${escapeHtml(p.categoryName)}</span>`
            : '<span class="badge bg-secondary">AI ไม่แน่ใจ</span>';
        rows += `<tr class="${p.valid ? '' : 'table-secondary'}">
            <td><input type="checkbox" class="cat-ai-chk form-check-input" data-idx="${idx}" ${chk} ${dis}></td>
            <td class="small text-muted">${escapeHtml(p.id)}</td>
            <td class="small">${escapeHtml(p.problem.substring(0, 120))}${p.problem.length > 120 ? '…' : ''}</td>
            <td class="small">${escapeHtml(p.currentCatName)}</td>
            <td>${proposed}</td>
        </tr>`;
    });

    $box.html(`
        <div class="table-responsive" style="max-height: 420px; overflow-y: auto;">
            <table class="table table-sm table-hover align-middle">
                <thead class="table-light" style="position: sticky; top: 0;">
                    <tr>
                        <th><input type="checkbox" id="cat-ai-chk-all" class="form-check-input" checked></th>
                        <th>ID</th><th>โจทย์</th><th>หัวข้อเดิม</th><th>AI เสนอ</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <button class="btn btn-success cat-ai-btn mt-2" onclick="applyCatAiProposals()">
            <i class="fas fa-check me-1"></i> Apply ที่เลือก
        </button>
    `);

    $('#cat-ai-chk-all').on('change', function () {
        $('.cat-ai-chk:not(:disabled)').prop('checked', this.checked);
    });
}

async function applyCatAiProposals() {
    if (catAiBusy) return;
    if (!confirmAdmin()) return;

    const selected = [];
    $('.cat-ai-chk:checked').each(function () {
        const p = catAiProposals[parseInt($(this).attr('data-idx'), 10)];
        if (p && p.valid) selected.push({ id: p.id, categoryId: p.categoryId });
    });
    if (selected.length === 0) { Swal.fire('ไม่มีข้อที่เลือก', '', 'info'); return; }

    const res = await Swal.fire({
        title: `Apply ${selected.length} ข้อ?`,
        text: 'จะเพิ่มหัวข้อเลคเชอร์เข้า category ของแต่ละข้อ (append — หัวข้อเดิมยังอยู่)',
        icon: 'question', showCancelButton: true, confirmButtonText: 'บันทึก', cancelButtonText: 'ยกเลิก'
    });
    if (!res.isConfirmed) return;

    catAiBusy = true;
    $('#sec-ai-generate .cat-ai-btn').prop('disabled', true);

    let applied = 0, skipped = 0, failed = 0;
    try {
        for (let i = 0; i < selected.length; i += CAT_AI_APPLY_CHUNK) {
            const chunk = selected.slice(i, i + CAT_AI_APPLY_CHUNK);
            catAiStatus(`<span class="text-primary"><i class="fas fa-spinner fa-spin"></i> กำลังบันทึก ${Math.min(i + chunk.length, selected.length)}/${selected.length}…</span>`);

            try {
                // fetch เดียว ไม่ retry — retry อาจยิงซ้ำระหว่าง backend กำลังเขียน (แบบเดียวกับ runBatchAction)
                const resp = await fetch(APPSCRIPT_URL, {
                    method: 'POST',
                    redirect: 'follow',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        action: 'bulkAddQuestionCategories',
                        username: currentUser.username, adminPass: adminPass,
                        data: { updates: chunk }
                    })
                });
                const out = await resp.json();
                if (out.result === 'success') {
                    applied += out.applied || 0;
                    skipped += out.skipped || 0;
                    // อัปเดต local ให้ scan รอบถัดไปไม่เจอข้อเดิมซ้ำ
                    chunk.forEach(u => {
                        const q = (globalData.questions || []).find(x => x.questionId === u.id);
                        if (q && Array.isArray(q.category) && !q.category.includes(u.categoryId)) q.category.push(u.categoryId);
                    });
                } else {
                    failed += chunk.length;
                    console.warn('[CatAI] apply chunk failed:', out.message);
                }
            } catch (e) {
                failed += chunk.length;
                console.warn('[CatAI] apply chunk error:', e);
            }
        }

        const icon = failed > 0 ? 'warning' : 'success';
        catAiStatus(`<span class="${failed > 0 ? 'text-warning' : 'text-success'}"><i class="fas fa-check-circle"></i> บันทึกแล้ว ${applied} ข้อ · ข้าม ${skipped} · ล้มเหลว ${failed}</span>`);
        Swal.fire('เสร็จสิ้น', `บันทึก ${applied} ข้อ · ข้าม (มีอยู่แล้ว) ${skipped} · ล้มเหลว ${failed}`, icon);
        catAiProposals = [];
        $('#cat-ai-review').empty();
    } finally {
        catAiBusy = false;
        $('#sec-ai-generate .cat-ai-btn').prop('disabled', false);
    }
}
