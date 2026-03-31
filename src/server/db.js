const path = require('path');
const fs = require('fs/promises');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', '..', 'antidote.sqlite');

async function initDb() {
  // SQLite cannot create missing folders, so ensure the parent path exists first.
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });

  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL UNIQUE,
      report_date TEXT,
      mood REAL,
      headache REAL,
      fatigue REAL,
      anxiety REAL,
      raw_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(report_date);

    CREATE TABLE IF NOT EXISTS daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      mood REAL,
      headache REAL,
      fatigue REAL,
      anxiety REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(file_name, metric_date)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(metric_date);
  `);

  return db;
}

async function upsertReport(db, report) {
  if (report.reportDate) {
    const staleRows = await db.all(
      'SELECT file_name AS fileName FROM reports WHERE report_date = ? AND file_name <> ?',
      [report.reportDate, report.fileName]
    );

    for (const row of staleRows) {
      await db.run('DELETE FROM daily_metrics WHERE file_name = ?', [row.fileName]);
      await db.run('DELETE FROM reports WHERE file_name = ?', [row.fileName]);
    }
  }

  await db.run(
    `
    INSERT INTO reports (
      file_name,
      report_date,
      mood,
      headache,
      fatigue,
      anxiety,
      raw_text,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(file_name) DO UPDATE SET
      report_date = excluded.report_date,
      mood = excluded.mood,
      headache = excluded.headache,
      fatigue = excluded.fatigue,
      anxiety = excluded.anxiety,
      raw_text = excluded.raw_text,
      updated_at = datetime('now')
    `,
    [
      report.fileName,
      report.reportDate,
      report.mood,
      report.headache,
      report.fatigue,
      report.anxiety,
      report.rawText
    ]
  );
}

async function upsertDailyMetrics(db, fileName, dailyPoints) {
  await db.run('DELETE FROM daily_metrics WHERE file_name = ?', [fileName]);

  if (!dailyPoints || !dailyPoints.length) {
    return;
  }

  const insertSql = `
    INSERT INTO daily_metrics (
      file_name,
      metric_date,
      mood,
      headache,
      fatigue,
      anxiety,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `;

  for (const point of dailyPoints) {
    await db.run(insertSql, [
      fileName,
      point.date,
      point.mood,
      point.headache,
      point.fatigue,
      point.anxiety
    ]);
  }
}

module.exports = {
  DB_PATH,
  initDb,
  upsertReport,
  upsertDailyMetrics
};

