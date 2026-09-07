# Gateway intermediario do Painel_DocasAM1

Gateway HTTP somente leitura que separa o painel publico dos sistemas internos. Nesta etapa, ele opera apenas com dados mock ficticios e entrega ao frontend somente campos explicitamente permitidos.

## Requisitos

- Node.js 20 ou superior.
- Nenhuma dependencia externa e nenhum `node_modules` necessario.

## Iniciar

No PowerShell, a partir desta pasta:

```powershell
$env:PORT = "8787"
$env:NODE_ENV = "development"
$env:PANEL_ALLOWED_ORIGIN = "http://localhost:8000"
$env:GATEWAY_MODE = "mock"
$env:AUTH_MODE = "unconfigured"
$env:MOCK_SCENARIO = "normal"
npm start
```

O gateway escuta apenas em `127.0.0.1` nesta etapa. Para consultar:

```text
GET http://localhost:8787/health
GET http://localhost:8787/ready
GET http://localhost:8787/snapshot?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&waves=1,2,3,4,5&timezone=America%2FSao_Paulo
GET http://localhost:8787/dispatch?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&wave=1&timezone=America%2FSao_Paulo
GET http://localhost:8787/customs?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&timezone=America%2FSao_Paulo
```

## Cenarios mock

Em `development` e `GATEWAY_MODE=mock`, acrescente `scenario` a query:

- `normal`
- `loading`
- `dispatched`
- `customs-in-progress`
- `customs-complete`
- `empty-unconfirmed`
- `empty-confirmed`
- `failure-dispatch`
- `failure-customs`
- `timeout`

A query de cenario e rejeitada fora de `development/mock`. Para testar o frontend sem mudar sua configuracao, selecione o mesmo cenario pela variavel `MOCK_SCENARIO` antes de iniciar o gateway.

## Contrato combinado

```json
{
  "snapshotComplete": true,
  "emptyConfirmed": false,
  "sources": {
    "dispatch": "ok",
    "aduana": "ok"
  },
  "operacional": [],
  "aduana": []
}
```

`emptyConfirmed` somente fica `true` no cenario explicito `empty-confirmed`, depois de as duas fontes mock responderem com sucesso e vazias. Falha ou timeout de qualquer fonte impede uma resposta combinada de sucesso.

## Seguranca

- CORS usa uma lista exata configurada em `PANEL_ALLOWED_ORIGIN`; nao usa curinga.
- Em producao, `PANEL_ALLOWED_ORIGIN` e obrigatorio; sem ele o processo falha fechado.
- Somente `GET` e `OPTIONS` sao aceitos.
- Headers de autenticacao, cookies e CSRF recebidos do cliente sao rejeitados.
- Queries desconhecidas ou valores operacionais fora das listas permitidas sao rejeitados.
- O request target tem limite de 2 KiB e a consulta aceita no maximo 10 ondas previamente autorizadas.
- Respostas usam `no-store`, tipo JSON, headers defensivos e limite de tamanho.
- Sanitizadores trabalham com listas positivas de campos.
- Erros nao incluem stack trace.
- Nao ha cookies, tokens, headers internos, credenciais ou dados pessoais reais.
- Hosts e caminhos upstream sao definidos exclusivamente no servidor e validados por allowlist.
- O cliente upstream aceita somente GET, nao segue redirects e limita timeout, tipo e tamanho da resposta.

## Health e readiness

`GET /health` continua respondendo enquanto o processo estiver ativo e informa apenas `gatewayMode` e `authMode`. `GET /ready` responde `ready=true` em mock. Em `real/unconfigured`, responde HTTP 503 com `ready=false`, sem revelar detalhes de autenticacao.

## Preparado para autenticacao corporativa

O contrato de autenticacao fica isolado em `src/auth/`. Atualmente, `AUTH_MODE` aceita somente `unconfigured`. Por isso, `GATEWAY_MODE=real` falha fechado com HTTP 503 e o codigo `AUTH_NOT_CONFIGURED` antes de qualquer chamada upstream.

Os adaptadores reais ja montam no servidor as URLs e queries permitidas para Dispatch e Aduana. O cliente em `src/http/upstream-client.js` aceita somente destinos da allowlist, usa GET, timeout, limite de resposta, JSON obrigatorio e redirects manuais. Nenhuma requisicao real e feita enquanto a autenticacao permanecer desconfigurada.

Quando o metodo oficial for aprovado, um provider autorizado podera entregar o contexto minimo ao cliente upstream. O segredo devera vir da infraestrutura segura ou de um secrets manager, nunca do frontend. Nao copie Cookie, Authorization, CSRF, token ou sessao do navegador. O frontend nunca deve receber credenciais corporativas.

Veja tambem [docs/AUTHORIZATION.md](docs/AUTHORIZATION.md).

## Testes

```powershell
npm test
```

Os testes cobrem a suite original G1-G17 e os cenarios A1-A15 da preparacao corporativa, incluindo fail-closed, allowlist, redacao, redirects, timeout, limite de resposta e compatibilidade mock.
