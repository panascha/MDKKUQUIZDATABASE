// ─────────────────────────────────────────────────────
// JS/VOTE.JS
// ─────────────────────────────────────────────────────

function getCategoryNameById(categoryId) {
        // ... (โค้ด getCategoryNameById เดิม) ...
        const category = globalData.category.find(t => t.CategoryID === categoryId);
        return category ? category.CategoryName : categoryId;
        // ... (จบโค้ด getCategoryNameById เดิม) ...
    }

function renderCurrentCategory(question) {
        // ... (โค้ด renderCurrentCategory เดิม) ...
        const $container = $('#current-category-container');
        $container.empty();
        const category = Array.isArray(question.category) ? question.category : [question.category];

        if (category.length === 0 || category[0] === '-') {
            $container.html('<span class="empty-state-text">- ยังไม่มีหัวข้อ -</span>');
            return;
        }

        category.forEach(categoryId => {
            const categoryName = getCategoryNameById(categoryId);
            const $badge = $(`
                        <div class="category-badge approved">
                            <i class="fas fa-check"></i> ${categoryName}
                        </div>
                    `);
            $container.append($badge);
        });
        // ... (จบโค้ด renderCurrentCategory เดิม) ...
    }

function addVoteRow() {
        // ... (โค้ด addVoteRow เดิม) ...
        const subjects = [];
        globalData.structure.forEach(s => {
            subjects.push({ id: s.SubjectID, name: s.SubjectName });
        });

        let subjectOptions = `<option value="">-- เลือกวิชา --</option>`;
        const uniqueSubjects = {};
        subjects.forEach(s => {
            if (!uniqueSubjects[s.id]) {
                uniqueSubjects[s.id] = s;
                subjectOptions += `<option value="${s.id}">${s.id} - ${s.name}</option>`;
            }
        });

        const rowHtml = `
                    <div class="vote-row">
                        <button class="btn-remove-row"><i class="fas fa-minus"></i></button>
                        <select class="vote-select subject-select">${subjectOptions}</select>
                        <select class="vote-select group-select" disabled><option value="">-- เลือกกลุ่ม --</option></select>
                        <select class="vote-select category-select" disabled><option value="">-- เลือกหัวข้อ --</option></select>
                    </div>
                `;

        const $row = $(rowHtml);
        $('#vote-rows-container').append($row);

        $row.find('.subject-select').on('change', function () {
            const subjId = $(this).val();
            const $groupSelect = $row.find('.group-select');
            const $categorySelect = $row.find('.category-select');

            $groupSelect.empty().append('<option value="">-- เลือกกลุ่ม --</option>').prop('disabled', true);
            $categorySelect.empty().append('<option value="">-- เลือกหัวข้อ --</option>').prop('disabled', true);

            if (subjId) {
                const relatedCategory = globalData.category.filter(t => t.SubjectRef === subjId);
                const groups = [...new Set(relatedCategory.map(t => t.AccordionGroup))];

                groups.forEach(g => {
                    if (g) $groupSelect.append(`<option value="${g}">${g}</option>`);
                });
                $groupSelect.prop('disabled', false);
            }
        });

        $row.find('.group-select').on('change', function () {
            const groupName = $(this).val();
            const subjId = $row.find('.subject-select').val();
            const $categorySelect = $row.find('.category-select');

            $categorySelect.empty().append('<option value="">-- เลือกหัวข้อ --</option>').prop('disabled', true);

            if (groupName && subjId) {
                const category = globalData.category.filter(t => t.SubjectRef === subjId && t.AccordionGroup === groupName);
                category.forEach(t => {
                    $categorySelect.append(`<option value="${t.CategoryID}">${t.CategoryName}</option>`);
                });
                $categorySelect.prop('disabled', false);
            }
        });

        $row.find('.btn-remove-row').on('click', function () {
            $(this).parent().remove();
        });
        // ... (จบโค้ด addVoteRow เดิม) ...
    }

function submitSingleVote(categoryId, shouldRefreshUI = false, delta = 1) {
        submitVoteData([categoryId], shouldRefreshUI, delta);
    }

async function submitVoteData(categoryArray, shouldRefreshUI = false, delta = 1) {
        $('#btn-submit-vote').prop('disabled', true).text('กำลังส่ง...');
        const successMsg = delta > 0 ? "บันทึกโหวตเรียบร้อย! 🙏" : "บันทึกโหวตลบเรียบร้อย! 🗳️";

        const payload = {
            action: 'submitVote',
            questionId: current_question.questionId,
            questionText: current_question.problem,
            suggestedCategory: categoryArray,
            delta: delta // ส่งค่าที่รับมาไป Backend
        };

        try {
            const response = await fetch(APPSCRIPT_URL, {
                method: 'POST',
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(payload)
            });

            Swal.fire('Success', successMsg, 'success');
            $('#vote-category-modal').css('display', 'none');
            $('#btn-submit-vote').prop('disabled', false).text('ยืนยัน');

            if (current_question.questionId) {
                fetchPendingVotes(current_question.questionId);
            }
        } catch (err) {
            Swal.fire('Error', 'เกิดข้อผิดพลาด: ' + err, 'error');
            $('#btn-submit-vote').prop('disabled', false).text('ยืนยัน');
        }
    }

function fetchPendingVotes(questionId) {
        const $container = $('#suggested-category-container');
        $container.html('<span class="empty-state-text"><i class="fas fa-spinner fa-spin"></i> กำลังโหลด...</span>');

        fetch(`${APPSCRIPT_URL}?action=getPendingVotes&qid=${questionId}`)
            .then(response => response.json())
            .then(data => {
                $container.empty();
                const votes = data.votes || [];
                const currentCats = Array.isArray(current_question.category) ? current_question.category : [current_question.category];
                const filteredData = votes.filter(item => !currentCats.includes(item.categoryId));

                if (filteredData.length === 0) {
                    $container.html('<span class="empty-state-text">- ยังไม่มีข้อเสนอใหม่ -</span>');
                    return;
                }

                filteredData.forEach(item => {
                    const categoryName = getCategoryNameById(item.categoryId);
                    const $badge = $(`
                        <div class="category-badge suggested" title="คลิกเพื่อโหวต">
                            ${categoryName}
                            <span class="vote-count-badge">${item.count} <i class="fas fa-user"></i></span>
                        </div>
                    `);

                    $badge.on('click', function () {
                        Swal.fire({
                            title: 'คุณเห็นด้วยกับหัวข้อนี้หรือไม่?',
                            html: `หัวข้อ: <b>"${categoryName}"</b>`,
                            icon: 'question',
                            showDenyButton: true,
                            showCancelButton: true,
                            confirmButtonText: 'เห็นด้วย (+1)',
                            denyButtonText: 'ไม่เห็นด้วย (-1)',
                            cancelButtonText: 'ยกเลิก',
                            confirmButtonColor: '#1cc88a',
                            denyButtonColor: '#e74a3b'
                        }).then((result) => {
                            if (result.isConfirmed) {
                                submitSingleVote(item.categoryId, true, 1);
                            } else if (result.isDenied) {
                                submitSingleVote(item.categoryId, true, -1);
                            }
                        });
                    });
                    $container.append($badge);
                });
            });
    }
