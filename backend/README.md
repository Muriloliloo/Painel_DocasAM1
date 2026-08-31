# Backend local de referência

Este diretório contém um backend local, sem dependências externas, que demonstra o contrato seguro entre uma futura fonte operacional autorizada e o Painel de Docas. Ele não acessa sistemas internos, não implementa autenticação corporativa e não define hospedagem de produção.

## Estrutura

- `server.js`: servidor HTTP local, rotas, CORS, validação de contexto e respostas seguras.
- `operational-service.js`: ponto de substituição futuro para uma fonte autorizada.
- `sanitize-operational-data.js`: allowlists e limites aplicados antes da resposta.
- `config.js`: leitura exclusiva de `PORT`, `ALLOWED_ORIGINS` e `USE_FIXTURE`.
- `fixtures/operational-snapshot.fixture.js`: dados totalmente fictícios para desenvolvimento e testes.

## Iniciar localmente

Requer uma versão atual do Node.js e não exige `npm install`.

```text
node backend/server.js
```

Por padrão, o servidor escuta somente em `127.0.0.1`, porta `8787`, com a fixture habilitada.

Rotas locais:

- `GET /health`
- `GET /operational-snapshot`
- `OPTIONS /health`
- `OPTIONS /operational-snapshot`

O endpoint operacional aceita somente `facilityId`, `cycle`, `date` e `wave`. Outros parâmetros são ignorados. Requisições POST, PUT, PATCH e DELETE recebem `405 Method Not Allowed`.

## Configuração permitida

- `PORT`: porta local, padrão `8787`.
- `ALLOWED_ORIGINS`: origens exatas separadas por vírgula.
- `USE_FIXTURE`: `true` ou `false`; o padrão local é `true`.

Exemplo local em PowerShell:

```powershell
$env:PORT = "8787"
$env:ALLOWED_ORIGINS = "http://localhost:8000,http://127.0.0.1:8000"
$env:USE_FIXTURE = "true"
node backend/server.js
```

A fixture é exclusivamente local. Com `USE_FIXTURE=false`, o serviço retorna erro seguro porque nenhuma fonte autorizada foi implementada nesta etapa.

## Política CORS

`Access-Control-Allow-Origin` só é enviado quando o header `Origin` corresponde exatamente a uma entrada de `ALLOWED_ORIGINS`. O caractere curinga não é aceito. Requisições sem uma origem autorizada podem receber a resposta HTTP, mas o navegador não recebe permissão CORS.

As origens locais padrão são:

- `http://localhost:8000`
- `http://127.0.0.1:8000`

## Validação e limites

Limites de contexto:

- `facilityId`: 64 caracteres;
- `cycle`: 64 caracteres;
- `date`: exatamente `YYYY-MM-DD` e uma data válida;
- `wave`: 32 caracteres.

Caracteres de controle e valores excessivamente grandes são rejeitados. Os valores não são usados como caminho, comando, SQL ou código dinâmico.

Limites do snapshot sanitizado:

- 500 ondas;
- 10.000 registros de dispatch;
- 10.000 auditorias;
- 5.000 unidades por auditoria;
- 500 caracteres por campo textual.

Campos fora das allowlists são descartados. A resposta raiz contém somente `waves`, `dispatch` e `audits`.

## Segurança

- `Cache-Control: no-store` é enviado em todas as respostas.
- O JSON usa `Content-Type: application/json; charset=utf-8`.
- Cada requisição recebe um `X-Request-Id` aleatório e não sensível.
- Erros não incluem stack, mensagem bruta da fonte, URLs, headers ou configuração.
- Nenhuma credencial, sessão ou autenticação é criada pelo backend.
- Não há banco de dados, proxy externo, SDK de nuvem ou acesso de rede operacional.

## Uso com o provider do painel

Durante testes locais, o endpoint pode ser configurado explicitamente em runtime no provider HTTP. Essa configuração não existe no carregamento normal do painel e não inicia polling automaticamente.

O backend não inicia junto com o GitHub Pages e não deve ser tratado como implementação de produção. Plataforma, autenticação e acesso autorizado serão definidos apenas em etapa posterior.
