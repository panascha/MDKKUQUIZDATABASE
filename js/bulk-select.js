// ─────────────────────────────────────────────────────
// JS/BULK-SELECT.JS — multi-row selection + chunked batch POST (F2)
// โหลดก่อน tables.js / categorizer.js
// ─────────────────────────────────────────────────────

// state = Set ของ id ใน JS (ไม่อ่านกลับจาก DOM) → รอดการเปลี่ยนหน้า/search/filter ของ DataTables
// ผู้เรียกต้องเรียก refresh() หลัง draw (แถวที่ DataTables cache ไว้ใน DOM อาจค้างสถานะ checked เก่า)
function createBulkSelection({ container, rowSelector, idAttr, onChange }) {
    const root = typeof container === 'string' ? document.querySelector(container) : container;
    const attr = idAttr || 'data-id';
    const ids = new Set();

    function refresh() {
        root.querySelectorAll('.bulk-check').forEach(cb => {
            const on = ids.has(cb.getAttribute(attr));
            cb.checked = on;
            const row = rowSelector ? cb.closest(rowSelector) : null;
            if (row) row.classList.toggle('bulk-selected', on);
        });
        if (onChange) onChange(ids);
    }

    root.addEventListener('change', function (e) {
        const cb = e.target;
        if (!cb || !cb.classList || !cb.classList.contains('bulk-check')) return;
        const id = cb.getAttribute(attr);
        if (id === null) return;
        if (cb.checked) ids.add(id); else ids.delete(id);
        refresh();
    });

    return {
        ids,
        refresh,
        clear() { ids.clear(); refresh(); },
        selectAll(list) { list.forEach(id => ids.add(String(id))); refresh(); },
        deselect(list) { list.forEach(id => ids.delete(String(id))); refresh(); }
    };
}

// POST ทีละ chunk ตามลำดับ (fetch เดียว ไม่ retry — retry อาจยิงซ้ำระหว่าง backend กำลังเขียน)
// items: array ที่แบ่งเป็น chunk (เช่น [{id, categoryId}]) · extra: { itemsKey = 'updates', ...fieldsที่ใส่ใน data }
// onProgress(processedCount, total) ถูกเรียกก่อนส่งแต่ละ chunk
// หยุดที่ chunk แรกที่ล้มเหลว (continueOnFail=true = ทำต่อ) → { applied, skipped, failed, done, failedItems, pending, error }
async function sendBulkChunks(action, items, extra, chunkSize, onProgress, continueOnFail) {
    const { itemsKey = 'updates', ...rest } = extra || {};
    const res = { applied: 0, skipped: 0, failed: 0, done: [], failedItems: [], pending: [], error: '', finalCategories: {} };
    for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        if (onProgress) onProgress(Math.min(i + chunk.length, items.length), items.length);
        let err = '';
        try {
            const resp = await fetch(APPSCRIPT_URL, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: action,
                    username: currentUser.username, adminPass: adminPass,
                    sessionToken: (typeof sessionToken === 'string' && sessionToken) || undefined,
                    data: Object.assign({}, rest, { [itemsKey]: chunk })
                })
            });
            const out = await resp.json();
            if (out.result === 'success') {
                res.applied += out.applied || 0;
                res.skipped += out.skipped || 0;
                res.done.push(...chunk);
                if (out.finalCategories) Object.assign(res.finalCategories, out.finalCategories);
            } else {
                err = out.message || 'error';
            }
        } catch (e) {
            err = String((e && e.message) || e);
        }
        if (err) {
            console.warn('[bulk] chunk failed:', action, err);
            res.failed += chunk.length;
            res.failedItems.push(...chunk);
            if (!res.error) res.error = err;
            if (!continueOnFail) {
                res.pending = items.slice(i + chunk.length);
                break;
            }
        }
    }
    return res;
}

// เพิ่ม categoryId เข้า q.category ใน globalData ให้ตรงกับที่ backend เพิ่งเขียน — items = [{id, categoryId}]
function applyAddedCategoriesLocally(items) {
    const byId = new Map();
    (globalData.questions || []).forEach(q => byId.set(String(q.questionId), q));
    items.forEach(u => {
        const q = byId.get(String(u.id));
        if (q && Array.isArray(q.category) && !q.category.includes(u.categoryId)) q.category.push(u.categoryId);
    });
}
