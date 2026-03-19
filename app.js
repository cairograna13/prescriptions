const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { randomUUID } = require('crypto');
const { z } = require('zod');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3000;

const uploads = {};
const prescriptionIds = new Set();

const VALID_UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

app.get('/', (req, res) => {
  res.json({
    message: 'Prescription API',
    endpoints: {
      upload: 'POST /api/prescriptions/upload',
      status: 'GET /api/prescriptions/upload/:id',
    },
  });
});

app.post('/api/prescriptions/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Arquivo CSV é obrigatório' });
  }

  const uploadId = randomUUID();

  let rows;
  try {
    rows = parseCsvRows(req.file.buffer);
  } catch (error) {
    return res.status(400).json({
      message: error.message || 'Erro ao ler arquivo CSV',
    });
  }

  createUploadStatus(uploadId, rows.length);

  setImmediate(async () => {
    try {
      await processRows(uploadId, rows);
    } catch (error) {
      const data = uploads[uploadId];
      if (data) {
        data.status = 'failed';
        data.errors.push({
          line: null,
          errors: [
            {
              field: 'file',
              message: error.message || 'Erro interno ao processar arquivo',
            },
          ],
        });
      }
    }
  });

  return res.status(202).json(uploads[uploadId]);
});

app.get('/api/prescriptions/upload/:id', (req, res) => {
  const data = uploads[req.params.id];

  if (!data) {
    return res.status(404).json({ message: 'Upload não encontrado' });
  }

  return res.json(data);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

function createUploadStatus(id, totalRecords = 0) {
  uploads[id] = {
    upload_id: id,
    status: 'processing',
    total_records: totalRecords,
    processed_records: 0,
    valid_records: 0,
    invalid_records: 0,
    errors: [],
  };
}

function parseCsvRows(fileBuffer) {
  const csvText = fileBuffer.toString('utf-8').replace(/^\uFEFF/, '');

  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function processRows(uploadId, rows) {
  try {
    rows.forEach((row, index) => {
      const lineNumber = index + 2;
      const result = rowData.safeParse(row);

      uploads[uploadId].processed_records += 1;

      if (!result.success) {
        uploads[uploadId].invalid_records += 1;
        addError(uploadId, lineNumber, result.error.issues, row);
        return;
      }

      const record = result.data;

      if (prescriptionIds.has(record.id)) {
        uploads[uploadId].invalid_records += 1;
        addError(
          uploadId,
          lineNumber,
          [{ path: ['id'], message: 'id já existe no sistema' }],
          row,
        );
        return;
      }

      prescriptionIds.add(record.id);
      uploads[uploadId].valid_records += 1;
    });

    uploads[uploadId].status = 'completed';
  } catch (error) {
    uploads[uploadId].status = 'failed';
    uploads[uploadId].errors.push({
      line: null,
      errors: [
        {
          field: 'file',
          message: error.message || 'Erro ao processar arquivo',
        },
      ],
    });
  }
}

const rowData = z
  .object({
    id: z.string().trim().min(1, 'id é obrigatório'),
    date: z.string().trim().refine(isValidDate, 'date inválida ou futura'),
    patient_cpf: z
      .string()
      .trim()
      .regex(/^\d{11}$/, 'CPF deve ter 11 dígitos')
      .refine(isValidCpf, 'CPF inválido'),
    doctor_crm: z.string().trim().regex(/^\d+$/, 'CRM deve conter apenas números'),
    doctor_uf: z
      .string()
      .trim()
      .transform((uf) => uf.toUpperCase())
      .refine((uf) => VALID_UFS.includes(uf), 'UF inválida'),
    medication: z.string().trim().min(1, 'medication é obrigatório'),
    controlled: z.any(),
    dosage: z.string().trim().min(1, 'dosage é obrigatório'),
    frequency: z.preprocess(
      normalizeFrequency,
      z
        .string()
        .min(1, 'frequency é obrigatório')
        .regex(
          /^(\d+|\d+\s*\/\s*\d+h)$/,
          'frequency deve ser número positivo ou no formato 8/8h',
        ),
    ),
    duration: z.coerce
      .number()
      .positive('duration deve ser positivo')
      .max(90, 'duration deve ser no máximo 90'),
    notes: z.string().optional().or(z.literal('')),
  })
  .transform((data) => ({
    ...data,
    controlled: parseBoolean(data.controlled),
    frequency: normalizeFrequency(data.frequency),
  }))
  .superRefine((data, ctx) => {
    if (data.controlled && (!data.notes || !data.notes.trim())) {
      ctx.addIssue({
        code: 'custom',
        path: ['notes'],
        message: 'Medicamento controlado requer observações',
      });
    }

    const frequencyHours = extractFrequencyHours(data.frequency);

    if (data.controlled && frequencyHours > 60) {
      ctx.addIssue({
        code: 'custom',
        path: ['frequency'],
        message: 'Medicamento controlado tem frequência máxima de 60 horas',
      });
    }
  });

function isValidDate(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date <= new Date();
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return ['true', '1', 'yes', 'sim'].includes(normalized);
}

function normalizeFrequency(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(value);
  }

  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toLowerCase();

  if (/^\d+$/.test(normalized)) {
    return normalized;
  }

  if (/^\d+\s*\/\s*\d+h$/.test(normalized)) {
    return normalized.replace(/\s+/g, '');
  }

  return normalized;
}

function extractFrequencyHours(frequency) {
  if (/^\d+$/.test(frequency)) {
    return Number(frequency);
  }

  const match = frequency.match(/^(\d+)\/(\d+)h$/);
  if (!match) return Number.NaN;

  return Number(match[2]);
}

function isValidCpf(cpf) {
  const cleaned = String(cpf).replace(/\D/g, '');

  if (!/^\d{11}$/.test(cleaned)) return false;
  if (/^(\d)\1{10}$/.test(cleaned)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(cleaned[i]) * (10 - i);
  }

  let digit1 = (sum * 10) % 11;
  if (digit1 === 10) digit1 = 0;
  if (digit1 !== Number(cleaned[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += Number(cleaned[i]) * (11 - i);
  }

  let digit2 = (sum * 10) % 11;
  if (digit2 === 10) digit2 = 0;

  return digit2 === Number(cleaned[10]);
}

function addError(uploadId, line, issues, row = {}) {
  uploads[uploadId].errors.push({
    line,
    errors: issues.map((issue) => ({
      field: issue.path.join('.') || 'linha',
      message: issue.message,
      value: issue.path[0] ? row[issue.path[0]] : row,
    })),
  });
}