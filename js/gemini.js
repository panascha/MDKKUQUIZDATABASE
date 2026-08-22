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
    // strip leading batch prefix: "(MD49) " or bare "MD52_" — both forms, batch captured separately
    let batch = '';
    const prefixMatch = base.match(/^(?:\(\s*MD\s*(\d+)\s*\)|MD\s*(\d+))[_\s]*/i);
    if (prefixMatch) {
        batch = prefixMatch[1] || prefixMatch[2] || '';
        base = base.slice(prefixMatch[0].length);
    }
    const parts = base.split(/[_\s]+/).filter(p => p.length > 0);
    const examGroup = parts[1] ? parts[1].toUpperCase() : 'EXAM';
    const roundMatch = examGroup.match(/(\d+)$/);
    return {
        batch,
        subjectCode: parts[0] ? parts[0].toUpperCase() : 'SUBJ',
        examGroup,
        round:       roundMatch ? roundMatch[1] : '',
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

// Strict category validation (Task 1): sanitizeCategory() only reshapes category[1] into
// SubCode_SubGroup_Topic form — it does NOT check the topic itself is real. Gemini can still
// invent a plausible-looking but nonexistent CategoryID. This is the actual gate.
// ทำงานเฉพาะเมื่อวิชานี้มีหัวข้อที่รู้จักอยู่แล้ว (validIds.size > 0) — วิชาใหม่ที่ยังไม่มีหัวข้อในชีตเลย
// ต้องปล่อยผ่านหมด ไม่งั้นการ import ครั้งแรกของวิชาใหม่จะใช้งานไม่ได้
// รูปแบบ Fallback ต้อง "ไม่มีวันผ่าน" filter ของ getExistingCategoriesForSubject() เอง (2 ส่วน ไม่มี
// subgroup token) — ถ้าใช้รูปแบบ 3 ส่วนแบบ SUBJ_CLINICAL_Uncategorized (3 ส่วน + มี subgroup จริง
// คือ CLINICAL) มันจะผ่าน filter นั้นได้เอง แล้วโดนดูดเข้า allowedIds ในรอบถัดไป กลายเป็น "หัวข้อจริง"
// ที่ AI เลือกซ้ำได้ — คือช่องโหว่เดิมที่ Task 1 ตั้งใจปิดย้อนกลับมาเปิดเองแบบเงียบ ๆ
function enforceKnownTopic(cats, subjId, validIds) {
    const valid = (validIds && typeof validIds.has === 'function') ? validIds : new Set();
    if (valid.size === 0 || valid.has(String(cats[1]))) return cats;
    cats[1] = `${String(subjId).trim().toUpperCase()}_Uncategorized`;
    return cats;
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
// expectCount: จำนวนข้อที่นับได้จาก text layer ของชุดนี้ — บอกโมเดลตรง ๆ ว่าต้องได้กี่ข้อ
function buildConverterPrompt(additionalPrompt, pageNote, allowedCats, forcedCat0, expectCount) {
    const prompt = `คุณเป็น AI แปลงข้อสอบแพทย์จาก PDF เป็น JSON
ส่งกลับ JSON object นี้เท่านั้น — ไม่มี markdown, ไม่มีข้อความอื่น:
{
  "meta": {"source": "ชื่อไฟล์", "converted": <จำนวนข้อ>},
  "questions": [
    {
      "problem": "ข้อความโจทย์เต็ม คงเลขข้อเดิมจาก PDF ไว้ถ้ามี (ไม่มีรายการตัวเลือก)",
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
1. choices ใช้ /// คั่นระหว่างตัวเลือก (5 ตัวเลือกถ้าเป็นไปได้) ห้ามใส่ "-" หรือเว้นว่างเป็นตัวเลือกเด็ดขาด —
   ถ้าต้นฉบับมีตัวเลือกไม่ครบ 5 ให้ใส่เท่าที่อ่านได้จริงเท่านั้น (choices สั้นกว่า 5 รายการได้ ห้ามเติม "-" ยัดให้ครบ)
1.1 problem ต้องมีเฉพาะข้อความโจทย์ ห้ามมีรายการตัวเลือก (A. B. C. …) ปนอยู่ — ตัวเลือกอยู่ใน choices เท่านั้น
1.2 problem ต้องคงเลขข้อเดิมจากต้นฉบับ PDF ไว้ตรงตามที่ปรากฏ (เช่น "1.", "2)", "ข้อ 3.") ห้ามตัดออกหรือแก้รูปแบบ
1.3 ถ้าโจทย์อ้างอิงรูปภาพด้วยเลข (เช่น "Figure 1", "รูปที่ 2", "ภาพที่ 3") ให้คงข้อความอ้างอิงนั้นไว้ใน problem
    ตรงตามที่ปรากฏ — ใช้จับคู่รูปภาพที่ถูกต้องกับข้อคำถามในขั้นตอนถัดไป ห้ามตัดทิ้งหรือสรุปใหม่
2. answer ต้องตรงกับข้อความใน choices แบบตรงเป๊ะทุกตัวอักษร ห้ามมีตัวอักษรตัวเลือกนำหน้า (เช่น "A. ", "b) ")
   ปนอยู่ใน answer เด็ดขาด — คัดลอกเฉพาะเนื้อความของตัวเลือกที่ถูกต้องมาเท่านั้น
3. explain ต้องเขียนเป็น "ภาษาไทยผสมศัพท์ทางการแพทย์ภาษาอังกฤษ" — ห้ามใช้ภาษาอังกฤษอย่างเดียว
   โครงสร้าง explain ต้องเป็นย่อหน้าเดียวต่อเนื่อง (ไม่แบ่งบรรทัด) ครอบคลุม 4 ประเด็นต่อไปนี้ แต่ห้ามเขียนหัวข้อ
   หรือป้ายชื่อประเด็นลงในเนื้อหาจริง (เช่น ห้ามมีคำว่า "ส่วนที่ 1" ปรากฏในข้อความ):
   - กลไก/พยาธิสภาพ หรือประเด็นการวินิจฉัยที่เป็นแก่นของข้อนี้ — อธิบายเป็น causal chain แบบเหตุ-ผลต่อเนื่อง (A → B → C) ว่าทำไมแต่ละขั้นตอนจึงเกิดขึ้น
   - เหตุผลที่คำตอบถูก — ชี้ไปที่จุดสำคัญ/keyword ในโจทย์หรือรูปภาพที่บ่งบอกคำตอบ
   - อธิบายว่าทำไมตัวลวงอื่นถึงผิด (เช่น "ส่วนข้อ B ผิดเพราะ..." "ข้อ C ไม่ใช่เพราะ...")
   - Clinical Pearl, Guideline หรือ keyword สำคัญอื่นๆ ที่เกี่ยวข้องกับข้อนี้ ที่ต้องรู้
   **ห้ามขึ้นต้น explain ด้วยวลีซ้ำ ๆ เช่น "แนวคิดหลักคือ...", "แนวคิดหลักของ...คือ...",
   "เหตุผลที่คำตอบถูกเนื่องจาก..." — ให้เริ่มประโยคแรกด้วยเนื้อหาการวินิจฉัย/กลไกของโรคโดยตรงเป็นภาษาธรรมชาติ**
4. img ใส่ "require_img" ถ้าโจทย์มีรูปภาพ/กราฟ/ตารางที่จำเป็นต้องดูเพื่อตอบ
5. category[0]: "ชื่อย่อวิชา_กลุ่มข้อสอบ" รูปแบบ SubjectCode_ExamGroup เช่น "GI_51MCQ1", "CVS_50FMT", "RESP_52QUIZ2", "NS_51LAB", "HEMATO_51MCQ1"
6. category[1]: "ชื่อย่อวิชา_กลุ่มวิชาย่อย_หัวข้อ" โดยกลุ่มวิชาย่อยต้องเป็นหนึ่งใน: ANA, BIOCHEM, PHYSIO, MICRO, PARASITO, PATHO, PHARM, RADIO, CLINICAL
7. ไม่แปลหรือเปลี่ยนภาษาของโจทย์ — ข้อความตรงตาม PDF
8. **ความครบถ้วนสำคัญที่สุด — ต้องแปลงให้ครบทุกข้อที่ปรากฏในไฟล์/รูปที่แนบมา**
   ห้ามข้ามข้อ ห้ามเลือกมาเฉพาะบางข้อ ห้ามสรุปย่อ และห้ามหยุดกลางคัน
   ถ้าเอกสารมี N ข้อ ต้องคืน questions ครบทั้ง N รายการ และ meta.converted ต้องเท่ากับ N
   ถ้าข้อไหนอ่านไม่ชัดหรือตัวเลือกไม่ครบ ให้ใส่เท่าที่อ่านได้ — ต้องมีรายการของข้อนั้นอยู่เสมอ ห้ามตัดทิ้ง
   เขียน explain ให้กระชับได้ แต่ต้องครบทุกข้อ — "ครบทุกข้อ" สำคัญกว่า "อธิบายยาว"
9. ถ้าโจทย์ต้นฉบับไม่สมบูรณ์ (ประโยคขาดหาย/พิมพ์ตกหล่น/อ่านไม่ครบ) และคุณต้องเติมข้อความให้สมบูรณ์เพื่อให้อ่านเข้าใจได้
   ให้ต่อท้าย problem ด้วย " [⚠️ เพิ่มเติมเพื่อความสมบูรณ์: <สรุปสั้นๆ ว่าเติมอะไรไป>]" เพื่อให้ผู้ตรวจทานรู้ว่าส่วนนั้น AI เติมเอง ไม่ใช่ต้นฉบับ
   ข้อความ [⚠️ ...] นี้ใช้ได้เฉพาะต่อท้าย problem เท่านั้น ห้ามใส่ลงใน choices เด็ดขาด — ถ้าตัวเลือกขาดหายให้เว้นไว้ตามกฎข้อ 1${expectCount > 0 ? `\n\n**จำนวนข้อขั้นต่ำ:** ชุดนี้นับได้ "อย่างน้อย" ${expectCount} ข้อ (อาจมีมากกว่านี้)
   ต้องคืน questions ไม่น้อยกว่า ${expectCount} รายการ และถ้าเห็นข้อมากกว่านั้น ให้คืนมาให้ครบทุกข้อที่เห็น — ห้ามหยุดที่ ${expectCount}` : ''}${forcedCat0 ? `\n\n**บังคับใช้แทนกฎข้อ 5:** category[0] ของทุกข้อต้องเป็น "${forcedCat0}" เท่านั้น — คัดลอกตรงเป๊ะ ห้ามเปลี่ยน` : ''}${buildAllowedTopicsBlock(allowedCats)}${pageNote ? '\n' + pageNote : ''}${additionalPrompt ? '\n' + additionalPrompt : ''}`;

    return prompt;
}

// บันทึกผลการยิงแต่ละ batch ไว้วินิจฉัย — เคลียร์ทุกครั้งที่เริ่มแปลงใหม่ใน runGeminiConversion
// เก็บ finishReason/servedModel/usage เพื่อแยกให้ออกว่า "ข้อหาย" เกิดจาก
//   (ก) โมเดลออกข้อไม่ครบเอง  finishReason STOP + candidatesTokenCount ต่ำ
//   (ข) คำตอบถูกตัด           finishReason MAX_TOKENS
//   (ค) thinking กินโควต้า output  thoughtsTokenCount สูงทั้งที่สั่ง thinkingBudget:0
// ดูได้จาก console: convDiagnostics
let convDiagnostics = [];

// ยิง 1 batch ไปที่ GAS convertPdfBatch — ไม่ auto-retry (กันเผา quota pool ซ้ำถ้า Gemini สำเร็จแต่ response หาย)
// payloadExtra: { pdfB64 } หรือ { images: [dataURL,…] }
// label: ติด tag ใน convDiagnostics เฉย ๆ (optional) — เผื่อแยกให้ออกว่าแถวไหนเป็นรอบแปลงจริง
// กับรอบ refine ทีหลัง ไม่งั้นดูใน console แล้วสับสนว่าทำไม batch เดียวยิงหลายครั้ง
// คืนค่า rawText (string) หรือ recovered object {questions:[…]} กรณี MAX_TOKENS
async function convertBatchViaGAS(prompt, payloadExtra, label) {
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
    // ไฟล์ใหญ่/หลายข้อ → GAS อาจชน 6 นาที แล้วตอบหน้า error เป็น HTML (ไม่ใช่ JSON)
    // res.json() จะโยน SyntaxError ที่อ่านไม่รู้เรื่อง — แปลงเป็นข้อความที่บอกทางแก้แทน
    const bodyText = await res.text();
    let json;
    try {
        json = JSON.parse(bodyText);
    } catch (e) {
        throw new Error('เซิร์ฟเวอร์ไม่ได้ตอบเป็น JSON (ไฟล์อาจใหญ่เกินจนแปลงไม่ทันใน 6 นาที) — ลองแบ่ง PDF ให้เล็กลงแล้วแปลงใหม่');
    }
    if (json.result !== 'success') throw new Error(json.message || 'แปลงไม่สำเร็จ (backend error)');

    const rawText = json.raw || '';
    // breadcrumb: เก็บทุกครั้งก่อน parse — ถ้าข้อหาย จะย้อนดูได้ว่าโมเดลหยุดเองหรือถูกตัด
    convDiagnostics.push({
        label: label || null,
        finishReason: json.finishReason || null,
        servedModel: json.servedModel || null,
        usage: json.usage || null,
        rawChars: rawText.length,
        rawTail: rawText.slice(-120) // ปิด JSON ครบ (…}]}) = โมเดลจบเอง / ขาดกลาง = ถูกตัด
    });
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
// ต้องเริ่มสแกน "ข้างใน" array questions: รูปแบบที่ prompt บังคับคือ {"meta":…,"questions":[…]}
// ถ้าเริ่มที่ index 0 depth จะไม่มีวันกลับมา 0 (object นอกสุดถูกตัดหาย) → กู้ได้ 0 ข้อเสมอ
// ข้าม { } ที่อยู่ในสตริง (เช่น สูตร/วงเล็บปีกกาใน explain) ไม่งั้นนับ depth เพี้ยน
function recoverQuestionsFromJSON(raw) {
    const text = String(raw || '');
    const questions = [];

    const qKey = text.search(/"questions"\s*:\s*\[/);
    const bracket = qKey === -1 ? -1 : text.indexOf('[', qKey);
    let i = bracket === -1 ? 0 : bracket + 1;

    let depth = 0;
    let start = null;
    let inStr = false;
    let esc = false;

    for (; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && start !== null) {
                const objStr = text.substring(start, i + 1);
                try {
                    const obj = JSON.parse(objStr);
                    if (obj.problem || obj.choices) questions.push(obj);
                } catch (e) {}
                start = null;
            } else if (depth < 0) {
                depth = 0; start = null; // } ปิด array/object ที่ครอบอยู่ — เริ่มนับใหม่
            }
        }
    }
    return questions;
}

// Parse Gemini response with 4-tier fallback
// Returns {meta?, questions: [...]}
function parseGeminiResponse(rawText) {
    let result = null;

    // Already parsed (recovery path from MAX_TOKENS handling)
    if (typeof rawText === 'object' && rawText.questions) {
        result = rawText;
    } else {
        // Tier 1: direct JSON.parse
        try {
            const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
            const obj = JSON.parse(cleaned);
            if (obj.questions) {
                result = obj;
            } else if (Array.isArray(obj)) {
                result = { questions: obj };
            } else {
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
                    result = { questions };
                }
            }
        } catch (e) {}

        // Tier 2: find outer {}
        if (!result) {
            const firstBrace = rawText.indexOf('{');
            const lastBrace = rawText.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
                try {
                    const obj = JSON.parse(rawText.substring(firstBrace, lastBrace + 1));
                    if (obj.questions) {
                        result = obj;
                    } else if (Array.isArray(obj)) {
                        result = { questions: obj };
                    }
                } catch (e) {}
            }
        }

        // Tier 3: find outer []
        if (!result) {
            const firstBracket = rawText.indexOf('[');
            const lastBracket = rawText.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket > firstBracket) {
                try {
                    const arr = JSON.parse(rawText.substring(firstBracket, lastBracket + 1));
                    if (Array.isArray(arr)) result = { questions: arr };
                } catch (e) {}
            }
        }

        // Tier 4: brace-depth recovery
        if (!result) {
            const recovered = recoverQuestionsFromJSON(rawText);
            if (recovered.length > 0) {
                Swal.fire({
                    toast: true, icon: 'warning', position: 'top-end',
                    title: `JSON ไม่สมบูรณ์ — กู้คืนได้ ${recovered.length} ข้อ`,
                    timer: 4000, showConfirmButton: false
                });
                // source:'partial' = ข้อมูลไม่ครบ — ต้องส่งต่อถึงหน้าสรุป ห้ามรายงานว่า "ครบถ้วน"
                result = { meta: { source: 'partial', converted: recovered.length }, questions: recovered };
            }
        }
    }

    if (!result) {
        throw new Error('Gemini ส่ง JSON ไม่ถูกต้อง: ' + rawText.substring(0, 300));
    }

    // Validate category[0] format (non-blocking warning)
    validateCategoryFormat(result.questions);

    return result;
}

// ตัดรายการตัวเลือกที่ Gemini แถมมาท้ายโจทย์ — ตัดเฉพาะจุดที่ตามด้วย choices[0] จริงเท่านั้น
// ตรวจแบบ startsWith กับตัวเลือกแรก → ไม่ตัดโจทย์ที่มีรายการ A. B. ของตัวเอง (เช่น ค่า lab)
function stripChoiceTail(problem, choicesRaw) {
    const text = String(problem || '').trim();
    const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
    // ตัดหัวตัวอักษรออกจากตัวเลือกแรกด้วย (บางครั้ง Gemini เขียน "A. Dengue" ลง choices ทั้งดุ้น)
    const first = norm(String(choicesRaw || '').split('///')[0]).replace(/^[a-eก-ฅ]\s*[.)]\s*/, '');
    if (!first || !text) return text;

    const marker = /(?:^|\n|\s)\s*(?:[A-Ea-eก-ฅ]|\d{1,2})\s*[.)]\s*/g;
    let m;
    while ((m = marker.exec(text)) !== null) {
        if (norm(text.slice(m.index + m[0].length)).indexOf(first) === 0) {
            const head = text.slice(0, m.index).trim();
            return head || text; // ตัดแล้วเหลือว่าง = โจทย์เป็นตัวเลือกล้วน คืนของเดิม
        }
    }
    return text;
}

// ตัด placeholder "(image required)" ที่ Gemini แถมมาในเนื้อโจทย์ — ต้องใส่ "require_img" ใน q.img แทน ไม่ใช่ปนในข้อความ
function stripImagePlaceholder(text) {
    const raw = String(text || '').trim();
    const out = raw.replace(/\(\s*image\s+required\s*\)/gi, '').replace(/\s{2,}/g, ' ').trim();
    return out || raw; // ตัดแล้วว่าง = ตัดผิด คืนของเดิม
}

// ตัดตัวอักษรตัวเลือกนำหน้า (A. / B) / …) ออกจากแต่ละ choice — เนื้อหาซ้ำกับตำแหน่งในลิสต์อยู่แล้ว
// ตัดเฉพาะเมื่อทุกตัวเลือกขึ้นต้นด้วย A, B, C, … เรียงตามลำดับจริงเท่านั้น
// ไม่งั้นชื่อจุลชีพย่อ ("E. coli", "C. albicans", "B. cereus") จะถูกตัดหัวเหลือ "coli"/"albicans"
function stripChoiceLetters(choicesRaw) {
    const raw = String(choicesRaw || '');
    if (!raw) return raw;
    const parts = raw.split('///');
    const marker = /^\s*([A-Ea-e])\s*[.)]\s*/;
    const isEnumerated = parts.every((c, i) => {
        const m = c.match(marker);
        return m && m[1].toUpperCase() === String.fromCharCode(65 + i);
    });
    if (!isEnumerated) return raw;
    return parts.map(c => c.replace(marker, '').trim()).join('///');
}

// ตัดตัวอักษรตัวเลือกนำหน้าออกจาก answer (Gemini บางครั้งคัดลอกทั้ง "B. Acantholytic cells" มาทั้งดุ้น
// ทั้งที่ choices เก็บแค่ "Acantholytic cells" เฉยๆ) — บังคับให้ answer ตรงกับ choices แบบตรงเป๊ะ (กฎข้อ 2)
// ตัดแล้วยังไม่ตรงกับ choices เลย = ปล่อยของเดิมไว้ กันพังยิ่งกว่าเดิม
function sanitizeAnswer(answer, choicesRaw) {
    const raw = String(answer || '').trim();
    if (!raw) return raw;
    const choices = String(choicesRaw || '').split('///').map(c => c.trim());
    if (choices.includes(raw)) return raw;
    const stripped = raw.replace(/^\s*[A-Ea-eก-ฅ]\s*[.)]\s*/, '').trim();
    return choices.includes(stripped) ? stripped : raw;
}

// เน็ตกันหลุด — ตัดวลีเปิดซ้ำๆ ที่ prompt (กฎข้อ 3) สั่งห้ามแล้ว เผื่อ Gemini ยังหลุดมา
// ตัดเฉพาะแบบ "แนวคิดหลักของ X คือ ..." ที่ตัดแล้วอ่านลื่นแน่นอน (เหลือ "X คือ ...")
// แบบ "แนวคิดหลักคือ ..." ตัดแล้วเหลือวลีนามห้อยลอยไม่มีประธาน+กริยา จึงปล่อยของเดิมไว้ ดีกว่าทำให้อ่านแย่ลง
function stripExplainIntro(explain) {
    const raw = String(explain || '').trim();
    const m = raw.match(/^แนวคิดหลักของ\s*(.+)/s);
    return m ? m[1].trim() : raw;
}

// Validate category[0] format post-parse — warn if malformed (non-blocking)
// Expected: SubjectCode_YearPrefix+Group (e.g. GI_51MCQ1, CVS_50FMT, RESP_52QUIZ2)
function validateCategoryFormat(questions) {
    if (!Array.isArray(questions) || questions.length === 0) return;
    const pattern = /^\w+_\d{2}[A-Z]+\d*$/; // SubjectCode_YearGroup format
    const malformed = [];
    questions.forEach((q, i) => {
        if (Array.isArray(q.category) && q.category[0] && !pattern.test(q.category[0])) {
            malformed.push(`ข้อ ${i + 1}: "${q.category[0]}"`);
        }
    });
    if (malformed.length > 0) {
        Swal.fire({
            icon: 'warning',
            title: 'รหัสหมวดหมู่ไม่ตรงรูปแบบ',
            html: `<div class="text-start"><b>${malformed.length} ข้อ</b> มีรูปแบบ category[0] ผิดปกติ:<br><small>${malformed.slice(0, 5).join('<br>')}</small>${malformed.length > 5 ? '<br>...' : ''}<br><br>รูปแบบที่ถูกต้อง: <b>SubjectCode_YearGroup</b><br>เช่น GI_51MCQ1, CVS_50FMT, RESP_52QUIZ2</div>`,
            confirmButtonText: 'เข้าใจแล้ว'
        });
    }
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

// จำนวนข้อที่นับได้จาก text layer ในช่วงหน้าของชุดนี้ — 0 = นับไม่ได้
function expectedForBatch(detected, batch) {
    if (!detected || !detected.perPage || detected.expected <= 0) return 0;
    let n = 0;
    for (let p = batch.start; p <= batch.end; p++) n += (detected.perPage.get(p) || 0);
    return n;
}

// แปลงแบบชุดรูปหน้ากระดาษหลายชุด — ทน RECITATION รายชุด: ชุดที่โดนตัวกรองตายชุดเดียว ชุดอื่นรอด
// error อื่น (auth/network/quota) โยนต่อทันที — ไม่เผา quota กับชุดที่เหลือ
// detected: ผลจาก detectQuestionCount — ใช้บอกโมเดลว่าชุดนี้ควรได้กี่ข้อ + ตรวจชุดที่ได้ไม่ครบ
async function convertImageBatches(batches, additionalPrompt, statusEl, allowedCats, forcedCat0, detected) {
    const questions = [];
    const failed = [];
    const shortBatches = []; // ชุดที่ได้ข้อน้อยกว่าที่นับได้จาก PDF
    let truncated = false;
    let aborted = null; // error กลางทางที่ไม่ใช่ recitation — หยุดแต่เก็บของที่แปลงได้แล้ว
    for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        const expect = expectedForBatch(detected, batch);
        statusEl.textContent = `ชุดที่ ${b + 1}/${batches.length} (หน้า ${batch.start}-${batch.end}) — กำลังเตรียมภาพ…`;
        const pages = await renderPagesAsBase64(currentPdfDoc, batch);
        const pageNote = `หมายเหตุ: รูปที่แนบมาคือหน้า ${batch.start} ถึง ${batch.end} ของ PDF (เรียงตามลำดับ) — pageHint ต้องใช้เลขหน้าจริงเหล่านี้`;
        statusEl.textContent = `ชุดที่ ${b + 1}/${batches.length} — กำลังส่งให้ระบบแปลง…`;
        try {
            const raw = await convertBatchViaGAS(buildConverterPrompt(additionalPrompt, pageNote, allowedCats, forcedCat0, expect), {
                images: pages.map(p => p.dataUrl)
            });
            const parsed = parseGeminiResponse(raw);
            if (parsed.meta && parsed.meta.source === 'partial') truncated = true;
            const qs = parsed.questions;
            questions.push(...qs);
            if (expect > 0 && qs.length < expect) shortBatches.push({ start: batch.start, end: batch.end, got: qs.length, expect });
            statusEl.textContent = `ชุดที่ ${b + 1}/${batches.length} เสร็จ — ได้ ${qs.length} ข้อ (รวม ${questions.length})`;
        } catch (err) {
            if (!String(err.message).includes('RECITATION')) {
                // error อื่น (quota หมด/เน็ตหลุด/GAS timeout) กลางทาง
                // ซอยเป็นหลายชุดแล้ว = มีโอกาสพังกลางคันหลายจุด ถ้าโยนทิ้งทันทีจะเสียทั้งข้อที่แปลงสำเร็จ
                // และโควต้า Gemini ที่จ่ายไปแล้วของชุดก่อนหน้า → เก็บของที่ได้ แล้วรายงานว่าไม่ครบ
                if (questions.length > 0) {
                    aborted = { atBatch: b + 1, totalBatches: batches.length, message: err.message };
                    for (let r = b; r < batches.length; r++) failed.push(batches[r]);
                    Swal.fire({
                        toast: true, icon: 'error', position: 'top-end',
                        title: `หยุดที่ชุด ${b + 1}/${batches.length} — เก็บ ${questions.length} ข้อที่แปลงได้ไว้แล้ว`,
                        timer: 6000, showConfirmButton: false
                    });
                    break;
                }
                throw err; // ยังไม่ได้อะไรเลย — โยนต่อให้ผู้ใช้เห็น error จริง
            }
            failed.push(batch);
            Swal.fire({
                toast: true, icon: 'warning', position: 'top-end',
                title: `หน้า ${batch.start}-${batch.end} โดนตัวกรอง recitation — ข้ามชุดนี้`,
                timer: 4000, showConfirmButton: false
            });
        }
    }
    return { questions, failed, truncated, shortBatches, aborted };
}

// ─── Autonomous AI Self-Correction Loop (Uncategorized questions) ──────────
// enforceKnownTopic() (gemini.js, ด้านบน) ทิ้งข้อไว้เป็น Uncategorized เมื่อ Gemini รอบแรกเลือกหัวข้อ
// ที่ไม่มีอยู่จริง — แทนที่จะปล่อยให้ตกไปที่ dropdown ทบทวนมือ (Smart Uncategorized Suggestions,
// converter.js) ทันที ลองส่งเฉพาะข้อที่ยัง Uncategorized กลับไปให้ Gemini แก้เองก่อน จำกัด
// MAX_UNCATEGORIZED_REFINE_ATTEMPTS รอบ กันเผาโควต้าถ้า Gemini แก้ไม่ได้จริง ๆ (เช่น วิชานั้นไม่มี
// หัวข้อบรรยายในชีตเลย) — เหลือเท่าไรหลังจากนี้ยังมี dropdown เป็น fallback ให้แอดมินแก้เอง
const MAX_UNCATEGORIZED_REFINE_ATTEMPTS = 2;

// items: [{id, problem, choices}] — id คือ index ใน allQuestions ให้ map คำตอบกลับถูกข้อ
// isRetry: รอบที่ 2 เป็นต้นไปต้องเตือนว่า "เคยเลือกไม่ได้มาแล้ว" ไม่งั้นพรอมต์เหมือนรอบแรกทุกตัวอักษร
// ยิงซ้ำแล้วได้คำตอบเดิม — เผาโควต้าฟรี ไม่ได้อะไรเพิ่ม
function buildRefinementPrompt(items, allowedCats, isRetry) {
    const lines = allowedCats.map(c => `- ${c.CategoryID}`).join('\n');
    const itemsText = items.map(it => `[id=${it.id}] ${it.problem}\nตัวเลือก: ${it.choices}`).join('\n\n');
    const retryNote = isRetry
        ? '\n\n**หมายเหตุ:** รอบที่แล้วคุณเลือกหัวข้อที่ไม่มีอยู่จริงสำหรับข้อเหล่านี้มาแล้ว — ตรวจสอบรายการหัวข้อด้านล่างอีกครั้งให้ละเอียด แล้วเลือกใหม่จากรายการเท่านั้น'
        : '';
    return `ข้อสอบต่อไปนี้ถูกจัดเป็น "Uncategorized" เพราะรอบแรก AI เลือกหัวข้อที่ไม่มีอยู่จริงในวิชานี้
วิเคราะห์โจทย์และตัวเลือกของแต่ละข้อ แล้วเลือก CategoryID ที่ตรงที่สุดจากรายการหัวข้อบรรยายจริงด้านล่างนี้
ห้ามคืนค่า Uncategorized หรือสร้าง CategoryID ใหม่ — ต้องเลือกหัวข้อที่ "ใกล้เคียงที่สุด" จากรายการเสมอ${retryNote}

รายการหัวข้อที่เลือกได้ (คัดลอก CategoryID มาทั้งดุ้นแบบเป๊ะ ห้ามแต่งใหม่ ห้ามย่อ):
${lines}

ส่งกลับ JSON object นี้เท่านั้น — ไม่มี markdown ไม่มีข้อความอื่น:
{"corrections":[{"id":<เลข id เดิม>,"categoryId":"<CategoryID ที่เลือก>"}]}
คืนทุก id ที่ได้รับให้ครบ ห้ามข้าม

ข้อสอบที่ต้องแก้ไข:
${itemsText}`;
}

// แก้ category[1] ของ allQuestions ที่ยัง Uncategorized ในที่เดิม (mutate in place) — คืนจำนวนข้อที่แก้ได้
// attempt: 0-based รอบที่กำลังยิง (มาจาก loop เรียกใน runGeminiConversion) — ใช้เลือกพรอมต์ retry
// ต้องแนบ pdf/รูปเพราะ backend (convertPdfBatch) บังคับ ("ต้องมี prompt และ PDF หรือรูปหน้ากระดาษ")
// แต่เนื้อหาที่ใช้จัดหมวดจริงอยู่ในพรอมต์ (problem/choices) ที่ส่งไปแล้วทั้งหมด — รูปหน้าแรกที่แนบไม่ได้
// ถูกใช้จัดหมวดจริง แค่ satisfy gate ฝั่ง backend เท่านั้น อย่าลบออกเด็ดขาด ไม่งั้นโดน "ข้อมูลไม่ครบ" ทันที
async function refineUncategorizedCategories(allQuestions, allowedCats, attempt) {
    if (!allowedCats || allowedCats.length === 0) return 0;
    const items = [];
    allQuestions.forEach((q, i) => {
        if (Array.isArray(q.category) && /_Uncategorized$/.test(String(q.category[1] || ''))) {
            items.push({ id: i, problem: q.problem || '', choices: q.choices || '' });
        }
    });
    if (items.length === 0) return 0;

    let raw;
    try {
        const pages = await renderPagesAsBase64(currentPdfDoc, { start: 1, end: 1 });
        const prompt = buildRefinementPrompt(items, allowedCats, attempt > 0);
        raw = await convertBatchViaGAS(prompt, { images: pages.map(p => p.dataUrl) }, 'uncategorized-refine');
    } catch (e) {
        console.warn('Uncategorized refinement pass failed:', e.message);
        return 0;
    }
    if (typeof raw !== 'string') return 0; // unexpected MAX_TOKENS-recovery shape (built for {questions:[]}, not {corrections:[]}) — skip, dropdown fallback still applies

    let parsed;
    try {
        const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        parsed = JSON.parse(firstBrace !== -1 && lastBrace > firstBrace ? cleaned.substring(firstBrace, lastBrace + 1) : cleaned);
    } catch (e) {
        return 0;
    }

    const corrections = Array.isArray(parsed.corrections) ? parsed.corrections : [];
    const allowedIds = new Set(allowedCats.map(c => String(c.CategoryID)));
    let fixed = 0;
    corrections.forEach(c => {
        const q = allQuestions[c.id];
        const newId = String((c && c.categoryId) || '').trim();
        // นอกจาก id/categoryId ต้องถูกต้องแล้ว แถวนั้นต้องยัง Uncategorized จริง ณ ตอน apply —
        // กัน id หลอน/id ผิดที่ Gemini คืนมาไปทับ category ที่ถูกต้องอยู่แล้วของแถวอื่น
        if (!q || !Array.isArray(q.category) || !allowedIds.has(newId)) return;
        if (!/_Uncategorized$/.test(String(q.category[1] || ''))) return;
        q.category[1] = newId;
        fixed++;
    });
    return fixed;
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

    // Edit 3: กลุ่มข้อสอบที่จะบันทึก — ชิปที่เลือก หรือชื่อไฟล์ที่เติมเลขรุ่นให้แล้ว → บังคับ category[0]
    const effGroup = (typeof getEffectiveExamGroup === 'function')
        ? getEffectiveExamGroup(filename) : { group: '', forced: false };
    const forcedCat0 = effGroup.forced ? `${subjId.toUpperCase()}_${effGroup.group}` : '';
    const fileStem = forcedCat0 || `${subjectCode}_${examGroup}`;
    // หัวข้อที่ผู้ใช้ทบทวน/ยืนยันแล้วในหน้าทบทวน (reviewCategoriesBeforeConvert) — ไม่ต้อง toast ซ้ำ
    const allowedCats = getExistingCategoriesForSubject(subjId);
    const allowedIds = new Set(allowedCats.map(c => String(c.CategoryID)));

    const additionalPrompt = (document.getElementById('extra-prompt') || {}).value || '';

    convDiagnostics = []; // เริ่มรอบใหม่ — ทิ้ง breadcrumb ของรอบก่อน

    // นับจำนวนข้อจริงจาก text layer ก่อน แล้วค่อยตัดสินใจว่าจะซอยกี่ชุด
    statusEl.textContent = 'กำลังนับจำนวนข้อในไฟล์…';
    const detected = await detectQuestionCount(currentPdfDoc);
    const batches = await checkAndSplitPDF(currentPdfDoc, detected);

    const progressEl = document.getElementById('pdf-progress');
    if (progressEl) { progressEl.classList.remove('d-none'); progressEl.removeAttribute('value'); }

    const allQuestions = [];
    let failedBatches = [];
    let shortBatches = [];
    let aborted = null;
    let truncated = false; // JSON ถูกตัดกลางคัน (MAX_TOKENS) แล้วกู้มาได้บางส่วน = ข้อมูลไม่ครบ
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
                const raw = await convertBatchViaGAS(buildConverterPrompt(additionalPrompt, '', allowedCats, forcedCat0, detected.expected), { pdfB64 });
                const parsed = parseGeminiResponse(raw);
                if (parsed.meta && parsed.meta.source === 'partial') truncated = true;
                allQuestions.push(...parsed.questions);
            } catch (err) {
                if (!String(err.message).includes('RECITATION')) throw err;
                // ทั้งไฟล์โดนตัวกรอง recitation → auto-fallback: แบ่งเป็นชุดรูปหน้าละ 4 ให้รอดเป็นรายชุด
                statusEl.textContent = 'โดนตัวกรอง recitation — ลองใหม่แบบแบ่งชุดเล็ก (4 หน้า/ชุด)…';
                const total = currentPdfDoc.numPages;
                const small = [];
                for (let s = 1; s <= total; s += 4) small.push({ start: s, end: Math.min(s + 3, total) });
                const res = await convertImageBatches(small, additionalPrompt, statusEl, allowedCats, forcedCat0, detected);
                allQuestions.push(...res.questions);
                failedBatches = res.failed;
                shortBatches = res.shortBatches;
                aborted = res.aborted || null;
                if (res.truncated) truncated = true;
                if (allQuestions.length === 0) throw err; // โดนทุกชุด — โยน error เดิมพร้อมคำแนะนำ
            }
        } else {
            // ── หลายชุด: ข้อเยอะเกิน 1 คำขอ หรือไฟล์ >14MB (ส่ง PDF ดิบไม่ได้) ──
            // render หน้าเป็นภาพ ส่ง 1 POST ต่อชุด — โมเดล "เห็นเฉพาะหน้าของชุดนั้น" จึงข้ามข้อไม่ได้เชิงโครงสร้าง
            // (ถ้าแนบ PDF ทั้งไฟล์แล้วสั่งเป็นข้อความว่า "เอาเฉพาะหน้า X-Y" โมเดลไม่ทำตามได้ — ซึ่งคือบั๊กที่กำลังแก้อยู่)
            // backend (convertPdfBatch) ปฏิเสธถ้า images.length > 20 → ต้องไม่ให้ชุดไหนยาวเกิน 15 หน้า
            const MAX_PAGES_PER_POST = 15;
            const imgBatches = [];
            batches.forEach(b => {
                for (let s = b.start; s <= b.end; s += MAX_PAGES_PER_POST) {
                    imgBatches.push({ start: s, end: Math.min(s + MAX_PAGES_PER_POST - 1, b.end) });
                }
            });
            const res = await convertImageBatches(imgBatches, additionalPrompt, statusEl, allowedCats, forcedCat0, detected);
            allQuestions.push(...res.questions);
            failedBatches = res.failed;
            shortBatches = res.shortBatches;
            aborted = res.aborted || null;
            if (res.truncated) truncated = true;
            if (allQuestions.length === 0 && failedBatches.length > 0) {
                throw new Error('ทุกชุดโดนตัวกรอง recitation ของ Gemini — ลองกดแปลงซ้ำอีกครั้ง');
            }
        }
    } finally {
        if (progressEl) progressEl.classList.add('d-none');
    }

    // Sanitize every question's category — คง CategoryID ที่ตรงกับหัวข้อจริงไว้ทั้งดุ้น
    // จุดรวมทุกเส้นทาง (native PDF / image batches / กู้คืน MAX_TOKENS) — ล้างโจทย์ที่นี่ที่เดียว
    allQuestions.forEach(q => {
        q.problem = stripImagePlaceholder(stripChoiceTail(q.problem, q.choices));
        q.choices = stripChoiceLetters(q.choices);
        q.answer = sanitizeAnswer(q.answer, q.choices);
        q.explain = stripExplainIntro(q.explain);
        q.category = sanitizeCategory(q.category, fileStem, allowedIds);
        q.category = enforceKnownTopic(q.category, subjId, allowedIds); // Task 1: block invented topic IDs
        if (forcedCat0) q.category[0] = forcedCat0; // ชิปผู้ใช้ = เด็ดขาด แม้ Gemini เขียนมาอย่างอื่น
    });

    // Autonomous AI Self-Correction Loop — ลองให้ Gemini แก้ข้อที่ยัง Uncategorized เองก่อน
    // แสดงผลให้แอดมินเห็น (Smart Uncategorized Suggestions dropdown, converter.js)
    for (let attempt = 0; attempt < MAX_UNCATEGORIZED_REFINE_ATTEMPTS; attempt++) {
        const stillUncategorized = allQuestions.some(q =>
            Array.isArray(q.category) && /_Uncategorized$/.test(String(q.category[1] || '')));
        if (!stillUncategorized) break;
        statusEl.textContent = `กำลังให้ AI ทบทวนหัวข้อที่ยังไม่ชัดเจนอีกครั้ง (รอบ ${attempt + 1}/${MAX_UNCATEGORIZED_REFINE_ATTEMPTS})…`;
        const fixedCount = await refineUncategorizedCategories(allQuestions, allowedCats, attempt);
        if (fixedCount === 0) break; // ไม่คืบหน้า — เหลือให้แอดมินเลือกเองจาก dropdown
    }

    statusEl.textContent = `กำลังโหลดข้อมูล ${allQuestions.length} ข้อ…`;
    groupAndFeedToProcessAll(allQuestions, fileStem);

    // เทียบจำนวนที่นับได้จาก PDF กับที่แปลงได้จริง — detected.expected เป็นค่าขั้นต่ำ
    // ถ้ายังขาด แปลว่าโมเดลออกข้อไม่ครบ (ไม่ใช่แค่ถูกตัด) — ต้องบอกผู้ใช้ ห้ามรายงานว่าสำเร็จเฉย ๆ
    const missing = detected.expected > 0 ? Math.max(0, detected.expected - allQuestions.length) : 0;

    statusEl.textContent = aborted
        ? `⚠️ หยุดกลางคันที่ชุด ${aborted.atBatch}/${aborted.totalBatches} — เก็บได้ ${allQuestions.length} ข้อ (${aborted.message})`
        : failedBatches.length > 0
        ? `⚠️ แปลงได้ ${allQuestions.length} ข้อ (ข้าม ${failedBatches.length} ชุดที่โดน recitation: หน้า ${failedBatches.map(b => `${b.start}-${b.end}`).join(', ')})`
        : truncated
            ? `⚠️ แปลงได้ ${allQuestions.length} ข้อ — คำตอบถูกตัดกลางคัน ข้อมูลอาจไม่ครบ`
            : missing > 0
                ? `⚠️ แปลงได้ ${allQuestions.length} ข้อ จากที่นับได้ ${detected.expected} ข้อ — ขาดไป ${missing} ข้อ`
                : `✅ แปลงสำเร็จ ${allQuestions.length} ข้อ`;

    return {
        total: allQuestions.length,
        failedBatches: failedBatches,
        truncated: truncated,
        expected: detected.expected,
        missing: missing,
        shortBatches: shortBatches,
        aborted: aborted,
        batchCount: batches.length,
        diagnostics: convDiagnostics
    };
}
