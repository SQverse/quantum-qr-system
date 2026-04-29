require('dotenv').config();
const mysql = require('mysql2');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// Gunakan .promise() agar bisa menggunakan await
const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'alumni_qr'
}).promise(); // Tambahkan .promise() di sini

const BASE_URL = process.env.BASE_URL;
const qrFolder = path.join(__dirname, '../public/qrcodes');

if (!fs.existsSync(qrFolder)) {
  fs.mkdirSync(qrFolder, { recursive: true });
}

async function run() {
  try {
    console.log('✅ DB connected');

    // Ambil data alumni
    const [results] = await db.query('SELECT nomor_induk, token FROM alumni');

    for (let user of results) {
      // 1. Buat URL Verifikasi
      const url = `${BASE_URL}/verify?id=${encodeURIComponent(user.nomor_induk)}&token=${user.token}`;

      // 2. Buat Nama File Aman (Ganti "/" jadi "-")
      const safeFileName = user.nomor_induk.replace(/\//g, '-') + '.png'; 
      const filePath = path.join(qrFolder, safeFileName);

      try {
        // 3. Generate QR Code ke File
        await QRCode.toFile(filePath, url);

        // 4. Update Path ke Database
        const dbPath = `qrcodes/${safeFileName}`;
        await db.query(
          'UPDATE alumni SET qr_path=? WHERE nomor_induk=?',
          [dbPath, user.nomor_induk]
        );

        console.log(`✅ QR Berhasil: ${user.nomor_induk}`);
      } catch (err) {
        console.log(`❌ Gagal di ${user.nomor_induk}:`, err.message);
      }
    }

    console.log('🎉 Semua QR selesai dibuat!');
    process.exit(0); // Selesai
  } catch (err) {
    console.log('❌ Error sistem:', err.message);
    process.exit(1);
  }
}

run();