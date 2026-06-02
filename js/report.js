// ─────────────────────────────────────────────────────
// JS/REPORT.JS
// ─────────────────────────────────────────────────────

function renderReportList() {
        // ... (โค้ด renderReportList เดิม) ...
        const container = $('#report-list-container');
        container.empty();

        const filterSubj = $('#report-subject-filter').val();
        const pending = globalData.report.filter(r => !r.Done || r.Done.toString().toUpperCase() === 'FALSE');

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
            return;
        }

        filteredReports.forEach((r, index) => {
            let reportDetail = r['ReportDetail'] || '-';
            let suggested = r['SuggestedAnswer'] || '-';

            const rQid = r['QuestionID'] || "";
            let dbQuestion = globalData.questions.find(q => q.questionId === rQid);
            if (!dbQuestion) {
                dbQuestion = globalData.questions.find(q => q.problem.trim() === (r['Question'] || '').trim()) || {};
            }

            let currentAns = dbQuestion.answer || 'ไม่พบข้อมูลใน DB';
            let explanation = dbQuestion.explain || '(ไม่มีคำอธิบาย)';
            let choicesStr = r['Choices'] ? r['Choices'].split('\n').map(line => {
                const trimmedLine = line.trim();
                // ถ้าในบรรทัดมีโค้ด SVG ให้พยายาม Render ออกมา
                if (trimmedLine.includes('<svg')) {
                    return trimmedLine.replace(/(<svg.*<\/svg>)/, '<div style="width:40px; height:40px; display:inline-block; vertical-align:middle;">$1</div>');
                }
                return line;
            }).join('<br>') : '-';

            let imgHtml = '';
            let rawImg = String(r['Image'] || "").trim();
            if (rawImg && (rawImg.startsWith('http') || rawImg.startsWith('https'))) {
                let url = (rawImg.match(/"([^"]+)"/) && rawImg.match(/"([^"]+)"/)[1]) ? rawImg.match(/"([^"]+)"/)[1] : rawImg;
                url = transformUrl(url);

                imgHtml = `<div class="my-2 text-center">
                            <a href="${url}" target="_blank">
                                <img src="${url}" class="img-thumbnail" style="max-height: 200px;" alt="Q Img">
                            </a>
                        </div>`;
            } else if (rawImg.length > 0) {
                imgHtml = `<div class="alert alert-warning py-1 small"><i class="fas fa-exclamation-triangle"></i> ข้อมูลรูปภาพ: ${rawImg}</div>`;
            }

            let card = `
            <div class="card mb-4 shadow-sm border-0 bg-white" style="border-left: 4px solid #e74a3b !important;">
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-8 border-end">
                            <h5 class="text-primary fw-bold">
                                <i class="fas fa-hashtag me-1"></i> ${r['Category'] || 'Unknown Category'}
                                <small class="text-muted fs-6 float-end"><i class="far fa-clock"></i> ${formatDate(r['Time'])}</small>
                            </h5>
    
                            <div class="p-3 bg-light rounded mb-2">
                                <p class="mb-2"><strong>Question:</strong> ${r['Question']}</p>
                                ${imgHtml}
                                <p class="mb-2 small text-secondary"><strong>Choices:</strong><br><pre style="white-space: pre-wrap; margin:0; font-family:inherit;">${choicesStr}</pre></p>
                            </div>
            
                            <div class="d-flex gap-3">
                                <div class="text-success">
                                    <strong><i class="fas fa-check-circle"></i> Current Answer:</strong> ${currentAns}
                                </div>
                            </div>
                            <p class="mt-2 small text-muted"><strong>Explanation:</strong> ${explanation}</p>
                            <p class="small text-muted mb-0">Reported by: ${r['From']}</p>
                        </div>
    
                        <div class="col-md-4">
                             <div class="diff-box diff-suggest h-100 d-flex flex-column">
                                <div class="diff-label text-danger fw-bold border-bottom pb-2 mb-2">
                                    <i class="fas fa-exclamation-circle"></i> ReportDetail
                                </div>

                                <p class="mb-1"><strong>Suggested Answer:</strong> <span class="text-primary fw-bold">${suggested}</span></p>
                                <p class="mb-3"><strong>Reason:</strong> ${reportDetail}</p>
    
                                <div class="mt-auto">
                                    <label class="small fw-bold mb-1">Admin Note (บันทึกการแก้ไข):</label>
                                    <textarea id="admin-note-${index}" class="form-control form-control-sm mb-2" rows="2"
                                        placeholder="เช่น แก้ไขแล้ว, หรือ ปฏิเสธเนื่องจาก...">${r['AdminNote'] || ''}</textarea>
    
                                    <div class="d-flex gap-2">
                                        <button class="btn btn-outline-secondary btn-sm flex-fill" onclick="processReport('${r['Time']}', 'REJECT')">
                                            <i class="fas fa-times"></i> Reject
                                        </button>
                                        <button class="btn btn-success btn-sm flex-fill" onclick="openEditReportModal('${r['Time']}')">
                                            <i class="fas fa-edit"></i> Edit & Approve
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
            container.append(card);
        });
        // ... (จบโค้ด renderReportList เดิม) ...
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

async function processReport(reportTime, action) {
        const rIndex = globalData.report.findIndex(report => String(report.Time) === String(reportTime));
        if (rIndex === -1) return;

        const r = globalData.report[rIndex];
        const note = $(`button[onclick*="${reportTime}"]`).closest('.card').find('textarea').val();
        if (!confirmAdmin()) return;

        const result = await Swal.fire({
            title: action === 'REJECT' ? 'ยืนยันการปฏิเสธ (Reject)?' : 'ยืนยันการแก้ไข (Resolved)?',
            icon: 'question',
            showCancelButton: true
        });

        if (result.isConfirmed) {
            // ---------------------------------------------------------
            // STEP 1: OPTIMISTIC UPDATE - ลบออกจากหน้าจอทันที
            // ---------------------------------------------------------

            // 1.1 เฟดการ์ดทิ้งทันที
            $(`button[onclick*="${reportTime}"]`).closest('.card').fadeOut(300, function () {
                $(this).remove();
                if ($('#report-list-container .card').length === 0) renderReportList();
            });

            // 1.2 อัปเดตข้อมูลในตัวแปร Local ทันที
            const newStatus = action === 'REJECT' ? 'Rejected' : 'Resolved';
            globalData.report[rIndex].Status = newStatus;
            globalData.report[rIndex].AdminNote = note;
            globalData.report[rIndex].Done = 'TRUE';

            // 1.3 อัปเดตตัวเลขแจ้งเตือน (Sidebar Badge / Dashboard) ทันที
            updateDashboard();

            // ---------------------------------------------------------
            // STEP 2: BACKGROUND PROCESSING - บันทึกเบื้องหลัง
            // ---------------------------------------------------------
            (async () => {
                try {
                    await sendAdminAction('updateReportStatus', {
                        timestamp: r['Time'],
                        adminNote: note,
                        status: newStatus,
                        done: 'TRUE'
                    }, true);

                    // บันทึก Cache ลงเครื่อง
                    await setCacheDB('global_admin_data', globalData);
                } catch (e) {
                    console.error("Report Background Update Failed:", e);
                    // แจ้งเตือนกรณีบันทึกไม่สำเร็จจริงๆ
                    Swal.fire({
                        icon: 'error',
                        title: 'บันทึกสถานะ Report ไม่สำเร็จ',
                        text: 'กรุณาลองใหม่อีกครั้งในภายหลัง',
                        toast: true, position: 'bottom-end', showConfirmButton: false, timer: 5000
                    });
                }
            })();
        }
    }

function openEditReportModal(reportTime) {
        const pending = globalData.report.filter(r => !r.Done || r.Done.toString().toUpperCase() === 'FALSE');
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
            adminNote: note
        });

        // *** จุดสำคัญ: ต้องส่ง suggestedAnswer ไปที่ openEditModal ***
        openEditModal(dbQuestion.questionId, suggestedAnswer);
    }
