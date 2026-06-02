// ─────────────────────────────────────────────────────
// JS/CONFIG.JS
// ─────────────────────────────────────────────────────

window.APPSCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyGIWxK-Zv6s2eaV4eOHyuGYKP7WapHO3G_as0nfSkIewi5ROHhDuTqTFcrmJKXvDI6/exec';

window.globalData = {
        questions: [],
        structure: [],
        category: [],
        report: [],
        votes: [],
        logs: []
    };

window.currentUser = { displayName: 'Guest', avatar: '', username: '', role: '' };

window.isAdmin = false;

window.adminPass = '';

window.current_question = {};

window.editImageArray = [];

window.editImageIndex = 0;

window.activeUploadsCount = 0;

window.existingMainImages = [];

window.pendingMainImages = [];

window.choiceImagesData = {};

window.choiceRowCounter = 0;

window.currentLibraryTarget = { type: 'main', rowId: null };

window.isMouseDown = false;

window.startCell = null;

window.isLoggedIn = false;

window.sectionId = null;

window.sectionName = null;

window.regAvatarBase64 = null;

window.regAvatarMimeType = null;

window.isFetching = false;

window.bgToast = Swal.mixin({
        toast: true,
        position: 'bottom-end',
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true
    });

window.dbName = "MDKKU_Admin_DB";

window.storeName = "admin_cache";

window.versionCheckInterval = null;

window.converterStorage = {
        struct: [],
        category: [],
        ques: [],
        current: "struct"
    };

window.converterHeaders = {
        struct: ["#", "Year", "SubjectID", "SubjectName", "AccordionGroup"],
        category: ["#", "CategoryID", "SubjectRef", "AccordionGroup", "CategoryName"],
        ques: ["#", "QuestionID", "Problem", "Image", "Choices", "Answer", "Explanation", "Category"]
    };

window.transformUrl = (url) => {
        // ... (โค้ด transformUrl เดิม) ...
        if (!url) return "";
        if (url.startsWith('blob:') || url.startsWith('data:')) return url;
        const match = url.match(/\/d\/(.*?)\//) || url.match(/id=([^&]+)/);
        return (match && match[1]) ? `https://lh3.googleusercontent.com/d/${match[1]}?authuser=1=w1000-h1000` : url;
        // ... (จบโค้ด transformUrl เดิม) ...
    };

window.compressImage = async function(base64Str, maxWidth = 400, maxHeight = 400) {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = base64Str;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7)); // บีบอัดคุณภาพเหลือ 70%
            };
        });
    }

window.formatDate = function(dateString) {
        // ... (โค้ด formatDate เดิม) ...
        if (!dateString) return '';
        const d = new Date(dateString);
        return d instanceof Date && !isNaN(d) ? d.toLocaleString('th-TH') : dateString;
        // ... (จบโค้ด formatDate เดิม) ...
    }
