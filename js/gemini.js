// ─────────────────────────────────────────────────────
// JS/GEMINI.JS  — PDF→questions conversion via GAS proxy
// Phase 1 (student-pdf-converter-plan): ไม่เรียก Gemini ตรงจาก browser แล้ว
// ส่ง action:'convertPdfBatch' ให้ backend ใช้ AI_Config Gemini pool แทน (ไม่ต้องกรอก key)
// ─────────────────────────────────────────────────────

// ยังใช้โดย categorizer.js (bulk re-categorization ยังเรียก Gemini ตรงด้วย key ของผู้ใช้)
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

// clientId ถาวรต่อเครื่อง — ใช้เป็น rate-limit key สำรองฝั่ง backend
function getConverterClientId() {
    let id = localStorage.getItem('mdkku_client_id');
    if (!id) {
        id = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('mdkku_client_id', id);
    }
    return id;
}

// Port of Python parse_filename_metadata()
function parseFilenameMetadata(filename) {
    let base = filename.replace(/\.pdf$/i, '').trim();
    base = base.replace(/^\([^)]+\)\s*/, ''); // strip (MD49) prefix
    const parts = base.split(/[_\s]+/).filter(p => p.length > 0);
    return {
        subjectCode: parts[0] ? parts[0].toUpperCase() : 'SUBJ',
        examGroup:   parts[1] ? parts[1].toUpperCase() : 'EXAM',
        topicLabel:  parts.slice(2).join('_').toUpperCase()
    };
}

// Port of Python sanitize_category()
// Returns exactly 2-element array: [defaultCat, standardizedCat]
const _SUBGROUPS = ['ANA', 'BIOCHEM', 'PHYSIO', 'MICRO', 'PARASITO', 'PATHO', 'PHARM', 'RADIO', 'CLINICAL'];

// หัวข้อบรรยายที่มีอยู่จริงในชีตของวิชานั้น (จาก globalData.category กรองด้วย SubjectRef)
// ใช้บังคับให้ Gemini จัดหมวดหมู่ลงหัวข้อ e-learning จริง ไม่ใช่แต่งชื่อขึ้นมาเอง
// กรองออก: _Extracted, "by AI", กลุ่มคำย่อข้อสอบ (MCQ/FMT/LAB) — backend-generated ไม่ใช่หัวข้อบรรยายจริง
// รูปแบบหัวข้อบรรยายจริง: SUBJ_DISCIPLINE_TopicName (มี ≥3 ส่วน + มีกลุ่มวิชาย่อยตรงกลาง)
function getExistingCategoriesForSubject(subjId) {
    if (!subjId || typeof globalData !== 'object' || !Array.isArray(globalData.category)) return [];
    const target = String(subjId).trim().toUpperCase();
    return globalData.category.filter(c => {
        if (String(c.SubjectRef || '').trim().toUpperCase() !== target) return false;
        const id = String(c.CategoryID || '');
        if (id.endsWith('_Extracted') || id.toLowerCase().indexOf('by ai') !== -1) return false;
        // ต้องมีอย่างน้อย 3 ส่วน (_ คั่น) และมีกลุ่มวิชาย่อยที่รู้จัก — กันกลุ่มข้อสอบ (2-ส่วน เช่น CVS_51MCQ1)
        var parts = id.split('_');
        if (parts.length < 3) return false;
        var hasSubgroup = parts.some(function(p) {
            var u = p.toUpperCase();
            return _SUBGROUPS.indexOf(u) >= 0;
        });
        return hasSubgroup;
    });
}

// หากลุ่มวิชา (discipline header) จาก CategoryID — สแกนทุกส่วนหา token ที่เป็นกลุ่มวิชาย่อย
// รองรับทั้ง 2 รูปแบบ: RS_ANA_Topic และ RS_by AI_ANA_Topic (parts[1] ไม่ใช่กลุ่มวิชาเสมอไป)
// คืน header แบบเดียวกับ registerCategoryAndStructure (ANA→ANATOMY ฯลฯ) เพื่อจัดกลุ่มในหน้าทบทวน
function disciplineHeaderFromCategoryId(catId) {
    const parts = String(catId || '').split('_');
    let sg = '';
    for (let i = 1; i < parts.length; i++) {
        const up = parts[i].trim().toUpperCase();
        if (_SUBGROUPS.includes(up) || up === 'PHY' || up === 'PHARMACO' || up === 'IMAGE') { sg = up; break; }
    }
    if (sg === 'ANA') return 'ANATOMY';
    if (sg === 'PHYSIO' || sg === 'PHY' || sg === 'BIOCHEM') return 'PHYSIO and BIOCHEM';
    if (sg === 'PARASITO' || sg === 'MICRO') return 'PARASITO and MICRO';
    if (sg === 'PATHO') return 'PATHO';
    if (sg === 'PHARM' || sg === 'PHARMACO') return 'PHARM';
    if (sg === 'RADIO' || sg === 'IMAGE' || sg === 'CLINICAL') return 'RADIO and CLINICAL';
    return sg || 'อื่นๆ (ไม่ระบุกลุ่ม)';
}

// validIds: Set ของ CategoryID ที่มีอยู่จริง — ถ้า Gemini คืนค่าตรงเป๊ะ ให้ผ่านไม่แตะ (กัน sanitize ทำ ID พัง)
function sanitizeCategory(categoryData, stem, validIds) {
    let cats;
    if (Array.isArray(categoryData)) {
        cats = [...categoryData];
    } else if (typeof categoryData === 'string') {
        try { cats = JSON.parse(categoryData.replace(/'/g, '"')); }
        catch (e) { cats = [categoryData]; }
    } else {
        cats = [stem];
    }

    if (!cats || cats.length === 0) cats = [stem];
    while (cats.length < 2) cats.push(cats[0] || stem);

    const valid = (validIds && typeof validIds.has === 'function') ? validIds : new Set();

    // Validate category[0]: ผ่านถ้าตรงกับ ID จริง หรือเข้ารูปแบบ SUBJ_GROUP
    if (!valid.has(String(cats[0])) && !/^[A-Z0-9]+_[A-Z0-9]/i.test(String(cats[0]))) {
        cats[0] = stem;
    }

    // Validate/fix category[1]: ตรงกับหัวข้อจริง → คงไว้ทั้งดุ้น; ไม่งั้นค่อยซ่อมรูปแบบ SubCode_SubGroup_Topic
    if (!valid.has(String(cats[1]))) {
        const cat1Parts = String(cats[1]).split('_');
        if (cat1Parts.length >= 2) {
            const subgroup = cat1Parts[1].toUpperCase();
            if (!_SUBGROUPS.includes(subgroup)) {
                for (const sg of _SUBGROUPS) {
                    if (cats[1].toUpperCase().includes(sg)) {
                        const topic = cat1Parts.slice(2).join('_') || cat1Parts[cat1Parts.length - 1];
                        cats[1] = `${cat1Parts[0]}_${sg}_${topic}`;
                        break;
                    }
                }
            }
        }
    }

    return [cats[0], cats[1]];
}

// รายการหัวข้อบรรยายที่บังคับให้ Gemini เลือกลง category[1] — คัดลอก CategoryID มาเป๊ะ ห้ามแต่งเอง
// allowedCats: [{CategoryID, CategoryName}] จาก getExistingCategoriesForSubject
function buildAllowedTopicsBlock(allowedCats) {
    if (!allowedCats || allowedCats.length === 0) return '';
    const lines = allowedCats.map(c => `- ${c.CategoryID}`).join('\n');
    return `

**สำคัญที่สุด — บังคับใช้แทนกฎข้อ 6:** category[1] ต้องเป็นหนึ่งใน CategoryID หัวข้อบรรยายด้านล่างนี้เท่านั้น
คัดลอกข้อความ CategoryID มาทั้งดุ้นแบบเป๊ะ (ทุกช่องว่าง ทุกตัวอักษร ทั้งไทยและอังกฤษ) ห้ามแต่งใหม่ ห้ามย่อ ห้ามแก้ไข:
${lines}
ถ้าข้อไหนไม่เข้ากับหัวข้อใดเลย ให้เลือกหัวข้อที่ "ใกล้เคียงที่สุด" จากรายการนี้ — ห้ามสร้าง CategoryID ใหม่เด็ดขาด`;
}

// สร้าง converter prompt (ส่งไปกับ convertPdfBatch — backend forward ให้ Gemini ตรงๆ)
// pageNote: ใช้กับ batch แบบรูปหน้ากระดาษ เพื่อบอกเลขหน้าจริงให้ pageHint ถูกต้อง
// allowedCats: หัวข้อบรรยายจริงของวิชานี้ — ถ้ามี จะบังคับ category[1] ให้เลือกจากรายการ
// forcedCat0: examGroup ที่ผู้ใช้เลือกจากชิป (edit 3) — บังคับ category[0] ชนะการเดาจากชื่อไฟล์
function buildConverterPrompt(additionalPrompt, pageNote, allowedCats, forcedCat0) {
    const prompt = `คุณเป็น AI แปลงข้อสอบแพทย์จาก PDF เป็น JSON
ส่งกลับ JSON object นี้เท่านั้น — ไม่มี markdown, ไม่มีข้อความอื่น:
{
  "meta": {"source": "ชื่อไฟล์", "converted": <จำนวนข้อ>},
  "questions": [
    {
      "problem": "1. ข้อความโจทย์เต็ม",
      "img": "" หรือ "require_img",
      "choices": "ตัวเลือก A///ตัวเลือก B///ตัวเลือก C///ตัวเลือก D///ตัวเลือก E",
      "answer": "ตัวเลือกที่ถูกต้อง",
      "explain": "คำอธิบายภาษาไทยผสมศัพท์การแพทย์ภาษาอังกฤษ",
      "category": ["ชื่อวิชา_กลุ่มข้อสอบ", "ชื่อวิชา_กลุ่มวิชาย่อย_หัวข้อ"],
      "pageHint": <หมายเลขหน้า PDF>,
      "select": "",
      "state": false
    }
  ]
}

กฎที่ต้องทำตามอย่างเคร่งครัด:
1. choices ใช้ /// คั่นระหว่างตัวเลือก (5 ตัวเลือกถ้าเป็นไปได้)
2. answer ต้องตรงกับข้อความใน choices
3. explain เขียนเป็นภาษาไทย ผสมศัพท์การแพทย์ภาษาอังกฤษ
4. img ใส่ "require_img" ถ้าโจทย์มีรูปภาพ/กราฟ/ตารางที่จำเป็นต้องดูเพื่อตอบ
5. category[0]: "ชื่อย่อวิชา_กลุ่มข้อสอบ" เช่น "CVS_51MCQ1"
6. category[1]: "ชื่อย่อวิชา_กลุ่มวิชาย่อย_หัวข้อ" โดยกลุ่มวิชาย่อยต้องเป็นหนึ่งใน: ANA, BIOCHEM, PHYSIO, MICRO, PARASITO, PATHO, PHARM, RADIO, CLINICAL
7. ไม่แปลหรือเปลี่ยนภาษาของโจทย์ — ข้อความตรงตาม PDF${forcedCat0 ? `\n\n**บังคับใช้แทนกฎข้อ 5:** category[0] ของทุกข้อต้องเป็น "${forcedCat0}" เท่านั้น — คัดลอกตรงเป๊ะ ห้ามเปลี่ยน` : ''}${buildAllowedTopicsBlock(allowedCats)}${pageNote ? '\n' + pageNote : ''}${additionalPrompt ? '\n' + additionalPrompt : ''}`;

    return prompt;
}

// ยิง 1 batch ไปที่ GAS convertPdfBatch — ไม่ auto-retry (กันเผา quota pool ซ้ำถ้า Gemini สำเร็จแต่ response หาย)
// payloadExtra: { pdfB64 } หรือ { images: [dataURL,…] }
// คืนค่า rawText (string) หรือ recovered object {questions:[…]} กรณี MAX_TOKENS
async function convertBatchViaGAS(prompt, payloadExtra) {
    const body = Object.assign({
        action: 'convertPdfBatch',
        prompt: prompt,
        clientId: getConverterClientId(),
        username: (typeof currentUser === 'object' && currentUser.username) || '',
        adminPass: (typeof adminPass === 'string' && adminPass) || '',
        sessionToken: (typeof sessionToken === 'string' && sessionToken) || ''
    }, payloadExtra);

    const res = await fetch(APPSCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow'
    });
    if (!res.ok) throw new Error(`เซิร์ฟเวอร์ตอบ HTTP ${res.status} — ลองใหม่อีกครั้ง`);
    const json = await res.json();
    if (json.result !== 'success') throw new Error(json.message || 'แปลงไม่สำเร็จ (backend error)');

    const rawText = json.raw || '';
    if (json.finishReason === 'MAX_TOKENS') {
        const recovered = recoverQuestionsFromJSON(rawText);
        if (recovered.length > 0) {
            Swal.fire({
                toast: true, icon: 'warning', position: 'top-end',
                title: `JSON ถูกตัด (MAX_TOKENS) — กู้คืนได้ ${recovered.length} ข้อ`,
                timer: 4000, showConfirmButton: false
            });
            return { meta: { source: 'partial', converted: recovered.length }, questions: recovered };
        }
        throw new Error('JSON ถูกตัดกลางคัน (MAX_TOKENS) — ลอง PDF ที่มีข้อน้อยกว่า หรือแบ่งชุดเล็กลง');
    }
    if (json.finishReason && json.finishReason !== 'STOP') {
        throw new Error(`Gemini หยุดด้วยเหตุผล: ${json.finishReason}`);
    }
    return rawText;
}

// ─── เติมตัวเลือกที่ว่างด้วย AI (medical-quiz-converter rules 3&4) ──────────
// targets: [{id, problem, answer, existingChoices}] — id = rowIndex ใน converterStorage.ques
// สร้าง prompt ให้ Gemini เติมตัวเลือกให้ครบ 5 ข้อ โดยอ้างอิงเนื้อหาจาก PDF ต้นฉบับ
function buildFillChoicesPrompt(targets) {
    const items = targets.map(t => {
        const cur = (t.existingChoices && t.existingChoices.length)
            ? `\n  ตัวเลือกที่มีอยู่: ${t.existingChoices.join(' / ')}` : '';
        const ans = t.answer ? `\n  คำตอบที่ถูก (ต้องคงไว้ตรงเป๊ะ): ${t.answer}` : '';
        return `[id=${t.id}] ${t.problem}${cur}${ans}`;
    }).join('\n\n');

    return `คุณเป็น AI ผู้ช่วยเติมตัวเลือกข้อสอบแพทย์ โดยอ้างอิงเนื้อหาจากไฟล์ PDF ต้นฉบับที่แนบมา
ข้อสอบต่อไปนี้มีตัวเลือกว่างหรือไม่ครบ ให้เติมให้ครบ "5 ตัวเลือก" ต่อข้อ

ส่งกลับ JSON object นี้เท่านั้น — ไม่มี markdown ไม่มีข้อความอื่น:
{"questions":[{"id":<เลข id เดิม>,"choices":"A///B///C///D///E","answer":"ตัวเลือกที่ถูก"}]}

กฎที่ต้องทำตามอย่างเคร่งครัด:
1. choices ต้องมี 5 ตัวเลือกพอดี คั่นด้วย /// (ไม่มีเว้นวรรคก่อน/หลัง ///)
2. ถ้าโจทย์มี "คำตอบที่ถูก" อยู่แล้ว ต้องใส่คำตอบนั้นเป็นหนึ่งใน choices แบบตรงเป๊ะ ตัวอักษรต่อตัวอักษร
3. answer ต้องตรงกับข้อความหนึ่งใน choices แบบตรงเป๊ะ
4. ตัวลวง (distractor) ต้องเป็นตัวเลือกทางการแพทย์ที่สมเหตุสมผล ไม่ซ้ำกับคำตอบที่ถูก ไม่ซ้ำกันเอง
5. ห้ามใส่เครื่องหมาย /// ภายในตัวเลือกเดียว
6. คืน id เดิมของทุกข้อให้ครบ ห้ามสลับหรือข้าม

ข้อสอบที่ต้องเติม:
${items}`;
}

// ยิง 1 POST เติมตัวเลือกทุกข้อพร้อมกัน (ประหยัดโควต้า) — คืน [{id, choices, answer}]
// payloadExtra: { pdfB64 } (ไฟล์ ≤14MB) หรือ { images } (ไฟล์ใหญ่ → ภาพเฉพาะหน้าที่เกี่ยวข้อง)
// backend บังคับต้องมี pdf/รูป (ห้าม prompt ล้วน)
async function fillEmptyChoicesViaGAS(targets, payloadExtra) {
    const prompt = buildFillChoicesPrompt(targets);
    const raw = await convertBatchViaGAS(prompt, payloadExtra);
    const parsed = parseGeminiResponse(raw);
    return Array.isArray(parsed.questions) ? parsed.questions : [];
}

// Port of Python extract_valid_questions_from_broken_json
// Brace-depth scanner — extracts valid {problem/choices} objects from truncated JSON
function recoverQuestionsFromJSON(raw) {
    const questions = [];
    let depth = 0;
    let start = null;

    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && start !== null) {
                const objStr = raw.substring(start, i + 1);
                try {
                    const obj = JSON.parse(objStr);
                    if (obj.problem || obj.choices) questions.push(obj);
                } catch (e) {}
                start = null;
            }
        }
    }
    return questions;
}

// Parse Gemini response with 4-tier fallback
// Returns {meta?, questions: [...]}
function parseGeminiResponse(rawText) {
    // Already parsed (recovery path from MAX_TOKENS handling)
    if (typeof rawText === 'object' && rawText.questions) return rawText;

    // Tier 1: direct JSON.parse
    try {
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
        const obj = JSON.parse(cleaned);
        if (obj.questions) return obj;
        if (Array.isArray(obj)) return { questions: obj };
        // Handle old {CategoryID: [...]} flat format
        const keys = Object.keys(obj);
        if (keys.length > 0 && Array.isArray(obj[keys[0]])) {
            const questions = [];
            for (const [catId, qs] of Object.entries(obj)) {
                if (Array.isArray(qs)) qs.forEach(q => {
                    if (!q.category) q.category = [catId];
                    questions.push(q);
                });
            }
            return { questions };
        }
    } catch (e) {}

    // Tier 2: find outer {}
    const firstBrace = rawText.indexOf('{');
    const lastBrace = rawText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
            const obj = JSON.parse(rawText.substring(firstBrace, lastBrace + 1));
            if (obj.questions) return obj;
            if (Array.isArray(obj)) return { questions: obj };
        } catch (e) {}
    }

    // Tier 3: find outer []
    const firstBracket = rawText.indexOf('[');
    const lastBracket = rawText.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        try {
            const arr = JSON.parse(rawText.substring(firstBracket, lastBracket + 1));
            if (Array.isArray(arr)) return { questions: arr };
        } catch (e) {}
    }

    // Tier 4: brace-depth recovery
    const recovered = recoverQuestionsFromJSON(rawText);
    if (recovered.length > 0) {
        Swal.fire({
            toast: true, icon: 'warning', position: 'top-end',
            title: `JSON ไม่สมบูรณ์ — กู้คืนได้ ${recovered.length} ข้อ`,
            timer: 4000, showConfirmButton: false
        });
        return { questions: recovered };
    }

    throw new Error('Gemini ส่ง JSON ไม่ถูกต้อง: ' + rawText.substring(0, 300));
}

// Group questions by category[0], fill #jsonInput, call processAll(), then populate pageHintMap
function groupAndFeedToProcessAll(questions, fileStem) {
    const grouped = {};

    questions.forEach(q => {
        const key = (Array.isArray(q.category) && q.category[0]) ? q.category[0] : fileStem;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(q);
    });

    document.getElementById('jsonInput').value = JSON.stringify(grouped, null, 2);
    processAll(); // clears pageHintMap inside its reset block — populate AFTER

    // Align pageHint to converterStorage.ques rows in the same Object.values order
    // processAll CASE 2 pushes rows in Object.entries(quizObj) → questions forEach order
    let rowIdx = 0;
    for (const qs of Object.values(grouped)) {
        qs.forEach(q => {
            if (q.pageHint != null) pageHintMap.set(rowIdx, q.pageHint);
            rowIdx++;
        });
    }
}

// แปลงแบบชุดรูปหน้ากระดาษหลายชุด — ทน RECITATION รายชุด: ชุดที่โดนตัวกรองตายชุดเดียว ชุดอื่นรอด
// error อื่น (auth/network/quota) โยนต่อทันที — ไม่เผา quota กับชุดที่เหลือ
async function convertImageBatches(batches, additionalPrompt, statusEl, allowedCats, forcedCat0) {
    const questions = [];
    const failed = [];
    for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        statusEl.textContent = `ชุดที่ ${b + 1}/${batches.length} (หน้า ${batch.start}-${batch.end}) — กำลังเตรียมภาพ…`;
        const pages = await renderPagesAsBase64(currentPdfDoc, batch);
        const pageNote = `หมายเหตุ: รูปที่แนบมาคือหน้า ${batch.start} ถึง ${batch.end} ของ PDF (เรียงตามลำดับ) — pageHint ต้องใช้เลขหน้าจริงเหล่านี้`;
        statusEl.textContent = `ชุดที่ ${b + 1}/${batches.length} — กำลังส่งให้ระบบแปลง…`;
        try {
            const raw = await convertBatchViaGAS(buildConverterPrompt(additionalPrompt, pageNote, allowedCats, forcedCat0), {
                images: pages.map(p => p.dataUrl)
            });
            const qs = parseGeminiResponse(raw).questions;
            questions.push(...qs);
            statusEl.textContent = `ชุดที่ ${b + 1}/${batches.length} เสร็จ — ได้ ${qs.length} ข้อ (รวม ${questions.length})`;
        } catch (err) {
            if (!String(err.message).includes('RECITATION')) throw err;
            failed.push(batch);
            Swal.fire({
                toast: true, icon: 'warning', position: 'top-end',
                title: `หน้า ${batch.start}-${batch.end} โดนตัวกรอง recitation — ข้ามชุดนี้`,
                timer: 4000, showConfirmButton: false
            });
        }
    }
    return { questions, failed };
}

// Main entry point: takes raw File object (batching ใช้ currentPdfDoc จาก converter.js)
// batch เดียว → ส่ง PDF ทั้งไฟล์แบบ native (คุณภาพ OCR ดีสุด); หลาย batch → render หน้าเป็น JPEG ส่งทีละชุด
// (1 POST ต่อ batch — อยู่ใต้ GAS 6-min limit เสมอ)
async function runGeminiConversion(file, filename) {
    const statusEl = document.getElementById('pdf-status');

    // Edit 4: 50MB hard cap (กันหลุดมาจาก path อื่น) — >14MB ไม่ reject แล้ว แต่บังคับส่งแบบภาพแทน
    if (file.size > 50 * 1024 * 1024) {
        throw new Error(`PDF มีขนาด ${(file.size / 1024 / 1024).toFixed(1)}MB — เกินขีดจำกัด 50MB กรุณาแบ่งไฟล์ก่อน`);
    }
    // >14MB: base64 ×1.37 เกิน inline limit ของ Gemini → ห้าม native PDF, บังคับ image-render path
    // (renderPagesAsBase64 cap 900px/JPEG0.65 — ขนาดไฟล์ต้นทางไม่มีผล)
    const forceImagePath = file.size > 14 * 1024 * 1024;

    const { subjectCode, examGroup } = parseFilenameMetadata(filename);

    if (!document.getElementById('subjID').value.trim()) {
        document.getElementById('subjID').value = subjectCode;
    }

    // หัวข้อบรรยายจริงของวิชานี้ (จากชีต) → บังคับ Gemini จัดหมวดลงหัวข้อ e-learning จริง
    const subjId = (document.getElementById('subjID').value || subjectCode).trim();

    // Edit 3: กลุ่มข้อสอบที่ผู้ใช้เลือกจากชิป — ถ้าเลือก ชนะการเดาจากชื่อไฟล์ + บังคับ category[0]
    const pickedGroup = (typeof getPickedExamGroup === 'function') ? getPickedExamGroup() : '';
    const forcedCat0 = pickedGroup ? `${subjId.toUpperCase()}_${pickedGroup}` : '';
    const fileStem = forcedCat0 || `${subjectCode}_${examGroup}`;
    // หัวข้อที่ผู้ใช้ทบทวน/ยืนยันแล้วในหน้าทบทวน (reviewCategoriesBeforeConvert) — ไม่ต้อง toast ซ้ำ
    const allowedCats = getExistingCategoriesForSubject(subjId);
    const allowedIds = new Set(allowedCats.map(c => String(c.CategoryID)));

    const additionalPrompt = (document.getElementById('extra-prompt') || {}).value || '';
    const batches = await checkAndSplitPDF(currentPdfDoc);

    const progressEl = document.getElementById('pdf-progress');
    if (progressEl) { progressEl.classList.remove('d-none'); progressEl.removeAttribute('value'); }

    const allQuestions = [];
    let failedBatches = [];
    try {
        if (batches.length === 1 && !forceImagePath) {
            // ── ทั้งไฟล์ในครั้งเดียว: native PDF ผ่าน proxy ──
            statusEl.textContent = 'กำลังอ่านไฟล์ PDF…';
            const pdfB64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            statusEl.textContent = 'กำลังส่ง PDF ให้ระบบแปลง (key กลาง)…';
            try {
                const raw = await convertBatchViaGAS(buildConverterPrompt(additionalPrompt, '', allowedCats, forcedCat0), { pdfB64 });
                allQuestions.push(...parseGeminiResponse(raw).questions);
            } catch (err) {
                if (!String(err.message).includes('RECITATION')) throw err;
                // ทั้งไฟล์โดนตัวกรอง recitation → auto-fallback: แบ่งเป็นชุดรูปหน้าละ 4 ให้รอดเป็นรายชุด
                statusEl.textContent = 'โดนตัวกรอง recitation — ลองใหม่แบบแบ่งชุดเล็ก (4 หน้า/ชุด)…';
                const total = currentPdfDoc.numPages;
                const small = [];
                for (let s = 1; s <= total; s += 4) small.push({ start: s, end: Math.min(s + 3, total) });
                const res = await convertImageBatches(small, additionalPrompt, statusEl, allowedCats, forcedCat0);
                allQuestions.push(...res.questions);
                failedBatches = res.failed;
                if (allQuestions.length === 0) throw err; // โดนทุกชุด — โยน error เดิมพร้อมคำแนะนำ
            }
        } else {
            // ── หลายชุด: render หน้าเป็นภาพ ส่ง 1 POST ต่อชุด (ทน recitation รายชุด) ──
            const res = await convertImageBatches(batches, additionalPrompt, statusEl, allowedCats, forcedCat0);
            allQuestions.push(...res.questions);
            failedBatches = res.failed;
            if (allQuestions.length === 0 && failedBatches.length > 0) {
                throw new Error('ทุกชุดโดนตัวกรอง recitation ของ Gemini — ลองกดแปลงซ้ำอีกครั้ง');
            }
        }
    } finally {
        if (progressEl) progressEl.classList.add('d-none');
    }

    // Sanitize every question's category — คง CategoryID ที่ตรงกับหัวข้อจริงไว้ทั้งดุ้น
    allQuestions.forEach(q => {
        q.category = sanitizeCategory(q.category, fileStem, allowedIds);
        if (forcedCat0) q.category[0] = forcedCat0; // ชิปผู้ใช้ = เด็ดขาด แม้ Gemini เขียนมาอย่างอื่น
    });

    statusEl.textContent = `กำลังโหลดข้อมูล ${allQuestions.length} ข้อ…`;
    groupAndFeedToProcessAll(allQuestions, fileStem);

    statusEl.textContent = failedBatches.length > 0
        ? `✅ แปลงได้ ${allQuestions.length} ข้อ (ข้าม ${failedBatches.length} ชุดที่โดน recitation: หน้า ${failedBatches.map(b => `${b.start}-${b.end}`).join(', ')})`
        : `✅ แปลงสำเร็จ ${allQuestions.length} ข้อ`;
}
