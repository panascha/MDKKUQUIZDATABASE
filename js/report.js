// ─────────────────────────────────────────────────────
// JS/REPORT.JS
// ─────────────────────────────────────────────────────

// เก็บโจทย์+ตัวเลือกของแต่ละการ์ด ไว้ให้ปุ่ม "คัดลอกคำถาม" หยิบตอนคลิก
// (ไม่ฝัง prompt ลงใน attribute เพราะข้อความไทย/เครื่องหมายคำพูดจะทำ HTML พัง)
let reportCopySource = [];

// กลุ่มที่ render อยู่ตอนนี้ — index ตรงกับ data-gi ของการ์ด
let reportGroups = [];
let reportSearchTimer = null;

// ค่าจาก Report sheet มาจาก submitReport ที่ไม่ต้องล็อกอิน ⇒ ต้อง escape ก่อนลง HTML เสมอ
// (escapeHtml ใน tables.js รับได้แค่ string — ค่าจากชีทอาจเป็นตัวเลข)
function reportEsc(v) {
    return escapeHtml(String(v == null ? '' : v)) || '';
}

// เฉลย/คำตอบที่เป็นรูปหรือ SVG ย่อเป็น [รูปภาพ] (แบบเดียวกับ pending-reports.js ฝั่ง REAL)
function reportAnsLabel(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '-';
    return (s.startsWith('http') || s.startsWith('<svg')) ? '[รูปภาพ]' : reportEsc(s);
}

function reportVotes(r) {
    return parseInt(r['VoteCount']) || 0;
}

function reportTimeMs(r) {
    return new Date(r['Time']).getTime() || 0;
}

// หมายเหตุ admin ต่อกลุ่ม (key = group.key) — อยู่รอดข้ามการสลับแท็บ/ค้นหา/เลือกรายการ
let reportNotes = new Map();
let reportActiveTab = 'all';
let reportSelectedKey = null;

function reportNorm(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// แถวเก่าที่ QuestionID ว่าง: จับคู่กับข้อใน DB ด้วยโจทย์ (ซ้ำกันหลายข้อ = กำกวม = ไม่จับคู่)
function buildReportQidResolver(questions) {
    const byProblem = new Map();
    (questions || []).forEach(q => {
        const k = reportNorm(q.problem);
        if (!k) return;
        byProblem.set(k, byProblem.has(k) ? null : q.questionId);
    });
    return function (r) {
        const own = String(r['QuestionID'] || '').trim();
        if (own) return own;
        return byProblem.get(reportNorm(r['Question'])) || '';
    };
}

function reportCurrentAnswer(q) {
    return String((q && q.answer) || '').trim();
}

function copyReportQuestion(index) {
    const src = reportCopySource[index];
    if (!src) return;
    window.copyQuestionPrompt(src.problem, src.choices);
}

// รวม report ที่รอตรวจเป็น 1 กลุ่มต่อ 1 QuestionID (แถวเก่าที่ไม่มี QuestionID จับคู่ด้วยโจทย์ ถ้าไม่ได้ก็รวมตามโจทย์เดียวกัน)
// แล้วแตกย่อยตาม SuggestedAnswer ที่เหมือนกันเป๊ะ — ไม่ใช้ Category เป็น key
// เรียงตามคะแนนโหวตสูงสุดของ "ตั๋วเดียว" — backend ตัดสิน auto-resolve ราย ticket ไม่ใช่ผลรวม
function buildReportGroups(reports, resolveQid, questionById) {
    resolveQid = resolveQid || (r => String(r['QuestionID'] || '').trim());
    questionById = questionById || new Map();
    const byKey = new Map();
    reports.forEach(r => {
        const qid = resolveQid(r);
        const norm = reportNorm(r['Question']);
        const key = qid ? 'q:' + qid : (norm ? 'p:' + norm : 't:' + r['Time']);
        if (!byKey.has(key)) byKey.set(key, { key: key, qid: qid, reports: [], qidTickets: [], tsTickets: [] });
        const g = byKey.get(key);
        g.reports.push(r);
        // backend แก้ด้วย questionId ได้เฉพาะแถวที่ col C มี QID ของตัวเอง — แถวเก่าต้องยิงด้วย timestamp
        if (String(r['QuestionID'] || '').trim()) g.qidTickets.push(r);
        else g.tsTickets.push(r);
    });

    const groups = Array.from(byKey.values());
    groups.forEach(g => {
        g.dbQuestion = (g.qid && questionById.get(g.qid)) || null;
        g.currentAnsRaw = reportCurrentAnswer(g.dbQuestion);
        const dbChoices = g.dbQuestion
            ? String(g.dbQuestion.choices || '').split('///').map(s => s.trim()).filter(Boolean)
            : [];

        const bySuggest = new Map();
        g.reports.forEach(r => {
            const s = String(r['SuggestedAnswer'] == null ? '' : r['SuggestedAnswer']).trim();
            if (!bySuggest.has(s)) bySuggest.set(s, []);
            bySuggest.get(s).push(r);
        });
        g.disputes = Array.from(bySuggest.entries()).map(([suggested, tickets]) => {
            tickets.sort((a, b) => (reportVotes(b) - reportVotes(a)) || (reportTimeMs(a) - reportTimeMs(b)));
            const sameAsCurrent = suggested !== '' && suggested === g.currentAnsRaw;
            return {
                suggested: suggested,
                tickets: tickets,
                topVotes: reportVotes(tickets[0]),
                totalVotes: tickets.reduce((s, r) => s + reportVotes(r), 0),
                sameAsCurrent: sameAsCurrent,
                quickApplyOk: !!g.dbQuestion && suggested !== '' && !sameAsCurrent && dbChoices.includes(suggested)
            };
        }).sort((a, b) => (b.topVotes - a.topVotes) || (b.totalVotes - a.totalVotes));

        g.maxVotes = Math.max(...g.reports.map(reportVotes));
        g.totalVotes = g.reports.reduce((s, r) => s + reportVotes(r), 0);
        g.oldest = Math.min(...g.reports.map(reportTimeMs));
        g.newest = Math.max(...g.reports.map(reportTimeMs));

        g.hasDiscrepancy = g.disputes.some(d => d.suggested !== '' && d.suggested !== g.currentAnsRaw);
        g.isComment = !!g.dbQuestion && !g.hasDiscrepancy;
        g.isUrgent = g.maxVotes >= 3;
        g.isMissingImg = g.reports.some(r => /ไม่มีรูป|รูปหาย/.test(String(r['ReportDetail'] || '')));
    });

    groups.sort((a, b) => (b.maxVotes - a.maxVotes) || (b.totalVotes - a.totalVotes) || (a.oldest - b.oldest));
    return groups;
}

function getReportNote(g) {
    return reportNotes.has(g.key) ? reportNotes.get(g.key) : String((g.reports[0] && g.reports[0].AdminNote) || '');
}

function setReportNote(i, v) {
    const g = reportGroups[i];
    if (g) reportNotes.set(g.key, v);
}

function renderReportList() {
        const container = $('#report-list-container');
        container.empty();
        reportCopySource = [];
        reportGroups = [];
        const prevSelectedKey = reportSelectedKey; // re-render (app.js refresh) must keep the open detail by key
        clearReportDetail();

        const filterSubj = $('#report-subject-filter').val();
        const pending = globalData.report.filter(r => window.isPendingReport(r));

        let filteredReports = pending;
        if (filterSubj) {
            const cleanFilterSubj = filterSubj.toUpperCase(); // แปลง Subject ID ที่เลือกให้เป็นตัวพิมพ์ใหญ่

            filteredReports = pending.filter(r => {
                const reportFrom = String(r['From'] || "").trim().toUpperCase(); // ดึงค่าจาก 'From' และแปลงเป็นตัวพิมพ์ใหญ่

                return reportFrom === cleanFilterSubj;
            });

        }

        console.log(`Rendering ${filteredReports.length} reports (Filtered by subject: ${filterSubj || 'None'})`);

        if (filteredReports.length === 0) {
            container.html('<div class="text-center text-muted py-5"><i class="fas fa-check-circle fa-3x text-success mb-3"></i><br>ไม่มีรายการแจ้งปัญหาใหม่</div>');
            updateReportTabCounts();
            updateReportBatchUI();
            return;
        }

        const questionById = new Map(globalData.questions.map(q => [q.questionId, q]));
        const resolveQid = buildReportQidResolver(globalData.questions);
        reportGroups = buildReportGroups(filteredReports, resolveQid, questionById);

        const rows = reportGroups.map((g, index) => {
            const r = g.reports[0];
            const dbQuestion = g.dbQuestion || {};
            const dbChoices = String(dbQuestion.choices || '').trim()
                ? String(dbQuestion.choices).split('///').map(s => s.trim()).filter(Boolean)
                : null;

            reportCopySource[index] = {
                problem: r['Question'] || dbQuestion.problem || '',
                choices: dbChoices || String(r['Choices'] || '').split('\n')
            };

            g.searchText = [g.qid, dbQuestion.problem].concat(g.reports.map(rep => rep['Question']))
                .map(s => String(s || '')).join(' ').toLowerCase();

            const fromList = Array.from(new Set(g.reports.map(rep => String(rep['From'] || '').trim()).filter(Boolean)));
            const top = g.disputes[0];
            const curLabel = g.currentAnsRaw ? reportAnsLabel(g.currentAnsRaw) : '?';
            const label = g.qid || 'ไม่ทราบ QuestionID';

            return `<div class="report-group rp-row${g.isUrgent ? ' rp-urgent' : ''}" data-gi="${index}" onclick="selectReportGroup(${index})">
                <input type="checkbox" class="form-check-input report-select" onclick="event.stopPropagation()" onchange="updateReportBatchUI()" title="เลือกเพื่อ Batch Reject">
                <div class="rp-main">
                    <div class="d-flex flex-wrap align-items-center gap-1">
                        <span class="badge ${g.maxVotes >= 3 ? 'bg-danger' : 'bg-secondary'}" title="โหวตสูงสุด">${g.maxVotes}</span>
                        <b class="small">${reportEsc(label)}</b>
                        <span class="small text-muted">${reportEsc(fromList.join(', '))}</span>
                        <span class="badge bg-light text-dark border ms-auto">${g.reports.length} reports</span>
                    </div>
                    <div class="rp-diff small">${curLabel} ➔ ${top ? reportAnsLabel(top.suggested) : '-'}</div>
                    <div class="small text-muted">${reportEsc(formatDate(g.newest ? new Date(g.newest) : r['Time']))}</div>
                </div>
            </div>`;
        });
        container.html(rows.join(''));

        reportSelectedKey = prevSelectedKey;
        updateReportTabCounts();
        applyReportSearch();
    }

function clearReportDetail() {
    reportSelectedKey = null;
    $('#report-detail-pane').html('<div class="text-muted">เลือกรายการทางซ้าย</div>');
}

function selectReportGroup(i) {
    const g = reportGroups[i];
    if (!g || g.removed) return;
    reportSelectedKey = g.key;
    $('#report-list-container .report-group').removeClass('active');
    $(`#report-list-container .report-group[data-gi="${i}"]`).addClass('active');
    renderReportDetail(g, i);
    if (window.matchMedia && window.matchMedia('(max-width: 991px)').matches) {
        const el = $('#report-detail-pane').get(0);
        if (el) el.scrollIntoView({ block: 'nearest' });
    }
}

// สร้าง detail แบบ lazy ตอนเลือกเท่านั้น (เดิม render ทุกกลุ่มพร้อมกัน → หน้าอืด)
function renderReportDetail(g, index) {
    const r = g.reports[0];
    const dbQuestion = g.dbQuestion || {};
    const currentAnsRaw = g.currentAnsRaw;
    const currentAns = currentAnsRaw ? reportAnsLabel(currentAnsRaw) : 'ไม่พบข้อมูลใน DB';
    const explanation = dbQuestion.explain ? window.renderMarkdownSafe(dbQuestion.explain) : '(ไม่มีคำอธิบาย)';

    // ตัวเลือกใน DB คั่นด้วย '///' ส่วนที่มากับ report คั่นด้วยขึ้นบรรทัดใหม่ — ใช้ของ DB ก่อนถ้าหาเจอ
    // (ของ DB แอดมินเป็นคนใส่ จึง render รูป/SVG ได้; ของ report เป็นข้อความจากผู้ใช้ ⇒ escape ทั้งก้อน)
    const dbChoices = String(dbQuestion.choices || '').trim()
        ? String(dbQuestion.choices).split('///').map(s => s.trim()).filter(Boolean)
        : null;
    let choicesStr;
    if (dbChoices) {
        choicesStr = dbChoices.map((c, i) => {
            let body = reportEsc(c);
            if (c.startsWith('http')) {
                body = `<img src="${reportEsc(transformUrl(c))}" style="max-height:60px;" alt="choice">`;
            } else if (c.startsWith('<svg')) {
                body = `<div style="width:40px; height:40px; display:inline-block; vertical-align:middle;">${c}</div>`;
            }
            return `<b>${String.fromCharCode(65 + i)}.</b> ${body}`;
        }).join('<br>');
    } else {
        choicesStr = r['Choices'] ? reportEsc(r['Choices']).replace(/\n/g, '<br>') : '-';
    }

    let imgHtml = '';
    const rawImg = String(r['Image'] || "").trim();
    if (rawImg && (rawImg.startsWith('http') || rawImg.startsWith('https'))) {
        let url = (rawImg.match(/"([^"]+)"/) && rawImg.match(/"([^"]+)"/)[1]) ? rawImg.match(/"([^"]+)"/)[1] : rawImg;
        url = reportEsc(transformUrl(url));
        imgHtml = `<div class="my-2 text-center">
                    <a href="${url}" target="_blank">
                        <img src="${url}" class="img-thumbnail" style="max-height: 200px;" alt="Q Img">
                    </a>
                </div>`;
    } else if (rawImg.length > 0) {
        imgHtml = `<div class="alert alert-warning py-1 small"><i class="fas fa-exclamation-triangle"></i> ข้อมูลรูปภาพ: ${reportEsc(rawImg)}</div>`;
    }

    const fromList = Array.from(new Set(g.reports.map(rep => String(rep['From'] || '').trim()).filter(Boolean)));

    const disputesHtml = g.disputes.map((d, di) => {
        const details = d.tickets.map(t => `
            <li>${reportEsc(t['ReportDetail']) || '-'}
                <span class="text-muted">— ${reportEsc(formatDate(t['Time']))}${reportVotes(t) > 0 ? `, ${reportVotes(t)} votes` : ''}${t['From'] ? `, ${reportEsc(t['From'])}` : ''}</span>
            </li>`).join('');
        const quickBtn = d.quickApplyOk
            ? `<button class="btn btn-warning btn-sm" onclick="quickApplyReport(${index}, ${di})"><i class="fas fa-bolt"></i> Quick Apply</button>`
            : `<button class="btn btn-warning btn-sm" disabled title="${g.dbQuestion ? 'คำตอบที่เสนอไม่ตรงกับตัวเลือกใด ๆ หรือเหมือนเฉลยเดิม' : 'ไม่พบข้อสอบนี้ใน Database'}"><i class="fas fa-bolt"></i> Quick Apply</button>`;
        return `
        <div class="border rounded p-2 mb-2 bg-white">
            <div class="d-flex flex-wrap align-items-center gap-1 mb-1">
                <span class="badge bg-secondary text-wrap text-start">Current: ${currentAns}</span>
                <i class="fas fa-arrow-right text-muted small"></i>
                <span class="badge bg-warning text-dark text-wrap text-start">Suggested: ${reportAnsLabel(d.suggested)}</span>
                ${d.sameAsCurrent ? '<span class="badge bg-light text-muted border">เหมือนเฉลยปัจจุบัน</span>' : ''}
            </div>
            <div class="small text-muted mb-1">
                ${d.tickets.length} reports · top ${d.topVotes} votes${d.tickets.length > 1 ? ` (รวม ${d.totalVotes})` : ''}
            </div>
            <ul class="small mb-2 ps-3">${details}</ul>
            <div class="d-flex gap-2">
                <button class="btn btn-success btn-sm flex-fill rp-edit-btn" data-time="${reportEsc(d.tickets[0]['Time'])}">
                    <i class="fas fa-edit"></i> Edit & Approve
                </button>
                ${quickBtn}
            </div>
        </div>`;
    }).join('');

    const $pane = $('#report-detail-pane');
    $pane.html(`
    <div class="card shadow-sm border-0 bg-white rp-detail-body">
        <div class="card-body">
            <h6 class="text-primary fw-bold mb-1">
                <i class="fas fa-hashtag me-1"></i> ${reportEsc(g.qid) || 'ไม่ทราบ QuestionID'}
                <span class="badge bg-danger ms-2">${g.reports.length} reports</span>
                ${g.totalVotes > 0 ? `<span class="badge bg-secondary ms-1"><i class="fas fa-users"></i> top ${g.maxVotes} · รวม ${g.totalVotes} votes</span>` : ''}
            </h6>
            <p class="small text-muted mb-2">Reported by: ${reportEsc(fromList.join(', '))}</p>

            <div class="p-3 bg-light rounded mb-2">
                <p class="mb-2"><strong>Question:</strong> ${reportEsc(r['Question'])}</p>
                ${imgHtml}
                <div class="mb-0 small text-secondary"><strong>Choices:</strong><br><pre style="white-space: pre-wrap; margin:0; font-family:inherit;">${choicesStr}</pre></div>
            </div>
            <div class="mb-3 small text-muted"><strong>Explanation:</strong> ${explanation}</div>

            <div class="diff-label text-danger fw-bold border-bottom pb-2 mb-2">
                <i class="fas fa-exclamation-circle"></i> ReportDetail
            </div>
            ${disputesHtml}

            <label class="small fw-bold mb-1">Admin Note (บันทึกการแก้ไข):</label>
            <textarea id="admin-note-${index}" class="form-control form-control-sm mb-2" rows="2"
                placeholder="เช่น แก้ไขแล้ว, หรือ ปฏิเสธเนื่องจาก..." oninput="setReportNote(${index}, this.value)">${reportEsc(getReportNote(g))}</textarea>

            <button class="btn btn-outline-primary btn-sm w-100 mb-2" onclick="copyReportQuestion(${index})" title="คัดลอกโจทย์และตัวเลือกไปถาม AI">
                <i class="fas fa-copy"></i> คัดลอกคำถาม
            </button>
            <button class="btn btn-outline-secondary btn-sm w-100" onclick="rejectReportGroup(${index})">
                <i class="fas fa-times"></i> Reject ทั้งข้อ (${g.reports.length})
            </button>
        </div>
    </div>`);
    $pane.find('.rp-edit-btn').on('click', function () {
        openEditReportModal(String($(this).attr('data-time')));
    });
    window.renderAllMath($pane);
}

// ── แท็บ (ไม่ exclusive: กลุ่มเดียวอยู่ได้หลายแท็บ) ──
function reportTabMatch(g, tab) {
    if (tab === 'urgent') return g.isUrgent;
    if (tab === 'discrepancy') return g.hasDiscrepancy;
    if (tab === 'comment') return g.isComment;
    if (tab === 'missingimg') return g.isMissingImg;
    return true;
}

function setReportTabState(name) {
    reportActiveTab = name;
    $('#report-tabs [data-tab]').each(function () {
        $(this).toggleClass('active', $(this).attr('data-tab') === name);
    });
    $('#report-dismiss-same-btn').toggleClass('d-none', name !== 'comment');
}

function setReportTab(name) {
    setReportTabState(name);
    applyReportSearch();
}

function updateReportTabCounts() {
    const live = reportGroups.filter(g => !g.removed);
    ['all', 'urgent', 'discrepancy', 'comment', 'missingimg'].forEach(t => {
        $('#report-tab-count-' + t).text(live.filter(g => reportTabMatch(g, t)).length);
    });
    $('#report-tabs [data-tab="all"]').attr('title', live.reduce((s, g) => s + g.reports.length, 0) + ' reports');
}

// ── ค้นหา/แท็บ: ซ่อน/แสดงแถวที่ render ไว้แล้ว (ไม่ render ใหม่ — Admin Note ที่พิมพ์ค้างกับ checkbox จะไม่หาย) ──
function onReportSearchInput() {
    clearTimeout(reportSearchTimer);
    reportSearchTimer = setTimeout(applyReportSearch, 200);
}

function applyReportSearch() {
    const term = String($('#report-search-input').val() || '').trim().toLowerCase();
    const run = function () {
        let visible = 0;
        $('#report-list-container .report-group').each(function () {
            const g = reportGroups[Number($(this).attr('data-gi'))];
            const hide = !g || g.removed || (!!term && !g.searchText.includes(term)) || !reportTabMatch(g, reportActiveTab);
            // ใช้คลาส d-none แทน .toggle() — ตอน render ทั้ง section อาจยังซ่อนอยู่
            $(this).toggleClass('d-none', hide);
            if (!hide) visible++;
        });
        return visible;
    };
    let visible = run();
    // เข้ามาจาก badge REPORT ขณะที่แท็บอื่นเปิดอยู่ ต้องไม่ซ่อนข้อที่ค้นหา
    if (term && visible === 0 && reportActiveTab !== 'all') {
        setReportTabState('all');
        visible = run();
    }

    const selIdx = reportGroups.findIndex(g => g.key === reportSelectedKey && !g.removed);
    const $sel = selIdx === -1 ? $() : $(`#report-list-container .report-group[data-gi="${selIdx}"]`);
    if (selIdx !== -1 && !$sel.hasClass('d-none')) {
        if (!$('#report-detail-pane .rp-detail-body').length) selectReportGroup(selIdx);
    } else {
        const $first = $('#report-list-container .report-group:not(.d-none)').first();
        if ($first.length) selectReportGroup(Number($first.attr('data-gi')));
        else clearReportDetail();
    }
    updateReportBatchUI();
}

// การ์ดที่ถูกเลือกและไม่ถูกตัวกรองค้นหาซ่อนอยู่ — Batch Reject ทำเฉพาะสิ่งที่แอดมินมองเห็น
function getSelectedReportCards() {
    return $('#report-list-container .report-group:not(.d-none)').filter(function () {
        return $(this).find('.report-select').prop('checked');
    });
}

function updateReportBatchUI() {
    const count = getSelectedReportCards().length;
    $('#report-batch-count').text(count);
    $('#report-batch-reject-btn').prop('disabled', count === 0);
    if (count === 0) $('#report-select-all').prop('checked', false);
}

function toggleReportSelectAll(checked) {
    $('#report-list-container .report-group:not(.d-none) .report-select').prop('checked', checked);
    updateReportBatchUI();
}

function removeReportCards($cards) {
    $cards.each(function () {
        const g = reportGroups[Number($(this).attr('data-gi'))];
        if (g) g.removed = true;
    });
    updateReportTabCounts();
    if (!reportGroups.some(g => g.key === reportSelectedKey && !g.removed)) clearReportDetail();
    $cards.fadeOut(300, function () {
        $(this).remove();
    });
    setTimeout(() => {
        if ($('#report-list-container .report-group').length === 0) renderReportList();
        else applyReportSearch();
    }, 350);
}

// question.js เรียกหลัง Edit & Approve สำเร็จ (ปิดเฉพาะแถวที่มี QuestionID ของตัวเอง)
// แถวเก่าที่ไม่มี QuestionID แต่ถูกจับกลุ่มมาด้วยต้องปิดต่อด้วย timestamp
function removeReportCardByQid(qid) {
    const q = String(qid || '').trim();
    const gi = reportGroups.findIndex(g => g.qid && g.qid === q && !g.removed);
    if (gi === -1) return;
    const g = reportGroups[gi];
    const pendingTs = g.tsTickets.filter(r => window.isPendingReport(r));
    if (pendingTs.length) {
        sendReportStatusForGroup(
            { qid: g.qid, qidTickets: [], tsTickets: pendingTs, reports: pendingTs },
            'Resolved',
            getReportNote(g) || 'แก้ไขเรียบร้อยแล้ว'
        ).catch(console.warn);
    }
    removeReportCards($(`#report-list-container .report-group[data-gi="${gi}"]`));
}

function openReportModal(q) {
        // ... (โค้ด openReportModal เดิม) ...
        const $reportCard = $('#report-card');

        $('#report_text').val('');
        $('#report-new-choice-input').val('');
        $('#report-question-images').empty();
        $('#report-choices-list').empty();
        const $select = $('#report-correct-choice-select').empty();

        $('#report-question-text').html(q.problem.replace(/\n/g, '<br>'));

        if (q.img) {
            q.img.split('///').forEach(url => {
                if (url.trim()) {
                    $('#report-question-images').append(`<img src="${transformUrl(url)}" class="report-img-preview">`);
                }
            });
        }

        const choicesArray = (q.choices || "").split("///").map(s => s.trim()).filter(Boolean);

        let selectOptions = '<option value="newanswer">-- ใช้คำตอบใหม่ (พิมพ์ด้านล่าง) --</option>';

        choicesArray.forEach((choice, index) => {
            const letter = String.fromCharCode(65 + index);
            const isCurrentAns = (choice === q.answer);

            let displayContent = choice;
            if (choice.startsWith('http')) {
                displayContent = `<img src="${transformUrl(choice)}" class="report-choice-img">`;
            }
            $('#report-choices-list').append(`<p class="mb-1 border-bottom pb-1"><b>${letter}.</b> ${displayContent}</p>`);

            let dropText = choice.startsWith('http') ? `[รูปภาพ] ${choice.substring(0, 20)}...` : choice;
            selectOptions += `<option value="${choice}" ${isCurrentAns ? 'selected' : ''}>
                ${letter}. ${dropText} ${isCurrentAns ? '(เฉลยปัจจุบัน)' : ''}
            </option>`;
        });

        $select.html(selectOptions);
        $reportCard.css('display', 'flex').hide().fadeIn();
        // ... (จบโค้ด openReportModal เดิม) ...
    }

// ส่งสถานะของ 1 กลุ่มไป backend แล้วค่อยแก้ state ในเครื่อง "หลัง" เซิร์ฟเวอร์ตอบสำเร็จเท่านั้น
// (ไม่ใช้ sendAdminAction: มัน optimistic ก่อนส่ง + เด้ง toast/Swal เองทุกครั้ง ซึ่งจะปิด progress ของ batch)
// backend: questionId แก้เฉพาะแถวที่ col C = QID ของตัวเอง, timestamp แก้ทีละแถว ⇒ แถวเก่า (QID ว่าง) ต้องยิง timestamp ต่อแถว
// ยิงทีละครั้งแบบ await (admin lock tier) — error ใด ๆ (รวม forbidden) throw พร้อมข้อความจาก server, ไม่ logout
async function sendReportStatusForGroup(group, status, note) {
    const call = async function (target) {
        const resJson = await sendWithRetry({
            action: 'updateReportStatus',
            username: currentUser.username,
            adminPass: adminPass,
            user: currentUser.displayName,
            data: Object.assign({ adminNote: note, status: status, done: 'TRUE' }, target),
            metadata: navigator.userAgent
        });
        if (!resJson || resJson.result !== 'success') {
            throw new Error((resJson && resJson.message) || 'Server error');
        }
    };
    const mark = function (rep) {
        if (window.isPendingReport(rep)) {
            rep.Status = status;
            rep.AdminNote = note;
            rep.Done = 'TRUE';
        }
    };

    if (group.qid && group.qidTickets.length) {
        await call({ questionId: group.qid });
        group.qidTickets.forEach(mark);
    }
    for (const row of group.tsTickets.filter(r => window.isPendingReport(r))) {
        await call({ timestamp: row['Time'] });
        mark(row);
    }
}

function sendReportReject(group, note) {
    return sendReportStatusForGroup(group, 'Rejected', note);
}

async function rejectReportGroup(index) {
        const group = reportGroups[index];
        if (!group) return;
        if (!confirmAdmin()) return;

        const $card = $(`#report-list-container .report-group[data-gi="${index}"]`);
        const result = await Swal.fire({
            title: 'ยืนยันการปฏิเสธ (Reject)?',
            text: `ปฏิเสธรายงานที่รอตรวจทั้งหมดของข้อนี้ (${group.reports.length} รายการ)`,
            icon: 'question',
            showCancelButton: true
        });
        if (!result.isConfirmed) return;

        const note = getReportNote(group);
        $card.css({ opacity: 0.5, pointerEvents: 'none' });
        try {
            await sendReportReject(group, note);
            removeReportCards($card);
            updateDashboard();
            await setCacheDB('global_admin_data', globalData);
        } catch (e) {
            console.error("Report Reject Failed:", e);
            $card.css({ opacity: '', pointerEvents: '' });
            Swal.fire({
                icon: 'error',
                title: 'บันทึกสถานะ Report ไม่สำเร็จ',
                text: (e && e.message) || 'กรุณาลองใหม่อีกครั้งในภายหลัง',
                toast: true, position: 'bottom-end', showConfirmButton: false, timer: 5000
            });
        }
    }

// ยิง reject ทีละข้อพร้อม progress — ใช้ร่วมกันระหว่าง Batch Reject และ Batch Dismiss
// items = [{ $card, group, note }]
async function runReportRejectBatch(items) {
    Swal.fire({
        title: 'กำลัง Reject...',
        html: `0 / ${items.length}`,
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading()
    });

    const failed = [];
    let $done = $();
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        try {
            await sendReportReject(it.group, it.note);
            $done = $done.add(it.$card);
        } catch (e) {
            console.error("Batch Reject Failed:", it.group.key, e);
            failed.push(it.group.qid || it.group.key);
        }
        const progress = Swal.getHtmlContainer();
        if (progress) progress.textContent = `${i + 1} / ${items.length}`;
    }

    removeReportCards($done);
    updateDashboard();
    await setCacheDB('global_admin_data', globalData);

    if (failed.length === 0) {
        Swal.fire({ icon: 'success', title: `Reject สำเร็จ ${$done.length} ข้อ`, timer: 2000, showConfirmButton: false });
    } else {
        Swal.fire({
            icon: 'warning',
            title: `สำเร็จ ${$done.length} / ล้มเหลว ${failed.length} ข้อ`,
            html: `ข้อที่ล้มเหลวยังอยู่ในรายการ ลองใหม่ได้:<br><small>${failed.map(reportEsc).join('<br>')}</small>`
        });
    }
}

// Batch Reject เท่านั้น — ไม่มี Batch Approve โดยตั้งใจ (การแก้เฉลยต้องตรวจทีละข้อ)
// ยิงทีละข้อแบบ await: updateReportStatus อยู่ใน admin lock tier ยิงขนานกันจะแย่ง lock กันเอง
async function batchRejectReports() {
    if (!confirmAdmin()) return;

    const cards = getSelectedReportCards().toArray();
    if (cards.length === 0) return;
    const items = cards.map(el => {
        const group = reportGroups[Number($(el).attr('data-gi'))];
        return { $card: $(el), group: group, note: getReportNote(group) };
    });
    const totalReports = items.reduce((s, it) => s + it.group.reports.length, 0);

    const result = await Swal.fire({
        title: `Reject ${items.length} ข้อ?`,
        text: `ปฏิเสธรายงานที่รอตรวจทั้งหมดของข้อที่เลือก (${totalReports} รายการ) — ใช้ Admin Note ของแต่ละข้อ`,
        icon: 'warning',
        showCancelButton: true
    });
    if (!result.isConfirmed) return;

    await runReportRejectBatch(items);
}

// Batch Dismiss: เฉพาะแท็บ Comments / Same Key (ไม่มีข้อเสนอที่ขัดกับเฉลยปัจจุบัน) — ไม่แตะกลุ่มที่มี discrepancy
async function dismissSameKeyReports() {
    if (reportActiveTab !== 'comment') return;
    if (!confirmAdmin()) return;

    const items = $('#report-list-container .report-group:not(.d-none)').toArray().map(el => {
        const group = reportGroups[Number($(el).attr('data-gi'))];
        return { $card: $(el), group: group };
    }).filter(it => it.group && it.group.isComment && !it.group.hasDiscrepancy)
      .map(it => Object.assign(it, { note: getReportNote(it.group) || 'ปิดรายการ: ความเห็นเฉลยตรงกับเฉลยปัจจุบัน' }));
    if (items.length === 0) return;
    const totalReports = items.reduce((s, it) => s + it.group.reports.length, 0);

    const result = await Swal.fire({
        title: `Dismiss ${items.length} ข้อ?`,
        text: `เปลี่ยนสถานะเป็น Rejected ให้รายงานที่รอตรวจของ ${items.length} ข้อที่เห็นอยู่ (${totalReports} รายการ) — ทุกข้อไม่มีข้อเสนอที่ขัดกับเฉลยปัจจุบัน`,
        icon: 'warning',
        showCancelButton: true
    });
    if (!result.isConfirmed) return;

    await runReportRejectBatch(items);
}

// ── Quick Apply ──
// ส่วน core ไม่แตะ DOM: (ถ้าเลือก) ให้ AI เขียนคำอธิบายใหม่ → editQuestion ทั้งแถวด้วยค่าเดิมทุกช่อง ยกเว้น answer/explain
// deps = { sendWithRetry, user, pass }
async function reportQuickApplyCore(q, suggested, regenExplain, deps) {
    let newExplain = String(q.explain || '');
    if (regenExplain) {
        const images = String(q.img || '').split('///').map(s => s.trim()).filter(s => s.startsWith('http'));
        const show = c => (c.startsWith('http') || c.startsWith('<svg')) ? '[รูปภาพ]' : c;
        const choiceLines = String(q.choices || '').split('///').map(s => s.trim()).filter(Boolean)
            .map(c => '- ' + show(c)).join('\n');
        const prompt = `คุณคือผู้เชี่ยวชาญด้านการแพทย์และอาจารย์ผู้เขียนเฉลยข้อสอบ MCQ แพทย์ กรุณาเขียนคำอธิบายเฉลยของข้อสอบข้างล่าง
[กฎ]
- เขียนเป็นย่อหน้าเดียว 4-6 ประโยค ไม่ต้องมีคำนำหรือประโยคสรุปขึ้นต้น
- ห้ามใช้ ** (bold), bullet, ขึ้นบรรทัดใหม่ และห้ามใส่ ///
- อธิบายว่าทำไม "${show(suggested)}" จึงเป็นคำตอบที่ถูก และทำไมตัวเลือกอื่นผิด โดยอ้างอิงจากข้อความของตัวเลือก ไม่ใช้ตัวอักษร A/B/C

[โจทย์]
${q.problem}

[ตัวเลือก]
${choiceLines}

[เฉลยที่ถูกต้อง]
${show(suggested)}`;

        const res = await deps.sendWithRetry({
            action: 'askAIExpert',
            prompt: prompt,
            provider: 'Gemini',
            images: images,
            username: deps.user,
            adminPass: deps.pass
        }, 1);
        const ans = res && res.answer ? String(res.answer) : '';
        if (!res || res.result !== 'success' || !ans.trim() || ans.includes('⚠️')) {
            throw new Error('AI_FAILED:' + ((res && res.message) || ans || 'empty'));
        }
        const text = ans.replace(/\r?\n/g, ' ').replace(/\/\/\//g, '').replace(/\*\*/g, '').trim();
        if (!text) throw new Error('AI_FAILED:empty');
        newExplain = window.serializeExplain(text, String(q.explain || '').split('///').slice(1));
    }

    const editRes = await deps.sendWithRetry({
        action: 'editQuestion',
        username: deps.user,
        adminPass: deps.pass,
        data: {
            id: q.questionId,
            problem: q.problem,
            img: q.img || '',
            choices: q.choices || '',
            answer: suggested,
            explain: newExplain,
            category: q.category
        }
    });
    if (!editRes || editRes.result !== 'success') {
        throw new Error((editRes && editRes.message) || 'Server error');
    }
    return { newExplain: newExplain };
}

// แก้เฉลยเป็นข้อเสนอของ dispute นี้ (ต้องเป็นตัวเลือกที่มีอยู่จริง) — 3 call ไม่ atomic:
// askAIExpert → editQuestion → updateReportStatus(Resolved) ถ้า call สุดท้ายพังหลังแก้เฉลยแล้วจะเตือนแต่ไม่ rollback
async function quickApplyReport(gi, di) {
    if (!confirmAdmin()) return;
    const g = reportGroups[gi];
    const d = g && g.disputes[di];
    if (!d || !d.quickApplyOk) return;
    const q = g.dbQuestion;

    const res = await Swal.fire({
        title: 'Quick Apply?',
        html: `เปลี่ยนเฉลยของข้อ <b>${reportEsc(q.questionId)}</b><br>
               ${reportAnsLabel(g.currentAnsRaw)} ➔ ${reportAnsLabel(d.suggested)}<br>
               <small>จะแก้เฉลยในฐานข้อมูลทันที และปิดรายงานที่รอตรวจทั้งหมดของข้อนี้ (${g.reports.length} รายการ) เป็น Resolved</small>`,
        input: 'checkbox',
        inputValue: 1,
        inputPlaceholder: 'สร้างคำอธิบายใหม่ด้วย AI (Gemini) — เขียนทับคำอธิบายเดิม',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Apply'
    });
    if (!res.isConfirmed) return;

    const note = getReportNote(g) || 'Quick Apply: เปลี่ยนเฉลยเป็น ' + d.suggested;
    const deps = { sendWithRetry: sendWithRetry, user: currentUser.username, pass: adminPass };
    const $pane = $('#report-detail-pane');
    $pane.css('pointer-events', 'none');
    Swal.fire({
        title: 'กำลัง Quick Apply...',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        let out;
        try {
            out = await reportQuickApplyCore(q, d.suggested, !!res.value, deps);
        } catch (e) {
            if (!(res.value && String(e.message).startsWith('AI_FAILED:'))) throw e;
            const c = await Swal.fire({
                icon: 'warning',
                title: 'AI สร้างคำอธิบายไม่สำเร็จ',
                text: 'แก้เฉลยอย่างเดียวและคงคำอธิบายเดิมไว้?',
                showCancelButton: true
            });
            if (!c.isConfirmed) return;
            out = await reportQuickApplyCore(q, d.suggested, false, deps);
        }

        q.answer = d.suggested;
        q.explain = out.newExplain;

        let resolveErr = null;
        try {
            await sendReportStatusForGroup(g, 'Resolved', note);
        } catch (e) {
            resolveErr = e;
        }
        await setCacheDB('global_admin_data', globalData);
        updateQuestionRowInTables(q.questionId);
        updateDashboard();

        if (resolveErr) {
            await Swal.fire({
                icon: 'warning',
                title: 'แก้เฉลยแล้ว แต่ปิด report ไม่สำเร็จ',
                text: (resolveErr.message || 'Server error') + ' — รายงานยังค้างอยู่ ลอง Reject/Resolve ซ้ำภายหลัง'
            });
            renderReportList();
        } else {
            removeReportCards($(`#report-list-container .report-group[data-gi="${gi}"]`));
            Swal.fire({ icon: 'success', title: 'Quick Apply สำเร็จ', timer: 2000, showConfirmButton: false });
        }
    } catch (e) {
        console.error('Quick Apply Failed:', e);
        Swal.fire({ icon: 'error', title: 'Quick Apply ไม่สำเร็จ', text: (e && e.message) || 'Server error' });
    } finally {
        $pane.css('pointer-events', '');
    }
}

function openEditReportModal(reportTime) {
        const pending = globalData.report.filter(r => window.isPendingReport(r));
        const r = pending.find(report => report.Time.toString() === reportTime);

        const rQid = r['QuestionID'] || "";
        let dbQuestion = globalData.questions.find(q => q.questionId === rQid);

        // Fallback สำหรับข้อมูลเก่า
        if (!dbQuestion) {
            dbQuestion = globalData.questions.find(q => q.problem.trim() === r['Question'].trim());
        }
        if (!dbQuestion) {
            Swal.fire('Error', 'ไม่พบต้นฉบับข้อสอบนี้ใน Database', 'error');
            return;
        }

        // ดึง Suggested Answer จาก Report
        const suggestedAnswer = r['SuggestedAnswer'];
        const noteGroup = reportGroups.find(g => g.reports.some(x => String(x.Time) === reportTime));
        const note = noteGroup ? getReportNote(noteGroup) : '';

        // เก็บข้อมูลไว้ทำ Auto-Resolve ตอน Save
        $('#editQuestionModal').data('reportData', {
            timestamp: r['Time'],
            questionId: rQid,
            adminNote: note,
            suggestedAnswer: suggestedAnswer,
            reportDetail: r['ReportDetail']
        });

        // *** จุดสำคัญ: ต้องส่ง suggestedAnswer ไปที่ openEditModal ***
        openEditModal(dbQuestion.questionId, suggestedAnswer);

        // Pre-fill explanation if reporter provided a suggested explanation
        const suggestedExplain = r['SuggestedExplain'];
        if (suggestedExplain && suggestedExplain.toString().trim()) {
            $('#edit-explanation').val(suggestedExplain.toString().trim());
        }
    }
