require('dotenv').config();
const puppeteer = require('puppeteer');
const mysql = require('mysql2');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL;

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});

async function generateAllPDF() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  // buat folder kalau belum ada
  if (!fs.existsSync('cards')) {
    fs.mkdirSync('cards');
  }

  db.query('SELECT nomor_induk FROM alumni', async (err, results) => {
    if (err) {
      console.log('DB error:', err);
      return;
    }

    for (let user of results) {
      const id = user.nomor_induk;

      try {
        await page.goto(`${BASE_URL}/card/${id}`, {
          waitUntil: 'networkidle0'
        });

        await page.pdf({
          path: `cards/${id}.pdf`,
          format: 'A4',
          printBackground: true
        });

        console.log(`✅ ${id} selesai`);
      } catch (err) {
        console.log(`❌ ${id} error`, err);
      }
    }

    await browser.close();
    console.log('🎉 SEMUA KARTU SELESAI!');
  });
}

generateAllPDF();