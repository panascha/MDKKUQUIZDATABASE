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

function copyReportQuestion(index) {
    const src = reportCopySource[index];
    if (!src) return;
    window.copyQuestionPrompt(src.problem, src.choices);
}

// รวม report ที่รอตรวจเป็น 1 กลุ่มต่อ 1 QuestionID (แถวเก่าที่ไม่มี QuestionID แยกเป็นกลุ่มของตัวเอง
// เพราะ reject ต้องยิงด้วย timestamp) แล้วแตกย่อยตาม SuggestedAnswer ที่เหมือนกันเป๊ะ
// เรียงตามคะแนนโหวตสูงสุดของ "ตั๋วเดียว" — backend ตัดสิน auto-resolve ราย ticket ไม่ใช่ผลรวม
function buildReportGroups(reports) {
    const byKey = new Map();
    reports.forEach(r => {
        const qid = String(r['QuestionID'] || '').trim();
        const key = qid || 't:' + r['Time'];
        if (!byKey.has(key)) byKey.set(key, { key: key, qid: qid, reports: [] });
        byKey.get(key).reports.push(r);
    });

    const groups = Array.from(byKey.values());
    groups.forEach(g => {
        const bySuggest = new Map();
        g.reports.forEach(r => {
            const s = String(r['SuggestedAnswer'] == null ? '' : r['SuggestedAnswer']).trim();
            if (!bySuggest.has(s)) bySuggest.set(s, []);
            bySuggest.get(s).push(r);
        });
        g.disputes = Array.from(bySuggest.entries()).map(([suggested, tickets]) => {
            tickets.sort((a, b) => (reportVotes(b) - reportVotes(a)) || (reportTimeMs(a) - reportTimeMs(b)));
            return {
                suggested: suggested,
                tickets: tickets,
                topVotes: reportVotes(tickets[0]),
                totalVotes: tickets.reduce((s, r) => s + reportVotes(r), 0)
            };
        }).sort((a, b) => (b.topVotes - a.topVotes) || (b.totalVotes - a.totalVotes));

        g.maxVotes = Math.max(...g.reports.map(reportVotes));
        g.totalVotes = g.reports.reduce((s, r) => s + reportVotes(r), 0);
        g.oldest = Math.min(...g.reports.map(reportTimeMs));
    });

    groups.sort((a, b) => (b.maxVotes - a.maxVotes) || (b.totalVotes - a.totalVotes) || (a.oldest - b.oldest));
    return groups;
}

function renderReportList() {
        const container = $('#report-list-container');
        container.empty();
        reportCopySource = [];
        reportGroups = [];

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
            updateReportBatchUI();
            return;
        }

        reportGroups = buildReportGroups(filteredReports);
        const questionById = new Map(globalData.questions.map(q => [q.questionId, q]));

        reportGroups.forEach((g, index) => {
            // โจทย์/รูป/ตัวเลือกที่มากับ report เป็น snapshot ตอนแจ้ง — ใช้ของใบแรกในกลุ่มเป็นตัวแทน
            const r = g.reports[0];

            let dbQuestion = questionById.get(g.qid);
            if (!dbQuestion) {
                const snapshot = String(r['Question'] || '').trim();
                dbQuestion = globalData.questions.find(q => String(q.problem || '').trim() === snapshot) || {};
            }

            const currentAnsRaw = String(dbQuestion.answer || '').trim();
            let currentAns = currentAnsRaw ? reportAnsLabel(currentAnsRaw) : 'ไม่พบข้อมูลใน DB';
            let explanation = dbQuestion.explain ? window.renderMarkdownSafe(dbQuestion.explain) : '(ไม่มีคำอธิบาย)';

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
            let rawImg = String(r['Image'] || "").trim();
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

            reportCopySource[index] = {
                problem: r['Question'] || dbQuestion.problem || '',
                choices: dbChoices || String(r['Choices'] || '').split('\n')
            };

            g.searchText = [g.qid, dbQuestion.problem].concat(g.reports.map(rep => rep['Question']))
                .map(s => String(s || '')).join(' ').toLowerCase();

            const fromList = Array.from(new Set(g.reports.map(rep => String(rep['From'] || '').trim()).filter(Boolean)));

            const disputesHtml = g.disputes.map(d => {
                const isSame = !!d.suggested && d.suggested === currentAnsRaw;
                const details = d.tickets.map(t => `
                    <li>${reportEsc(t['ReportDetail']) || '-'}
                        <span class="text-muted">— ${formatDate(t['Time'])}${reportVotes(t) > 0 ? `, ${reportVotes(t)} votes` : ''}</span>
                    </li>`).join('');
                return `
                <div class="border rounded p-2 mb-2 bg-white">
                    <div class="d-flex flex-wrap align-items-center gap-1 mb-1">
                        <span class="badge bg-secondary text-wrap text-start">Current: ${currentAns}</span>
                        <i class="fas fa-arrow-right text-muted small"></i>
                        <span class="badge bg-warning text-dark text-wrap text-start">Suggested: ${reportAnsLabel(d.suggested)}</span>
                        ${isSame ? '<span class="badge bg-light text-muted border">เหมือนเฉลยปัจจุบัน</span>' : ''}
                    </div>
                    <div class="small text-muted mb-1">
                        ${d.tickets.length} reports · top ${d.topVotes} votes${d.tickets.length > 1 ? ` (รวม ${d.totalVotes})` : ''}
                    </div>
                    <ul class="small mb-2 ps-3">${details}</ul>
                    <button class="btn btn-success btn-sm w-100" onclick="openEditReportModal('${reportEsc(d.tickets[0]['Time'])}')">
                        <i class="fas fa-edit"></i> Edit & Approve
                    </button>
                </div>`;
            }).join('');

            let card = `
            <div class="card report-group mb-4 shadow-sm border-0 bg-white" data-gi="${index}" style="border-left: 4px solid #4e73df !important;">
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-8 border-end">
                            <h5 class="text-primary fw-bold">
                                <input type="checkbox" class="form-check-input report-select me-2" onchange="updateReportBatchUI()" title="เลือกเพื่อ Batch Reject">
                                <i class="fas fa-hashtag me-1"></i> ${reportEsc(r['Category']) || 'Unknown Category'}
                                <span class="badge bg-danger ms-2">${g.reports.length} reports</span>
                                ${g.totalVotes > 0 ? `<span class="badge bg-secondary ms-1"><i class="fas fa-users"></i> top ${g.maxVotes} · รวม ${g.totalVotes} votes</span>` : ''}
                                <small class="text-muted fs-6 float-end"><i class="far fa-clock"></i> ${formatDate(r['Time'])}</small>
                            </h5>
                            ${g.qid ? `<div class="small text-muted mb-2">QuestionID: ${reportEsc(g.qid)}</div>` : ''}

                            <div class="p-3 bg-light rounded mb-2">
                                <p class="mb-2"><strong>Question:</strong> ${reportEsc(r['Question'])}</p>
                                ${imgHtml}
                                <p class="mb-2 small text-secondary"><strong>Choices:</strong><br><pre style="white-space: pre-wrap; margin:0; font-family:inherit;">${choicesStr}</pre></p>
                            </div>

                            <div class="mt-2 small text-muted"><strong>Explanation:</strong> ${explanation}</div>
                            <p class="small text-muted mb-0">Reported by: ${reportEsc(fromList.join(', '))}</p>
                        </div>

                        <div class="col-md-4">
                             <div class="diff-box diff-suggest h-100 d-flex flex-column">
                                <div class="diff-label text-danger fw-bold border-bottom pb-2 mb-2">
                                    <i class="fas fa-exclamation-circle"></i> ReportDetail
                                </div>

                                ${disputesHtml}

                                <div class="mt-auto">
                                    <label class="small fw-bold mb-1">Admin Note (บันทึกการแก้ไข):</label>
                                    <textarea id="admin-note-${index}" class="form-control form-control-sm mb-2" rows="2"
                                        placeholder="เช่น แก้ไขแล้ว, หรือ ปฏิเสธเนื่องจาก...">${reportEsc(r['AdminNote'])}</textarea>

                                    <button class="btn btn-outline-primary btn-sm w-100 mb-2" onclick="copyReportQuestion(${index})" title="คัดลอกโจทย์และตัวเลือกไปถาม AI">
                                        <i class="fas fa-copy"></i> คัดลอกคำถาม
                                    </button>

                                    <button class="btn btn-outline-secondary btn-sm w-100" onclick="rejectReportGroup(${index})">
                                        <i class="fas fa-times"></i> Reject ทั้งข้อ (${g.reports.length})
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
            container.append(card);
        });
        window.renderAllMath(container);
        applyReportSearch();
    }

// ── ค้นหา: ซ่อน/แสดงการ์ดที่ render ไว้แล้ว (ไม่ render ใหม่ — Admin Note ที่พิมพ์ค้างกับ checkbox จะไม่หาย) ──
function onReportSearchInput() {
    clearTimeout(reportSearchTimer);
    reportSearchTimer = setTimeout(applyReportSearch, 200);
}

function applyReportSearch() {
    const term = String($('#report-search-input').val() || '').trim().toLowerCase();
    $('#report-list-container .report-group').each(function () {
        const g = reportGroups[Number($(this).attr('data-gi'))];
        // ใช้คลาส d-none แทน .toggle() — ตอน render ทั้ง section อาจยังซ่อนอยู่
        $(this).toggleClass('d-none', !!term && !g.searchText.includes(term));
    });
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
    $cards.fadeOut(300, function () {
        $(this).remove();
    });
    setTimeout(() => {
        if ($('#report-list-container .report-group').length === 0) renderReportList();
        else updateReportBatchUI();
    }, 350);
}

// question.js เรียกหลัง Edit & Approve สำเร็จ
function removeReportCardByQid(qid) {
    const gi = reportGroups.findIndex(g => g.qid && g.qid === String(qid || '').trim());
    if (gi !== -1) removeReportCards($(`#report-list-container .report-group[data-gi="${gi}"]`));
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

// ส่ง reject ของ 1 กลุ่มไป backend แล้วค่อยแก้ state ในเครื่อง "หลัง" เซิร์ฟเวอร์ตอบสำเร็จเท่านั้น
// (ไม่ใช้ sendAdminAction: มัน optimistic ก่อนส่ง + เด้ง toast/Swal เองทุกครั้ง ซึ่งจะปิด progress ของ batch)
async function sendReportReject(group, note) {
    const data = { adminNote: note, status: 'Rejected', done: 'TRUE' };
    if (group.qid) {
        data.questionId = group.qid;
    } else {
        // Fallback: no QuestionID, match by timestamp only
        data.timestamp = group.reports[0]['Time'];
    }

    const resJson = await sendWithRetry({
        action: 'updateReportStatus',
        username: currentUser.username,
        adminPass: adminPass,
        user: currentUser.displayName,
        data: data,
        metadata: navigator.userAgent
    });
    if (!resJson || resJson.result !== 'success') {
        throw new Error((resJson && resJson.message) || 'Server error');
    }

    globalData.report.forEach(rep => {
        const isTarget = group.qid
            ? String(rep['QuestionID'] || "").trim() === group.qid
            : String(rep.Time) === String(data.timestamp);
        if (isTarget && window.isPendingReport(rep)) {
            rep.Status = 'Rejected';
            rep.AdminNote = note;
            rep.Done = 'TRUE';
        }
    });
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

        const note = $card.find('textarea').val();
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
                text: 'กรุณาลองใหม่อีกครั้งในภายหลัง',
                toast: true, position: 'bottom-end', showConfirmButton: false, timer: 5000
            });
        }
    }

// Batch Reject เท่านั้น — ไม่มี Batch Approve โดยตั้งใจ (การแก้เฉลยต้องตรวจทีละข้อ)
// ยิงทีละข้อแบบ await: updateReportStatus อยู่ใน admin lock tier ยิงขนานกันจะแย่ง lock กันเอง
async function batchRejectReports() {
    if (!confirmAdmin()) return;

    const cards = getSelectedReportCards().toArray();
    if (cards.length === 0) return;
    const items = cards.map(el => ({
        $card: $(el),
        group: reportGroups[Number($(el).attr('data-gi'))],
        note: $(el).find('textarea').val()
    }));
    const totalReports = items.reduce((s, it) => s + it.group.reports.length, 0);

    const result = await Swal.fire({
        title: `Reject ${items.length} ข้อ?`,
        text: `ปฏิเสธรายงานที่รอตรวจทั้งหมดของข้อที่เลือก (${totalReports} รายการ) — ใช้ Admin Note ของแต่ละการ์ด`,
        icon: 'warning',
        showCancelButton: true
    });
    if (!result.isConfirmed) return;

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
        const note = $(`button[onclick*="${reportTime}"]`).closest('.card').find('textarea').val();

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
