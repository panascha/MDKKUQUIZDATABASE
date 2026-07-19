// ─────────────────────────────────────────────────────
// JS/CONVERTER.JS
// ─────────────────────────────────────────────────────

$(document).on('blur', '#tableBody .editable-cell', function () {
                const $row = $(this).closest('tr');
                const rowIndex = $row.index();
                const colIndex = $(this).index() - 1; // ลบ 1 ออกเนื่องจากเซลล์ลำดับที่นับอยู่ใน index แรก
                const currentSheet = converterStorage.current;

                if (converterStorage[currentSheet] && converterStorage[currentSheet][rowIndex]) {
                    converterStorage[currentSheet][rowIndex][colIndex] = $(this).text().trim();
                }

                // ประมวลผลวาดสีสถานะใหม่ทันทีหลังเลิกโฟกัสกล่องข้อมูล
                renderPreview();
            });

function resetConverter() {
        Swal.fire({
            title: 'ยืนยันการรีเซ็ต?',
            text: "ข้อมูลที่คุณพิมพ์และผลลัพธ์ในตารางจะถูกล้างทั้งหมด",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'ใช่, ล้างข้อมูล',
            cancelButtonText: 'ยกเลิก'
        }).then((result) => {
            if (result.isConfirmed) {
                // ล้างค่าใน Input ทั้งหมด
                $('#jsonInput').val('');
                $('#yearVal').val('');
                $('#subjID').val('');
                $('#subjName').val('');
                $('#arrayCategoryID').val('');

                // รีเซ็ต cascade picker (edit 2)
                $('#conv-year-select').val('');
                $('#conv-subject-select').html('<option value="">— เลือกชั้นปีก่อน —</option>').prop('disabled', true);
                $('#conv-custom-subject').addClass('d-none');

                // รีเซ็ต exam-group picker (edit 3)
                _convGroupType = '';
                $('#conv-group-batch').val('');
                $('#conv-group-picker .conv-chip').removeClass('active suggested');
                $('#conv-group-custom').addClass('d-none').val('');
                $('#conv-group-round').val('');
                $('#conv-group-hint').addClass('d-none');
                $('#conv-batch-hint').addClass('d-none').empty();
                $('#conv-group-readout').addClass('d-none').empty();
                $('#btn-convert-pdf').removeAttr('data-filename');

                // ล้างข้อมูลใน Storage ชั่วคราว
                converterStorage.struct = [];
                converterStorage.category = [];
                converterStorage.ques = [];
                pageHintMap.clear();
                currentPdfDoc = null;
                extractedImages = [];
                imgAssignments.clear();

                // ซ่อน split layout และล้าง PDF viewer
                const splitEl = document.getElementById('converter-split');
                if (splitEl) splitEl.classList.add('d-none');
                const pdfContainer = document.getElementById('pdf-pages-container');
                if (pdfContainer) pdfContainer.innerHTML = '<p class="text-muted small text-center p-4">ยังไม่ได้โหลด PDF</p>';

                // รีเซ็ตตาราง Preview และ Cards
                renderPreview();
                renderPreviewCards();

                Swal.fire('ล้างข้อมูลแล้ว', '', 'success');
            }
        });
    }

function setupConverterMultiEdit() {
        const $tableBody = $('#tableBody');

        // 1. MOUSE DOWN: เริ่มการเลือก
        $tableBody.on('mousedown', '.editable-cell', function (e) {
            // ถ้าไม่ได้กด Ctrl/Shift ให้ล้างการเลือกเดิม
            if (!e.ctrlKey && !e.shiftKey) {
                $tableBody.find('.editable-cell').removeClass('selected-cell');
            }

            isMouseDown = true;
            startCell = this;
            $(this).addClass('selected-cell').focus();

            // ป้องกันการเลือกข้อความของ Browser
            e.preventDefault();
        });

        // 2. MOUSE OVER: ดำเนินการเลือกเมื่อลาก
        $tableBody.on('mouseover', '.editable-cell', function () {
            if (isMouseDown && startCell) {
                // เลือกเซลล์จาก startCell ถึงเซลล์ปัจจุบัน
                selectRange(startCell, this);
            }
        });

        // 3. MOUSE UP: สิ้นสุดการเลือก (บนเอกสารทั้งหมด)
        $(document).on('mouseup', function () {
            isMouseDown = false;
            startCell = null;
        });

        // 4. KEY DOWN: ใช้ Ctrl + Enter เพื่อ Apply ค่า
        $tableBody.on('keydown', '.editable-cell', function (e) {
            // Apply on Ctrl+Enter (หรือ Cmd+Enter บน Mac)
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                const newValue = $(this).text(); // ได้ค่าปัจจุบันที่พิมพ์อยู่ในเซลล์ที่ Focus
                applySelectionValue(newValue);
                e.preventDefault(); // ป้องกันการขึ้นบรรทัดใหม่
            }
        });

        // 5. คลิกที่อื่น หรือ Tab ไปที่อื่น (Clear Selection)
        $tableBody.on('blur', '.editable-cell', function () {
            // ถ้า focus ออกจาก cell ที่ถูกเลือกทั้งหมด
            setTimeout(() => {
                if (!$tableBody.find('.editable-cell:focus').length) {
                    $tableBody.find('.editable-cell').removeClass('selected-cell');
                }
            }, 10);
        });
    }

function selectRange(start, end) {
        const $tableBody = $('#tableBody');

        // ล้างการเลือกเดิม (ถ้าไม่มี Ctrl/Shift)
        // Note: Logic for Ctrl/Shift is in mousedown, keep only range selection here
        $tableBody.find('.editable-cell').removeClass('selected-cell');

        const $start = $(start);
        const $end = $(end);

        // คำนวณ Index ของ Row (tr) และ Col (td ที่มี class editable-cell)
        const startRow = $start.closest('tr').index();
        const endRow = $end.closest('tr').index();
        const startCol = $start.index();
        const endCol = $end.index();

        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);
        const minCol = Math.min(startCol, endCol);
        const maxCol = Math.max(startCol, endCol);

        // วนลูปและเลือกเซลล์ในขอบเขต
        $tableBody.find('tr').slice(minRow, maxRow + 1).each(function () {
            // editable-cell index เริ่มจาก 1 เพราะ td ตัวแรกเป็น index
            $(this).find('.editable-cell').slice(minCol - 1, maxCol).addClass('selected-cell');
        });

        // Ensure the cell that was last clicked/focused is selected
        $start.addClass('selected-cell');
        $end.addClass('selected-cell');
    }

function applySelectionValue(newValue) {
        const $tableBody = $('#tableBody');
        const $selectedCells = $tableBody.find('.selected-cell');
        const selectedCount = $selectedCells.length;

        if (selectedCount > 1) {
            Swal.fire({
                title: 'ยืนยันการแก้ไขหลายช่อง?',
                text: `คุณกำลังจะกำหนดค่า "${newValue.substring(0, 50)}${newValue.length > 50 ? '...' : ''}" ให้กับ ${selectedCount} ช่องที่เลือก`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'ใช่, แก้ไขทั้งหมด',
                cancelButtonText: 'ยกเลิก'
            }).then((result) => {
                if (result.isConfirmed) {
                    // ใช้ .text() เพื่อ set ค่า
                    $selectedCells.each(function () {
                        $(this).text(newValue);
                    });

                    // ล้างการเลือกหลังจาก Apply ค่า
                    $tableBody.find('.selected-cell').removeClass('selected-cell');
                }
            });
        } else if (selectedCount === 1) {
            // ถ้าเลือกแค่ช่องเดียว แต่กด Ctrl+Enter ให้ล้างการเลือก
            $tableBody.find('.selected-cell').removeClass('selected-cell');
        }
    }

function switchTab(sheet) {
            converterStorage.current = sheet;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.getElementById('tab-' + sheet).classList.add('active');

            // รีเซ็ตปุ่มคัดกรองให้กลับมา "แสดงทั้งหมด"
            $('#converter-filter-bar .btn').removeClass('active');
            $('#converter-filter-bar .btn').first().addClass('active');
            _convStatusFilter = 'ALL';

            renderPreview();
        }

function evaluateRowStatusInBatch(row, i, sheetKey, seenKeys) {
                let status = 'NEW';

                if (sheetKey === 'ques') {
                    const qId = String(row[0] || "").trim();
                    const problem = String(row[1] || "").trim();

                    // ค้นหาข้อมูลซ้ำซ้อนภายในชุดข้อมูลเดียวกันที่กำลังพาสต์ (In-batch duplicate)
                    const batchKey = qId ? qId : problem;
                    if (seenKeys.has(batchKey)) {
                        status = 'DUPLICATE';
                    } else {
                        if (batchKey) seenKeys.add(batchKey);

                        // เปรียบเทียบกับฐานข้อมูลหลัก
                        let match = globalData.questions.find(q => q.questionId === qId);
                        if (!match && problem) {
                            match = globalData.questions.find(q => q.problem.trim() === problem);
                        }

                        if (match) {
                            const norm = (val) => String(val || "").trim();
                            let mCats = match.category || [];
                            let rCats = [];
                            try { rCats = JSON.parse(row[6]); } catch (e) { rCats = [row[6]]; }
                            const catsMatch = JSON.stringify(mCats.sort()) === JSON.stringify(rCats.sort());

                            const isUnchanged =
                                norm(match.problem) === norm(row[1]) &&
                                norm(match.img) === norm(row[2]) &&
                                norm(match.choices) === norm(row[3]) &&
                                norm(match.answer) === norm(row[4]) &&
                                norm(match.explain) === norm(row[5]) &&
                                catsMatch;

                            status = isUnchanged ? 'EXISTING' : 'UPDATED';
                        } else {
                            status = 'NEW';
                        }
                    }
                } else if (sheetKey === 'category') {
                    const catId = String(row[0] || "").trim();
                    if (seenKeys.has(catId)) {
                        status = 'DUPLICATE';
                    } else {
                        if (catId) seenKeys.add(catId);
                        const match = globalData.category.find(c => c.CategoryID === catId);
                        if (match) {
                            const isUnchanged =
                                String(match.SubjectRef || "").trim() === String(row[1] || "").trim() &&
                                String(match.AccordionGroup || "").trim() === String(row[2] || "").trim() &&
                                String(match.CategoryName || "").trim() === String(row[3] || "").trim();
                            status = isUnchanged ? 'EXISTING' : 'UPDATED';
                        } else {
                            status = 'NEW';
                        }
                    }
                } else if (sheetKey === 'struct') {
                    const subjId = String(row[1] || "").trim();
                    const group = String(row[3] || "").trim();
                    const batchKey = subjId + "|" + group;

                    if (seenKeys.has(batchKey)) {
                        status = 'DUPLICATE';
                    } else {
                        if (subjId && group) seenKeys.add(batchKey);
                        const match = globalData.structure.find(s => s.SubjectID === subjId && s.AccordionGroup === group);
                        if (match) {
                            const isUnchanged =
                                String(match.Year || "").trim() === String(row[0] || "").trim() &&
                                String(match.SubjectName || "").trim() === String(row[2] || "").trim();
                            status = isUnchanged ? 'EXISTING' : 'UPDATED';
                        } else {
                            status = 'NEW';
                        }
                    }
                }
                return status;
            }

function getFilteredImportData(sheetKey) {
                const rawData = converterStorage[sheetKey];
                if (!rawData) return [];

                let seenKeys = new Set();
                return rawData.filter((row, i) => {
                    const status = evaluateRowStatusInBatch(row, i, sheetKey, seenKeys);
                    return status === 'NEW' || status === 'UPDATED';
                });
            }

function processAll() {
            let rawInput = document.getElementById('jsonInput').value.trim();
            const year = document.getElementById('yearVal').value;
            const subjectID = document.getElementById('subjID').value.trim().toUpperCase() || "SUBJ";
            const subjectName = document.getElementById('subjName').value || "Untitled Subject";
            const groupKeywords = document.getElementById('groupKeys').value.split(',').map(k => k.trim()).filter(k => k !== "");
            const arrayCategoryID = document.getElementById('arrayCategoryID').value.trim() || null;

            if (!rawInput) {
                Swal.fire('Error', 'กรุณาวางข้อมูลก่อน', 'error');
                return;
            }

            let structMap = new Map();
            let categoryRows = [];
            let quesRows = [];

            converterStorage.struct = [];
            converterStorage.category = [];
            converterStorage.ques = [];
            pageHintMap.clear();

            let initialTab = 'category';
            let inputType = 'structure_only';

            // ฟังก์ชันช่วยวิเคราะห์และลงทะเบียน Category และ Structure ตาม Pattern หลักสูตรแพทย์
            function registerCategoryAndStructure(catKey) {
                if (!catKey) return;
                if (categoryRows.some(row => row[0] === catKey)) return;

                const parts = catKey.split('_');
                let groupName = "";
                let extractedName = catKey; // ค่าเริ่มต้นเป็น ID เต็ม

                if (parts.length === 2) {
                    // ----------------------------------------------------
                    // กฎข้อที่ 1: กลุ่มข้อสอบเก่า (เช่น CVS_51MCQ1, CVS_51LAB)
                    // ----------------------------------------------------
                    extractedName = catKey; // ชื่อหมวดหมู่ตรงกับ CategoryID ทั้งหมด

                    // ตัดตัวเลขปีด้านหน้าออก (เช่น 51MCQ1 -> MCQ1, 51LAB -> LAB) เพื่อใช้ทำ AccordionGroup
                    groupName = parts[1].replace(/^\d+/, '');
                } else if (parts.length >= 3) {
                    // ----------------------------------------------------
                    // กฎข้อที่ 2: กลุ่มหัวข้อวิชาบรรยาย (เช่น CVS_PHYSIO_Arterial & Venous systems)
                    // ----------------------------------------------------
                    // ดึงเฉพาะชื่อหัวข้อด้านหลังสุดมาทำ CategoryName
                    extractedName = parts.slice(2).join('_');

                    // จับคู่วิชาย่อยกับ AccordionGroup
                    const upperSubgroup = parts[1].toUpperCase();
                    if (upperSubgroup === "ANA") {
                        groupName = "ANATOMY";
                    } else if (upperSubgroup === "PHYSIO" || upperSubgroup === "PHY" || upperSubgroup === "BIOCHEM") {
                        groupName = "PHYSIO and BIOCHEM";
                    } else if (upperSubgroup === "PARASITO" || upperSubgroup === "MICRO") {
                        groupName = "PARASITO and MICRO";
                    } else if (upperSubgroup === "PATHO") {
                        groupName = "PATHO";
                    } else if (upperSubgroup === "PHARM" || upperSubgroup === "PHARMACO") {
                        groupName = "PHARM";
                    } else if (upperSubgroup === "RADIO" || upperSubgroup === "IMAGE" || upperSubgroup === "CLINICAL") {
                        groupName = "RADIO and CLINICAL";
                    } else {
                        groupName = parts[1]; // ใช้ตัวเลือกค่าเดิมในส่วนที่ 2 กรณีไม่ตรงเงื่อนไขข้างต้น
                    }
                } else {
                    // กรณีไม่มีตัวเชื่อมย่อย
                    extractedName = catKey;
                    groupName = "GENERAL";
                }

                const fullGroup = `${subjectID} ${groupName}`;
                const structKey = `${subjectID}-${fullGroup}`;

                if (!structMap.has(structKey)) {
                    structMap.set(structKey, [year, subjectID, subjectName, fullGroup]);
                }

                categoryRows.push([catKey, subjectID, fullGroup, extractedName]);
            }

            try {
                if (rawInput.startsWith('[') && rawInput.endsWith(']')) {
                    // ********************************************************************
                    // CASE 3: QUESTION ARRAY
                    // ********************************************************************
                    initialTab = 'ques';
                    inputType = 'full';
                    if (!arrayCategoryID) {
                        Swal.fire('Error', 'กรุณาระบุ Category ID สำหรับชุดคำถามนี้ในช่องสีแดง "ใส่ชื่อหัวข้อ"', 'error');
                        return;
                    }

                    let questionsArray;
                    try { questionsArray = JSON.parse(rawInput); } catch (e) { questionsArray = new Function("return " + rawInput)(); }

                    const categoryKey = arrayCategoryID;
                    registerCategoryAndStructure(categoryKey);

                    questionsArray.forEach((q, index) => {
                        const qId = `${categoryKey}_${index + 1}`;
                        let qCats = [categoryKey];
                        if (q.category) {
                            if (Array.isArray(q.category)) {
                                qCats = q.category;
                            } else {
                                try {
                                    let parsed = JSON.parse(q.category.replace(/'/g, '"'));
                                    if (Array.isArray(parsed)) qCats = parsed;
                                } catch (e) { qCats = [q.category]; }
                            }
                        }
                        qCats.forEach(cat => registerCategoryAndStructure(cat));
                        quesRows.push([qId, q.problem || "", q.img || "", q.choices || "", q.answer || "", q.explain || "", JSON.stringify(qCats)]);
                    });

                } else if (rawInput.includes('{') && rawInput.includes('}')) {
                    // ********************************************************************
                    // CASE 2: QUIZ DATA (JSON Object)
                    // ********************************************************************
                    initialTab = 'ques';
                    inputType = 'full';
                    const firstBrace = rawInput.indexOf('{');
                    const lastBrace = rawInput.lastIndexOf('}');
                    const jsonString = rawInput.substring(firstBrace, lastBrace + 1);
                    let quizObj;
                    try { quizObj = new Function("return " + jsonString)(); } catch (e) { quizObj = JSON.parse(jsonString); }

                    for (const [categoryKey, questions] of Object.entries(quizObj)) {
                        registerCategoryAndStructure(categoryKey);
                        if (Array.isArray(questions)) {
                            questions.forEach((q, index) => {
                                const qId = `${categoryKey}_${index + 1}`;
                                let qCats = [categoryKey];
                                if (q.category) {
                                    if (Array.isArray(q.category)) {
                                        qCats = q.category;
                                    } else {
                                        try {
                                            let parsed = JSON.parse(q.category.replace(/'/g, '"'));
                                            if (Array.isArray(parsed)) qCats = parsed;
                                        } catch (e) { qCats = [q.category]; }
                                    }
                                }
                                qCats.forEach(cat => registerCategoryAndStructure(cat));
                                quesRows.push([qId, q.problem || "", q.img || "", q.choices || "", q.answer || "", q.explain || "", JSON.stringify(qCats)]);
                            });
                        }
                    }
                } else {
                    // ********************************************************************
                    // CASE 1: CATEGORY LIST (Text List)
                    // ********************************************************************
                    initialTab = 'category';
                    inputType = 'structure_only';
                    const lines = rawInput.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    lines.forEach(categoryKey => {
                        registerCategoryAndStructure(categoryKey);
                    });
                }

                converterStorage.struct = Array.from(structMap.values());
                converterStorage.category = categoryRows;
                converterStorage.ques = quesRows;

                Swal.fire('Success', 'ประมวลผลสำเร็จ!', 'success');
                document.getElementById('converter-split').classList.remove('d-none');
                switchTab(initialTab);

            } catch (e) {
                console.error(e);
                Swal.fire('Error', 'Format ข้อมูลผิดพลาด: ' + e.message, 'error');
            }
        }

function renderPreview() {
    const body = document.getElementById('cardsBody');
    if (!body) return;
    const currentSheet = converterStorage.current;
    const data = converterStorage[currentSheet] || [];

    const colorMap  = { NEW: 'success', UPDATED: 'warning', DUPLICATE: 'danger', EXISTING: 'secondary' };
    const textMap   = { NEW: 'NEW', UPDATED: 'UPDATE', DUPLICATE: 'DUP', EXISTING: 'EXIST' };
    const borderMap = { NEW: ' border-success', UPDATED: ' border-warning', DUPLICATE: ' border-danger', EXISTING: '' };

    let seenKeys = new Set();
    let counts = { ALL: 0, NEW: 0, UPDATED: 0, DUPLICATE: 0, EXISTING: 0 };
    const searchIndex = [];

    const cardsHtml = data.map((row, i) => {
        const status = evaluateRowStatusInBatch(row, i, currentSheet, seenKeys);
        counts.ALL++;
        counts[status] = (counts[status] || 0) + 1;

        // full-text haystack from the underlying row (NOT the truncated DOM text)
        searchIndex.push((currentSheet === 'ques'
            ? `${row[1] || ''} ${row[3] || ''} ${row[4] || ''} ${row[6] || ''}`
            : row.join(' ')).toLowerCase());

        const color  = colorMap[status] || 'secondary';
        const border = borderMap[status] || '';

        // Apply require_img filter (ques tab only)
        const requireImg = currentSheet === 'ques' && String(row[2]).trim() === 'require_img';
        const hidden = _filterRequireImg && currentSheet === 'ques' && !requireImg;

        let cardInner = '';

        if (currentSheet === 'struct') {
            // row: [Year, SubjectID, SubjectName, AccordionGroup]
            cardInner = `<div class="d-flex align-items-center gap-2">
              <span class="badge bg-${color} flex-shrink-0">${textMap[status]}</span>
              <span class="badge bg-secondary flex-shrink-0">#${i + 1}</span>
              <div>
                <div class="fw-semibold small">${row[1]} — ${row[2]}</div>
                <div class="text-muted" style="font-size:0.78rem">${row[0]} · ${row[3]}</div>
              </div>
            </div>`;
        } else if (currentSheet === 'category') {
            // row: [CategoryID, SubjectRef, AccordionGroup, CategoryName]
            cardInner = `<div class="d-flex align-items-center gap-2">
              <span class="badge bg-${color} flex-shrink-0">${textMap[status]}</span>
              <span class="badge bg-secondary flex-shrink-0">#${i + 1}</span>
              <div>
                <div class="fw-semibold small">${row[3] || row[0]}</div>
                <div class="text-muted" style="font-size:0.78rem">${row[0]} · ${row[1]} · ${row[2]}</div>
              </div>
            </div>`;
        } else {
            // ques row: [QuestionID, Problem, Image, Choices, Answer, Explanation, Category]
            const assignments = imgAssignments.get(i) || [];
            let cats = [];
            try { cats = JSON.parse(row[6]); } catch (e) { if (row[6]) cats = [row[6]]; }
            const catBadges = cats.map(c =>
                `<span class="badge bg-info text-dark me-1" style="font-size:0.68rem">${c}</span>`).join('');
            const choices = String(row[3] || '').split('///').map((c, ci) =>
                `<div class="text-muted" style="font-size:0.78rem">${String.fromCharCode(65 + ci)}. ${c}</div>`
            ).join('');

            // คำอธิบาย (row[5]) — ตัดที่ ~200 ตัวอักษร + ปุ่มดูเพิ่ม, escape กัน HTML แตก
            const explainRaw = String(row[5] || '').trim();
            let explainHtml = '';
            if (explainRaw) {
                const CAP = 200;
                explainHtml = explainRaw.length > CAP
                    ? `<div class="conv-explain text-muted">
                         <span class="conv-explain-short">${_convEsc(explainRaw.substring(0, CAP))}…</span>
                         <span class="conv-explain-full d-none">${_convEsc(explainRaw)}</span>
                         <a href="javascript:void(0)" class="conv-explain-toggle" onclick="event.stopPropagation();toggleConvExplain(this)">ดูเพิ่ม</a>
                       </div>`
                    : `<div class="conv-explain text-muted">${_convEsc(explainRaw)}</div>`;
            }

            let imgArea = '';
            if (requireImg) {
                const assignedHtml = assignments.map((a, ai) =>
                    `<div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
                       <img src="${a.base64 || ''}" style="max-height:50px;border-radius:4px;cursor:pointer" onclick="viewFullImage(this.src)">
                       <span class="badge bg-${a.status === 'Ready' ? 'success' : a.status === 'Failed' ? 'danger' : 'secondary'}">${a.status}</span>
                       <button class="btn btn-xs btn-outline-danger" onclick="removeAssignment(${i}, ${ai})">✕</button>
                     </div>`
                ).join('');
                imgArea = `<div class="image-assign-area mt-1">
                  <div class="d-flex gap-2 flex-wrap">
                    <button class="btn btn-sm btn-outline-warning py-0" onclick="openTrayPicker(${i})">
                      <i class="fas fa-images me-1"></i>เลือกจากคลัง${assignments.length > 0 ? ` (${assignments.length})` : ''}
                    </button>
                    <label class="btn btn-sm btn-outline-secondary py-0 mb-0">
                      <i class="fas fa-upload me-1"></i>อัปโหลดรูป
                      <input type="file" accept="image/*" class="d-none" onchange="uploadImageForCard(${i}, this)">
                    </label>
                  </div>
                  ${assignedHtml}
                </div>`;
            }

            cardInner = `<div class="d-flex gap-2">
              <div class="flex-shrink-0 text-center" style="min-width:44px">
                <span class="badge bg-${color}">${textMap[status]}</span><br>
                <span class="badge bg-secondary">#${i + 1}</span>
                ${requireImg ? '<br><span class="badge bg-warning text-dark mt-1" style="font-size:0.6em">รูปภาพ</span>' : ''}
                <br><button class="btn btn-xs btn-outline-primary mt-1 py-0 px-1" onclick="openConverterEditModal(${i})" title="แก้ไขข้อสอบ"><i class="fas fa-pen"></i></button>
              </div>
              <div class="flex-grow-1 min-w-0">
                <p class="mb-1" style="font-size:0.82rem">${String(row[1] || '').substring(0, 300)}</p>
                <div class="mb-1">${choices}</div>
                <div class="mb-1 small text-success fw-semibold">✓ ${row[4] || ''}</div>
                ${explainHtml}
                <div>${catBadges}</div>
                ${imgArea}
              </div>
            </div>`;
        }

        return `<div class="card mb-2 conv-card${border}"
                     data-status="${status}"
                     data-require-img="${requireImg}"
                     tabindex="${currentSheet === 'ques' ? '0' : '-1'}"
                     ${currentSheet === 'ques' ? `onfocus="onConverterCardFocus(${i})" onclick="onConverterCardFocus(${i})"` : ''}
                     ${hidden ? 'style="display:none"' : ''}>
          <div class="card-body py-2 px-3">${cardInner}</div>
        </div>`;
    }).join('');

    body.innerHTML = cardsHtml || '<p class="text-muted small text-center p-3 mb-0">ยังไม่มีข้อมูล</p>';
    _convCardSearch = searchIndex;

    $('#count-all').text(counts.ALL);
    $('#count-new').text(counts.NEW);
    $('#count-updated').text(counts.UPDATED);
    $('#count-duplicate').text(counts.DUPLICATE);
    $('#count-existing').text(counts.EXISTING);

    document.getElementById('previewText').innerText = `มีข้อมูลทั้งหมด ${data.length} แถว`;

    applyConverterFilters(); // single source of truth for card visibility (status + require_img + search)
}

function filterConverterTable(status, btn) {
    $('#converter-filter-bar .btn').removeClass('active');
    $(btn).addClass('active');
    _convStatusFilter = status;
    applyConverterFilters();
}

// Live search box handler
function onConverterSearch(val) {
    _convSearchText = val;
    applyConverterFilters();
}

// Single source of truth for card visibility: status filter + require_img filter + text search
function applyConverterFilters() {
    const search = (_convSearchText || '').trim().toLowerCase();
    const onQues = converterStorage.current === 'ques';
    let visible = 0;
    document.querySelectorAll('#cardsBody .conv-card').forEach((card, idx) => {
        const statusOk = _convStatusFilter === 'ALL' || card.getAttribute('data-status') === _convStatusFilter;
        const imgOk = !(_filterRequireImg && onQues) || card.getAttribute('data-require-img') === 'true';
        const hay = _convCardSearch[idx] != null ? _convCardSearch[idx] : card.textContent.toLowerCase();
        const searchOk = !search || hay.includes(search);
        const show = statusOk && imgOk && searchOk;
        card.style.display = show ? '' : 'none';
        if (show) visible++;
    });
    const countEl = document.getElementById('converter-search-count');
    if (countEl) countEl.textContent =
        (search || _filterRequireImg || _convStatusFilter !== 'ALL') ? `${visible} ข้อ` : '';
}

// สลับดูคำอธิบายเต็ม/ย่อ บนการ์ดข้อสอบ (edit 6)
function toggleConvExplain(link) {
    const wrap = link.closest('.conv-explain');
    if (!wrap) return;
    const fullHidden = wrap.querySelector('.conv-explain-full').classList.toggle('d-none');
    wrap.querySelector('.conv-explain-short').classList.toggle('d-none', !fullHidden);
    link.textContent = fullHidden ? 'ดูเพิ่ม' : 'ย่อ';
}

// Focus/click a question card → scroll the left PDF pane to its source page (pageHint)
function onConverterCardFocus(i) {
    focusedRowIndex = i;
    scrollPdfToQuestion(i);
}

function scrollPdfToQuestion(rowIndex) {
    const page = pageHintMap.get(rowIndex);
    if (!page) return; // manual import / no pageHint → nothing to scroll
    const container = document.getElementById('pdf-pages-container');
    const panel = document.querySelector('.pdf-viewer-panel');
    if (!container || !panel) return;
    const canvas = container.children[page - 1]; // canvases are ordered 1:1 with PDF pages
    if (!canvas) return; // hallucinated page number — bail safely

    const header = panel.querySelector('.pdf-viewer-header');
    const headerH = header ? header.offsetHeight : 0;
    const delta = canvas.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    panel.scrollTo({ top: panel.scrollTop + delta - headerH - 6, behavior: 'smooth' });

    canvas.classList.add('pdf-page-active');
    clearTimeout(_pdfHlTimer);
    _pdfHlTimer = setTimeout(() => canvas.classList.remove('pdf-page-active'), 1500);
}

function copyCurrentSheet() {
    const data = converterStorage[converterStorage.current] || [];
    const text = data.map(row => row.join('\t')).join('\n');
    navigator.clipboard.writeText(text);
    Swal.fire('Copied', 'คัดลอกข้อมูล (TSV) เรียบร้อยแล้ว', 'success');
}

async function importConvertedData() {
            if (!confirmAdmin()) return;

            // ถ้ามีรูปที่ assign ไว้ ให้อัปโหลดก่อน
            const pendingUploads = [];
            imgAssignments.forEach((entries, rowIndex) => {
                if (entries.some(e => e.status !== 'Ready')) pendingUploads.push(rowIndex);
            });
            if (pendingUploads.length > 0) {
                $('#loading-overlay').fadeIn(200).css('display', 'flex').find('h5').text('กำลังอัปโหลดรูปภาพ…');
                await startUploadQueue(({ done, failed, total }) => {
                    const finished = done + failed;
                    const failText = failed > 0 ? ` (ล้มเหลว ${failed})` : '';
                    $('#loading-overlay').find('h5').text(`กำลังอัปโหลดรูปภาพ… ${finished}/${total}`);
                    $('#loading-overlay').find('p').text(`อัปโหลดสำเร็จ ${done} จาก ${total} รูป${failText}`);
                });
                // คืนข้อความเดิม กัน overlay รอบถัดไปโชว์ตัวเลขค้าง
                $('#loading-overlay').find('p').text('กรุณารอสักครู่');
                // ตรวจว่ายังมีที่ล้มเหลวอยู่ไหม
                let failedCount = 0;
                imgAssignments.forEach(entries => { entries.forEach(e => { if (e.status === 'Failed') failedCount++; }); });
                if (failedCount > 0) {
                    $('#loading-overlay').hide();
                    const cont = await Swal.fire({
                        icon: 'warning',
                        title: `อัปโหลดรูปล้มเหลว ${failedCount} รูป`,
                        text: 'ต้องการบันทึกข้อมูลที่ไม่มีรูปต่อไปหรือไม่?',
                        showCancelButton: true,
                        confirmButtonText: 'บันทึกต่อ',
                        cancelButtonText: 'ยกเลิก'
                    });
                    if (!cont.isConfirmed) return;
                }
            }

            // Patch img field ใน converterStorage.ques ด้วย Drive URL ก่อน import
            imgAssignments.forEach((entries, rowIndex) => {
                if (converterStorage.ques[rowIndex]) {
                    const urls = entries.filter(e => e.status === 'Ready' && e.url).map(e => e.url);
                    if (urls.length > 0) converterStorage.ques[rowIndex][2] = urls.join('///');
                else converterStorage.ques[rowIndex][2] = '';
                }
            });

            const sheetsToProcess = [
                { name: 'Structure', key: 'struct' },
                { name: 'Category', key: 'category' },
                { name: 'Questions', key: 'ques' }
            ];

            let totalNew = 0;
            let totalSkipped = 0;
            let importLog = "";

            const isConfirmed = await Swal.fire({
                title: 'ยืนยันการนำเข้าข้อมูล?',
                text: `ระบบจะกรองนำเข้าเฉพาะข้อมูลใหม่และข้อมูลที่มีการอัปเดตเท่านั้น โดยข้อมูลที่ซ้ำซ้อนหรือเหมือนเดิมจะถูกข้ามให้แบบอัตโนมัติ`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'ใช่, เริ่มนำเข้า'
            });

            if (!isConfirmed.isConfirmed) return;

            $('#loading-overlay').fadeIn(200).css('display', 'flex').find('h5').text('กำลังนำเข้าข้อมูล...');

            try {
                for (const sheet of sheetsToProcess) {
                    const dataToImport = getFilteredImportData(sheet.key);

                    if (dataToImport.length > 0) {
                        try {
                            const resJson = await sendWithRetry({
                                action: 'adminImport',
                                username: currentUser.username,
                                adminPass: adminPass,
                                data: {
                                    sheetName: sheet.key,
                                    data: dataToImport
                                }
                            });

                            if (resJson.result === 'success') {
                                totalNew += (resJson.count || 0);
                                totalSkipped += (resJson.skipped || 0);
                                const addedLine = resJson.added != null
                                    ? `เพิ่ม ${resJson.added}, อัปเดต ${resJson.updated}`
                                    : `เพิ่ม/อัปเดต ${resJson.count} แถว (ซ้ำ ${resJson.skipped || 0})`;
                                importLog += `• ${sheet.name}: ${addedLine}\n`;
                            } else {
                                console.error(`Error importing ${sheet.name}:`, resJson.message);
                            }
                        } catch (fetchErr) {
                            console.error(`Error importing ${sheet.name}:`, fetchErr);
                            throw fetchErr;
                        }
                    }
                }

                $('#loading-overlay').hide();
                handleSaveResult({ result: 'success', count: totalNew, importLog });

            } catch (err) {
                $('#loading-overlay').hide();
                Swal.fire('Error', 'การ Import ขัดข้อง: ' + err.message, 'error');
            }
        }

// ─── PDF Converter additions ───────────────────────────────────────────────

// Side-maps (module-level, shared with extractor.js / queue.js / gemini.js)
let imgAssignments = new Map(); // key: rowIndex (number), value: {base64, fileId, url, status, page}
let extractedImages = [];       // [{base64, width, height, page, source, assignedTo}]
let selectedTrayIndex = null;   // currently highlighted image (keyboard shortcut path)
let focusedRowIndex = null;     // currently focused preview row (for keyboard shortcut)
let currentPdfDoc = null;       // loaded pdfjsLib document
let pageHintMap = new Map();    // key: rowIndex, value: pageHint from Gemini (avoids polluting row array)
let _filterRequireImg = false;  // filter state for card view
let _pickerTargetRow = null;    // which question the image picker modal is targeting
let _convStatusFilter = 'ALL';  // active status filter (ALL/NEW/UPDATED/DUPLICATE/EXISTING)
let _convSearchText = '';       // live search text over the card list
let _convCardSearch = [];       // per-card full-text haystack (aligned to card DOM order — full row, not truncated)
let _pdfHlTimer = null;         // highlight-flash timer for the synced PDF page

// ─── Edit 2: Year→Subject cascade picker ──────────────────────────────────
// เขียนค่าลงช่องเดิม #yearVal/#subjID/#subjName เสมอ — pipeline (processAll/runGeminiConversion) ไม่ต้องแก้

function setConvSubjectMirror(year, id, name) {
    document.getElementById('yearVal').value = year;
    document.getElementById('subjID').value = id;
    document.getElementById('subjName').value = name;
    if (typeof updateConvGroupReadout === 'function') updateConvGroupReadout();
}

// เรียกจาก app.js หลังโหลด globalData.structure เสร็จ
function populateConverterSubjectPicker() {
    const yearSel = document.getElementById('conv-year-select');
    if (!yearSel || typeof globalData !== 'object' || !Array.isArray(globalData.structure)) return;
    const prev = yearSel.value;
    const years = [...new Set(globalData.structure.map(s => String(s.Year).trim()).filter(y => y !== ''))]
        .sort((a, b) => Number(a) - Number(b));
    yearSel.innerHTML = '<option value="">— เลือกชั้นปี —</option>' +
        years.map(y => `<option value="${_convEsc(y)}">ปี ${_convEsc(y)}</option>`).join('') +
        '<option value="__other__">อื่นๆ (พิมพ์เอง)</option>';
    if (prev && [...yearSel.options].some(o => o.value === prev)) yearSel.value = prev;
}

function onConvYearChange(year) {
    const subjSel = document.getElementById('conv-subject-select');
    const customDiv = document.getElementById('conv-custom-subject');
    if (year === '__other__') {
        subjSel.innerHTML = '<option value="">—</option>';
        subjSel.disabled = true;
        customDiv.classList.remove('d-none'); // ช่องเดิมโชว์ค่าปัจจุบัน — ผู้ใช้พิมพ์ทับเองได้
        return;
    }
    customDiv.classList.add('d-none');
    if (!year) {
        subjSel.innerHTML = '<option value="">— เลือกชั้นปีก่อน —</option>';
        subjSel.disabled = true;
        setConvSubjectMirror('', '', '');
        return;
    }
    const seen = new Set();
    const subjects = globalData.structure.filter(s =>
        String(s.Year).trim() === year && !seen.has(s.SubjectID) && !!seen.add(s.SubjectID));
    subjSel.innerHTML = '<option value="">— เลือกวิชา —</option>' +
        subjects.map(s =>
            `<option value="${_convEsc(s.SubjectID)}" data-name="${_convEsc(s.SubjectName)}" data-year="${_convEsc(String(s.Year).trim())}">${_convEsc(s.SubjectID)} — ${_convEsc(s.SubjectName)}</option>`
        ).join('') +
        '<option value="__other__">อื่นๆ (พิมพ์เอง)</option>';
    subjSel.disabled = false;
    setConvSubjectMirror('', '', ''); // เปลี่ยนปี → ล้างวิชาเก่าที่ mirror ค้าง
}

function onConvSubjectChange(val) {
    const subjSel = document.getElementById('conv-subject-select');
    const customDiv = document.getElementById('conv-custom-subject');
    if (val === '__other__') {
        customDiv.classList.remove('d-none');
        return;
    }
    customDiv.classList.add('d-none');
    if (!val) { setConvSubjectMirror('', '', ''); return; }
    const opt = subjSel.options[subjSel.selectedIndex];
    setConvSubjectMirror(opt.dataset.year || '', val, opt.dataset.name || '');
}

// ─── Edit 3: Exam-group picker (chips + round + auto-detect) ───────────────

let _convGroupType = ''; // '', 'MCQ'/'FMT'/'QUIZ'/'LAB', หรือ '__custom__'

function pickConvGroup(btn) {
    const group = btn.dataset.group;
    const wasActive = btn.classList.contains('active');
    document.querySelectorAll('#conv-group-picker .conv-chip').forEach(b => b.classList.remove('active', 'suggested'));
    const customInput = document.getElementById('conv-group-custom');
    const hintEl = document.getElementById('conv-group-hint');
    if (hintEl) hintEl.classList.add('d-none'); // ผู้ใช้เลือกเอง → เคลียร์คำใบ้ auto-detect

    if (wasActive) { // กดซ้ำ = ยกเลิก → กลับไปเดาจากชื่อไฟล์
        _convGroupType = '';
        customInput.classList.add('d-none');
        return;
    }
    btn.classList.add('active');
    _convGroupType = group;
    customInput.classList.toggle('d-none', group !== '__custom__');
    if (group === '__custom__') customInput.focus();
    updateConvGroupReadout();
}

// แสดงให้ผู้ใช้เห็นชื่อไฟล์ + กลุ่มข้อสอบที่จะบันทึกจริง รูปแบบ <subjectid>_<exam><ครั้ง>
// subjectid มาจาก #conv-subject-select (mirror ลง #subjID); กลุ่ม = ชิปที่เลือก/ตรวจพบ ไม่งั้นเดาจากชื่อไฟล์
function updateConvGroupReadout() {
    const el = document.getElementById('conv-group-readout');
    if (!el) return;
    const filename = (document.getElementById('btn-convert-pdf').dataset.filename || '').trim();
    if (!filename) { el.classList.add('d-none'); el.textContent = ''; return; }

    const subjId = (document.getElementById('subjID').value || '').trim().toUpperCase();
    const eff = getEffectiveExamGroup(filename);
    const picked = (typeof getPickedExamGroup === 'function') ? getPickedExamGroup() : '';
    const group = eff.group;
    const src = picked ? 'เลือก/ตรวจพบ' : (eff.forced ? 'ชื่อไฟล์ + รุ่นที่กรอก' : 'เดาจากชื่อไฟล์');

    const catId = subjId ? `${subjId}_${group}` : group;
    let warn = subjId ? '' : ' <span class="text-warning">— เลือกวิชาก่อนเพื่อได้รหัสเต็ม</span>';
    // ไม่มีเลขรุ่นนำหน้ากลุ่ม = ข้อสอบคนละปีจะไปกองรวมกัน
    if (group && !/^\d/.test(group)) warn += ' <span class="text-warning">— ยังไม่ได้ใส่รุ่น/ปีข้อสอบ</span>';
    el.innerHTML = `<i class="fas fa-tag me-1"></i>ไฟล์: <b>${_convEsc(filename)}</b> · กลุ่มที่จะบันทึก: <b>${_convEsc(catId)}</b> <span class="text-muted">(${src})</span>${warn}`;
    el.classList.remove('d-none');
}

// รุ่น/ปีข้อสอบที่ผู้ใช้กรอก เช่น "52" — '' ถ้าเว้นว่าง (ไม่บังคับ)
function getConvBatch() {
    const el = document.getElementById('conv-group-batch');
    return el ? el.value.replace(/\D/g, '') : '';
}

// ผู้ใช้พิมพ์เอง = hint ที่ตรวจพบล้าสมัยแล้ว ซ่อนทิ้ง
function onConvBatchInput() {
    const hintEl = document.getElementById('conv-batch-hint');
    if (hintEl) { hintEl.classList.add('d-none'); hintEl.textContent = ''; }
    updateConvGroupReadout();
}

// คืน examGroup ที่ผู้ใช้เลือก เช่น "52MCQ2" — '' ถ้าไม่ได้เลือก (ให้เดาจากชื่อไฟล์แทน)
function getPickedExamGroup() {
    const batch = getConvBatch();
    if (_convGroupType === '__custom__') {
        const v = document.getElementById('conv-group-custom').value.trim().replace(/\s+/g, '');
        return v ? batch + v.toUpperCase() : '';
    }
    if (!_convGroupType) return '';
    const round = document.getElementById('conv-group-round').value;
    return batch + _convGroupType + (round || '');
}

// อ่านข้อความ ~2 หน้าแรกครั้งเดียว ใช้ร่วมกันทั้ง detect TYPE และ detect รุ่น
async function _readPdfHeadText(pdfDoc) {
    let text = '';
    const maxPage = Math.min(2, pdfDoc.numPages);
    for (let p = 1; p <= maxPage; p++) {
        const tc = await (await pdfDoc.getPage(p)).getTextContent();
        text += tc.items.map(it => it.str).join(' ') + ' ';
    }
    return text;
}

function classifyExamType(text) {
    if (/formative|\bFMT\b/i.test(text)) return 'FMT';
    if (/laborator|\blab\b|ปฏิบัติการ/i.test(text)) return 'LAB';
    if (/multiple\s*choice|\bMCQ\b|ปรนัย/i.test(text)) return 'MCQ';
    return null;
}

// เดาเลขรุ่นจากข้อความ: "รุ่น 52", "แพทย์รุ่นที่ 52", "MD52" — ไม่แปลงปี พ.ศ./ค.ศ. เป็นรุ่น
function classifyExamBatch(text) {
    const m = text.match(/(?:รุ่น\s*(?:ที่\s*)?|\bMD\s*)(\d{2})(?!\d)/i);
    return m ? m[1] : null;
}

// เดาเลขรุ่นจากชื่อไฟล์: "(MD49) …" หรือส่วนกลุ่มข้อสอบที่ขึ้นต้นด้วยเลข เช่น CVS_51MCQ1.pdf
function guessBatchFromFilename(filename) {
    if (!filename) return null;
    const md = filename.match(/\(\s*MD\s*(\d{2})\s*\)/i);
    if (md) return md[1];
    if (typeof parseFilenameMetadata !== 'function') return null;
    const g = (parseFilenameMetadata(filename).examGroup || '').match(/^(\d{2})(?!\d)/);
    return g ? g[1] : null;
}

// กลุ่มข้อสอบที่จะบันทึกจริง: ชิปที่เลือกมาก่อน ถ้าไม่ได้เลือกก็เดาจากชื่อไฟล์ แล้วเติมเลขรุ่นให้ถ้ายังไม่มี
// คืน { group, forced } — forced=true คือให้ทับ category[0] ที่ Gemini เขียนมา
function getEffectiveExamGroup(filename) {
    const picked = (typeof getPickedExamGroup === 'function') ? getPickedExamGroup() : '';
    if (picked) return { group: picked, forced: true };

    const guessed = (typeof parseFilenameMetadata === 'function' && filename)
        ? (parseFilenameMetadata(filename).examGroup || '') : '';
    const batch = getConvBatch();
    // มีเลขรุ่นแต่ชื่อไฟล์ไม่มีปีนำหน้า → เติมให้ ไม่งั้นปีข้อสอบจะหายไปจาก category
    if (guessed && batch && !/^\d/.test(guessed)) return { group: batch + guessed, forced: true };
    return { group: guessed, forced: false };
}

// Auto-detect TYPE + รุ่น จากข้อความ ~2 หน้าแรก (suggest-only) — ไม่มี text layer = ไม่เดา, round ไม่เดาเสมอ
async function detectExamMeta(pdfDoc) {
    try {
        const text = await _readPdfHeadText(pdfDoc);
        if (!text.trim()) return { type: null, batch: null };
        return { type: classifyExamType(text), batch: classifyExamBatch(text) };
    } catch (e) {
        return { type: null, batch: null }; // detect พังต้องไม่ล้มการโหลด PDF
    }
}

async function detectExamGroupType(pdfDoc) {
    return (await detectExamMeta(pdfDoc)).type;
}

// เติมเลขรุ่นให้อัตโนมัติ — เติมเฉพาะตอนช่องยังว่าง (ห้ามทับสิ่งที่ผู้ใช้พิมพ์เอง)
function applyDetectedBatch(batch, src) {
    if (!batch) return;
    const el = document.getElementById('conv-group-batch');
    if (!el || el.value.trim()) return;
    el.value = batch;
    const hintEl = document.getElementById('conv-batch-hint'); // แยกจาก #conv-group-hint กันเขียนทับกัน
    if (hintEl) {
        hintEl.textContent = `ตรวจพบรุ่น: ${batch} (จาก${src} — แก้ได้)`;
        hintEl.classList.remove('d-none');
    }
    updateConvGroupReadout();
}

function applyDetectedGroup(type) {
    if (_convGroupType) return; // ผู้ใช้เลือกไว้แล้ว — ห้ามทับ
    const btn = document.querySelector(`#conv-group-picker .conv-chip[data-group="${type}"]`);
    if (!btn) return;
    document.querySelectorAll('#conv-group-picker .conv-chip').forEach(b => b.classList.remove('active', 'suggested'));
    btn.classList.add('active', 'suggested');
    _convGroupType = type;
    const hintEl = document.getElementById('conv-group-hint');
    if (hintEl) { hintEl.textContent = `ตรวจพบ: ${type} (แก้ได้ — กดชิปเพื่อเปลี่ยน/ยกเลิก)`; hintEl.classList.remove('d-none'); }
    updateConvGroupReadout();
}

// ─── PDF drop/file handling ────────────────────────────────────────────────

function handlePDFDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') handlePDFFile(file);
}

async function handlePDFFile(file) {
    if (!file) return;
    const btn = document.getElementById('btn-convert-pdf');
    const statusEl = document.getElementById('pdf-status');
    btn.disabled = true;

    // Edit 4: 50MB hard cap
    if (file.size > 50 * 1024 * 1024) {
        statusEl.textContent = '';
        Swal.fire('ไฟล์ใหญ่เกินไป',
            `PDF ขนาด ${(file.size / 1024 / 1024).toFixed(1)}MB — ระบบรับได้สูงสุด 50MB กรุณาแบ่งไฟล์ก่อน`, 'error');
        return;
    }

    statusEl.textContent = `โหลด PDF: ${file.name}…`;

    // Edit 4: กัน PDF เสีย/ใส่รหัสผ่าน/ไม่ใช่ PDF จริง
    try {
        const arrayBuffer = await file.arrayBuffer();
        currentPdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    } catch (e) {
        currentPdfDoc = null;
        statusEl.textContent = '';
        const msg = (e && e.name === 'PasswordException')
            ? 'PDF นี้ถูกใส่รหัสผ่านไว้ — กรุณาปลดรหัสผ่านก่อนอัปโหลด'
            : 'ไฟล์อาจเสียหายหรือไม่ใช่ PDF จริง — ลองเปิดไฟล์ในเครื่องตรวจดูก่อน';
        Swal.fire('เปิด PDF ไม่สำเร็จ', msg, 'error');
        return;
    }

    if (!currentPdfDoc.numPages) {
        currentPdfDoc = null;
        statusEl.textContent = '';
        Swal.fire('PDF ว่างเปล่า', 'ไฟล์นี้ไม่มีหน้าเอกสารเลย', 'error');
        return;
    }
    if (currentPdfDoc.numPages > 80) {
        const n = currentPdfDoc.numPages;
        currentPdfDoc = null;
        statusEl.textContent = '';
        Swal.fire('PDF ยาวเกินไป', `${n} หน้า — ระบบรับได้สูงสุด 80 หน้า กรุณาแบ่งไฟล์ก่อน`, 'error');
        return;
    }

    window._pdfFile = file; // preserve raw File for inline-PDF Gemini call
    btn.dataset.filename = file.name;
    applyDetectedBatch(guessBatchFromFilename(file.name), 'ชื่อไฟล์'); // เดารุ่นจากชื่อไฟล์ทันที
    updateConvGroupReadout(); // แสดงชื่อไฟล์ + กลุ่มที่เดาไว้ทันที (แม้ detect จะยังไม่เสร็จ/ล้มเหลว)

    // Edit 3: auto-detect กลุ่มข้อสอบ + รุ่น จากข้อความหน้าแรกๆ (suggest-only, ไม่บล็อกการโหลด)
    detectExamMeta(currentPdfDoc).then(meta => {
        if (meta.type) applyDetectedGroup(meta.type);
        applyDetectedBatch(meta.batch, 'เนื้อหาในไฟล์'); // ช่องว่างอยู่เท่านั้นถึงจะเติม
    });

    statusEl.textContent = `PDF โหลดแล้ว — ${currentPdfDoc.numPages} หน้า — กำลังเตรียมภาพ…`;

    // Show split layout and render PDF in left pane
    document.getElementById('converter-split').classList.remove('d-none');

    // Edit 4: render/extract ล้ม → ไม่ block การแปลง (รูปเป็น optional) แต่บอกผู้ใช้
    try {
        await renderPDFViewer();

        // Await extraction too — button enables only after images are ready for autoMatch.
        // Must be sequential: concurrent page.render() + getOperatorList() on the same
        // pdf.js page object transfers/detaches shared ImageBitmap resources.
        await extractImagesFromPDF(currentPdfDoc);
    } catch (e) {
        console.warn('handlePDFFile: render/extract failed', e);
        statusEl.textContent = '⚠️ เตรียมภาพไม่สำเร็จบางส่วน — ยังกดแปลงต่อได้ (รูปภาพอาจต้องอัปโหลดเอง)';
    } finally {
        btn.disabled = false;
    }
}

async function renderPDFViewer() {
    const container = document.getElementById('pdf-pages-container');
    if (!container || !currentPdfDoc) return;
    container.innerHTML = '';
    const dpr = window.devicePixelRatio || 1;
    const panelWidth = Math.max((container.clientWidth || container.offsetWidth) - 16, 100);
    const numPages = currentPdfDoc.numPages;
    const progressEl = document.getElementById('pdf-progress');

    // Pre-create canvases in order so DOM order is always correct
    const entries = Array.from({ length: numPages }, (_, i) => {
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        canvas.style.cursor = 'zoom-in';
        canvas.title = `หน้า ${i + 1} — คลิกเพื่อดูแบบเต็มจอ`;
        container.appendChild(canvas);
        return { canvas, pageNum: i + 1 };
    });

    if (progressEl) { progressEl.classList.remove('d-none'); progressEl.max = numPages; progressEl.value = 0; }

    let done = 0;
    const BATCH = 4;
    for (let i = 0; i < entries.length; i += BATCH) {
        await Promise.all(entries.slice(i, i + BATCH).map(async ({ canvas, pageNum }) => {
            try {
                const page = await currentPdfDoc.getPage(pageNum);
                const baseViewport = page.getViewport({ scale: 1 });
                const scale = (panelWidth / baseViewport.width) * dpr;
                const viewport = page.getViewport({ scale });
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                canvas.style.width = panelWidth + 'px';
                canvas.style.height = Math.round(viewport.height / dpr) + 'px';
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                canvas.onclick = () => viewFullImage(canvas.toDataURL());
            } catch (e) {
                console.warn(`renderPDFViewer: page ${pageNum} failed`, e);
            }
            if (progressEl) progressEl.value = ++done;
        }));
    }

    if (progressEl) progressEl.classList.add('d-none');
}

// ─── Feature A: หน้าทบทวนหัวข้อบรรยายก่อนแปลง (แยกตามกลุ่มวิชา + คำอธิบาย) ──────
// แสดงหัวข้อ e-learning จริงของวิชานี้ให้ผู้ใช้ตรวจก่อน AI จัดหมวด — คืน true = แปลงต่อ
async function reviewCategoriesBeforeConvert(subjId) {
    const allowedCats = getExistingCategoriesForSubject(subjId);

    // ไม่มีหัวข้อเลย → เตือนแบบเดิม (เสนอไปเพิ่มหัวข้อก่อน)
    if (allowedCats.length === 0) {
        const r = await Swal.fire({
            icon: 'warning',
            title: `ไม่พบหัวข้อบรรยายของวิชา "${_convEsc(subjId)}"`,
            html: `<div class="text-start small">ยังไม่มีหัวข้อบรรยาย (category) ของวิชานี้ในระบบ<br>
                   ถ้าแปลงเลย AI จะ<strong>สร้างชื่อหมวดหมู่ขึ้นเอง</strong> ซึ่งอาจไม่ตรงกับหลักสูตร<br>
                   แนะนำให้เพิ่มหัวข้อก่อน หรือตรวจสอบว่า Subject ID ถูกต้อง</div>`,
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '<i class="fas fa-robot me-1"></i> แปลงเลย (AI จัดเอง)',
            denyButtonText: '<i class="fas fa-sitemap me-1"></i> ไปเพิ่มหัวข้อก่อน',
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#6c757d', denyButtonColor: '#0d6efd'
        });
        if (r.isDenied) { showSection('structure'); return false; }
        return r.isConfirmed;
    }

    // จัดกลุ่มตามกลุ่มวิชา (discipline) โดยสแกน CategoryID — รองรับทั้ง RS_ANA_ และ RS_by AI_ANA_
    const groups = {};
    allowedCats.forEach(c => {
        const g = disciplineHeaderFromCategoryId(c.CategoryID);
        (groups[g] = groups[g] || []).push(c);
    });

    const groupsHtml = Object.keys(groups).sort().map(g => {
        const items = groups[g].map(c =>
            `<li><span class="fw-semibold">${_convEsc(c.CategoryName || c.CategoryID)}</span>
             <span class="text-muted" style="font-size:0.72rem">${_convEsc(c.CategoryID)}</span></li>`
        ).join('');
        return `<div class="mb-2">
                  <div class="badge bg-primary mb-1">${_convEsc(g)} <span class="opacity-75">(${groups[g].length})</span></div>
                  <ul class="mb-0 ps-3" style="font-size:0.82rem">${items}</ul>
                </div>`;
    }).join('');

    const r = await Swal.fire({
        title: `หัวข้อบรรยายของวิชา ${_convEsc(subjId)}`,
        html: `<div class="text-start">
                 <p class="small text-muted mb-2">
                   พบ <strong>${allowedCats.length}</strong> หัวข้อ — AI จะ<strong>บังคับจัด category[1] ลงหัวข้อเหล่านี้เท่านั้น</strong>
                   (คัดลอก CategoryID มาตรงเป๊ะ ไม่สร้างหัวข้อใหม่). ตรวจให้ครบก่อนแปลง — ถ้ายังขาดหัวข้อ กด "ไปเพิ่มหัวข้อ"
                 </p>
                 <div style="max-height:45vh;overflow-y:auto" class="border rounded p-2">${groupsHtml}</div>
               </div>`,
        width: '42rem',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '<i class="fas fa-check me-1"></i> ยืนยัน แปลงเลย',
        denyButtonText: '<i class="fas fa-sitemap me-1"></i> ไปเพิ่มหัวข้อ',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#198754', denyButtonColor: '#0d6efd'
    });
    if (r.isDenied) { showSection('structure'); return false; }
    return r.isConfirmed;
}

async function startPDFConversion() {
    if (!currentPdfDoc) { Swal.fire('error', 'กรุณาเลือก PDF ก่อน', 'error'); return; }
    // Phase 1: ใช้ Gemini key กลางผ่าน backend — ต้องล็อกอินก่อน (backend มี auth gate)
    // รับทั้ง username+adminPass (แบบเดิม) และ Google sessionToken (SSO)
    if (!(currentUser && currentUser.username && (adminPass || sessionToken))) {
        Swal.fire('แจ้งเตือน', 'กรุณาเข้าสู่ระบบก่อนใช้งานตัวแปลง PDF', 'warning');
        return;
    }

    const filename = document.getElementById('btn-convert-pdf').dataset.filename || 'quiz.pdf';
    // subjId สำหรับหน้าทบทวน: ช่อง Subject ID > เดาจากชื่อไฟล์ (ตรงกับที่ runGeminiConversion ใช้)
    const subjId = (document.getElementById('subjID').value.trim() ||
        parseFilenameMetadata(filename).subjectCode).trim();

    const proceed = await reviewCategoriesBeforeConvert(subjId);
    if (!proceed) return;

    document.getElementById('btn-convert-pdf').disabled = true;
    try {
        await runGeminiConversion(window._pdfFile, filename);
        autoMatchByPage();
        saveCheckpoint();
        await offerFillEmptyChoices(); // Feature B: เสนอเติมตัวเลือกที่ว่าง
    } catch (e) {
        Swal.fire('Gemini Error', e.message, 'error');
    } finally {
        document.getElementById('btn-convert-pdf').disabled = false;
    }
}

// ─── Feature B: ตรวจหาข้อที่ตัวเลือกว่าง + เติมทั้งหมดด้วย AI (1 POST) ──────────
// นับตัวเลือกจริง (ไม่ว่าง) จาก row[3] — ข้อที่มี < 2 ตัวเลือก ถือว่า "ว่าง/ไม่ครบ"
function detectEmptyChoiceRows() {
    const rows = converterStorage.ques || [];
    const targets = [];
    rows.forEach((row, i) => {
        const choices = String(row[3] || '').split('///').map(c => c.trim()).filter(c => c !== '');
        if (choices.length < 2) targets.push(i);
    });
    return targets;
}

// เสนอเติมตัวเลือก — เรียกหลังแปลงเสร็จ
async function offerFillEmptyChoices() {
    const targets = detectEmptyChoiceRows();
    if (targets.length === 0) return;

    const r = await Swal.fire({
        icon: 'question',
        title: `พบ ${targets.length} ข้อที่ตัวเลือกว่าง/ไม่ครบ`,
        html: `<div class="small text-muted">ต้องการให้ AI เติมตัวเลือกให้ครบ 5 ข้อ (อ้างอิงจาก PDF ต้นฉบับ) ไหม?<br>
               คำตอบเดิมจะถูกคงไว้ และคุณตรวจแก้ได้อีกครั้งผ่านปุ่ม ✎</div>`,
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-robot me-1"></i> เติมตัวเลือกทั้งหมดด้วย AI',
        cancelButtonText: 'ไว้ทีหลัง'
    });
    if (!r.isConfirmed) return;
    await bulkFillEmptyChoices(targets);
}

async function bulkFillEmptyChoices(targets) {
    const file = window._pdfFile;
    if (!file) {
        Swal.fire('ทำไม่ได้', 'ไม่พบไฟล์ PDF ต้นฉบับในเซสชันนี้ — กรุณาเติมตัวเลือกเองผ่านปุ่ม ✎', 'info');
        return;
    }
    // Edit 4: >14MB ส่ง native ไม่ได้ — ส่งเป็นภาพเฉพาะหน้าที่ข้อเหล่านั้นอยู่ (pageHint) แทน
    const useNativePdf = file.size <= 14 * 1024 * 1024;
    let hintPages = [];
    if (!useNativePdf) {
        hintPages = [...new Set(targets.map(i => pageHintMap.get(i)).filter(p => p != null))]
            .sort((a, b) => a - b).slice(0, 20);
        if (hintPages.length === 0 || !currentPdfDoc) {
            Swal.fire('ไฟล์ใหญ่เกินไป',
                `PDF ${(file.size / 1024 / 1024).toFixed(1)}MB และไม่ทราบหน้าอ้างอิงของข้อที่ว่าง — เติมตัวเลือกเองผ่านปุ่ม ✎`, 'info');
            return;
        }
    }

    // เตรียมรายการข้อ (id = rowIndex) + คำตอบ/ตัวเลือกเดิม (ถ้ามี)
    const items = targets.map(i => {
        const row = converterStorage.ques[i];
        return {
            id: i,
            problem: String(row[1] || '').trim(),
            answer: String(row[4] || '').trim(),
            existingChoices: String(row[3] || '').split('///').map(c => c.trim()).filter(c => c !== '')
        };
    }).filter(t => t.problem !== '');

    if (items.length === 0) { Swal.fire('ข้ามให้', 'ข้อที่ตัวเลือกว่างไม่มีโจทย์ให้อ้างอิง', 'info'); return; }

    const statusEl = document.getElementById('pdf-status');
    $('#loading-overlay').fadeIn(150).css('display', 'flex').find('h5').text('AI กำลังเติมตัวเลือก…');
    try {
        let payloadExtra;
        if (useNativePdf) {
            const pdfB64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            payloadExtra = { pdfB64 };
        } else {
            const imgs = [];
            for (const p of hintPages) {
                const pages = await renderPagesAsBase64(currentPdfDoc, { start: p, end: p });
                if (pages[0]) imgs.push(pages[0].dataUrl);
            }
            payloadExtra = { images: imgs };
        }
        const fills = await fillEmptyChoicesViaGAS(items, payloadExtra);
        const filled = applyChoiceFills(fills);
        $('#loading-overlay').hide();

        renderPreview();
        saveCheckpoint();
        if (statusEl) statusEl.textContent = `✅ AI เติมตัวเลือกแล้ว ${filled} ข้อ`;
        Swal.fire({
            toast: true, icon: filled > 0 ? 'success' : 'warning', position: 'top-end',
            title: filled > 0 ? `เติมตัวเลือกสำเร็จ ${filled} ข้อ — โปรดตรวจทานผ่านปุ่ม ✎`
                              : 'AI ไม่ได้เติมข้อใด — ลองใหม่หรือเติมเองผ่านปุ่ม ✎',
            timer: 4500, showConfirmButton: false
        });
    } catch (e) {
        // RECITATION / network / quota — ข้อที่แปลงมาแล้วยังอยู่ครบ (เขียนทับเฉพาะตอนสำเร็จ)
        $('#loading-overlay').hide();
        Swal.fire('เติมตัวเลือกไม่สำเร็จ', `${e.message}<br><span class="small text-muted">ลองกดแปลงใหม่ หรือเติมเองผ่านปุ่ม ✎ ในแต่ละข้อ</span>`, 'warning');
    }
}

// เขียนตัวเลือกที่ AI เติมกลับลงแถว — บังคับ answer ∈ choices เหมือน edit modal (advisor must-fix)
// คืนจำนวนข้อที่เติมสำเร็จ
function applyChoiceFills(fills) {
    let filled = 0;
    (fills || []).forEach(f => {
        const id = Number(f.id);
        if (!Number.isInteger(id) || !converterStorage.ques[id]) return; // id เพี้ยน/ไม่มีแถว → ข้าม
        const choices = String(f.choices || '').split('///').map(c => c.trim()).filter(c => c !== '');
        if (choices.length < 2) return; // เติมไม่ได้จริง

        const row = converterStorage.ques[id];
        let answer = String(f.answer || '').trim();
        const prevAnswer = String(row[4] || '').trim();

        // คงคำตอบเดิมถ้ายังอยู่ในตัวเลือกใหม่
        if (prevAnswer && choices.includes(prevAnswer)) {
            answer = prevAnswer;
        } else if (!answer || !choices.includes(answer)) {
            // answer ที่ AI ให้มาไม่ตรงตัวเลือก → ซ่อม: ใส่คำตอบเดิมเข้าไป หรือเลือกตัวแรก
            if (prevAnswer) { choices.unshift(prevAnswer); answer = prevAnswer; }
            else answer = choices[0];
        }

        row[3] = choices.join('///');
        row[4] = answer;
        filled++;
    });
    return filled;
}

// ─── Image Tray ───────────────────────────────────────────────────────────

function renderImageTray() {
    const container = document.getElementById('image-tray-container');
    if (!container) return;

    // Edit 5: แยกรูปประดับ (โผล่ ≥2 หน้า) ออกจากถาดหลัก — index i ต้องเป็น index จริงใน extractedImages
    const mainImgs = [];
    const decoImgs = [];
    extractedImages.forEach((img, i) => (img.decorative ? decoImgs : mainImgs).push({ img, i }));
    document.getElementById('tray-count').textContent = mainImgs.length;

    const itemHtml = ({ img, i }) => {
        const isSelected = selectedTrayIndex === i;
        const assignedRow = img.assignedTo != null ? img.assignedTo : null;
        const rowEntries = assignedRow != null ? (imgAssignments.get(assignedRow) || []) : [];
        const entry = rowEntries.find(e => e.base64 === img.base64) || null;
        const statusBadge = entry ? `<span class="upload-status-pill status-${entry.status.toLowerCase()}">${entry.status}</span>` : '';
        const sourceBadge = `<span class="source-badge source-${img.source}">${img.source === 'object' ? 'Object' : 'Render'}</span>`;
        const assignedBadge = assignedRow != null ? `<span class="assigned-badge">Q${assignedRow + 1}${rowEntries.length > 1 ? `×${rowEntries.length}` : ''}</span>` : '';
        return `<div class="tray-item${isSelected ? ' selected' : ''}" onclick="selectTrayImage(${i})" title="หน้า ${img.page}">
            <img src="${img.base64}" alt="img ${i}">
            <div class="tray-badges">${sourceBadge}${assignedBadge}${statusBadge}</div>
        </div>`;
    };

    let html = mainImgs.map(itemHtml).join('');
    if (decoImgs.length > 0) {
        html += `<details class="decor-tray">
            <summary>รูปประดับ (คาดว่าไม่ใช่รูปข้อสอบ) — ${decoImgs.length} รูป</summary>
            <div class="decor-tray-items">${decoImgs.map(itemHtml).join('')}</div>
        </details>`;
    }
    container.innerHTML = html;
}

function selectTrayImage(index) {
    selectedTrayIndex = index;
    renderImageTray();
}

// ─── Card view (AI mode) ───────────────────────────────────────────────────

function toggleRequireImgFilter(checked) {
    _filterRequireImg = checked;
    if (checked) switchTab('ques');
    renderPreview();
}

function renderPreviewCards() {
    const section = document.getElementById('ai-cards-section');
    if (!section) return;
    const hasQuestions = (converterStorage.ques || []).length > 0;
    if (!hasQuestions) { section.classList.add('d-none'); return; }
    section.classList.remove('d-none');
    const el = document.getElementById('card-count-text');
    if (el) el.textContent = `รูปภาพที่แยกออกมาได้ ${extractedImages.length} รูป`;
}

function openTrayPicker(rowIndex) {
    focusedRowIndex = rowIndex;
    openImgPickerModal(rowIndex);
}

function openImgPickerModal(rowIndex) {
    _pickerTargetRow = rowIndex;
    renderImgPickerGrid();
    document.getElementById('img-picker-modal').classList.remove('d-none');
    document.body.style.overflow = 'hidden';
}

function closeImgPickerModal() {
    document.getElementById('img-picker-modal').classList.add('d-none');
    document.body.style.overflow = '';
    _pickerTargetRow = null;
}

function renderImgPickerGrid() {
    const grid = document.getElementById('img-picker-grid');
    if (!grid) return;
    const countEl = document.getElementById('tray-count');
    if (countEl) countEl.textContent = extractedImages.length;
    if (extractedImages.length === 0) {
        grid.innerHTML = '<p class="text-muted text-center p-5 w-100">ยังไม่มีรูปภาพที่แยกได้จาก PDF</p>';
        return;
    }

    // Edit 5: แยกรูปประดับออกจาก grid หลัก — index i ต้องเป็น index จริงใน extractedImages
    const mainImgs = [];
    const decoImgs = [];
    extractedImages.forEach((img, i) => (img.decorative ? decoImgs : mainImgs).push({ img, i }));

    const pickerItemHtml = ({ img, i }) => {
        const assignedRow = img.assignedTo != null ? img.assignedTo : null;
        const pickerRowEntries = assignedRow != null ? (imgAssignments.get(assignedRow) || []) : [];
        const assignedBadge = assignedRow != null
            ? `<span class="picker-assigned-badge">Q${assignedRow + 1}${pickerRowEntries.length > 1 ? `×${pickerRowEntries.length}` : ''}</span>` : '';
        const pickerEntry = pickerRowEntries.find(e => e.base64 === img.base64) || null;
        const statusBadge = pickerEntry
            ? `<span class="upload-status-pill status-${pickerEntry.status.toLowerCase()}">${pickerEntry.status}</span>` : '';
        return `<div class="img-picker-item" onclick="pickImageFromModal(${i})">
            <img src="${img.base64}" alt="หน้า ${img.page}" loading="lazy">
            <div class="picker-badges">
                <span class="picker-page-badge">หน้า ${img.page}</span>
                ${assignedBadge}${statusBadge}
            </div>
        </div>`;
    };

    let html = mainImgs.map(pickerItemHtml).join('');
    if (decoImgs.length > 0) {
        html += `<details class="decor-tray w-100">
            <summary>รูปประดับ (คาดว่าไม่ใช่รูปข้อสอบ) — ${decoImgs.length} รูป</summary>
            <div class="decor-tray-items">${decoImgs.map(pickerItemHtml).join('')}</div>
        </details>`;
    }
    grid.innerHTML = html;
}

function pickImageFromModal(trayIndex) {
    selectedTrayIndex = trayIndex;
    if (_pickerTargetRow != null) {
        assignImageToQuestion(_pickerTargetRow);
        closeImgPickerModal();
    }
}

function viewFullImage(src) {
    Swal.fire({ imageUrl: src, imageAlt: 'รูปภาพ', width: '90vw', showConfirmButton: false, showCloseButton: true });
}

async function uploadImageForCard(rowIndex, input) {
    const file = input.files[0];
    if (!file) return;
    const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
    const arr = imgAssignments.get(rowIndex) || [];
    arr.push({ base64, fileId: null, url: null, status: 'Waiting', page: null });
    imgAssignments.set(rowIndex, arr);
    saveCheckpoint();
    renderPreviewWithBadges();
    updateSaveButtonState();
}

// ─── Image assignment ──────────────────────────────────────────────────────

function assignImageToQuestion(rowIndex) {
    if (selectedTrayIndex == null) {
        Swal.fire({ toast: true, icon: 'warning', title: 'เลือกรูปในถาดก่อน', timer: 2000, showConfirmButton: false });
        return;
    }
    const img = extractedImages[selectedTrayIndex];
    if (!img) return;

    const current = imgAssignments.get(rowIndex) || [];
    if (current.some(e => e.base64 === img.base64)) {
        Swal.fire({ toast: true, icon: 'info', title: 'รูปนี้ถูก assign ในข้อนี้แล้ว', timer: 2000, showConfirmButton: false });
        return;
    }

    // If image was assigned to a different question, remove it from there
    if (img.assignedTo != null && img.assignedTo !== rowIndex) {
        const prevArr = imgAssignments.get(img.assignedTo) || [];
        const firstIdx = prevArr.findIndex(e => e.base64 === img.base64);
        if (firstIdx >= 0) prevArr.splice(firstIdx, 1);
        if (prevArr.length > 0) imgAssignments.set(img.assignedTo, prevArr);
        else imgAssignments.delete(img.assignedTo);
    }

    img.assignedTo = rowIndex;
    current.push({ base64: img.base64, fileId: null, url: null, status: 'Waiting', page: img.page });
    imgAssignments.set(rowIndex, current);
    saveCheckpoint();
    renderImageTray();
    renderPreviewWithBadges();
    updateSaveButtonState();
}

function removeAssignment(rowIndex, imgIndex) {
    const arr = imgAssignments.get(rowIndex);
    if (!arr) return;
    const removed = arr.splice(imgIndex, 1)[0];
    if (removed) {
        const src = extractedImages.find(img => img.assignedTo === rowIndex && img.base64 === removed.base64);
        if (src) src.assignedTo = null;
    }
    if (arr.length === 0) imgAssignments.delete(rowIndex);
    saveCheckpoint();
    renderImageTray();
    renderPreviewWithBadges();
    updateSaveButtonState();
}

// ─── Page-proximity auto-match ─────────────────────────────────────────────

function autoMatchByPage() {
    const requireImgRows = converterStorage.ques
        .map((row, i) => ({ rowIndex: i, pageHint: pageHintMap.get(i) || null }))
        .filter(q => {
            const row = converterStorage.ques[q.rowIndex];
            return row && String(row[2]).trim() === 'require_img';
        });

    if (requireImgRows.length === 0 || extractedImages.length === 0) return;

    requireImgRows.forEach(q => {
        if (imgAssignments.has(q.rowIndex)) return; // already assigned
        // Edit 5: รูปประดับ (โผล่หลายหน้า) ไม่ถูก auto-match — ผู้ใช้ยังเลือกเองได้จากถาดรูปประดับ
        const unassigned = extractedImages.filter(img => img.assignedTo == null && !img.decorative);
        if (unassigned.length === 0) return;

        let match = unassigned.find(img => img.page === q.pageHint);
        if (!match && q.pageHint != null) {
            match = unassigned.sort((a, b) =>
                Math.abs(a.page - q.pageHint) - Math.abs(b.page - q.pageHint)
            )[0];
        }
        if (!match) match = unassigned[0];

        if (match) {
            match.assignedTo = q.rowIndex;
            const arr = imgAssignments.get(q.rowIndex) || [];
            arr.push({ base64: match.base64, fileId: null, url: null, status: 'Waiting', page: match.page });
            imgAssignments.set(q.rowIndex, arr);
        }
    });

    renderImageTray();
    renderPreviewWithBadges();
    updateSaveButtonState();
}

// ─── renderPreview with require_img badges ────────────────────────────────

// Update both table (struct/category tabs) and card view (ques AI)
function renderPreviewWithBadges() {
    renderPreview();
    renderPreviewCards();
}

// Keyboard shortcut: 'a' assigns selected tray image to focused row or card
document.addEventListener('keydown', function(e) {
    if (e.key === 'a' && !e.ctrlKey && !e.metaKey &&
        document.activeElement.closest('.conv-card, .card[data-row-index]') &&
        focusedRowIndex != null) {
        assignImageToQuestion(focusedRowIndex);
    }
});

// ─── localStorage checkpoint ───────────────────────────────────────────────

function saveCheckpoint() {
    const data = {
        questions: converterStorage.ques,
        imageAssignments: [...imgAssignments.entries()],
        // base64 images are NOT stored (too large); user will see "need re-upload" notice
        extractedImagesMeta: extractedImages.map(img => ({
            page: img.page, source: img.source, assignedTo: img.assignedTo,
            width: img.width, height: img.height
        }))
    };
    try { localStorage.setItem('mdkku_pdf_checkpoint', JSON.stringify(data)); } catch (e) {}
}

function restoreCheckpoint() {
    const raw = localStorage.getItem('mdkku_pdf_checkpoint');
    if (!raw) return;
    try {
        const data = JSON.parse(raw);
        converterStorage.ques = data.questions || [];
        imgAssignments = new Map(data.imageAssignments || []);
        // base64 images lost — notify user
        Swal.fire({
            toast: true, icon: 'info', position: 'top-end',
            title: 'กู้คืน session ก่อนหน้า — รูปภาพต้องอัปโหลดใหม่',
            timer: 4000, showConfirmButton: false
        });
        document.getElementById('converter-split')?.classList.remove('d-none');
        renderPreviewWithBadges();
        updateSaveButtonState();
    } catch (e) {
        localStorage.removeItem('mdkku_pdf_checkpoint');
    }
}

// ─── Post-import result handler ────────────────────────────────────────────

function handleSaveResult(resJson) {
    if (resJson.result === 'success') {
        converterStorage.ques = [];
        converterStorage.struct = [];
        converterStorage.category = [];
        extractedImages = [];
        imgAssignments.clear();
        pageHintMap.clear();
        currentPdfDoc = null;
        localStorage.removeItem('mdkku_pdf_checkpoint');
        const splitEl = document.getElementById('converter-split');
        if (splitEl) splitEl.classList.add('d-none');
        const pdfContainer = document.getElementById('pdf-pages-container');
        if (pdfContainer) pdfContainer.innerHTML = '<p class="text-muted small text-center p-4">ยังไม่ได้โหลด PDF</p>';
        renderPreview();
        renderPreviewCards();
        Swal.fire({
            title: 'นำเข้าข้อมูลเสร็จสิ้น',
            html: `<div class="text-start small">
                <p class="mb-1 text-success fw-bold">สรุปผลการดำเนินการ:</p>
                <pre class="bg-light p-2 border rounded">${resJson.importLog || ''}</pre>
                <p class="mt-2 text-muted">รวมเพิ่มข้อมูลใหม่/อัปเดตสำเร็จทั้งหมด: ${resJson.count} แถว</p>
            </div>`,
            icon: 'success'
        });
        scheduleSync(); // adminImport เขียนแถว QUESTION/IMPORT ลง Logs แล้ว — delta sync เห็นข้อที่ import ครบ

    } else if (resJson.result === 'partial' || resJson.result === 'error') {
        const failedIds = new Set((resJson.failedList || []).map(f => f.questionId));
        // Track original indices before filtering so imgAssignments keys stay correct
        const surviving = converterStorage.ques
            .map((row, origIdx) => ({ row, origIdx }))
            .filter(({ row }) => failedIds.has(row[0]));
        converterStorage.ques = surviving.map(({ row }) => row);
        const newMap = new Map();
        surviving.forEach(({ origIdx }, newIdx) => {
            if (imgAssignments.has(origIdx)) newMap.set(newIdx, imgAssignments.get(origIdx));
        });
        imgAssignments = newMap;
        renderPreviewWithBadges();
        Swal.fire({
            icon: 'warning',
            title: `บันทึกสำเร็จ ${resJson.savedCount || 0} ข้อ / ล้มเหลว ${(resJson.failedList || []).length} ข้อ`,
            html: `<pre class="text-start small bg-light p-2">${(resJson.failedList || []).map(f => `• ${f.questionId}: ${f.reason}`).join('\n')}</pre>`
        });
    }
}

// ─── Fix recompressBase64 (async img.onload) ─────────────────────────────

async function recompressBase64(base64, quality) {
    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = base64;
    });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', quality || 0.8);
}

// Switch between AI and Manual converter modes
function switchConverterMode(mode) {
    document.getElementById('converter-ai-panel').classList.toggle('d-none', mode !== 'ai');
    document.getElementById('converter-manual-panel').classList.toggle('d-none', mode !== 'manual');
    document.getElementById('btn-mode-ai').classList.toggle('active', mode === 'ai');
    document.getElementById('btn-mode-manual').classList.toggle('active', mode === 'manual');
}

// Try to restore checkpoint on page load (called from initApp or DOMContentLoaded)
function initPDFConverter() {
    restoreCheckpoint();
    updateSaveButtonState();
}

// ─── บริจาค Gemini API Key เข้า pool กลาง (พร้อมคู่มือขอ key ฟรี) ───────────
// ส่ง action:'seedGeminiKey' ให้ backend validate (tri-state) แล้ว append ลง AI_Config
function openGeminiDonateModal() {
    Swal.fire({
        title: 'บริจาค Gemini API Key',
        html: `
          <div style="text-align:left;font-size:0.9rem;line-height:1.55">
            <p class="mb-1">ช่วยแบ่งปันโควต้าให้เพื่อนๆ แปลง PDF ได้มากขึ้น — ขอ Key <b>ฟรี</b> ง่ายๆ:</p>
            <ol style="padding-left:1.15rem;margin-bottom:.6rem">
              <li>เปิด <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></li>
              <li>ลงชื่อเข้าใช้ด้วยบัญชี Google</li>
              <li>กดปุ่ม <b>Create API key</b> แล้ว <b>Copy</b></li>
              <li>วาง Key ด้านล่าง แล้วกด "บริจาค"</li>
            </ol>
            <input id="gd-key" class="swal2-input" placeholder="วาง API Key ที่นี่" style="margin:.25rem 0;width:92%">
            <input id="gd-name" class="swal2-input" placeholder="ชื่อผู้บริจาค (ไม่บังคับ)" style="margin:.25rem 0;width:92%">
            <div class="small text-muted mt-1">Key จะถูกตรวจสอบก่อนบันทึก และใช้ร่วมกันในระบบเท่านั้น</div>
          </div>`,
        showCancelButton: true,
        confirmButtonText: 'บริจาค',
        cancelButtonText: 'ยกเลิก',
        focusConfirm: false,
        preConfirm: () => {
            const key = (document.getElementById('gd-key').value || '').trim();
            const name = (document.getElementById('gd-name').value || '').trim();
            if (!key) { Swal.showValidationMessage('กรุณาวาง API Key'); return false; }
            return { key, name };
        }
    }).then(async (r) => {
        if (!r.isConfirmed) return;
        Swal.fire({ title: 'กำลังตรวจสอบ Key…', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            const res = await fetch(APPSCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'seedGeminiKey',
                    apiKey: r.value.key,
                    donorName: r.value.name,
                    clientId: getConverterClientId(),
                    username: (typeof currentUser === 'object' && currentUser && currentUser.username) || ''
                }),
                redirect: 'follow'
            });
            const json = await res.json();
            if (json.result === 'success') {
                Swal.fire('ขอบคุณครับ! 🎉', json.message || 'บริจาคสำเร็จ', 'success');
            } else {
                Swal.fire('ไม่สำเร็จ', json.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่', 'error');
            }
        } catch (e) {
            Swal.fire('เชื่อมต่อไม่ได้', 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'error');
        }
    });
}
