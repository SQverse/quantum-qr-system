require('dotenv').config();
const express = require('express');
const app = express();
const mysql = require('mysql2');

const PORT = process.env.PORT || 3000;

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});

db.connect((err) => {
  if (err) {
    console.error('DB error:', err);
  } else {
    console.log('MySQL connected ✅');
  }
});

app.get('/', (req, res) => {
  res.send('Server jalan bro 🚀');
});

app.use('/qrcodes', express.static('public/qrcodes'));

app.get('/card/:id', (req, res) => {
  const id = req.params.id;

  db.query(
    'SELECT * FROM alumni WHERE nomor_induk=?',
    [id],
    (err, results) => {
      if (err) return res.send('Server error ❌');
      if (results.length === 0) return res.send('Data tidak ditemukan');

      const user = results[0];
      const baseUrl = `${req.protocol}://${req.get('host')}`;

      res.send(renderCard(user, baseUrl));
    }
  );
});

app.get('/verify', (req, res) => {
  const { id, token } = req.query;

  if (!id || !token) {
    return res.send(renderPage(false));
  }

  db.query(
    'SELECT * FROM alumni WHERE nomor_induk=? AND token=?',
    [id, token],
    (err, results) => {
      if (err || results.length === 0) {
        return res.send(renderPage(false));
      }

      const user = results[0];
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      res.send(renderPage(true, results[0], baseUrl));
    }
  );
});

// 🔧 helper format WA
function formatPhone(no) {
  if (!no) return '';
  return no.replace(/^0/, '62').replace(/\s+/g, '');
}


// 🎨 CARD
function renderCard(user, baseUrl) {
  return `
  <html>
  <head>
    <style>
      body {
        background: #eee;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        font-family: Arial, sans-serif;
      }

      .card {
        width: 900px;
        height: 300px;
        display: flex;
        border-radius: 20px;
        overflow: hidden;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      }

      .left {
        flex: 2;
        background: white;
        display: flex;
        flex-direction: column;
      }

      .header {
        background: linear-gradient(to right, #1e88e5, #0d47a1);
        color: white;
        padding: 15px;
        font-weight: bold;
        font-size: 22px;
        text-align: center;
      }

      .subheader {
        background: red;
        color: white;
        text-align: center;
        font-weight: bold;
        padding: 8px;
        font-size: 18px;
      }

      .content {
        padding: 20px;
        flex: 1;
      }

      .row {
        display: flex;
        margin-bottom: 8px;
      }

      .label {
        width: 120px;
        font-weight: bold;
      }

      .value {
        flex: 1;
      }

      .footer {
        background: #333;
        color: white;
        text-align: center;
        padding: 8px;
        font-size: 12px;
      }

      .right {
        flex: 1;
        background: #2c2c2c;
        color: white;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
      }

      .foto {
        width: 120px;
        height: 140px;
        object-fit: cover;
        border-radius: 10px;
        margin-bottom: 10px;
        background: #999;
      }

      .qr {
        width: 90px;
      }

    </style>
  </head>

  <body>

    <div class="card">

      <!-- LEFT -->
      <div class="left">

        <div class="header">
          QUANTUM TELECOMMUNICATION
        </div>

        <div class="subheader">
          ALUMNI MEMBER CARD
        </div>

        <div class="content">

          <div class="row">
            <div class="label">NAMA</div>
            <div class="value">: ${user.nama || '-'}</div>
          </div>

          <div class="row">
            <div class="label">ID</div>
            <div class="value">: ${user.nomor_induk || '-'}</div>
          </div>

          <div class="row">
            <div class="label">ALAMAT</div>
            <div class="value">: ${user.alamat || '-'}</div>
          </div>

          <div class="row">
            <div class="label">KONTER</div>
            <div class="value">: ${user.nama_konter || '-'}</div>
          </div>

        </div>

        <div class="footer">
          https://quantumtelecom.id/
        </div>

      </div>

      <!-- RIGHT -->
      <div class="right">

        <img src="${user.foto_url || ''}" class="foto" />
        <img src="${baseUrl}/${user.qr_path}" class="qr" />

      </div>

    </div>

  </body>
  </html>
  `;
}

function renderPage(valid, user, baseUrl) {
  if (!valid || !user) {
    return `
    <html>
      <body style="text-align:center; margin-top:50px; font-family:sans-serif;">
        <h1 style="color:red;">❌ DATA TIDAK VALID</h1>
      </body>
    </html>
    `;
  }

  return renderCard(user, baseUrl);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server jalan di port ${PORT} 🚀`);
});