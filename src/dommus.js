import { chromium } from 'playwright';
import fs from 'fs';

// =====================================================================
//  CONFIGURAÇÃO — vinda do .env (nunca escreva senha aqui)
// =====================================================================
const LOGIN_URL = process.env.DOMMUS_URL || 'https://painel.dommus.com.br/login';
const LEADS_URL = process.env.DOMMUS_LEADS_URL || 'https://leads.dommus.com.br/';
const USUARIO = process.env.DOMMUS_USER;
const SENHA = process.env.DOMMUS_PASSWORD;

const STORAGE = '/data/sessao-dommus.json';
const PRINTS = '/data/prints';
const MAX_CARDS = 50; // trava de segurança: nunca processa mais que isso por execução
fs.mkdirSync(PRINTS, { recursive: true });

// =====================================================================
//  Cards da COLUNA "Aguardando Atendimento".
//  A coluna é localizada pelo TEXTO do cabeçalho (div.status), não pela
//  posição — assim não quebra se a ordem das colunas mudar.
// =====================================================================
function cardsAguardando(page) {
  const coluna = page
    .locator('div.conteudoPagina > div')
    .filter({ has: page.locator('div.status', { hasText: 'Aguardando Atendimento' }) });
  return coluna.locator('div.listaItens .cardTopo');
}

async function tabuleiroCarregado(page) {
  return page.locator('div.conteudoPagina').first().isVisible().catch(() => false);
}

// Reaproveita a sessão salva; se expirou, faz login do zero.
async function abrirContextoLogado(browser) {
  if (fs.existsSync(STORAGE)) {
    const context = await browser.newContext({ storageState: STORAGE });
    const page = await context.newPage();
    await page.goto(LEADS_URL, { waitUntil: 'domcontentloaded' });
    if (await tabuleiroCarregado(page)) return { context, page };
    await context.close();
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'E-MAIL' }).fill(USUARIO);
  await page.getByRole('textbox', { name: 'SENHA' }).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  try {
    await page.getByRole('button', { name: 'Acessar' }).first().click({ timeout: 10000 });
  } catch { /* sem tela de Acessar */ }
  await page.goto(LEADS_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('div.conteudoPagina').first().waitFor({ timeout: 20000 });
  await context.storageState({ path: STORAGE });
  return { context, page };
}

// Muda o status de UM card (já dentro do popup que abriu).
async function mudarStatusNoPopup(popup) {
  await popup.getByText('1.1 Aguardando Atendimento').click();
  await popup.getByText('1.2 Tentando Contato').click();
  await popup.getByRole('button', { name: 'Salvar' }).click();
  try { await popup.getByRole('button', { name: 'OK' }).click({ timeout: 8000 }); } catch {}
  try { await popup.getByRole('button', { name: 'Não, obrigado.' }).click({ timeout: 8000 }); } catch {}
}

// Função principal: processa TODOS os cards da coluna "Aguardando Atendimento".
export async function processarColuna() {
  const browser = await chromium.launch({ headless: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  let processados = 0;
  const erros = [];
  try {
    const { page } = await abrirContextoLogado(browser);

    for (let i = 0; i < MAX_CARDS; i++) {
      await page.goto(LEADS_URL, { waitUntil: 'domcontentloaded' });
      await page.locator('div.conteudoPagina').first().waitFor({ timeout: 20000 });

      const cards = cardsAguardando(page);
      const total = await cards.count();
      if (total === 0) break; // coluna vazia: terminou

      try {
        const popupPromise = page.waitForEvent('popup');
        await cards.first().click();
        const popup = await popupPromise;
        await mudarStatusNoPopup(popup);
        await popup.waitForTimeout(800);
        await popup.close();
        processados++;
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        erros.push(msg);
        await page.screenshot({ path: `${PRINTS}/erro-${carimbo}-${i}.png`, fullPage: true }).catch(() => {});
        break; // evita laço infinito se um card travar
      }
    }

    return { ok: erros.length === 0, processados, erros };
  } catch (erro) {
    return { ok: false, processados, erros: [String(erro && erro.message ? erro.message : erro)] };
  } finally {
    await browser.close();
  }
}
