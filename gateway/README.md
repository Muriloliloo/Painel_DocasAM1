# Gateway intermediario do Painel_DocasAM1

Gateway HTTP somente leitura que separa o painel publico dos sistemas internos. O modo mock usa somente dados ficticios; o modo real permanece fechado ate a TI implementar o provider corporativo oficial.

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
$env:YMS_MODE = "disabled"
npm start
```

O gateway escuta apenas em `127.0.0.1` nesta etapa. Para consultar:

```text
GET http://localhost:8787/health
GET http://localhost:8787/ready
GET http://localhost:8787/snapshot?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&waves=1,2,3,4,5&timezone=America%2FSao_Paulo
GET http://localhost:8787/dispatch?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&wave=1&timezone=America%2FSao_Paulo
GET http://localhost:8787/customs?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&timezone=America%2FSao_Paulo
GET http://localhost:8787/yms?facilityId=SSP15&siteId=MLB&groupId=TESTE&cycle=AM1&waves=1,2,3,4,5&timezone=America%2FSao_Paulo
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

## Fonte YMS / BigQuery

`YMS_MODE` e opt-in e aceita:

- `disabled`: padrao; preserva exatamente o snapshot anterior com Dispatch + Aduana;
- `mock`: adiciona uma fonte YMS ficticia ao snapshot para testes locais e libera `GET /yms` para homologacao isolada;
- `provider`: exige um executor BigQuery aprovado e injetado no backend; sem ele, o gateway falha fechado com `YMS_PROVIDER_NOT_CONFIGURED`.

A integracao real nao contem credenciais, tokens ou chaves no repositorio. O provider real deve ser configurado pela infraestrutura autorizada.

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

`emptyConfirmed` somente fica `true` no cenario explicito `empty-confirmed`, depois de todas as fontes ativas responderem com sucesso e vazias. Falha ou timeout de qualquer fonte habilitada impede uma resposta combinada de sucesso.

Quando `YMS_MODE=mock` ou `provider`, o snapshot ganha `sources.yms` e o array `yms`. Com `YMS_MODE=disabled`, o contrato antigo permanece inalterado.

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

O contrato de autenticacao fica isolado em `src/auth/`. `AUTH_MODE` aceita `unconfigured` e `corporate`, mas selecionar `corporate` nao concede acesso: o stub em `src/auth/corporate-provider.js` continua falhando fechado com HTTP 503 e `AUTH_NOT_CONFIGURED` antes de qualquer chamada upstream.

Os adaptadores reais ja montam no servidor as URLs e queries permitidas para Dispatch e Aduana. O YMS usa um provider separado em `src/providers/yms-provider.js`, mantendo BigQuery isolado das duas fontes HTTP. O cliente em `src/http/upstream-client.js` aceita somente destinos da allowlist, usa GET, timeout, limite de resposta, JSON obrigatorio e redirects manuais. Nenhuma requisicao real e feita enquanto a autenticacao permanecer desconfigurada.

Quando o metodo oficial for aprovado, a TI devera implementar somente o provider indicado para entregar o contexto minimo ao cliente upstream. O segredo devera vir da infraestrutura segura ou de um secrets manager, nunca do frontend. Nao copie Cookie, Authorization, CSRF, token ou sessao do navegador. O frontend nunca deve receber credenciais corporativas.

Veja [docs/HANDOFF-TI.md](docs/HANDOFF-TI.md), [docs/API-CONTRACT.md](docs/API-CONTRACT.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) e [docs/AUTHORIZATION.md](docs/AUTHORIZATION.md).

## Testes

```powershell
npm test
npm run verify
npm run smoke:mock
```

`npm run verify` executa os checks sintaticos de todos os arquivos JavaScript e a suite completa. `npm run smoke:mock` inicia um servidor efemero em loopback, valida health, readiness e snapshot 3/1 e encerra o processo.

Para o preflight da futura configuracao corporativa, defina as variaveis de producao e execute `npm run preflight:corporate`. O comando inspeciona somente configuracao e estrutura do provider, sem obter autorizacao ou chamar servicos externos. Enquanto o provider for stub, encerra de forma controlada com `AUTH_NOT_CONFIGURED`.


## Homologacao em casa sem acesso corporativo

Com Node.js 20+ e o repositorio local, use:

```powershell
$env:GATEWAY_MODE = "mock"
$env:AUTH_MODE = "unconfigured"
$env:YMS_MODE = "mock"
$env:PANEL_ALLOWED_ORIGIN = "http://localhost:8000"
npm start
```

Depois consulte `/yms` ou `/snapshot`. O mock YMS inclui exemplos de:

- rota expedida;
- Aduana em andamento;
- carregamento;
- excecao terminal.

Isso permite desenvolver e validar o contrato do frontend fora da rede corporativa sem copiar credenciais, cookies ou tokens.
