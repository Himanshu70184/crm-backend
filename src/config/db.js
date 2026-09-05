const mongoose = require('mongoose');

const MAX_RETRIES = 5;

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('DB Connection Error: Set MONGODB_URI or MONGO_URI in .env');
    process.exit(1);
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const conn = await mongoose.connect(uri, {
        // Fail fast when the host is unreachable (e.g. Atlas IP whitelist)
        // instead of hanging so long that buffered queries time out.
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });
      console.log(`MongoDB Connected: ${conn.connection.host}`);
      console.log(`Database: ${conn.connection.name}`);
      return conn;
    } catch (error) {
      console.error(
        `DB Connection Error (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`
      );
      if (attempt === MAX_RETRIES) {
        console.error('Max DB connection retries reached. Exiting.');
        process.exit(1);
      }
      // Brief backoff before retrying (handles transient network blips on deploys).
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
};

module.exports = connectDB;
