require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET
});

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function clean(value) {
  if (!value || value.trim() === '-' || value.trim() === '') return null;
  return value.trim();
}

function convertDriveLink(url) {
  if (!url) return null;

  let match = url.match(/id=([^&]+)/);
  if (!match) match = url.match(/\/d\/(.*?)\//);
  if (!match) return null;

  return `https://drive.google.com/uc?export=download&id=${match[1]}`;
}

async function uploadFromDriveToCloudinary(driveUrl, filename) {
  try {
    if (!driveUrl) return null;

    const tempDir = path.join(__dirname, 'temp');

    // bikin folder temp kalau belum ada
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    const tempPath = path.join(tempDir, `${filename}.jpg`);

    const response = await axios({
      url: driveUrl,
      method: 'GET',
      responseType: 'stream'
    });

    // ✅ VALIDASI: pastikan itu gambar
    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('image')) {
      console.log('❌ Bukan gambar, skip');
      return null;
    }

    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);

    await new Promise((res, rej) => {
      writer.on('finish', res);
      writer.on('error', rej);
    });

    // upload ke cloudinary
    const result = await cloudinary.uploader.upload(tempPath, {
      folder: 'alumni'
    });

    // hapus file temp (biar ga numpuk)
    try {
      fs.unlinkSync(tempPath);
    } catch (e) {}

    return result.secure_url;

  } catch (err) {
    console.log('❌ Upload gagal:', err.message);
    return null;
  }
}

(async () => {
  try {
    const db = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME
    });

    console.log('✅ MySQL connected');
    console.log('⏳ Memulai import...\n');

    const stream = fs.createReadStream('data/data_alumni.csv')
      .pipe(csv({ mapHeaders: ({ header }) => header.trim() }));

    for await (const row of stream) {
      try {
        const nama = clean(row['Nama Lengkap (Sesuai KTP)']);
        if (!nama) continue;

        console.log(`🚀 Processing: ${nama}`);

        const driveFoto = convertDriveLink(clean(row['Upload Foto Diri (untuk kartu anggota)']));
        const driveFotoKonter = convertDriveLink(clean(row['Upload Foto Konter / Tempat Kerja']));

        const foto = await uploadFromDriveToCloudinary(driveFoto, `foto_${Date.now()}`);
        const foto_konter = await uploadFromDriveToCloudinary(driveFotoKonter, `konter_${Date.now()}`);

        const token = generateToken();

        // 🔥 INSERT ALUMNI
        const [result] = await db.execute(
          `INSERT INTO alumni 
          (nama, email, nik, alamat, kota_provinsi, no_hp, nama_konter, alamat_konter, foto_url, foto_konter_url, token, is_verified)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            nama,
            clean(row['Email Address']),
            clean(row['NIK (Nomor Induk Kependudukan)']),
            clean(row['Alamat Lengkap']),
            clean(row['Kota - Provinsi']),
            clean(row['No. Handphone Aktif']),
            clean(row['Nama Konter / Tempat Kerja']),
            clean(row['Alamat Konter / Tempat Kerja']),
            foto,
            foto_konter,
            token,
            row['Apakah data yang Anda isi sudah benar?'] === 'Ya, sudah benar' ? 1 : 0
          ]
        );

const id = result.insertId;

// 🔥 Nomor urut
const sequence = String(id).padStart(4, '0');

// 🔥 Format FIX (SESUIA MAU LO)
const nomor_induk = `LPKQ/MMVIII/${sequence}`;

// 🔥 Update DB
await db.execute(
  'UPDATE alumni SET nomor_induk=? WHERE id=?',
  [nomor_induk, id]
);

        // 🔥 HANDLE KELAS
        const kelasNama = clean(row['Mengikuti Kelas?']);

        if (kelasNama) {
          // insert kelas (ignore duplicate)
          await db.execute(
            'INSERT IGNORE INTO kelas (nama_kelas) VALUES (?)',
            [kelasNama]
          );

          // ambil id kelas
          const [kelasData] = await db.execute(
            'SELECT id FROM kelas WHERE nama_kelas=?',
            [kelasNama]
          );

          const kelas_id = kelasData[0]?.id;

          if (kelas_id) {
            await db.execute(
              'INSERT INTO alumni_kelas (alumni_id, kelas_id) VALUES (?, ?)',
              [id, kelas_id]
            );
          }
        }

        console.log(`✅ SUCCESS: ${nama} (${nomor_induk})\n`);

      } catch (err) {
        console.log('❌ ERROR ROW:', err.message);
      }
    }

    console.log('🎉 IMPORT SELESAI TOTAL!');

  } catch (err) {
    console.log('❌ DB ERROR:', err.message);
  }
})();