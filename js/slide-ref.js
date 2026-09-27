// ─────────────────────────────────────────────────────
// JS/SLIDE-REF.JS — ค้นหน้าสไลด์อ้างอิงจาก KB_Pages แล้วแนบเข้าเฉลยใน Edit Modal
// Mode 1 📎 แนบอ้างอิงอย่างเดียว (0 LLM) / Mode 2 ✨ เขียนเฉลยใหม่จากสไลด์ (Gemini, preview ก่อนใช้)
// ─────────────────────────────────────────────────────

// ---- SPEC (mirror ของ MDKKUQUIZBACKEND/tools/slide-ingest/eval_recall.py — แก้ต้องแก้ทั้งสองที่) ----
const SLIDE_K1 = 1.2, SLIDE_B = 0.75;
const SLIDE_BIGRAM_WEIGHT = 1.0;
const SLIDE_ANSWER_REPEAT = 2;     // query = stem + 2x คำตอบที่ถูก, ไม่ใส่ตัวลวง
const SLIDE_CAT_BOOST = 1.5;       // topic ของ category ตรงกับชื่อ lecture ของหน้า
const SLIDE_CAT_MATCH_MIN = 0.6;   // token-set Jaccard (topic vs lecture title) + meta.topic_map
const SLIDE_TOP_K = 5;
const SLIDE_STOPWORDS = new Set(`
a an the and or of in on at to for from by with without as is are was were be been being this that these those
it its which what who whom whose when where why how than then there their they them he she his her we our you your
not no nor but if so such can could may might will would should shall do does did has have had having also
most least more less very all any each both few other some same only own into over under about after before
between during through above below up down out off again further once here following true false except
patient patients year years old case cause causes caused likely diagnosis statement
correct incorrect best choice answer question associated regarding
`.split(/\s+/).filter(Boolean));
// ------------------------------------------

const SLIDE_DISC_RE = /_(?:ANA|PHYSIO|MICRO|PATHO|PHARM|CLINICAL|BIOCHEM|PARASITO|RADIO|LAB)_/;
const SLIDE_CACHE_TTL_MS = 24 * 3600 * 1000;
const SLIDE_MAX_SELECT = 2;
const SLIDE_CITE_RE = /\s*📖 อ้างอิง:[^\n]*$/;

let slideRefState = { subject: '', pages: [], meta: {}, index: null, results: [], selected: [] };

// เปิดโจทย์ข้อใหม่ → ปิด panel และล้างผลเดิม (ผลค้นผูกกับโจทย์ข้อก่อน)
$(document).on('show.bs.modal', '#editQuestionModal', function (e) {
    if (e.target.id !== 'editQuestionModal') return;
    $('#slide-ref-panel').hide().empty();
    slideRefState.results = [];
    slideRefState.selected = [];
});

// EN unigram + bigram; ไทย/เครื่องหมาย/ตัวเลขล้วน ถูกทิ้ง
function slideTokenize(text) {
    const words = (String(text || '').toLowerCase().match(/[a-z][a-z0-9]*/g) || [])
        .filter(w => w.length > 1 && !SLIDE_STOPWORDS.has(w));
    const out = words.slice();
    for (let i = 0; i + 1 < words.length; i++) out.push(words[i] + '_' + words[i + 1]);
    return out;
}

function slideCount(tokens) {
    const m = new Map();
    tokens.forEach(t => m.set(t, (m.get(t) || 0) + 1));
    return m;
}

function buildBm25(pages) {
    const docs = pages.map(p => slideCount(slideTokenize(p.title + '\n' + p.slideText)));
    const lens = docs.map(d => { let s = 0; d.forEach(v => { s += v; }); return s; });
    const df = new Map();
    docs.forEach(d => d.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
    return { docs, lens, avg: lens.reduce((a, b) => a + b, 0) / lens.length, df, n: docs.length };
}

function slideBm25Scores(queryTokens, ix, boosts) {
    const q = slideCount(queryTokens);
    return ix.docs.map((d, i) => {
        let s = 0;
        q.forEach((qf, t) => {
            const f = d.get(t);
            if (!f) return;
            const df = ix.df.get(t);
            const idf = Math.log(1 + (ix.n - df + 0.5) / (df + 0.5));
            const w = t.includes('_') ? SLIDE_BIGRAM_WEIGHT : 1.0;
            s += w * qf * idf * f * (SLIDE_K1 + 1) / (f + SLIDE_K1 * (1 - SLIDE_B + SLIDE_B * ix.lens[i] / ix.avg));
        });
        return s * boosts[i];
    });
}

// ['RP_51MCQ1', 'RP_ANA_Anatomy of pelvis'] → ['Anatomy of pelvis'] (id ชุดข้อสอบถูกทิ้ง)
function slideQuestionTopics(categories) {
    return (categories || []).map(String).filter(c => SLIDE_DISC_RE.test(c))
        .map(c => c.replace(/^.*_(?:ANA|PHYSIO|MICRO|PATHO|PHARM|CLINICAL|BIOCHEM|PARASITO|RADIO|LAB)_/, ''));
}

// = ingest_slides.norm_title + eval_recall.topic_tokens
function slideTopicTokens(s) {
    let t = String(s).replace(/^\s*(L\d+(?:-\d+)?)\b/i, '').toLowerCase().replace(/_compressed\b/g, '');
    t = t.replace(/[^a-z0-9฀-๿]+/g, ' ').split(/\s+/).filter(Boolean).join(' ');
    t = t.replace(/reproductive system/g, 'rp').replace(/\bsexual(ly)?\b/g, 'sex');
    const set = new Set(t.split(' ').filter(Boolean));
    set.delete('of'); set.delete('and');
    return set;
}

// lecture sources ที่ topic ของ category ชี้ไป: topic_map ก่อน, ไม่งั้น Jaccard ที่ดีที่สุด ≥ CAT_MATCH_MIN
function slideTopicSources(categories, sources, topicMap) {
    const overrides = {};
    Object.keys(topicMap || {}).forEach(k => { overrides[k.toLowerCase()] = topicMap[k]; });
    const hit = new Set();
    slideQuestionTopics(categories).forEach(topic => {
        const ov = overrides[topic.toLowerCase()];
        if (ov) { ov.forEach(s => { if (sources.has(s)) hit.add(s); }); return; }
        const tt = slideTopicTokens(topic);
        const sims = new Map();
        sources.forEach(s => {
            const st = slideTopicTokens(s);
            let inter = 0;
            tt.forEach(x => { if (st.has(x)) inter++; });
            const uni = new Set([...tt, ...st]).size;
            sims.set(s, uni ? inter / uni : 0);
        });
        let best = 0;
        sims.forEach(v => { if (v > best) best = v; });
        if (best >= SLIDE_CAT_MATCH_MIN) sims.forEach((v, s) => { if (v === best) hit.add(s); });
    });
    return hit;
}

// stem + ANSWER_REPEAT x answer, tokenize แยกส่วน (ไม่มี bigram ข้ามรอยต่อ)
function slideQueryTokens(problem, answer) {
    const stem = String(problem || '').replace(/^\s*\d+\s*[.)]\s*/, '');
    let toks = slideTokenize(stem);
    const ans = slideTokenize(answer);
    for (let i = 0; i < SLIDE_ANSWER_REPEAT; i++) toks = toks.concat(ans);
    return toks;
}

// คืน [{i, score}] เรียงมาก→น้อย (เสมอกันคงลำดับเดิม = เหมือน Python sorted(reverse=True))
function scoreSlides(queryTokens, ix, pages, categories, topicMap) {
    const srcs = slideTopicSources(categories, new Set(pages.map(p => p.source)), topicMap);
    const boosts = pages.map(p => (srcs.has(p.source) ? SLIDE_CAT_BOOST : 1.0));
    const s = slideBm25Scores(queryTokens, ix, boosts);
    return s.map((score, i) => ({ i, score })).sort((a, b) => b.score - a.score);
}

// ---- data ----

async function loadKBPages(subject, force = false) {
    const key = 'kb_pages_' + subject;
    if (!force) {
        try {
            const c = await getCacheDB(key);
            if (c && c.pages && c.pages.length && Date.now() - c.ts < SLIDE_CACHE_TTL_MS) return c;
        } catch (e) { console.warn('kb_pages cache read failed', e); }
    }
    const res = await sendWithRetry({
        action: 'getKBPages', subject,
        username: currentUser.username, adminPass: adminPass
    }, 2);
    if (!res || res.result !== 'success') throw new Error((res && res.message) || 'getKBPages ล้มเหลว');
    const data = { ts: Date.now(), pages: res.pages || [], meta: res.meta || {} };
    try { await setCacheDB(key, data); } catch (e) { console.warn('kb_pages cache write failed', e); }
    return data;
}

function slideDriveUrl(fileId) {
    return 'https://drive.google.com/uc?export=view&id=' + fileId;
}

function slideEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// อ่านโจทย์/ตัวเลือก/คำตอบ/category จาก Edit Modal (selector เดียวกับ askAIExpert)
function readEditModalQuestion() {
    const choices = [];
    $('#dynamic-choices-container .choice-item').each(function () {
        const t = $(this).find('.choice-text-input').val();
        if (t && t.trim() !== '') choices.push(t.trim());
    });
    return {
        problem: $('#edit-problem').val().trim(),
        choices,
        answer: ($('#dynamic-choices-container .choice-item:has(.choice-radio:checked) .choice-text-input').val() || '').trim(),
        categories: JSON.parse($('#edit-category-hidden').val() || '[]')
    };
}

// ---- panel ----

async function openSlideRefPanel() {
    const panel = $('#slide-ref-panel');
    if (panel.is(':visible')) { panel.slideUp(150); return; }

    const q = readEditModalQuestion();
    const subject = String(getSubjectFromCategory(q.categories) || '').trim().toUpperCase();
    if (!subject || subject === '-') {
        Swal.fire('ไม่ทราบวิชา', 'ใส่ category ของโจทย์ก่อน เพื่อให้รู้ว่าต้องค้นสไลด์วิชาไหน', 'warning');
        return;
    }
    panel.html('<div class="small text-primary"><i class="fas fa-spinner fa-spin"></i> กำลังโหลดสไลด์ ' + slideEsc(subject) + '...</div>').slideDown(150);
    await slideRefLoad(subject, false);
}

async function slideRefLoad(subject, force) {
    const panel = $('#slide-ref-panel');
    try {
        const data = await loadKBPages(subject, force);
        if (!data.pages.length) {
            panel.html('<div class="small text-muted">ยังไม่มีสไลด์ของวิชา ' + slideEsc(subject) + ' ใน KB_Pages</div>');
            return;
        }
        slideRefState = { subject, pages: data.pages, meta: data.meta || {}, index: buildBm25(data.pages), results: [], selected: [] };
        renderSlideRefControls();
        runSlideRefSearch();
    } catch (e) {
        console.error('slide-ref load', e);
        panel.html('<div class="small text-danger">โหลดสไลด์ไม่สำเร็จ: ' + slideEsc(e.message) + '</div>');
    }
}

function renderSlideRefControls() {
    const sources = [...new Set(slideRefState.pages.map(p => p.source))].sort();
    const opts = sources.map(s => '<option value="' + slideEsc(s) + '">' + slideEsc(s) + '</option>').join('');
    $('#slide-ref-panel').html(`
        <div class="border rounded p-2 bg-light">
            <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                <strong class="small">🔍 สไลด์ ${slideEsc(slideRefState.subject)} (${slideRefState.pages.length} หน้า)</strong>
                <input type="text" id="slide-ref-query" class="form-control form-control-sm" style="max-width:260px"
                    placeholder="ค้นเอง (เว้นว่าง = ใช้โจทย์+คำตอบ)" onkeydown="if(event.key==='Enter'){event.preventDefault();runSlideRefSearch();}">
                <select id="slide-ref-lecture" class="form-select form-select-sm" style="max-width:260px" onchange="runSlideRefSearch()">
                    <option value="">ทุก lecture</option>${opts}
                </select>
                <button type="button" class="btn btn-sm btn-outline-primary" onclick="runSlideRefSearch()">ค้นหา</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" title="โหลดสไลด์ใหม่จาก server"
                    onclick="slideRefLoad(slideRefState.subject, true)"><i class="fas fa-sync-alt"></i></button>
            </div>
            <div id="slide-ref-results"></div>
            <div class="d-flex flex-wrap gap-2 mt-2">
                <button type="button" class="btn btn-sm btn-success" id="btn-slide-attach" onclick="slideRefApply('attach')" disabled>📎 แนบอ้างอิง (ไม่ใช้ AI)</button>
                <button type="button" class="btn btn-sm btn-primary" id="btn-slide-regen" onclick="slideRefApply('regen')" disabled>✨ เขียนเฉลยใหม่จากสไลด์</button>
                <span class="small text-muted align-self-center">เลือกได้สูงสุด ${SLIDE_MAX_SELECT} หน้า</span>
            </div>
        </div>`);
}

function runSlideRefSearch() {
    const st = slideRefState;
    if (!st.index) return;
    const q = readEditModalQuestion();
    const manual = ($('#slide-ref-query').val() || '').trim();
    const lecture = $('#slide-ref-lecture').val() || '';
    const tokens = manual ? slideTokenize(manual) : slideQueryTokens(q.problem, q.answer);
    const ranked = scoreSlides(tokens, st.index, st.pages, q.categories, st.meta.topic_map)
        .filter(r => r.score > 0 && (!lecture || st.pages[r.i].source === lecture))
        .slice(0, SLIDE_TOP_K);
    st.results = ranked;
    st.selected = st.selected.filter(i => ranked.some(r => r.i === i));
    renderSlideRefResults();
}

function renderSlideRefResults() {
    const st = slideRefState;
    const box = $('#slide-ref-results');
    if (!st.results.length) {
        box.html('<div class="small text-muted">ไม่พบหน้าที่ตรง ลองพิมพ์คำค้นเองหรือเลือก lecture</div>');
        slideRefUpdateButtons();
        return;
    }
    const top = st.results[0].score;
    box.html(st.results.map(r => {
        const p = st.pages[r.i];
        // สีตามคะแนนเทียบกับอันดับ 1 (BM25 ไม่มีสเกลตายตัว): ≥75% เขียว, ≥50% เหลือง, ที่เหลือแดง
        const rel = top ? r.score / top : 0;
        const badge = rel >= 0.75 ? 'bg-success' : rel >= 0.5 ? 'bg-warning text-dark' : 'bg-danger';
        const thumb = p.imageFileId ? transformUrl(slideDriveUrl(p.imageFileId)) : '';
        const checked = st.selected.includes(r.i) ? 'checked' : '';
        return `
            <label class="d-flex gap-2 align-items-start border-bottom py-2" style="cursor:pointer">
                <input type="checkbox" class="form-check-input mt-1" ${checked} onchange="slideRefToggle(${r.i}, this)">
                ${thumb ? `<img src="${slideEsc(thumb)}" loading="lazy" style="width:120px;height:auto;border:1px solid #ddd;border-radius:4px"
                    onclick="event.preventDefault();window.open('${slideEsc(thumb)}','_blank')">` : ''}
                <div class="small flex-grow-1" style="min-width:0">
                    <div><span class="badge ${badge}">${r.score.toFixed(1)}</span>
                        <strong>${slideEsc(p.source)}</strong> · หน้า ${slideEsc(p.pageNo)}</div>
                    <div class="fw-bold">${slideEsc(p.title)}</div>
                    <div class="text-muted" style="white-space:pre-line">${slideEsc(String(p.slideText || '').slice(0, 220))}</div>
                </div>
            </label>`;
    }).join(''));
    slideRefUpdateButtons();
}

function slideRefToggle(i, el) {
    const st = slideRefState;
    if (el.checked) {
        if (st.selected.length >= SLIDE_MAX_SELECT) {
            el.checked = false;
            Swal.fire({ icon: 'info', title: 'เลือกได้สูงสุด ' + SLIDE_MAX_SELECT + ' หน้า', toast: true, position: 'top-end', showConfirmButton: false, timer: 1800 });
            return;
        }
        st.selected.push(i);
    } else {
        st.selected = st.selected.filter(x => x !== i);
    }
    slideRefUpdateButtons();
}

function slideRefUpdateButtons() {
    const none = !slideRefState.selected.length;
    $('#btn-slide-attach, #btn-slide-regen').prop('disabled', none);
}

// "📖 อ้างอิง: L01 Sex differentiation หน้า 3, 5; L02 ... หน้า 7" — client สร้างเอง ไม่ให้ LLM เขียน
function buildSlideCitation(pages) {
    const bySrc = new Map();
    pages.forEach(p => {
        if (!bySrc.has(p.source)) bySrc.set(p.source, []);
        bySrc.get(p.source).push(p.pageNo);
    });
    return '📖 อ้างอิง: ' + [...bySrc].map(([s, nos]) => s + ' หน้า ' + nos.join(', ')).join('; ');
}

function slideWithCitation(text, pages) {
    const body = String(text || '').replace(SLIDE_CITE_RE, '').trim();
    const cite = buildSlideCitation(pages);
    return body ? body + '\n' + cite : cite;
}

function slideInjectMedia(pages) {
    pages.forEach(p => {
        if (!p.imageFileId) return;
        const url = slideDriveUrl(p.imageFileId);
        if (!existingExplainMedia.some(u => u.trim() === url)) existingExplainMedia.push(url);
    });
    syncExplainMediaGallery();
}

function slideRefSelectedPages() {
    return slideRefState.selected.map(i => slideRefState.pages[i]);
}

async function slideRefApply(mode) {
    const pages = slideRefSelectedPages();
    if (!pages.length) return;
    if (mode === 'attach') applySlideAttachOnly(pages);
    else await applySlideRegenerate(pages);
}

// Mode 1: เก็บเฉลยเดิม + แทน/ต่อท้ายบรรทัดอ้างอิง + แนบภาพสไลด์ (0 LLM)
function applySlideAttachOnly(pages) {
    const field = $('#edit-explanation');
    field.val(slideWithCitation(field.val(), pages));
    slideInjectMedia(pages);
    Swal.fire({ icon: 'success', title: 'แนบสไลด์อ้างอิงแล้ว', text: 'อย่าลืมกดบันทึก', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
}

function buildSlideRegenPrompt(q, pages, notesById) {
    const slideBlock = pages.map(p =>
        `[${p.source} หน้า ${p.pageNo}] ${p.title}\n${p.slideText}`).join('\n\n');
    const notesBlock = pages.map(p => {
        const n = String(notesById[p.pageId] || '').slice(0, 4000);
        return n ? `[${p.source} หน้า ${p.pageNo}]\n${n}` : '';
    }).filter(Boolean).join('\n\n') || '(ไม่มี)';

    return `คุณคืออาจารย์แพทย์ผู้เชี่ยวชาญด้านแพทยศาสตรศึกษา (Medical Education Expert) ที่มีทักษะการสอนที่ยอดเยี่ยม
[TASK]
เขียนคำอธิบายเฉลย (Explanation) ของโจทย์นี้โดยยึดเนื้อหาจาก SLIDE CONTENT เป็นหลัก เป็นภาษาไทย prose ลื่นไหลเป็นธรรมชาติ ผสมภาษาอังกฤษ (Medical Terminology) ตามระดับที่แพทย์และนิสิตแพทย์ใช้จริง เป็น 1 ย่อหน้าต่อเนื่อง
ถ้าสไลด์ไม่ครอบคลุม ใช้ความรู้ทั่วไปได้แต่ห้ามอ้างว่ามาจากสไลด์

[DATA]
- โจทย์: "${q.problem}"
- ตัวเลือกทั้งหมด: ${q.choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join(', ')}
- คำตอบที่ถูกต้องที่ระบุไว้: "${q.answer}"

[SLIDE CONTENT — เนื้อหาจากสไลด์บรรยาย]
${slideBlock}

[บันทึกเสริม — ห้ามอ้างว่าเป็นสไลด์]
${notesBlock}

[INSTRUCTION & WRITING STYLE]
- ภาษา: ใช้โทนเป็นกันเอง อธิบายอย่างมีเหตุมีผลคล้ายคุณหมอรุ่นพี่หรืออาจารย์แพทย์ที่ใจดีกำลังสอนบอร์ด อธิบายอย่างชัดเจน มีความลื่นไหลเป็นเนื้อเดียวกัน
- ความยาว: 6 - 8 ประโยคเท่านั้น ห้ามเกินนี้เด็ดขาด
- รูปแบบ: ย่อหน้าเดียวต่อเนื่อง มีการเชื่อมประโยคอย่างลื่นไหล ไม่มีพอยต์ย่อย ไม่มีขึ้นบรรทัดใหม่สำหรับตัวเลือก โดยใช้ประโยคเชื่อมโยงธรรมชาติ เช่น "ส่วนข้อ B ผิดเพราะ... (due to...)", "ข้อ C ผิดเพราะ..."
- ลำดับการอธิบาย:
  1. เริ่มต้นวิเคราะห์ทันทีด้วยการชี้ diagnostic clues ในโจทย์ที่นำไปสู่คำตอบ "${q.answer}" ตามด้วย causal chain ของกลไกทางพยาธิสรีรวิทยา (Pathophysiology) หรือโครงสร้างทางกายวิภาคที่เกี่ยวข้องแบบเหตุ-ผลต่อเนื่องกัน (A → B → C) โดยอิงเนื้อหาจากสไลด์
  2. เปรียบเทียบและชี้แจงเหตุผลของตัวเลือกอื่นๆ ที่เหลือให้ชัดเจนว่าเป็นพยาธิสภาพของอะไร หรือทำไมจึงยังไม่ถูกต้องในบริบทของโจทย์ข้อนี้

[STRICT RULES]
- เริ่มต้นเขียนคำอธิบายขึ้นต้นทันที ห้ามมีคำพูดเกริ่นนำใดๆ ทั้งสิ้น เช่น "คำอธิบายคือ:", "เฉลยข้อนี้:", "แน่นอน" หรือเขียนสรุปข้อความ "My Assessment"
- ตอบเฉพาะย่อหน้าคำอธิบายเป็นภาษาไทยผสมคำศัพท์ภาษาอังกฤษทางการแพทย์
- ห้ามใช้สัญลักษณ์ตัวหนา (**) หรือเครื่องหมายคำพูดครอบประโยคในผลลัพธ์
- ห้ามใช้การขึ้นบรรทัดใหม่ (\\n) หรือ Bullet lists เด็ดขาด
- ห้ามเขียนบรรทัดอ้างอิงหรือชื่อ lecture/เลขหน้าเอง (ระบบจะเติมให้)
- ห้ามใส่ /// ในข้อความ
- ห้ามอธิบายตัวเลือกผิดแต่ละข้อแยกประโยค — รวมในประโยคเดียวหรือสองประโยคได้`;
}

function cleanSlideRegenText(text) {
    return String(text || '')
        .replace(/\/\/\//g, ' ')
        .replace(SLIDE_CITE_RE, '')
        .replace(/\s*\n+\s*/g, ' ')
        .replace(/^\s*(?:คำอธิบาย(?:คือ)?|เฉลยข้อนี้|เฉลย|แน่นอน)\s*[:：]?\s*/, '')
        .trim();
}

// Mode 2: notes → prompt → Gemini → preview เดิม/ใหม่ → ยืนยันแล้วค่อยแทน + แนบภาพ
async function applySlideRegenerate(pages) {
    const q = readEditModalQuestion();
    if (!q.problem || !q.choices.length || !q.answer) {
        Swal.fire('ข้อมูลไม่ครบ', 'ต้องมีโจทย์ ตัวเลือก และคำตอบที่ติ๊กไว้ก่อน', 'warning');
        return;
    }
    const btn = $('#btn-slide-regen');
    btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin me-1"></i> กำลังเขียน...');
    try {
        const nres = await sendWithRetry({
            action: 'getKBPageNotes', pageIds: pages.map(p => p.pageId),
            username: currentUser.username, adminPass: adminPass
        }, 2);
        if (!nres || nres.result !== 'success') throw new Error((nres && nres.message) || 'getKBPageNotes ล้มเหลว');
        const notesById = {};
        (nres.notes || []).forEach(n => { notesById[n.pageId] = n.notesMd; });

        const res = await sendWithRetry({
            action: 'askAIExpert', provider: 'Gemini',
            prompt: buildSlideRegenPrompt(q, pages, notesById),
            username: currentUser.username, adminPass: adminPass
        }, 1);
        if (!res || res.result !== 'success') throw new Error((res && res.message) || 'AI ไม่สามารถประมวลผลได้');
        if (res.quota) $('#ai-quota-badge').html(`<i class="fas fa-bolt text-warning"></i> AI Quota: ${res.quota}`).fadeIn();

        const oldText = $('#edit-explanation').val();
        const newText = slideWithCitation(cleanSlideRegenText(res.answer), pages);
        const col = (h, t) => `<div style="flex:1;min-width:260px"><div class="fw-bold mb-1">${h}</div>
            <div class="border rounded p-2 text-start small" style="white-space:pre-wrap;max-height:50vh;overflow:auto">${slideEsc(t) || '<span class="text-muted">(ว่าง)</span>'}</div></div>`;
        const ok = await Swal.fire({
            title: 'เทียบเฉลยเดิม / ใหม่',
            html: `<div class="d-flex flex-wrap gap-2">${col('เดิม', oldText)}${col('ใหม่ (จากสไลด์)', newText)}</div>`,
            width: 1000, showCancelButton: true,
            confirmButtonText: 'ใช้เฉลยใหม่', cancelButtonText: 'ยกเลิก'
        });
        if (!ok.isConfirmed) return;
        $('#edit-explanation').val(newText);
        slideInjectMedia(pages);
        Swal.fire({ icon: 'success', title: 'ใส่เฉลยใหม่แล้ว', text: 'อย่าลืมกดบันทึก', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
    } catch (e) {
        console.error('slide regen', e);
        Swal.fire('เขียนเฉลยไม่สำเร็จ', e.message, 'error');
    } finally {
        btn.html('✨ เขียนเฉลยใหม่จากสไลด์');
        slideRefUpdateButtons();
    }
}
