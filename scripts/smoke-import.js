const path = require('path');
const fs = require('fs/promises');
const { parsePdfFile } = require('../src/server/parser');

async function main() {
  const folder = path.join(__dirname, '..', 'pdfs');
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const pdfs = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    .map((entry) => path.join(folder, entry.name));

  if (!pdfs.length) {
    console.log('No PDF files found in ./pdfs');
    return;
  }

  const rows = [];
  for (const pdfPath of pdfs) {
    const report = await parsePdfFile(pdfPath);
    rows.push({
      fileName: report.fileName,
      reportDate: report.reportDate,
      mood: report.mood,
      headache: report.headache,
      fatigue: report.fatigue,
      anxiety: report.anxiety,
      dailyPoints: report.dailyPoints.length
    });
  }

  console.log(`Parsed ${rows.length} PDF file(s):`);
  console.table(rows);
}

main().catch((error) => {
  console.error('Smoke import failed:', error.message);
  process.exit(1);
});

