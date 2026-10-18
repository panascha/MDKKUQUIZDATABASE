// Offline harness for js/clinic-ids.js parseExamFilename. Run: node tools/clinic-ids-harness.cjs (from repo root)
// clinic-ids-filenames.txt = every MCQ/NL/Compre PDF name from the 2026-10-18 Drive crawl + SOURCE/NL2 zips
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/clinic-ids.js'), 'utf8'), ctx, { filename: 'clinic-ids.js' });
const parse = (name, hint) => ctx.parseExamFilename(name, { subjectHint: hint });

let pass = 0, fail = 0;

// 1. golden table: [filename, subjectHint, expected categoryId ('' = no id), expected needsReview]
const golden = [
    // clinic, standard convention
    ['MD49_ABCD_MED4_MCQ.pdf', '', 'MED4_49MCQ_ROTABCD', false],
    ['MD49_ADE_MED4_MCQ.pdf', '', 'MED4_49MCQ_ROTADE', false],
    ['MD48_E_MED4_MCQ.pdf', '', 'MED4_48MCQ_ROTE', false],
    ['MD46_CD_SX4_MCQ Final.pdf', '', 'SX4_46MCQFIN_ROTCD', false],
    ['MD49_A_SX4_MCQ Midblock.pdf', '', 'SX4_49MCQMID_ROTA', false],
    ['MD46_A1_ANES_MCQ.pdf', 'ANES5', 'ANES5_46MCQ_ROTA1', false],
    ['MD48_E1__REHAB_MCQ Final.pdf', '', 'PMR4_48MCQFIN_ROTE1', false],     // PMR exists only in Y4
    ['MD48_FM_FINAL_MCQ_E2_SNH.pdf', '', '', true],                        // FORENSIC is Y4 and Y5 → needs hint
    ['MD46 Final Med - MCQ (Rotate A).pdf', '', '', true],
    ['MD49_C_OBGYN4_MCQ Midblock.pdf', '', 'OBGYNE4_49MCQMID_ROTC', false],
    ['MD50_E_OBGYN4_MCQ Midblock & Final.pdf', '', 'OBGYNE4_50MCQ_ROTE', false], // both tiers → plain MCQ
    ['MD47_ABCDE_PED4_MCQ Midblock & Final.pdf', '', 'PED4_47MCQ_ROTABCDE', false],
    ['MD46_C_SX4_MCQ & MEQ.pdf', '', 'SX4_46MCQ_ROTC', false],              // mixed → MCQ part only
    ['MD48_A_SX4_MCQ & CRQ Midblock.pdf', '', 'SX4_48MCQMID_ROTA', false],
    ['MD49_E_COMMED4_MCQ_UDH.pdf', '', 'COMMED4_49MCQ_ROTE', true],       // variant suffix → collides with MD49_E_COMMED4_MCQ
    ['MD48_OBGYN_ FINAL_MCQ_ROTATIONC แก้.pdf', 'OBGYNE4', 'OBGYNE4_48MCQFIN_ROTC', true],
    ['MD46 _D_MED4_MCQ.pdf', '', 'MED4_46MCQ_ROTD', false],
    ['MD41_ B_MED4_MCQ.pdf', '', 'MED4_41MCQ_ROTB', false],
    // unknown rotation / batch → ROTX / xx + review (#14 #24)
    ['MD49_?_RESEARCH4_MCQ.pdf', '', 'RESEARCH4_49MCQ_ROTX', true],
    ['MD45_A?_RESEARCH5_MCQ.pdf', '', 'RESEARCH5_45MCQ_ROTX', true],
    ['MD46_?_SX4_MCQ & MEQ Mid Block(Rotate 2).pdf', '', 'SX4_46MCQMID_ROTX', true],
    ['[KEY]MD??_?_SX4_MCQ Midblock.pdf', '', 'SX4_xxMCQMID_ROTX', true],
    ['MD41-44_?_SX4_MCQ Final.pdf', '', 'SX4_xxMCQFIN_ROTX', true],
    ['[MD47] 1_MCQ.pdf', 'MED4', 'MED4_47MCQ_ROTX', true],
    ['MCQ Ortho Extern Block 1.1 by Med43 ✨.pdf', 'ORTHO5', 'ORTHO5_43MCQ_ROTX', true],
    // free-form names (SNH style, emoji, "Copy of")
    ['MD48_OBGYN_FINAL_MCQ_ROTATIOND_SNH.pdf', 'OBGYNE4', 'OBGYNE4_48MCQFIN_ROTD', true], // SNH variant suffix
    ['MD48_PED_RotationC_MCQ_midblock.pdf', 'PED4', 'PED4_48MCQMID_ROTC', false],
    ['MD48_RH_FINAL_MCQ_A3.pdf', 'PMR4', 'PMR4_48MCQFIN_ROTA3', false],
    ['MD48_FM_FINAL_MCQ_E2_SNH.pdf', 'FORENSIC4', 'FORENSIC4_48MCQFIN_ROTE2', true],
    ['MD46 Final Commed MCQ (Rotate D1).pdf', 'COMMED4', 'COMMED4_46MCQFIN_ROTD1', false],
    ['Copy of MD46 PHYSCHI yr 5 - MCQ rotate A4.pdf', '', 'PSYCH5_46MCQ_ROTA4', false],
    ['Copy of MD46 mcq_saq psychi rotateD2-3.pdf', 'PSYCH5', 'PSYCH5_46MCQ_ROTX', true],
    ['(MD50) Sx Midblock MCQ.pdf', 'SX4', 'SX4_50MCQMID_ROTX', true],
    // key flag
    ['[KEY]MD49_A_SX4_MCQ Final.pdf', '', 'SX4_49MCQFIN_ROTA', false],
    // compre (#18)
    ['MD49_COMPRE_MCQ (Formative 2024 Set 1).pdf', '', 'COMPRE1_49MCQ_SET1', false],
    ['MD42_COMPRE_MCQ (Part 2).pdf', '', 'COMPRE1_42MCQ_PART2', false],
    ['MD46_COMPRE_MCQ.pdf', '', 'COMPRE1_46MCQ', false],
    ['MD48_COMPRE_MCQ (2023) BY MD49.pdf', '', 'COMPRE1_48MCQ', false],
    ['2016 Compre MD 39 .pdf', '', 'COMPRE2_39MCQ', false],
    ['14 POP and UI ptt for medical student_compressed.pdf', '', null, null],
    ['Comprehensive MEQ Final Edition.pdf', '', null, null],
    ['(MD51) MCQ3_Pharmaco+Radio+CC.pdf', '', null, null],
    // NL (#6)
    ['NL2_2009.pdf', '', 'NL2_2009R1', false],
    ['NL2_2025-1.pdf', '', 'NL2_2025R1', false],
    ['NL2_2026-2_APR.pdf', '', 'NL2_2026R2', false],
    ['NL2_2020_JULY_classroom.pdf', '', 'NL2_2020R1', false],
    ['NL2_2020_SEP.pdf', '', 'NL2_2020R2', false],
    ['NL2_2020_Nov.pdf', '', 'NL2_2020R3', false],
    ['NL2_2020_NOV_SMST.pdf', '', 'NL2_2020R3', false],
    ['NL2-2020 Completed.pdf', '', 'NL2_2020R1', true],               // multi-round year, no month
    ['NL2 2-2023.pdf', '', 'NL2_2023R2', false],
    ['MD??_NL1_MCQ SMST 2005.pdf', '', 'NL1_2005R1', false],
    ['MD??_NL1_MCQ NL1 2020 รอบ2.pdf', '', 'NL1_2020R2', false],
    ['MD43_NL1_MCQ (MED43PSU 2014).pdf', '', 'NL1_2014R1', false],
    ['NL2 เมษายน 2568 แบบ 1 column.pdf', '', '', true],                // BE year → no guess
    // pre-clinic / non-clinic → null (converter falls back to parseFilenameMetadata)
    ['MD52_SKIN_FMT.pdf', '', null, null],
    ['MD52_SKIN_MCQ1.pdf', '', null, null],
    ['MD52_SKIN_MCQ1.pdf', 'SKIN', null, null],
    ['CVS_51MCQ1.pdf', '', null, null],
    ['COMMED2_xxMCQ1.pdf', '', null, null],
    ['MD52_COMMED_MCQ1.pdf', 'COMMED', null, null],                       // Y2 COMMED picked → not clinic
    ['EMBRYO_47MCQ.pdf', '', null, null],
    ['MD49_ABCD_MED4_MCQ.pdf', 'CVS', null, null],                        // non-clinic subject picked → legacy path
];

for (const [name, hint, wantCat, wantReview] of golden) {
    let r, err = '';
    try { r = parse(name, hint); } catch (e) { err = e.message; }
    const gotCat = r === null ? null : (r ? r.categoryId : undefined);
    const ok = !err && gotCat === wantCat && (wantCat === null || r.needsReview === wantReview);
    if (ok) pass++; else { fail++; console.log('FAIL', JSON.stringify(name), hint || '-', '→', err || gotCat, r ? 'review=' + r.needsReview + ' ' + r.reasons.join('; ') : '', '| want', wantCat, 'review=' + wantReview); }
}

const k = parse('[KEY]MD49_A_SX4_MCQ Final.pdf', '');
if (k && k.isKey) pass++; else { fail++; console.log('FAIL [KEY] prefix not flagged isKey'); }
const e = parse('MD49_A_SX4_MCQ Final.pdf', '');
if (e && !e.isKey) pass++; else { fail++; console.log('FAIL exam file flagged isKey'); }

// 2. every real filename: no throw, id shape valid when produced
const ID_RE = /^(?:[A-Z]+[456]_(?:\d{2}|xx)MCQ(?:MID|FIN)?_ROT(?:[A-F]{1,6}\d?|X)|COMPRE[12]_(?:\d{2}|xx)MCQ(?:_(?:SET|PART)\d)?|NL[12]_20\d\dR\d)$/;
const names = fs.readFileSync(path.join(__dirname, 'clinic-ids-filenames.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
let throws = 0, badShape = 0, review = 0, ids = 0;
for (const n of names) {
    let r;
    try { r = parse(n, ''); } catch (err) { throws++; console.log('THROW', JSON.stringify(n), err.message); continue; }
    if (!r) continue;
    if (r.needsReview) review++;
    if (r.categoryId) {
        ids++;
        if (!ID_RE.test(r.categoryId) || r.categoryId.split('_').some(p => !p)) { badShape++; console.log('BAD SHAPE', JSON.stringify(n), r.categoryId); }
    }
}
// 3. real pre-clinic source PDFs (SOURCE/Y1–Y3) must stay on the legacy path (null)
const srcRoot = path.join(root, '..', '..', 'SOURCE');
const pre = [];
(function walk(d) {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
        if (e.isDirectory()) walk(path.join(d, e.name));
        else if (/\.pdf$/i.test(e.name) && /[\\/]Y[123][\\/]/.test(path.join(d, e.name))) pre.push(e.name);
    }
})(srcRoot);
const preHits = pre.filter(n => { try { return parse(n, '') !== null; } catch (_) { return true; } });
preHits.forEach(n => console.log('PRE-CLINIC NOT NULL', JSON.stringify(n), JSON.stringify(parse(n, ''))));
if (pre.length === 0) console.log('note: SOURCE/Y1–Y3 not found, pre-clinic sweep skipped');
if (preHits.length === 0) pass++; else fail++;

// 4. category collisions: distinct exam (non-KEY) files → same categoryId (decision #4: 1 PDF = 1 category)
const byCat = {};
for (const n of names) {
    const r = parse(n, '');
    if (!r || !r.categoryId || r.isKey) continue;
    (byCat[r.categoryId] = byCat[r.categoryId] || []).push(n);
}
const collisions = Object.entries(byCat).filter(([, v]) => v.length > 1);
collisions.forEach(([id, v]) => console.log('COLLISION', id, '←', v.map(x => JSON.stringify(x)).join(' + ')));

if (throws === 0) pass++; else fail++;
if (badShape === 0) pass++; else fail++;
console.log(`corpus: ${names.length} names, ${ids} ids, ${review} needsReview, ${throws} throws, ${badShape} bad shape, ${collisions.length} collisions; pre-clinic ${pre.length} PDFs, ${preHits.length} not null`);
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
