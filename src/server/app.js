const path = require('path');
const express = require('express');
const multer = require('multer');

const { initDb, upsertReport, upsertDailyMetrics, DB_PATH } = require('./db');
const { parsePdfBuffer } = require('./parser');

function summarize(rows) {
  const values = {
    mood: [],
    headache: [],
    fatigue: [],
    anxiety: []
  };

  for (const row of rows) {
    if (typeof row.mood === 'number') values.mood.push(row.mood);
    if (typeof row.headache === 'number') values.headache.push(row.headache);
    if (typeof row.fatigue === 'number') values.fatigue.push(row.fatigue);
    if (typeof row.anxiety === 'number') values.anxiety.push(row.anxiety);
  }

  const avg = (arr) => (arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null);

  return {
    pointCount: rows.length,
    moodAvg: avg(values.mood),
    headacheAvg: avg(values.headache),
    fatigueAvg: avg(values.fatigue),
    anxietyAvg: avg(values.anxiety)
  };
}

async function buildMonthlySeries(db) {
  return db.all(`
    SELECT
      substr(metric_date, 1, 7) AS month,
      ROUND(AVG(mood), 2) AS mood,
      ROUND(AVG(headache), 2) AS headache,
      ROUND(AVG(fatigue), 2) AS fatigue,
      ROUND(AVG(anxiety), 2) AS anxiety,
      COUNT(*) AS count
    FROM daily_metrics
    GROUP BY substr(metric_date, 1, 7)
    ORDER BY month ASC
  `);
}

async function buildDailySeries(db) {
  return db.all(`
    SELECT
      metric_date AS date,
      ROUND(AVG(mood), 2) AS mood,
      ROUND(AVG(headache), 2) AS headache,
      ROUND(AVG(fatigue), 2) AS fatigue,
      ROUND(AVG(anxiety), 2) AS anxiety,
      COUNT(*) AS count
    FROM daily_metrics
    GROUP BY metric_date
    ORDER BY metric_date ASC
  `);
}

async function createServer() {
  const db = await initDb();
  const app = express();
  const upload = multer({ storage: multer.memoryStorage() });

  const publicDir = path.join(__dirname, '..', '..', 'public');

  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/api/health', async (_, res) => {
    const reports = await db.get('SELECT COUNT(*) AS count FROM reports');
    const dailyPoints = await db.get('SELECT COUNT(*) AS count FROM daily_metrics');
    res.json({ ok: true, dbPath: DB_PATH, reports: reports.count, dailyPoints: dailyPoints.count });
  });

  app.post('/api/upload', upload.array('pdfs'), async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) {
        return res.status(400).json({ error: 'No PDF received.' });
      }

      const imported = [];
      for (const file of files) {
        if (!file.originalname.toLowerCase().endsWith('.pdf')) {
          continue;
        }

        const report = await parsePdfBuffer(file.buffer, file.originalname);
        await upsertReport(db, report);
        await upsertDailyMetrics(db, report.fileName, report.dailyPoints);

        imported.push({
          fileName: report.fileName,
          reportDate: report.reportDate,
          mood: report.mood,
          headache: report.headache,
          fatigue: report.fatigue,
          anxiety: report.anxiety,
          dailyPoints: report.dailyPoints.length
        });
      }

      return res.json({
        importedCount: imported.length,
        imported
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/reports', async (_, res) => {
    const rows = await db.all(`
      SELECT id, file_name AS fileName, report_date AS reportDate, mood, headache, fatigue, anxiety, updated_at AS updatedAt
      FROM reports
      ORDER BY COALESCE(report_date, updated_at) DESC, id DESC
    `);
    res.json(rows);
  });

  app.get('/api/stats', async (_, res) => {
    const rows = await db.all('SELECT mood, headache, fatigue, anxiety FROM daily_metrics');
    const monthly = await buildMonthlySeries(db);
    const daily = await buildDailySeries(db);

    res.json({
      global: summarize(rows),
      monthly,
      daily
    });
  });

  app.get('*', (_, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

async function startServer() {
  const app = await createServer();
  const port = process.env.PORT || 3000;

  app.listen(port, () => {
    console.log(`Antidote running on http://localhost:${port}`);
  });
}

module.exports = {
  createServer,
  startServer
};

