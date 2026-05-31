import 'dotenv/config';
import express from 'express';
import { processarColuna } from './dommus.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ROBO_TOKEN = process.env.ROBO_TOKEN;

// ─── Middleware de autenticação ───────────────────────────────────────────────
function autenticar(req, res, next) {
  if (!ROBO_TOKEN) {
    // Se não há token configurado, bloqueia tudo por segurança
    return res.status(500).json({ ok: false, error: 'ROBO_TOKEN não configurado no servidor' });
  }
  const tokenEnviado = req.headers['x-token'];
  if (!tokenEnviado || tokenEnviado !== ROBO_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Token inválido ou ausente' });
  }
  next();
}

// ─── Mutex: garante uma execução por vez ─────────────────────────────────────
let busy = false;

// ─── Rotas ───────────────────────────────────────────────────────────────────

// Health check — sem autenticação (usado pelo EasyPanel)
app.get('/health', (_req, res) => {
  res.json({ ok: true, busy });
});

// Endpoint principal — requer token
app.post('/mudar-status', autenticar, async (_req, res) => {
  if (busy) {
    return res.status(429).json({ ok: false, error: 'Robô ocupado, tente novamente em instantes' });
  }

  busy = true;
  const inicio = Date.now();
  console.log('[dommus-bot] Iniciando processamento da coluna...');

  try {
    const resultado = await processarColuna();
    const duracao = ((Date.now() - inicio) / 1000).toFixed(1);
    console.log(`[dommus-bot] Concluído em ${duracao}s — processados: ${resultado.processados}`);
    res.json({ ...resultado, duracao_segundos: parseFloat(duracao) });
  } catch (err) {
    console.error('[dommus-bot] Erro inesperado:', err.message);
    res.status(500).json({ ok: false, error: err.message, processados: 0 });
  } finally {
    busy = false;
  }
});

// ─── Inicialização ───────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`[dommus-bot] Servidor rodando na porta ${PORT}`);
  if (!ROBO_TOKEN) {
    console.warn('[dommus-bot] AVISO: ROBO_TOKEN não definido — todas as requisições serão rejeitadas!');
  }
});

// Graceful shutdown
function shutdown() {
  console.log('[dommus-bot] Encerrando...');
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
