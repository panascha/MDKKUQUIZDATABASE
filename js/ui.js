// ─────────────────────────────────────────────────────
// JS/UI.JS
// ─────────────────────────────────────────────────────

function openResetFromProfile() {
        $('#editProfileModal').modal('hide'); // ปิดหน้าโปรไฟล์

        // ตั้งค่าข้อมูลเบื้องต้นในหน้า Reset ให้ (ถ้ามี)
        $('#reset-username').val(currentUser.username);
        $('#reset-kkumail').val(currentUser.kkumail || '');

        $('#resetModal').modal('show'); // เปิดหน้าเปลี่ยนรหัส
    }

function openEditProfile() {
        if (!currentUser.username) return;

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
                targetUsername: currentUser.username,
                updateData: updateData
            });

            if (res.result === 'success') {
                // อัปเดต Display Name ฝั่ง Client ทันทีเพื่อ UX ที่ดี
                currentUser.displayName = updateData.displayName;

                Swal.fire('สำเร็จ', 'อัปเดตข้อมูลโปรไฟล์เรียบร้อยแล้ว', 'success');
                $('#editProfileModal').modal('hide');
                await fetchData(); // โหลดข้อมูลใหม่ (เพื่อให้ได้ URL รูปจริงจาก Drive)
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
            <td class="text-center"><img src="${avatar}" width="40" height="40" class="rounded-circle border"></td>
            <td class="align-middle fw-bold">${u.Username}</td>
            <td class="align-middle">${u.FullName || '-'}</td>
            <td class="align-middle"><span class="badge ${roleBadge}">${u.Role}</span></td>
            <td class="align-middle small">${u.KKUMail || '-'}</td>
            <td class="align-middle">
                 <!-- ปุ่ม Action (ถ้ามีฟังก์ชัน Edit User ในอนาคต) -->
                <button class="btn btn-sm btn-outline-secondary" disabled title="Coming Soon"><i class="fas fa-cog"></i></button>
            </td>
        </tr>`;
        });
        listContainer.html(html);
    }

function checkAuthBeforeAction(callbackAction) {
        if (isAdmin && currentUser.username) {
            // ถ้าล็อกอินแล้ว ให้ทำงานนั้นๆ ต่อไปได้เลย
            if (typeof callbackAction === 'function') callbackAction();
            return true;
        }

        // ถ้ายังไม่ได้ล็อกอิน ให้ถามด้วย SweetAlert
        Swal.fire({
            title: 'ต้องเข้าสู่ระบบก่อนดำเนินการ',
            text: 'คุณมีบัญชีแอดมินสำหรับจัดการระบบหรือยัง?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'มีแล้ว (ไปหน้า Login)',
            cancelButtonText: 'ยังไม่มี (ไปหน้าสมัครสมาชิก)',
            confirmButtonColor: '#4e73df',
            cancelButtonColor: '#1cc88a',
        }).then((result) => {
            if (result.isConfirmed) {
                openLoginModal();
            } else if (result.dismiss === Swal.DismissReason.cancel) {
                openRegisterModal();
            }
        });
        return false;
    }

function openRegisterModal() {
        Swal.close(); // ปิด Modal Login
        $('#registerModal').modal('show');
        $('#registerForm').removeClass('was-validated');
    }

function validateRegistrationForm() {
        const kkumail = $('#reg-kkumail').val() ? $('#reg-kkumail').val().trim() : "";
        const studentId = $('#reg-studentid').val() ? $('#reg-studentid').val().trim() : ""; // แก้จาก reg-student-id เป็น reg-studentid
        const $form = $('#registerForm');
        let isValid = true;

        $form.find('input, select').removeClass('is-invalid');

        // 1. KKUMail validation
        const kkuMailRegex = /@kkumail\.com$|@kku\.ac\.th$/i;
        if (!kkuMailRegex.test(kkumail)) {
            $('#reg-kkumail').addClass('is-invalid');
            isValid = false;
        }

        // 2. StudentID validation (Format: 123456789-0)
        const studentIdRegex = /^\d{9}-\d$/;
        if (!studentIdRegex.test(studentId)) {
            $('#reg-studentid').addClass('is-invalid');
            isValid = false;
        }

        // 3. HTML5 required check
        $form.find('[required]').each(function () {
            if (!$(this).val()) {
                $(this).addClass('is-invalid');
                isValid = false;
            }
        });

        if (isValid) {
            $form.addClass('was-validated');
        } else {
            $form.removeClass('was-validated');
        }

        return isValid;
    }

function openLoginModal() {
        $('#loginModal').modal('show');
    }

function openResetModal() {
        $('#loginModal').modal('hide');
        $('#resetModal').modal('show');
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

function previewAvatar(input) {
        if (input.files && input.files[0]) {
            var file = input.files[0];
            if (file.size > 5 * 1024 * 1024) { // 5MB limit (ควรตรวจสอบใน submitRegister ด้วย)
                Swal.fire('Error', 'ขนาดรูปภาพต้องไม่เกิน 5MB', 'error');
                input.value = ""; // Clear selection
                return;
            }

            var reader = new FileReader();
            reader.onload = function (e) {
                $('#reg-avatar-preview').attr('src', e.target.result).removeClass('hidden');
                $('#reg-avatar-icon').addClass('hidden');
                regAvatarBase64 = e.target.result; // Store base64 string
                regAvatarMimeType = file.type; // Store MIME type
            }
            reader.readAsDataURL(file);
        } else {
            regAvatarBase64 = null;
            regAvatarMimeType = null;
        }
    }

async function submitRegister() {
        // 1. Validate Input
        const kkumail = $('#reg-kkumail').val().trim();
        const studentId = $('#reg-studentid').val().trim();
        const password = $('#reg-password').val();
        const username = $('#reg-username').val().trim();

        // Regex Check
        const emailRegex = /@(kkumail\.com|kku\.ac\.th)$/;
        const studentIdRegex = /^\d{9}-\d{1}$/;

        if (!emailRegex.test(kkumail)) {
            Swal.fire('Error', 'อีเมลต้องลงท้ายด้วย @kkumail.com หรือ @kku.ac.th', 'error');
            return;
        }
        if (!studentIdRegex.test(studentId)) {
            Swal.fire('Error', 'รหัสนักศึกษาไม่ถูกต้อง (Format: 123456789-0)', 'error');
            return;
        }
        if (username.length < 4 || password.length < 4) {
            Swal.fire('Error', 'Username และ Password ต้องมีความยาวอย่างน้อย 4 ตัวอักษร', 'error');
            return;
        }

        if (!validateRegistrationForm()) {
            Swal.fire('Error', 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน', 'error');
            return;
        }

        const fileInput = document.getElementById('reg-avatar-input'); // แก้ไขจาก reg-avatar-file เป็น reg-avatar-input
        if (fileInput && fileInput.files.length > 0) {
            if (fileInput.files[0].size > 5 * 1024 * 1024) {
                Swal.fire('Error', 'ขนาดรูปภาพต้องไม่เกิน 5MB', 'error');
                return;
            }
        }

        const avatarBase64 = regAvatarBase64;
        const avatarMimeType = regAvatarMimeType;
        let finalAvatar = regAvatarBase64;
        if (finalAvatar) {
            finalAvatar = await compressImage(finalAvatar); // ย่อรูปก่อนส่ง
        }

        // 2. Prepare Data
        const userData = {
            Username: username,
            Password: password,
            DisplayName: $('#reg-displayname').val().trim(),
            Prefix: $('#reg-prefix').val(),
            FullName: $('#reg-fullname').val().trim(),
            StudentID: studentId,
            Year: $('#reg-year').val(),
            KKUMail: kkumail,
            Contact: $('#reg-contact').val().trim(),
            Role: $('#reg-role').val(),
            AvatarBase64: finalAvatar // Send image data
        };

        // 3. Send to Server
        $('#registerModal').modal('hide');
        $('#loading-overlay').css('display', 'flex');
        try {
            const data = await sendWithRetry({
                action: 'registerAdmin',
                userData: userData
            });

            if (data.result === 'success') {
                const registeredUsername = userData.Username; // เก็บชื่อที่เพิ่งสมัครไว้

                Swal.fire({
                    title: 'สมัครสมาชิกสำเร็จ!',
                    text: 'ยินดีต้อนรับครับ! กรุณาเข้าสู่ระบบด้วยบัญชีที่เพิ่งสร้าง',
                    icon: 'success'
                }).then(() => {
                    $('#registerModal').modal('hide');
                    openLoginModal();
                    // กรอก Username ให้ผู้ใช้อัตโนมัติ
                    $('#login-username').val(registeredUsername);
                    $('#login-password').focus(); // ให้เคอร์เซอร์ไปรอที่ช่องรหัสผ่าน
                });
                fetchData();
            }
            else {
                Swal.fire('Error', data.message || 'เกิดข้อผิดพลาดในการลงทะเบียน', 'error');
            }
        } catch (e) {
            Swal.fire('Error', 'Server Error: ' + e.message, 'error');
        } finally {
            $('#loading-overlay').hide().find('h5').text('กำลังเชื่อมต่อฐานข้อมูล...');
        }
    }

async function submitResetPassword() {
        const data = {
            verifyData: {
                Username: $('#reset-username').val().trim(),
                KKUMail: $('#reset-kkumail').val().trim(),
                StudentID: $('#reset-studentid').val().trim(),
                FullName: $('#reset-fullname').val().trim()
            },
            newPassword: $('#reset-newpass').val()
        };

        if (!data.newPassword || data.newPassword.length < 4) {
            Swal.fire('Warning', 'กรุณาตั้งรหัสผ่านใหม่อย่างน้อย 4 ตัวอักษร', 'warning');
            return;
        }

        $('#loading-overlay').css('display', 'flex');
        try {
            const response = await fetch(APPSCRIPT_URL, {
                method: 'POST',
                redirect: "follow",
                headers: { "Content-Type": "text/plain" },
                body: JSON.stringify({
                    action: 'resetPassword',
                    ...data
                })
            });
            const res = await response.json();

            if (res.result === 'success') {
                Swal.fire('สำเร็จ', 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว กรุณาล็อกอินด้วยรหัสผ่านใหม่', 'success');
                $('#resetModal').modal('hide');
            } else {
                Swal.fire('Error', res.message, 'error');
            }
        } catch (e) {
            Swal.fire('Error', e.message, 'error');
        } finally {
            $('#loading-overlay').hide();
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
        isAdmin = false;
        adminPass = '';
        currentUser = { displayName: 'Guest', avatar: '', username: '', role: '' };
        updateAuthUI(false);
        showSection('dashboard');
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

            // 3. จัดการ Sidebar
            $('.admin-only').fadeIn();
            $('#user-status-display').html(`Logged in as:<br><b>${currentUser.displayName}</b>`).css('color', '#fff');

            // 4. สิทธิ์ Developer
            if (currentUser.role === 'DEVELOPER') {
                $('.developer-only').show();
            }

            // คลิกที่รูปหรือชื่อเพื่อเปิดโปรไฟล์
            $('#topbar-user, #topbar-avatar').off('click').on('click', openEditProfile);

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
        if (!isAdmin || !currentUser.username) {
            Swal.fire('Access Denied', 'เซสชันหมดอายุหรือคุณไม่มีสิทธิ์เข้าถึง กรุณาล็อกอินใหม่', 'warning');
            return false;
        }
        return true;
        // ... (จบโค้ด confirmAdmin เดิม) ...
    }

function showSection(sectionId) {

        const adminSections = ['report-inbox', 'database', 'structure', 'converter', 'logs', 'admin-manager', 'announcements'];

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
        if (sectionId === 'logs' || sectionId === 'admin-manager') {
            if (!isAdmin || currentUser.role !== 'DEVELOPER') {
                $(`#sec-${sectionId}`).addClass('hidden'); // ซ่อนส่วนที่ไม่ได้รับอนุญาต
                Swal.fire('Access Denied', 'สิทธิ์เข้าถึงถูกจำกัด: เฉพาะ DEVELOPER เท่านั้น', 'error');
                showSection('dashboard'); // Redirect
                return;
            } else if (sectionId === 'logs') {
                initLogsTable();
            } else if (sectionId === 'admin-manager') {
                loadAdminManager();
            }
        } else if (sectionId === 'announcements') {
            renderAnnouncementsList();
        }

        $('#page-title').text(sectionId.charAt(0).toUpperCase() + sectionId.slice(1).replace('-', ' '));

        refreshTables();

        if ($(window).width() < 768) {
            $("#wrapper").removeClass("toggled");
        }
    }
