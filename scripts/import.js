require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const mysql = require('mysql2');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET
});

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

async function uploadFromDriveToCloudinary(driveUrl, filename) {
  const { finished } = require('stream/promises'); // Tambahkan di atas
  
  try {
    if (!driveUrl) return null;

    // ambil file ID
    const match = driveUrl.match(/id=([^&]+)/);
    if (!match) return null;

    const fileId = match[1];

    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    const tempPath = path.join(__dirname, `${filename}.jpg`);

    // download file
    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    await finished(writer);

    // upload ke cloudinary
    const result = await cloudinary.uploader.upload(tempPath, {
      folder: 'alumni'
    });

    // hapus file lokal
    fs.unlinkSync(tempPath);

    return result.secure_url;

  } catch (err) {
    console.log('❌ Upload gagal:', err.message);
    return null;
  }
}

async function uploadToCloudinary(imageUrl) {
  if (!imageUrl) return null;

  try {
    const result = await cloudinary.uploader.upload(imageUrl, {
      folder: 'alumni'
    });

    return result.secure_url;
  } catch (err) {
    console.log('❌ Upload gagal:', err.message);
    return null;
  }
}

function clean(value) {
  if (!value || value.trim() === '-' || value.trim() === '') return null;
  return value.trim();
}

function convertDriveLink(url) {
  if (!url) return null;

  // ambil ID dari berbagai format
  let match = url.match(/id=([^&]+)/);
  if (!match) {
    match = url.match(/\/d\/(.*?)\//);
  }

  if (!match) return null;

  const fileId = match[1];

  // 🔥 FORMAT YANG BISA DIAKSES CLOUDINARY
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

db.connect(async () => {
  console.log('✅ MySQL connected');

  const rows = [];
  const stream = fs.createReadStream('data/data_alumni.csv').pipe(csv({
    mapHeaders: ({ header }) => header.trim()
  }));

  // Masukin semua ke array dulu atau langsung proses pakai for await
  console.log('⏳ Memulai proses import...');

  for await (const row of stream) {
    const nama = clean(row['Nama Lengkap (Sesuai KTP)']);
    if (!nama) continue;

    console.log(`\nProcessing: ${nama}`);

    const driveFoto = convertDriveLink(clean(row['Upload Foto Diri (untuk kartu anggota)']));
    const driveFotoKonter = convertDriveLink(clean(row['Upload Foto Konter / Tempat Kerja']));

    // Sekarang await ini akan benar-benar menunggu sebelum lanjut ke baris CSV berikutnya
    const foto = await uploadFromDriveToCloudinary(driveFoto, `foto_${Date.now()}`);
    const foto_konter = await uploadFromDriveToCloudinary(driveFotoKonter, `konter_${Date.now()}`);

    const token = generateToken();
    
    // Gunakan promise-based query atau bungkus ke Promise agar loop menunggu
    await new Promise((resolve) => {
      db.query(
        `INSERT INTO alumni (nama, email, nik, alamat, kota_provinsi, no_hp, nama_konter, alamat_konter, foto_url, foto_konter_url, token, is_verified) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nama, clean(row['Email Address']), clean(row['NIK (Nomor Induk Kependudukan)']),
          clean(row['Alamat Lengkap']), clean(row['Kota - Provinsi']), clean(row['No. Handphone Aktif']),
          clean(row['Nama Konter / Tempat Kerja']), clean(row['Alamat Konter / Tempat Kerja']),
          foto, foto_konter, token, row['Apakah data yang Anda isi sudah benar?'] === 'Ya, sudah benar' ? 1 : 0
        ],
        (err, result) => {
          if (err) {
            console.log('❌ Insert error:', err.message);
          } else {
            const id = result.insertId;
            const nomor_induk = 'ALM' + String(id).padStart(4, '0');
            db.query('UPDATE alumni SET nomor_induk=? WHERE id=?', [nomor_induk, id], () => {
              console.log(`✅ Berhasil: ${nama} (${nomor_induk})`);
              resolve();
            });
          }
        }
      );
    });
  }

  console.log('\n🎉 SEMUA DATA SELESAI DIIMPORT!');
});