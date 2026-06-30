// ─────────────────────────────────────────────────────
// JS/APP.JS
// ─────────────────────────────────────────────────────

$(document).ready(function () {
        const savedUser = localStorage.getItem('mdkku_admin_user');
        const savedPass = localStorage.getItem('mdkku_admin_pass');

        if (savedUser && savedPass) {
            try {
                currentUser = JSON.parse(savedUser);
                adminPass = savedPass;
                isAdmin = true;
                updateAuthUI(true);
                console.log("🔐 Session restored for: " + currentUser.username);
            } catch (e) {
                localStorage.removeItem('mdkku_admin_user');
                localStorage.removeItem('mdkku_admin_pass');
            }
        }

        const lastSection = localStorage.getItem('mdkku_manager_last_section') || 'dashboard';
        showSection(lastSection);

        // เมื่อมีการพิมพ์หรือวางลิงก์ในช่องรูปโจทย์ ให้แสดงพรีวิวทันที
        $(document).on('input', '.image-url-input', function () {
            syncImagesToHiddenInput();
        });

        // เมื่อมีการพิมพ์หรือวางลิงก์ในช่องตัวเลือก ให้เก็บค่าทันที
        $(document).on('input', '.choice-text-input', function () {
            syncChoicesToHiddenInput();
        });

        $(document).on('change', '.choice-radio', function () {
            syncChoicesToHiddenInput();
        });

        // ---------------------------------------------------------
        // 1. ระบบดักจับการกด Ctrl+V (Paste) แบบอิสระ (Global Paste)
        // ---------------------------------------------------------
        $(document).on('click', '.choice-item', function (e) {
            // ลบสถานะ Focus จากกล่องอื่นก่อน
            $('.choice-item').removeClass('active-focus');
            // เพิ่มสถานะ Focus ให้กล่องที่คลิก
            $(this).addClass('active-focus');

            // ถ้าเป็นการคลิกที่ Input โดยตรง ไม่ต้องป้องกัน Default
            // แต่ถ้าคลิกที่ตัวกล่องเปล่าๆ ให้ช่วย Focus เข้าไปที่ Input (ถ้ามี)
            if (!$(e.target).is('input')) {
                $(this).find('.choice-text-input').focus();
            }
        });

        // ---------------------------------------------------------
        // ระบบดักจับการกด Ctrl+V (Paste) พร้อมแสดงพรีวิวทันที
        // ---------------------------------------------------------
        $(document).on('paste', function (e) {
            // ทำงานเฉพาะเมื่อ Modal แก้ไขเปิดอยู่เท่านั้น
            if (!$('#editQuestionModal').hasClass('show')) return;

            let items = (e.clipboardData || e.originalEvent.clipboardData).items;
            let imagePasted = false;

            // ตรวจสอบว่าแอดมินกำลัง Focus อยู่ที่ Choice row ไหน (ผ่าน class active-focus)
            let $targetChoiceRow = $('.choice-item.active-focus');

            for (let index in items) {
                let item = items[index];
                if (item.kind === 'file' && item.type.includes('image/')) {
                    imagePasted = true;
                    let blob = item.getAsFile();

                    // สร้าง Local URL เพื่อให้แสดงรูปภาพบนหน้าจอทันที (ไม่ต้องรอ Process base64)
                    const localBlobUrl = URL.createObjectURL(blob);

                    // เริ่มกระบวนการแปลงไฟล์และบีบอัดภาพ (ทำงานเบื้องหลัง)
                    getBase64(blob).then(async (base64) => {
                        const compressedBase64 = await compressImage(base64, 800, 800);

                        if ($targetChoiceRow.length > 0) {
                            // --- กรณีวางลงในตัวเลือก (Choice) ---
                            let rowId = $targetChoiceRow.attr('id');

                            // เก็บข้อมูลเข้าตัวแปรส่วนกลางสำหรับเตรียมอัปโหลดตอนกด Save
                            choiceImagesData[rowId] = {
                                type: 'pending',
                                data: compressedBase64, // ข้อมูล base64 สำหรับส่งไป Server
                                blob: localBlobUrl      // ข้อมูล URL สำหรับแสดงผลบนหน้าจอทันที
                            };

                            const $input = $targetChoiceRow.find('.choice-text-input');
                            $input.val('[IMAGE_PENDING]'); // ตั้งค่าชั่วคราว

                            // สั่ง Render พรีวิวในแถว Choice นั้นทันที
                            renderChoicePreview($input);
                            syncChoicesToHiddenInput();
                        } else {
                            // --- กรณีวางทั่วไป (เพิ่มเข้าในรูปภาพโจทย์หลัก) ---
                            // เพิ่ม base64 เข้าไปในคิวรออัปโหลด
                            pendingMainImages.push(compressedBase64);

                            // สั่งอัปเดต Gallery ภาพโจทย์หลักทันที
                            syncMainImageGallery();
                        }
                    });
                }
            }

            if (imagePasted) {
                // ป้องกันไม่ให้ Browser วางตัวอักษรขยะลงใน input
                e.preventDefault();

                // แจ้งเตือนสถานะความสำเร็จแบบรวดเร็ว
                Swal.fire({
                    icon: 'success',
                    title: 'วางรูปภาพสำเร็จ',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 800
                });
            }
        });
    // ---------------------------------------------------------
    // 2. ระบบลากแล้ววาง (Drag & Drop) สำหรับกล่องอัพโหลด
    // ---------------------------------------------------------
    const $dropzone = $('#main-image-upload-zone');

    $dropzone.on('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
        $(this).addClass('dragover'); // เปลี่ยนสีกล่องเมื่อลากไฟล์มาจ่อ
    });

    $dropzone.on('dragleave', function (e) {
        e.preventDefault();
        e.stopPropagation();
        $(this).removeClass('dragover'); // คืนสีเดิมเมื่อลากไฟล์ออก
    });

    $dropzone.on('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        $(this).removeClass('dragover');

        // รับไฟล์ที่ถูก Drop ลงมา
        let files = e.originalEvent.dataTransfer.files;
        if (files.length === 0) return;

        let promises = [];
        for (let i = 0; i < files.length; i++) {
            if (files[i].type.includes('image/')) {
                promises.push(getBase64(files[i]));
            }
        }

        if (promises.length > 0) {
            Promise.all(promises).then(base64Array => {
                pendingMainImages = pendingMainImages.concat(base64Array);
                syncMainImageGallery();
                Swal.fire({
                    icon: 'success', title: 'เพิ่มรูปภาพสำเร็จ', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500
                });
            });
        } else {
            Swal.fire('ข้อผิดพลาด', 'กรุณาลากเฉพาะไฟล์รูปภาพเท่านั้น', 'warning');
        }
    });

    const $explainDropzone = $('#explain-media-upload-zone');

    $explainDropzone.on('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
        $(this).addClass('dragover');
    });

    $explainDropzone.on('dragleave', function (e) {
        e.preventDefault();
        e.stopPropagation();
        $(this).removeClass('dragover');
    });

    $explainDropzone.on('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        $(this).removeClass('dragover');

        let files = e.originalEvent.dataTransfer.files;
        if (files.length === 0) return;

        (async () => {
            const compressedResults = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (file.type.includes('image/') || file.type === 'application/pdf') {
                    const base64 = await getBase64(file);
                    if (file.type.includes('image/')) {
                        const comp = await compressImage(base64, 800, 800);
                        compressedResults.push(comp);
                    } else {
                        if (file.size > 10 * 1024 * 1024) {
                            Swal.fire('ข้อผิดพลาด', 'ขนาดเอกสาร PDF ต้องไม่เกิน 10MB', 'error');
                            continue;
                        }
                        compressedResults.push(base64);
                    }
                }
            }

            if (compressedResults.length > 0) {
                pendingExplainMedia = pendingExplainMedia.concat(compressedResults);
                syncExplainMediaGallery();
                Swal.fire({
                    icon: 'success', title: 'เพิ่มและย่อขนาดสื่อสำเร็จ', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500
                });
            } else {
                Swal.fire('ข้อผิดพลาด', 'กรุณาลากเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้น', 'warning');
            }
        })();
    });
    // ล้างค่าเมื่อปิด Modal (Cancel)
    $('#editQuestionModal').on('hidden.bs.modal', function () {
        existingMainImages = [];
        pendingMainImages = [];
        existingExplainMedia = [];
        pendingExplainMedia = [];
        choiceImagesData = {};
        $('#main-image-hidden-input').val('');
        $('#explain-media-hidden-input').val('');
        syncMainImageGallery();
        syncExplainMediaGallery();
    });

    // --- 2.1 Image Gallery Controls Binding (Edit Modal) ---
    $('#prev-img-btn').click(() => {
        if (editImageArray.length > 0) {
            editImageIndex = (editImageIndex - 1 + editImageArray.length) % editImageArray.length;
            updateEditImageGallery();
        }
    });
    $('#next-img-btn').click(() => {
        if (editImageArray.length > 0) {
            editImageIndex = (editImageIndex + 1) % editImageArray.length;
            updateEditImageGallery();
        }
    });
    $('#prev-explain-media-btn').click(() => {
        if (explainImageArray.length > 0) {
            explainImageIndex = (explainImageIndex - 1 + explainImageArray.length) % explainImageArray.length;
            updateExplainMediaGallery();
        }
    });
    $('#next-explain-media-btn').click(() => {
        if (explainImageArray.length > 0) {
            explainImageIndex = (explainImageIndex + 1) % explainImageArray.length;
            updateExplainMediaGallery();
        }
    });

        // --- 2.2 Responsive Sidebar Toggle Bindings ---
        $("#menu-toggle").on('click', function (e) {
            e.preventDefault();
            $("#wrapper").toggleClass("toggled");
        });

        $("#sidebar-close-btn").on('click', function (e) {
            e.preventDefault();
            $("#wrapper").removeClass("toggled");
        });

        // Click outside to close (Only on Mobile screens)
        $(document).on('click', '#page-content-wrapper', function (e) {
            if ($(window).width() < 768 && $("#wrapper").hasClass("toggled")) {
                if (!$(e.target).closest('#menu-toggle').length) {
                    $("#wrapper").removeClass("toggled");
                }
            }
        });

        $(document).on('click', '.dashboard-diff-btn', function (e) {
            e.preventDefault();
            const oldVal = $(this).attr('data-old');
            const newVal = $(this).attr('data-new');
            viewDiff(oldVal, newVal);
        });

        $(document).on('input', '#subjID', function () {
            const val = $(this).val().toUpperCase();
            const match = globalData.structure.find(s => s.SubjectID === val);
            if (match) {
                $('#subjName').val(match.SubjectName);
                $('#yearVal').val(match.Year);
            }
        });

        // Initial Responsive State
        if ($(window).width() < 768) {
            $("#wrapper").removeClass("toggled");
        }

        // --- 2.3 Vote Modal Bindings ---
        $('#btn-open-vote').on('click', () => {
            $('#questionDetailModal').modal('hide');

            if (!current_question || !current_question.questionId) {
                Swal.fire('Error', 'ไม่พบข้อมูลข้อสอบ กรุณาลองใหม่', 'error');
                return;
            }

            let qText = current_question.problem || '';
            $('#vote-question-preview').text(qText.substring(0, 150) + (qText.length > 150 ? "..." : ""));

            renderCurrentCategory(current_question);
            fetchPendingVotes(current_question.questionId);

            $('#vote-rows-container').empty();
            addVoteRow();

            $('#vote-category-modal').css('display', 'flex');
        });

        $('#btn-close-vote-modal').on('click', () => $('#vote-category-modal').css('display', 'none'));
        $('#btn-add-vote-row').on('click', addVoteRow);
        $('#btn-submit-vote').on('click', () => {
            const votes = [];
            $('.vote-row').each(function () {
                const categoryId = $(this).find('.category-select').val();
                if (categoryId) {
                    const currentCategory = Array.isArray(current_question.category) ? current_question.category : [current_question.category];
                    if (!currentCategory.includes(categoryId)) {
                        votes.push(categoryId);
                    }
                }
            });

            const uniqueVotes = [...new Set(votes)];

            if (uniqueVotes.length === 0) {
                Swal.fire('Warning', "กรุณาเลือกหัวข้ออย่างน้อย 1 หัวข้อ (และต้องไม่ซ้ำกับหัวข้อเดิม)", 'warning');
                return;
            }

            submitVoteData(uniqueVotes);
        });

        // --- 2.4 Report Modal Bindings ---
        $('#cancel-report').on('click', () => $('#report-card').fadeOut());
    // #submit-report logic is large, so keep it inside document.ready but after global functions.
    $('#submit-report').on('click', async function () {

        // 1. ดึง Category ID และแปลงเป็น String
        let currentCategoryIds = current_question.category || [];
        let categoryString = Array.isArray(currentCategoryIds) ? currentCategoryIds.join(", ") : currentCategoryIds;

        // 2. หา "Subject" (วิชา) จาก Category ID
        let subjectFrom = "Unknown Subject";

        if (globalData.category && Array.isArray(currentCategoryIds) && currentCategoryIds.length > 0) {
            let firstCatId = String(currentCategoryIds[0]).trim();
            const matchedCategoryInfo = globalData.category.find(t => String(t.CategoryID) === firstCatId);

            if (matchedCategoryInfo && matchedCategoryInfo.SubjectRef) {
                subjectFrom = matchedCategoryInfo.SubjectRef;
            }
        }

        // 3. ส่วนตรวจสอบ Input (Validation)
        const $select = $('#report-correct-choice-select');
        const $inputNew = $('#report-new-choice-input');
        const $reason = $('#report_text');

        const selectedVal = $select.val();
        const newVal = $inputNew.val().trim();
        const reasonVal = $reason.val().trim();

        if (selectedVal === 'newanswer' && !newVal) {
            Swal.fire('แจ้งเตือน', 'กรุณาพิมพ์คำตอบที่ถูกต้องใหม่ในช่องด้านล่าง', 'warning');
            setTimeout(() => $inputNew.focus(), 500);
            return;
        }

        if (reasonVal === '') {
            Swal.fire('แจ้งเตือน', 'กรุณาระบุเหตุผลของปัญหา', 'warning');
            setTimeout(() => $reason.focus(), 500);
            return;
        }

        // --- ส่วนจัดการข้อมูลก่อนส่ง (Data Processing) ---
        // 4. จัดการคำตอบที่เสนอ (Suggested Choice)
        let suggestedChoice = (selectedVal === 'newanswer') ? newVal : selectedVal;
        if (suggestedChoice && (suggestedChoice.includes('drive.google') || suggestedChoice.startsWith('http'))) {
            suggestedChoice = transformUrl(suggestedChoice);
        }

        // 5. จัดการรูปโจทย์ (Question Images)
        let questionImagesString = "";
        if (current_question.img) {
            const rawImgs = current_question.img.split("///");
            const processedImgs = rawImgs.map(url => transformUrl(url.trim()));
            questionImagesString = processedImgs.join("///");
        }

        // 6. จัดการตัวเลือกทั้งหมด (Format ให้ดูง่ายขึ้น)
        const allChoices = (current_question.choices || "").split("///").map((s, i) => {
            const letter = String.fromCharCode(65 + i);
            let choiceText = s.trim();
            const isCurrentAnswer = choiceText === (current_question.answer || "").trim();
            return `${letter}. ${isCurrentAnswer ? '(เฉลยปัจจุบัน) ' : ''}${choiceText}`;
        }).join("\n");

        // --- ส่วนการส่งข้อมูล (Fetch) ---
        const $btn = $(this);
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Sending...');

        const reportData = {
            action: 'submitReport',
            from: subjectFrom,
            category: categoryString,
            questionId: current_question.questionId,
            question: current_question.problem,
            questionImages: questionImagesString,
            allChoices: allChoices,
            suggestedChoice: suggestedChoice,
            report: reasonVal
        };

        try {
            const resJson = await sendWithRetry(reportData);

            if (resJson.result === 'success') {
                Swal.fire('สำเร็จ', 'ขอบคุณที่แจ้งปัญหา! ข้อมูลจะถูกส่งให้ทีมงานตรวจสอบ', 'success');
                $('#report-card').fadeOut();
                fetchData();
            } else {
                throw new Error(resJson.error || 'Server reported error');
            }
        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'ไม่สามารถส่งรายงานได้: ' + error.message, 'error');
        } finally {
            $btn.prop('disabled', false).text('ส่งรายงาน (Submit)');
        }
    });

        // --- 2.5 Initial Data & Table Setup ---
        initPublicTable();
        initAdminTable();
        //initStructureTables();
        setupConverterMultiEdit();

        fetchData();

        startVersionPolling();

        // --- 2.6 Warn User Before Closing Tab if Background Uploads are Active ---
        window.onbeforeunload = function () {
            // เช็คว่ามีงาน Background รันอยู่หรือไม่ (ถ้าคุณมีตัวแปรนับงาน)
            if (activeUploadsCount > 0) {
                return "ระบบกำลังอัปโหลดรูปภาพเบื้องหลัง หากปิดตอนนี้ข้อมูลอาจบันทึกไม่สำเร็จ?";
            }
        };
    });

$(document).on('hidden.bs.modal', '.modal', function () {
        handleDeferredUpdate();
    });

$('#cancel-report, #btn-close-vote-modal').on('click', function () {
        // หน่วงเวลาเล็กน้อยรอให้แอนิเมชัน FadeOut จบ
        setTimeout(handleDeferredUpdate, 400);
    });

async function fetchData(forceRefresh = false, isAutoPoll = false) {
        if (isFetching) return;
        isFetching = true;

        const cacheKey = 'global_admin_data';
        const verKey = 'global_admin_ver';

        // 1. โหลดข้อมูลเดิมที่มีในเครื่องขึ้นมาโชว์ก่อน (ถ้ามี)
        const localData = await getCacheDB(cacheKey);
        const localVer = await getCacheDB(verKey);

        if (localData && !globalData.questions.length) {
            globalData = localData;
            finalizeDataLoading();
        }

        try {
            // 2. เช็ค Version จาก Server (Request ขนาดเล็กมาก)
            const resVer = await fetch(`${APPSCRIPT_URL}?action=checkVersion`).then(r => r.json());
            const serverVersion = resVer.v;

            // --- กรณีที่ 1: เวอร์ชันตรงกัน ---
            if (!forceRefresh && localData && localVer === serverVersion) {
                if (!isAutoPoll) {
                    // แจ้งเตือนแอดมินเบาๆ ว่าข้อมูลล่าสุดแล้ว (เฉพาะตอนกด Refresh เอง)
                    Swal.fire({
                        icon: 'success', title: 'ข้อมูลเป็นปัจจุบันแล้ว',
                        toast: true, position: 'top-end', showConfirmButton: false, timer: 2000
                    });
                }
                isFetching = false;
                return;
            }

            // --- กรณีที่ 2: พบเวอร์ชันใหม่ ---
            const updateToast = Swal.mixin({
                toast: true, position: 'top-end', showConfirmButton: false, timerProgressBar: true
            });

            if (!isAutoPoll) {
                updateToast.fire({ icon: 'info', title: 'พบเวอร์ชันใหม่ กำลังซิงค์ข้อมูล...' });
            }

            const response = await fetch(`${APPSCRIPT_URL}?action=getAllData`);
            const data = await response.json();

            // ประมวลผลข้อมูล (Logic เดิม)
            const processedQuestions = (data.questions || []).map(q => {
                if (typeof q.category === 'string' && q.category.startsWith('[')) {
                    try { q.category = JSON.parse(q.category.replace(/'/g, '"')); }
                    catch (e) { q.category = [q.category]; }
                } else if (typeof q.category === 'string') {
                    q.category = [q.category];
                }
                return q;
            });

            const newData = {
                questions: processedQuestions,
                report: data.report || [],
                structure: data.structure || [],
                category: data.category || [],
                votes: data.votes || [],
                logs: data.logs || [],
                admins: data.admins || [],
                announcements: data.announcements || []
            };

            // บันทึกลง Cache (IndexedDB) ทันที
            await setCacheDB(cacheKey, newData);
            await setCacheDB(verKey, serverVersion);

            // 3. ตรวจสอบว่าแอดมินกำลังยุ่งอยู่หรือไม่ (เปิด Modal ใดๆ อยู่)
            const isUserBusy = $('.modal.show').length > 0 ||
                $('#report-card').is(':visible') ||
                $('#vote-category-modal').is(':visible');

            if (isUserBusy) {
                // อัปเดตข้อมูลในตัวแปร globalData ไว้รอ แต่ห้ามวาดตารางใหม่
                globalData = newData;
                console.log("New version cached silently. UI update deferred.");

                if (!isAutoPoll) {
                    updateToast.fire({
                        icon: 'success',
                        title: 'โหลดเวอร์ชันใหม่เสร็จแล้ว',
                        text: 'ระบบจะอัปเดตข้อมูลบนหน้าจอเมื่อคุณปิดหน้าต่างแก้ไขนี้',
                        timer: 4000
                    });
                }
            } else {
                // ไม่ได้ยุ่งอยู่ -> อัปเดต UI ทันที
                globalData = newData;
                finalizeDataLoading();
                if (!isAutoPoll) {
                    updateToast.fire({ icon: 'success', title: 'อัปเดตข้อมูลสำเร็จ!', timer: 2000 });
                }
            }

        } catch (error) {
            console.error("Fetch Data Error:", error);
            if (!isAutoPoll) {
                Swal.fire({ icon: 'error', title: 'การเชื่อมต่อผิดพลาด', text: 'ไม่สามารถโหลดข้อมูลใหม่ได้' });
            }
        } finally {
            isFetching = false;
            $('#loading-overlay').hide(); // เผื่อกรณีค้าง
        }
        finalizeDataLoading();
    }

function handleDeferredUpdate() {
        const isUserBusy = $('.modal.show').length > 0 ||
            $('#report-card').is(':visible') ||
            $('#vote-category-modal').is(':visible');

        if (!isUserBusy && globalData.questions.length > 0) {
            console.log("Applying deferred UI update...");
            refreshTables();
            updateDashboard();
            renderReportList();
        }
    }

function finalizeDataLoading() {
        updateDashboard();
        populateFilters();
        //renderReportList();

        refreshTables(true); // true = รักษาหน้าปัจจุบันไว้

        // Only refresh report list if not currently editing a report
        if (!$('#sec-report-inbox').hasClass('hidden')) {
            renderReportList();
        }
    }

window.versionCheckInterval = null;
window._idleTimeout = null;
window._currentPollingMode = 'ACTIVE';
window._isUserIdle = false;

function startVersionPolling() {
    if (versionCheckInterval) clearInterval(versionCheckInterval);
    if (window._idleTimeout) clearTimeout(window._idleTimeout);

    var INTERVALS = {
        ACTIVE: 60000,   // 1 minute (Standard refresh window)
        IDLE: 300000,    // 5 minutes (Inactivity mode)
        HIDDEN: 900000   // 15 minutes (Background minimized window)
    };

    function getOptimalMode() {
        if (document.hidden) {
            return 'HIDDEN';
        }
        if (window._isUserIdle) {
            return 'IDLE';
        }
        return 'ACTIVE';
    }

    function reschedulePolling() {
        var targetMode = getOptimalMode();
        if (window._currentPollingMode === targetMode && versionCheckInterval) {
            return;
        }

        console.log('[Polling] Switching admin check interval to ' + targetMode + ' (' + INTERVALS[targetMode] + 'ms)');
        window._currentPollingMode = targetMode;

        if (versionCheckInterval) clearInterval(versionCheckInterval);
        versionCheckInterval = setInterval(function () {
            console.log("Auto-checking for data updates...");
            fetchData(false, true);
        }, INTERVALS[targetMode]);
    }

    function resetIdleTimer() {
        if (window._isUserIdle) {
            window._isUserIdle = false;
            reschedulePolling();
        }

        if (window._idleTimeout) clearTimeout(window._idleTimeout);
        window._idleTimeout = setTimeout(function () {
            window._isUserIdle = true;
            reschedulePolling();
        }, 300000); // Trigger idle threshold after 5 minutes of inactivity
    }

    // Monitor Admin activity
    document.addEventListener('mousemove', resetIdleTimer);
    document.addEventListener('keydown', resetIdleTimer);

    // Track tab focus state
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
            // Force instant version check when window comes back in focus
            fetchData(false, true);
            resetIdleTimer();
        }
        reschedulePolling();
    });

    // Initialize timers
    resetIdleTimer();
    reschedulePolling();
    console.log('[Polling] Adaptive admin version polling system active');
}

function refreshTables(keepState = false) {
        // 1. ตาราง Public Search
        if (!$('#sec-public-search').hasClass('hidden') && $.fn.DataTable.isDataTable('#publicTable')) {
            const table = $('#publicTable').DataTable();
            table.clear().rows.add(globalData.questions).draw(!keepState); // draw(false) จะรักษาหน้าปัจจุบันไว้
            // บังคับ Re-search ตามค่าใน Select ล่าสุด
            table.column(0).search($('#search-subject-filter').val()).draw();
            table.column(1).search($('#search-category-filter').val()).draw();
        }

        // 2. ตาราง Admin Database
        if (!$('#sec-database').hasClass('hidden') && $.fn.DataTable.isDataTable('#adminTable')) {
            const table = $('#adminTable').DataTable();
            table.clear().rows.add(globalData.questions).draw(!keepState);
            table.column(0).search($('#db-subject-filter').val()).draw();
            table.column(1).search($('#db-category-filter').val()).draw();
        }

        // 3. ตาราง Logs
        if (!$('#sec-logs').hasClass('hidden')) {
            if ($.fn.DataTable.isDataTable('#logsTable')) {
                $('#logsTable').DataTable().clear().rows.add(globalData.logs || []).draw(false);
            } else {
                initLogsTable();
            }
        }

        // 4. หน้า Structure (รีเฟรชเมื่อเปิดหน้านี้เท่านั้น)
        if (!$('#sec-structure').hasClass('hidden')) {
            renderStructureTree($('#struct-subject-filter').val());
        }

        // 5. Dashboard (อัปเดตตัวเลข/ตารางรายงาน)
        if (!$('#sec-dashboard').hasClass('hidden')) {
            updateDashboard();
        }

        // 6. หน้าจัดการประกาศ (Banners)
        if (!$('#sec-announcements').hasClass('hidden')) {
            renderAnnouncementsList();
        }

        if ($.fn.DataTable.isDataTable('#publicTable')) {
            $('#publicTable').DataTable().columns.adjust();
        }
        if ($.fn.DataTable.isDataTable('#adminTable')) {
            $('#adminTable').DataTable().columns.adjust();
        }

        if ($.fn.DataTable.isDataTable('#adminTable')) {
            const state = $('#adminTable').DataTable().state();
            if (state && state.columns) {
                const savedSubj = state.columns[0].search.search;
                const savedCat = state.columns[1].search.search;
                if (savedSubj) {
                    $('#db-subject-filter').val(savedSubj);
                    updateCategoryDropdown(savedSubj, '#db-category-filter');
                }
                if (savedCat) $('#db-category-filter').val(savedCat);
            }
        }

        if ($.fn.DataTable.isDataTable('#publicTable')) {
            const state = $('#publicTable').DataTable().state();
            if (state && state.columns) {
                const savedSubj = state.columns[0].search.search;
                const savedCat = state.columns[1].search.search;
                if (savedSubj) {
                    $('#search-subject-filter').val(savedSubj);
                    updateCategoryDropdown(savedSubj, '#search-category-filter');
                }
                if (savedCat) $('#search-category-filter').val(savedCat);
            }
        }
    }

function updateDashboard() {
        // 1. อัปเดตตัวเลข Stats
        $('#stat-total-q').text(globalData.questions ? globalData.questions.length : "0");
        const pendingCount = (globalData.report || []).filter(r => !r.Done || String(r.Done).toUpperCase() === 'FALSE').length;
        $('#stat-pending-q').text(pendingCount);

        // อัปเดต Badge ที่ Sidebar ด้วย
        $('#sidebar-report-count').text(pendingCount).toggle(pendingCount > 0);

        $('#stat-resolved-q').text((globalData.report || []).filter(r => String(r.Done).toUpperCase() === 'TRUE').length);
        const requireImgCount = (globalData.questions || []).filter(q =>
            (q.img && q.img.toLowerCase().includes("require_img")) ||
            (q.choices && q.choices.toLowerCase().includes("require_img"))
        ).length;

        $('#stat-require-img').text(requireImgCount);

        // 2. อัปเดตตาราง Recent Updates
        const recentReports = (globalData.report || [])
            .sort((a, b) => new Date(b.Time) - new Date(a.Time))
            .slice(0, 50); // แสดงแค่ 50 รายการล่าสุดเพื่อให้หน้า Dashboard ไม่ยาวเกินไป

        let html = '';
        if (recentReports.length === 0) {
            html = '<tr><td colspan="5" class="text-center text-muted py-5">ยังไม่มีประวัติการแจ้งปัญหา</td></tr>';
        } else {
            recentReports.forEach(r => {
                const dateStr = formatDate(r.Time);
                const questionTextShort = r.Question ? r.Question.substring(0, 40) + '...' : '(ไม่ระบุ)';

                // สร้างลิงก์ Diff ถ้ามี Log
                let displayLink = `<span class="small text-dark">${questionTextShort}</span>`;
                const rQid = r.QuestionID || "";
                const qObj = globalData.questions.find(q => q.questionId === rQid);
                if (qObj) {
                    const log = (globalData.logs || [])
                        .filter(l => l.TargetID === qObj.questionId && l.OldValue)
                        .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))[0]; // เอาอันล่าสุด

                    if (log) {
                        displayLink = `<a href="#" class="dashboard-diff-btn fw-bold text-decoration-none" 
                        data-old="${encodeURIComponent(log.OldValue)}" 
                        data-new="${encodeURIComponent(log.NewValue)}">
                        <i class="fas fa-search-plus me-1"></i> ${questionTextShort}</a>`;
                    }
                }

                const statusBadge = (String(r.Done).toUpperCase() === 'TRUE')
                    ? '<span class="badge bg-success-subtle text-success border border-success-subtle rounded-pill px-3">Resolved</span>'
                    : '<span class="badge bg-warning-subtle text-warning border border-warning-subtle rounded-pill px-3 text-dark">Pending</span>';

                html += `
                <tr>
                    <td data-label="วันที่"><small class="text-muted">${dateStr}</small></td>
                    <td data-label="โจทย์">${displayLink}</td>
                    <td data-label="ปัญหา"><small class="text-truncate d-inline-block" style="max-width: 200px;">${r.ReportDetail || '-'}</small></td>
                    <td data-label="Admin Note"><small class="text-primary italic">${r.AdminNote || '-'}</small></td>
                    <td data-label="สถานะ" class="text-md-center">${statusBadge}</td>
                </tr>`;
            });
        }
        $('#dashboardRecentTable tbody').html(html);
    }

function populateFilters() {
        // --- 1. เก็บค่าที่ User เลือกค้างไว้ในปัจจุบันก่อนจะโดน Reset ---
        const currentValues = {
            searchSubj: $('#search-subject-filter').val(),
            searchCat: $('#search-category-filter').val(),
            dbSubj: $('#db-subject-filter').val(),
            dbCat: $('#db-category-filter').val(),
            reportSubj: $('#report-subject-filter').val(),
            structSubj: $('#struct-subject-filter').val()
        };

        // --- 2. สร้างรายการ Subject Options ตามปกติ ---
        const subjects = [...new Set(globalData.structure.map(s => s.SubjectID))].sort();
        let subjOpts = '<option value="">All Subjects</option>';
        subjects.forEach(s => subjOpts += `<option value="${s}">${s}</option>`);

        // อัปเดต HTML ของ Subject Select ทุกตัว
        $('#search-subject-filter, #db-subject-filter, #struct-subject-filter, #report-subject-filter').html(subjOpts);
        $('#new-category-subject').html('<option value="">-- Select Subject --</option>' + subjOpts.replace('All Subjects', ''));

        // --- 3. สร้างรายการ Category Options (แบบ Group ตามวิชา) ---
        let categoryOpts = '<option value="">All Categories</option>';
        subjects.forEach(subj => {
            const catsInSubj = globalData.category.filter(c => c.SubjectRef === subj);
            if (catsInSubj.length > 0) {
                categoryOpts += `<optgroup label="${subj}">`;
                catsInSubj.forEach(t => {
                    categoryOpts += `<option value="${t.CategoryID}">${t.CategoryName}</option>`;
                });
                categoryOpts += `</optgroup>`;
            }
        });

        const orphanCats = globalData.category.filter(c => !c.SubjectRef || !subjects.includes(c.SubjectRef));
        if (orphanCats.length > 0) {
            categoryOpts += `<optgroup label="Others">`;
            orphanCats.forEach(t => {
                categoryOpts += `<option value="${t.CategoryID}">${t.CategoryName} (${t.CategoryID})</option>`;
            });
            categoryOpts += `</optgroup>`;
        }

        // อัปเดต HTML ของ Category Select
        $('#search-category-filter, #db-category-filter').html(categoryOpts);

        // --- 4. คืนค่าเดิมที่ User เคยเลือกไว้ (The "Remember" Logic) ---

        // คืนค่า Subject
        if (currentValues.searchSubj) $('#search-subject-filter').val(currentValues.searchSubj);
        if (currentValues.dbSubj) $('#db-subject-filter').val(currentValues.dbSubj);
        if (currentValues.reportSubj) $('#report-subject-filter').val(currentValues.reportSubj);
        if (currentValues.structSubj) $('#struct-subject-filter').val(currentValues.structSubj);

        // สำคัญ: เนื่องจาก Category ขึ้นกับ Subject ต้องสั่งอัปเดต List ของ Category 
        // เฉพาะอันที่ไม่ได้เลือก "All" ไว้ เพื่อให้ Option ใน Dropdown ถูกต้องตามวิชานั้น
        if (currentValues.searchSubj) updateCategoryDropdown(currentValues.searchSubj, '#search-category-filter');
        if (currentValues.dbSubj) updateCategoryDropdown(currentValues.dbSubj, '#db-category-filter');

        // คืนค่า Category
        if (currentValues.searchCat) $('#search-category-filter').val(currentValues.searchCat);
        if (currentValues.dbCat) $('#db-category-filter').val(currentValues.dbCat);

        // --- 5. จัดการ Datalist สำหรับหน้า Converter (เหมือนเดิม) ---
        const uniqueSubjects = [];
        const seen = new Set();
        globalData.structure.forEach(s => {
            if (!seen.has(s.SubjectID)) {
                uniqueSubjects.push(s);
                seen.add(s.SubjectID);
            }
        });
        $('#subjectIdList').html(uniqueSubjects.map(s => `<option value="${s.SubjectID}">`).join(''));
        $('#subjectNameList').html(uniqueSubjects.map(s => `<option value="${s.SubjectName}">`).join(''));

        // --- 6. ซิงค์ค่าที่ Filter ในตาราง (ถ้ามี) กับ Dropdown ตามที่ User เคยเลือกไว้ก่อนหน้า ---
        const syncTableFilterToDropdown = (tableId, subjSelectId, catSelectId) => {
            if ($.fn.DataTable.isDataTable(tableId)) {
                const state = $(tableId).DataTable().state();
                if (state && state.columns) {
                    const savedSubj = state.columns[0].search.search;
                    const savedCat = state.columns[1].search.search;
                    if (savedSubj) {
                        $(subjSelectId).val(savedSubj);
                        updateCategoryDropdown(savedSubj, catSelectId);
                    }
                    if (savedCat) $(catSelectId).val(savedCat);
                }
            }
        };
        syncTableFilterToDropdown('#adminTable', '#db-subject-filter', '#db-category-filter');
        syncTableFilterToDropdown('#publicTable', '#search-subject-filter', '#search-category-filter');
    }

function updateCategoryDropdown(subjectId, targetSelector) {
        // ... (โค้ด updateCategoryDropdown เดิม) ...
        let options = '<option value="">All Categories</option>';

        const filteredCats = subjectId
            ? globalData.category.filter(c => c.SubjectRef === subjectId)
            : globalData.category;

        filteredCats.sort((a, b) => a.CategoryID.localeCompare(b.CategoryID));

        filteredCats.forEach(t => {
            options += `<option value="${t.CategoryID}">${t.CategoryName}</option>`;
        });

        $(targetSelector).html(options);
        // ... (จบโค้ด updateCategoryDropdown เดิม) ...
    }

function getSubjectFromCategory(categoryId) {
        // ... (โค้ด getSubjectFromCategory เดิม) ...
        if (!categoryId || !globalData.category || globalData.category.length === 0) return '-';

        let tid = Array.isArray(categoryId) ? String(categoryId[0]) : String(categoryId);
        tid = tid.trim();

        let category = globalData.category.find(t =>
            String(t.CategoryID).trim().toLowerCase() === tid.toLowerCase()
        );

        return category ? category.SubjectRef : '-';
        // ... (จบโค้ด getSubjectFromCategory เดิม) ...
    }
