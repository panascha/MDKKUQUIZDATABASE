// ─────────────────────────────────────────────────────
// JS/AUTH-GOOGLE.JS — Google SSO (บัญชีเดียวกับ MDKKUQUIZREAL)
// ใช้ localStorage key เดียวกัน (mdkku_session_token) — ทั้งสองแอปอยู่ origin เดียวกัน
// บน GitHub Pages (panascha.github.io) จึงเห็น token ร่วมกัน = ล็อกอินครั้งเดียวใช้ได้สองระบบ
// ─────────────────────────────────────────────────────

let _gsiReady = false;
let _gsiInitTries = 0;

// ตั้งสถานะ session จากผล Google login / resume — token เป็นตัวยืนยันสิทธิ์แทน adminPass
function applyGoogleSessionDb(user, token) {
    currentUser = user;
    sessionToken = token;
    adminPass = '';
    isAdmin = !!(user && user.role && user.role !== 'Student');
    updateAuthUI(true);
}

// ยืนยันตัวตนด้วยรหัสนักศึกษา — บัญชี auto-enroll ผ่าน Google SSO ยังไม่มีรหัส นศ. → ขอกรอกหลังล็อกอิน
// ข้ามได้ (ไม่บล็อกการใช้งาน) แต่ถามอีกครั้งในการล็อกอิน/กลับเข้าใช้ครั้งถัดไปจนกว่าจะกรอก
function promptStudentIdDb(user) {
    if (!user || (user.studentId && String(user.studentId).trim())) return;
    if (!sessionToken) return;
    // กด "ข้ามไปก่อน" แล้วพักการถาม 24 ชม. (คีย์ร่วม same-origin กับหน้า MDKKUQUIZ) — กันเด้งทุกครั้งที่รีเฟรช
    const snoozeUntil = parseInt(localStorage.getItem('mdkku_sid_snooze_until') || '0', 10);
    if (snoozeUntil && Date.now() < snoozeUntil) return;
    Swal.fire({
        title: 'ยืนยันตัวตน',
        input: 'text',
        inputLabel: 'กรุณากรอกรหัสนักศึกษาเพื่อยืนยันตัวตน',
        inputPlaceholder: 'เช่น 65xxxxxxxx',
        inputAttributes: { inputmode: 'numeric', maxlength: '12' },
        showCancelButton: true,
        confirmButtonText: 'บันทึก',
        cancelButtonText: 'ข้ามไปก่อน',
        allowOutsideClick: false,
        inputValidator: (value) => {
            if (!/^\d{6,12}$/.test(String(value || '').trim())) return 'รหัสนักศึกษาต้องเป็นตัวเลข 6-12 หลัก';
        },
        preConfirm: async (value) => {
            try {
                const res = await sendWithRetry({ action: 'saveStudentId', sessionToken: sessionToken, studentId: String(value).trim() });
                if (res.result !== 'success') { Swal.showValidationMessage(res.message || 'บันทึกไม่สำเร็จ'); return false; }
                return res.studentId;
            } catch (e) { Swal.showValidationMessage('เชื่อมต่อระบบไม่สำเร็จ'); return false; }
        }
    }).then((result) => {
        if (result.isConfirmed && result.value) {
            if (currentUser) currentUser.studentId = result.value;
            localStorage.removeItem('mdkku_sid_snooze_until');
            Swal.fire({ icon: 'success', title: 'ยืนยันตัวตนสำเร็จ', timer: 1500, showConfirmButton: false });
        } else {
            localStorage.setItem('mdkku_sid_snooze_until', String(Date.now() + 86400000)); // ข้าม → พัก 24 ชม.
        }
    });
}

// กู้คืน session ร่วมจากหน้า MDKKUQUIZ (ถ้าเคยล็อกอิน Google ไว้ที่ฝั่งไหนก็ตาม)
async function resumeSharedGoogleSession() {
    const token = localStorage.getItem(SHARED_TOKEN_KEY);
    if (!token) return;
    try {
        const res = await sendWithRetry({ action: 'verifySession', sessionToken: token });
        if (res.result === 'success') {
            applyGoogleSessionDb(res.user, token);
            console.log('🔐 Google session (ร่วมกับ MDKKUQUIZ) กู้คืนสำเร็จ: ' + res.user.displayName + ' [' + res.user.role + ']');
            promptStudentIdDb(res.user);
        } else {
            // token หมดอายุ/ถูกเพิกถอน — ล้างทิ้งทั้งสองแอปจะได้ไม่ยิง token ตายซ้ำ
            localStorage.removeItem(SHARED_TOKEN_KEY);
            if (sessionToken === token) sessionToken = '';
        }
    } catch (e) {
        console.warn('Google session resume ล้มเหลว (เครือข่าย?):', e);
    }
}

// รับ credential จาก Google Identity Services → แลก session token 30 วันจาก GAS
async function handleGoogleCredentialDb(response) {
    const idToken = response && response.credential;
    if (!idToken) return;

    Swal.fire({
        title: 'กำลังตรวจสอบบัญชี...',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        didOpen: () => { Swal.showLoading(); }
    });

    try {
        const res = await sendWithRetry({ action: 'checkGoogleAuth', idToken: idToken });

        if (res.result === 'success' && res.sessionToken) {
            localStorage.setItem(SHARED_TOKEN_KEY, res.sessionToken);
            applyGoogleSessionDb(res.user, res.sessionToken);
            $('#loginModal').modal('hide');

            if (isAdmin) {
                Swal.fire({
                    icon: 'success',
                    title: 'เข้าสู่ระบบแอดมินสำเร็จ',
                    html: 'ยินดีต้อนรับคุณ <b>' + res.user.displayName + '</b> (' + res.user.role + ')<br>' +
                        '<small>บัญชีนี้ใช้ในหน้าคลังข้อสอบ MDKKUQUIZ ได้เลยโดยไม่ต้องล็อกอินซ้ำ ' +
                        '(แก้ไขข้อสอบ + Edit Mode + AI Assistant)</small>',
                    timer: 3500,
                    showConfirmButton: false
                }).then(() => {
                    // โหลดข้อมูลหลังปิดป้ายต้อนรับ — fetchData ยิง toast ของตัวเองซึ่งจะแทนที่ Swal ที่ค้างอยู่
                    fetchData();
                    setTimeout(() => promptStudentIdDb(res.user), 800);
                });
            } else {
                Swal.fire({
                    icon: 'info',
                    title: 'เข้าสู่ระบบแล้ว (สิทธิ์นักศึกษา)',
                    html: 'ยินดีต้อนรับคุณ <b>' + res.user.displayName + '</b><br>' +
                        '<small>บัญชีนี้ยังไม่อยู่ใน whitelist แอดมิน จึงยังแก้ไขข้อสอบไม่ได้<br>' +
                        'สิทธิ์ที่ใช้ได้ในหน้า MDKKUQUIZ: ซิงค์ความคืบหน้าข้ามอุปกรณ์ + AI Study Assistant<br>' +
                        'ต้องการสิทธิ์แก้ไขข้อสอบ ติดต่อแอดมินเพื่อขอเพิ่มชื่อใน whitelist</small>',
                    confirmButtonText: 'เข้าใจแล้ว'
                }).then(() => promptStudentIdDb(res.user));
            }
        } else {
            Swal.fire('เข้าสู่ระบบไม่สำเร็จ', res.message || 'ไม่สามารถยืนยันบัญชีได้ กรุณาลองใหม่', 'error');
        }
    } catch (err) {
        console.error('Google auth error:', err);
        Swal.fire('ข้อผิดพลาด', 'ไม่สามารถตรวจสอบบัญชีกับระบบหลังบ้านได้', 'error');
    }
}

function renderGoogleButtonDb() {
    const el = document.getElementById('google-signin-btn-db');
    if (!el || !_gsiReady) return;
    el.innerHTML = '';
    google.accounts.id.renderButton(el, {
        theme: 'filled_blue',
        size: 'large',
        width: 260,
        shape: 'pill'
    });
}

function setupGoogleSsoDb() {
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
        if (_gsiInitTries++ < 10) setTimeout(setupGoogleSsoDb, 800);
        return;
    }
    try {
        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCredentialDb,
            use_fedcm_for_prompt: false
        });
        _gsiReady = true;
        renderGoogleButtonDb();
    } catch (e) {
        console.warn('GIS init ล้มเหลว:', e);
    }
}

$(function () {
    // resume ไม่ต้องรอ GIS โหลด — ใช้ token ที่มีอยู่ได้ทันที (ทับ session แบบ username/password เดิมถ้าสำเร็จ)
    resumeSharedGoogleSession();
    setTimeout(setupGoogleSsoDb, 500);
    // ปุ่ม Google อยู่ใน modal — render ซ้ำทุกครั้งที่เปิด (กันกรณี GIS โหลดเสร็จหลัง modal เคยเปิด)
    $('#loginModal').on('shown.bs.modal', renderGoogleButtonDb);
});
