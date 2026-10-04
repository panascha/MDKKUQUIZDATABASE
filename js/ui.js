// ─────────────────────────────────────────────────────
// JS/UI.JS
// ─────────────────────────────────────────────────────

// Mobile utility: add mobile-view toggle and debounce helper
function debounce(fn, wait) {
    let t;
    return function () {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, arguments), wait);
    };
}

function updateMobileView() {
    var isMobile = window.innerWidth < 768;
    document.body.classList.toggle('mobile-view', isMobile);
    if (isMobile) applyMobileTableViews();
}

function applyMobileTableViews() {
    document.querySelectorAll('.content-section:not(.hidden) table').forEach(function (tbl) {
        if (tbl.id && $.fn && $.fn.DataTable && $.fn.DataTable.isDataTable('#' + tbl.id)) {
            var $tbl = $('#' + tbl.id);
            if (!$tbl.hasClass('view-as-card')) {
                try { setTableView(tbl.id, 'card', null); } catch (e) { /* ignore */ }
            }
        } else if (tbl.hasAttribute('data-mobile-card')) {
            // ตารางธรรมดา (ไม่ใช่ DataTable) ที่ opt-in ไว้ — แค่ติดคลาส .view-as-card พอ
            // ไม่ต้องมีปุ่มสลับมุมมองแบบ DataTables เพราะเป็นการ์ดเฉพาะบนมือถือเท่านั้น
            tbl.classList.add('view-as-card');
        }
    });
}

$(document).ready(function () {
    updateMobileView();
    $(window).on('resize', debounce(updateMobileView, 250));
});

function openEditProfile() {
        if (!currentUser.username && !currentUser.email) return;

        $('#ep-prefix').val(currentUser.prefix || '');
        $('#ep-fullname').val(currentUser.fullName || '');
        $('#ep-displayname').val(currentUser.displayName || '');
        $('#ep-year').val(currentUser.year || '');
        $('#ep-contact').val(currentUser.contact || '');
        $('#edit-avatar-preview').attr('src', currentUser.avatar);
        $('#editProfileModal').modal('show');
    }

async function updateUserProfile() {
        // ตรวจสอบรูปภาพ: ถ้า currentUser.avatar เป็น Base64 (จากการเลือกไฟล์ใหม่) ให้ส่งไป
        let avatarBase64 = null;
        if (currentUser.avatar && currentUser.avatar.startsWith('data:image')) {
            avatarBase64 = currentUser.avatar;
        }

        const updateData = {
            prefix: $('#ep-prefix').val(),
            fullName: $('#ep-fullname').val(),
            displayName: $('#ep-displayname').val(),
            year: $('#ep-year').val(),
            contact: $('#ep-contact').val(),
            AvatarBase64: avatarBase64 // ส่งค่า Base64 เพื่อให้ Backend อัปโหลดลง Drive
        };

        $('#loading-overlay').css('display', 'flex');
        try {
            const res = await sendWithRetry({
                action: 'updateAdminProfile',
                username: currentUser.username, // backend ตรวจว่าเป็นเจ้าของโปรไฟล์ (sessionToken แนบอัตโนมัติ; คู่นี้ใช้กับล็อกอินแบบรหัสผ่าน)
                adminPass: adminPass,
                targetUsername: currentUser.username,
                updateData: updateData
            });

            if (res.result === 'success') {
                // อัปเดต Display Name ฝั่ง Client ทันทีเพื่อ UX ที่ดี
                currentUser.displayName = updateData.displayName;

                Swal.fire('สำเร็จ', 'อัปเดตข้อมูลโปรไฟล์เรียบร้อยแล้ว', 'success');
                $('#editProfileModal').modal('hide');
                scheduleSync(); // delta sync — admins slice มาทั้งก้อน (ได้ URL รูปจริงจาก Drive เหมือนเดิม)
            } else {
                Swal.fire('Error', res.message || 'ไม่สามารถอัปเดตข้อมูลได้', 'error');
            }
        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'Server Connection Error: ' + error.message, 'error');
        } finally {
            $('#loading-overlay').hide();
        }
    }

function loadAdminManager() {
        renderAdminList();
        fetchDeveloperSlice('getAdminList', 'admins').then(ok => { if (ok) renderAdminList(); });
    }

function renderAdminList() {
        const listContainer = $('#admin-user-list');
        listContainer.empty();

        if (!globalData.admins || globalData.admins.length === 0) {
            listContainer.html('<tr><td colspan="6" class="text-center">ไม่พบข้อมูล Admin (หรือยังไม่ได้โหลด)</td></tr>');
            return;
        }

        let html = '';
        globalData.admins.forEach(u => {
            // ป้องกัน Error กรณี field ไม่มีค่า
            const avatar = u.AvatarURL || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
            const roleBadge = u.Role === 'DEVELOPER' ? 'bg-danger' : 'bg-primary';

            html += `
        <tr>
            <td class="text-center"><img src="${escapeHtml(avatar)}" width="40" height="40" class="rounded-circle border"></td>
            <td class="align-middle fw-bold">${escapeHtml(u.Username) || '-'}</td>
            <td class="align-middle">${escapeHtml(u.FullName) || '-'}</td>
            <td class="align-middle"><span class="badge ${roleBadge}">${escapeHtml(u.Role) || '-'}</span></td>
            <td class="align-middle small">${escapeHtml(u.KKUMail) || '-'}</td>
            <td class="align-middle">
                 <!-- ปุ่ม Action (ถ้ามีฟังก์ชัน Edit User ในอนาคต) -->
                <button class="btn btn-sm btn-outline-secondary" disabled title="Coming Soon"><i class="fas fa-cog"></i></button>
            </td>
        </tr>`;
        });
        listContainer.html(html);
    }

function checkAuthBeforeAction(callbackAction) {
        if (isAdmin && (currentUser.username || currentUser.email)) {
            // ถ้าล็อกอินแล้ว ให้ทำงานนั้นๆ ต่อไปได้เลย
            if (typeof callbackAction === 'function') callbackAction();
            return true;
        }

        // ล็อกอิน Google แล้วแต่เป็นระดับนักศึกษา (ไม่อยู่ใน whitelist แอดมิน)
        if (currentUser && currentUser.role === 'Student') {
            Swal.fire('สิทธิ์ไม่เพียงพอ',
                'บัญชีของคุณเป็นระดับนักศึกษา — การจัดการข้อสอบต้องเป็นแอดมิน (whitelist) ติดต่อแอดมินเพื่อขอสิทธิ์',
                'info');
            return false;
        }

        // ถ้ายังไม่ได้ล็อกอิน ให้ถามด้วย SweetAlert
        Swal.fire({
            title: 'ต้องเข้าสู่ระบบก่อนดำเนินการ',
            text: 'ล็อกอินด้วยบัญชี Google KKU (@kkumail.com / @kku.ac.th) เพื่อดำเนินการต่อ',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'ไปหน้า Login',
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#4e73df',
        }).then((result) => {
            if (result.isConfirmed) {
                openLoginModal();
            }
        });
        return false;
    }

function openLoginModal() {
        $('#loginModal').modal('show');
    }

function previewEditAvatar(input) {
        if (input.files && input.files[0]) {
            var file = input.files[0];
            if (file.size > 5 * 1024 * 1024) { // 5MB limit
                Swal.fire('Error', 'ขนาดรูปภาพต้องไม่เกิน 5MB', 'error');
                input.value = ""; // Clear selection
                return;
            }

            var reader = new FileReader();
            reader.onload = function (e) {
                $('#edit-avatar-preview').attr('src', e.target.result).removeClass('hidden');
                $('#edit-avatar-icon').addClass('hidden');
                currentUser.avatar = e.target.result; // Update currentUser avatar
            }
            reader.readAsDataURL(file);
        }
    }

async function performLogin() {
        const username = $('#login-username').val();
        const password = $('#login-password').val();

        if (!username || !password) return;

        $('#loading-overlay').css('display', 'flex');
        try {
            const data = await sendWithRetry({
                action: 'checkAuth',
                username: username,
                password: password
            });

            if (data.result === 'success') {
                currentUser = data.user;
                isAdmin = true;
                adminPass = password; // Store for session actions
                sessionToken = ''; // ล็อกอินแบบรหัสผ่าน — เลิกใช้ Google token เดิม (กัน token ตายไปทับ adminPass)

                localStorage.setItem('mdkku_admin_user', JSON.stringify(currentUser));
                localStorage.setItem('mdkku_admin_pass', adminPass);

                updateAuthUI(true);
                $('#loginModal').modal('hide');
                Swal.fire({
                    icon: 'success',
                    title: 'Welcome, ' + currentUser.displayName,
                    text: 'Role: ' + currentUser.role,
                    timer: 1500,
                    showConfirmButton: false
                });
                fetchData();
            } else {
                Swal.fire('Login Failed', data.message, 'error');
            }
        } catch (e) {
            Swal.fire('Error', e.message, 'error');
        } finally {
            $('#loading-overlay').hide();
        }
    }

function logoutAdmin() {

        localStorage.removeItem('mdkku_admin_user');
        localStorage.removeItem('mdkku_admin_pass');
        // Google SSO: เพิกถอน session ร่วม — มีผลกับหน้า MDKKUQUIZ ด้วย (บัญชีเดียวกัน)
        const tokenToDelete = sessionToken;
        if (tokenToDelete) {
            localStorage.removeItem(SHARED_TOKEN_KEY);
            sendWithRetry({ action: 'deleteSession', sessionToken: tokenToDelete }).catch(() => { });
            try { google.accounts.id.disableAutoSelect(); } catch (e) { }
        }
        sessionToken = '';
        isAdmin = false;
        adminPass = '';
        currentUser = { displayName: 'Guest', avatar: '', username: '', role: '' };
        updateAuthUI(false);
        showSection('dashboard');
        if (tokenToDelete) {
            Swal.fire({
                icon: 'success',
                title: 'ออกจากระบบแล้ว',
                text: 'มีผลกับหน้าคลังข้อสอบ MDKKUQUIZ ด้วย (บัญชีเดียวกัน)',
                timer: 2500,
                showConfirmButton: false
            });
        }
    }

function updateAuthUI(isLoggedIn) {
        if (isLoggedIn) {
            // 1. จัดการการแสดงผลของปุ่มที่ Topbar
            $('#auth-guest-view').addClass('hidden'); // ซ่อน Login/Register
            $('#auth-user-view').removeClass('hidden').addClass('d-flex'); // แสดงชื่อและรูป

            // 2. แสดงชื่อและรูปภาพ
            $('#topbar-user').text(currentUser.displayName || currentUser.username);

            // จัดการรูปโปรไฟล์ (ถ้าไม่มีรูปให้ใช้รูป Default)
            let avatarSrc = currentUser.avatar ? transformUrl(currentUser.avatar) : 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
            $('#topbar-avatar').attr('src', avatarSrc);

            // 3. จัดการ Sidebar — role Student (Google SSO, ไม่อยู่ใน whitelist) ไม่เห็นเมนูแอดมิน
            const isStudentRole = (currentUser.role === 'Student');
            if (isStudentRole) {
                $('.admin-only').hide();
                $('.developer-only').hide();
                $('#user-status-display').html(`Logged in as:<br><b>${escapeHtml(currentUser.displayName)}</b><br><small style="opacity:.75">นักศึกษา (Student)</small>`).css('color', '#fff');
            } else {
                $('.admin-only').fadeIn();
                $('#user-status-display').html(`Logged in as:<br><b>${escapeHtml(currentUser.displayName)}</b>`).css('color', '#fff');

                // 4. สิทธิ์ Developer
                if (currentUser.role === 'DEVELOPER') {
                    $('.developer-only').show();
                }

                // เติม badge "AI Models ต้องจัดการ" ให้แอดมิน (เฉพาะ admin ถึงจุดนี้ = gate getAIModels ไม่ให้ student ยิง GAS)
                if (typeof refreshAiModelsBadge === 'function') refreshAiModelsBadge();
            }

            // คลิกที่รูปหรือชื่อเพื่อเปิดโปรไฟล์ (เฉพาะบัญชีในชีต Admins — Student ไม่มีโปรไฟล์ให้แก้)
            if (isStudentRole) {
                $('#topbar-user, #topbar-avatar').off('click');
            } else {
                $('#topbar-user, #topbar-avatar').off('click').on('click', openEditProfile);
            }

        } else {
            // กรณี Logout หรือยังไม่ล็อกอิน
            $('#auth-guest-view').removeClass('hidden');
            $('#auth-user-view').addClass('hidden').removeClass('d-flex');
            $('.admin-only').hide();
            $('.developer-only').hide();
            $('#user-status-display').text('Guest User').css('color', 'rgba(255,255,255,0.6)');
        }
    }

async function toggleLogin() {
        // ... (โค้ด toggleLogin เดิม) ...
        if (!isAdmin) {
            openLoginModal();
        } else {
            logoutAdmin();
        }
        // ... (จบโค้ด toggleLogin เดิม) ...
    }

function confirmAdmin() {
        // ... (โค้ด confirmAdmin เดิม) ...
        if (!isAdmin || (!currentUser.username && !currentUser.email)) {
            Swal.fire('Access Denied', 'เซสชันหมดอายุหรือคุณไม่มีสิทธิ์เข้าถึง กรุณาล็อกอินใหม่', 'warning');
            return false;
        }
        return true;
        // ... (จบโค้ด confirmAdmin เดิม) ...
    }

function showSection(sectionId) {
        // หน้า AI Generate ถูกย้ายเข้าแท็บ Structure แล้ว — ค่า last-section เก่าใน localStorage ยังชี้มาที่นี่ได้
        if (sectionId === 'ai-generate') sectionId = 'structure';

        const adminSections = ['report-inbox', 'database', 'structure', 'converter', 'logs', 'admin-manager', 'announcements', 'ai-models', 'feedback', 'discussion', 'reviews', 'donations'];

        if (adminSections.includes(sectionId) && !isAdmin) {
            checkAuthBeforeAction(() => showSection(sectionId));
            return; // หยุดการทำงาน ไม่ให้เปลี่ยนหน้า
        }

        localStorage.setItem('mdkku_manager_last_section', sectionId);

        $('.content-section').addClass('hidden');
        $('.list-group-item').removeClass('active');
        $(`[onclick="showSection('${sectionId}')"]`).addClass('active');
        $(`#sec-${sectionId}`).removeClass('hidden');

        // ตรวจสอบสิทธิ์สำหรับ Logs และ Admin Manager
        if (sectionId === 'logs' || sectionId === 'admin-manager' || sectionId === 'reviews' || sectionId === 'donations' || sectionId === 'ai-models') {
            if (!isAdmin || currentUser.role !== 'DEVELOPER') {
                $(`#sec-${sectionId}`).addClass('hidden'); // ซ่อนส่วนที่ไม่ได้รับอนุญาต
                Swal.fire('Access Denied', 'สิทธิ์เข้าถึงถูกจำกัด: เฉพาะ DEVELOPER เท่านั้น', 'error');
                showSection('dashboard'); // Redirect
                return;
            } else if (sectionId === 'logs') {
                initLogsTable();
                fetchDeveloperSlice('getLogsPage', 'logs', { offset: 0, limit: 300 }).then(ok => { if (ok) initLogsTable(); });
            } else if (sectionId === 'admin-manager') {
                loadAdminManager();
            } else if (sectionId === 'reviews') {
                loadReviewsSection();
            } else if (sectionId === 'donations') {
                loadDonationsSection();
            } else if (sectionId === 'ai-models') {
                renderAiModelsPanel();
            }
        } else if (sectionId === 'announcements') {
            renderAnnouncementsList();
        } else if (sectionId === 'structure') {
            renderAiGeneratePanel(); // เติม dropdown วิชาของ AI Categorize + Maintenance jobs ที่ย้ายมาอยู่หน้านี้
        } else if (sectionId === 'feedback') {
            loadFeedbackSection();
        } else if (sectionId === 'discussion') {
            loadDiscussionSection();
        } else if (sectionId === 'dashboard') {
            loadPriorYearAudit();
        }

        $('#page-title').text(sectionId.charAt(0).toUpperCase() + sectionId.slice(1).replace('-', ' '));

        refreshTables();

        if ($(window).width() < 768) {
            $("#wrapper").removeClass("toggled");
            // ตารางบางส่วน (logsTable เป็น DataTable ที่สร้างแบบ lazy, ตารางธรรมดาอื่นๆ) เพิ่งถูก
            // render/init ในบล็อกด้านบน — updateMobileView() เดิมทำงานแค่ตอน DOM ready + resize
            // เท่านั้น จึงพลาดตารางที่โผล่มาทีหลังจากการสลับ section บนมือถือ
            applyMobileTableViews();
        }
    }

// ปุ่มลัด topbar "เพิ่ม/แก้ไขข้อสอบ" — แก้ไขข้อเดิมที่ "จัดการ Database", เพิ่มข้อใหม่ผ่าน Converter (PDF→AI)
function openManageQuestionsMenu() {
    Swal.fire({
        title: 'จัดการข้อสอบ',
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '<i class="fas fa-edit"></i> แก้ไขข้อสอบเดิม',
        denyButtonText: '<i class="fas fa-file-import"></i> เพิ่มข้อสอบใหม่ (PDF→AI)',
        cancelButtonText: 'ปิด',
        confirmButtonColor: '#4e73df',
        denyButtonColor: '#1cc88a'
    }).then((r) => {
        if (r.isConfirmed) {
            showSection('database');
        } else if (r.isDenied) {
            showSection('converter');
        }
    });
}

// ล้างแคช IndexedDB ของแอดมินแล้วโหลดข้อมูลใหม่ (แก้ปัญหาข้อมูลค้าง/ไม่อัปเดต)
// DATABASE ไม่มี service worker → ล้าง store เดียวก็เคลียร์แคชครบ
function clearAdminCacheAndReload() {
    Swal.fire({
        title: 'ล้างแคชและโหลดใหม่?',
        text: 'ข้อมูลที่ยังไม่ได้บันทึก (เช่น งานแปลง PDF ที่ค้างอยู่) จะหายไป',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'ล้างแคช',
        cancelButtonText: 'ยกเลิก'
    }).then(async (r) => {
        if (!r.isConfirmed) return;
        try { await clearAdminCache(); } catch (e) { /* เคลียร์ไม่ได้ก็ยัง reload ต่อ */ }
        location.reload();
    });
}

// ─────────────────────────────────────────────────────
// COPY QUESTION → AI PROMPT (ใช้ร่วมกันโดย report.js และ question.js)
// ─────────────────────────────────────────────────────

// สร้าง prompt วิเคราะห์ข้อสอบ 5 ส่วน (มาตรฐานกลาง)
// NOTE: มีสำเนาชุดเดียวกันอยู่ที่ MDKKUQUIZREAL/js/ui.js — แก้ที่นี่แล้วต้องแก้อีกฝั่งด้วย
// choices รับได้ทั้ง array และ string ที่คั่นด้วย '///'
window.buildQuestionAiPrompt = function (problem, choices) {
    const choicesArray = Array.isArray(choices) ? choices : String(choices || "").split("///");

    const choicesText = choicesArray.map(c => String(c || "").trim()).filter(Boolean).map((c, i) => {
        // ถ้าตัวเลือกมี prefix (A. / B)) มาในข้อมูลอยู่แล้ว ไม่ต้องใส่ซ้ำ
        const prefix = /^[A-E]\s*[\.\)]/i.test(c) ? "" : `${String.fromCharCode(65 + i)}. `;
        if (c.startsWith('<svg')) return `${prefix}[รูปภาพ SVG]`;
        if (/^https?:\/\//i.test(c)) return `${prefix}[รูปภาพประกอบ]`;
        return `${prefix}${c}`;
    }).join("\n");

    return `
คุณคือผู้เชี่ยวชาญทางการแพทย์ ช่วยวิเคราะห์ข้อสอบแพทย์ข้อนี้ โดยอธิบายตามหลักการทางวิทยาศาสตร์และการแพทย์ตรงๆ ไม่ต้องใช้การเปรียบเทียบหรืออุปมา กระชับ ไม่เยิ่นเย้อ

อธิบายตาม 5 ส่วนนี้:

1. เฉลยและเหตุผลหลัก
คำตอบที่ถูกต้อง + เหตุผลสรุปเป็นหลักการตรงไปตรงมา

2. กลไกและพยาธิสรีรวิทยา (Causal Mechanism)
แสดงลำดับเหตุและผล (A → B → C) พร้อมอธิบาย "ทำไม" แต่ละขั้นตอนจึงเกิดขึ้น ไม่ใช่แค่บอกว่าเกิดอะไร

3. วิเคราะห์ตัวเลือกอื่น & Keywords
สำหรับแต่ละ choice ที่ไม่ใช่คำตอบ อธิบายสั้นๆ ว่าผิดเพราะอะไร และถ้าจะถูกต้องเป็นเคสแบบไหน

4. Key Concepts & Keywords สำคัญ
สรุปคำสำคัญ/จุดจำ High-Yield ที่เกี่ยวข้องกับข้อนี้

5. บริบททางคลินิก & แหล่งอ้างอิง
แนวทางรักษา/Guideline/ตำราอ้างอิงสั้นๆ (เช่น Harrison's, Robbins, UpToDate) พร้อมบอกหน้า/บทถ้าทราบ

---
โจทย์: ${problem}

ตัวเลือก:
${choicesText}
`.trim();
};

// คัดลอก prompt ลง clipboard พร้อม toast (มี fallback สำหรับเบราว์เซอร์ที่ไม่รองรับ Clipboard API)
window.copyQuestionPrompt = function (problem, choices) {
    if (!problem) {
        Swal.fire('ข้อมูลไม่ครบ', 'ไม่พบโจทย์ที่จะคัดลอก', 'warning');
        return;
    }

    const textToCopy = window.buildQuestionAiPrompt(problem, choices);
    const ok = (suffix) => window.bgToast.fire({
        icon: 'success',
        title: `คัดลอกโจทย์พร้อม Prompt สำเร็จ!${suffix || ''}`,
        timer: 2000
    });

    navigator.clipboard.writeText(textToCopy).then(() => ok()).catch(() => {
        const tempTextarea = document.createElement('textarea');
        tempTextarea.value = textToCopy;
        tempTextarea.style.position = 'fixed';
        document.body.appendChild(tempTextarea);
        tempTextarea.select();
        try {
            document.execCommand('copy');
            ok(' (Fallback)');
        } catch (e) {
            Swal.fire('ไม่สามารถคัดลอกได้', 'กรุณาคัดลอกข้อมูลโจทย์ด้วยตนเอง', 'error');
        } finally {
            document.body.removeChild(tempTextarea);
        }
    });
};
