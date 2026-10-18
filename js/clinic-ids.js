// แกะชื่อไฟล์ข้อสอบ Clinic (Y4–Y6) / NL / Compre → CategoryID ตาม decision #6 #13 #14 #15 #17 #18 #24
// pure function ไม่แตะ DOM — converter.js เรียกใช้, tools/clinic-ids-harness.cjs ทดสอบ offline
// ไม่แน่ใจ = ไม่เดา: รุ่นไม่รู้ → xx, rotation ไม่รู้ → ROTX แล้วติด needsReview + เหตุผล

// SubjectID ที่อนุญาต (#16) — ต่อท้ายด้วยชั้นปี
const CLINIC_SUBJECTS = {
    4: ['MED4', 'OBGYNE4', 'PED4', 'SX4', 'ENT4', 'PMR4', 'COMMED4', 'FORENSIC4', 'RESEARCH4'],
    5: ['ANES5', 'FORENSIC5', 'RADIO5', 'ORTHO5', 'SX5', 'EYE5', 'PSYCH5', 'MED5', 'AMB5', 'COMMED5', 'ER5', 'RESEARCH5'],
    6: ['ER6', 'MED6', 'OBGYNE6', 'ORTHO6', 'PED6', 'SX6']
};

// คำในชื่อไฟล์ → รหัสวิชาหลัก (ยังไม่มีชั้นปี)
const CLINIC_SUBJECT_ALIASES = {
    MED: 'MED', MEDICINE: 'MED',
    SX: 'SX', SURGERY: 'SX', SURGERYII: 'SX',
    OBGYN: 'OBGYNE', OBGYNE: 'OBGYNE',
    PED: 'PED', PEDS: 'PED', PEDIATRIC: 'PED', PEDIATRICS: 'PED',
    ENT: 'ENT',
    PMR: 'PMR', REHAB: 'PMR', RH: 'PMR',
    COMMED: 'COMMED', CM: 'COMMED',
    FORENSIC: 'FORENSIC', FORENSICS: 'FORENSIC', FM: 'FORENSIC', FORMED: 'FORENSIC',
    RESEARCH: 'RESEARCH',
    ANES: 'ANES',
    RADIO: 'RADIO', XRAY: 'RADIO',
    ORTHO: 'ORTHO', ORTHOPEDICS: 'ORTHO',
    EYE: 'EYE', OPHTHAL: 'EYE',
    PSY: 'PSYCH', PSYCH: 'PSYCH', PSYCHI: 'PSYCH', PHYSCHI: 'PSYCH',
    AMB: 'AMB',
    ER: 'ER', EMERGENCY: 'ER'
};

// NL ที่มีหลายรอบในปีเดียวแต่ชื่อไฟล์บอกแค่เดือน (#6) — เรียงรอบตามเดือนภายในปีนั้น
const NL_MONTH_ROUNDS = {
    'NL2:2020': ['JUL', 'SEP', 'NOV']
};

// alias ที่เป็นคำทั่วไป เจอในชื่อไฟล์ pre-clinic ได้ (Pharmaco+Radio, Med Micro)
const _WEAK_SUBJECT_WORDS = ['RADIO', 'MED', 'MEDICINE', 'SURGERY', 'SURGERYII', 'RESEARCH', 'EYE', 'ER', 'EMERGENCY'];

const _EXAM_TYPE_TOKENS =['MCQ', 'MEQ', 'CRQ', 'SAQ', 'SQA', 'ESSAY', 'OSCE', 'SPOT'];

// ตัด prefix เฉลย / "Copy of" / อีโมจิ ออก — เก็บไว้ว่าเป็นไฟล์เฉลยหรือไม่ (ใช้จับคู่ใน T2.3)
function _stripExamFilename(filename) {
    let base = String(filename || '').replace(/\.pdf$/i, '');
    const isKey = /^\s*(?:\[KEY\]|🔑|🐻?\s*เฉลย)/i.test(base) || /\bKey\b/i.test(base);
    base = base
        .replace(/^\s*\[KEY\]\s*/i, '')
        .replace(/^\s*Copy of\s+/i, '')
        .replace(/[^\x20-\x7E฀-๿]/g, ' ') // อีโมจิ / สัญลักษณ์อื่น → ช่องว่าง
        .replace(/\s+/g, ' ')
        .trim();
    return { base, isKey };
}

// รุ่น: MD49, (MD50), [MD47], Med46, MED 43 — MD?? = ไม่ทราบ, MD41-44 = หลายรุ่น
function _parseBatch(base) {
    const range = base.match(/\bM(?:E)?D\s*(\d{2})\s*-\s*(\d{2})(?!\d)/i);
    if (range) return { batch: 'xx', reason: 'batch range MD' + range[1] + '-' + range[2] };
    if (/\bMD\s*\?\?/i.test(base)) return { batch: 'xx', reason: 'batch MD??' };
    const m = base.match(/(?:^|[^A-Za-z])M(?:ED|D)\s*(\d{2})(?!\d)/i);
    if (m) return { batch: m[1], reason: '' };
    return { batch: 'xx', reason: 'no batch in filename' };
}

// ชั้นปีจากชื่อไฟล์ ("yr5", "year 5", "ปี 5") — คืน null ถ้าไม่มี
function _parseClassYear(base) {
    const m = base.match(/\b(?:yr|year)\s*([456])\b|ปี\s*([456])/i);
    return m ? Number(m[1] || m[2]) : null;
}

function _resolveSubject(tokens, classYearHint) {
    for (const raw of tokens) {
        const t = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const m = t.match(/^([A-Z]+?)([456])?$/);
        if (!m || !CLINIC_SUBJECT_ALIASES[m[1]]) continue;
        const baseId = CLINIC_SUBJECT_ALIASES[m[1]];
        // วิชาที่มีอยู่ชั้นปีเดียวใน #16 (PMR→4, PSYCH→5 …) ไม่ต้องเดา
        const onlyYears = Object.keys(CLINIC_SUBJECTS).filter(y => CLINIC_SUBJECTS[y].includes(baseId + y));
        const year = m[2] ? Number(m[2]) : (classYearHint || (onlyYears.length === 1 ? Number(onlyYears[0]) : null));
        if (!year) return { subject: '', reason: 'subject ' + m[1] + ' without class year' };
        const id = baseId + year;
        if (CLINIC_SUBJECTS[year] && CLINIC_SUBJECTS[year].includes(id)) return { subject: id, reason: '' };
        return { subject: '', reason: 'unknown SubjectID ' + id };
    }
    return { subject: '', reason: 'no subject in filename' };
}

// rotation token เช่น "ABCD", "A1", "E", "CD" → ROTABCD / ROTA1 — อย่างอื่น (?, ตัวเลขล้วน) = null
function _rotFromToken(tok) {
    const t = String(tok || '').toUpperCase().trim();
    if (/^[A-F]{2,6}$/.test(t)) return 'ROT' + t;
    if (/^[A-F][1-4]?$/.test(t)) return 'ROT' + t;
    return null;
}

function _parseTier(base) {
    const mid = /mid\s*-?\s*block|\bmid\b/i.test(base);
    const fin = /final/i.test(base);
    if (mid && fin) return { tier: '', reason: 'midblock+final in one file → plain MCQ' };
    return { tier: mid ? 'MID' : (fin ? 'FIN' : ''), reason: '' };
}

function _parseTypes(base) {
    const found = [];
    base.toUpperCase().split(/[^A-Z]+/).forEach(w => {
        const t = w === 'SQA' ? 'SAQ' : w;
        if (_EXAM_TYPE_TOKENS.includes(w) && !found.includes(t)) found.push(t);
    });
    return found;
}

function _parseNl(base, nl) {
    const reasons = [];
    const years = [...new Set(base.match(/(?<!\d)20[0-2]\d(?!\d)/g) || [])];
    if (!years.length) return { categoryId: '', reasons: ['no CE year in NL filename'] };
    const year = years[0];
    if (years.length > 1) reasons.push('several years ' + years.join('/'));
    let round = '';
    const dash = base.match(new RegExp(year + '\\s*-\\s*(\\d)(?!\\d)'));          // NL2_2025-1
    // NL2 2-2023, Excercise 1-2024 — ไม่ใช่ "NL2-2020" หรือวันที่ "4-4-2022"
    const preDash = base.match(new RegExp('(?:^|NLE?\\s*[12]\\s+|Exc?er?cise\\s*)(\\d)\\s*-\\s*' + year, 'i'));
    const rob = base.match(/รอบ\s*(\d)/);
    if (dash) round = dash[1];
    else if (preDash) round = preDash[1];
    else if (rob) round = rob[1];
    else {
        const months = NL_MONTH_ROUNDS[nl + ':' + year];
        if (months) {
            const idx = months.findIndex(mo => new RegExp('(?:^|[^A-Za-z])' + mo, 'i').test(base));
            if (idx >= 0) round = String(idx + 1);
            else reasons.push('multi-round year ' + year + ' but no known month');
        }
    }
    if (!round) round = '1';
    return { year, round, categoryId: nl + '_' + year + 'R' + round, reasons };
}

// opts.subjectHint = SubjectID ที่ผู้ใช้เลือกใน converter (เช่น "COMPRE2", "PSYCH5") — ใช้ตอนชื่อไฟล์ไม่บอก
// คืน null ถ้าไม่ใช่ไฟล์ clinic/NL/compre (ให้ converter ใช้ parseFilenameMetadata แบบเดิม)
function parseExamFilename(filename, opts) {
    const hint = String((opts && opts.subjectHint) || '').trim().toUpperCase();
    const { base, isKey } = _stripExamFilename(filename);
    const types = _parseTypes(base);
    const reasons = [];

    // NL ก่อน compre/clinic — "MD43_NL1_MCQ (...)" ขึ้นต้นด้วย MD เหมือน clinic
    const nlm = base.match(/(?:^|[^A-Za-z])NLE?\s*_?([12])(?!\d)/i);
    if (nlm || /^NL[12]$/.test(hint)) {
        const nl = 'NL' + (nlm ? nlm[1] : hint.slice(2));
        const r = _parseNl(base, nl);
        if (!r.categoryId) return { kind: 'nl', subject: nl, categoryId: '', group: '', isKey, types, needsReview: true, reasons: r.reasons };
        return {
            kind: 'nl', subject: nl, year: r.year, round: r.round, categoryId: r.categoryId,
            group: r.categoryId.slice(nl.length + 1), isKey, types,
            needsReview: r.reasons.length > 0, reasons: r.reasons
        };
    }

    // คำเต็ม COMPRE/COMPREHENSIVE เท่านั้น ("_compressed" ไม่นับ); ไฟล์ MEQ/OSCE ล้วนไม่ใช่ขอบเขต
    if (/(?:^|[^A-Za-z])COMPRE(?:HENSIVE)?(?![A-Za-z])/i.test(base) &&(types.length === 0 || types.includes('MCQ'))) {
        // Compre2 (ปี 5) ตั้งชื่อขึ้นต้นด้วยปี: "2014 Compre Med 37", "2016 Compre MD 39"
        const subject = (hint === 'COMPRE2' || /^20\d\d\s*Compre/i.test(base)) ? 'COMPRE2' : 'COMPRE1';
        const b = _parseBatch(base);
        if (b.reason) reasons.push(b.reason);
        const part = base.match(/\b(Set|Part)\s*(\d)/i);
        const group = b.batch + 'MCQ' + (part ? '_' + part[1].toUpperCase() + part[2] : '');
        return {
            kind: 'compre', subject, batch: b.batch, categoryId: subject + '_' + group, group,
            isKey, types, needsReview: b.batch === 'xx', reasons
        };
    }

    if (!types.includes('MCQ')) return null;

    // ไฟล์ pre-clinic (MD52_SKIN_MCQ1, CVS_51MCQ1, MD52_COMMED_MCQ1) ต้องได้ null → converter ใช้ตัวเดาแบบเดิม
    // clinic = มีคำวิชา clinic ในชื่อไฟล์ หรือผู้ใช้เลือกวิชา clinic (#16) ไว้ — เลือกวิชาอื่นอยู่ = ไม่ใช่ clinic
    const hintYearAny = /([456])$/.test(hint) ? Number(hint.slice(-1)) : null;
    const hintIsClinic = !!(hintYearAny && CLINIC_SUBJECTS[hintYearAny].includes(hint));
    if (hint && !hintIsClinic) return null;
    // คำสามัญ (Radio, Med, Surgery…) นับเป็นวิชา clinic ได้ก็ต่อเมื่อมีบริบท clinic ด้วย — กัน "(MD51) MCQ3_Pharmaco+Radio+CC"
    const clinicContext = /^MD\s*(?:\d{2}|\?\?)\s*_/i.test(base) || /rotat/i.test(base) || !!_parseClassYear(base);
    const hasAlias = base.split(/[\s_()\[\]&+,.-]+/).some(w => {
        const m = w.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^([A-Z]+?)([456])?$/);
        return !!(m && CLINIC_SUBJECT_ALIASES[m[1]] && (m[2] || clinicContext || !_WEAK_SUBJECT_WORDS.includes(m[1])));
    });
    if (!hasAlias && !hintIsClinic) return null;

    const b = _parseBatch(base);
    if (b.reason) reasons.push(b.reason);

    const hintYear = hintIsClinic ? hintYearAny : null;
    const classYear = _parseClassYear(base) || hintYear;

    let subject = '', rot = null;
    // รูปแบบมาตรฐาน: MD49_ABCD_MED4_MCQ…, MD48_E1__REHAB_MCQ…, MD49_?_RESEARCH4_MCQ
    // ช่อง rotation รับแค่ A–F/? — ไม่งั้น MD48_OBGYN_FINAL_… จะถูกอ่านว่า rotation "OBGYN"
    const std = base.match(/^MD\s*(?:\d{2}(?:-\d{2})?|\?\?)\s*_\s*([A-Fa-f?]{1,6}\d?\??)\s*_+\s*([A-Za-z]+\d?)\s*_/i);
    if (std) {
        const s = _resolveSubject([std[2]], classYear);
        subject = s.subject;
        if (s.reason) reasons.push(s.reason);
        rot = _rotFromToken(std[1]);
        if (!rot) reasons.push('rotation "' + std[1] + '" unmappable');
    } else {
        const tokens = base.split(/[\s_()\[\]&+,.-]+/).filter(Boolean);
        const s = _resolveSubject(tokens, classYear);
        subject = s.subject;
        if (s.reason) reasons.push(s.reason);
        // "rotate D2-3" / "rotate D4-2" = หลายกลุ่มย่อย → ไม่แมป (ROTX)
        const rm = base.match(/rotat(?:e|ion)\s*([A-F]\d?)(?![A-Za-z0-9.\-])/i);
        if (rm) rot = _rotFromToken(rm[1]);
        else {
            // MD48_RH_FINAL_MCQ_A3 — rotation อยู่ท้ายหลัง MCQ
            const tail = base.match(/_MCQ_([A-F]\d?)(?:_|$)/i);
            if (tail) rot = _rotFromToken(tail[1]);
        }
        if (!rot) reasons.push('rotation not found');
    }

    // subject ไม่ได้จากชื่อไฟล์แต่ผู้ใช้เลือกวิชาไว้แล้ว → ใช้ hint (ยังติด review ไว้ให้คนดู)
    if (!subject && hint) {
        const hy = hintYear;
        if (hy && CLINIC_SUBJECTS[hy] && CLINIC_SUBJECTS[hy].includes(hint)) subject = hint;
    }
    if (!subject) return { kind: 'clinic', subject: '', batch: b.batch, categoryId: '', group: '', isKey, types, needsReview: true, reasons };

    const t = _parseTier(base);
    if (t.reason) reasons.push(t.reason);
    // ไฟล์ซ้ำชื่อที่ต่างแค่ท้าย (_UDH / _SNH = โรงพยาบาล?, "แก้" = ฉบับแก้) ได้ CategoryID เดียวกัน → ให้คนตัดสิน
    const variant = base.match(/_(UDH|SNH)\b|\s(แก้)\s*$/i);
    if (variant) reasons.push('variant suffix ' + (variant[1] || variant[2]) + ' may collide with sibling file');
    if (types.length > 1) reasons.push('mixed ' + types.join('/') + ' → MCQ part only');

    const group = b.batch + 'MCQ' + t.tier + '_' + (rot || 'ROTX');
    // เหตุผลที่ "ไม่ต้องให้คนดู": tier รวม / ไฟล์ผสม — ที่เหลือคือเดาไม่ได้จริง
    const needsReview = !rot || b.batch === 'xx' || reasons.some(r => !/plain MCQ|MCQ part only/.test(r));
    return {
        kind: 'clinic', subject, batch: b.batch, rot: rot || 'ROTX', tier: t.tier,
        categoryId: subject + '_' + group, group, isKey, types, needsReview, reasons
    };
}
