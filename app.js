const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { randomUUID } = require('crypto');
const { z } = require('zod');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;
const uploads = {};
const VALID_UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

// #region Estrutura de Rotas
app.get('/', (req, res) => {
  res.json({
    message: 'Prescription API',
    endpoints: {
      upload: 'POST /api/prescriptions/upload',
      status: 'GET /api/prescriptions/upload/:id'
    }
  });
});

app.post('/api/prescriptions/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Arquivo CSV é obrigatório' });
  }

  const uploadId = randomUUID();
  createUploadStatus(uploadId);

  setImmediate(async () => {
    try {
      await processFile(uploadId, req.file.buffer);
    } catch (error) {
      const data = uploads.get(uploadId);

      if (data) {
        data.status = "failed";
        data.errors.push({
          line: null,
          errors: [{ field: "file", message: error.message }]
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
// #endregion

function createUploadStatus(id) {
  uploads[id] = {
    upload_id: id,
    status: 'processing',
    total_records: 0,
    processed_records: 0,
    valid_records: 0,
    invalid_records: 0,
    errors: []
  };
}

function processFile(uploadId, fileBuffer) {
  try {
    const csvText = fileBuffer.toString('utf-8');
    const rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    uploads[uploadId].total_records = rows.length;

    rows.forEach((row, index) => {
      const result = rowData.safeParse(row);
      uploads[uploadId].processed_records += 1;

      if (result.success) {
        uploads[uploadId].valid_records += 1;
      } else {
        uploads[uploadId].invalid_records += 1;
        addError(uploadId, index + 2, result.error.issues);
      }
    });

    uploads[uploadId].status = 'completed';
  } catch (error) {
    uploads[uploadId].status = 'failed';
    uploads[uploadId].errors.push({
      line: null,
      errors: [
        {
          field: 'file',
          message: error.message || 'Erro ao processar arquivo'
        }
      ]
    });
  }
}

const rowData = z.object({
  id: z.string().min(1, 'id é obrigatório'),
  date: z.string().refine(isValidDate, 'date inválida ou futura'),
  patient_cpf: z.string().regex(/^\d{11}$/, 'CPF deve ter 11 dígitos'),
  doctor_crm: z.string().regex(/^\d+$/, 'CRM deve conter apenas números'),
  doctor_uf: z.string().refine((uf) => VALID_UFS.includes(String(uf).toUpperCase()), 'UF inválida'),
  medication: z.string().min(1, 'medication é obrigatório'),
  controlled: z.any(),
  dosage: z.string().min(1, 'dosage é obrigatório'),
  frequency: z.coerce.number()
    .int('frequency deve ser um número inteiro')
    .positive('frequency deve ser positivo'),
  duration: z.coerce.number()
    .positive('duration deve ser positivo')
    .max(90, 'duration deve ser no máximo 90'),
  notes: z.string().optional().or(z.literal('')),
}).transform((data) => ({
  ...data,
  doctor_uf: String(data.doctor_uf).toUpperCase(),
  controlled: parseBoolean(data.controlled),
  frequency: data.frequency,
})).superRefine((data, ctx) => {
  if (data.controlled && (!data.notes || !data.notes.trim())) {
    ctx.addIssue({
      code: "custom",
      path: ['notes'],
      message: 'Medicamento controlado requer observações'
    });
  }

  if (data.controlled && data.frequency > 60) {
    ctx.addIssue({
      code: "custom",
      path: ['frequency'],
      message: 'Medicamento controlado tem frequência máxima de 60'
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

function addError(uploadId, line, issues) {
  uploads[uploadId].errors.push({
    line,
    errors: issues.map((issue) => ({
      field: issue.path.join('.') || 'linha',
      message: issue.message
    }))
  });
}