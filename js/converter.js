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

                // รีเซ็ตตาราง Preview
                renderPreview();

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
                switchTab(initialTab);

            } catch (e) {
                console.error(e);
                Swal.fire('Error', 'Format ข้อมูลผิดพลาด: ' + e.message, 'error');
            }
        }

function renderPreview() {
            const head = document.getElementById('tableHead');
            const body = document.getElementById('tableBody');
            const currentSheet = converterStorage.current;
            const data = converterStorage[currentSheet];

            head.innerHTML = converterHeaders[currentSheet].map(h => `<th>${h}</th>`).join("");

            let seenKeys = new Set();
            let counts = { ALL: 0, NEW: 0, UPDATED: 0, DUPLICATE: 0, EXISTING: 0 };

            const rowsHtml = data.map((row, i) => {
                const status = evaluateRowStatusInBatch(row, i, currentSheet, seenKeys);

                counts.ALL++;
                counts[status]++;

                // เลือก Class สีและป้ายสถานะตามสถานะข้อมูล
                let bgClass = '';
                let badgeHtml = '';
                if (status === 'NEW') {
                    bgClass = 'table-success';
                    badgeHtml = '<span class="badge bg-success small me-1">NEW</span>';
                } else if (status === 'UPDATED') {
                    bgClass = 'table-warning';
                    badgeHtml = '<span class="badge bg-warning text-dark small me-1">UPDATE</span>';
                } else if (status === 'DUPLICATE') {
                    bgClass = 'table-danger';
                    badgeHtml = '<span class="badge bg-danger small me-1">DUP</span>';
                } else if (status === 'EXISTING') {
                    bgClass = 'table-secondary opacity-75';
                    badgeHtml = '<span class="badge bg-secondary small me-1">EXIST</span>';
                }

                const indexCell = `<td>${badgeHtml}${i + 1}</td>`;
                const contentCells = row.map(cell => {
                    return `<td class="editable-cell" contenteditable="true" style="white-space: pre-wrap;">${cell}</td>`;
                }).join("");

                return `<tr class="${bgClass}" data-status="${status}">${indexCell}${contentCells}</tr>`;
            }).join("");

            body.innerHTML = rowsHtml;

            // อัปเดตตัวเลขแสดงผลบนปุ่มคัดกรอง
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

                const rows = document.querySelectorAll('#tableBody tr');
                rows.forEach(tr => {
                    const rowStatus = tr.getAttribute('data-status');
                    if (status === 'ALL' || rowStatus === status) {
                        tr.style.display = '';
                    } else {
                        tr.style.display = 'none';
                    }
                });
            }

function copyCurrentSheet() {
        // ... (โค้ด copyCurrentSheet เดิม) ...
        const rows = document.querySelectorAll('#tableBody tr');
        let text = "";
        rows.forEach(tr => {
            let rowData = [];
            const cells = tr.querySelectorAll('td');
            for (let j = 1; j < cells.length; j++) {
                rowData.push(cells[j].innerText);
            }
            text += rowData.join("\t") + "\n";
        });
        navigator.clipboard.writeText(text);
        Swal.fire('Copied', 'คัดลอกข้อมูล (TSV) เรียบร้อยแล้ว', 'success');
        // ... (จบโค้ด copyCurrentSheet เดิม) ...
    }

async function importConvertedData() {
            if (!confirmAdmin()) return;

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
                    // ดึงข้อมูลที่ผ่านการกรองคัดทิ้งแถวที่ไม่จำเป็นในเบื้องหลังเรียบร้อยแล้ว
                    const dataToImport = getFilteredImportData(sheet.key);

                    if (dataToImport.length > 0) {
                        const response = await fetch(APPSCRIPT_URL, {
                            method: 'POST',
                            headers: { "Content-Type": "text/plain;charset=utf-8" },
                            body: JSON.stringify({
                                action: 'adminImport',
                                username: currentUser.username,
                                adminPass: adminPass,
                                data: {
                                    sheetName: sheet.key,
                                    data: dataToImport
                                }
                            })
                        });

                        const resJson = await response.json();

                        if (resJson.result === 'success') {
                            totalNew += (resJson.count || 0);
                            totalSkipped += (resJson.skipped || 0);
                            importLog += `• ${sheet.name}: เพิ่ม/อัปเดตใหม่ ${resJson.count} แถว (ซ้ำ ${resJson.skipped})\n`;
                        } else {
                            console.error(`Error importing ${sheet.name}:`, resJson.message);
                        }
                    }
                }

                $('#loading-overlay').hide();

                if (totalNew > 0 || totalSkipped > 0) {
                    Swal.fire({
                        title: 'นำเข้าข้อมูลเสร็จสิ้น',
                        html: `<div class="text-start small">
                    <p class="mb-1 text-success fw-bold">สรุปผลการดำเนินการ:</p>
                    <pre class="bg-light p-2 border rounded">${importLog}</pre>
                    <p class="mt-2 text-muted">รวมเพิ่มข้อมูลใหม่/อัปเดตสำเร็จทั้งหมด: ${totalNew} แถว</p>
                  </div>`,
                        icon: 'success'
                    });
                    fetchData(true); // โหลดข้อมูลใหม่เพื่ออัปเดต UI
                } else {
                    Swal.fire('ไม่มีข้อมูลใหม่', 'ข้อมูลทั้งหมดที่คุณต้องการนำเข้า มีอยู่ในระบบเรียบร้อยแล้ว', 'info');
                }

            } catch (err) {
                $('#loading-overlay').hide();
                Swal.fire('Error', 'การ Import ขัดข้อง: ' + err.message, 'error');
            }
        }
