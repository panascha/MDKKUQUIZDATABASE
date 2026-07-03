// ─────────────────────────────────────────────────────
// JS/API.JS
// ─────────────────────────────────────────────────────

async function fetchGAS(buildUrl, retries = 3) {
    const BASE_MS = 1500;
    const CAP_MS = 12000;

    for (let i = 0; i < retries; i++) {
        const url = typeof buildUrl === 'function' ? buildUrl() : buildUrl;
        let response;
        try {
            response = await fetch(url, { redirect: 'follow' });
        } catch (netErr) {
            if (i === retries - 1) throw netErr;
            const nd = Math.random() * Math.min(BASE_MS * Math.pow(2, i), CAP_MS);
            console.warn('[fetchGAS] Network error attempt ' + (i + 1) + '. Retry in ' + Math.round(nd) + 'ms');
            await new Promise(r => setTimeout(r, nd));
            continue;
        }

        if (!response.ok) {
            if (i === retries - 1) throw new Error('[fetchGAS] HTTP ' + response.status + ' after ' + retries + ' attempts');
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
            const pd = Math.random() * Math.min(BASE_MS * Math.pow(2, i), CAP_MS);
            console.warn('[fetchGAS] Got HTML body attempt ' + (i + 1) + '. Retry in ' + Math.round(pd) + 'ms');
            await new Promise(r => setTimeout(r, pd));
            continue;
        }

        return JSON.parse(text);
    }
}

async function sendWithRetry(payload, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(APPSCRIPT_URL, {
                    method: 'POST',
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify(payload),
                    redirect: 'follow'
                });
                if (!response.ok) throw new Error('Server Busy');
                return await response.json();
            } catch (err) {
                console.warn(`Attempt ${i + 1} failed. Retrying...`);
                if (i === retries - 1) throw err;
                // หน่วงเวลาเพิ่มขึ้นเรื่อยๆ ในแต่ละรอบที่ล้มเหลว (1s, 2s, 3s)
                await new Promise(res => setTimeout(res, 1000 * (i + 1)));
            }
        }
    }

async function sendAdminAction(actionName, dataObj, skipReload = false) {
        // 1. OPTIMISTIC UPDATE: แก้ไขข้อมูลในเครื่องทันทีตามประเภท Action
        if (actionName === 'deleteQuestion') {
            globalData.questions = globalData.questions.filter(q => q.questionId !== dataObj.id);
        }
        else if (actionName === 'updateReportStatus') {
            const rIdx = globalData.report.findIndex(r => String(r.Time) === String(dataObj.timestamp));
            if (rIdx !== -1) {
                globalData.report[rIdx].Status = dataObj.status;
                globalData.report[rIdx].AdminNote = dataObj.adminNote;
                globalData.report[rIdx].Done = dataObj.done;
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
                // ล้าง Cache ฝั่ง Server เมื่อสำเร็จ (ถ้ามีระบบ Cache ฝั่ง Apps Script)
                await clearAdminCache();

                // ถ้า skipReload เป็น false (ค่าเริ่มต้น) ให้แอบ Fetch ข้อมูลใหม่มาเช็คความแม่นยำ
                if (!skipReload) {
                    fetchData(false, true); // version-gated, isAutoPoll=true (เงียบๆ) — optimistic update already applied locally
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
