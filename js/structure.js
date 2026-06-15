// ─────────────────────────────────────────────────────
// JS/STRUCTURE.JS
// ─────────────────────────────────────────────────────

function renderStructureTree(filterSubjectID = "") {
        const container = $('#structure-tree-view');
        container.empty();

        let subjects = globalData.structure;
        if (filterSubjectID) subjects = subjects.filter(s => s.SubjectID === filterSubjectID);

        // Remove duplicate subjects based on SubjectID
        const uniqueSubjects = [];
        const seenSubjectIDs = new Set();

        subjects.forEach(subj => {
            if (!seenSubjectIDs.has(subj.SubjectID)) {
                uniqueSubjects.push(subj);
                seenSubjectIDs.add(subj.SubjectID);
            }
        });

        let treeHtml = '<ul class="tree-view">';

        uniqueSubjects.forEach(subj => {
            // LEVEL 1: SUBJECT
            treeHtml += `
            <li id="node-subj-${subj.SubjectID}">
                <div class="tree-node node-subject">
                    <i class="fas fa-chevron-down toggle-icon" onclick="toggleTreeNode(this)"></i>
                    <i class="fas fa-university me-2 text-primary"></i>
                    <span class="fw-bold">${subj.SubjectID} - ${subj.SubjectName}</span>
                    <div class="node-actions">
                        <button class="btn-node btn-add" onclick="crudAction('addGroup', '${subj.SubjectID}')" title="เพิ่ม Group"><i class="fas fa-plus"></i></button>
                        <button class="btn-node btn-edit" onclick="crudAction('editSubj', '${subj.SubjectID}')"><i class="fas fa-pen"></i></button>
                        <button class="btn-node btn-delete" onclick="crudAction('deleteSubj', '${subj.SubjectID}')"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <ul>`;

            // ดึง Group ทั้งหมดในวิชานี้ (ลบซ้ำ)
            const groups = [...new Set(globalData.category.filter(c => c.SubjectRef === subj.SubjectID).map(c => c.AccordionGroup))].sort();

            groups.forEach(groupName => {
                // LEVEL 2: ACCORDION GROUP
                treeHtml += `
                <li>
                    <div class="tree-node node-group">
                        <i class="fas fa-chevron-down toggle-icon" onclick="toggleTreeNode(this)"></i>
                        <i class="fas fa-layer-group me-2 text-success"></i>
                        <span>${groupName || 'GENERAL'}</span>
                        <div class="node-actions">
                            <button class="btn-node btn-add" onclick="crudAction('addCat', '${subj.SubjectID}', '${groupName}')" title="เพิ่มหัวข้อ"><i class="fas fa-plus"></i></button>
                            <!-- NEW: ปุ่มแก้ไข Group -->
                            <button class="btn-node btn-edit" onclick="crudAction('editGroup', '${subj.SubjectID}', '${groupName}')" title="แก้ไขชื่อ Group"><i class="fas fa-pen"></i></button>
                            <!-- END NEW -->
                            <button class="btn-node btn-delete" onclick="crudAction('deleteGroup', '${subj.SubjectID}', '${groupName}')"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <ul>`;

                // LEVEL 3: CATEGORY (ลบซ้ำ)
                const seenCategoryIDs = new Set();
                const categories = globalData.category.filter(c => {
                    if (c.SubjectRef === subj.SubjectID && c.AccordionGroup === groupName) {
                        if (!seenCategoryIDs.has(c.CategoryID)) {
                            seenCategoryIDs.add(c.CategoryID);
                            return true;
                        }
                    }
                    return false;
                });

                categories.forEach(cat => {
                    treeHtml += `
                    <li>
                        <div class="tree-node node-category">
                            <i class="fas fa-tag me-2 text-secondary"></i>
                            <span class="small"><b>${cat.CategoryID}:</b> ${cat.CategoryName}</span>
                            <div class="node-actions">
                                <button class="btn-node btn-edit" onclick="crudAction('editCat', '${cat.CategoryID}')"><i class="fas fa-pen"></i></button>
                                <button class="btn-node btn-delete" onclick="crudAction('deleteCat', '${cat.CategoryID}')"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>
                    </li>`;
                });

                treeHtml += '</ul></li>';
            });

            treeHtml += '</ul></li>';
        });

        treeHtml += '</ul>';
        container.html(treeHtml);
    }

function toggleTreeNode(el) {
        // ... (โค้ด toggleTreeNode เดิม) ...
        $(el).closest('.tree-node').toggleClass('collapsed');
        // ... (จบโค้ด toggleTreeNode เดิม) ...
    }

async function confirmStrictDelete(itemName, confirmKey) {
        // ... (โค้ด confirmStrictDelete เดิม) ...
        const { value: input } = await Swal.fire({
            title: 'ยืนยันการลบแบบถาวร',
            html: `คุณกำลังจะลบ <b>${itemName}</b> ข้อมูลที่เกี่ยวข้องทั้งหมดจะหายไปรวมถึงโจทย์ที่ผูกอยู่<br><br>กรุณาพิมพ์: <span class="text-danger fw-bold">${confirmKey}</span> เพื่อยืนยัน`,
            input: 'text',
            inputPlaceholder: confirmKey,
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'ยืนยันการลบ',
            inputValidator: (value) => {
                if (!value || value !== confirmKey) {
                    return 'ข้อความยืนยันไม่ถูกต้อง!'
                }
            }
        });
        return !!input;
        // ... (จบโค้ด confirmStrictDelete เดิม) ...
    }

async function crudAction(type, id1, id2) {
        if (!confirmAdmin()) return;

        let payload = { action: '', data: {} };

        switch (type) {
            // ... (Subject CRUD Logic - unchanged) ...
            case 'addSubj':
                // ตรรกะสำหรับการเพิ่มวิชาใหม่
                const { value: subjForm } = await Swal.fire({
                    title: 'เพิ่มวิชาใหม่ (Add Subject)',
                    html: `
                        <div class="text-start">
                            <div class="mb-3">
                                <label class="form-label fw-bold small text-primary">
                                    <i class="fas fa-code me-1"></i>รหัสวิชา (Subject ID)
                                </label>
                                <input id="swal-subj-id" class="form-control form-control-sm" placeholder="เช่น GI, NS, CV" maxlength="5" style="border: 1px solid #ced4da; border-radius: 6px; padding: 0.5rem;">
                            </div>
                            
                            <div class="mb-3">
                                <label class="form-label fw-bold small text-primary">
                                    <i class="fas fa-calendar-alt me-1"></i>ชั้นปี (Year)
                                </label>
                                <input id="swal-subj-year" type="number" class="form-control form-control-sm" placeholder="เช่น 1, 2, 3" style="border: 1px solid #ced4da; border-radius: 6px; padding: 0.5rem;">
                            </div>
                            
                            <div class="mb-2">
                                <label class="form-label fw-bold small text-primary">
                                    <i class="fas fa-book me-1"></i>ชื่อวิชา (Subject Name)
                                </label>
                                <input id="swal-subj-name" class="form-control form-control-sm" placeholder="ชื่อวิชาเต็ม" style="border: 1px solid #ced4da; border-radius: 6px; padding: 0.5rem;">
                            </div>
                        </div>
                    `,
                    focusConfirm: false,
                    showCancelButton: true,
                    confirmButtonText: 'บันทึกวิชาใหม่',
                    preConfirm: () => {
                        const id = document.getElementById('swal-subj-id').value.trim().toUpperCase();
                        const year = document.getElementById('swal-subj-year').value.trim();
                        const name = document.getElementById('swal-subj-name').value.trim();

                        if (!id || !name) {
                            Swal.showValidationMessage('กรุณากรอกรหัสวิชาและชื่อวิชาให้ครบ');
                            return false;
                        }

                        // ตรวจสอบว่า SubjectID ซ้ำหรือไม่
                        const exists = globalData.structure.some(s => s.SubjectID.toUpperCase() === id);
                        if (exists) {
                            Swal.showValidationMessage(`รหัสวิชา ${id} มีอยู่แล้วในระบบ`);
                            return false;
                        }

                        return {
                            SubjectID: id,
                            Year: year || '0', // ให้ค่าเริ่มต้นเป็น '0' ถ้าไม่มีการระบุ
                            SubjectName: name
                        };
                    }
                });

                if (subjForm) {
                    payload.action = 'addSubject';
                    payload.data = subjForm;
                }
                break;

            case 'editSubj':
                // id1 คือ SubjectID
                const subj = globalData.structure.find(s => s.SubjectID === id1);
                if (!subj) {
                    Swal.fire('Error', `ไม่พบวิชา ${id1} ในโครงสร้าง`, 'error');
                    return;
                }

                const { value: editSubjForm } = await Swal.fire({
                    title: `แก้ไขวิชา ${id1}`,
                    html: `
                        <div class="text-start">
                            <div class="mb-3">
                                <label class="form-label fw-bold small text-primary">
                                    <i class="fas fa-code me-1"></i>รหัสวิชา (Subject ID)
                                </label>
                                <input id="swal-subj-id" class="form-control form-control-sm bg-light" readonly value="${subj.SubjectID}" style="border: 1px solid #dee2e6; border-radius: 6px;">
                            </div>
                            
                            <div class="mb-3">
                                <label class="form-label fw-bold small text-primary">
                                    <i class="fas fa-calendar-alt me-1"></i>ชั้นปี (Year)
                                </label>
                                <input id="swal-subj-year" type="number" class="form-control form-control-sm" placeholder="เช่น 1, 2, 3" value="${subj.Year || ''}" style="border: 1px solid #ced4da; border-radius: 6px; padding: 0.5rem;">
                            </div>
                            
                            <div class="mb-2">
                                <label class="form-label fw-bold small text-primary">
                                    <i class="fas fa-book me-1"></i>ชื่อวิชา (Subject Name)
                                </label>
                                <input id="swal-subj-name" class="form-control form-control-sm" placeholder="ชื่อวิชาเต็ม" value="${subj.SubjectName || ''}" style="border: 1px solid #ced4da; border-radius: 6px; padding: 0.5rem;">
                            </div>
                        </div>
                    `,
                    focusConfirm: false,
                    showCancelButton: true,
                    confirmButtonText: 'บันทึกการแก้ไข',
                    preConfirm: () => {
                        const year = document.getElementById('swal-subj-year').value;
                        const name = document.getElementById('swal-subj-name').value.trim();

                        if (!name) {
                            Swal.showValidationMessage('กรุณากรอกชื่อวิชา');
                            return false;
                        }

                        return {
                            SubjectID: id1,
                            Year: year,
                            SubjectName: name
                        };
                    }
                });

                if (editSubjForm) {
                    payload.action = 'updateSubject';
                    payload.data = editSubjForm;
                }
                break;

            case 'deleteSubj':
                // ... (Delete Subject Logic) ...
                if (await confirmStrictDelete(`วิชา ${id1}`, id1)) {
                    payload.action = 'deleteSubject';
                    payload.data = { SubjectID: id1 };
                }
                break;

            // --- GROUP CRUD ---
            case 'addGroup':
                // ... (Add Group Logic - unchanged) ...
                const { value: newGroup } = await Swal.fire({
                    title: 'เพิ่มกลุ่มในวิชา ' + id1,
                    input: 'text',
                    inputPlaceholder: 'เช่น MCQ1,MCQ2,MCQ3,MCQ4,FMT1,FMT2,by AI',
                    showCancelButton: true
                });
                if (newGroup) {
                    // การเพิ่ม Group คือการเพิ่ม Category แรกเข้าไปใน Group นั้น
                    payload.action = 'addCategory';
                    payload.data = {
                        CategoryID: `${id1}_${newGroup.replace(/\s+/g, '')}_Init`,
                        SubjectRef: id1,
                        AccordionGroup: newGroup,
                        CategoryName: 'Default Title'
                    };
                }
                break;

            case 'editGroup':
                const { value: newGroupName } = await Swal.fire({
                    title: `เปลี่ยนชื่อกลุ่ม "${id2}" ในวิชา ${id1}`,
                    input: 'text',
                    inputValue: id2,
                    inputPlaceholder: 'ชื่อกลุ่มใหม่',
                    showCancelButton: true
                });

                if (newGroupName && newGroupName !== id2) {
                    payload.action = 'updateAccordionGroup';
                    payload.data = {
                        SubjectRef: id1,
                        OldAccordionGroup: id2,
                        NewAccordionGroup: newGroupName.trim()
                    };
                }
                break;

            case 'deleteGroup':
                // ... (Delete Group Logic - unchanged) ...
                if (await confirmStrictDelete(`กลุ่ม ${id2} ในวิชา ${id1}`, 'ลบกลุ่ม')) {
                    payload.action = 'deleteGroup';
                    payload.data = { SubjectRef: id1, AccordionGroup: id2 };
                }
                break;

            // ... (Category CRUD Logic - unchanged) ...
            case 'addCat':
                openAddCategoryModal(id1, id2);
                break;

            case 'deleteCat':
                // ... (Delete Category Logic) ...
                if (await confirmStrictDelete(`หัวข้อ ${id1}`, 'DELETE')) {
                    payload.action = 'deleteCategory';
                    payload.data = { CategoryID: id1 };
                }
                break;

            case 'editCat':
                // ... (Edit Category Logic) ...
                const cat = globalData.category.find(c => c.CategoryID === id1);
                const { value: catEdit } = await Swal.fire({
                    title: 'แก้ไขหัวข้อ ' + id1,
                    input: 'text',
                    inputValue: cat ? cat.CategoryName : '',
                    inputPlaceholder: 'Display Name',
                    showCancelButton: true
                });
                if (catEdit) {
                    payload.action = 'updateCategory';
                    payload.data = { CategoryID: id1, CategoryName: catEdit };
                }
                break;
        }

        if (payload.action) {
            await sendAdminAction(payload.action, payload.data);
        }
    }

function confirmDelete(text) {
        // ... (โค้ด confirmDelete เดิม) ...
        return Swal.fire({
            title: 'ยืนยันการลบ?',
            text: text,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33'
        }).then(res => res.isConfirmed);
        // ... (จบโค้ด confirmDelete เดิม) ...
    }

function editCategoryInline(catID) {
        // ... (โค้ด editCategoryInline เดิม) ...
        const cat = globalData.category.find(c => c.CategoryID === catID);
        if (!cat) return;

        Swal.fire({
            title: 'แก้ไขหัวข้อ',
            html: `
                <input id="swal-cat-name" class="swal2-input" placeholder="Display Name" value="${cat.CategoryName}">
                <input id="swal-cat-group" class="swal2-input" placeholder="Accordion Group" value="${cat.AccordionGroup}">
            `,
            showCancelButton: true,
            confirmButtonText: 'บันทึก',
            preConfirm: () => {
                return {
                    CategoryName: document.getElementById('swal-cat-name').value,
                    AccordionGroup: document.getElementById('swal-cat-group').value
                }
            }
        }).then((result) => {
            if (result.isConfirmed) {
                Swal.fire('กำลังพัฒนา', 'ระบบบันทึกการแก้ไขหัวข้อกำลังอยู่ในการดำเนินการ', 'info');
            }
        });
        // ... (จบโค้ด editCategoryInline เดิม) ...
    }

async function saveNewCategory() {
        // ... (โค้ด saveNewCategory เดิม) ...
        if (!confirmAdmin()) return;
        const payload = {
            CategoryID: $('#new-category-id').val(),
            SubjectRef: $('#new-category-subject').val(),
            AccordionGroup: $('#new-category-group').val(),
            CategoryName: $('#new-category-name').val()
        };
        await sendAdminAction('addCategory', payload);
        $('#addCategoryModal').modal('hide');
        // ... (จบโค้ด saveNewCategory เดิม) ...
    }

function generateCategoryIDPreview() {
        // ... (โค้ด generateCategoryIDPreview เดิม) ...
        const subj = $('#new-category-subject').val();
        const name = $('#new-category-name').val();
        if (subj && name) {
            const cleanName = name.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
            $('#new-category-id').val(`${subj}_${cleanName}`);
        }
        // ... (จบโค้ด generateCategoryIDPreview เดิม) ...
    }

function openAddCategoryModal(subjectId = null, groupName = null) {
        const subjects = [...new Set(globalData.structure.map(s => s.SubjectID))];
        let opts = '<option value="">-- Select Subject --</option>';
        // ใช้ template literal เพื่อตรวจสอบและตั้งค่า 'selected'
        subjects.forEach(s => opts += `<option value="${s}" ${subjectId === s ? 'selected' : ''}>${s}</option>`);

        $('#new-category-subject').html(opts);

        // ตั้งค่า Group และ Name (Name จะถูกเคลียร์เสมอ)
        $('#new-category-group').val(groupName || '');
        $('#new-category-name').val('');
        $('#new-category-id').val('');
        $('#category-id-error').text('');

        // ถ้ามีการ Pre-fill Subject ให้ลอง Generate ID ทันที
        if (subjectId) {
            generateCategoryIDPreview();
        }

        $('#addCategoryModal').modal('show');
    }

const BULK_GROUP_MAP = {
    ANA:      subj => `${subj} ANATOMY`,
    PHYSIO:   subj => `${subj} PHYSIO and BIOCHEM`,
    BIOCHEM:  subj => `${subj} PHYSIO and BIOCHEM`,
    MICRO:    subj => `${subj} PARASITO and MICRO`,
    PARASITO: subj => `${subj} PARASITO and MICRO`,
    PATHO:    subj => `${subj} PATHO`,
    PHARM:    subj => `${subj} PHARM`,
    RADIO:    subj => `${subj} RADIO and CLINICAL`,
    CLINICAL: subj => `${subj} RADIO and CLINICAL`,
};

function toggleBulkImport() {
    const panel = document.getElementById('bulk-import-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    document.getElementById('bulk-preview-area').innerHTML = '';
    document.getElementById('bulk-confirm-btn').style.display = 'none';
}

function previewBulkImport() {
    const subjectRef = document.getElementById('bulk-subject-id').value.trim().toUpperCase();
    const text = document.getElementById('bulk-topic-text').value;
    const year = parseInt(document.querySelector('input[name="bulk-year-level"]:checked').value);

    if (!subjectRef) {
        Swal.fire('ข้อผิดพลาด', 'กรุณาระบุ Subject ID', 'warning');
        return;
    }

    const parsed = parseLecTopics(subjectRef, text, year);
    if (!parsed.length) {
        document.getElementById('bulk-preview-area').innerHTML = '<p class="text-danger small mt-2">ไม่พบหัวข้อในรูปแบบ <code>LEC_DISCIPLINE_Topic Name</code></p>';
        document.getElementById('bulk-confirm-btn').style.display = 'none';
        return;
    }

    const existingIDs = new Set(globalData.category.map(c => c.CategoryID));
    let rows = parsed.map(c => {
        const dup = existingIDs.has(c.CategoryID);
        return `<tr class="${dup ? 'table-warning' : ''}">
            <td class="small">${c.CategoryID}</td>
            <td class="small">${c.AccordionGroup}</td>
            <td class="small">${c.CategoryName}</td>
            <td class="small">${dup ? '<span class="badge bg-warning text-dark">ซ้ำ</span>' : '<span class="badge bg-success">ใหม่</span>'}</td>
        </tr>`;
    }).join('');

    const newCount = parsed.filter(c => !existingIDs.has(c.CategoryID)).length;
    document.getElementById('bulk-preview-area').innerHTML = `
        <p class="small mb-2">พบ <b>${parsed.length}</b> หัวข้อ — ใหม่ <b class="text-success">${newCount}</b> / ซ้ำ <b class="text-warning">${parsed.length - newCount}</b></p>
        <div style="max-height:300px;overflow-y:auto;">
        <table class="table table-sm table-bordered small mb-0">
            <thead class="table-dark"><tr><th>CategoryID</th><th>AccordionGroup</th><th>CategoryName</th><th>สถานะ</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;

    document.getElementById('bulk-confirm-btn').style.display = newCount > 0 ? 'inline-block' : 'none';
    document.getElementById('bulk-confirm-btn').dataset.subjectRef = subjectRef;
}

async function confirmBulkImport() {
    const subjectRef = document.getElementById('bulk-confirm-btn').dataset.subjectRef;
    const text = document.getElementById('bulk-topic-text').value;
    const year = parseInt(document.querySelector('input[name="bulk-year-level"]:checked').value);
    const parsed = parseLecTopics(subjectRef, text, year);
    const existingIDs = new Set(globalData.category.map(c => c.CategoryID));
    const toInsert = parsed.filter(c => !existingIDs.has(c.CategoryID));

    if (!toInsert.length) return;

    const { isConfirmed } = await Swal.fire({
        title: `นำเข้า ${toInsert.length} หัวข้อ?`,
        text: `SubjectRef: ${subjectRef}`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'นำเข้าเลย'
    });
    if (!isConfirmed) return;

    let done = 0;
    for (const cat of toInsert) {
        await sendAdminAction('addCategory', cat, true);
        done++;
    }

    await Swal.fire('สำเร็จ', `นำเข้า ${done} หัวข้อเรียบร้อย`, 'success');
    toggleBulkImport();
    renderStructureTree(subjectRef);
}

function parseLecTopics(subjectRef, text, year = 2) {
    if (year === 1) {
        return text.split('\n')
            .map(l => l.trim())
            .filter(l => /^LEC_.+/.test(l))
            .map(line => {
                const m = line.match(/^LEC_(.+)$/);
                if (!m) return null;
                const topicName = m[1].trim();
                return {
                    CategoryID:    `${subjectRef}_LEC_${topicName}`,
                    SubjectRef:    subjectRef,
                    AccordionGroup: `${subjectRef} LEC`,
                    CategoryName:  topicName
                };
            })
            .filter(Boolean);
    }
    return text.split('\n')
        .map(l => l.trim())
        .filter(l => /^LEC_[A-Z]+_.+/.test(l))
        .map(line => {
            const m = line.match(/^LEC_([A-Z]+)_(.+)$/);
            if (!m) return null;
            const discipline = m[1];
            const topicName = m[2].trim();
            const groupFn = BULK_GROUP_MAP[discipline];
            return {
                CategoryID:    `${subjectRef}_${discipline}_${topicName}`,
                SubjectRef:    subjectRef,
                AccordionGroup: groupFn ? groupFn(subjectRef) : `${subjectRef} ${discipline}`,
                CategoryName:  topicName
            };
        })
        .filter(Boolean);
}
