const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'uploads', 'attendance-screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function saveScreenshotToDisk(base64DataUrl, userId, type /* 'in' | 'out' */) {
  if (!base64DataUrl || typeof base64DataUrl !== 'string') return null;

  const matches = base64DataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) return null;

  const ext = matches[1];
  const data = matches[2];
  const buffer = Buffer.from(data, 'base64');

  const filename = `${userId}_${type}_${Date.now()}.${ext}`;
  const filePath = path.join(SCREENSHOT_DIR, filename);

  fs.writeFileSync(filePath, buffer);

  return `/uploads/attendance-screenshots/${filename}`;
}

module.exports = { saveScreenshotToDisk };