require('dotenv').config();

const mysql = require('mysql2');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'alumni_qr'
});

const BASE_URL = process.env.BASE_URL;

// pastikan folder ada (recursive biar aman)
const qrFolder = path.join(__dirname, '../public/qrcodes');

if (!fs.existsSync(qrFolder)) {
  fs.mkdirSync(qrFolder, { recursive: true });
}

db.connect(() => {
  console.log('✅ DB connected');

  db.query('SELECT nomor_induk, token FROM alumni', async (err, results) => {
    if (err) {
      console.log('❌ Query error:', err);
      return;
    }

    for (let user of results) {
      const url = `${BASE_URL}/verify?id=${user.nomor_induk}&token=${user.token}`;

      const fileName = `${user.nomor_induk}.png`;
      const filePath = path.join(qrFolder, fileName);

      try {
        // generate QR
        await QRCode.toFile(filePath, url);

        // simpan path relatif ke DB
        const dbPath = `qrcodes/${fileName}`;

        db.query(
          'UPDATE alumni SET qr_path=? WHERE nomor_induk=?',
          [dbPath, user.nomor_induk],
          (err2) => {
            if (err2) {
              console.log(`❌ Gagal update DB: ${user.nomor_induk}`);
            }
          }
        );

        console.log(`✅ QR dibuat: ${user.nomor_induk}`);
      } catch (err) {
        console.log(`❌ Gagal QR: ${user.nomor_induk}`, err);
      }
    }

    console.log('🎉 Semua QR selesai dibuat!');
  });
});