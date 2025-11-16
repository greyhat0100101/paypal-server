import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// ✅ Endpoint de salud
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Obtener token de PayPal
async function getAccessToken(mode) {
  try {
    const clientId =
      mode === 'live'
        ? process.env.PAYPAL_LIVE_CLIENT_ID
        : process.env.PAYPAL_SANDBOX_CLIENT_ID;
    const clientSecret =
      mode === 'live'
        ? process.env.PAYPAL_LIVE_CLIENT_SECRET
        : process.env.PAYPAL_SANDBOX_CLIENT_SECRET;

    const baseURL =
      mode === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';

    const response = await axios({
      method: 'post',
      url: `${baseURL}/v1/oauth2/token`,
      auth: { username: clientId, password: clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'grant_type=client_credentials',
    });

    return response.data.access_token;
  } catch (error) {
    console.error('❌ Error obteniendo access_token:', error.response?.data || error.message);
    throw new Error('No se pudo autenticar con PayPal');
  }
}

// Crear payout
async function createPayout(payment, mode) {
  const baseURL =
    mode === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

  const accessToken = await getAccessToken(mode);

  // 🔒 Sanitizar campos string obligatorios
  const employeeName = String(payment.employee_name || '').trim();
  const paypalEmail = String(payment.paypal_email || '').trim();
  const periodStart = String(payment.period_start || '').trim();
  const periodEnd = String(payment.period_end || '').trim();
  const amountValue = Number(payment.amount || 0);

  if (!employeeName || !paypalEmail || !amountValue) {
    throw new Error('Datos de pago inválidos o incompletos');
  }

  const payoutPayload = {
    sender_batch_header: {
      sender_batch_id: `BATCH-${Date.now()}`,
      email_subject: `Pago de E.V.A a ${employeeName}`,
      email_message: `Has recibido un pago de E.V.A.`,
    },
    items: [
      {
        recipient_type: 'EMAIL',
        amount: {
          value: amountValue.toFixed(2),
          currency: 'USD',
        },
        receiver: paypalEmail,
        note: `Pago correspondiente al período ${periodStart} - ${periodEnd}`,
        sender_item_id: String(payment.employee_id || `ID-${Date.now()}`),
      },
    ],
  };

  const response = await axios.post(`${baseURL}/v1/payments/payouts`, payoutPayload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return response.data;
}

// Endpoint principal
app.post('/process-payment', async (req, res) => {
  try {
    const body = req.body;

    // Caso: múltiples pagos
    if (body.payments && Array.isArray(body.payments)) {
      const results = [];
      for (const payment of body.payments) {
        const requiredFields = [
          'employee_id',
          'employee_name',
          'amount',
          'paypal_email',
          'payment_mode',
          'period_start',
          'period_end',
        ];
        for (const field of requiredFields) {
          if (!payment[field]) {
            return res.status(400).json({
              success: false,
              error: `Campo faltante: ${field}`,
              timestamp: new Date().toISOString(),
            });
          }
        }

        const payout = await createPayout(payment, payment.payment_mode);
        results.push({
          success: true,
          transaction_id: payout.batch_header.payout_batch_id,
          status: payout.batch_header.batch_status,
          amount: payment.amount,
          paypal_email: payment.paypal_email,
          employee_name: payment.employee_name,
          timestamp: new Date().toISOString(),
        });
      }
      return res.json(results);
    }

    // Caso: pago único
    const { employee_id, employee_name, amount, paypal_email, payment_mode, period_start, period_end } = body;
    const requiredFields = ['employee_id', 'employee_name', 'amount', 'paypal_email', 'payment_mode', 'period_start', 'period_end'];

    for (const field of requiredFields) {
      if (!body[field]) {
        return res.status(400).json({
          success: false,
          error: `Campo faltante: ${field}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const payout = await createPayout(body, payment_mode);

    res.json({
      success: true,
      transaction_id: payout.batch_header.payout_batch_id,
      status: payout.batch_header.batch_status,
      amount,
      paypal_email,
      employee_name,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error al procesar pago:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: typeof error.response?.data === 'object'
        ? JSON.stringify(error.response.data)
        : String(error.message),
      timestamp: new Date().toISOString(),
    });
  }
});

app.listen(PORT, () => console.log(`💸 Servidor PayPal activo en http://localhost:${PORT}`));
