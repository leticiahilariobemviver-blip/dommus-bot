import { chromium } from 'playwright';
import fs from 'fs';

// =====================================================================
//  CONFIGURAÇÃO — vinda do .env
// =====================================================================
const LOGIN_URL = process.env.DOMMUS_URL || 'https://painel.dommus.com.br/login';
const LEADS_URL = process.env.DOMMUS_LEADS_URL || 'https://leads.dommus.com.br/';
const USUARIO = process.env.DOMMUS_USER;
const SENHA = process.env.DOMMUS_PASSWORD;

const STORAGE = '/data/sessao-dommus.json';
const PRINTS = '/data/prints';
const MAX_CARDS = 50;
const T_NAV = 120000;   // navegação pode levar ~80s; damos 120s de folga
const T_BOARD = 120000; // espera o tabuleiro de leads aparecer
fs.mkdirSync(PRINTS, { recursive: true });

function cardsAguardando(page) {
  const coluna = page
    .locator('div.conteudoPagina > div')
    .filter({ has: page.locator('div.status', { hasText: 'Aguardando Atendimento' }) });
  return coluna.locator('div.listaItens .cardTopo');
}

// Espera resolver entre: tabuleiro carregou, OU caiu de volta no login.
// (o Dommus é lento — ~80s — então a espera é generosa)
async function esperarLeads(page) {
  const board = page.locator('div.conteudoPagina').first();
  const login = page.getByRole('textbox', { name: 'E-MAIL' });
  const r = await Promise.race([
    board.waitFor({ state: 'visible', timeout: T_BOARD }).then(() => 'board').catch(() => null),
    login.waitFor({ state: 'visible', timeout: T_BOARD }).then(() => 'login').catch(() => null),
  ]);
  return r; // 'board' | 'login' | null
}

// Navega ao painel de leads. Tolera ERR_ABORTED (o goto pode ser cancelado
// pelo redirecionamento do SPA; a página ainda navega, então esperamos o
// resultado de qualquer jeito).
async function irParaLeads(page) {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      await page.goto(LEADS_URL, { waitUntil: 'commit', timeout: T_NAV });
    } catch { /* ERR_ABORTED etc: ignora e confere o resultado abaixo */ }
    const r = await esperarLeads(page);
    if (r === 'board') return 'ok';
    if (r === 'login') return 'precisa-logar';
    await page.waitForTimeout(2000); // timeout: tenta de novo
  }
  return 'falhou';
}

async function abrirContextoLogado(browser) {
  // 1) Tenta reusar a sessão salva
  if (fs.existsSync(STORAGE)) {
    const context = await browser.newContext({ storageState: STORAGE });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(T_NAV);
    if ((await irParaLeads(page)) === 'ok') return { context, page };
    await context.close(); // expirou: login do zero abaixo
  }

  // 2) Login do zero
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(T_NAV);

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: T_NAV });
  await page.getByRole('textbox', { name: 'E-MAIL' }).fill(USUARIO);
  await page.getByRole('textbox', { name: 'SENHA' }).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForTimeout(3000); // deixa o login começar a processar

  // Passo "Acessar"
  try {
    await page.getByRole('button', { name: 'Acessar' }).first().click({ timeout: 15000 });
    await page.waitForTimeout(3000);
  } catch { /* às vezes não aparece */ }

  if ((await irParaLeads(page)) !== 'ok') {
    await page.screenshot({ path: `${PRINTS}/login-falhou-${Date.now()}.png`, fullPage: true }).catch(() => {});
    throw new Error('Não consegui abrir o painel de leads após o login (veja /data/prints/login-falhou-*.png)');
  }

  await context.storageState({ path: STORAGE });
  return { context, page };
}

async function mudarStatusNoPopup(popup) {
  popup.setDefaultTimeout(60000);
  await popup.getByText('1.1 Aguardando Atendimento').click();
  await popup.getByText('1.2 Tentando Contato').click();
  await popup.getByRole('button', { name: 'Salvar' }).click();
  try { await popup.getByRole('button', { name: 'OK' }).click({ timeout: 10000 }); } catch {}
  try { await popup.getByRole('button', { name: 'Não, obrigado.' }).click({ timeout: 10000 }); } catch {}
}

export async function processarColuna() {
  const browser = await chromium.launch({ headless: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  let processados = 0;
  const erros = [];
  try {
    const { page } = await abrirContextoLogado(browser); // tabuleiro já carregado

    // Carrega o tabuleiro UMA vez (é o passo lento). Depois reaproveita a
    // mesma página: ao mudar o status, o card sai da coluna no próprio quadro.
    for (let i = 0; i < MAX_CARDS; i++) {
      const cards = cardsAguardando(page);
      if ((await cards.count()) === 0) break; // coluna vazia: terminou

      try {
        const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
        await cards.first().click();
        const popup = await popupPromise;
        await mudarStatusNoPopup(popup);
        await popup.waitForTimeout(800);
        await popup.close();
        processados++;
        await page.waitForTimeout(2500); // deixa o quadro atualizar (card sai da coluna)
      } catch (e) {
        erros.push(String(e && e.message ? e.message : e));
        await page.screenshot({ path: `${PRINTS}/erro-${carimbo}-${i}.png`, fullPage: true }).catch(() => {});
        break;
      }
    }
    return { ok: erros.length === 0, processados, erros };
  } catch (erro) {
    return { ok: false, processados, erros: [String(erro && erro.message ? erro.message : erro)] };
  } finally {
    await browser.close();
  }
}
