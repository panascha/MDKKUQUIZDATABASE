// ─────────────────────────────────────────────────────
// JS/PRIOR-AUDIT.JS — Prior Year Audit & Structural Checklist (Dashboard)
// เตือนแอดมินถ้าวิชาใดยังไม่มีข้อสอบ "รุ่นก่อนหน้า" (เลขรุ่นสอบฝังใน categoryId เช่น CVS_52FMT1)
// + เทียบกลุ่มข้อสอบ (MCQ1/MCQ2/FMT ฯลฯ) ระหว่างรุ่นล่าสุดกับรุ่นก่อนหน้า — ข้อมูลมาจาก GAS action=checkPriorYearAudit
// ─────────────────────────────────────────────────────

let priorAuditCache = null;
let priorAuditFetchedAt = 0;
const PRIOR_AUDIT_TTL_MS = 5 * 60 * 1000; // สอดคล้องกับ cache 30 นาทีฝั่ง backend — กันยิงซ้ำถี่เกินเวลาสลับเมนู

async function loadPriorYearAudit(force = false) {
    if (!force && priorAuditCache && (Date.now() - priorAuditFetchedAt < PRIOR_AUDIT_TTL_MS)) {
        renderPriorYearAudit(priorAuditCache);
        return;
    }

    $('#prior-audit-alerts').html('<div class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>กำลังตรวจสอบ...</div>');
    $('#prior-audit-body').html('');

    try {
        const res = await fetchGAS(() => `${APPSCRIPT_URL}?action=checkPriorYearAudit&_=${Date.now()}`);
        if (!res || res.status !== 'success') throw new Error((res && res.message) || 'โหลดข้อมูลตรวจสอบล้มเหลว');
        priorAuditCache = res;
        priorAuditFetchedAt = Date.now();
        renderPriorYearAudit(res);
    } catch (e) {
        console.error('[prior-audit] load failed:', e);
        $('#prior-audit-alerts').html(`<div class="alert alert-danger mb-0">โหลดข้อมูลตรวจสอบไม่สำเร็จ: ${e.message}</div>`);
        $('#prior-audit-body').html('<tr><td colspan="5" class="text-center text-danger py-4">โหลดข้อมูลไม่สำเร็จ</td></tr>');
    }
}

function renderPriorYearAudit(res) {
    const subjects = res.subjects || [];
    const missing = subjects.filter(s => !s.priorYearExists);
    const mismatched = subjects.filter(s => s.priorYearExists && s.structuralDiff &&
        (s.structuralDiff.onlyInLatest.length > 0 || s.structuralDiff.onlyInPrior.length > 0));

    // --- Alert notifications ---
    let alertsHtml = '';
    if (subjects.length === 0) {
        alertsHtml = '<div class="alert alert-secondary mb-0">ไม่พบวิชาที่มีรหัสรุ่นสอบ (เช่น _52MCQ1) ให้ตรวจสอบ</div>';
    } else if (missing.length === 0 && mismatched.length === 0) {
        alertsHtml = '<div class="alert alert-success mb-0"><i class="fas fa-check-circle me-2"></i>ทุกวิชามีข้อสอบรุ่นก่อนหน้าครบและโครงสร้างตรงกัน</div>';
    } else {
        if (missing.length > 0) {
            alertsHtml += `<div class="alert alert-danger mb-2"><i class="fas fa-exclamation-triangle me-2"></i>
                <strong>${missing.length} วิชา</strong> ยังไม่มีข้อสอบรุ่นก่อนหน้า (ควรแปลง/นำเข้าเพิ่ม):
                <div class="mt-2">${missing.map(s => `<span class="badge bg-danger-subtle text-danger border border-danger-subtle rounded-pill px-2 py-1 me-1 mb-1">${s.subjectName} (ขาดรุ่น ${s.priorYear})</span>`).join('')}</div>
            </div>`;
        }
        if (mismatched.length > 0) {
            alertsHtml += `<div class="alert alert-warning mb-0 text-dark"><i class="fas fa-info-circle me-2"></i>
                <strong>${mismatched.length} วิชา</strong> มีกลุ่มข้อสอบแตกต่างระหว่างรุ่นล่าสุดกับรุ่นก่อนหน้า — อาจเป็นการเปลี่ยนรูปแบบ/หลักสูตรโดยตั้งใจ ไม่จำเป็นต้องเป็นข้อผิดพลาด (ดูรายละเอียดในตารางด้านล่าง)
            </div>`;
        }
    }
    $('#prior-audit-alerts').html(alertsHtml);

    // --- Structural checklist table ---
    if (subjects.length === 0) {
        $('#prior-audit-body').html('<tr><td colspan="5" class="text-center text-muted py-4">-</td></tr>');
        return;
    }

    const renderGroupBadges = (groups, highlightSet) => {
        if (!groups || groups.length === 0) return '<span class="text-muted">-</span>';
        return groups.map(g => {
            const cls = highlightSet.has(g) ? 'bg-warning-subtle text-warning border-warning-subtle' : 'bg-light text-dark border-light';
            return `<span class="badge ${cls} border rounded-pill px-2 py-1 me-1 mb-1">${g}</span>`;
        }).join('');
    };

    const rows = subjects.map(s => {
        const onlyLatest = new Set(s.structuralDiff ? s.structuralDiff.onlyInLatest : []);
        const onlyPrior = new Set(s.structuralDiff ? s.structuralDiff.onlyInPrior : []);

        const statusBadge = !s.priorYearExists
            ? '<span class="badge bg-danger-subtle text-danger border border-danger-subtle rounded-pill px-3">ขาดรุ่นก่อนหน้า</span>'
            : (onlyLatest.size > 0 || onlyPrior.size > 0)
                ? '<span class="badge bg-warning-subtle text-warning border border-warning-subtle rounded-pill px-3 text-dark">รูปแบบต่างจากรุ่นก่อน</span>'
                : '<span class="badge bg-success-subtle text-success border border-success-subtle rounded-pill px-3">ตรงกัน</span>';

        return `<tr>
            <td><strong>${s.subjectName}</strong><br><span class="small text-muted">${s.subjectId}</span></td>
            <td><span class="badge bg-primary-subtle text-primary border border-primary-subtle rounded-pill px-2 py-1 me-1 mb-1">รุ่น ${s.latestYear}</span>${renderGroupBadges(s.latestGroups, onlyLatest)}</td>
            <td>${s.priorYearExists
                ? `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle rounded-pill px-2 py-1 me-1 mb-1">รุ่น ${s.priorYear}</span>${renderGroupBadges(s.priorGroups, onlyPrior)}`
                : `<span class="badge bg-danger-subtle text-danger border border-danger-subtle rounded-pill px-2 py-1">ไม่พบรุ่น ${s.priorYear}</span>`
            }</td>
            <td class="small text-muted">${s.years.join(', ')}</td>
            <td class="text-center">${statusBadge}</td>
        </tr>`;
    }).join('');

    $('#prior-audit-body').html(rows);
}
