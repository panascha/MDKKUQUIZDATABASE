// ─────────────────────────────────────────────────────
// JS/GEMINI.JS  — Gemini inline-PDF conversion
// Single REST call: sends raw PDF as application/pdf inline_data
// ─────────────────────────────────────────────────────

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

function getGeminiKey() {
    return sessionStorage.getItem('mdkku_gemini_key') || '';
}

function toggleGeminiKeyVis() {
    const el = document.getElementById('gemini-api-key');
    el.type = el.type === 'password' ? 'text' : 'password';
}

function getGeminiModel() {
    const sel = document.getElementById('gemini-model-select');
    return sel ? sel.value : 'gemini-3.5-flash';
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

function sanitizeCategory(categoryData, stem) {
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

    // Validate category[0]: must start with SUBJ_GROUP pattern
    if (!/^[A-Z0-9]+_[A-Z0-9]/i.test(String(cats[0]))) {
        cats[0] = stem;
    }

    // Validate/fix category[1]: try to ensure SubCode_SubGroup_Topic
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

    return [cats[0], cats[1]];
}

// Construct Gemini REST body with inline PDF
function buildGeminiRequestPDF(pdfB64, additionalPrompt, model) {
    const maxTokens = model && model.includes('pro') ? 65536 : 32768;

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
7. ไม่แปลหรือเปลี่ยนภาษาของโจทย์ — ข้อความตรงตาม PDF${additionalPrompt ? '\n' + additionalPrompt : ''}`;

    return {
        contents: [{
            parts: [
                { text: prompt },
                { inline_data: { mime_type: 'application/pdf', data: pdfB64 } }
            ]
        }],
        generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.1,
            max_output_tokens: maxTokens
        }
    };
}

// Single Gemini call with retry×3 on 429
async function callGeminiWithPDF(pdfB64, additionalPrompt, model) {
    const key = getGeminiKey();
    if (!key) throw new Error('กรุณากรอก Gemini API Key');

    const url = `${GEMINI_API_BASE}${model}:generateContent?key=${key}`;
    const body = buildGeminiRequestPDF(pdfB64, additionalPrompt, model);
    const statusEl = document.getElementById('pdf-status');

    const MAX_RETRY = 3;
    let res;
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
        if (attempt > 0) {
            const waitSec = Math.pow(2, attempt); // 2s, 4s
            for (let t = waitSec; t > 0; t--) {
                if (statusEl) statusEl.textContent = `Gemini: rate limit — รอ ${t}s แล้วลองใหม่ (${attempt}/${MAX_RETRY})…`;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.status !== 429) break;
    }

    if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429) {
            throw new Error('Gemini quota หมด (429) — รอสักครู่แล้วลองใหม่ หรือตรวจสอบ API key');
        }
        throw new Error(`Gemini API error ${res.status}: ${errText.substring(0, 300)}`);
    }

    const json = await res.json();
    const candidate = json.candidates && json.candidates[0];
    if (!candidate) throw new Error('Gemini ไม่ส่งผลลัพธ์กลับมา');

    const rawText = candidate.content.parts.map(p => p.text || '').join('');
    const finishReason = candidate.finishReason;

    if (finishReason === 'MAX_TOKENS') {
        const recovered = recoverQuestionsFromJSON(rawText);
        if (recovered.length > 0) {
            Swal.fire({
                toast: true, icon: 'warning', position: 'top-end',
                title: `JSON ถูกตัด (MAX_TOKENS) — กู้คืนได้ ${recovered.length} ข้อ`,
                timer: 4000, showConfirmButton: false
            });
            return { meta: { source: 'partial', converted: recovered.length }, questions: recovered };
        }
        throw new Error('JSON ถูกตัดกลางคัน (MAX_TOKENS) — ลองใช้ Gemini Pro หรือ PDF ที่มีข้อน้อยกว่า');
    }
    if (finishReason && finishReason !== 'STOP') {
        throw new Error(`Gemini หยุดด้วยเหตุผล: ${finishReason}`);
    }

    return rawText;
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

// Main entry point: takes raw File object (not pdfDoc)
async function runGeminiConversion(file, filename) {
    const statusEl = document.getElementById('pdf-status');
    const model = getGeminiModel();

    // 14MB cap: base64 inflates ~33%, keeping request well under Gemini's inline limit
    if (file.size > 14 * 1024 * 1024) {
        throw new Error(`PDF มีขนาด ${(file.size / 1024 / 1024).toFixed(1)}MB — เกินขีดจำกัด 14MB สำหรับ inline PDF กรุณาแบ่งไฟล์ก่อน`);
    }

    const { subjectCode, examGroup } = parseFilenameMetadata(filename);
    const fileStem = `${subjectCode}_${examGroup}`;

    if (!document.getElementById('subjID').value.trim()) {
        document.getElementById('subjID').value = subjectCode;
    }

    statusEl.textContent = 'กำลังอ่านไฟล์ PDF…';
    const pdfB64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    const additionalPrompt = (document.getElementById('extra-prompt') || {}).value || '';

    statusEl.textContent = `กำลังส่ง PDF ให้ Gemini (${model})…`;
    const progressEl = document.getElementById('pdf-progress');
    if (progressEl) { progressEl.classList.remove('d-none'); progressEl.removeAttribute('value'); }
    let rawResponse;
    try {
        rawResponse = await callGeminiWithPDF(pdfB64, additionalPrompt, model);
    } finally {
        if (progressEl) progressEl.classList.add('d-none');
    }

    statusEl.textContent = 'กำลัง parse ผลลัพธ์…';
    const parsed = parseGeminiResponse(rawResponse);

    // Sanitize every question's category to [defaultCat, standardizedCat]
    parsed.questions.forEach(q => {
        q.category = sanitizeCategory(q.category, fileStem);
    });

    statusEl.textContent = `กำลังโหลดข้อมูล ${parsed.questions.length} ข้อ…`;
    groupAndFeedToProcessAll(parsed.questions, fileStem);

    statusEl.textContent = `✅ แปลงสำเร็จ ${parsed.questions.length} ข้อ`;
}
