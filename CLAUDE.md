# dommus-bot

Robô Node.js + Playwright que expõe uma API HTTP para automatizar o CRM Dommus.
Roda como serviço Docker no EasyPanel, no mesmo projeto que o n8n.

## Propósito

Abre o Kanban de leads do Dommus, localiza a coluna "Aguardando Atendimento" e
move **todos** os cards dela para "Tentando Contato", em laço, até a coluna esvaziar.
O n8n aciona esse processo via HTTP, sem que nenhum humano precise intervir.

## Stack

- **Node.js 20** + **Express** (ESM) — servidor HTTP
- **Playwright** (Chromium headless) — automação de browser
- **dotenv** — variáveis de ambiente

## Arquitetura

```
server.js          ← Express: autenticação por token, mutex, rotas
dommus.js          ← Lógica Playwright: login, sessão persistida, processamento
browser.js         ← OBSOLETO (mantido para referência futura)
/data/             ← Volume Docker: sessao-dommus.json + prints de erro
```

`dommus.js` gerencia o ciclo de vida do Chromium internamente — abre no início
da chamada e fecha no `finally`. Não existe browser compartilhado entre chamadas.

## Variáveis de ambiente

| Variável           | Descrição                                          | Exemplo                              |
|--------------------|----------------------------------------------------|--------------------------------------|
| `DOMMUS_URL`       | URL da página de login                             | `https://painel.dommus.com.br/login` |
| `DOMMUS_LEADS_URL` | URL do Kanban de leads                             | `https://leads.dommus.com.br/`       |
| `DOMMUS_USER`      | E-mail de login                                    | `bot@empresa.com`                    |
| `DOMMUS_PASSWORD`  | Senha                                              | `senhasecreta`                       |
| `ROBO_TOKEN`       | Token de autenticação (header `x-token`)           | `uuid-v4-qualquer-string-longa`      |
| `PORT`             | Porta HTTP (padrão: 3000)                          | `3000`                               |

## Endpoints

### `POST /mudar-status`
Processa **toda** a coluna "Aguardando Atendimento".

**Headers obrigatórios:**
```
x-token: <ROBO_TOKEN>
```

**Body:** nenhum campo obrigatório (pode ser `{}` ou vazio)

**Respostas:**
- `200 { "ok": true, "processados": 5, "erros": [], "duracao_segundos": 12.3 }`
- `200 { "ok": false, "processados": 2, "erros": ["...msg..."] }` — falhou no meio
- `401 { "ok": false, "error": "Token inválido ou ausente" }`
- `429 { "ok": false, "error": "Robô ocupado..." }` — chamada concorrente
- `500 { "ok": false, "error": "..." }` — falha não capturada

### `GET /health`
Sem autenticação. Retorna `{ "ok": true, "busy": false }`.
Usado pelo EasyPanel para health check.

## Sessão persistida

O arquivo `/data/sessao-dommus.json` guarda os cookies após o primeiro login.
Nas execuções seguintes, o robô reaproveita a sessão sem fazer login novamente.
Se a sessão expirar, o robô detecta e faz login automaticamente.

Screenshots de erros são salvos em `/data/prints/` para diagnóstico.

## Como o n8n chama este serviço

Nó **HTTP Request**:
- **Method:** `POST`
- **URL:** `http://dommus-bot:3000/mudar-status`
  - `dommus-bot` = nome do serviço no EasyPanel (rede Docker interna)
- **Headers:** `x-token: {{ $env.ROBO_TOKEN }}`
- **Body:** `{}` (ou sem body)

## Depuração local de seletores

Se um seletor falhar, edite `src/dommus.js` temporariamente:
1. Em `chromium.launch(...)` mude para `headless: false`
2. Adicione `await page.pause()` no ponto de interesse
3. Execute `node src/server.js` e dispare o endpoint
4. O browser abre visualmente e o inspetor do Playwright permite clicar nos elementos

## Deploy (resumo)

1. Push para repositório Git
2. EasyPanel → Add Service → App → conectar repo
3. Nome do serviço: `dommus-bot`
4. Variáveis de ambiente no painel
5. Volume: container path `/data` → persistente
6. Porta interna: `3000` (sem domínio público necessário)

## Teste com curl

```bash
curl -X POST http://localhost:3000/mudar-status \
  -H "x-token: SEU_ROBO_TOKEN"
```
