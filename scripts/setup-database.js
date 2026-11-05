require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

async function setupDatabase() {
  const required = ['DB_HOST', 'DB_NAME', 'DB_USER'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing database configuration: ${missing.join(', ')}`);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    multipleStatements: true
  });

  try {
    const schema = await fs.readFile(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await connection.query(schema);
    const [fulfillmentColumn] = await connection.query("SHOW COLUMNS FROM orders LIKE 'fulfillment_status'");
    if (!fulfillmentColumn.length) {
      await connection.query(
        `ALTER TABLE orders
         ADD COLUMN fulfillment_status ENUM('unfulfilled', 'processing', 'dispatched', 'delivered')
         NOT NULL DEFAULT 'unfulfilled' AFTER payment_status`
      );
    }
    console.log(`Database schema is ready in "${process.env.DB_NAME}".`);
  } finally {
    await connection.end();
  }
}

setupDatabase().catch((error) => {
  console.error(`Database setup failed: ${error.message}`);
  process.exitCode = 1;
});
