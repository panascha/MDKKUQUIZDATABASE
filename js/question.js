// ─────────────────────────────────────────────────────
// JS/QUESTION.JS
// ─────────────────────────────────────────────────────

function showQuestionDetail(id) {
        // ... (โค้ด showQuestionDetail เดิม) ...
        const q = globalData.questions.find(x => x.questionId == id);
        if (!q) return;

        current_question = q;

        let cat = Array.isArray(q.category) ? q.category.join(', ') : q.category;
        let subj = getSubjectFromCategory(q.category);
        $('#modal-q-subject').text(subj);
        $('#modal-q-category').text(cat);

        $('#modal-q-text').text(q.problem);

        let imgHtml = '';
        if (q.img) {
            q.img.split('///').forEach(url => {
                imgHtml += `<img src="${transformUrl(url)}" class="img-fluid mb-2" style="max-height:300px;">`;
            });
        }
        $('#modal-q-img-container').html(imgHtml);

        let choiceHtml = '';
        if (q.choices) {
            q.choices.split('///').forEach(c => {
                let isCorrect = (c.trim().replace(/^[A-Z]\./, '').trim() === q.answer.trim().replace(/^[A-Z]\./, '').trim()) ? 'list-group-item-success' : '';
                choiceHtml += `<div class="list-group-item ${isCorrect}">${c}</div>`;
            });
        }
        $('#modal-q-choices').html(choiceHtml);
        $('#modal-q-explain').text(q.explain || '-');

        $('#btn-modal-report').off('click').on('click', function () {
            $('#questionDetailModal').modal('hide');
            openReportModal(q);
        });

        $('#questionDetailModal').modal('show');
        // ... (จบโค้ด showQuestionDetail เดิม) ...
    }

function openEditModal(id, suggestedAnswer = null) {
    const q = globalData.questions.find(x => x.questionId == id);
    if (!q) return;

    $('#edit-q-id').val(q.questionId);

    let currentCategories = Array.isArray(q.category) ? q.category : [q.category];
    renderCategoriesUI(currentCategories);

    $('#edit-problem').val(q.problem);

    const parsedExp = parseExplain(q.explain);
    $('#edit-explanation').val(parsedExp.text);
    renderExplainMediaUI(parsedExp.media);

    renderImagesUI(q.img);
    renderChoicesUI(q.choices, q.answer, suggestedAnswer);

    $('#editQuestionModal').modal('show');
}

async function saveQuestionChanges() {
    if (!confirmAdmin()) return;

    // --- STEP 1: ดึงข้อมูลและสร้าง Snapshot (Capture ทุกอย่างก่อนปิด Modal) ---
    const qId = $('#edit-q-id').val();
    const problemText = $('#edit-problem').val().trim();
    const explainText = $('#edit-explanation').val().trim();
    const categories = JSON.parse($('#edit-category-hidden').val() || "[]");

    // Snapshot ข้อมูลภาพโจทย์ (Main)
    const snapshotPendingMain = [...pendingMainImages];
    const snapshotExistingMain = [...existingMainImages];

    const uniqueMainImages = Array.from(new Set([...snapshotExistingMain, ...snapshotPendingMain]))
        .filter(url => url.trim() !== "");

    // Snapshot ข้อมูลสื่อประกอบคำอธิบาย (Explain Media)
    const snapshotPendingExplain = [...pendingExplainMedia];
    const snapshotExistingExplain = [...existingExplainMedia];

    // Snapshot ข้อมูลตัวเลือก (Choices) พร้อม ImageData ป้องกัน Error
    const rowsSnapshot = [];
    let pendingChoiceImagesCount = 0;

    $('#dynamic-choices-container .choice-item').each(function () {
        const rowId = $(this).attr('id');
        const imgEntry = choiceImagesData[rowId];
        const textValInInput = $(this).find('.choice-text-input').val().trim();
        const isCorrect = $(this).find('.choice-radio').is(':checked');

        const isPending = !!(imgEntry && imgEntry.type === 'pending');
        if (isPending) pendingChoiceImagesCount++;

        rowsSnapshot.push({
            id: rowId,
            isPending: isPending,
            imageData: imgEntry ? imgEntry.data : null, // เก็บ Base64 ไว้ที่นี่เลย
            isExisting: !!(imgEntry && imgEntry.type === 'existing'),
            text: textValInInput,
            isCorrect: isCorrect,
            wasRequireImg: $(this).hasClass('border-warning') // ตรวจสอบสถานะเดิม
        });
    });

    const totalImagesToUpload = snapshotPendingMain.length + pendingChoiceImagesCount + snapshotPendingExplain.length;

    // --- STEP 2: Optimistic UI Update (แก้หน้าจอทันที) ---
    const qIndex = globalData.questions.findIndex(q => q.questionId === qId);
    if (qIndex !== -1) {
        // อัปเดตข้อมูลจำลองในเครื่องก่อน เพื่อให้ User เห็นความเปลี่ยนแปลงทันที
        globalData.questions[qIndex].problem = problemText;

        const tempExplainUrls = Array.from(new Set([...snapshotExistingExplain, ...snapshotPendingExplain]))
            .filter(url => url.trim() !== "");
        globalData.questions[qIndex].explain = serializeExplain(explainText, tempExplainUrls);
        globalData.questions[qIndex].category = categories;
        globalData.questions[qIndex].img = uniqueMainImages.join('///');

        // บันทึกลง IndexedDB เบื้องต้น
        await setCacheDB('global_admin_data', globalData);
        refreshTables(true); // รีเฟรชตารางทันทีด้วยข้อมูลใหม่
        updateDashboard();
    }

    // ปิดหน้าต่างแก้ไขทันที เพื่อให้แอดมินทำงานข้ออื่นต่อได้
    $('#editQuestionModal').modal('hide');

    // สร้าง Toast แจ้งเตือนสถานะเบื้องหลัง
    const bgToast = Swal.mixin({
        toast: true,
        position: 'bottom-start',
        showConfirmButton: false,
        timerProgressBar: true
    });

    bgToast.fire({
        icon: 'info',
        title: totalImagesToUpload > 0 ? `เริ่มซิงค์ข้อมูล (${totalImagesToUpload} ภาพ)...` : 'กำลังบันทึกข้อมูล...',
    });

    // --- STEP 3: ทำงานเบื้องหลัง (Background Processing) ---
    (async () => {
        try {
            activeUploadsCount++;
            const delay = ms => new Promise(res => setTimeout(res, ms));
            let currentImageCount = 0;

            // 3.1 อัปโหลดรูปโจทย์ (Main Images)
            let serverMainUrls = [...snapshotExistingMain];
            if (snapshotPendingMain.length > 0) {
                // กรองคำว่า require_img ออกถ้ากำลังจะมีรูปจริงมาแทน
                serverMainUrls = serverMainUrls.filter(u => !u.toLowerCase().includes('require_img'));

                for (const base64 of snapshotPendingMain) {
                    currentImageCount++;
                    bgToast.fire({
                        icon: 'info',
                        title: `กำลังอัปโหลดรูปที่ ${currentImageCount}/${totalImagesToUpload}`,
                        text: 'ส่วนของ: รูปภาพโจทย์',
                        timer: 60000
                    });

                    const res = await sendWithRetry({
                        action: 'uploadImage',
                        username: currentUser.username, adminPass: adminPass,
                        data: { base64: base64, questionId: qId, type: 'Main' }
                    });

                    if (res.result === 'success') {
                        serverMainUrls.push(res.url);
                        await delay(400); // หน่วงเวลาสั้นลง (400ms) เพื่อความเร็ว
                    } else {
                        throw new Error(`รูปโจทย์ภาพที่ ${currentImageCount} ล้มเหลว`);
                    }
                }
            }

            // 3.1.2 อัปโหลดสื่อประกอบคำอธิบาย (Explain Media)
            let serverExplainUrls = [...snapshotExistingExplain];
            if (snapshotPendingExplain.length > 0) {
                for (const base64 of snapshotPendingExplain) {
                    currentImageCount++;
                    bgToast.fire({
                        icon: 'info',
                        title: `กำลังอัปโหลดรูปที่ ${currentImageCount}/${totalImagesToUpload}`,
                        text: 'ส่วนของ: สื่อประกอบคำอธิบาย',
                        timer: 60000
                    });

                    const res = await sendWithRetry({
                        action: 'uploadImage',
                        username: currentUser.username, adminPass: adminPass,
                        data: { base64: base64, questionId: qId, type: 'Explain' }
                    });

                    if (res.result === 'success') {
                        serverExplainUrls.push(res.url);
                        await delay(400);
                    } else {
                        throw new Error(`สื่อประกอบคำอธิบายไฟล์ที่ ${currentImageCount} ล้มเหลว`);
                    }
                }
            }

            // 3.2 อัปโหลดรูปตัวเลือก (Choice Images)
            const serverChoicesArray = [];
            let finalAnswerServer = "";

            for (const row of rowsSnapshot) {
                let finalVal = "";

                if (row.isPending) {
                    currentImageCount++;
                    bgToast.fire({
                        icon: 'info',
                        title: `กำลังอัปโหลดรูปที่ ${currentImageCount}/${totalImagesToUpload}`,
                        text: 'ส่วนของ: ตัวเลือก',
                        timer: 60000
                    });

                    const res = await sendWithRetry({
                        action: 'uploadImage',
                        username: currentUser.username, adminPass: adminPass,
                        data: { base64: row.imageData, questionId: qId, type: 'Choice' }
                    });

                    if (res.result === 'success') {
                        finalVal = res.url;
                        await delay(400);
                    } else {
                        throw new Error(`รูปตัวเลือกที่ ${currentImageCount} ล้มเหลว`);
                    }
                } else if (row.isExisting) {
                    finalVal = row.imageData; // URL เดิม
                } else {
                    finalVal = row.text; // ข้อความปกติ
                }

                // จัดการกรณี require_img (ถ้าช่องว่างแต่เดิมระบุว่าต้องมีรูป ให้คงไว้)
                if (finalVal === "" && row.text === "" && row.isPending === false && row.wasRequireImg) {
                    finalVal = "require_img";
                }

                if (finalVal !== "") {
                    serverChoicesArray.push(finalVal);
                    if (row.isCorrect) finalAnswerServer = finalVal;
                }
            }

            // 3.3 ส่งข้อมูลสรุปเข้า Google Sheets
            bgToast.fire({ icon: 'info', title: 'กำลังบันทึกลงฐานข้อมูล...', timer: 30000 });

            const savePayload = {
                id: qId,
                problem: problemText,
                explain: serializeExplain(explainText, serverExplainUrls),
                category: categories,
                img: serverMainUrls.join('///'),
                choices: serverChoicesArray.join('///'),
                answer: finalAnswerServer
            };

            // 🔥 แก้ไขจุดนี้: เพิ่ม const finalRes = เพื่อรับค่าจากฟังก์ชัน
            const finalRes = await sendWithRetry({
                action: 'editQuestion',
                username: currentUser.username, adminPass: adminPass,
                data: savePayload
            });

                // 3.4 จัดการ Report (ถ้ามี)
                const reportData = $('#editQuestionModal').data('reportData');
                if (reportData) {
                    await sendWithRetry({
                        action: 'updateReportStatus',
                        username: currentUser.username, adminPass: adminPass,
                        data: {
                            timestamp: reportData.timestamp,
                            adminNote: reportData.adminNote || "แก้ไขเรียบร้อยแล้ว",
                            status: 'Resolved', done: 'TRUE'
                        }
                    });
                    $('#editQuestionModal').removeData('reportData');
                }

                // 🔥 แจ้งเตือนสำเร็จทันที
                if (finalRes && finalRes.result === 'success') {
                    bgToast.fire({
                        icon: 'success',
                        title: 'บันทึกสำเร็จ!',
                        text: `ข้อมูลข้อสอบ ${qId} ถูกเขียนลงฐานข้อมูลแล้ว`,
                        timer: 2000
                    });
                }

                // ✅ ทำงานเบื้องหลัง (ไม่ใช้ await เพื่อให้จบฟังก์ชันทันที)
                (async () => {
                    await clearAdminCache();
                    await fetchData(true, true);
                    console.log("Background Data Sync Completed.");
                })();

            } catch (error) {
                console.error("Sync Error:", error);
                Swal.fire({
                    icon: 'error',
                    title: 'การซิงค์ข้อมูลขัดข้อง',
                    text: error.message,
                });
            } finally {
                activeUploadsCount--;
            }
        })();
    }

async function deleteQuestion() {
        // ... (โค้ด deleteQuestion เดิม) ...
        if (!confirmAdmin()) return;
        if (!confirm('Are you sure you want to DELETE this question?')) return;

        const payload = { id: $('#edit-q-id').val() };
        await sendAdminAction('deleteQuestion', payload);
        $('#editQuestionModal').modal('hide');
        // ... (จบโค้ด deleteQuestion เดิม) ...
    }

function previewEditImage() {
        // ... (โค้ด previewEditImage เดิม) ...
        const url = $('#edit-img').val();
        if (url) {
            $('#edit-img-preview').attr('src', transformUrl(url.split('///')[0]));
            $('#edit-img-preview-box').removeClass('d-none');
        } else {
            $('#edit-img-preview-box').addClass('d-none');
        }
        // ... (จบโค้ด previewEditImage เดิม) ...
    }

const handleImageInput = () => {
        // ... (โค้ด handleImageInput เดิม) ...
        const rawUrl = $('#edit-img').val();
        if (!rawUrl) {
            editImageArray = [];
            $('#edit-image-gallery-container').hide();
            return;
        }
        editImageArray = rawUrl.split('///').map(u => u.trim()).filter(u => u !== "");
        editImageIndex = 0;
        updateEditImageGallery();
        // ... (จบโค้ด handleImageInput เดิม) ...
    };

function renderCategoriesUI(categoryArray) {
        const $container = $('#dynamic-categories-container');
        $container.empty();

        const categories = Array.isArray(categoryArray) ? categoryArray : [categoryArray];

        if (categories.length === 0 || categories[0] === '-' || categories[0] === '') {
            _renderNewCategoryRow(); // <--- เรียกฟังก์ชัน Internal
        } else {
            categories.forEach(categoryId => {
                if (categoryId && categoryId !== '-') {
                    _renderNewCategoryRow(categoryId); // <--- เรียกฟังก์ชัน Internal
                }
            });
        }
        syncCategoriesToHiddenInput();
    }

function _renderNewCategoryRow(selectedCategoryID = null) {
        const $container = $('#dynamic-categories-container');
        const subjects = [...new Set(globalData.category.map(c => c.SubjectRef))].filter(s => s);

        let subjectOptions = `<option value="">-- เลือกวิชา --</option>`;
        subjects.sort().forEach(s => {
            subjectOptions += `<option value="${s}">${s}</option>`;
        });

        let selectedSubject = '';
        let selectedGroup = '';

        // ค้นหาข้อมูล Category จาก Master List
        if (selectedCategoryID) {
            // ล้างช่องว่างหัวท้ายเพื่อป้องกัน Error
            const cleanID = String(selectedCategoryID).trim();
            const cat = globalData.category.find(c => String(c.CategoryID).trim() === cleanID);

            if (cat) {
                selectedSubject = cat.SubjectRef;
                selectedGroup = cat.AccordionGroup;
            }
        }

        const rowHtml = `
        <div class="category-row d-flex gap-2 align-items-center bg-light p-2 rounded">
            <select class="form-select form-select-sm category-subject-select" onchange="updateGroupSelect(this)" style="flex: 1;">
                ${subjectOptions}
            </select>
            <select class="form-select form-select-sm category-group-select" onchange="updateCategorySelect(this)" style="flex: 1;">
                <option value="">-- กลุ่ม --</option>
            </select>
            <select class="form-select form-select-sm category-id-select" onchange="syncCategoriesToHiddenInput()" style="flex: 2;">
                <option value="">-- หัวข้อ/Category --</option>
                ${(selectedCategoryID && !selectedSubject) ? `<option value="${selectedCategoryID}" selected>${selectedCategoryID} (ไม่พบในฐานข้อมูล)</option>` : ''}
            </select>
            <button class="btn btn-sm btn-outline-danger" type="button" onclick="removeCategoryRow(this)">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
        const $row = $(rowHtml);

        if (selectedSubject) {
            $row.find('.category-subject-select').val(selectedSubject).trigger('change');

            // ใช้ฟังก์ชัน Callback แทนการใช้ setTimeout แบบสุ่มเสี่ยง
            setTimeout(() => {
                $row.find('.category-group-select').val(selectedGroup).trigger('change');
                setTimeout(() => {
                    $row.find('.category-id-select').val(selectedCategoryID);
                    syncCategoriesToHiddenInput();
                }, 100);
            }, 100);
        }

        $container.append($row);
    }

function removeCategoryRow(btn) {
        $(btn).closest('.category-row').remove();
        syncCategoriesToHiddenInput();
    }

function updateGroupSelect(selectElement) {
        const $subjectSelect = $(selectElement);
        const subjId = $subjectSelect.val();
        const $groupSelect = $subjectSelect.closest('.category-row').find('.category-group-select');
        const $catSelect = $subjectSelect.closest('.category-row').find('.category-id-select');

        $groupSelect.empty().append('<option value="">-- กลุ่ม --</option>');
        $catSelect.empty().append('<option value="">-- หัวข้อ/Category --</option>');

        if (subjId) {
            const relatedCategory = globalData.category.filter(t => t.SubjectRef === subjId);
            const groups = [...new Set(relatedCategory.map(t => t.AccordionGroup))].filter(g => g);

            groups.sort().forEach(g => {
                $groupSelect.append(`<option value="${g}">${g}</option>`);
            });
        }
        syncCategoriesToHiddenInput();
    }

function updateCategorySelect(selectElement) {
        const $groupSelect = $(selectElement);
        const groupName = $groupSelect.val();
        const $row = $groupSelect.closest('.category-row');
        const subjId = $row.find('.category-subject-select').val();
        const $categorySelect = $row.find('.category-id-select');

        $categorySelect.empty().append('<option value="">-- หัวข้อ/Category --</option>');

        if (groupName && subjId) {
            const categories = globalData.category.filter(t => t.SubjectRef === subjId && t.AccordionGroup === groupName);
            categories.sort((a, b) => a.CategoryName.localeCompare(b.CategoryName));
            categories.forEach(t => {
                $categorySelect.append(`<option value="${t.CategoryID}">${t.CategoryName} (${t.CategoryID})</option>`);
            });
        }
        syncCategoriesToHiddenInput();
    }

function addNewCategoryRow() {
        _renderNewCategoryRow(null);
    }

function syncCategoriesToHiddenInput() {
        const categories = [];
        $('#dynamic-categories-container .category-id-select').each(function () {
            const val = $(this).val();
            if (val && val !== "") {
                categories.push(val);
            }
        });
        // เก็บเป็น Stringified Array เพื่อส่งไป Backend
        $('#edit-category-hidden').val(JSON.stringify(categories));
    }

function renderChoicesUI(choicesStr, correctAnsStr, suggestedAnsStr = null) {
        const $container = $('#dynamic-choices-container');
        $container.empty();
        choiceImagesData = {};

        let choices = (choicesStr || "").split('///').map(c => c.trim()).filter(c => c !== "");
        if (choices.length === 0) choices = ["", "", "", ""];

        choices.forEach((choiceText) => {

            // 1. เช็คว่าเป็นเฉลยเดิมหรือไม่
            const isOriginalCorrect = isMediaMatch(choiceText, correctAnsStr);

            // 2. เช็คว่าเป็นคำตอบที่นิสิตเสนอมาหรือไม่ (ฉลาดขึ้น)
            let isSuggested = false;
            if (suggestedAnsStr && suggestedAnsStr.trim() !== "") {
                isSuggested = isMediaMatch(choiceText, suggestedAnsStr);
            }

            addChoiceRow(choiceText, isOriginalCorrect, isSuggested);
        });

        // ถ้ามี Suggested Answer แต่หาใน Choice ไม่เจอเลย ให้แจ้งเตือนแอดมินหน่อย
        if (suggestedAnsStr && suggestedAnsStr.trim() !== "" && !$container.find('.suggested-choice').length) {
            $container.prepend(`
            <div class="alert alert-success small py-2 mb-2" style="border: 2px dashed #1cc88a; background-color: #eafff5;">
                <i class="fas fa-info-circle"></i> <b>คำตอบที่เสนอมาใหม่:</b><br>
                <div style="padding: 5px; background: white; margin-top: 5px; border-radius: 4px;">
                    ${suggestedAnsStr.startsWith('<svg') ? suggestedAnsStr : suggestedAnsStr}
                </div>
                <small class="text-muted">(ไม่พบตัวเลือกที่ตรงกันเป๊ะในรายการด้านล่าง แอดมินอาจต้องกดเพิ่ม Choice ใหม่เอง)</small>
            </div>
        `);
        }
    }

function addChoiceRow(value = "", isOriginalCorrect = false, isSuggested = false) {
        choiceRowCounter++;
        const rowId = 'choice-row-' + choiceRowCounter;
        const $container = $('#dynamic-choices-container');

        const isImageNeeded = value.toLowerCase().includes("require_img");
        const isSvg = value.trim().startsWith('<svg');

        // สร้าง HTML แบบว่างๆ ในส่วนของ value ไว้ก่อน
        const rowHtml = `
    <div class="choice-item ${isSuggested ? 'suggested-choice' : ''} ${(isImageNeeded && !isSvg) ? 'border-warning bg-warning-subtle' : 'bg-white'} mb-3 p-2 border rounded" id="${rowId}">
        <div class="choice-input-group d-flex align-items-center">
            <input class="form-check-input choice-radio me-2" type="radio" name="correct_answer_group" ${isOriginalCorrect ? 'checked' : ''}>
            
            <input type="text" class="form-control choice-text-input ${(isImageNeeded && !isSvg) ? 'd-none' : ''}" 
                placeholder="พิมพ์ข้อความ หรือกด Ctrl+V เพื่อวางรูป">
            
            ${(isImageNeeded && !isSvg) ? `
                <div class="flex-grow-1 text-warning-emphasis fw-bold small py-1 prompt-text">
                    <i class="fas fa-image me-1"></i> คลิกเลือกช่องนี้แล้วกด Ctrl+V เพื่อวางรูป ${value}
                </div>` : ''}

            <div class="d-flex">
                <button type="button" class="btn btn-sm btn-outline-info ms-2" onclick="openImageLibraryForChoice('${rowId}')"><i class="fas fa-images"></i></button>
                <label class="btn btn-sm btn-outline-primary ms-1 mb-0"><i class="fas fa-upload"></i><input type="file" class="d-none" accept="image/*" onchange="handleChoiceImageSelect(this, '${rowId}')"></label>
                <i class="fas fa-trash-alt btn-remove-choice ms-2 text-danger" onclick="removeChoiceRow('${rowId}')"></i>
            </div>
        </div>
        
        <div class="choice-preview-container mt-2 flex-column align-items-center bg-light p-2 border rounded" style="display:none;">
            <div class="svg-choice-preview-area w-100 d-flex justify-content-center mb-2"></div>
            <img src="" class="img-thumbnail mb-2" style="max-height: 120px; object-fit: contain; display:none;">
            <button type="button" class="btn btn-sm btn-danger w-100" onclick="removeChoiceMedia('${rowId}')">ล้างสื่อ</button>
        </div>
    </div>`;

        const $row = $(rowHtml);

        // --- จุดที่แก้ไข: ใช้ .val() เพื่อใส่ค่า SVG ที่มีเครื่องหมาย " ได้อย่างปลอดภัย ---
        $row.find('.choice-text-input').val(isImageNeeded ? '' : value);

        $container.append($row);

        // สั่ง Render พรีวิว
        renderChoicePreview($row.find('.choice-text-input'));
    }

function openImageLibraryForChoice(rowId) {
        currentLibraryTarget = { type: 'choice', rowId: rowId };
        openImageLibrary(); // เรียกฟังก์ชันเปิดคลังเดิม
    }

function handleChoiceImageSelect(input, rowId) {
        if (!input.files || input.files.length === 0) return;
        const file = input.files[0];
        const localBlobUrl = URL.createObjectURL(file);

        getBase64(file).then(async base64 => {

            const compressedBase64 = await compressImage(base64, 800, 800);

            // เก็บข้อมูลไว้ในตัวแปร รออัปโหลดตอน Save ครั้งเดียว
            choiceImagesData[rowId] = {
                type: 'pending',
                data: compressedBase64, // ข้อมูล Base64 สำหรับอัปโหลด
                blob: localBlobUrl
            };
            const $input = $('#' + rowId).find('.choice-text-input');
            $input.val('[IMAGE_PENDING]');
            renderChoicePreview($input);
        });
    }

function removeChoiceImage(rowId) {
        const $row = $('#' + rowId);
        const $input = $row.find('.choice-text-input');
        const imgData = choiceImagesData[rowId];
        const qId = $('#edit-q-id').val();

        // 1. ถ้าเป็นรูปใน Google Drive ให้ส่งคำสั่งลบไปที่ Server
        if (imgData && imgData.type === 'existing' && imgData.data.includes('drive.google.com')) {
            sendWithRetry({
                action: 'deleteImage',
                username: currentUser.username,
                adminPass: adminPass,
                data: { url: imgData.data, currentQid: qId }
            });
        }

        // 2. ล้างข้อมูลใน Memory
        delete choiceImagesData[rowId];

        // 3. ล้างค่าในช่อง Input และสั่งรีเฟรช Preview
        $input.val('');
        renderChoicePreview($input);
    }

function removeChoiceRow(rowId) {
        removeChoiceImage(rowId); // ลบรูปใน Drive ก่อนถ้ามี
        $('#' + rowId).remove();
    }

function removeChoiceMedia(rowId) {
        const $row = $('#' + rowId);
        const $input = $row.find('.choice-text-input');
        const urlToRemove = $input.val().trim();
        const qId = $('#edit-q-id').val();

        // 1. ถ้าเป็นลิงก์ Google Drive ให้สั่งลบใน Drive ด้วย
        if (urlToRemove.includes('drive.google.com')) {
            sendWithRetry({
                action: 'deleteImage',
                username: currentUser.username,
                adminPass: adminPass,
                data: { url: urlToRemove, currentQid: qId }
            });
        }

        // 2. 🔥 ล้างข้อมูลใน Memory และช่อง Input ทันทีในคลิกเดียว
        if (choiceImagesData[rowId] && choiceImagesData[rowId].blob) {
            URL.revokeObjectURL(choiceImagesData[rowId].blob);
        }
        delete choiceImagesData[rowId];

        // 3. 🔥 เคลียร์ค่าในช่อง Input ให้ว่างเปล่า (เพื่อให้ตอน Save ลิงก์หายไปจาก Sheet)
        $input.val('').show();

        // 4. อัปเดต UI พรีวิว
        renderChoicePreview($input);
        syncChoicesToHiddenInput();

        bgToast.fire({ icon: 'success', title: 'ลบสื่อและลิงก์ออกแล้ว', timer: 1500 });
    }

function addNewChoiceRow() {
        addChoiceRow("");
    }

function syncChoicesToHiddenInput() {
        const choices = [];
        let correctAnswer = "";

        $('#dynamic-choices-container .choice-item').each(function () {
            const $input = $(this).find('.choice-text-input');
            const textVal = $input.val().trim();
            const isChecked = $(this).find('.choice-radio').is(':checked');

            if (textVal !== "") {
                choices.push(textVal); // เก็บค่าเข้า Array
                if (isChecked) {
                    correctAnswer = textVal;
                }
            }
            renderChoicePreview($input);
        });

        // ก่อนบันทึกเข้า hidden input ให้กรองช่องว่าง (ถ้ามีคนเผลอใส่ /// ไว้ใน text)
        $('#edit-choices').val(choices.join('///'));
        $('#edit-answer').val(correctAnswer);
    }

function renderChoicePreview($inputEl) {
        const text = $inputEl.val().trim();
        const $item = $inputEl.closest('.choice-item');
        const rowId = $item.attr('id');
        const $previewContainer = $item.find('.choice-preview-container');
        const $previewImg = $previewContainer.find('img');
        const $svgArea = $previewContainer.find('.svg-choice-preview-area');
        const $promptText = $item.find('.prompt-text');

        // รีเซ็ตสถานะเริ่มต้น (ซ่อนพรีวิวทั้งหมดก่อนตรวจสอบใหม่)
        $previewImg.hide();
        $svgArea.hide().empty();
        $previewContainer.hide();

        // 1. ตรวจสอบสถานะ "รอการอัปโหลด" (Pending Image)
        // สำหรับรูปที่เพิ่ง Paste หรือเลือกไฟล์เข้ามาใหม่ และยังไม่ได้บันทึกลง Server
        const isPending = choiceImagesData[rowId] && choiceImagesData[rowId].type === 'pending';

        if (isPending) {
            $inputEl.hide(); // ซ่อนช่องกรอก text
            if ($promptText) $promptText.hide();

            // แสดงรูปภาพโดยใช้ blob URL (local URL ในเครื่อง) เพื่อให้เห็นภาพทันที
            $previewImg.attr('src', choiceImagesData[rowId].blob).show();
            $previewContainer.show().css('display', 'flex');

            // ล้างสีแจ้งเตือน "รอรูปภาพ"
            $item.removeClass('border-warning bg-warning-subtle');
            return; // จบการทำงานสำหรับเคส pending
        }

        // กรณีไม่มีข้อความในช่อง input และไม่มีรูป pending ให้หยุดทำงาน
        if (text === "") return;

        // 2. ตรวจสอบว่าเป็น SVG หรือไม่
        if (text.toLowerCase().startsWith('<svg')) {
            $inputEl.show(); // แสดงช่องโค้ดไว้เผื่อแก้ไข
            if ($promptText) $promptText.hide();

            // ฉีดโค้ด SVG ลงไปเพื่อให้ Browser วาดภาพ
            $svgArea.html(text).show();
            $previewContainer.show().css('display', 'flex');
            $item.removeClass('border-warning bg-warning-subtle');
        }
        // 3. ตรวจสอบว่าเป็น URL รูปภาพ (Google Drive หรือ Link เว็บทั่วไป)
        else if (text.includes('drive.google.com')) {
            $inputEl.hide(); // ซ่อน URL ยาวๆ ไว้
            if ($promptText) $promptText.hide();

            // แสดงรูปผ่าน URL
            $previewImg.attr('src', transformUrl(text)).show();
            $previewContainer.show().css('display', 'flex');
            $item.removeClass('border-warning bg-warning-subtle');
        }
    }

function renderImagesUI(imgStr) {
        existingMainImages = (imgStr || "").split('///')
            .map(u => u.trim())
            .filter(u => u !== "");

        pendingMainImages = [];
        syncMainImageGallery();
    }

function handleMainImagesSelection(input) {
        if (!input.files || input.files.length === 0) return;
        let promises = [];
        for (let i = 0; i < input.files.length; i++) {
            promises.push(getBase64(input.files[i]));
        }
        Promise.all(promises).then(base64Array => {
            // เพิ่มเข้าคิวรออัปโหลด
            pendingMainImages = pendingMainImages.concat(base64Array);
            syncMainImageGallery();
            input.value = '';
        });
    }

function syncMainImageGallery() {
        // รวม Array รูปรอแสดงผล
        const hasRealImage = pendingMainImages.length > 0 || existingMainImages.some(u => u.includes('http'));

        if (hasRealImage) {
            existingMainImages = existingMainImages.filter(u => !u.toLowerCase().includes('require_img'));
        }

        editImageArray = [...existingMainImages, ...pendingMainImages];

        if (editImageIndex >= editImageArray.length) {
            editImageIndex = Math.max(0, editImageArray.length - 1);
        }
        updateEditImageGallery();
    }

function updateEditImageGallery() {
        const $container = $('#edit-image-gallery-container');
        const $img = $('#edit-gallery-img');
        const $svgRender = $('#edit-gallery-svg-render');
        const $prevBtn = $('#prev-img-btn');
        const $nextBtn = $('#next-img-btn');
        const $counter = $('#image-counter');

        if (editImageArray.length === 0) {
            $container.hide();
            return;
        }

        $container.show();

        // เช็คว่าเป็น URL เดิม (http) หรือ Base64 ใหม่
        let currentSrc = editImageArray[editImageIndex];
        if (currentSrc.startsWith('<svg')) {
            $img.hide();
            $svgRender.html(currentSrc).show(); // ใส่ Code SVG เข้าไปตรงๆ
        } else {
            $svgRender.hide().empty();
            if (currentSrc.startsWith('http')) {
                $img.attr('src', transformUrl(currentSrc)).show();
            } else {
                $img.attr('src', currentSrc).show(); // สำหรับ Base64
            }
        }

        if (editImageArray.length > 1) {
            $prevBtn.show(); $nextBtn.show();
            $counter.show().text(`${editImageIndex + 1} / ${editImageArray.length}`);
        } else {
            $prevBtn.hide(); $nextBtn.hide(); $counter.hide();
        }
    }

function removeCurrentImageFromGallery() {
        let isExisting = editImageIndex < existingMainImages.length;
        let qId = $('#edit-q-id').val();

        if (isExisting) {
            let urlToRemove = existingMainImages[editImageIndex];
            Swal.fire({
                title: 'ลบรูปภาพโจทย์?',
                text: "ไฟล์จะถูกย้ายลงถังขยะและลิงก์จะถูกนำออกจากข้อสอบทันที",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'ลบภาพและลิงก์'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    // 1. ส่งคำสั่งลบไฟล์ใน Drive (ทำงานเบื้องหลัง)
                    sendWithRetry({
                        action: 'deleteImage',
                        username: currentUser.username,
                        adminPass: adminPass,
                        data: { url: urlToRemove, currentQid: qId }
                    });

                    // 2. 🔥 ลบลิงก์ออกจากรายการในหน้าจอทันที (สำคัญ!)
                    existingMainImages.splice(editImageIndex, 1);

                    // 3. อัปเดตการแสดงผลหน้าจอ
                    syncMainImageGallery();

                    bgToast.fire({ icon: 'success', title: 'นำรูปภาพและลิงก์ออกแล้ว (อย่าลืมกด Save Changes)', timer: 2000 });
                }
            });
        } else {
            // รูปใหม่ที่ยังไม่ได้ขึ้น Drive แค่ลบจาก Array
            let pendingIndex = editImageIndex - existingMainImages.length;
            pendingMainImages.splice(pendingIndex, 1);
            syncMainImageGallery();
        }
    }

function addImageRow(value = "") {
        const $container = $('#dynamic-images-container');
        const rowHtml = `
        <div class="image-input-item mb-2">
            <div class="input-group">
                <label class="input-group-text bg-primary text-white" style="cursor:pointer">
                    <i class="fas fa-upload"></i>
                    <input type="file" class="d-none" accept="image/*" onchange="handleFileUpload(this, 'Main')">
                </label>
                <input type="text" class="form-control image-url-input" value="${value}" placeholder="Link รูปภาพ...">
                <button class="btn btn-outline-danger" type="button" onclick="removeImageRowWithTrash(this)">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        </div>`;
        $container.append(rowHtml);
    }

function addNewImageRow() {
        addImageRow("");
    }

function removeImageRow(btn) {
        // ... (โค้ด removeImageRow เดิม) ...
        const rowCount = $('#dynamic-images-container .image-input-item').length;
        if (rowCount <= 1) {
            $(btn).closest('.image-input-item').find('input').val('');
        } else {
            $(btn).closest('.image-input-item').remove();
        }
        syncImagesToHiddenInput();
        // ... (จบโค้ด removeImageRow เดิม) ...
    }

function syncImagesToHiddenInput() {
        const imgSet = new Set(); // ใช้ Set เพื่อป้องกันค่าซ้ำ

        // เก็บจากลิสต์ที่แสดงผลบนหน้าจอ
        editImageArray.forEach(val => {
            const cleanVal = val.trim();
            if (cleanVal !== "") imgSet.add(cleanVal);
        });

        const finalResult = Array.from(imgSet).join('///');
        $('#edit-img').val(finalResult);
    }

function selectImageFromLibraryEncoded(encodedContent) {
        // ถอดรหัสกลับเป็น Code SVG ปกติ
        const decodedContent = decodeURIComponent(encodedContent);
        // ส่งไปทำงานต่อที่ฟังก์ชันเดิม
        selectImageFromLibrary(decodedContent);
    }

function openImageLibrary() {
        const categoryString = $('#edit-category-hidden').val();
        let currentCategories = [];
        try { currentCategories = JSON.parse(categoryString); } catch (e) { }

        if (currentCategories.length === 0) {
            Swal.fire('แจ้งเตือน', 'กรุณาเลือกวิชาและหัวข้อก่อนเปิดคลังสื่อ', 'warning');
            return;
        }

        const currentSubject = getSubjectFromCategory(currentCategories[0]);
        $('#library-subject-name').text(currentSubject);

        const libraryMap = {};
        let totalItems = 0;

        // กรองคำถามเฉพาะวิชาเดียวกัน
        globalData.questions.forEach(q => {
            const qSubject = getSubjectFromCategory(q.category);
            if (qSubject !== currentSubject) return;

            const qCategoryName = Array.isArray(q.category) ? q.category[0] : q.category;

            // ฟังก์ชันช่วยสกัดทั้ง URL รูปภาพ และ SVG Code
            const extractMedia = (str) => {
                if (!str) return;
                const parts = str.split('///').map(u => u.trim()).filter(Boolean);
                parts.forEach(part => {
                    // ตรวจสอบว่าเป็น URL หรือเป็น SVG Code
                    if (part.includes('drive.google.com') || part.startsWith('http') || part.startsWith('<svg')) {
                        if (!libraryMap[qCategoryName]) libraryMap[qCategoryName] = new Set();
                        libraryMap[qCategoryName].add(part);
                        totalItems++;
                    }
                });
            };

            extractMedia(q.img);     // ดึงจากรูปโจทย์
            extractMedia(q.choices); // ดึงจากตัวเลือก
        });

        const $container = $('#library-grid-container');
        $container.empty();

        if (totalItems === 0) {
            $container.html('<div class="col-12 text-center text-muted py-5">ยังไม่มีสื่อหรือ SVG ในวิชานี้</div>');
        } else {
            for (const [catName, mediaSet] of Object.entries(libraryMap)) {
                $container.append(`<div class="library-group-header"><i class="fas fa-folder-open"></i> หัวข้อ: ${catName}</div>`);

                mediaSet.forEach(item => {
                    let previewHtml = "";

                    // กรณีเป็น SVG Code
                    if (item.startsWith('<svg')) {
                        // เข้ารหัส Code SVG ทั้งหมดเพื่อไม่ให้เครื่องหมายคำพูดไปพัง HTML
                        const encodedSvg = encodeURIComponent(item);

                        previewHtml = `
        <div class="library-item svg-item" onclick="selectImageFromLibraryEncoded('${encodedSvg}')" title="คลิกเพื่อใช้ SVG นี้">
            <div class="svg-preview-box">${item}</div>
        </div>`;
                    }

                    // กรณีเป็นรูปภาพปกติ (URL)
                    else {
                        previewHtml = `
                        <div class="library-item" onclick="selectImageFromLibrary('${item}')" title="คลิกเพื่อใช้รูปนี้">
                            <img src="${transformUrl(item)}" loading="lazy">
                        </div>`;
                    }
                    $container.append(previewHtml);
                });
            }
        }
        $('#imageLibraryModal').modal('show');
    }

function selectImageFromLibrary(content) {
    const cleanContent = content.trim();

    if (currentLibraryTarget.type === 'main') {
        // --- สำหรับรูปโจทย์หลัก (Main Images) ---
        // เช็คว่าใน Array มีรูปนี้หรือยัง (ป้องกัน <svg xmlns...///<svg xmlns...)
        const isDuplicate = existingMainImages.some(item => item.trim() === cleanContent) ||
            pendingMainImages.some(item => item.trim() === cleanContent);

        if (isDuplicate) {
            Swal.fire({ icon: 'info', title: 'สื่อนี้ถูกเลือกไว้แล้ว', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
            return;
        }

        existingMainImages.push(cleanContent); // เพิ่มเข้าไปในลิสต์
        syncMainImageGallery(); // อัปเดต Gallery หน้าจอ
    } else if (currentLibraryTarget.type === 'explain') {
        const isDuplicate = existingExplainMedia.some(item => item.trim() === cleanContent) ||
            pendingExplainMedia.some(item => item.trim() === cleanContent);

        if (isDuplicate) {
            Swal.fire({ icon: 'info', title: 'สื่อนี้ถูกเลือกไว้แล้ว', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
            return;
        }

        existingExplainMedia.push(cleanContent);
        syncExplainMediaGallery();
    } else {
        // --- สำหรับตัวเลือก (Choices) ---
        const $row = $('#' + currentLibraryTarget.rowId);
        const $input = $row.find('.choice-text-input');

        // สำหรับ Choice แนะนำให้ "แทนที่" ไปเลย (เพราะ 1 ช้อยส์มักมี 1 รูป/1 SVG)
        $input.val(cleanContent);

        renderChoicePreview($input);
        syncChoicesToHiddenInput();
    }

    $('#imageLibraryModal').modal('hide');
    Swal.fire({ icon: 'success', title: 'เลือกสื่อเรียบร้อยแล้ว', toast: true, position: 'top-end', showConfirmButton: false, timer: 1000 });
}


function getBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

async function handleFileUpload(input, type) {
        if (!input.files || !input.files[0]) return;

        const file = input.files[0];
        const qId = $('#edit-q-id').val();

        if (!qId) {
            Swal.fire('Error', 'ไม่พบรหัสข้อสอบ กรุณาตรวจสอบว่ามี ID ข้อสอบหรือไม่', 'error');
            input.value = '';
            return;
        }

        // 1. สร้าง URL ชั่วคราวจากไฟล์ในเครื่อง (โชว์รูปได้ทันทีระดับ Millisecond)
        const localPreviewUrl = URL.createObjectURL(file);

        let $targetTextInput;
        let $row;
        let $uploadIcon = $(input).closest('label').find('i');

        // 2. แสดง Preview ทันที และล็อคช่อง Input ป้องกันการแก้ไขระหว่างอัปโหลด
        if (type === 'Main') {
            $row = $(input).closest('.image-input-item');
            $targetTextInput = $row.find('.image-url-input');

            $targetTextInput.val(localPreviewUrl).prop('disabled', true);
            $uploadIcon.removeClass('fa-upload').addClass('fa-spinner fa-spin text-warning');
            syncImagesToHiddenInput(); // เรียกให้ Gallery อัปเดตโชว์รูปทันที

        } else {
            $row = $(input).closest('.choice-item');
            $targetTextInput = $row.find('.choice-text-input');
            const $previewContainer = $row.find('.choice-preview-container');

            $targetTextInput.prop('disabled', true);
            $previewContainer.find('img').attr('src', localPreviewUrl);
            $previewContainer.find('.text-muted').html('<i class="fas fa-spinner fa-spin text-warning"></i> กำลังอัปโหลดลง Drive...');
            $previewContainer.show();
        }

        // 3. เริ่มกระบวนการอัปโหลดไป Drive (ทำเบื้องหลัง)
        activeUploadsCount++; // เพิ่มจำนวนงานที่กำลังทำ
        const reader = new FileReader();

        reader.onload = async function (e) {
            const base64 = e.target.result;

            try {
                // ไม่ใช้ $('#loading-overlay').show() แล้ว ให้ผู้ใช้ทำอย่างอื่นต่อได้เลย
                const res = await sendWithRetry({
                    action: 'uploadImage',
                    username: currentUser.username,
                    adminPass: adminPass,
                    data: { base64: base64, questionId: qId, type: type }
                });

                if (res.result === 'success' && res.url) {
                    // เมื่อเสร็จแล้ว เอาลิงก์ Drive ของจริงมาใส่แทนที่
                    $targetTextInput.val(res.url);

                    // แจ้งเตือนเงียบๆ แบบ Toast (ไม่เด้งบังหน้าจอ)
                    Swal.fire({
                        icon: 'success',
                        title: 'อัปโหลดรูปเสร็จสมบูรณ์',
                        toast: true,
                        position: 'bottom-end',
                        showConfirmButton: false,
                        timer: 2000
                    });
                } else {
                    throw new Error(res.message || "เซิร์ฟเวอร์ไม่ได้ส่งลิงก์กลับมา");
                }
            } catch (err) {
                console.error("Upload Error:", err);
                Swal.fire('อัปโหลดล้มเหลว', err.message, 'error');
                $targetTextInput.val(''); // ล้างช่องถ้าอัปโหลดพัง
            } finally {
                // 4. เคลียร์สถานะ คืนค่า UI กลับเป็นปกติ
                activeUploadsCount--;
                $targetTextInput.prop('disabled', false);
                input.value = ''; // เคลียร์ไฟล์
                URL.revokeObjectURL(localPreviewUrl); // คืนหน่วยความจำให้เบราว์เซอร์

                if (type === 'Main') {
                    $uploadIcon.removeClass('fa-spinner fa-spin text-warning').addClass('fa-upload text-white');
                    syncImagesToHiddenInput();
                } else {
                    const $previewContainer = $row.find('.choice-preview-container');
                    $previewContainer.find('.text-muted').text('Choice Image Preview');
                    syncChoicesToHiddenInput();
                }
            }
        };

        // กรณีอ่านไฟล์ไม่สำเร็จ
        reader.onerror = function (error) {
            activeUploadsCount--;
            Swal.fire('Error', 'เบราว์เซอร์ไม่สามารถอ่านไฟล์รูปนี้ได้', 'error');
            $targetTextInput.prop('disabled', false);
        };

        reader.readAsDataURL(file); // เริ่มอ่านไฟล์เพื่อส่งไป Apps Script
    }

async function removeImageRowWithTrash(btn) {
        const $row = $(btn).closest('.image-input-item');
        const urlValue = $row.find('input[type="text"]').val().trim();

        // ถ้ามี URL ให้ถามก่อนว่าจะย้ายลงถังขยะไหม
        if (urlValue !== "") {
            const isTrashed = await handleImageTrash(urlValue);
            if (!isTrashed) return; // ถ้าไม่สำเร็จ หรือยกเลิก ไม่ต้องลบ Row
        }

        const rowCount = $('#dynamic-images-container .image-input-item').length;
        if (rowCount <= 1) {
            $row.find('input').val('');
        } else {
            $row.remove();
        }
        syncImagesToHiddenInput();
    }

async function promptRestoreImage() {
        const { value: url } = await Swal.fire({
            title: 'กู้คืนรูปภาพจากถังขยะ',
            input: 'url',
            inputLabel: 'วางลิงก์รูปภาพที่ต้องการกู้คืน',
            showCancelButton: true
        });

        if (!url) return;

        try {
            $('#loading-overlay').fadeIn(200).css('display', 'flex').find('h5').text('กำลังกู้คืนไฟล์...');
            const res = await sendWithRetry({ action: 'restoreImage', username: currentUser.username, adminPass: adminPass, data: { url: url } });

            if (res.result === 'success') {
                if ($('#editQuestionModal').hasClass('show')) {
                    const result = await Swal.fire({
                        title: 'กู้คืนสำเร็จ!',
                        text: 'นำลิงก์ไปวางที่ไหนดี?',
                        icon: 'success',
                        showDenyButton: true,
                        showCancelButton: true,
                        confirmButtonText: 'รูปโจทย์ (Main)',
                        denyButtonText: 'ตัวเลือก (Choice)',
                        cancelButtonText: 'ปิดหน้าต่าง'
                    });

                    if (result.isConfirmed) {
                        addImageRow(res.url);
                        syncImagesToHiddenInput();
                    } else if (result.isDenied) {
                        addChoiceRow(res.url);
                        syncChoicesToHiddenInput();
                    }
                } else {
                    Swal.fire('สำเร็จ', 'กู้คืนรูปภาพเรียบร้อย', 'success');
                }
                fetchData(true);
            } else { throw new Error(res.message); }
        } catch (e) { Swal.fire('Error', e.message, 'error'); }
        finally { $('#loading-overlay').hide(); }
    }

async function removeChoiceRowWithTrash(btn) {
        const $row = $(btn).closest('.choice-item');
        const urlValue = $row.find('.choice-text-input').val().trim();

        // ถ้าเป็นลิงก์รูป ให้ถามเรื่องถังขยะก่อน
        if (urlValue.includes('drive.google.com')) {
            const isTrashed = await handleImageTrash(urlValue);
            if (!isTrashed) return; // ยกเลิก
        }

        $row.remove();
        syncChoicesToHiddenInput();
    }

async function handleImageTrash(url) {
        // ถ้าไม่ใช่ลิงก์ Google Drive (เช่น เป็นช่องว่าง หรือ require_img) ให้ส่งค่า true เพื่อให้ลบแถวได้เลย
        if (!url || !url.includes('drive.google.com')) return true;

        const result = await Swal.fire({
            title: 'ย้ายรูปลงถังขยะใน Drive?',
            text: "ไฟล์จะถูกย้ายไปที่โฟลเดอร์ RecycleBin และกู้คืนได้ภายใน 10 วัน",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'ย้ายลงถังขยะ',
            cancelButtonText: 'ยกเลิก'
        });

        if (result.isConfirmed) {
            try {
                $('#loading-overlay').fadeIn(200).css('display', 'flex').find('h5').text('กำลังลบไฟล์ใน Drive...');

                const res = await sendWithRetry({
                    action: 'deleteImage',
                    username: currentUser.username,
                    adminPass: adminPass,
                    data: { url: url }
                });

                if (res.result === 'success') {
                    Swal.fire({
                        icon: 'success',
                        title: 'สำเร็จ',
                        text: 'ย้ายไฟล์ลงถังขยะแล้ว',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    return true; // อนุญาตให้โค้ดส่วนถัดไปลบช่อง Input ทิ้ง
                } else {
                    throw new Error(res.message);
                }
            } catch (e) {
                Swal.fire('Error', 'ไม่สามารถลบรูปได้: ' + e.message, 'error');
                return false; // ไม่อนุญาตให้ลบช่อง Input (เผื่อไว้ลองใหม่)
            } finally {
                $('#loading-overlay').hide();
            }
        }
        return false; // กรณีผู้ใช้กด 'ยกเลิก'
    }

async function askAIExpert() {
    // 1. ดึงข้อมูลจากฟอร์มปัจจุบัน
    const problem = $('#edit-problem').val().trim();
    const explanationField = $('#edit-explanation');
    const statusText = $('#ai-status-text');
    const quotaBadge = $('#ai-quota-badge');
    const btn = $('#btn-ask-ai');

    // 2. รวบรวมตัวเลือก (Choices) ทั้งหมดที่พิมพ์ไว้
    let choices = [];
    $('#dynamic-choices-container .choice-item').each(function () {
        // ดึงเฉพาะ Text (ข้ามรูปภาพถ้ามี)
        const text = $(this).find('.choice-text-input').val();
        if (text && text.trim() !== "") {
            choices.push(text.trim());
        }
    });

    // 3. ดึงคำตอบที่ติ๊กเลือกไว้ (Correct Answer)
    const answer = $('#dynamic-choices-container .choice-item:has(.choice-radio:checked) .choice-text-input').val();

    // 4. ตรวจสอบความพร้อมของข้อมูล
    if (!problem) {
        Swal.fire('ข้อมูลไม่ครบ', 'กรุณากรอกโจทย์ก่อนใช้ AI', 'warning');
        return;
    }
    if (choices.length === 0 || !answer) {
        Swal.fire('ข้อมูลไม่ครบ', 'กรุณาระบุตัวเลือกและเลือกคำตอบที่ถูกต้องก่อนใช้ AI เพื่อให้ตรวจสอบได้แม่นยำ', 'warning');
        return;
    }

    // 5. ดึงรูปภาพทั้งหมดของโจทย์ที่พร้อมใช้งาน (กรองค่าว่างและคำว่า require_img ออก)
    let imageUrls = [];
    if (editImageArray && editImageArray.length > 0) {
        imageUrls = editImageArray.filter(url => url && !url.toLowerCase().includes('require_img'));
    }

    // 6. เตรียม UI ขณะรอ
    btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin me-1"></i> AI Processing...');
    statusText.fadeIn();
    explanationField.css('opacity', '0.5');

    // 7. สร้างชุดคำสั่ง (Prompt) ที่มอบภารกิจให้ AI ตรวจสอบ Guideline ปัจจุบันผ่าน Google Search
    const prompt = `คุณคืออาจารย์แพทย์ผู้เชี่ยวชาญด้านแพทยศาสตรศึกษา (Medical Education Expert) ที่มีทักษะการสอนที่ยอดเยี่ยม
[TASK]
1. ตรวจสอบว่าโจทย์ ตัวเลือก และภาพประกอบที่แนบส่งมาด้วย (ถ้ามี) มีความสัมพันธ์และสมเหตุสมผลตามหลักวิชาการแพทย์ในปัจจุบันมากน้อยเพียงใด
2. เขียนคำอธิบายเฉลย (Explanation) เป็นภาษาไทย prose ลื่นไหลเป็นธรรมชาติ ผสมภาษาอังกฤษ (Medical Terminology) ตามระดับทักษะที่แพทย์และนิสิตแพทย์ใช้กันจริงในชีวิตประจำวัน
3. ห้ามทำเป็นหัวข้อหรือขึ้นบรรทัดใหม่ ให้เขียนอธิบายรวมกันเป็น 1 ย่อหน้าต่อเนื่อง (Single continuous paragraph)
4. หากประเด็นในโจทย์เกี่ยวข้องกับเกณฑ์การประเมิน เกณฑ์การตรวจวัด หรือแนวทางปฏิบัติการรักษาที่เป็นมาตรฐานสากล (เช่น แนวทางของ AHA/ACC, KDIGO, GINA, GOLD, IDSA, GINA หรือเกณฑ์อ้างอิงทางคลินิกอื่นๆ) ให้ค้นหาข้อมูลผ่านระบบ Google Search เพื่อเปรียบเทียบและอ้างอิงกับแนวปฏิบัติการรักษาล่าสุด (Updated Guidelines) ที่เป็นปัจจุบันที่สุดเสมอก่อนให้คำตอบ

[DATA]
- โจทย์: "${problem}"
- ตัวเลือกทั้งหมด: ${choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join(', ')}
- คำตอบที่ถูกต้องที่ระบุไว้: "${answer}"

[INSTRUCTION & WRITING STYLE]
- ภาษา: ใช้โทนเป็นกันเอง อธิบายอย่างมีเหตุมีผลคล้ายคุณหมอรุ่นพี่หรืออาจารย์แพทย์ที่ใจดีกำลังสอนบอร์ด อธิบายอย่างชัดเจน มีความลื่นไหลเป็นเนื้อเดียวกัน
- การวิเคราะห์รูปภาพ: หากภาพแนบประกอบที่ส่งมาด้วย (เช่น ฟิล์ม X-ray, คลื่นไฟฟ้าหัวใจ ECG, หรือภาพถ่ายทางพยาธิวิทยา) มีข้อมูลพยาธิสภาพ ให้ดึงมาใช้ร่วมในการอธิบายกลไกของโจทย์ด้วย
- ความยาว: 4 - 6 ประโยคเท่านั้น ห้ามเกินนี้เด็ดขาด
- รูปแบบ: ย่อหน้าเดียวต่อเนื่อง มีการเชื่อมประโยคอย่างลื่นไหล ไม่มีพอยต์ย่อย ไม่มีขึ้นบรรทัดใหม่สำหรับตัวเลือก โดยใช้ประโยคเชื่อมโยงธรรมชาติ เช่น "ส่วนข้อ B ผิดเพราะ... (due to...)", "ข้อ C ผิดเพราะ..."
- ลำดับการอธิบาย:
  1. เริ่มต้นวิเคราะห์ทันทีด้วยการเฉลยว่าทำไมคำตอบที่ถูกต้องจึงเป็น "${answer}" อธิบายกลไกทางพยาธิสรีรวิทยา (Pathophysiology) หรือโครงสร้างทางกายวิภาคที่เกี่ยวข้องและสัมพันธ์กับคำถาม โดยอิงหลักฐานหรือคำแนะนำจากแนวทางการรักษาสากลล่าสุดที่เกี่ยวข้อง
  2. เปรียบเทียบและชี้แจงเหตุผลของตัวเลือกอื่นๆ ที่เหลือทีละข้อให้ชัดเจนว่าเป็นพยาธิสภาพของอะไร หรือทำไมจึงยังไม่ถูกต้องในบริบทของโจทย์ข้อนี้ โดยใช้รูปประโยคเชื่อมโยงธรรมชาติ เช่น "ส่วนข้อ B ผิดเพราะ... (due to...)", "ข้อ C ผิดเพราะ..."

[STRICT RULES]
- เริ่มต้นเขียนคำอธิบายขึ้นต้นทันที ห้ามมีคำพูดเกริ่นนำใดๆ ทั้งสิ้น เช่น "คำอธิบายคือ:", "เฉลยข้อนี้:", "แน่นอน" หรือเขียนสรุปข้อความ "My Assessment"
- ตอบเฉพาะย่อหน้าคำอธิบายเป็นภาษาไทยผสมคำศัพท์ภาษาอังกฤษทางการแพทย์
- ห้ามใช้สัญลักษณ์ตัวหนา (**) หรือเครื่องหมายคำพูดครอบประโยคในผลลัพธ์
- เขียนเนื้อหาทั้งหมดเสร็จสิ้นภายใต้ 1 ย่อหน้ายาวต่อเนื่อง ห้ามใช้การขึ้นบรรทัดใหม่ (\\n) หรือระบบ Bullet lists เด็ดขาด
- ห้ามเริ่มด้วย: "คำอธิบายคือ:", "เฉลยข้อนี้:", "แน่นอน", "ข้อนี้...", หรือประโยคสรุปใดๆ
- ห้ามเกิน 6 ประโยค — ถ้าเขียนเกินให้ตัดตั้งแต่ตอนเขียน ไม่ใช่ตอนสรุป
- ห้ามใช้ ** (bold), bullet, หรือ \\n ทุกกรณี
- ห้ามอธิบายตัวเลือกผิดแต่ละข้อแยกประโยค — รวมในประโยคเดียวหรือสองประโยคได้

[EXAMPLE STYLE]
"Ligament of Treitz (suspensory muscle of the duodenum) เป็น landmark สำคัญที่ใช้กำหนด duodenojejunal flexure ซึ่งเป็นจุดเริ่มต้นของ jejunum ใน clinical surgery ใช้บ่งชี้ upper vs lower GI bleeding (proximal to ligament = upper GI) ส่วนข้อ B ผิดเพราะ transverse colon ถูก suspend โดย transverse mesocolon ข้อ C ผิดเพราะ hepatoduodenal ligament ประกอบด้วย portal triad (portal vein, hepatic artery, bile duct) ข้อ D ผิดเพราะ descending colon ยึดกับ posterior abdominal wall โดย peritoneal attachment โดยตรง ข้อ E ผิดเพราะ gastrosplenic ligament เป็นโครงสร้างที่เชื่อมกระเพาะกับม้าม"
`;

    try {
        // 8. ส่งข้อมูลไปยัง Backend (Apps Script) พร้อมส่งรูปภาพประกอบในรูป payload ไปวิเคราะห์
        const res = await sendWithRetry({
            action: 'askAIExpert',
            prompt: prompt,
            provider: 'Gemini',
            images: imageUrls,
            username: currentUser.username, // ส่งเพื่อเช็คสิทธิ์แอดมิน
            adminPass: adminPass
        }, 1); // ลองใหม่ได้สูงสุด 1 ครั้งถ้าพัง

        if (res.result === 'success') {
            let text = res.answer;

            // --- Logic การสกัดคำอธิบายตามเงื่อนไข ---

            // 1. หาตำแหน่งของเครื่องหมาย : ตัวแรก
            const colonIndex = text.indexOf(':');

            if (colonIndex !== -1) {
                // ตัดข้อความตั้งแต่หลัง : เป็นต้นไป
                let subText = text.substring(colonIndex + 1).trim();

                // 2. ใช้ Regex ค้นหา: 
                // เริ่มจากตัวอักษรไทยตัวแรก [\u0E00-\u0E7F]
                // ไปจนถึงภาษาไทยตัวสุดท้ายตามด้วยจุด [\u0E00-\u0E7F]\.
                const thaiPattern = /([\u0E00-\u0E7F].*[\u0E00-\u0E7F]\.)/s;
                const match = subText.match(thaiPattern);

                if (match && match[0]) {
                    // ได้ข้อความที่ต้องการแล้ว
                    let finalThai = match[0].trim();
                    explanationField.val(finalThai);
                } else {
                    // Fallback: หากหาตาม Pattern ไม่เจอ (กรณี AI ไม่ใส่จุด) 
                    // ให้ดึงส่วนที่เป็นภาษาไทยทั้งหมดมาแทน
                    const onlyThaiMatch = /([\u0E00-\u0E7F].*)/s.exec(subText);
                    explanationField.val(onlyThaiMatch ? onlyThaiMatch[0].trim() : subText);
                }
            } else {
                // กรณีไม่มี : เลย (AI ตอบมาแค่เนื้อหา)
                explanationField.val(text.trim());
            }

            // 9. อัปเดตป้ายโควต้า
            quotaBadge.html(`<i class="fas fa-bolt text-warning"></i> AI Quota: ${res.quota}`).fadeIn();

            // 10. แจ้งเตือนถ้า AI ตรวจพบความผิดปกติ (เช่น ติ๊กคำตอบผิดข้อ)
            if (res.answer.includes("⚠️")) {
                Swal.fire({
                    title: 'AI พบความผิดปกติ!',
                    text: 'AI ตรวจพบว่าคำตอบที่ติ๊กไว้ไม่ตรงกับตัวเลือก กรุณาตรวจสอบอีกครั้ง',
                    icon: 'warning',
                    confirmButtonColor: '#f6c23e'
                });
            } else {
                Swal.fire({
                    icon: 'success',
                    title: 'AI ช่วยเขียนสำเร็จ',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 2000
                });
            }
        } else {
            Swal.fire('AI Error', res.message || 'AI ไม่สามารถประมวลผลได้ในขณะนี้', 'error');
        }
    } catch (e) {
        console.error("AI Error:", e);
        Swal.fire('Connection Error', 'ไม่สามารถติดต่อ AI Expert ได้: ' + e.message, 'error');
    } finally {
        // 11. คืนค่า UI กลับเป็นปกติ
        btn.prop('disabled', false).html('<i class="fas fa-robot me-1"></i> ใช้ AI ช่วยเขียน & ตรวจโจทย์');
        statusText.hide();
        explanationField.css('opacity', '1');
    }
}

function isMediaMatch(str1, str2) {
    if (!str1 || !str2) return false;

    // ฟังก์ชันช่วยทำความสะอาดข้อความ
    const clean = (s) => {
        return s.toString()
            .replace(/\s+/g, '')        // ลบช่องว่างทั้งหมด
            .replace(/['"]/g, '')       // ลบเครื่องหมายคำพูดทั้ง ' และ "
            .replace(/^[a-z]\.\s*/i, '') // ลบ prefix เช่น A. หรือ a. ออก
            .toLowerCase();             // ทำเป็นตัวพิมพ์เล็ก
    };

    return clean(str1) === clean(str2);
}

function renderExplainMediaUI(mediaArray) {
    existingExplainMedia = (mediaArray || [])
        .map(u => u.trim())
        .filter(u => u !== "");

    pendingExplainMedia = [];
    syncExplainMediaGallery();
}

async function handleExplainMediaSelection(input) {
    if (!input.files || input.files.length === 0) return;
    const compressedResults = [];
    for (let i = 0; i < input.files.length; i++) {
        const file = input.files[i];
        const base64 = await getBase64(file);
        if (file.type.includes('image/')) {
            const comp = await compressImage(base64, 800, 800);
            compressedResults.push(comp);
        } else if (file.type === 'application/pdf') {
            if (file.size > 10 * 1024 * 1024) { // จำกัดขนาด PDF ที่ 10MB
                Swal.fire('ข้อผิดพลาด', 'ขนาดเอกสาร PDF ต้องไม่เกิน 10MB', 'error');
                continue;
            }
            compressedResults.push(base64);
        }
    }
    pendingExplainMedia = pendingExplainMedia.concat(compressedResults);
    syncExplainMediaGallery();
    input.value = '';
}

function syncExplainMediaGallery() {
    explainImageArray = [...existingExplainMedia, ...pendingExplainMedia];

    if (explainImageIndex >= explainImageArray.length) {
        explainImageIndex = Math.max(0, explainImageArray.length - 1);
    }
    updateExplainMediaGallery();
    syncExplainMediaToHiddenInput();
}

function updateExplainMediaGallery() {
    const $container = $('#explain-media-gallery-container');
    const $img = $('#explain-gallery-img');
    const $svgRender = $('#explain-gallery-svg-render');
    const $pdfRender = $('#explain-gallery-pdf-render');
    const $prevBtn = $('#prev-explain-media-btn');
    const $nextBtn = $('#next-explain-media-btn');
    const $counter = $('#explain-media-counter');

    if (explainImageArray.length === 0) {
        $container.hide();
        return;
    }

    $container.show();

    let currentSrc = explainImageArray[explainImageIndex];
    const type = getMediaType(currentSrc);

    $img.hide();
    $svgRender.hide().empty();
    $pdfRender.hide();

    if (type === 'pdf') {
        $('#explain-pdf-preview-link').attr('href', window.transformUrl(currentSrc));
        $pdfRender.show().css('display', 'flex');
    } else if (type === 'svg') {
        $svgRender.html(currentSrc).show();
    } else {
        if (currentSrc.startsWith('http')) {
            $img.attr('src', transformUrl(currentSrc)).show();
        } else {
            $img.attr('src', currentSrc).show(); // สำหรับ Base64
        }
    }

    if (explainImageArray.length > 1) {
        $prevBtn.show(); $nextBtn.show();
        $counter.show().text(`${explainImageIndex + 1} / ${explainImageArray.length}`);
    } else {
        $prevBtn.hide(); $nextBtn.hide(); $counter.hide();
    }
}

function removeCurrentExplainMediaFromGallery() {
    let isExisting = explainImageIndex < existingExplainMedia.length;
    let qId = $('#edit-q-id').val();

    if (isExisting) {
        let urlToRemove = existingExplainMedia[explainImageIndex];
        Swal.fire({
            title: 'ลบสื่อประกอบคำอธิบาย?',
            text: "ไฟล์จะถูกย้ายลงถังขยะและลิงก์จะถูกนำออกจากคำอธิบายทันที",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'ลบภาพและลิงก์'
        }).then(async (result) => {
            if (result.isConfirmed) {
                sendWithRetry({
                    action: 'deleteImage',
                    username: currentUser.username,
                    adminPass: adminPass,
                    data: { url: urlToRemove, currentQid: qId }
                });

                existingExplainMedia.splice(explainImageIndex, 1);
                syncExplainMediaGallery();
                bgToast.fire({ icon: 'success', title: 'นำรูปภาพและลิงก์ออกแล้ว (อย่าลืมกด Save Changes)', timer: 2000 });
            }
        });
    } else {
        let pendingIndex = explainImageIndex - existingExplainMedia.length;
        pendingExplainMedia.splice(pendingIndex, 1);
        syncExplainMediaGallery();
    }
}

function syncExplainMediaToHiddenInput() {
    const mediaSet = new Set();
    explainImageArray.forEach(val => {
        const cleanVal = val.trim();
        if (cleanVal !== "") mediaSet.add(cleanVal);
    });
    const finalResult = Array.from(mediaSet).join('///');
    $('#edit-explain-media').val(finalResult);
}
