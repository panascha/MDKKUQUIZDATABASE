# แผนการ Refactor: MDKKU Manager Center (`index.html`)

> แผนการนี้เน้น **การย้ายโค้ดโดยไม่เปลี่ยนแปลงตรรกะภายใน (Logic) หรือแก้ไขการทำงานของฟังก์ชันแม้แต่บรรทัดเดียว** โดยใช้วิธีเชื่อมโยงสถานะผ่าน Global Scope Bridge ซึ่งช่วยลดความเสี่ยงจากการพังของระบบอย่างสมบูรณ์ ไฟล์ต้นฉบับ `index.html` มีขนาด **8,213 บรรทัด** แบ่งเป็น CSS ~1,800 บรรทัด และ JavaScript ~5,400 บรรทัด

---

## 1. โครงสร้างโฟลเดอร์เป้าหมาย (Target Directory Structure)

```
MDKKU_MANAGER/
├── index.html                  (เหลือเฉพาะโครงร่าง HTML Head & Body ~800 บรรทัด)
├── index.backup.html           (ไฟล์สำรองกู้คืนฉุกเฉิน)
│
├── css/                        (~1,800 บรรทัด รวม แบ่งเป็น 11 ไฟล์)
│   ├── main.css                (Entry point: @import ทุกไฟล์ตามลำดับ)
│   ├── variables.css           (CSS Custom Properties & Base Styles — 4.1)
│   ├── layout.css              (Sidebar, Page Content, Topbar — 4.2 & 4.3)
│   ├── modals.css              (Modal กลาง, Auth Modal — 4.4)
│   ├── modal-report.css        (Report Modal เฉพาะส่วน — 4.5)
│   ├── modal-vote.css          (Vote/Category Modal เฉพาะส่วน — 4.6)
│   ├── components.css          (Cards, Choices, Gallery, SVG, Badges — 4.7)
│   ├── tables.css              (DataTables, Diff Viewer, Editable Cells — 4.8)
│   ├── converter.css           (Converter Area, Tabs, Control Panel — 4.9)
│   ├── structure.css           (Tree View, Node Styles, CRUD Buttons — 4.10)
│   └── responsive.css          (Mobile Card View & Breakpoint Overrides — 4.11)
│
└── js/                         (~5,400 บรรทัด รวม แบ่งเป็น 11 ไฟล์)
    ├── config.js               (ตัวแปรคงที่, Global State Bridge, Toast Mixin)
    ├── db.js                   (ระบบแคช IndexedDB)
    ├── api.js                  (Network requests, Admin actions, Hash)
    ├── ui.js                   (Section switching, Auth UI, Profile modals)
    ├── tables.js               (DataTables renderer, Diff Viewer)
    ├── question.js             (โจทย์, Choices, รูปภาพ, Image Library)
    ├── vote.js                 (Vote/Category proposal system)
    ├── report.js               (Report inbox, Admin report handler)
    ├── structure.js            (Folder tree view, CRUD วิชา/กลุ่ม/หัวข้อ)
    ├── converter.js            (Converter V4, Multi-edit, Preview)
    └── app.js                  (fetchData, polling, Event Listeners, Bootstrap)
```

---

## 2. การจัดการตัวแปรและสถานะส่วนกลาง (Global State Bridge)

เนื่องจากไฟล์ JS ทั้งหมดโหลดผ่านแท็ก `<script>` ธรรมดา (ไม่ใช่ ES Module) เบราว์เซอร์จะรันทุกไฟล์ใน **Global Execution Context เดียวกัน** ดังนั้นจึงใช้เทคนิค **Global Scope Bridge** ใน `js/config.js` เพื่อประกาศตัวแปรแชร์ทั้งหมดบน `window` โดยไม่ต้องแก้ไขโค้ดในไฟล์อื่นแม้แต่จุดเดียว

```javascript
// js/config.js
// ─────────────────────────────────────────────────────
// SECTION 1: API Endpoint
// ─────────────────────────────────────────────────────
window.APPSCRIPT_URL = 'https://script.google.com/macros/s/AKfycb.../exec';

// ─────────────────────────────────────────────────────
// SECTION 2: Global Data Store
// ─────────────────────────────────────────────────────
window.globalData = {
    questions: [],
    structure: [],
    category: [],
    report: [],
    votes: [],
    logs: [],
    admins: []
};

// ─────────────────────────────────────────────────────
// SECTION 3: Session & Auth State
// ─────────────────────────────────────────────────────
window.currentUser   = { displayName: 'Guest', avatar: '', username: '', role: '' };
window.isAdmin       = false;
window.adminPass     = '';
window.isLoggedIn    = false;
window.sectionId     = null;
window.sectionName   = null;

// ─────────────────────────────────────────────────────
// SECTION 4: Question Editor State
// ─────────────────────────────────────────────────────
window.current_question      = {};
window.editImageArray        = [];
window.editImageIndex        = 0;
window.activeUploadsCount    = 0;
window.existingMainImages    = [];
window.pendingMainImages     = [];
window.choiceImagesData      = {};
window.choiceRowCounter      = 0;
window.currentLibraryTarget  = { type: 'main', rowId: null };

// ─────────────────────────────────────────────────────
// SECTION 5: UI Interaction State
// ─────────────────────────────────────────────────────
window.isMouseDown   = false;
window.startCell     = null;
window.isFetching    = false;

// ─────────────────────────────────────────────────────
// SECTION 6: Registration Avatar State
// ─────────────────────────────────────────────────────
window.regAvatarBase64   = null;
window.regAvatarMimeType = null;

// ─────────────────────────────────────────────────────
// SECTION 7: Converter Storage
// ─────────────────────────────────────────────────────
window.converterStorage = {
    struct:   [],
    category: [],
    ques:     [],
    current:  "struct"
};

// ─────────────────────────────────────────────────────
// SECTION 8: SweetAlert2 Toast Mixin
// ─────────────────────────────────────────────────────
window.bgToast = Swal.mixin({
    toast: true,
    position: 'bottom-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
});
```

---

## 3. แผนการแยกไฟล์ CSS อย่างละเอียด (CSS Split Plan)

CSS ทั้งหมดอยู่ในแท็ก `<style>` ตั้งแต่บรรทัดที่ **29 ถึง 1837** ใน `index.html` (รวม ~1,808 บรรทัด) แบ่งเป็น 11 section ตามหัวข้อคอมเมนต์ที่มีอยู่แล้ว

---

### 3.0 `css/main.css` — Entry Point (CSS Importer)

ไฟล์นี้ **ไม่มีโค้ด CSS** แต่ทำหน้าที่เป็นตัวรวม (aggregator) เรียก `@import` ตามลำดับที่ถูกต้อง:

```css
/* css/main.css — สั่ง import ทุกไฟล์ตามลำดับ cascade */
@import url('variables.css');   /* ต้องมาก่อนสุด: ประกาศ :root variables */
@import url('layout.css');      /* พึ่งพา variables */
@import url('modals.css');      /* พึ่งพา variables */
@import url('modal-report.css');
@import url('modal-vote.css');  /* พึ่งพา variables */
@import url('components.css');  /* พึ่งพา variables */
@import url('tables.css');      /* พึ่งพา variables */
@import url('converter.css');   /* พึ่งพา variables */
@import url('structure.css');   /* พึ่งพา variables */
@import url('responsive.css');  /* ต้องมาหลังสุด: override styles */
```

> **หมายเหตุ:** `@import` ใช้ได้ดีสำหรับ Development แต่หากต้องการ Production Performance ให้เปลี่ยนเป็น `<link>` แยกใน `index.html` แทน (ดูหัวข้อ 5)

---

### 3.1 `css/variables.css` — Root Variables & Base Styles
**ต้นทาง:** บรรทัด 29–65 (`/* 4.1 Root Variables & Base Styles */`)

```
รูปแบบ CSS ที่รวมอยู่:
- :root { --primary-color, --secondary-color, ... }
- body { font-family, background-color, ... }
- .hidden { display: none !important; }
- .admin-only { display: none; }
- .developer-only { display: none; }
```

---

### 3.2 `css/layout.css` — Sidebar, Page Content & Topbar
**ต้นทาง:** บรรทัด 66–352 (`/* 4.2 */` และ `/* 4.3 */`)

```
รูปแบบ CSS ที่รวมอยู่:
- #sidebar-wrapper, .sidebar-heading, #sidebar-close-btn
- #sidebar-wrapper .list-group, .list-group-item (รวม :hover, .active)
- #page-content-wrapper, @media (min-width: 768px) layout rules
- .topbar, #page-title, #topbar-avatar
- .auth-buttons-container, .modal-header-auth, .modal-auth-content
  (ไฟล์ท้ายสุดของ index.html CSS ตั้งแต่บรรทัด 1783 ถึง 1837)
```

> ⚠️ **ข้อสังเกต:** สไตล์ `.avatar-upload-box`, `.hidden-file-input`, `.auth-buttons-container`, `.modal-header-auth`, `.modal-auth-content` ปรากฏท้ายสุดของ `<style>` (บรรทัด 1783–1837) แต่ควรรวมไว้ในไฟล์นี้เพราะเกี่ยวข้องกับ Auth UI

---

### 3.3 `css/modals.css` — General Modal Styles
**ต้นทาง:** บรรทัด 353–415 (`/* 4.4 Modal Styles (General) */`)

```
รูปแบบ CSS ที่รวมอยู่:
- .modal-card (custom overlay modal)
- .modal-content-card (inner card)
- .modal-header-card, .modal-body-card
- .close-btn
- .modal-dialog.modal-xl (Diff modal width override)
```

---

### 3.4 `css/modal-report.css` — Report Modal Styles
**ต้นทาง:** บรรทัด 416–515 (`/* 4.5 Report Modal Specific Styles */`)

```
รูปแบบ CSS ที่รวมอยู่:
- #report_text, #report-correct-choice-select
- .pulse-animation, @keyframes pulse-red
- Diff Viewer styles: .diff-col-header, .header-old, .header-new
- .diff-content-box, .diff-changed, .diff-choice-item, .diff-correct
- .diff-label, .form-control:focus:invalid
- DEV Role styles: .developer-only (ซ้ำจาก 4.1 — ลบออกให้คงไว้ที่ variables.css)
```

---

### 3.5 `css/modal-vote.css` — Vote / Category Modal Styles
**ต้นทาง:** บรรทัด 516–831 (`/* 4.6 Vote Modal Specific Styles */`)

```
รูปแบบ CSS ที่รวมอยู่:
- #vote-category-modal .modal-body, .modal-title
- #vote-question-preview
- .category-badge-container, .category-badge
- .category-badge.approved, .category-badge.suggested
- .vote-count-badge
- .vote-row, .vote-select, .btn-remove-row
- #btn-add-vote-row
- .controls-container, .quiz-button, .btn-light, .btn-dark
- .empty-state-text
- @media responsive rules สำหรับ vote modal ทั้งหมด
```

---

### 3.6 `css/components.css` — Cards, Choices, Gallery & SVG
**ต้นทาง:** บรรทัด 832–1222 (`/* 4.7 Component Styles */`)

```
รูปแบบ CSS ที่รวมอยู่:
Dashboard Cards:
- .card-dashboard, .card-header-custom, .dash-card, .stat-icon
- .bg-gradient-primary/danger/success/warning
- #dashboardRecentTable responsive card view

Choices:
- .choice-item (:hover, .active-focus, .suggested-choice, .original-choice)
- .choice-input-group, .btn-remove-choice
- .choice-has-image (hide text, show preview)
- .choice-preview-container .img-thumbnail

SVG Areas:
- .svg-render-area, .svg-choice-container, .svg-choice-preview-area
- #edit-gallery-svg-render svg
- .svg-preview-box

Gallery:
- .image-gallery-container, .gallery-img, .gallery-controls
- .upload-dropzone (:hover, .dragover)
- .gallery-controls-top
- .image-library-grid, .library-item, .library-item.svg-item
- .library-group-header
```

---

### 3.7 `css/tables.css` — DataTables & Editable Cells
**ต้นทาง:** บรรทัด 1223–1285 (`/* 4.8 Data Tables & Responsive Table Styles */`)

```
รูปแบบ CSS ที่รวมอยู่:
- table.dataTable thead th, tbody td
- .img-preview-mini (:hover)
- .editable-cell (:focus)
- .selected-cell
- .table-responsive (base styles)
- .table-responsive table (min-width: 600px)
- .btn-group .btn-outline-primary (active/hover states)
- .view-as-card (base block display override)
```

---

### 3.8 `css/converter.css` — Converter Tool & Tabs
**ต้นทาง:** บรรทัด 1286–1336 (`/* 4.9 Converter/Tab Styles */`)

```
รูปแบบ CSS ที่รวมอยู่:
- .converter-area (padding, border-radius, box-shadow)
- .converter-control-panel (grid layout, responsive)
- .tabs (flex, overflow-x, border-bottom)
- .tab (:active, .active state)
```

---

### 3.9 `css/structure.css` — Tree View & CRUD Nodes
**ต้นทาง:** บรรทัด 1337–1596 (`/* 4.10 Structure Tree View Styles */`)

```
รูปแบบ CSS ที่รวมอยู่:
- .tree-container, .tree-view, .tree-view ul, .tree-view li
- @keyframes slideDown
- Tree lines (::before, ::after pseudo-elements)
- .tree-node (:hover), .toggle-icon (rotate animation)
- .node-actions (opacity/translate on hover)
- .btn-node, .btn-add, .btn-edit, .btn-delete
- .node-subject, .node-group, .node-category
- .badge-count
- .tree-node.collapsed (collapse state)
- .view-as-card tbody (flex layout), .content-section animation
```

---

### 3.10 `css/responsive.css` — Mobile Card View & Breakpoint Overrides
**ต้นทาง:** บรรทัด 1597–1781 (`/* 4.11 Responsive Tweaks */`)

```
รูปแบบ CSS ที่รวมอยู่:
- #loading-overlay (fixed overlay styles)
- @media (max-width: 767.98px) .table-responsive table
- .view-as-card (full card layout: thead, tbody, tr, td, td::before)
- .view-as-card td:nth-child(3) (question highlight)
- .view-as-card .img-preview-mini (enlarged)
- .view-as-card td:last-child (action row)
- td[data-label="Answer"] svg / td[data-label="Question"] svg
- @media (max-width: 575.98px) general tweaks
- @media (max-width: 430px) narrow device tweaks
```

---

## 4. แผนการแยกไฟล์ JavaScript อย่างละเอียด (JS Split Plan)

### 4.1 `js/config.js`
**ความรับผิดชอบ:** ค่าคงที่, Global State Bridge, Toast Mixin  
*(ดูโค้ดตัวอย่างครบถ้วนในหัวข้อ 2)*

---

### 4.2 `js/db.js`
**ความรับผิดชอบ:** ระบบแคช IndexedDB สำหรับแอดมิน

| ฟังก์ชัน | คำอธิบาย |
|---|---|
| `openDB()` | เปิด/สร้าง IndexedDB database |
| `setCacheDB(key, data)` | บันทึกข้อมูลลง cache store |
| `getCacheDB(key)` | ดึงข้อมูลจาก cache store |
| `clearAdminCache()` | ล้าง cache ทั้งหมด |

---

### 4.3 `js/api.js`
**ความรับผิดชอบ:** Network requests, Admin actions, Hashing

| ฟังก์ชัน | คำอธิบาย |
|---|---|
| `sendWithRetry(payload, retries)` | ส่ง fetch พร้อม retry logic |
| `sendAdminAction(actionName, dataObj, skipReload)` | ส่ง Admin action ไปยัง Apps Script |
| `hashPassword(password)` | เข้ารหัส password ด้วย SubtleCrypto |

---

### 4.4 `js/ui.js`
**ความรับผิดชอบ:** การสลับหน้า Section, Auth UI, Profile/Register/Reset modals

| ฟังก์ชัน | คำอธิบาย |
|---|---|
| `showSection(sectionId)` | สลับ active section + อัปเดต sidebar |
| `formatDate(dateString)` | แปลงวันที่เป็นรูปแบบไทย |
| `updateAuthUI(isLoggedIn)` | แสดง/ซ่อน UI ตามสถานะล็อกอิน |
| `toggleLogin()` | toggle แสดงฟอร์ม login |
| `confirmAdmin()` | ตรวจสอบรหัสผ่านแอดมิน |
| `logoutAdmin()` | ล้าง session และ reload |
| `performLogin()` | ส่งข้อมูล login ไป API |
| `openEditProfile()` | เปิด Modal แก้ไขโปรไฟล์ |
| `updateUserProfile()` | บันทึกการเปลี่ยนแปลงโปรไฟล์ |
| `openResetFromProfile()` | เปิดฟอร์ม reset password จากโปรไฟล์ |
| `submitResetPassword()` | ส่งคำขอ reset password |
| `submitRegister()` | ส่งข้อมูลสมัครสมาชิก |
| `validateRegistrationForm()` | validate form ก่อน submit |
| `previewEditAvatar(input)` | พรีวิว avatar ใน edit modal |
| `previewAvatar(input)` | พรีวิว avatar ใน register modal |
| `openLoginModal()` | เปิด Bootstrap modal login |
| `openRegisterModal()` | เปิด Bootstrap modal register |
| `openResetModal()` | เปิด Bootstrap modal reset |
| `loadAdminManager()` | โหลดข้อมูลตาราง Admin Manager |
| `checkAuthBeforeAction(callbackAction)` | guard: ตรวจสอบ auth ก่อนทำงาน |

---

### 4.5 `js/tables.js`
**ความรับผิดชอบ:** DataTables renderer, Diff Viewer, Escape utils

| ฟังก์ชัน | คำอธิบาย |
|---|---|
| `setTableView(tableId, mode, btn)` | สลับโหมด Table / Card view |
| `initPublicTable()` | สร้าง DataTable สำหรับ Public Search |
| `initAdminTable()` | สร้าง DataTable สำหรับ Admin Database |
| `initLogsTable()` | สร้าง DataTable สำหรับ Activity Logs |
| `viewDiff(oldValEnc, newValEnc)` | เปิด modal เปรียบเทียบ Diff |
| `normalizeData(obj)` | normalize ข้อมูลก่อนเปรียบเทียบ |
| `renderDiffPanel(data, compare)` | render HTML ผลลัพธ์ Diff |
| `escapeHtml(text)` | escape HTML entities |

---

### 4.6 `js/question.js`
**ความรับผิดชอบ:** โจทย์, Choices, รูปภาพหลัก, Image Library

| กลุ่ม | ฟังก์ชัน |
|---|---|
| **Question Core** | `showQuestionDetail(id)`, `openEditModal(id, suggestedAnswer)`, `saveQuestionChanges()`, `deleteQuestion()` |
| **Category UI** | `renderCategoriesUI(categoryArray)`, `_renderNewCategoryRow(selectedCategoryID)`, `removeCategoryRow(btn)`, `updateGroupSelect(selectElement)`, `updateCategorySelect(selectElement)`, `addNewCategoryRow()`, `syncCategoriesToHiddenInput()` |
| **Choices UI** | `renderChoicesUI(choicesStr, correctAnsStr, suggestedAnsStr)`, `addChoiceRow(value, isOriginalCorrect, isSuggested)`, `openImageLibraryForChoice(rowId)`, `removeChoiceRow(rowId)`, `removeChoiceMedia(rowId)`, `addNewChoiceRow()`, `syncChoicesToHiddenInput()`, `renderChoicePreview($inputEl)` |
| **Main Images** | `renderImagesUI(imgStr)`, `handleMainImagesSelection(input)`, `syncMainImageGallery()`, `updateEditImageGallery()`, `removeCurrentImageFromGallery()`, `previewEditImage()`, `handleImageInput()` |
| **Image Rows** | `addImageRow(value)`, `addNewImageRow()`, `removeImageRow(btn)`, `syncImagesToHiddenInput()`, `removeImageRowWithTrash(btn)`, `promptRestoreImage()`, `handleImageTrash(url)` |
| **Image Library** | `openImageLibrary()`, `selectImageFromLibrary(content)`, `selectImageFromLibraryEncoded(encodedContent)` |
| **File & Utils** | `getBase64(file)`, `handleFileUpload(input, type)`, `removeChoiceRowWithTrash(btn)`, `transformUrl(url)`, `isMediaMatch(str1, str2)`, `compressImage(base64Str, maxWidth, maxHeight)` |
| **AI** | `askAIExpert()` |

---

### 4.7 `js/vote.js`
**ความรับผิดชอบ:** ระบบเสนอและโหวต Category

| ฟังก์ชัน | คำอธิบาย |
|---|---|
| `getCategoryNameById(categoryId)` | แปลง ID เป็นชื่อ Category |
| `renderCurrentCategory(question)` | render Badge Category ปัจจุบัน |
| `addVoteRow()` | เพิ่มแถว dropdown เสนอ Category ใหม่ |
| `submitSingleVote(categoryId, shouldRefreshUI, delta)` | โหวต/ถอนโหวต Category เดียว |
| `submitVoteData(categoryArray, shouldRefreshUI, delta)` | บันทึก vote array ทั้งชุด |
| `fetchPendingVotes(questionId)` | โหลด votes ที่รอยืนยันของโจทย์นั้น |

---

### 4.8 `js/report.js`
**ความรับผิดชอบ:** Report Inbox ฝั่งแอดมิน

| ฟังก์ชัน | คำอธิบาย |
|---|---|
| `renderReportList()` | render รายการ Report ทั้งหมดใน inbox |
| `openReportModal(q)` | เปิด modal แสดงรายละเอียด report |
| `processReport(reportTime, action)` | อนุมัติ/ปฏิเสธ report |
| `openEditReportModal(reportTime)` | เปิด modal แก้ไขโจทย์จาก report |

---

### 4.9 `js/structure.js`
**ความรับผิดชอบ:** Folder Tree วิชา/กลุ่ม/หัวข้อ

| ฟังก์ชัน | คำอธิบาย |
|---|---|
| `renderStructureTree(filterSubjectID)` | render HTML tree ทั้งหมด |
| `toggleTreeNode(el)` | เปิด/ปิด node ย่อย |
| `confirmStrictDelete(itemName, confirmKey)` | dialog ยืนยันลบแบบพิมพ์ชื่อ |
| `crudAction(type, id1, id2)` | เรียก API สำหรับ Create/Rename/Delete |
| `confirmDelete(text)` | dialog ยืนยันลบทั่วไป |
| `editCategoryInline(catID)` | แก้ไขชื่อ Category ใน tree โดยตรง |
| `saveNewCategory()` | บันทึก Category ใหม่จาก modal |
| `generateCategoryIDPreview()` | สร้าง preview ID อัตโนมัติ |
| `openAddCategoryModal(subjectId, groupName)` | เปิด modal เพิ่ม Category ใหม่ |

---

### 4.10 `js/converter.js`
**ความรับผิดชอบ:** Converter V4, Multi-edit table, Import

| ฟังก์ชัน | คำอธิบาย |
|---|---|
| `resetConverter()` | ล้างค่า Converter ทั้งหมด |
| `setupConverterMultiEdit()` | ผูก event listeners สำหรับ multi-edit |
| `selectRange(start, end)` | เลือกช่วง cell ใน preview table |
| `applySelectionValue(newValue)` | ใส่ค่าให้ cell ที่เลือก |
| `switchTab(sheet)` | สลับ tab (struct/category/ques) |
| `evaluateRowStatusInBatch(row, i, sheetKey, seenKeys)` | ตรวจสอบสถานะแต่ละแถว |
| `getFilteredImportData(sheetKey)` | กรองข้อมูลตาม status |
| `processAll()` | ประมวลผล input ทั้งหมด |
| `renderPreview()` | render ตาราง preview |
| `filterConverterTable(status, btn)` | filter แถวตาม status |
| `copyCurrentSheet()` | copy ข้อมูล sheet ปัจจุบัน |
| `importConvertedData()` | นำข้อมูลที่แปลงแล้วเข้า database |

---

### 4.11 `js/app.js`
**ความรับผิดชอบ:** Data sync หลัก, Version polling, Event Listeners, Bootstrap

| ฟังก์ชัน | คำอธิบาย |
|---|---|
| `fetchData(forceRefresh, isAutoPoll)` | ดึงข้อมูลหลักทั้งหมดจาก Apps Script |
| `handleDeferredUpdate()` | จัดการ update ที่ถูก defer ไว้ |
| `finalizeDataLoading()` | เรียก render functions หลังข้อมูลโหลดครบ |
| `startVersionPolling()` | เริ่ม interval ตรวจสอบ version ใหม่ |
| `refreshTables(keepState)` | refresh DataTables ทุกตัว |
| `updateDashboard()` | อัปเดตตัวเลขสถิติบน Dashboard |
| `populateFilters()` | เติมข้อมูล filter dropdowns |
| `updateCategoryDropdown(subjectId, targetSelector)` | อัปเดต dropdown Category ตาม Subject |
| `getSubjectFromCategory(categoryId)` | หา Subject จาก Category ID |

**กระบวนการเริ่มต้น (Bootstrap Block) — ท้าย `app.js`:**
```javascript
$(document).ready(function () {
    // 1. ฟื้นฟู session จาก localStorage
    // 2. ผูก Event Listeners: paste, drag & drop รูปภาพ, click events
    // 3. เรียก fetchData() และ startVersionPolling()
});
```

---

## 5. โครงร่างไฟล์ `index.html` หลังการ Refactor

```html
<!DOCTYPE html>
<html lang="th">
<head>
    <!-- 1. Meta & Title -->
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MDKKU Manager Center</title>

    <!-- 2. Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet">

    <!-- 3. CSS Libraries (CDN) -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="https://cdn.datatables.net/1.13.4/css/dataTables.bootstrap5.min.css">

    <!-- 4. Custom Styles (Modular)
         ตัวเลือก A: โหลดผ่าน main.css entry point (Development) -->
    <link rel="stylesheet" href="css/main.css">

    <!-- ตัวเลือก B: โหลดแต่ละไฟล์โดยตรง (Production — ไม่มี @import overhead)
    <link rel="stylesheet" href="css/variables.css">
    <link rel="stylesheet" href="css/layout.css">
    <link rel="stylesheet" href="css/modals.css">
    <link rel="stylesheet" href="css/modal-report.css">
    <link rel="stylesheet" href="css/modal-vote.css">
    <link rel="stylesheet" href="css/components.css">
    <link rel="stylesheet" href="css/tables.css">
    <link rel="stylesheet" href="css/converter.css">
    <link rel="stylesheet" href="css/structure.css">
    <link rel="stylesheet" href="css/responsive.css">
    -->
</head>

<body>
    <!--
        [คงเนื้อหา HTML Body ดั้งเดิมทั้งหมดไว้ครบถ้วน]
        Sidebar, Topbar, Section Contents, Modals ทุกตัว
    -->

    <!-- 5. JavaScript Libraries (CDN) -->
    <script src="https://code.jquery.com/jquery-3.7.0.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script src="https://cdn.datatables.net/1.13.4/js/jquery.dataTables.min.js"></script>
    <script src="https://cdn.datatables.net/1.13.4/js/dataTables.bootstrap5.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <!-- 6. Modular JavaScript (เรียงตามลำดับ dependency) -->
    <script src="js/config.js"></script>    <!-- ต้องมาก่อน: ประกาศ window.* ทั้งหมด -->
    <script src="js/db.js"></script>        <!-- พึ่งพา: config.js -->
    <script src="js/api.js"></script>       <!-- พึ่งพา: config.js, db.js -->
    <script src="js/ui.js"></script>        <!-- พึ่งพา: config.js, api.js -->
    <script src="js/tables.js"></script>    <!-- พึ่งพา: config.js -->
    <script src="js/question.js"></script>  <!-- พึ่งพา: config.js, api.js, ui.js -->
    <script src="js/vote.js"></script>      <!-- พึ่งพา: config.js, api.js -->
    <script src="js/report.js"></script>    <!-- พึ่งพา: config.js, api.js, question.js -->
    <script src="js/structure.js"></script> <!-- พึ่งพา: config.js, api.js -->
    <script src="js/converter.js"></script> <!-- พึ่งพา: config.js, api.js -->
    <script src="js/app.js"></script>       <!-- ต้องมาหลังสุด: Bootstrap + Event Listeners -->
</body>
</html>
```

---

## 6. ลำดับขั้นตอนการดำเนินการ (Execution Order)

```
ขั้นตอนที่ 0  │ สำรองข้อมูล: คัดลอก index.html → index.backup.html
              │
ขั้นตอนที่ 1  │ สร้างโฟลเดอร์: mkdir css/ js/
              │
ขั้นตอนที่ 2  │ แยก CSS (ทำงานกับ <style> บรรทัด 29–1837):
              │   2a. ตัด 4.1 → css/variables.css
              │   2b. ตัด 4.2 + 4.3 + Auth styles → css/layout.css
              │   2c. ตัด 4.4 → css/modals.css
              │   2d. ตัด 4.5 → css/modal-report.css
              │   2e. ตัด 4.6 → css/modal-vote.css
              │   2f. ตัด 4.7 → css/components.css
              │   2g. ตัด 4.8 → css/tables.css
              │   2h. ตัด 4.9 → css/converter.css
              │   2i. ตัด 4.10 → css/structure.css
              │   2j. ตัด 4.11 → css/responsive.css
              │   2k. สร้าง css/main.css (entry point @import)
              │
ขั้นตอนที่ 3  │ แยก JavaScript (ทำงานกับ <script> บรรทัด ~1840–8211):
              │   3a. คัด Global vars → js/config.js
              │   3b. คัด DB functions → js/db.js
              │   3c. คัด API functions → js/api.js
              │   3d. คัด UI functions → js/ui.js
              │   3e. คัด Tables functions → js/tables.js
              │   3f. คัด Question functions → js/question.js
              │   3g. คัด Vote functions → js/vote.js
              │   3h. คัด Report functions → js/report.js
              │   3i. คัด Structure functions → js/structure.js
              │   3j. คัด Converter functions → js/converter.js
              │   3k. คัด fetchData + ready() → js/app.js
              │
ขั้นตอนที่ 4  │ แก้ไข index.html:
              │   - ลบ <style>...</style> ทั้งหมด
              │   - ลบ <script>...</script> ทั้งหมด
              │   - เพิ่ม <link> CSS และ <script> JS ตามหัวข้อ 5
              │
ขั้นตอนที่ 5  │ ตรวจสอบและทดสอบ (ดูหัวข้อ 7)
```

---

## 7. แผนการตรวจสอบ (Verification Plan)

### 7.1 ตรวจสอบ CSS
- เปิด DevTools → Network tab → กรอง CSS ให้เห็น 10 ไฟล์โหลดสำเร็จ (หรือ 1 ไฟล์ถ้าใช้ `main.css`)
- ตรวจสอบ Console ว่าไม่มี `Failed to load resource` สีแดง
- ตรวจสอบหน้าตาแอปว่า Sidebar, Topbar, Modal, Table ยังแสดงผลถูกต้อง

### 7.2 ตรวจสอบ JavaScript
| ข้อผิดพลาดที่ต้องระวัง | สาเหตุ | วิธีแก้ |
|---|---|---|
| `ReferenceError: X is not defined` | สคริปต์โหลดผิดลำดับ | ตรวจสอบลำดับ `<script>` ในหัวข้อ 5 |
| `TypeError: Cannot read properties of undefined` | ฟังก์ชันถูกเรียกก่อน DOM พร้อม | ตรวจสอบว่าอยู่ใน `$(document).ready()` |
| `window.bgToast is not a function` | `config.js` โหลดก่อน SweetAlert2 CDN | ตรวจสอบว่า CDN อยู่เหนือ `<script src="js/config.js">` |

### 7.3 Functional Checklist

- [ ] **Dashboard** — ตัวเลขสถิติแสดงผลถูกต้อง
- [ ] **Login/Register/Reset** — ฟอร์มเปิดได้, ส่งข้อมูลสำเร็จ
- [ ] **Public Search** — DataTable โหลดและ filter ได้
- [ ] **Admin Database** — DataTable โหลด, edit/delete ทำงาน
- [ ] **Question Edit Modal** — เปิดได้, รูปภาพแสดง, save สำเร็จ
- [ ] **Image Library** — เปิด modal, เลือกภาพได้
- [ ] **Vote Modal** — badge แสดงถูกต้อง, โหวตได้
- [ ] **Report Inbox** — รายการแสดง, approve/reject ทำงาน
- [ ] **Structure Tree** — tree render ถูกต้อง, add/edit/delete ทำงาน
- [ ] **Converter V4** — paste ข้อมูลได้, preview แสดง, import สำเร็จ
- [ ] **Diff Viewer** — เปิด modal, highlight แสดงถูกต้อง
- [ ] **Mobile Responsive** — Card View ทำงานบน viewport < 768px

---

## 8. หมายเหตุและแนวทางปฏิบัติเพิ่มเติม

### 8.1 สไตล์ที่มีตำแหน่งผิดปกติใน index.html (ต้องย้ายให้ถูกไฟล์)

| CSS ที่พบ | ตำแหน่งปัจจุบัน (บรรทัดใน index.html) | ควรอยู่ในไฟล์ |
|---|---|---|
| `.developer-only` | ~255 (อยู่ท่ามกลาง 4.3) | `variables.css` |
| `.diff-*` styles | ~260–335 (อยู่ใน 4.3) | `modal-report.css` |
| `.avatar-upload-box` | ~1783 (หลัง 4.11) | `layout.css` |
| `.auth-buttons-container` | ~1817 (หลัง 4.11) | `layout.css` |
| `.modal-header-auth` | ~1823 (หลัง 4.11) | `layout.css` |

### 8.2 CSS Custom Property ที่ใช้ข้ามไฟล์
ตัวแปรเหล่านี้ประกาศใน `variables.css` และถูกอ้างอิงในทุกไฟล์ CSS อื่น:
```
--primary-color, --secondary-color, --success-color, --info-color,
--warning-color, --danger-color, --light-bg, --sidebar-width,
--sidebar-hidden-margin, --color-dark, --sidebar-bg,
--transition-speed, --item-radius
```
**ข้อกำหนด:** `variables.css` ต้องโหลดก่อนไฟล์ CSS อื่นทุกไฟล์เสมอ

### 8.3 Production Optimization (ทำหลังยืนยัน Refactor ทำงานถูกต้อง)
- รวม CSS ทั้งหมดเป็นไฟล์เดียวด้วย build tool เช่น Vite, Parcel หรือ `cat css/*.css > dist/bundle.css`
- เปิดใช้ browser caching บน server สำหรับไฟล์ `.css` และ `.js` (Cache-Control header)
- พิจารณาใช้ `defer` attribute บน `<script>` tags: `<script src="js/config.js" defer></script>`  
  ⚠️ หากใช้ `defer` ต้องตรวจสอบว่าไม่มี inline event handlers ใน HTML ที่เรียกฟังก์ชัน JS ก่อนที่ defer scripts จะโหลดเสร็จ