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
      return line.length >= dayCount ? line : null;
    }
  }

  const fallback = section.match(/(\d{20,})/g);
  if (!fallback || !fallback.length) return null;
  const candidate = fallback[fallback.length - 1];
  return candidate.length >= dayCount ? candidate : null;
}

function readDecimalAndDigits(section) {
  if (!section) return null;
  const compact = section.replace(/\s+/g, '');
  const match = compact.match(/(\d{1,2}[.,]\d{2})(\d{20,})/);
  if (!match || !match[1]) return null;
  return {
    average: toNumber(match[1]),
    sequence: match[2]
  };
}

function averageOf(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function decodeCompressedDigitSeries(sequence, dayCount, max = 10, expectedAverage = null) {
  if (!sequence) return [];

  const digits = String(sequence).replace(/\D/g, '');
  if (!digits) return [];

  if (max < 10 || digits.length <= dayCount) {
    return digits
      .slice(0, dayCount)
      .split('')
      .map((char) => Number.parseInt(char, 10));
  }

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  function visit(position, values) {
    const remainingValues = dayCount - values.length;
    const remainingDigits = digits.length - position;

    if (remainingValues < 0 || remainingDigits < remainingValues) return;
    if (remainingDigits > remainingValues * 2) return;

    if (values.length === dayCount) {
      if (position !== digits.length) return;

      const actualAverage = averageOf(values);
      const score =
        typeof expectedAverage === 'number'
          ? Math.abs(Number(actualAverage.toFixed(2)) - expectedAverage)
          : 0;

      if (score < bestScore) {
        best = values;
        bestScore = score;
      }
      return;
    }

    if (digits.startsWith('10', position) && max >= 10) {
      visit(position + 2, values.concat(10));
    }

    visit(position + 1, values.concat(Number.parseInt(digits[position], 10)));
  }

  visit(0, []);

  if (best) return best;

  return digits
    .slice(0, dayCount)
    .split('')
    .map((char) => Number.parseInt(char, 10));
}

function toSeries(sequence, transformFn, options = {}) {
  if (!sequence) return [];
  const rawValues = decodeCompressedDigitSeries(
    sequence,
    options.dayCount || sequence.length,
    options.max || 10,
    options.expectedAverage
  );
  return rawValues.map((value) => transformFn(value));
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

  const sectionEndings = [
    'presentation du symptome',
    'symptom overview',
    'mytherapy',
    'who-5',
    'who 5',
    'who-5 well-being',
    'who-5 wellbeing',
    'mood'
  ];

  const moodSection =
    extractSection(searchText, '(?:humeur|mood)', sectionEndings) || '';
  const headacheSection =
    extractSection(
      searchText,
      '(?:symptome\\s*:\\s*(?:maux? de tete|mal de tete|headache)|symptom\\s*overview\\s*:\\s*headaches?)',
      sectionEndings
    ) || '';
  const fatigueSection =
    extractSection(
      searchText,
      '(?:symptome\\s*:\\s*(?:etre\\s*fatigue\\(e\\)|fatigue)|symptom\\s*overview\\s*:\\s*fatigue)',
      sectionEndings
    ) || '';
  const anxietySection =
    extractSection(
      searchText,
      '(?:symptome\\s*:\\s*(?:anxiete|anxiety)|symptom\\s*overview\\s*:\\s*anxiety)',
      sectionEndings
    ) || '';

  const moodDigits = readDigitsLine(moodSection, dayCount);
  const headacheDigits = readDecimalAndDigits(headacheSection);
  const fatigueDigits = readDecimalAndDigits(fatigueSection);
  const anxietyDigits = readDecimalAndDigits(anxietySection);

  const mood = toSeries(moodDigits, normalizeMoodRaw, { dayCount, max: 5 });
  const headache = headacheDigits
    ? toSeries(headacheDigits.sequence, normalizeSymptomRaw, {
        dayCount,
        max: 10,
        expectedAverage: headacheDigits.average
      })
    : toSeries(readDigitsLine(headacheSection, dayCount), normalizeSymptomRaw, { dayCount, max: 10 });
  const fatigue = fatigueDigits
    ? toSeries(fatigueDigits.sequence, normalizeSymptomRaw, {
        dayCount,
        max: 10,
        expectedAverage: fatigueDigits.average
      })
    : toSeries(readDigitsLine(fatigueSection, dayCount), normalizeSymptomRaw, { dayCount, max: 10 });
  const anxiety = anxietyDigits
    ? toSeries(anxietyDigits.sequence, normalizeSymptomRaw, {
        dayCount,
        max: 10,
        expectedAverage: anxietyDigits.average
      })
    : toSeries(readDigitsLine(anxietySection, dayCount), normalizeSymptomRaw, { dayCount, max: 10 });

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
  parsePdfFile,
  _internals: {
    decodeCompressedDigitSeries
  }
};
