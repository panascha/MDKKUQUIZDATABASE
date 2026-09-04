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


// ─────────────────────────────────────────────────────
// SUPABASE READ LAYER — Phase 1, slice `questions` เท่านั้น
//
// slice เล็กอีก 7 ตัว (structure/category/report/votes/logs/admins/announcements) ยังอยู่บน GAS
// ตาม sequencing constraint ใน §9.11: write surface ไหนที่ยังไม่ถูก mirror จะค้างให้เห็นในแดชบอร์ด
// ทันทีที่แอดมินแตะ — และ `admins` ต้องอยู่บน GAS ตลอดไป (§2 ชั้น "never")
//
// ทุกฟังก์ชันในบล็อกนี้เป็น no-op ถ้า window.USE_SUPABASE_QUESTIONS = false
// ─────────────────────────────────────────────────────

// §8.7(5): PostgREST บังคับ header `apikey` — Authorization: Bearer เปล่าๆ ถูกปฏิเสธ 401
function sbHeaders() {
    return {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        Accept: 'application/json'
    };
}

async function sbFetch(path, init, retries = 3) {
    const BASE_MS = 500;
    const CAP_MS = 8000;

    for (let i = 0; i < retries; i++) {
        let response;
        try {
            response = await fetch(SUPABASE_URL + '/rest/v1/' + path, init);
        } catch (netErr) {
            if (i === retries - 1) throw netErr;
            const nd = Math.random() * Math.min(BASE_MS * Math.pow(2, i), CAP_MS);
            console.warn('[sbFetch] Network error attempt ' + (i + 1) + '. Retry in ' + Math.round(nd) + 'ms');
            await new Promise(r => setTimeout(r, nd));
            continue;
        }

        // 4xx = คำขอผิดเอง (คีย์ผิด/คอลัมน์ผิด/RLS) — ยิงซ้ำได้ผลเดิม
        if (response.status >= 400 && response.status < 500) {
            throw new Error('[sbFetch] HTTP ' + response.status + ' ' + path + ' — ' + (await response.text()).slice(0, 200));
        }
        if (!response.ok) {
            if (i === retries - 1) throw new Error('[sbFetch] HTTP ' + response.status + ' after ' + retries + ' attempts');
            const hd = Math.random() * Math.min(BASE_MS * Math.pow(2, i), CAP_MS);
            console.warn('[sbFetch] HTTP ' + response.status + ' attempt ' + (i + 1) + '. Retry in ' + Math.round(hd) + 'ms');
            await new Promise(r => setTimeout(r, hd));
            continue;
        }

        return response.json();
    }
}

// §8.7(2): ผลลัพธ์ถูกตัดที่ 1000 แถวเสมอ และ "ต้อง" ใช้ ?limit=&offset= — header Range ถูกเมิน
// pathWithQuery ต้องมี order= ที่ unique อยู่แล้ว ไม่งั้น offset ข้ามแถว/ซ้ำแถวเงียบๆ
async function sbFetchPaged(pathWithQuery) {
    const pageSize = SUPABASE_PAGE_SIZE;
    const init = { headers: sbHeaders() };
    const out = [];

    for (let offset = 0; ; offset += pageSize) {
        const page = await sbFetch(pathWithQuery + '&limit=' + pageSize + '&offset=' + offset, init);
        if (!Array.isArray(page)) throw new Error('[sbFetchPaged] ไม่ได้ array จาก ' + pathWithQuery);
        out.push(...page);
        if (page.length < pageSize) return out;
    }
}

// cursor ของ delta — อ่านจาก DB เสมอ ห้ามใช้ Date.now() ของเครื่อง client
// คืน { questions: <ISO|null>, serverTime: <ISO>, questionCount: <int> }
async function fetchSupabaseDataVersion() {
    return sbFetch('rpc/data_version', {
        method: 'POST',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json' },
        body: '{}'
    });
}

// watermark → cursor ที่จะเก็บ: ถอยหลัง SAFETY_MS กัน updated_at ไม่ monotone (§9.12 ท้ายหัวข้อ)
function sbCursorFrom(dataVersion) {
    const raw = (dataVersion && (dataVersion.questions || dataVersion.serverTime)) || null;
    const ms = raw ? Date.parse(raw) : NaN;
    if (isNaN(ms)) return null;
    return new Date(ms - SUPABASE_CURSOR_SAFETY_MS).toISOString();
}

// โหลด questions เต็มก้อน — order=questionId (PRIMARY KEY, unique) ให้ offset เดินหน้าได้จริง
// คืน { rows, dataVersion } โดย dataVersion ถูกอ่าน "ก่อน" เดินหน้า pagination:
// แถวที่ commit ระหว่างเดินหน้าจะมี updatedAt > cursor ที่เก็บ ⇒ รอบ delta ถัดไปเก็บตกเอง
async function fetchSupabaseQuestionsFull() {
    const dataVersion = await fetchSupabaseDataVersion();
    const rows = await sbFetchPaged('v_questions?select=*&order=questionId');
    return { rows, dataVersion };
}

// delta ตั้งแต่ cursor — ใช้ v_questions_delta เพราะ view นี้ "ไม่กรอง" แถวที่ถูกลบอ่อน (D16)
// แถวที่ deletedAt ไม่ null คือ tombstone: client ต้องถอดออกจาก cache
// order=updatedAt,questionId — updatedAt ตัวเดียวไม่ unique, offset จะข้ามแถว
async function fetchSupabaseQuestionsDelta(sinceIso) {
    const dataVersion = await fetchSupabaseDataVersion();
    const rows = await sbFetchPaged(
        'v_questions_delta?select=*&updatedAt=gt.' + encodeURIComponent(sinceIso) + '&order=updatedAt,questionId'
    );
    return { rows, dataVersion };
}
