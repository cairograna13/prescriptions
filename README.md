# Prescription API

## Rodando

```bash
npm install
npm run start
```

Servidor:

```bash
http://localhost:3000
```

## Endpoints

### Upload do CSV

```bash
curl -X POST http://localhost:3000/api/prescriptions/upload \
  -F "file=@./example.csv"
```

### Consultar status

```bash
curl http://localhost:3000/api/prescriptions/upload/SEU_UPLOAD_ID
```

## Abordagem

Estudei e utilizei a estrutura mais simples e funcional possivel, centralizando a lógica em um único arquivo, seguindo o conselho do Bruno tech lead (Bruno != Bruno Lobo).

Utilizei a library Zod para a validação dos dados, dei uma lida em exemplos, mantendo a solução simples.

## Observações

- O processamento é assíncrono com `setImmediate`.
- Os dados ficam em memória, então ao reiniciar o servidor tudo é perdido.
- O campo `frequency` aceita tanto número puro quanto formatos como `8/8h` e `12/12h`.

## 📄 Exemplos de CSV

### ✅ Exemplo CSV 100% correto

```csv
id,date,patient_cpf,doctor_crm,doctor_uf,medication,controlled,dosage,frequency,duration,notes
1,2024-01-10,12345678901,12345,SP,Paracetamol,false,500mg,8,5,
2,2023-12-05,98765432100,54321,RJ,Ibuprofeno,false,400mg,6,7,
3,2024-02-20,11122233344,99999,MG,Amoxicilina,false,250mg,12,10,
4,2024-03-01,55566677788,77777,RS,Diazepam,true,10mg,24,30,Uso controlado
5,2024-01-15,22233344455,88888,SC,Loratadina,false,10mg,24,15,
6,2023-11-11,33344455566,66666,BA,Omeprazol,false,20mg,24,20,
7,2024-02-01,44455566677,55555,PR,Clonazepam,true,2mg,12,60,Paciente ansioso
8,2024-01-25,66677788899,44444,CE,Metformina,false,850mg,12,90,
9,2023-10-30,77788899900,33333,GO,Losartana,false,50mg,24,30,
10,2024-02-10,88899900011,22222,PE,Codeina,true,30mg,24,10,Dor intensa
```

### ✅ Exemplo CSV com erros

```csv
id,date,patient_cpf,doctor_crm,doctor_uf,medication,controlled,dosage,frequency,duration,notes
1,2024-01-10,12345678901,12345,SP,Paracetamol,false,500mg,8,5,
2,2026-01-01,12345678901,12345,SP,Paracetamol,false,500mg,8,5,
3,data-invalida,12345678901,12345,SP,Paracetamol,false,500mg,8,5,
4,2024-01-10,123,12345,SP,Paracetamol,false,500mg,8,5,
5,2024-01-10,12345678901,abc,SP,Paracetamol,false,500mg,8,5,
6,2024-01-10,12345678901,12345,XX,Paracetamol,false,500mg,8,5,
7,2024-01-10,12345678901,12345,SP,,false,500mg,8,5,
8,2024-01-10,12345678901,12345,SP,Diazepam,true,10mg,8,5,
9,2024-01-10,12345678901,12345,SP,Diazepam,true,10mg,100,5,obs
10,2024-01-10,12345678901,12345,SP,Paracetamol,false,500mg,-1,5,
11,2024-01-10,12345678901,12345,SP,Paracetamol,false,500mg,8,120,
```

