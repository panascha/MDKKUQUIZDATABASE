// ─────────────────────────────────────────────────────
// JS/API.JS
// ─────────────────────────────────────────────────────

// ⚠️ RETRY AMPLIFICATION GUARD (2026-08-02) — ดู comment เต็มใน MDKKUQUIZREAL/js/api.js
//   getAllData = 26MB / 135s เมื่อ cache miss. retry 3 ครั้งด้วย URL ใหม่ = GAS สร้าง execution
//   ซ้อนกัน 3 ตัว ตัวเก่าไม่หยุด → คิว execution ของบัญชีเจ้าของเต็ม → ทุกตัวไปตายที่เพดาน 6 นาที
//   retry เฉพาะที่ล้มเร็ว (cold-start/echo key) เท่านั้น
const GAS_SLOW_FAIL_MS = 15000;
// เขียน (editQuestion ฯลฯ) ใช้เวลานาน 15-25s ปกติ (Sheet sort + lock) — timeout สั้นตัด save ที่สำเร็จอยู่แล้วออกก่อนเวลา
const POST_SLOW_FAIL_MS = 60000;

async function fetchGAS(buildUrl, retries = 3) {
    const BASE_MS = 1500;
    const CAP_MS = 12000;

    for (let i = 0; i < retries; i++) {
        const url = typeof buildUrl === 'function' ? buildUrl() : buildUrl;
        const attemptStart = Date.now();
        let response;
        try {
            response = await fetch(url, { redirect: 'follow' });
        } catch (netErr) {
            if (i === retries - 1) throw netErr;
            if (Date.now() - attemptStart > GAS_SLOW_FAIL_MS) throw netErr;
            const nd = Math.random() * Math.min(BASE_MS * Math.pow(2, i), CAP_MS);
            console.warn('[fetchGAS] Network error attempt ' + (i + 1) + '. Retry in ' + Math.round(nd) + 'ms');
            await new Promise(r => setTimeout(r, nd));
            continue;
        }

        if (!response.ok) {
            if (i === retries - 1) throw new Error('[fetchGAS] HTTP ' + response.status + ' after ' + retries + ' attempts');
            // ล้มช้า = เซิร์ฟเวอร์ยังประมวลผลคำขอเดิมอยู่ (เช่น getAllData 26MB) — ยิงซ้ำมีแต่ซ้อนงาน
            if (Date.now() - attemptStart > GAS_SLOW_FAIL_MS) {
                throw new Error('[fetchGAS] HTTP ' + response.status + ' after ' + Math.round((Date.now() - attemptStart) / 1000) + 's — ไม่ retry (เซิร์ฟเวอร์ยังประมวลผลคำขอเดิมอยู่)');
            }
            const hd = Math.random() * Math.min(BASE_MS * Math.pow(2, i), CAP_MS);
            console.warn('[fetchGAS] HTTP ' + response.status + ' attempt ' + (i + 1) + '. Retry in ' + Math.round(hd) + 'ms');
            await new Promise(r => setTimeout(r, hd));
            continue;
        }

        let text;
        try {
            text = await response.text();
        } catch (readErr) {
            if (i === retries - 1) throw readErr;
            continue;
        }

        if (!text || text.trimStart().startsWith('<')) {
            if (i === retries - 1) throw new SyntaxError('[fetchGAS] Got HTML instead of JSON after ' + retries + ' attempts');
            if (Date.now() - attemptStart > GAS_SLOW_FAIL_MS) throw new SyntaxError('[fetchGAS] Got HTML body หลังรอ ' + Math.round((Date.now() - attemptStart) / 1000) + 's — ไม่ retry');
            const pd = Math.random() * Math.min(BASE_MS * Math.pow(2, i), CAP_MS);
            console.warn('[fetchGAS] Got HTML body attempt ' + (i + 1) + '. Retry in ' + Math.round(pd) + 'ms');
            await new Promise(r => setTimeout(r, pd));
            continue;
        }

        return JSON.parse(text);
    }
}

// Google SSO: แนบ sessionToken อัตโนมัติทุก request — backend ตรวจ sessionToken ก่อน username+adminPass เสมอ
async function sendWithRetry(payload, retries = 3, signal = null) {
    if (typeof sessionToken === 'string' && sessionToken && payload && !payload.sessionToken) {
        payload.sessionToken = sessionToken;
    }

    const BASE_MS = 1000;
    const CAP_MS = 10000;

    for (let i = 0; i < retries; i++) {
        if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const attemptStart = Date.now();
        let response;
        try {
            response = await fetch(APPSCRIPT_URL, {
                method: 'POST',
                redirect: 'follow',
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(payload),
                signal: signal || undefined
            });
        } catch (networkErr) {
            if (networkErr && networkErr.name === 'AbortError') throw networkErr;
            if (i === retries - 1) throw networkErr;
            if (Date.now() - attemptStart > POST_SLOW_FAIL_MS) throw networkErr;
            const netDelay = Math.random() * Math.min(BASE_MS * Math.pow(2, i), CAP_MS);
            console.warn(`Attempt ${i + 1} failed (network). Retrying in ${Math.round(netDelay)}ms...`);
            await new Promise(res => setTimeout(res, netDelay));
            continue;
        }

        if (!response.ok) {
            const status = response.status;
            if (status >= 400 && status < 500 && status !== 429 && status !== 404) {
                throw new Error('Client error ' + status);
            }
            if (i === retries - 1) throw new Error('Server error ' + status + ' after ' + retries + ' attempts');
            if (status !== 429 && Date.now() - attemptStart > POST_SLOW_FAIL_MS) {
                throw new Error('Server error ' + status + ' after ' + Math.round((Date.now() - attemptStart) / 1000) + 's — ไม่ retry (คำขอเดิมอาจยังทำงานอยู่)');
            }
            let retryDelay;
            if (status === 429) {
                const retryAfterHdr = response.headers.get('Retry-After');
                const retryAfterSec = retryAfterHdr ? parseFloat(retryAfterHdr) : NaN;
                retryDelay = !isNaN(retryAfterSec) && retryAfterSec > 0
                    ? retryAfterSec * 1000
                    : Math.random() * Math.min(BASE_MS * Math.pow(2, i), CAP_MS);
            } else {
                retryDelay = Math.random() * Math.min(BASE_MS * Math.pow(2, i), CAP_MS);
            }
            console.warn(`Attempt ${i + 1} failed (${status}). Retrying in ${Math.round(retryDelay)}ms...`);
            await new Promise(res => setTimeout(res, retryDelay));
            continue;
        }

        let resJson;
        try {
            resJson = await response.json();
        } catch (parseErr) {
            if (i === retries - 1) throw parseErr;
            const parseDelay = Math.random() * Math.min(BASE_MS * Math.pow(2, i), CAP_MS);
            console.warn(`Attempt ${i + 1} failed (bad JSON). Retrying in ${Math.round(parseDelay)}ms...`);
            await new Promise(res => setTimeout(res, parseDelay));
            continue;
        }

        if (resJson && resJson.result === 'error' &&
            (resJson.message === 'session_expired' ||
             resJson.message === 'token_expired' ||
             resJson.message === 'Session หมดอายุ กรุณาล็อกอินใหม่')) {
            if (typeof window.logoutEditModeSilent === 'function') {
                window.logoutEditModeSilent();
            }
        }

        return resJson;
    }
}

async function sendAdminAction(actionName, dataObj, skipReload = false) {
        // 1. OPTIMISTIC UPDATE: แก้ไขข้อมูลในเครื่องทันทีตามประเภท Action
        if (actionName === 'deleteQuestion') {
            globalData.questions = globalData.questions.filter(q => q.questionId !== dataObj.id);
        }
        else if (actionName === 'updateReportStatus') {
            if (dataObj.questionId) {
                // Batch: update all reports with same QuestionID
                const targetQid = String(dataObj.questionId).trim();
                globalData.report.forEach(r => {
                    if (String(r['QuestionID'] || "").trim() === targetQid) {
                        r.Status = dataObj.status;
                        r.AdminNote = dataObj.adminNote;
                        r.Done = dataObj.done;
                    }
                });
            } else {
                const rIdx = globalData.report.findIndex(r => String(r.Time) === String(dataObj.timestamp));
                if (rIdx !== -1) {
                    globalData.report[rIdx].Status = dataObj.status;
                    globalData.report[rIdx].AdminNote = dataObj.adminNote;
                    globalData.report[rIdx].Done = dataObj.done;
                }
            }
        }
        else if (actionName === 'deleteCategory') {
            globalData.category = globalData.category.filter(c => c.CategoryID !== dataObj.CategoryID);
        }
        // เพิ่มเติมสำหรับการลบ Subject หรือ Group ได้ตามต้องการ...

        // 2. บันทึกผลลง Cache และวาดตารางใหม่ทันที (User จะเห็นความเปลี่ยนแปลงทันที)
        await setCacheDB('global_admin_data', globalData);
        refreshTables();
        updateDashboard();

        // 3. เตรียมส่งข้อมูลไปที่ Server (Background Process)
        try {
            const payload = {
                action: actionName,
                username: currentUser.username,
                adminPass: adminPass,
                user: currentUser.displayName,
                data: dataObj,
                metadata: navigator.userAgent
            };

            // ถ้าไม่ใช่การลบ (ซึ่งทำไปแล้ว) อาจจะโชว์ Loading เล็กน้อย หรือถ้าอยากให้เงียบไปเลยก็ได้
            // ในที่นี้เลือกที่จะส่งไปเลยเงียบๆ (Background)
            const resJson = await sendWithRetry(payload);

            if (resJson.result === 'success') {
                // ไม่ล้าง IndexedDB อีกต่อไป — delta sync เขียนทับข้อมูลถูกต้องเองอยู่แล้ว (การ wipe ทำให้ต้องโหลด 24MB ใหม่ทุกครั้ง)
                // ถ้า skipReload เป็น false (ค่าเริ่มต้น) นัด delta sync แบบ debounce — action ติดกันหลายครั้ง ⇒ sync เดียว
                if (!skipReload) {
                    scheduleSync();
                }

                // แจ้งเตือนความสำเร็จแบบ Toast มุมจอ
                Swal.fire({
                    icon: 'success',
                    title: 'ซิงค์ข้อมูลสำเร็จ',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 2000
                });

                return resJson;
            } else {
                throw new Error(resJson.message || 'Server error');
            }
        } catch (e) {
            console.error("Admin Action Sync Error:", e);
            // หาก Server พัง ให้แจ้งเตือนและบังคับโหลดข้อมูลใหม่เพื่อคืนค่าเดิมที่ถูกต้องจาก Server
            Swal.fire({
                title: 'การซิงค์ข้อมูลล้มเหลว',
                text: 'ข้อมูลในเครื่องอาจไม่ตรงกับเซิร์ฟเวอร์ ระบบจะทำการรีโหลดข้อมูลใหม่: ' + e.message,
                icon: 'error'
            }).then(() => {
                fetchData(true);
            });
            throw e;
        }
    }

async function hashPassword(password) {
        // ... (โค้ด hashPassword เดิม) ...
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
        // ... (จบโค้ด hashPassword เดิม) ...
    }
