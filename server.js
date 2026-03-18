const express  = require('express');
const webpush  = require('web-push');
const fetch    = require('node-fetch');
const fs       = require('fs');

const app  = express();
app.use(express.json());

// ── VAPID ────────────────────────────────────────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC  || 'BDm_AABF01xcVAphGRFx8eIaZqvRYVgMsQ0ghF6nGuQOwSrMt_uhnR7S-PqpDLrR_aLbCDebfsJI4OxeYLTSFfE';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'j-PInRUgDL_J_KtgLAZWZbEnCujzbBEeH5zIMkjc7uw';
const VAPID_EMAIL   = process.env.VAPID_EMAIL   || 'mailto:admin@bigutm.com';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

// ── Gateway config ────────────────────────────────────────
const UMBRELLA_BASE  = 'https://api-gateway.umbrellapag.com/api';
const UMBRELLA_KEY   = process.env.UMBRELLA_KEY  || '';
const HOSTINGER_SAVE = process.env.HOSTINGER_SAVE || 'https://bigcompany.shop/painelv/save.php';

// ── In-memory storage ─────────────────────────────────────
let subscriptions = [];  // push subscriptions
let knownTxIds    = new Set();
let initialized   = false;

// Load subscriptions from file if exists
const SUBS_FILE = '/tmp/subscriptions.json';
try {
  if (fs.existsSync(SUBS_FILE)) {
    subscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
    console.log(`Loaded ${subscriptions.length} subscriptions`);
  }
} catch(e) { console.error('Error loading subs:', e); }

function saveSubs() {
  try { fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions)); } catch(e) {}
}

// ── CORS ──────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Routes ────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', subs: subscriptions.length }));

// Get VAPID public key
app.get('/vapid-public', (req, res) => res.json({ key: VAPID_PUBLIC }));

// Subscribe
app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  
  // Avoid duplicates
  const exists = subscriptions.find(s => s.endpoint === sub.endpoint);
  if (!exists) {
    subscriptions.push(sub);
    saveSubs();
    console.log(`New subscription. Total: ${subscriptions.length}`);
  }
  res.json({ ok: true });
});

// Unsubscribe
app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  subscriptions = subscriptions.filter(s => s.endpoint !== endpoint);
  saveSubs();
  res.json({ ok: true });
});

// Send push manually (for testing)
app.post('/send-test', async (req, res) => {
  const payload = JSON.stringify({
    title: 'VENDA APROVADA',
    body:  'Venda >> R$ 99,00',
    icon:  'https://ronald-almeida.github.io/bigutm/logo.png'
  });
  await sendToAll(payload);
  res.json({ ok: true, sent: subscriptions.length });
});

// ── Push helpers ──────────────────────────────────────────
async function sendToAll(payload) {
  const dead = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch(e) {
      if (e.statusCode === 410 || e.statusCode === 404) dead.push(sub.endpoint);
    }
  }
  if (dead.length) {
    subscriptions = subscriptions.filter(s => !dead.includes(s.endpoint));
    saveSubs();
  }
}

function brl(v) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Polling UmbrelaPag ────────────────────────────────────
async function pollUmbrella() {
  if (!UMBRELLA_KEY) return;
  try {
    const res = await fetch(`${UMBRELLA_BASE}/user/transactions?limit=50`, {
      headers: { 'x-api-key': UMBRELLA_KEY, 'User-Agent': 'UMBRELLAB2B/1.0' }
    });
    const json = await res.json();
    const txs  = json.data?.data || json.data || [];

    if (!initialized) {
      txs.forEach(tx => knownTxIds.add(tx.id));
      initialized = true;
      console.log(`Initialized with ${knownTxIds.size} known transactions`);
      return;
    }

    for (const tx of txs) {
      if (knownTxIds.has(tx.id)) continue;
      knownTxIds.add(tx.id);
      const status = (tx.status || '').toUpperCase();
      const valor  = brl((tx.amount || 0) / 100);
      const nome   = tx.customer?.name || 'Cliente';

      if (status === 'PAID' || status === 'AUTHORIZED') {
        const payload = JSON.stringify({
          title: 'VENDA APROVADA',
          body:  `Venda >> R$ ${valor}`,
          icon:  'https://ronald-almeida.github.io/bigutm/logo.png'
        });
        console.log(`VENDA APROVADA: ${nome} - R$ ${valor}`);
        await sendToAll(payload);
      } else if (status === 'WAITING_PAYMENT') {
        const payload = JSON.stringify({
          title: 'VENDA GERADA',
          body:  `Venda >> R$ ${valor}`,
          icon:  'https://ronald-almeida.github.io/bigutm/logo.png'
        });
        console.log(`VENDA GERADA: ${nome} - R$ ${valor}`);
        await sendToAll(payload);
      }
    }
  } catch(e) {
    console.error('Poll error:', e.message);
  }
}

// Poll a cada 60 segundos
setInterval(pollUmbrella, 60000);
pollUmbrella(); // primeira chamada imediata

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`BIG UTM Push Server rodando na porta ${PORT}`));
