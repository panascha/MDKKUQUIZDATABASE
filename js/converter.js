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

    const cardsHtml = data.map((row, i) => {
        const status = evaluateRowStatusInBatch(row, i, currentSheet, seenKeys);
        counts.ALL++;
        counts[status] = (counts[status] || 0) + 1;

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
              </div>
              <div class="flex-grow-1 min-w-0">
                <p class="mb-1" style="font-size:0.82rem">${String(row[1] || '').substring(0, 300)}</p>
                <div class="mb-1">${choices}</div>
                <div class="mb-1 small text-success fw-semibold">✓ ${row[4] || ''}</div>
                <div>${catBadges}</div>
                ${imgArea}
              </div>
            </div>`;
        }

        return `<div class="card mb-2 conv-card${border}"
                     data-status="${status}"
                     data-require-img="${requireImg}"
                     tabindex="${currentSheet === 'ques' ? '0' : '-1'}"
                     ${currentSheet === 'ques' ? `onfocus="focusedRowIndex=${i}"` : ''}
                     ${hidden ? 'style="display:none"' : ''}>
          <div class="card-body py-2 px-3">${cardInner}</div>
        </div>`;
    }).join('');

    body.innerHTML = cardsHtml || '<p class="text-muted small text-center p-3 mb-0">ยังไม่มีข้อมูล</p>';

    $('#count-all').text(counts.ALL);
    $('#count-new').text(counts.NEW);
    $('#count-updated').text(counts.UPDATED);
    $('#count-duplicate').text(counts.DUPLICATE);
    $('#count-existing').text(counts.EXISTING);

    document.getElementById('previewText').innerText = `มีข้อมูลทั้งหมด ${data.length} แถว`;
}

function filterConverterTable(status, btn) {
    $('#converter-filter-bar .btn').removeClass('active');
    $(btn).addClass('active');
    document.querySelectorAll('#cardsBody .conv-card').forEach(card => {
        const s = card.getAttribute('data-status');
        card.style.display = (status === 'ALL' || s === status) ? '' : 'none';
    });
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
                await startUploadQueue();
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

// ─── PDF drop/file handling ────────────────────────────────────────────────

function handlePDFDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') handlePDFFile(file);
}

async function handlePDFFile(file) {
    if (!file) return;
    const btn = document.getElementById('btn-convert-pdf');
    btn.disabled = true;
    document.getElementById('pdf-status').textContent = `โหลด PDF: ${file.name}…`;

    const arrayBuffer = await file.arrayBuffer();
    currentPdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    window._pdfFile = file; // preserve raw File for inline-PDF Gemini call

    document.getElementById('pdf-status').textContent =
        `PDF โหลดแล้ว — ${currentPdfDoc.numPages} หน้า — กำลังเตรียมภาพ…`;
    btn.dataset.filename = file.name;

    // Show split layout and render PDF in left pane
    document.getElementById('converter-split').classList.remove('d-none');
    await renderPDFViewer();

    // Await extraction too — button enables only after images are ready for autoMatch.
    // Must be sequential: concurrent page.render() + getOperatorList() on the same
    // pdf.js page object transfers/detaches shared ImageBitmap resources.
    await extractImagesFromPDF(currentPdfDoc);
    btn.disabled = false;
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

async function askAddTopicsFirst() {
    const subjectName = document.getElementById('subjName')?.value ||
                        document.getElementById('subjID')?.value || 'วิชานี้';
    const result = await Swal.fire({
        title: 'เพิ่มหัวข้อบรรยายก่อนหรือไม่?',
        html: `วิชา <strong>${subjectName}</strong><br>
               หากยังไม่มีหัวข้อย่อย (บรรยาย/หัวข้อ) ควรเพิ่มก่อน<br>
               เพื่อให้ Gemini จัดหมวดหมู่ได้ถูกต้อง`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-sitemap me-1"></i> ไปเพิ่มหัวข้อก่อน',
        cancelButtonText: '<i class="fas fa-robot me-1"></i> แปลงเลย',
        confirmButtonColor: '#0d6efd',
        cancelButtonColor: '#6c757d'
    });
    if (result.isConfirmed) {
        showSection('structure');
        return false;
    }
    return true;
}

async function startPDFConversion() {
    if (!currentPdfDoc) { Swal.fire('error', 'กรุณาเลือก PDF ก่อน', 'error'); return; }
    const key = getGeminiKey();
    if (!key) { Swal.fire('แจ้งเตือน', 'กรุณากรอก Gemini API Key', 'warning'); return; }

    const proceed = await askAddTopicsFirst();
    if (!proceed) return;

    const filename = document.getElementById('btn-convert-pdf').dataset.filename || 'quiz.pdf';
    document.getElementById('btn-convert-pdf').disabled = true;
    try {
        await runGeminiConversion(window._pdfFile, filename);
        autoMatchByPage();
        saveCheckpoint();
    } catch (e) {
        Swal.fire('Gemini Error', e.message, 'error');
    } finally {
        document.getElementById('btn-convert-pdf').disabled = false;
    }
}

// ─── Image Tray ───────────────────────────────────────────────────────────

function renderImageTray() {
    const container = document.getElementById('image-tray-container');
    if (!container) return;
    document.getElementById('tray-count').textContent = extractedImages.length;

    container.innerHTML = extractedImages.map((img, i) => {
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
    }).join('');
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
    grid.innerHTML = extractedImages.map((img, i) => {
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
    }).join('');
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
        const unassigned = extractedImages.filter(img => img.assignedTo == null);
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
        fetchData(true);

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
