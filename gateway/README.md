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
$env:MOCK_SCENARIO = "normal"
npm start
```

O gateway escuta apenas em `127.0.0.1` nesta etapa. Para consultar:

```text
GET http://localhost:8787/health
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

## Adaptador real

As interfaces `fetchDispatch(...)` e `fetchCustoms(...)` ja isolam a aquisicao das fontes. `GATEWAY_MODE=real` falha com HTTP 503 e a mensagem segura `Real internal authentication adapter is not configured.` Ate um metodo corporativo ser aprovado, nao existe captura de sessao, leitura de cookies ou configuracao de segredo no repositorio.

## Testes

```powershell
npm test
```

Os testes cobrem G1-G17, incluindo contrato, atomicidade, timeout, CORS, metodos, validacao, sanitizacao e ausencia de stack em producao.
