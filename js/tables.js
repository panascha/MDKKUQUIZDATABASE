// ─────────────────────────────────────────────────────
// JS/TABLES.JS
// ─────────────────────────────────────────────────────

// Set ของ questionId ที่มี Report ค้างอยู่ — สร้างใหม่ก่อน draw ทุกครั้ง (ดูใน preDrawCallback ของ initAdminTable)
let _reportedQIds = new Set();

// ตัวเลือกหลายแถวของ #adminTable (createBulkSelection จาก bulk-select.js) — สร้างใน initAdminTable
let dbBulk = null;
let _bulkBusy = false;

function setTableView(tableId, mode, btn) {
        const $table = $('#' + tableId);

        // 1. จัดการ UI ของปุ่ม (Siblings คือปุ่มข้างๆ ในกลุ่มเดียวกัน)
        if (btn) {
            $(btn).parent().find('.btn').removeClass('active');
            $(btn).addClass('active');
        }

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
        try {
            if ($.fn.DataTable.isDataTable('#' + tableId)) {
                const dt = $('#' + tableId).DataTable();
                dt.columns.adjust().draw(); // คำนวณความกว้างใหม่
            }
        } catch (e) {
            // ignore errors when table id isn't fully initialized yet
            console.warn('setTableView: DataTable adjust failed for', tableId, e);
        }
    }

// ปุ่มในแถว: id อยู่ใน data-qid (ไม่ฝังใน inline onclick — id ที่มี ' จะหลุดออกจากสตริงได้)
$(document).on('click', '.js-q-detail', function () {
    showQuestionDetail($(this).attr('data-qid'));
});
$(document).on('click', '.js-q-edit', function () {
    const qid = $(this).attr('data-qid');
    checkAuthBeforeAction(() => openEditModal(qid));
});
// ป้าย REPORT ในตาราง Database → ไป Report Inbox แล้วกรองเหลือเฉพาะข้อนั้น
$(document).on('click', '.js-q-report', function () {
    const qid = $(this).attr('data-qid');
    showSection('report-inbox');
    $('#report-search-input').val(qid);
    applyReportSearch();
});

// questionId ของข้อที่มี Report ค้างอยู่ — ใช้ทั้งป้าย REPORT และตัวกรอง "มี Report ค้าง"
function buildReportedQIds() {
    return new Set(
        (globalData.report || [])
            .filter(r => window.isPendingReport(r))
            .map(r => r.QuestionID)
    );
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
                        const subj = getSubjectFromCategory(row.category);
                        return type === 'display' ? escapeHtml(subj) : subj;
                    }
                },
                {
                    data: 'category',
                    defaultContent: '-',
                    createdCell: (td) => $(td).attr('data-label', 'Category'),
                    render: function (data, type) {
                        if (!data) return '-';
                        const cats = Array.isArray(data) ? data.join(', ') : data;
                        return type === 'display' ? escapeHtml(cats) : cats;
                    }
                },
                {
                    data: 'problem',
                    createdCell: (td) => $(td).attr('data-label', 'Question'),
                    render: $.fn.dataTable.render.text()
                },
                {
                    data: 'img',
                    createdCell: (td) => $(td).attr('data-label', 'Image'),
                    render: function (data) {
                        if (!data) return '-';
                        let firstImg = data.split('///')[0];
                        return `<img src="${escapeHtml(transformUrl(firstImg))}" class="img-preview-mini">`;
                    }
                },
                {
                    data: 'answer',
                    createdCell: (td) => $(td).attr('data-label', 'Answer'), // เพิ่มบรรทัดนี้
                    render: function (data, type) {
                        if (type !== 'display' || typeof data !== 'string') return data;
                        // ช้อยส์ที่เป็น SVG แสดงเป็นรูปตามเดิม — ที่เหลือเป็นข้อความล้วน
                        return data.trim().toLowerCase().startsWith('<svg') ? svgAsImg(data, 'max-height:40px;') : escapeHtml(data);
                    }
                },
                {
                    data: null,
                    render: function (data, type, row) {
                        if (isAdmin) {
                            return `<div class="btn-group">
                <button class="btn btn-sm btn-outline-secondary js-q-detail" data-qid="${escapeHtml(row.questionId)}"><i class="fas fa-eye"></i></button>
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

// รูปโจทย์ในตาราง: lazy-load, สูงสุด 3 รูปต่อแถว + ป้าย +N
function adminThumbsHtml(imgField) {
        const urls = String(imgField).split('///').map(s => s.trim()).filter(Boolean);
        if (!urls.length) return '-';
        const shown = urls.slice(0, 3).map(u => `<img src="${escapeHtml(transformUrl(u))}" class="img-preview-mini me-1" loading="lazy">`).join('');
        const more = urls.length > 3 ? `<span class="badge bg-secondary">+${urls.length - 3}</span>` : '';
        return shown + more;
    }

function initAdminTable() {
        if ($.fn.DataTable.isDataTable('#adminTable')) return;

        const table = $('#adminTable').DataTable({
            stateSave: true,
            deferRender: true,
            lengthMenu: [10, 25, 50, 100],
            data: globalData.questions,
            preDrawCallback: function () {
                // สร้าง Set ของ questionId ที่มี Report ค้างอยู่ก่อน draw ทุกครั้ง (แทนการ .some() ต่อแถว)
                _reportedQIds = buildReportedQIds();
            },
            order: [[1, 'asc']], // คอลัมน์ 0 = checkbox — คงการเรียงเริ่มต้นเดิม (Subject)
            columns: [
                {
                    data: null,
                    orderable: false,
                    searchable: false,
                    createdCell: (td) => $(td).attr('data-label', 'Select'),
                    render: function (data, type, row) {
                        if (type !== 'display') return '';
                        const id = String(row.questionId);
                        return `<input type="checkbox" class="form-check-input bulk-check" data-id="${escapeHtml(id)}"${dbBulk && dbBulk.ids.has(id) ? ' checked' : ''}>`;
                    }
                },
                {
                    data: null,
                    render: function (data, type, row) {
                        // --- เพิ่มส่วนเช็ค Report ค้าง ---
                        // ป้ายเฉพาะตอนแสดงผล — ไม่ให้ HTML/qid ของป้ายปนเข้าข้อมูล search/sort ของคอลัมน์วิชา
                        const hasReport = type === 'display' && _reportedQIds.has(row.questionId);

                        const reportBadge = hasReport
                            ? `<button type="button" class="badge bg-primary border-0 pulse-animation js-q-report" data-qid="${escapeHtml(row.questionId)}" title="มีรายงานปัญหาค้างอยู่ — คลิกเพื่อเปิดใน Report Inbox"><i class="fas fa-exclamation-circle"></i> REPORT</button> `
                            : '';

                        const subj = getSubjectFromCategory(row.category);
                        return reportBadge + (type === 'display' ? escapeHtml(subj) : subj);
                    }
                },
                {
                    data: 'category',
                    createdCell: (td) => $(td).attr('data-label', 'Category'), // เพิ่มบรรทัดนี้
                    render: function (data, type) {
                        if (!data) return '-';
                        const cats = Array.isArray(data) ? data.join(', ') : data;
                        return type === 'display' ? escapeHtml(cats) : cats;
                    }
                },
                {
                    data: 'problem',
                    createdCell: (td) => $(td).attr('data-label', 'Question'), // เพิ่มบรรทัดนี้
                    defaultContent: '',
                    render: $.fn.dataTable.render.text()
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
                        return adminThumbsHtml(data);
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
                                <div class="small text-muted mt-1">${escapeHtml(data)}</div>
                            </div>`;
                        }

                        // 2. กรณีเป็น SVG
                        if (typeof data === 'string' && data.trim().toLowerCase().startsWith('<svg')) {
                            return `<div style="width:30px; height:30px; margin:auto;">${svgAsImg(data, 'width:100%; height:100%;')}</div>`;
                        }

                        // 3. กรณีเป็นลิงก์ (HTTP/Drive)
                        if (typeof data === 'string' && (data.includes('drive.google.com') || data.startsWith('http'))) {

                            // ตรวจสอบว่าเป็นรูปภาพจาก Google Drive หรือไม่ (มี ID ไฟล์)
                            const isDriveImage = data.match(/\/d\/(.*?)\//) || data.match(/id=([^&]+)/);
                            // ตรวจสอบนามสกุลไฟล์ภาพทั่วไป
                            const isDirectImage = data.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i);

                            if (isDriveImage || isDirectImage) {
                                // ถ้าเป็นรูปภาพ -> แสดงเป็นรูป Preview
                                return `<div class="text-center"><img src="${escapeHtml(transformUrl(data))}" class="img-preview-mini" loading="lazy"></div>`;
                            } else {
                                // ถ้าเป็นลิงก์อื่นๆ (เช่น PDF, Web) -> แสดงเป็นลิงก์ให้คลิก
                                return `<div class="text-center">
                                    <a href="${/^https?:\/\//i.test(data) ? escapeHtml(data) : '#'}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-primary py-0">
                                        <i class="fas fa-external-link-alt me-1"></i>${escapeHtml(data)}
                                    </a>
                                </div>`;
                            }
                        }

                        // 4. กรณีเป็นข้อความปกติ
                        return type === 'display' ? escapeHtml(data) : data;
                    }
                },
                {
                    data: null,
                    render: function (data, type, row) {
                        return `<button class="btn btn-sm btn-primary js-q-edit" data-qid="${escapeHtml(row.questionId)}">
                <i class="fas fa-edit"></i>
            </button>`;
                    }
                }
            ]
        });

        // รูปโหลดไม่ขึ้น (ลบ/ติด permission/Drive throttle) → ป้าย "รูปเสีย" — เฉพาะแถวที่แสดงอยู่ ไม่สแกนทั้งคลัง
        // error ไม่ bubble จึงต้องดักแบบ capture ที่ tbody
        $('#adminTable tbody')[0].addEventListener('error', function (e) {
            const img = e.target;
            if (!img || img.tagName !== 'IMG' || !img.classList.contains('img-preview-mini')) return;
            const badge = document.createElement('span');
            badge.className = 'badge bg-danger img-broken-badge';
            badge.title = img.getAttribute('src') || '';
            badge.innerHTML = '<i class="fas fa-image"></i> รูปเสีย';
            img.replaceWith(badge);
        }, true);

        // Multi-select (bulk-select.js) — state เป็น Set ของ questionId, ไม่ผูกกับ index ของแถว
        dbBulk = createBulkSelection({ container: '#adminTable', rowSelector: 'tr', idAttr: 'data-id', onChange: updateBulkBar });
        table.on('draw.dt', () => dbBulk.refresh()); // แถวที่ DataTables cache ไว้อาจค้างสถานะ checked เก่า
        dbBulk.refresh();

        // Subject Filter (คอลัมน์ 0 = checkbox → Subject = 1, Category = 2)
        $('#db-subject-filter').on('change', function () {
            const selectedSubj = this.value;
            table.column(1).search(selectedSubj).draw();
            updateCategoryDropdown(selectedSubj, '#db-category-filter');
            table.column(2).search('').draw();
        });

        // Category Filter
        $('#db-category-filter').on('change', function () {
            table.column(2).search(this.value).draw();
        });

        // --- Quick filters: กรองจากข้อมูลแถว (rowData) ไม่ใช่ข้อความ HTML ที่ render แล้ว ---
        // อ่านสถานะตัวกรองครั้งเดียวต่อ draw (ตอน change) ไม่ query DOM ต่อแถว — ตารางมีข้อทั้งคลัง
        const quickFilters = { requireImg: false, noImg: false, hasReport: false, source: '' };
        const readQuickFilters = () => {
            quickFilters.requireImg = $('#db-require-img-filter').is(':checked');
            quickFilters.noImg = $('#db-no-img-filter').is(':checked');
            quickFilters.hasReport = $('#db-has-report-filter').is(':checked');
            quickFilters.source = $('#db-source-filter').val() || '';
            if (quickFilters.hasReport) _reportedQIds = buildReportedQIds(); // ext.search รันก่อน preDrawCallback
        };
        readQuickFilters();

        $.fn.dataTable.ext.search.push(
            function (settings, data, dataIndex, row) {
                // ทำงานเฉพาะกับตาราง adminTable เท่านั้น
                if (settings.nTable.id !== 'adminTable') return true;
                const f = quickFilters;
                if (!f.requireImg && !f.noImg && !f.hasReport && !f.source) return true;

                if (f.requireImg) {
                    const waiting = String(row.img || '').toLowerCase().includes('require_img') ||
                        String(row.choices || '').toLowerCase().includes('require_img');
                    if (!waiting) return false;
                }
                if (f.noImg && String(row.img || '').trim() !== '') return false;
                if (f.hasReport && !_reportedQIds.has(row.questionId)) return false;
                if (f.source) {
                    // ไม่มีฟิลด์ "สร้างโดย AI" — อนุมานจาก category id ที่มีคำว่า "by AI"
                    const cats = Array.isArray(row.category) ? row.category : [row.category];
                    const isAi = cats.some(c => String(c || '').includes('by AI'));
                    if (isAi !== (f.source === 'ai')) return false;
                }
                return true;
            }
        );

        $('#db-require-img-filter, #db-no-img-filter, #db-has-report-filter, #db-source-filter').on('change', function () {
            readQuickFilters();
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

// ── Logs UX: แท็บกรอง / ผู้ใช้ / ช่วงวันที่ / โหลดเพิ่ม / CSV ──
// กรองจากข้อมูลแถว (rowData) ไม่ใช่ HTML — ActionGroup ไม่มีคอลัมน์แสดงแต่อยู่ใน rowData
const LOG_SYSTEM_TYPES = new Set(['REPORT_AUTOFIX', 'VOTE_CONFIRM', 'GENERATE', 'INDEX', 'POSTGRES_MIRROR_FAIL']);
const LOG_PAGE_SIZE = 300;
const logFilter = { tab: 'all', user: '', from: '', to: '' };
let _logsExhausted = false; // getLogsPage ตอบน้อยกว่า limit แล้ว = ไม่มี log เก่ากว่านี้
let _logsLoadingMore = false;

function logRowGroup(r) { return String(r.ActionGroup || '').toUpperCase(); }
function logRowType(r) { return String(r.ActionType || '').toUpperCase(); }

// REPORT_AUTOFIX / VOTE_CONFIRM อยู่ทั้งแท็บ "ข้อมูล" และ "ระบบ" (ตามแผน)
function logMatchesTab(r, tab) {
        const g = logRowGroup(r), t = logRowType(r);
        const isSystem = g === 'SYSTEM' || String(r.User || '').toUpperCase() === 'SYSTEM' || LOG_SYSTEM_TYPES.has(t);
        if (tab === 'login') return g === 'AUTH';
        if (tab === 'system') return isSystem;
        if (tab === 'data') return g !== 'AUTH' && g !== 'SYSTEM' && t !== 'GENERATE' && t !== 'INDEX' && t !== 'POSTGRES_MIRROR_FAIL';
        return true;
    }

$.fn.dataTable.ext.search.push(function (settings, data, dataIndex, row) {
        if (settings.nTable.id !== 'logsTable') return true;
        if (logFilter.tab !== 'all' && !logMatchesTab(row, logFilter.tab)) return false;
        if (logFilter.user && String(row.User || '') !== logFilter.user) return false;
        if (logFilter.from || logFilter.to) {
            const ts = new Date(row.Timestamp).getTime();
            if (isNaN(ts)) return false;
            if (logFilter.from && ts < new Date(logFilter.from + 'T00:00:00').getTime()) return false;
            if (logFilter.to && ts > new Date(logFilter.to + 'T23:59:59.999').getTime()) return false;
        }
        return true;
    });

// จำนวนบนแท็บ + รายชื่อผู้ใช้ + ปุ่มโหลดเพิ่ม — เรียกหลังข้อมูลใน globalData.logs เปลี่ยน
function updateLogsToolbar() {
        const logs = globalData.logs || [];
        ['all', 'data', 'login', 'system'].forEach(tab => {
            $(`#log-tab-count-${tab}`).text(logs.filter(r => logMatchesTab(r, tab)).length);
        });
        const users = [...new Set(logs.map(r => String(r.User || '')).filter(Boolean))].sort();
        const $sel = $('#log-user-filter');
        const cur = logFilter.user;
        $sel.html('<option value="">ทุกผู้ใช้</option>' + users.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join(''));
        if (users.includes(cur)) $sel.val(cur); else logFilter.user = '';
        $('#log-load-more').toggleClass('hidden', _logsExhausted || logs.length < LOG_PAGE_SIZE);
    }

// log เก่ากว่าที่โหลดอยู่ — getLogsPage (DEVELOPER-only); 'forbidden' ≠ session_expired จึงไม่ถูก logout
async function loadOlderLogs() {
        if (_logsLoadingMore) return;
        _logsLoadingMore = true;
        const $btn = $('#log-load-more').prop('disabled', true);
        try {
            const res = await sendWithRetry({
                action: 'getLogsPage',
                username: currentUser.username,
                adminPass: adminPass,
                offset: (globalData.logs || []).length,
                limit: LOG_PAGE_SIZE
            });
            if (res && res.result === 'success' && Array.isArray(res.logs)) {
                globalData.logs = (globalData.logs || []).concat(res.logs);
                if (res.logs.length < LOG_PAGE_SIZE) _logsExhausted = true;
                if ($.fn.DataTable.isDataTable('#logsTable')) {
                    $('#logsTable').DataTable().rows.add(res.logs).draw(false);
                }
                updateLogsToolbar();
            } else if (res && res.message === 'forbidden') {
                Swal.fire('ไม่มีสิทธิ์', 'การดู log ย้อนหลังจำกัดเฉพาะ DEVELOPER', 'warning');
            } else if (res && (res.message === 'session_expired' || res.message === 'token_expired')) {
                // api.js จัดการ logout ให้แล้ว — ไม่ต้องแสดง error ซ้ำ
            } else {
                Swal.fire('โหลดไม่สำเร็จ', (res && res.message) || 'ไม่สามารถโหลด log เพิ่มได้', 'error');
            }
        } catch (e) {
            console.warn('[loadOlderLogs]', e);
            Swal.fire('โหลดไม่สำเร็จ', 'การเชื่อมต่อผิดพลาด', 'error');
        } finally {
            _logsLoadingMore = false;
            $btn.prop('disabled', false);
        }
    }

// CSV (UTF-8 BOM เปิดภาษาไทยใน Excel ได้) — เฉพาะแถวที่ผ่านตัวกรองอยู่ตอนนี้
function exportLogsCsv() {
        if (!$.fn.DataTable.isDataTable('#logsTable')) return;
        const withValues = $('#log-export-values').is(':checked');
        const cols = ['Timestamp', 'User', 'Role', 'ActionGroup', 'ActionType', 'TargetID', 'Details'];
        if (withValues) cols.push('OldValue', 'NewValue');
        const cell = v => {
            let s = (v === null || v === undefined) ? '' : String(v);
            if (/^[=+\-@]/.test(s)) s = "'" + s; // กัน formula injection
            return '"' + s.replace(/"/g, '""') + '"';
        };
        const rows = $('#logsTable').DataTable().rows({ search: 'applied' }).data().toArray();
        const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => cell(r[c])).join(','))).join('\r\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'admin-logs-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

// ── Database export (JSON / CSV) ──
// แหล่งแถวที่จะ export: แถวที่ผ่าน search + quick filters ตอนนี้ (ทุกหน้า)
// selectedOnly = เฉพาะ id ที่เลือกไว้ (รวมข้อที่ถูกตัวกรองซ่อนอยู่ — selection ไม่ผูกกับตัวกรอง)
function getExportRows(selectedOnly) {
        if (!$.fn.DataTable.isDataTable('#adminTable')) return [];
        const dt = $('#adminTable').DataTable();
        if (selectedOnly) {
            if (!dbBulk) return [];
            return dt.rows().data().toArray().filter(r => dbBulk.ids.has(String(r.questionId)));
        }
        return dt.rows({ search: 'applied' }).data().toArray();
    }

// CSV: quote ทุกเซลล์, "" แทน ", คง \n ในเซลล์; array (category) รวมด้วย /// ให้ตรงกับ delimiter ของข้อมูล
function buildQuestionsCsv(rows) {
        const cols = [];
        rows.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k); }));
        const cell = v => {
            if (v === null || v === undefined) v = '';
            else if (Array.isArray(v)) v = v.join('///');
            else if (typeof v === 'object') v = JSON.stringify(v);
            return '"' + String(v).replace(/"/g, '""') + '"';
        };
        const csv = [cols.map(cell).join(',')].concat(rows.map(r => cols.map(c => cell(r[c])).join(','))).join('\r\n');
        return '﻿' + csv;
    }

function downloadBlob(text, mime, filename) {
        const blob = new Blob([text], { type: mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

function exportQuestions(format, selectedOnly) {
        const rows = getExportRows(selectedOnly);
        if (!rows.length) { Swal.fire('ไม่มีข้อมูล', selectedOnly ? 'ยังไม่ได้เลือกข้อสอบ' : 'ไม่มีข้อสอบที่ตรงกับตัวกรองตอนนี้', 'info'); return; }
        const subj = selectedOnly ? 'selected' : ($('#db-subject-filter').val() || '').replace(/[^\w฀-๿-]+/g, '_');
        const base = 'questions-' + (subj ? subj + '-' : '') + new Date().toISOString().slice(0, 10);
        if (format === 'json') downloadBlob(JSON.stringify(rows, null, 2), 'application/json;charset=utf-8', base + '.json');
        else downloadBlob(buildQuestionsCsv(rows), 'text/csv;charset=utf-8', base + '.csv');
    }

$(document).on('click', '#db-export-json', () => exportQuestions('json'));
$(document).on('click', '#db-export-csv', () => exportQuestions('csv'));

// ── Bulk select (#adminTable) ──
// questionId ของทุกแถวที่ผ่าน search + quick filters ตอนนี้ (ทุกหน้า) — ที่มาของ "เลือกทั้งหมดที่กรองอยู่"
function getFilteredQuestionIds() {
        if (!$.fn.DataTable.isDataTable('#adminTable')) return [];
        return $('#adminTable').DataTable().rows({ search: 'applied' }).data().toArray().map(r => String(r.questionId));
    }

// onChange ของ createBulkSelection: แถบ bulk + สถานะ checkbox "เลือกทั้งหมด" (เต็ม/บางส่วน/ว่าง)
function updateBulkBar(ids) {
        $('#db-bulk-count').text(ids.size);
        $('#db-bulk-bar').toggleClass('hidden', ids.size === 0);
        const filtered = getFilteredQuestionIds();
        let sel = 0;
        filtered.forEach(id => { if (ids.has(id)) sel++; });
        $('.bulk-check-all').each(function () {
            this.checked = filtered.length > 0 && sel === filtered.length;
            this.indeterminate = sel > 0 && sel < filtered.length;
        });
    }

$(document).on('change', '.bulk-check-all', function () {
        if (!dbBulk) return;
        const filtered = getFilteredQuestionIds();
        if (this.checked) dbBulk.selectAll(filtered); else dbBulk.deselect(filtered);
    });

$(document).on('click', '#db-bulk-clear', () => { if (dbBulk) dbBulk.clear(); });
$(document).on('click', '#db-bulk-export-json', () => exportQuestions('json', true));
$(document).on('click', '#db-bulk-export-csv', () => exportQuestions('csv', true));

// เพิ่ม category ให้ข้อที่เลือก — action เดิม bulkAddQuestionCategories (append) ผ่าน sendBulkChunks; ต้อง confirm พร้อมจำนวนก่อนเสมอ
async function bulkAddCategoryToSelected() {
        if (!dbBulk || !dbBulk.ids.size || _bulkBusy) return;
        if (!confirmAdmin()) return;

        const ids = [...dbBulk.ids];
        const n = ids.length;
        const cats = (globalData.category || []).filter(c => c.CategoryID)
            .map(c => [String(c.CategoryID), `${c.SubjectRef || ''} · ${c.CategoryName || c.CategoryID}`])
            .sort((a, b) => a[1].localeCompare(b[1]));
        if (!cats.length) { Swal.fire('ไม่มี Category', 'ยังไม่มีข้อมูลโครงสร้าง category', 'info'); return; }

        const pick = await Swal.fire({
            title: `เพิ่ม Category ให้ ${n} ข้อ?`,
            text: 'append — category เดิมของแต่ละข้อยังอยู่ (ข้อที่มี category นี้อยู่แล้วจะถูกข้าม)',
            input: 'select',
            inputOptions: new Map(cats),
            inputPlaceholder: 'เลือก category',
            inputValidator: v => (v ? undefined : 'กรุณาเลือก category'),
            icon: 'question', showCancelButton: true,
            confirmButtonText: `เพิ่มให้ ${n} ข้อ`, cancelButtonText: 'ยกเลิก'
        });
        if (!pick.isConfirmed || !pick.value) return;

        const categoryId = pick.value;
        const items = ids.map(id => ({ id: id, categoryId: categoryId }));
        _bulkBusy = true;
        Swal.fire({ title: 'กำลังบันทึก…', allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() });
        let r;
        try {
            r = await sendBulkChunks('bulkAddQuestionCategories', items, { itemsKey: 'updates' }, 40, (done, total) => {
                const t = Swal.getTitle();
                if (t) t.textContent = `กำลังบันทึก ${done}/${total}…`;
            });
        } finally {
            _bulkBusy = false;
        }

        // ข้อที่สำเร็จ: อัปเดตข้อมูลในหน้า + ถอดออกจาก selection (ล้มเหลวแล้วลองใหม่จะเหลือเฉพาะที่ยังไม่เสร็จ)
        applyAddedCategoriesLocally(r.done);
        if ($.fn.DataTable.isDataTable('#adminTable')) {
            const doneIds = new Set(r.done.map(u => String(u.id)));
            $('#adminTable').DataTable().rows((idx, d) => d && doneIds.has(String(d.questionId))).invalidate().draw(false);
        }
        dbBulk.deselect(r.done.map(u => u.id));

        if (r.failed > 0) {
            Swal.fire('บันทึกไม่ครบ', `สำเร็จ ${r.done.length} ข้อ (เพิ่มจริง ${r.applied} · ข้าม ${r.skipped}) · ไม่ได้ทำ ${r.failed + r.pending.length} ข้อ — ${r.error}\nข้อที่ยังไม่เสร็จยังถูกเลือกอยู่`, 'warning');
        } else {
            Swal.fire('เสร็จสิ้น', `เพิ่มจริง ${r.applied} ข้อ · ข้าม (มีอยู่แล้ว) ${r.skipped}`, 'success');
        }
    }

$(document).on('click', '#db-bulk-add-cat', bulkAddCategoryToSelected);

// แทนที่ category ทั้งรายการของข้อที่เลือก — action bulkSetQuestionCategories (replace, ไม่ใช่ append)
async function bulkSetCategoryOfSelected() {
        if (!dbBulk || !dbBulk.ids.size || _bulkBusy) return;
        if (!confirmAdmin()) return;

        const ids = [...dbBulk.ids];
        const n = ids.length;
        const cats = (globalData.category || []).filter(c => c.CategoryID)
            .map(c => [String(c.CategoryID), `${c.SubjectRef || ''} · ${c.CategoryName || c.CategoryID}`])
            .sort((a, b) => a[1].localeCompare(b[1]));
        if (!cats.length) { Swal.fire('ไม่มี Category', 'ยังไม่มีข้อมูลโครงสร้าง category', 'info'); return; }

        const pick = await Swal.fire({
            title: `แทนที่ Category ของ ${n} ข้อ?`,
            html: 'Category เดิมของข้อที่เลือกจะถูกลบออกทั้งหมด แล้วใช้รายการด้านล่างแทน' +
                '<select id="bulk-set-cat-select" multiple size="10" class="form-select mt-2">' +
                cats.map(c => `<option value="${escapeHtml(c[0])}">${escapeHtml(c[1])}</option>`).join('') +
                '</select>',
            icon: 'warning', showCancelButton: true,
            confirmButtonText: `แทนที่ ${n} ข้อ`, confirmButtonColor: '#dc3545', cancelButtonText: 'ยกเลิก',
            preConfirm: () => {
                const v = [...document.getElementById('bulk-set-cat-select').selectedOptions].map(o => o.value);
                if (!v.length) { Swal.showValidationMessage('กรุณาเลือกอย่างน้อย 1 category'); return false; }
                if (v.length > 20) { Swal.showValidationMessage('เลือกได้ไม่เกิน 20 category'); return false; }
                return v;
            }
        });
        if (!pick.isConfirmed || !pick.value) return;

        _bulkBusy = true;
        Swal.fire({ title: 'กำลังบันทึก…', allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() });
        let r;
        try {
            r = await sendBulkChunks('bulkSetQuestionCategories', ids, { itemsKey: 'ids', categoryIds: pick.value }, 40, (done, total) => {
                const t = Swal.getTitle();
                if (t) t.textContent = `กำลังบันทึก ${done}/${total}…`;
            });
        } finally {
            _bulkBusy = false;
        }

        const doneIds = new Set(r.done.map(String));
        (globalData.questions || []).forEach(q => {
            const id = String(q.questionId);
            if (!doneIds.has(id)) return;
            q.category = [...(r.finalCategories[id] || pick.value)];
        });
        await setCacheDB('global_admin_data', globalData);
        if ($.fn.DataTable.isDataTable('#adminTable')) {
            $('#adminTable').DataTable().rows((idx, d) => d && doneIds.has(String(d.questionId))).invalidate().draw(false);
        }
        dbBulk.deselect(r.done);

        if (r.failed > 0) {
            Swal.fire('บันทึกไม่ครบ', `สำเร็จ ${r.done.length} ข้อ (แทนที่จริง ${r.applied} · ข้าม ${r.skipped}) · ไม่ได้ทำ ${r.failed + r.pending.length} ข้อ — ${r.error}\nข้อที่ยังไม่เสร็จยังถูกเลือกอยู่`, 'warning');
        } else {
            Swal.fire('เสร็จสิ้น', `แทนที่จริง ${r.applied} ข้อ · ข้าม (เหมือนเดิม/ไม่พบ) ${r.skipped}`, 'success');
        }
    }

$(document).on('click', '#db-bulk-set-cat', bulkSetCategoryOfSelected);

// ลบข้อที่เลือก (DEVELOPER only) — ย้ายไปชีต Questions_Trash; ยังไม่มีปุ่มกู้คืน (copy แถวกลับในชีตเอง)
async function bulkDeleteSelected() {
        if (!dbBulk || !dbBulk.ids.size || _bulkBusy) return;
        if (!(currentUser && currentUser.role === 'DEVELOPER')) {
            Swal.fire('Access Denied', 'เฉพาะ DEVELOPER เท่านั้น', 'warning');
            return;
        }
        if (!confirmAdmin()) return;

        const ids = [...dbBulk.ids];
        const n = ids.length;
        const ok = await Swal.fire({
            icon: 'warning', title: `ลบ ${n} ข้อสอบ?`,
            html: `ข้อสอบที่เลือก <b>${n}</b> ข้อ จะถูกย้ายไปชีต <code>Questions_Trash</code> และหายจากระบบ (กู้คืนต้องทำมือในชีต)<br>พิมพ์จำนวน <b>${n}</b> เพื่อยืนยัน`,
            input: 'text',
            inputValidator: v => (String(v).trim() === String(n) ? undefined : `พิมพ์ ${n} ให้ตรง`),
            showCancelButton: true, confirmButtonText: `ลบ ${n} ข้อ`, confirmButtonColor: '#dc3545', cancelButtonText: 'ยกเลิก'
        });
        if (!ok.isConfirmed) return;

        _bulkBusy = true;
        Swal.fire({ title: 'กำลังลบ…', allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() });
        let r;
        try {
            r = await sendBulkChunks('bulkDeleteQuestions', ids, { itemsKey: 'ids' }, 40, (done, total) => {
                const t = Swal.getTitle();
                if (t) t.textContent = `กำลังลบ ${done}/${total}…`;
            });
        } finally {
            _bulkBusy = false;
        }

        // อัปเดตหน้าตามข้อที่สำเร็จจริง (รวมกรณีล้มเหลวบางส่วน)
        const gone = new Set(r.done.map(String));
        globalData.questions = (globalData.questions || []).filter(q => !gone.has(String(q.questionId)));
        await setCacheDB('global_admin_data', globalData);
        if (typeof refreshTables === 'function') refreshTables();
        if (typeof updateDashboard === 'function') updateDashboard();
        dbBulk.deselect(r.done);

        if (r.failed > 0) {
            const msg = r.error === 'forbidden' ? 'ไม่มีสิทธิ์ (เฉพาะ DEVELOPER)' : r.error;
            Swal.fire('ลบไม่ครบ', `ลบแล้ว ${r.done.length} ข้อ · ไม่ได้ทำ ${r.failed + r.pending.length} ข้อ — ${msg}\nข้อที่ยังไม่เสร็จยังถูกเลือกอยู่`, 'warning');
        } else {
            Swal.fire('เสร็จสิ้น', `ย้ายไป Questions_Trash ${r.applied} ข้อ · ไม่พบ ${r.skipped}`, 'success');
        }
    }

$(document).on('click', '#db-bulk-delete', bulkDeleteSelected);

$(document).on('click', '.js-log-tab', function () {
        logFilter.tab = $(this).attr('data-tab');
        $('.js-log-tab').removeClass('active');
        $(this).addClass('active');
        if ($.fn.DataTable.isDataTable('#logsTable')) $('#logsTable').DataTable().draw();
    });
$(document).on('change', '#log-user-filter, #log-date-from, #log-date-to', function () {
        logFilter.user = $('#log-user-filter').val() || '';
        logFilter.from = $('#log-date-from').val() || '';
        logFilter.to = $('#log-date-to').val() || '';
        if ($.fn.DataTable.isDataTable('#logsTable')) $('#logsTable').DataTable().draw();
    });
$(document).on('click', '#log-load-more', loadOlderLogs);
$(document).on('click', '#log-export-csv', exportLogsCsv);

// แมปชนิดการกระทำ → สี badge แบบตรงตัว (เดิม substring: "ADD" ไปชน "LOAD")
const LOG_BADGE_MAP = {
        LOGIN_SSO: 'bg-success', LOGIN: 'bg-success', ADD: 'bg-success', CREATE: 'bg-success', IMPORT: 'bg-success',
        UPLOAD: 'bg-success', UPLOAD_BATCH: 'bg-success', REGISTER: 'bg-success', AUTO_ENROLL: 'bg-success', RESTORE: 'bg-success',
        EDIT: 'bg-warning text-dark', UPDATE: 'bg-warning text-dark', BULK_CATEGORIZE: 'bg-warning text-dark',
        SHEET_EDIT: 'bg-warning text-dark', TRANSFER: 'bg-warning text-dark', RESET_PWD: 'bg-warning text-dark',
        DELETE: 'bg-danger', REJECT: 'bg-danger', INGEST_REJECT: 'bg-danger', LOGIN_FAIL: 'bg-danger', POSTGRES_MIRROR_FAIL: 'bg-danger',
        REPORT_AUTOFIX: 'badge-sys', VOTE_CONFIRM: 'badge-sys', GENERATE: 'badge-sys', INDEX: 'badge-sys', SYSTEM: 'badge-sys'
    };

function initLogsTable() {
        if (!globalData.logs) globalData.logs = [];
        if (globalData.logs.length <= LOG_PAGE_SIZE) _logsExhausted = false; // โหลดชุดแรกใหม่ → โหลดเพิ่มได้อีก
        if ($.fn.DataTable.isDataTable('#logsTable')) {
            $('#logsTable').DataTable().clear().rows.add(globalData.logs).draw();
            updateLogsToolbar();
            return;
        }
        $('#logsTable').DataTable({
            data: globalData.logs,
            order: [[0, 'desc']], // เรียงตามเวลาล่าสุด
            columns: [
                {
                    data: 'Timestamp',
                    width: '15%',
                    render: function (data) { return formatDate(data); },
                    createdCell: (td) => $(td).attr('data-label', 'เวลา')
                },
                { data: 'User', width: '10%', render: $.fn.dataTable.render.text(), createdCell: (td) => $(td).attr('data-label', 'ผู้ใช้งาน') },
                {
                    data: 'ActionType',
                    width: '10%',
                    render: function (data) {
                        const badge = LOG_BADGE_MAP[String(data).toUpperCase()] || 'bg-secondary';
                        return `<span class="badge ${badge}">${escapeHtml(data)}</span>`;
                    },
                    createdCell: (td) => $(td).attr('data-label', 'การกระทำ')
                },
                { data: 'TargetID', width: '15%', render: $.fn.dataTable.render.text(), createdCell: (td) => $(td).attr('data-label', 'เป้าหมาย (ID)') },
                {
                    data: 'Details',
                    width: '35%',
                    render: $.fn.dataTable.render.text(),
                    createdCell: (td) => $(td).attr('data-label', 'รายละเอียด')
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
                            return `<button class="btn btn-sm btn-outline-info dashboard-diff-btn" data-old="${oldValSafe}" data-new="${newValSafe}">
                                    <i class="fas fa-eye"></i> ดูส่วนที่แก้
                                </button>`;
                        }
                        return '-';
                    }
                }
            ]
        });
        updateLogsToolbar();
    }

function viewDiff(oldValEnc, newValEnc) {
        let oldRaw = {}, newRaw = {};


        // 1. Decode & Parse JSON
        try { oldRaw = JSON.parse(decodeURIComponent(oldValEnc)); } catch (e) { oldRaw = decodeURIComponent(oldValEnc); }
        try { newRaw = JSON.parse(decodeURIComponent(newValEnc)); } catch (e) { newRaw = decodeURIComponent(newValEnc); }

        // log ที่ไม่ใช่ข้อสอบ (Category/Announcement/Profile ฯลฯ) — old/new เป็นสตริงหรือ object อื่น: แสดงข้อความดิบเทียบกัน
        if (!isQuestionLog(oldRaw) && !isQuestionLog(newRaw)) {
            const oldTxt = rawLogText(oldRaw), newTxt = rawLogText(newRaw);
            $('#diff-container-old').html(`<pre class="diff-raw">${wordDiffHtml(oldTxt, newTxt, 'old') || '<span class="text-muted">(ว่าง)</span>'}</pre>`);
            $('#diff-container-new').html(`<pre class="diff-raw">${wordDiffHtml(newTxt, oldTxt, 'new') || '<span class="text-muted">(ว่าง)</span>'}</pre>`);
            $('#diffModal').modal('show');
            return;
        }

        // 2. Normalize Data (แปลง Key ให้เป็นมาตรฐานเดียวกัน เพื่อเปรียบเทียบง่าย)
        const oldObj = normalizeData(oldRaw);
        const newObj = normalizeData(newRaw);

        // 3. Render แต่ละฝั่ง
        $('#diff-container-old').html(renderDiffPanel(oldObj, newObj, 'old'));
        $('#diff-container-new').html(renderDiffPanel(newObj, oldObj, 'new'));
        window.renderAllMath($('#diff-container-old'));
        window.renderAllMath($('#diff-container-new'));

        $('#diffModal').modal('show');
    }

// old/new ของ log ข้อสอบเป็น object ที่มีฟิลด์ข้อสอบ (key แบบ payload หรือหัวคอลัมน์ชีต)
function isQuestionLog(v) {
        return !!v && typeof v === 'object' &&
            ['problem', 'Problem', 'choices', 'Choices', 'questionId', 'QuestionID'].some(k => k in v);
    }

function rawLogText(v) {
        if (v === null || v === undefined) return '';
        return typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
    }

// เทียบระดับคำ (LCS) แล้วครอบคำที่ต่างด้วย <del>/<ins> — side 'old' = ฝั่งที่ถูกลบ, 'new' = ฝั่งที่เพิ่ม
// ข้อความยาวเกินเพดาน (O(n*m)) → คืนข้อความ escape ธรรมดา
function wordDiffHtml(text, other, side) {
        const a = String(text || ''), b = String(other || '');
        if (a === b) return escapeHtml(a) || '';
        const A = a.split(/(\s+)/).filter(s => s !== '');
        const B = b.split(/(\s+)/).filter(s => s !== '');
        if (A.length * B.length > 1500000) return escapeHtml(a) || '';

        const dp = Array.from({ length: A.length + 1 }, () => new Int32Array(B.length + 1));
        for (let i = A.length - 1; i >= 0; i--) {
            for (let j = B.length - 1; j >= 0; j--) {
                dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const keepA = new Array(A.length).fill(false), keepB = new Array(B.length).fill(false);
        let i = 0, j = 0;
        while (i < A.length && j < B.length) {
            if (A[i] === B[j]) { keepA[i] = keepB[j] = true; i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
            else j++;
        }
        const toks = side === 'old' ? A : B, keep = side === 'old' ? keepA : keepB;
        const tag = side === 'old' ? 'del' : 'ins';
        const cls = side === 'old' ? 'diff-w-del' : 'diff-w-add';
        return toks.map((t, k) => (keep[k] || /^\s+$/.test(t)) ? escapeHtml(t) : `<${tag} class="${cls}">${escapeHtml(t)}</${tag}>`).join('');
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

function renderDiffPanel(data, compare, side) {
        // ฝั่งเก่า = แดง (ถูกลบ/แก้), ฝั่งใหม่ = เขียว (เพิ่ม/แก้); ไม่ระบุ side = สีเหลืองแบบเดิม
        const changedCls = side === 'old' ? 'diff-del' : side === 'new' ? 'diff-add' : 'diff-changed';
        // 1. Header (ID & Category)
        // เทียบ Category (แปลงเป็น string ก่อนเทียบ)
        const catStr = Array.isArray(data.category) ? data.category.join(', ') : String(data.category);
        const compareCatStr = Array.isArray(compare.category) ? compare.category.join(', ') : String(compare.category);
        const isCatChanged = catStr !== compareCatStr;
        const catClass = isCatChanged ? changedCls : '';

        let html = `
        <h5 class="mb-3">
            <span class="badge bg-secondary me-1">${escapeHtml(data.id)}</span>
            <span class="badge bg-primary ${catClass}">${escapeHtml(catStr) || 'No Category'}</span>
        </h5>
    `;

        // 2. Problem Text (ระบายคำที่ต่างระดับคำ)
        const isProbChanged = data.problem !== compare.problem;
        const probClass = isProbChanged ? changedCls : '';
        const probHtml = isProbChanged && side ? wordDiffHtml(data.problem, compare.problem, side) : escapeHtml(data.problem);
        html += `<p class="lead mt-3 ${probClass}" style="font-weight: 500;">${probHtml || '-'}</p>`;

        // 3. Images
        const isImgChanged = data.img !== compare.img;
        const imgClass = isImgChanged ? changedCls : '';
        html += `<div class="text-center mb-3 p-2 ${imgClass}">`;
        if (data.img) {
            const imgs = data.img.split('///').filter(Boolean);
            imgs.forEach(url => {
                html += `<img src="${escapeHtml(transformUrl(url))}" class="img-fluid mb-2 border rounded" style="max-height:200px;">`;
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
                classes += " " + changedCls; // แดง/เขียวตามฝั่ง (Changed)
            }

            const prefix = String.fromCharCode(65 + i) + ". ";
            const txtHtml = (txt !== compareTxt && side) ? wordDiffHtml(txt, compareTxt, side) : escapeHtml(txt);
            html += `<div class="${classes}">${prefix}${txtHtml || '<span class="text-muted font-italic">(ว่าง)</span>'}</div>`;
        }
        html += `</div>`;

        // 5. Explanation
        const isExplainChanged = data.explain !== compare.explain;
        const explainClass = isExplainChanged ? changedCls : '';

        html += `<div class="alert alert-secondary ${explainClass}">
                <strong>Explanation:</strong> 
                <span class="d-block mt-1">${data.explain ? window.renderMarkdownSafe(data.explain) : '-'}</span>
             </div>`;

        return html;
    }

// ช้อยส์ที่เป็น SVG: แสดงผ่าน <img> data URI — script / on* handler ใน SVG ไม่ทำงานเมื่อโหลดเป็นรูป
// (แทรก markup ดิบลง innerHTML = ใครก็ตามที่แก้ข้อสอบได้ รันโค้ดในหน้าของ DEVELOPER ได้)
function svgAsImg(svg, style) {
        return `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" style="${style}">`;
    }

function escapeHtml(text) {
        if (!text) return text;
        return String(text) // ค่าจากชีตเป็นตัวเลขได้ (SubjectID, Year) — .replace บน number จะ throw
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
