const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Mirrors the existing uploads/attendance-screenshots/ convention.
// server.js serves express.static(path.join(__dirname, 'uploads')) from the
// backend ROOT. This middleware file lives at src/middleware/chatUpload.js,
// so we must go up two levels (src/middleware -> src -> root) to land in
// the same uploads/ folder, not one (which would land inside src/uploads).
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'chat-attachments');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

// Block only genuinely dangerous executable-type extensions. Everything
// else (images, videos, PDFs, Office docs, zips, etc.) is allowed.
const BLOCKED_EXTENSIONS = /\.(exe|bat|cmd|msi|dll|com|scr|jar|vbs|ps1|sh)$/i;

const fileFilter = (req, file, cb) => {
  if (BLOCKED_EXTENSIONS.test(file.originalname || '')) {
    return cb(new Error(`${file.originalname}: this file type is not allowed`));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB per file
    files: 10,
  },
});

// Wraps multer so its errors come back as clean 400 JSON responses
// instead of falling through to the generic 500 error handler.
function chatUpload(req, res, next) {
  upload.array('files', 10)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: 'File exceeds the 100MB limit',
        LIMIT_FILE_COUNT: 'You can attach up to 10 files at once',
      };
      return res.status(400).json({ success: false, message: messages[err.code] || err.message });
    }
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
    }
    next();
  });
}

module.exports = chatUpload;