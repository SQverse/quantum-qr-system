require('dotenv').config();
const express = require('express');
const app = express();
const mysql = require('mysql2');
const path = require('path');
const puppeteer = require('puppeteer'); // Pastikan ini di paling atas file
const fs = require('fs');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const PORT = process.env.PORT || 3000;

// Gunakan .promise() agar bisa menggunakan await secara konsisten
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
}).promise(); 

app.use(express.static('public')); 
app.use('/qrcodes', express.static('public/qrcodes'));

app.get('/', (req, res) => {
  res.send('Server jalan bro 🚀');
});

// FIX UTAMA: Gunakan sintaks (.*) tanpa titik dua di depan tanda kurung
// Kita pakai '/card/' saja tanpa parameter di string-nya
// Lalu kita ambil manual sisa URL-nya
app.use('/card', async (req, res, next) => {
  // Ambil sisa path setelah '/card' (misal: '/LPKQ/IV/0022')
  let id = req.path; 

  // Hilangkan garis miring di awal (menjadi 'LPKQ/IV/0022')
  if (id.startsWith('/')) id = id.substring(1);

  if (!id) return res.send('ID tidak valid');

  try {
    const [results] = await db.query('SELECT * FROM alumni WHERE nomor_induk=?', [id]);
    
    if (results.length === 0) return res.send('Data tidak ditemukan');

    const user = results[0];
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.send(renderCard(user, baseUrl));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error ❌');
  }
});

app.get('/verify', async (req, res) => {
  const { id, token } = req.query;
  if (!id || !token) return res.send(renderPage(false));

  try {
    const [results] = await db.query(
      'SELECT * FROM alumni WHERE nomor_induk=? AND token=?',
      [id, token]
    );

    if (results.length === 0) return res.send(renderPage(false));

    const user = results[0];
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.send(renderPage(true, user, baseUrl));
  } catch (err) {
    res.status(500).send(renderPage(false));
  }
});

// --- DASHBOARD ADMIN ---
app.get('/admin/dashboard', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM alumni ORDER BY id DESC');
    const pendingCount = rows.filter(r => !r.is_downloaded).length;
    
    // Render file views/dashboard.ejs
    res.render('dashboard', { rows, pendingCount });
  } catch (err) {
    console.error(err);
    res.status(500).send("Gagal memuat dashboard: " + err.message);
  }
});

const archiver = require('archiver'); // Tambahkan di paling atas

app.get('/admin/generate-batch', async (req, res) => {
  let browser;
  try {
    const [pending] = await db.query('SELECT * FROM alumni WHERE is_downloaded = 0');
    if (pending.length === 0) return res.send("Tidak ada data baru untuk diproses.");

    browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    await page.setViewport({ width: 850, height: 300 });

    const processedFiles = []; // Untuk mencatat file apa saja yang baru dibuat

    for (let user of pending) {
      try {
        await page.goto(`${baseUrl}/card/${user.nomor_induk}`, { waitUntil: 'networkidle0' });

        const fileName = `${user.nama.replace(/\s+/g, '_')}_${user.id}.pdf`;
        const filePath = path.join(__dirname, '../cards', fileName);

        await page.pdf({
          path: filePath,
          width: '850px',
          height: '300px',
          printBackground: true,
          pageRanges: '1'
        });

        await db.query('UPDATE alumni SET is_downloaded = 1 WHERE id = ?', [user.id]);
        processedFiles.push({ path: filePath, name: fileName });
        console.log(`✅ Kartu ${user.nama} dicetak.`);
      } catch (err) {
        console.error(`❌ Gagal: ${user.nama}`, err.message);
      }
    }

    // --- PROSES ZIP OTOMATIS ---
    if (processedFiles.length > 0) {
      const zipName = `Kartu_Alumni_${new Date().toISOString().split('T')[0]}.zip`;
      const zipPath = path.join(__dirname, '../cards', zipName);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        console.log(`🎁 ZIP Selesai dibuat: ${zipName}`);
      });

      archive.pipe(output);
      
      // Masukkan semua file yang baru diproses ke dalam zip
      processedFiles.forEach(file => {
        archive.file(file.path, { name: file.name });
      });

      await archive.finalize();
      res.send(`✅ Berhasil! ${processedFiles.length} kartu dicetak dan sudah dibungkus dalam file: ${zipName}`);
    }

  } catch (err) {
    console.error(err);
    res.status(500).send("Gagal: " + err.message);
  } finally {
    if (browser) await browser.close();
  }
});

// --- HELPER & RENDER ---
function renderCard(user, baseUrl) {
  const qrImage = user.qr_path.startsWith('http') ? user.qr_path : baseUrl + '/' + user.qr_path;
  return `
  <html>
  <head>
    <style>
      body { background: #eee; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: Arial, sans-serif; margin: 0; }
      .card { width: 850px; height: 300px; display: flex; border-radius: 15px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.2); background: white; }
      .left { flex: 2; display: flex; flex-direction: column; }
      .header { background: linear-gradient(to right, #1e88e5, #0d47a1); color: white; padding: 15px; font-weight: bold; font-size: 20px; text-align: center; }
      .subheader { background: #e53935; color: white; text-align: center; font-weight: bold; padding: 5px; font-size: 16px; }
      .content { padding: 15px 25px; flex: 1; font-size: 15px; }
      .row { display: flex; margin-bottom: 6px; }
      .label { width: 110px; font-weight: bold; color: #555; }
      .value { flex: 1; font-weight: bold; text-transform: uppercase; }
      .footer { background: #222; color: white; text-align: center; padding: 5px; font-size: 11px; }
      .right { flex: 1; background: #2c3e50; color: white; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 10px; }
      .foto { width: 110px; height: 130px; object-fit: cover; border: 3px solid white; border-radius: 8px; margin-bottom: 10px; }
      .qr { width: 80px; background: white; padding: 5px; border-radius: 5px; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="left">
        <div class="header">QUANTUM TELECOMMUNICATION</div>
        <div class="subheader">ALUMNI MEMBER CARD</div>
        <div class="content">
          <div class="row"><div class="label">NAMA</div><div class="value">: ${user.nama || '-'}</div></div>
          <div class="row"><div class="label">ID</div><div class="value">: ${user.nomor_induk || '-'}</div></div>
          <div class="row"><div class="label">ALAMAT</div><div class="value">: ${user.alamat || '-'}</div></div>
          <div class="row"><div class="label">KONTER</div><div class="value">: ${user.nama_konter || '-'}</div></div>
        </div>
        <div class="footer">https://quantumtelecom.id/</div>
      </div>
      <div class="right">
        <img src="${user.foto_url || ''}" class="foto" onerror="this.src='https://via.placeholder.com/110x130?text=No+Photo'"/>
        <img src="${qrImage}" class="qr" />
      </div>
    </div>
  </body>
  </html>`;
}

function renderPage(valid, user, baseUrl) {
  if (!valid || !user) {
    return `<html><body style="text-align:center; margin-top:50px; font-family:sans-serif;"><h1 style="color:red;">❌ DATA TIDAK VALID / KADALUWARSA</h1></body></html>`;
  }
  return renderCard(user, baseUrl);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('Server jalan di port ' + PORT + ' 🚀');
});