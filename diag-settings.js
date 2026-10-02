require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.DB_URI || process.env.DATABASE_URL || process.env.DB_URL;
  console.log('URI used:', uri ? uri.replace(/:\/\/[^@]*@/, '//***@') : 'NONE FOUND');
  if (!uri) { console.log('ENV KEYS:', Object.keys(process.env).filter(k => /mongo|db|database/i.test(k)).join(',')); process.exit(1); }
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const cols = await db.listCollections().toArray();
  console.log('COLS:', cols.map(c => c.name).join(', '));
  const users = await db.collection('users').find({}, { projection: { name: 1, email: 1, role: 1, shiftCode: 1, shift: 1 } }).toArray();
  console.log('USERS:', JSON.stringify(users));
  for (const c of cols) {
    if (/setting/i.test(c.name)) {
      const docs = await db.collection(c.name).find({}).limit(5).toArray();
      for (const d of docs) {
        console.log('--- SETTINGS DOC in', c.name, '_id:', String(d._id));
        console.log('defaultShiftCode:', d.defaultShiftCode, '| attendance keys:', Object.keys(d).filter(k => /attend|shift|late/i.test(k)).join(','));
        console.log('attendancePolicy:', JSON.stringify(d.attendancePolicy || d.attendance || null).slice(0, 2500));
      }
    }
  }
  await mongoose.disconnect();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
