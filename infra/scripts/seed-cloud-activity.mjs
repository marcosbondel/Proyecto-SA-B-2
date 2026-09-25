const GATEWAY = 'http://34.27.60.211:3000';

async function login(email) {
  const res = await fetch(`${GATEWAY}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, credential: 'BankUsac#2026' }),
  });
  const data = await res.json();
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data.token;
}

const clientToken = await login('marco.lopez@bankusac.gt');

console.log('1. Realizando pago de servicio EEGSA por Q120.00...');
const billRes = await fetch(`${GATEWAY}/api/transfers`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${clientToken}`,
  },
  body: JSON.stringify({
    sourceAccount: 'b0000000-0000-4000-8000-000000000001',
    targetAccount: 'c0000000-0000-4000-8000-000000000001', // EEGSA
    amount: { amountMinor: 12000, currency: 'GTQ' },
    reference: 'CONTRATO-EEGSA-99412',
    paymentScenario: 'APPROVE',
  }),
});
const billData = await billRes.json();
console.log('Pago de servicio (202):', billData);

console.log('2. Realizando transferencia con fallo simulado y compensación (Saga Rollback)...');
const rejectRes = await fetch(`${GATEWAY}/api/transfers`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${clientToken}`,
  },
  body: JSON.stringify({
    sourceAccount: 'b0000000-0000-4000-8000-000000000001',
    targetAccount: 'b0000000-0000-4000-8000-000000000003',
    amount: { amountMinor: 5000, currency: 'GTQ' },
    reference: 'Transferencia con rechazo de pasarela',
    paymentScenario: 'REJECT',
  }),
});
const rejectData = await rejectRes.json();
console.log('Transferencia rechazada solicitada (202):', rejectData);

console.log('3. Esperando 4 segundos a que ambas Sagas terminen...');
await new Promise((r) => setTimeout(r, 4000));

if (rejectData.transactionId) {
  const compRes = await fetch(`${GATEWAY}/api/transfers/${rejectData.transactionId}`, {
    headers: { Authorization: `Bearer ${clientToken}` },
  });
  const compStatus = await compRes.json();
  console.log('Estado de transferencia compensada:', compStatus.status, compStatus.payment);
}

const finalRes = await fetch(`${GATEWAY}/api/transfers`, {
  headers: { Authorization: `Bearer ${clientToken}` },
});
const list = await finalRes.json();
console.log(`Historial total de transferencias en el sistema: ${list.transactions?.length}`);
for (const tx of list.transactions || []) {
  console.log(`- ID: ${tx.transactionId} | Estado: ${tx.status} | Monto: Q${tx.amount.amountMinor / 100} | Fase: ${tx.phaseStatus}`);
}
