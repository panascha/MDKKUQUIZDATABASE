// ─────────────────────────────────────────────────────
// JS/TABLES.JS
// ─────────────────────────────────────────────────────

// Set ของ questionId ที่มี Report ค้างอยู่ — สร้างใหม่ก่อน draw ทุกครั้ง (ดูใน preDrawCallback ของ initAdminTable)
let _reportedQIds = new Set();

function setTableView(tableId, mode, btn) {
        const $table = $('#' + tableId);

        // 1. จัดการ UI ของปุ่ม (Siblings คือปุ่มข้างๆ ในกลุ่มเดียวกัน)
        $(btn).parent().find('.btn').removeClass('active');
        $(btn).addClass('active');

        // 2. จัดการมุมมอง
        if (mode === 'card') {
            $table.addClass('view-as-card');
            // ปิด Horizontal Scroll ของ Wrapper
            $table.closest('.table-responsive').css('overflow-x', 'visible');
        } else {
            $table.removeClass('view-as-card');
            // เปิด Horizontal Scroll ของ Wrapper
            $table.closest('.table-responsive').css('overflow-x', 'auto');
        }

        // 3. ปรับการแสดงผล DataTables (ป้องกันตารางเบี้ยว)
        if ($.fn.DataTable.isDataTable('#' + tableId)) {
            const dt = $('#' + tableId).DataTable();
            dt.columns.adjust().draw(); // คำนวณความกว้างใหม่
        }
    }

function initPublicTable() {
        // ... (โค้ด initPublicTable เดิม) ...
        if ($.fn.DataTable.isDataTable('#publicTable')) return;
        const table = $('#publicTable').DataTable({
            stateSave: true,
            deferRender: true,
            data: globalData.questions,
            columns: [
                {
                    data: null,
                    defaultContent: '-',
                    createdCell: (td) => $(td).attr('data-label', 'Subject'),
                    render: function (data, type, row) {
                        // ป้องกัน Error กรณี row หรือ category ไม่มีค่า
                        if (!row || !row.category) return '-';
                        return getSubjectFromCategory(row.category);
                    }
                },
                {
                    data: 'category',
                    defaultContent: '-',
                    createdCell: (td) => $(td).attr('data-label', 'Category'),
                    render: function (data) {
                        if (!data) return '-';
                        return Array.isArray(data) ? data.join(', ') : data;
                    }
                },
                {
                    data: 'problem',
                    createdCell: (td) => $(td).attr('data-label', 'Question'),
                },
                {
                    data: 'img',
                    createdCell: (td) => $(td).attr('data-label', 'Image'),
                    render: function (data) {
                        if (!data) return '-';
                        let firstImg = data.split('///')[0];
                        return `<img src="${transformUrl(firstImg)}" class="img-preview-mini">`;
                    }
                },
                {
                    data: 'answer',
                    createdCell: (td) => $(td).attr('data-label', 'Answer') // เพิ่มบรรทัดนี้
                },
                {
                    data: null,
                    render: function (data, type, row) {
                        if (isAdmin) {
                            return `<div class="btn-group">
                <button class="btn btn-sm btn-outline-secondary" onclick="showQuestionDetail('${row.questionId}')"><i class="fas fa-eye"></i></button>
            </div>`;
                        } else {
                            return `<button class="btn btn-sm btn-outline-primary" onclick="checkAuthBeforeAction()">
                <i class="fas fa-sign-in-alt"></i> Login to Edit
            </button>`;
                        }
                    }
                }
            ]
        });

        $('#search-subject-filter').on('change', function () {
            const selectedSubj = this.value;
            table.column(0).search(selectedSubj).draw();
            updateCategoryDropdown(selectedSubj, '#search-category-filter');
            table.column(1).search('').draw();
        });
        $('#search-category-filter').on('change', function () {
            table.column(1).search(this.value).draw();
        });
        // ... (จบโค้ด initPublicTable เดิม) ...
    }

function initAdminTable() {
        if ($.fn.DataTable.isDataTable('#adminTable')) return;

        const table = $('#adminTable').DataTable({
            stateSave: true,
            deferRender: true,
            data: globalData.questions,
            preDrawCallback: function () {
                // สร้าง Set ของ questionId ที่มี Report ค้างอยู่ก่อน draw ทุกครั้ง (แทนการ .some() ต่อแถว)
                _reportedQIds = new Set(
                    (globalData.report || [])
                        .filter(r => !r.Done || String(r.Done).toUpperCase() === 'FALSE')
                        .map(r => r.QuestionID)
                );
            },
            columns: [
                {
                    data: null,
                    render: function (data, type, row) {
                        // --- เพิ่มส่วนเช็ค Report ค้าง ---
                        const hasReport = _reportedQIds.has(row.questionId);

                        const reportBadge = hasReport
                            ? `<span class="badge bg-danger pulse-animation" title="มีรายงานปัญหาค้างอยู่"><i class="fas fa-exclamation-circle"></i> REPORT</span> `
                            : '';

                        return reportBadge + getSubjectFromCategory(row.category);
                    }
                },
                {
                    data: 'category',
                    createdCell: (td) => $(td).attr('data-label', 'Category'), // เพิ่มบรรทัดนี้
                    render: function (data) {
                        if (!data) return '-';
                        return Array.isArray(data) ? data.join(', ') : data;
                    }
                },
                {
                    data: 'problem',
                    createdCell: (td) => $(td).attr('data-label', 'Question'), // เพิ่มบรรทัดนี้
                    defaultContent: ''
                },
                {
                    data: 'img',
                    createdCell: (td) => $(td).attr('data-label', 'Image'),
                    render: function (data) {
                        if (!data) return '-';
                        // ตรวจสอบว่ามี require_img หรือไม่
                        if (String(data).toLowerCase().includes('require_img')) {
                            return `<span class="badge bg-warning text-dark"><i class="fas fa-image"></i> รอรูปโจทย์</span>`;
                        }
                        return `<img src="${transformUrl(data.split('///')[0])}" class="img-preview-mini">`;
                    }
                },
                {
                    data: 'answer',
                    createdCell: (td) => $(td).attr('data-label', 'Answer'),
                    render: function (data, type, row) {
                        if (!data) return '-';

                        // 1. กรณีระบุว่า "รอรูปภาพ"
                        if (row.choices && row.choices.toLowerCase().includes('require_img')) {
                            return `<div class="text-center">
                                <span class="badge bg-warning text-dark"><i class="fas fa-image"></i> รอรูปช้อยส์</span>
                                <div class="small text-muted mt-1">${data}</div>
                            </div>`;
                        }

                        // 2. กรณีเป็น SVG
                        if (typeof data === 'string' && data.trim().toLowerCase().startsWith('<svg')) {
                            return `<div style="width:30px; height:30px; margin:auto;">${data}</div>`;
                        }

                        // 3. กรณีเป็นลิงก์ (HTTP/Drive)
                        if (typeof data === 'string' && (data.includes('drive.google.com') || data.startsWith('http'))) {

                            // ตรวจสอบว่าเป็นรูปภาพจาก Google Drive หรือไม่ (มี ID ไฟล์)
                            const isDriveImage = data.match(/\/d\/(.*?)\//) || data.match(/id=([^&]+)/);
                            // ตรวจสอบนามสกุลไฟล์ภาพทั่วไป
                            const isDirectImage = data.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i);

                            if (isDriveImage || isDirectImage) {
                                // ถ้าเป็นรูปภาพ -> แสดงเป็นรูป Preview
                                return `<div class="text-center"><img src="${transformUrl(data)}" class="img-preview-mini"></div>`;
                            } else {
                                // ถ้าเป็นลิงก์อื่นๆ (เช่น PDF, Web) -> แสดงเป็นลิงก์ให้คลิก
                                return `<div class="text-center">
                                    <a href="${data}" target="_blank" class="btn btn-sm btn-outline-primary py-0">
                                        <i class="fas fa-external-link-alt me-1"></i>${data}
                                    </a>
                                </div>`;
                            }
                        }

                        // 4. กรณีเป็นข้อความปกติ
                        return data;
                    }
                },
                {
                    data: null,
                    render: function (data, type, row) {
                        return `<button class="btn btn-sm btn-primary" onclick="checkAuthBeforeAction(() => openEditModal('${row.questionId}'))">
                <i class="fas fa-edit"></i>
            </button>`;
                    }
                }
            ]
        });

        // Subject Filter
        $('#db-subject-filter').on('change', function () {
            const selectedSubj = this.value;
            table.column(0).search(selectedSubj).draw();
            updateCategoryDropdown(selectedSubj, '#db-category-filter');
            table.column(1).search('').draw();
        });

        // Category Filter
        $('#db-category-filter').on('change', function () {
            table.column(1).search(this.value).draw();
        });

        // --- ส่วนที่เพิ่มใหม่: Logic กรอง Require Img ---
        $.fn.dataTable.ext.search.push(
            function (settings, data, dataIndex) {
                // ทำงานเฉพาะกับตาราง adminTable เท่านั้น
                if (settings.nTable.id !== 'adminTable') return true;

                const isChecked = $('#db-require-img-filter').is(':checked');
                if (!isChecked) return true; // ถ้าไม่ได้ติ๊ก ให้แสดงทุกแถวตามปกติ

                // ดึงข้อมูลใน Column "Img" (index ที่ 3)
                const imgCol = data[3] || "";
                const ansCol = data[4] || "";
                return imgCol.includes('รอรูปโจทย์') || ansCol.includes('รอรูปช้อยส์');
            }
        );

        // สั่งให้ตารางวาดใหม่เมื่อมีการคลิก Checkbox
        $('#db-require-img-filter').on('change', function () {
            table.draw();
        });
        // ------------------------------------------
    }

function initStructureTables() {
        // ... (โค้ด initStructureTables เดิม) ...
        if (!$.fn.DataTable.isDataTable('#structSubjectTable')) {
            const subjTable = $('#structSubjectTable').DataTable({
                data: globalData.structure,
                columns: [
                    { data: 'Year', defaultContent: '' },
                    { data: 'SubjectID', defaultContent: '' },
                    { data: 'SubjectName', defaultContent: '' },
                    { data: 'AccordionGroup', defaultContent: '' },
                    { data: null, defaultContent: '-' }
                ]
            });

            $('#struct-subject-filter').on('change', function () {
                subjTable.column(1).search(this.value).draw();
            });
        }

        if (!$.fn.DataTable.isDataTable('#structCategoryTable')) {
            $('#structCategoryTable').DataTable({
                data: globalData.category,
                columns: [
                    { data: 'CategoryID', defaultContent: '' },
                    { data: 'SubjectRef', defaultContent: '' },
                    { data: 'AccordionGroup', defaultContent: '' },
                    { data: 'CategoryName', defaultContent: '' },
                    { data: null, defaultContent: '-' }
                ]
            });
        }
        // ... (จบโค้ด initStructureTables เดิม) ...
    }

function initLogsTable() {
        if ($.fn.DataTable.isDataTable('#logsTable')) {
            $('#logsTable').DataTable().clear().rows.add(globalData.logs).draw();
            return;
        }
        $('#logsTable').DataTable({
            data: globalData.logs,
            order: [[0, 'desc']], // เรียงตามเวลาล่าสุด
            columns: [
                {
                    data: 'Timestamp',
                    width: '15%',
                    render: function (data) { return formatDate(data); }
                },
                { data: 'User', width: '10%' },
                {
                    data: 'ActionType',
                    width: '10%',
                    render: function (data) {
                        let badge = 'bg-secondary';
                        const upper = String(data).toUpperCase();
                        if (upper.includes('EDIT') || upper.includes('UPDATE')) badge = 'bg-warning text-dark';
                        if (upper.includes('DELETE') || upper.includes('REJECT')) badge = 'bg-danger';
                        if (upper.includes('ADD') || upper.includes('IMPORT') || upper.includes('REGISTER')) badge = 'bg-success';
                        return `<span class="badge ${badge}">${data}</span>`;
                    }
                },
                { data: 'TargetID', width: '15%' },
                {
                    data: 'Details',
                    width: '35%'
                },
                {
                    // ปุ่มดูความเปลี่ยนแปลง
                    data: null,
                    width: '15%',
                    render: function (data, type, row) {
                        // เช็คว่ามีข้อมูลเปรียบเทียบหรือไม่
                        if ((row.OldValue && row.OldValue !== "") || (row.NewValue && row.NewValue !== "")) {
                            // เก็บข้อมูลไว้ใน data attribute เพื่อดึงไปใช้ตอนคลิก
                            // ต้อง Encode JSON เพื่อป้องกัน error เครื่องหมายคำพูด
                            const oldValSafe = encodeURIComponent(row.OldValue);
                            const newValSafe = encodeURIComponent(row.NewValue);
                            return `<button class="btn btn-sm btn-outline-info" onclick="viewDiff('${oldValSafe}', '${newValSafe}')">
                                    <i class="fas fa-eye"></i> ดูส่วนที่แก้
                                </button>`;
                        }
                        return '-';
                    }
                }
            ]
        });
    }

function viewDiff(oldValEnc, newValEnc) {
        let oldRaw = {}, newRaw = {};


        // 1. Decode & Parse JSON
        try { oldRaw = JSON.parse(decodeURIComponent(oldValEnc)); } catch (e) { oldRaw = decodeURIComponent(oldValEnc); }
        try { newRaw = JSON.parse(decodeURIComponent(newValEnc)); } catch (e) { newRaw = decodeURIComponent(newValEnc); }

        // 2. Normalize Data (แปลง Key ให้เป็นมาตรฐานเดียวกัน เพื่อเปรียบเทียบง่าย)
        const oldObj = normalizeData(oldRaw);
        const newObj = normalizeData(newRaw);

        // 3. Render แต่ละฝั่ง
        $('#diff-container-old').html(renderDiffPanel(oldObj, newObj));
        $('#diff-container-new').html(renderDiffPanel(newObj, oldObj));

        $('#diffModal').modal('show');
    }

function normalizeData(obj) {
        if (!obj || typeof obj !== 'object') return {};

        // Helper แปลง Category String เป็น Array
        let cats = obj.category || obj.Category || [];
        if (typeof cats === 'string') {
            try { cats = JSON.parse(cats); } catch (e) { cats = [cats]; }
        }

        return {
            id: obj.id || obj.QuestionID || obj.questionId || '-',
            problem: obj.problem || obj.Problem || '',
            img: obj.img || obj.Image || '',
            choices: obj.choices || obj.Choices || '',
            answer: obj.answer || obj.Answer || '',
            explain: obj.explain || obj.Explanation || '',
            category: cats
        };
    }

function renderDiffPanel(data, compare) {
        // 1. Header (ID & Category)
        // เทียบ Category (แปลงเป็น string ก่อนเทียบ)
        const catStr = Array.isArray(data.category) ? data.category.join(', ') : String(data.category);
        const compareCatStr = Array.isArray(compare.category) ? compare.category.join(', ') : String(compare.category);
        const isCatChanged = catStr !== compareCatStr;
        const catClass = isCatChanged ? 'diff-changed' : '';

        let html = `
        <h5 class="mb-3">
            <span class="badge bg-secondary me-1">${data.id}</span>
            <span class="badge bg-primary ${catClass}">${catStr || 'No Category'}</span>
        </h5>
    `;

        // 2. Problem Text
        const isProbChanged = data.problem !== compare.problem;
        const probClass = isProbChanged ? 'diff-changed' : '';
        html += `<p class="lead mt-3 ${probClass}" style="font-weight: 500;">${escapeHtml(data.problem) || '-'}</p>`;

        // 3. Images
        const isImgChanged = data.img !== compare.img;
        const imgClass = isImgChanged ? 'diff-changed' : '';
        html += `<div class="text-center mb-3 p-2 ${imgClass}">`;
        if (data.img) {
            const imgs = data.img.split('///').filter(Boolean);
            imgs.forEach(url => {
                html += `<img src="${transformUrl(url)}" class="img-fluid mb-2 border rounded" style="max-height:200px;">`;
            });
        } else {
            html += `<span class="text-muted small font-italic">- ไม่มีรูปภาพ -</span>`;
        }
        html += `</div>`;

        // 4. Choices
        html += `<div class="list-group mb-3">`;

        const choices = (data.choices || "").split('///').map(s => s.trim());
        const compareChoices = (compare.choices || "").split('///').map(s => s.trim());
        const correctAns = (data.answer || "").trim();

        // วนลูปสร้าง Choice (อย่างน้อย 4 ข้อ ถ้าไม่มีข้อมูล)
        const count = Math.max(choices.length, 4);
        for (let i = 0; i < count; i++) {
            const txt = choices[i] || "";
            const compareTxt = compareChoices[i] || "";

            let classes = "list-group-item diff-choice-item";

            // เช็คว่าเฉลยถูกหรือไม่
            if (txt !== "" && txt === correctAns) {
                classes += " diff-correct"; // สีเขียว
            }

            // เช็คว่าข้อความเปลี่ยนหรือไม่
            if (txt !== compareTxt) {
                classes += " diff-changed"; // สีเหลือง (Changed)
            }

            const prefix = String.fromCharCode(65 + i) + ". ";
            html += `<div class="${classes}">${prefix}${escapeHtml(txt) || '<span class="text-muted font-italic">(ว่าง)</span>'}</div>`;
        }
        html += `</div>`;

        // 5. Explanation
        const isExplainChanged = data.explain !== compare.explain;
        const explainClass = isExplainChanged ? 'diff-changed' : '';

        html += `<div class="alert alert-secondary ${explainClass}">
                <strong>Explanation:</strong> 
                <span class="d-block mt-1">${escapeHtml(data.explain) || '-'}</span>
             </div>`;

        return html;
    }

function escapeHtml(text) {
        if (!text) return text;
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
