const fs = require('fs');
const path = require('path');

// Folder where screenshots get saved on disk, in addition to the base64
// copy kept in Mongo. Adjust the path if your project structure differs —
// this assumes this file lives in /services and uploads should sit at
// the project root: /uploads/attendance-screenshots
const SCREENSHOT_DIR = path.join(__dirname, '..', 'uploads', 'attendance-screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/**
 * Writes a sanitized base64 data URL to disk and returns a relative,
 * web-servable path to store in the DB (e.g. /uploads/attendance-screenshots/xxx.jpg).
 * Returns null if the input isn't a valid base64 image data URL.
 */
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

  // This is the path you'd serve statically, e.g. with:
  //   app.use('/uploads', express.static(path.join(__dirname, 'uploads')))
  return `/uploads/attendance-screenshots/${filename}`;
}

module.exports = { saveScreenshotToDisk };