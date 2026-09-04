// ─────────────────────────────────────────────────────
// JS/CONFIG.JS
// ─────────────────────────────────────────────────────

window.APPSCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwqv5BXxGOvTKO1DJoahJSTgn74_lPnRq_opqrUndXhJC3TAt7PHv6B_PbMvxzrAAIl/exec';

// ── Supabase (Phase 1: อ่าน slice `questions` เท่านั้น) ─────────────────────────
// anon key เป็น publishable key โดยเจตนา (D2) — RLS ปิดทางเขียนไว้แล้ว ตรวจแล้ว 198/198 ในฐานะ anon
// ห้ามใส่ sb_secret_… ที่นี่เด็ดขาด ไฟล์นี้ขึ้น GitHub Pages
window.SUPABASE_URL = 'https://nqczccbhjrzjlwirmjot.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_lbCmPZ0_OfQ-DwBjgU4Fnw_wDN8Vsa6';

// สวิตช์ย้อนกลับของ Phase 1 (แผน §7: "Rollback = flip reads back to GAS, one line")
// ⚠️ ค่าเริ่มต้น false โดยเจตนา: GAS dual-write ยังเป็น no-op จนกว่าจะ seed ScriptProperties
//    (SUPABASE_URL + SUPABASE_SERVICE_KEY) ⇒ ตาราง questions ใน Postgres ยังค้างที่ตอน migration load
//    เปิดเป็น true ได้ก็ต่อเมื่อ mirror ทำงานจริงแล้วและ checkSupabaseMirror() ตรงกับชีท
window.USE_SUPABASE_QUESTIONS = false;

// PostgREST ตัดผลลัพธ์ที่ 1000 แถวเสมอ (§8.7 ข้อ 2) — ทั้ง view และ RPC
window.SUPABASE_PAGE_SIZE = 1000;

// กันเคส updated_at ไม่ monotone กับลำดับ commit (§9.12 ท้ายหัวข้อ): now() คือเวลา "เริ่ม" transaction
// batch ยาวที่เริ่ม T1 แล้ว commit ตอน T3 จะถูก delta ที่ `> T2` ข้ามไปตลอด — ถอยหลัง 60 วิ over-fetch ทางเดียว
// 60 วิ กว้างกว่ารอบ pagination เต็มก้อน (~5 วิ) มาก จึงคลุมช่องว่างระหว่างอ่านหลายหน้าด้วย
window.SUPABASE_CURSOR_SAFETY_MS = 60000;

window.globalData = {
        questions: [],
        structure: [],
        category: [],
        report: [],
        votes: [],
        logs: [],
        announcements: []
    };

window.currentUser = { displayName: 'Guest', avatar: '', username: '', role: '' };

window.isAdmin = false;

window.adminPass = '';

// Google SSO — session token ใช้ร่วมกับ MDKKUQUIZREAL (localStorage key เดียวกัน, origin เดียวกันบน GitHub Pages)
window.sessionToken = '';

window.GOOGLE_CLIENT_ID = "409421225331-envq9b2dg6d2tbq2681c097j4h1qinv4.apps.googleusercontent.com";

window.SHARED_TOKEN_KEY = 'mdkku_session_token';

window.current_question = {};

window.editImageArray = [];

window.editImageIndex = 0;

window.activeUploadsCount = 0;

window.existingMainImages = [];

window.pendingMainImages = [];

window.existingExplainMedia = [];

window.pendingExplainMedia = [];

window.explainImageIndex = 0;

window.explainImageArray = [];

window.choiceImagesData = {};

window.choiceRowCounter = 0;

window.currentLibraryTarget = { type: 'main', rowId: null };

window.isMouseDown = false;

window.startCell = null;

window.isLoggedIn = false;

window.sectionId = null;

window.sectionName = null;

window.regAvatarBase64 = null;

window.regAvatarMimeType = null;

window.isFetching = false;

window.bgToast = Swal.mixin({
        toast: true,
        position: 'bottom-start',
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true
    });

window.dbName = "MDKKU_Admin_DB";

window.storeName = "admin_cache";

window.versionCheckInterval = null;

window.converterStorage = {
        struct: [],
        category: [],
        ques: [],
        current: "struct"
    };

window.converterHeaders = {
        struct: ["#", "Year", "SubjectID", "SubjectName", "AccordionGroup"],
        category: ["#", "CategoryID", "SubjectRef", "AccordionGroup", "CategoryName"],
        ques: ["#", "QuestionID", "Problem", "Image", "Choices", "Answer", "Explanation", "Category"]
    };

// REPLACEMENT
window.transformUrl = (url) => {
    if (!url) return "";
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    if (url.includes('/preview') || url.toLowerCase().includes('.pdf')) return url;
    const match = url.match(/\/d\/(.*?)\//) || url.match(/id=([^&]+)/);
    return (match && match[1]) ? `https://lh3.googleusercontent.com/d/${match[1]}?authuser=1=w1000-h1000` : url;
};

window.parseExplain = function (explainRaw) {
    if (!explainRaw) return { text: "", media: [] };
    const parts = explainRaw.split('///').map(s => s.trim());
    return {
        text: parts[0] || "",
        media: parts.slice(1).filter(Boolean)
    };
};


// ── Explanation rendering helpers (ยกมาจาก MDKKUQUIZREAL/js/quiz-render.js — ให้แสดงผลเหมือนฝั่งนักศึกษา) ──

// เรนเดอร์สูตรคณิตด้วย KaTeX เฉพาะใน element ที่ระบุ (ไม่เดินทั้ง document.body
// เพราะตาราง DataTables/ข้อมูลดิบฝั่ง admin ต้องเห็นค่าที่เก็บจริง ไม่ใช่สูตรที่ถูกแปลง)
window.renderAllMath = function (root) {
    if (typeof renderMathInElement !== 'function') return;
    const el = (root && root.jquery) ? root[0] : (root || document.body);
    if (!el) return;
    renderMathInElement(el, {
        delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
        ],
        throwOnError: false
    });
};

// แปลง Markdown เป็น HTML แบบปลอดภัย (whitelist tags, ไม่มี attribute ใดๆ)
window.renderMarkdownSafe = function (mdText) {
    if (mdText == null) return '';
    var text = String(mdText).replace(/\r\n/g, '\n');

    var escapeHtml = function (s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };

    var codeStore = [];
    var mathStore = [];
    var htmlStore = [];

    text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, function (_m, code) {
        codeStore.push({ block: true, code: code.replace(/\n$/, '') });
        return '\u0000C' + (codeStore.length - 1) + '\u0000';
    });
    text = text.replace(/`([^`\n]+)`/g, function (_m, code) {
        codeStore.push({ block: false, code: code });
        return '\u0000C' + (codeStore.length - 1) + '\u0000';
    });
    // เก็บสูตรทั้ง delimiter ไว้ — KaTeX (renderAllMath) จะอ่านจาก textContent หลัง insert
    text = text.replace(/\$\$[\s\S]+?\$\$/g, function (m) {
        mathStore.push(m);
        return '\u0000M' + (mathStore.length - 1) + '\u0000';
    });
    text = text.replace(/\$[^$\n]+?\$/g, function (m) {
        mathStore.push(m);
        return '\u0000M' + (mathStore.length - 1) + '\u0000';
    });

    // เก็บ legacy HTML tags (b/i/br/u/sup/sub/span) — DB มี tag จริงปนมากับคำอธิบาย
    // เก็บเฉพาะชื่อ tag ทิ้ง attribute ทั้งหมด (กัน onclick/onerror ที่มากับข้อความ AI)
    text = text.replace(/<(\/?)(b|i|br|u|sup|sub|span)\b[^>]*>/gi, function (_m, slash, tag) {
        htmlStore.push('<' + slash + tag.toLowerCase() + '>');
        return "___HTML_TAG_" + (htmlStore.length - 1) + "___";
    });

    text = escapeHtml(text);

    text = text.replace(/___HTML_TAG_(\d+)___/g, function (_m, n) {
        return htmlStore[+n];
    });

    var inlineMd = function (s) {
        return s
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
            .replace(/(^|\s)_([^_\n]+)_/g, '$1<em>$2</em>')
            .replace(/~~([^~]+)~~/g, '<del>$1</del>');
    };

    var lines = text.split('\n');
    var out = [];
    var para = [];
    var flushPara = function () {
        if (para.length) out.push('<p>' + inlineMd(para.join('<br>')) + '</p>');
        para = [];
    };

    var i = 0;
    while (i < lines.length) {
        var trimmed = lines[i].trim();

        if (!trimmed) { flushPara(); i++; continue; }

        // code block ที่อยู่บรรทัดเดี่ยว — วางนอก <p> กัน nesting เพี้ยน
        var soloCode = trimmed.match(/^\u0000C(\d+)\u0000$/);
        if (soloCode && codeStore[+soloCode[1]].block) { flushPara(); out.push(trimmed); i++; continue; }

        if (/^#{1,3}\s+/.test(trimmed)) {
            flushPara();
            var tag = trimmed.match(/^(#{1,3})/)[1].length >= 3 ? 'h5' : 'h4';
            out.push('<' + tag + '>' + inlineMd(trimmed.replace(/^#{1,3}\s+/, '')) + '</' + tag + '>');
            i++; continue;
        }
        if (/^---+$/.test(trimmed)) { flushPara(); out.push('<hr>'); i++; continue; }
        if (/^&gt;\s?/.test(trimmed)) {
            flushPara();
            var bq = [];
            while (i < lines.length && /^&gt;\s?/.test(lines[i].trim())) {
                bq.push(lines[i].trim().replace(/^&gt;\s?/, ''));
                i++;
            }
            out.push('<blockquote>' + inlineMd(bq.join('<br>')) + '</blockquote>');
            continue;
        }
        if (/^[-*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
            flushPara();
            var ordered = /^\d+[.)]\s+/.test(trimmed);
            var itemRe = ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/;
            var items = [];
            while (i < lines.length && itemRe.test(lines[i].trim())) {
                items.push('<li>' + inlineMd(lines[i].trim().replace(itemRe, '')) + '</li>');
                i++;
            }
            out.push(ordered ? '<ol>' + items.join('') + '</ol>' : '<ul>' + items.join('') + '</ul>');
            continue;
        }
        if (/^\|.*\|$/.test(trimmed)) {
            flushPara();
            var rows = [];
            while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
                rows.push(lines[i].trim());
                i++;
            }
            var hasSep = rows.length > 1 && /^\|[\s:|-]+\|$/.test(rows[1]);
            var tableHtml = '<table>';
            rows.forEach(function (row, idx) {
                if (hasSep && idx === 1) return;
                var cellTag = (hasSep && idx === 0) ? 'th' : 'td';
                tableHtml += '<tr>' + row.slice(1, -1).split('|').map(function (c) {
                    return '<' + cellTag + '>' + inlineMd(c.trim()) + '</' + cellTag + '>';
                }).join('') + '</tr>';
            });
            out.push(tableHtml + '</table>');
            continue;
        }

        para.push(trimmed);
        i++;
    }
    flushPara();

    var html = out.join('');
    html = html.replace(/\u0000C(\d+)\u0000/g, function (_m, n) {
        var c = codeStore[+n];
        return c.block
            ? '<pre><code>' + escapeHtml(c.code) + '</code></pre>'
            : '<code>' + escapeHtml(c.code) + '</code>';
    });
    // escape entities ใน math ด้วย — textContent ใน DOM จะกลับเป็นอักขระจริงให้ KaTeX เอง
    html = html.replace(/\u0000M(\d+)\u0000/g, function (_m, n) {
        return escapeHtml(mathStore[+n]);
    });
    return html;
};

window.serializeExplain = function (text, mediaArray) {
    const cleanText = (text || "").trim();
    const cleanMedia = (mediaArray || []).filter(s => s && s.trim() !== "");
    if (cleanMedia.length === 0) return cleanText;
    return [cleanText, ...cleanMedia].join('///');
};

window.getMediaType = function (url) {
    if (!url) return 'unknown';
    if (url.includes('/preview') || url.toLowerCase().includes('.pdf')) return 'pdf';
    if (url.startsWith('<svg')) return 'svg';
    return 'image';
};

window.compressImage = async function (base64Str, maxWidth = 400, maxHeight = 400, quality = 0.7) {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = base64Str;
            img.onerror = () => resolve(base64Str); // ไฟล์เสีย/ถอดรหัสไม่ได้ — ใช้ต้นฉบับแทนแทนที่จะค้าง
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
        });
    }

// รายงานที่ยัง "ค้าง" จริง ๆ — เช็คทั้ง Done และ Status
// (แถวเก่าที่ backend AutoResolved ไว้ก่อนแพตช์ Done=TRUE จะมี Done ว่าง จึงต้องกรอง Status ด้วย)
window.isPendingReport = function (r) {
        if (!r) return false;
        const done = r.Done && String(r.Done).toUpperCase() === 'TRUE';
        const status = String(r.Status || '').trim();
        return !done && status !== 'AutoResolved' && status !== 'Resolved' && status !== 'Rejected';
    }

window.formatDate = function (dateString) {
        // ... (โค้ด formatDate เดิม) ...
        if (!dateString) return '';
        const d = new Date(dateString);
        return d instanceof Date && !isNaN(d) ? d.toLocaleString('th-TH') : dateString;
        // ... (จบโค้ด formatDate เดิม) ...
    }
