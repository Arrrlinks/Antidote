const path = require('path');
const pdfParse = require('pdf-parse');

function normalizeText(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/[\u00A0\t]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

function toNumber(raw, max = 10) {
  if (raw == null) return null;
  const normalized = String(raw).replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  if (Number.isNaN(parsed)) return null;
  if (parsed < 0) return 0;
  if (parsed > max) return max;
  return parsed;
}

function buildSearchText(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractSection(text, startPattern, endPatterns = []) {
  const startRegex = new RegExp(startPattern, 'i');
  const startMatch = startRegex.exec(text);
  if (!startMatch) return null;

  const startIndex = startMatch.index;
  const afterStart = text.slice(startIndex + startMatch[0].length);

  let endIndex = afterStart.length;
  for (const pattern of endPatterns) {
    const endRegex = new RegExp(pattern, 'i');
    const endMatch = endRegex.exec(afterStart);
    if (endMatch && endMatch.index < endIndex) {
      endIndex = endMatch.index;
    }
  }

  return afterStart.slice(0, endIndex);
}

function extractReportDate(fileName, text) {
  const fromName = fileName.match(/(20\d{2})[_-](\d{1,2})(?:[_-](\d{1,2}))?/);
  if (fromName) {
    const year = fromName[1];
    const month = String(fromName[2]).padStart(2, '0');
    const day = String(fromName[3] || '01').padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const fromText = text.match(/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (fromText) {
    const year = fromText[1];
    const month = String(fromText[2]).padStart(2, '0');
    const day = String(fromText[3]).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}

function daysInMonth(isoDate) {
  if (!isoDate) return 31;
  const [yearRaw, monthRaw] = isoDate.split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate();
}

function avg(values) {
  const valid = (values || []).filter((v) => typeof v === 'number');
  if (!valid.length) return null;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2));
}

function readDigitsLine(section, dayCount) {
  if (!section) return null;

  const lines = section
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (/^\d{20,}$/.test(line)) {
      return line.length >= dayCount ? line.slice(0, dayCount) : null;
    }
  }

  const fallback = section.match(/(\d{20,})/g);
  if (!fallback || !fallback.length) return null;
  const candidate = fallback[fallback.length - 1];
  return candidate.length >= dayCount ? candidate.slice(0, dayCount) : null;
}

function readDecimalAndDigits(section, dayCount) {
  if (!section) return null;
  const compact = section.replace(/\s+/g, '');
  const match = compact.match(/\d{1,2}[.,]\d{2}(\d{20,})/);
  if (!match || !match[1]) return null;
  return match[1].length >= dayCount ? match[1].slice(0, dayCount) : null;
}

function toSeries(sequence, transformFn) {
  if (!sequence) return [];
  return sequence.split('').map((char) => transformFn(Number.parseInt(char, 10)));
}

function normalizeMoodRaw(raw) {
  if (Number.isNaN(raw)) return null;
  if (raw >= 1 && raw <= 5) {
    // MyTherapy often stores mood buckets as 1..5. Convert to 0..4.
    return toNumber(raw - 1, 4);
  }
  return toNumber(raw, 4);
}

function normalizeSymptomRaw(raw) {
  if (Number.isNaN(raw)) return null;
  return toNumber(raw, 10);
}

function buildDailyPoints(reportDate, metricSeries) {
  if (!reportDate) return [];
  const [yearRaw, monthRaw] = reportDate.split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  if (!year || !month) return [];

  const totalDays = Math.max(
    metricSeries.mood.length,
    metricSeries.headache.length,
    metricSeries.fatigue.length,
    metricSeries.anxiety.length
  );

  const rows = [];
  for (let day = 1; day <= totalDays; day += 1) {
    rows.push({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      mood: metricSeries.mood[day - 1] ?? null,
      headache: metricSeries.headache[day - 1] ?? null,
      fatigue: metricSeries.fatigue[day - 1] ?? null,
      anxiety: metricSeries.anxiety[day - 1] ?? null
    });
  }

  return rows;
}

function extractDailyMetrics(text, reportDate) {
  const searchText = buildSearchText(text);
  const dayCount = daysInMonth(reportDate);

  const moodSection = extractSection(searchText, 'humeur', ['presentation du symptome', 'mytherapy', 'who-5']) || '';
  const headacheSection = extractSection(searchText, 'symptome\\s*:\\s*(?:maux? de tete|mal de tete|headache)', ['presentation du symptome', 'mytherapy', 'who-5']) || '';
  const fatigueSection = extractSection(searchText, 'symptome\\s*:\\s*(?:etre\\s*fatigue\\(e\\)|fatigue)', ['presentation du symptome', 'mytherapy', 'who-5']) || '';
  const anxietySection = extractSection(searchText, 'symptome\\s*:\\s*(?:anxiete|anxiety)', ['presentation du symptome', 'mytherapy', 'who-5']) || '';

  const moodDigits = readDigitsLine(moodSection, dayCount);
  const headacheDigits = readDecimalAndDigits(headacheSection, dayCount) || readDigitsLine(headacheSection, dayCount);
  const fatigueDigits = readDecimalAndDigits(fatigueSection, dayCount) || readDigitsLine(fatigueSection, dayCount);
  const anxietyDigits = readDecimalAndDigits(anxietySection, dayCount) || readDigitsLine(anxietySection, dayCount);

  const mood = toSeries(moodDigits, normalizeMoodRaw);
  const headache = toSeries(headacheDigits, normalizeSymptomRaw);
  const fatigue = toSeries(fatigueDigits, normalizeSymptomRaw);
  const anxiety = toSeries(anxietyDigits, normalizeSymptomRaw);

  const dailyPoints = buildDailyPoints(reportDate, { mood, headache, fatigue, anxiety });

  return {
    dailyPoints,
    mood: avg(mood),
    headache: avg(headache),
    fatigue: avg(fatigue),
    anxiety: avg(anxiety)
  };
}

async function parsePdfBuffer(buffer, fileName) {
  const pdfData = await pdfParse(buffer);
  const text = normalizeText(pdfData.text || '');
  const reportDate = extractReportDate(fileName, text);
  const metrics = extractDailyMetrics(text, reportDate);

  return {
    fileName,
    reportDate,
    ...metrics,
    rawText: text
  };
}

async function parsePdfFile(filePath) {
  const fs = require('fs/promises');
  const fileName = path.basename(filePath);
  const buffer = await fs.readFile(filePath);
  return parsePdfBuffer(buffer, fileName);
}

module.exports = {
  parsePdfBuffer,
  parsePdfFile
};

