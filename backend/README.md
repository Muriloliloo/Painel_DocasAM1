# Backend local de referência

Este diretório contém um backend local, sem dependências externas, que demonstra o contrato seguro entre uma futura fonte operacional autorizada e o Painel de Docas. Ele não acessa sistemas internos, não implementa autenticação corporativa e não define hospedagem de produção.

## Estrutura

- `server.js`: servidor HTTP local, rotas, CORS, validação de contexto e respostas seguras.
- `start-local.js`: inicialização explícita e multiplataforma do modo de fixture local.
- `operational-service.js`: ponto de substituição futuro para uma fonte autorizada.
- `sanitize-operational-data.js`: allowlists e limites aplicados antes da resposta.
- `config.js`: leitura exclusiva de `PORT`, `ALLOWED_ORIGINS`, `BACKEND_MODE` e `USE_FIXTURE`.
- `fixtures/operational-snapshot.fixture.js`: dados totalmente fictícios para desenvolvimento e testes.

## Iniciar localmente

Requer uma versão atual do Node.js e não exige `npm install`.

1. Abra um terminal na pasta do projeto.
2. Execute:

```text
node backend/start-local.js
```

3. Acesse `http://127.0.0.1:8787/health` e confirme `{"status":"ok"}`.
4. Mantenha o terminal aberto enquanto usar a integração local.
5. Abra o painel. A integração local ainda utiliza somente a fixture fictícia.

O helper ativa explicitamente `BACKEND_MODE=local-fixture`. O servidor escuta somente em `127.0.0.1`, porta `8787`; nunca usa `0.0.0.0` ou um IP da rede local.

Rotas locais:

- `GET /health`
- `GET /operational-snapshot`
- `OPTIONS /health`
- `OPTIONS /operational-snapshot`

O endpoint operacional aceita somente `facilityId`, `cycle`, `date` e `wave`. Outros parâmetros são ignorados. Requisições POST, PUT, PATCH e DELETE recebem `405 Method Not Allowed`.

## Configuração permitida

- `PORT`: porta local, padrão `8787`.
- `ALLOWED_ORIGINS`: origens exatas separadas por vírgula.
- `BACKEND_MODE`: o único modo aceito nesta etapa é `local-fixture`.
- `USE_FIXTURE`: precisa estar ativo junto com o modo local; `start-local.js` faz isso explicitamente.

Sem o modo local explícito e a fixture ativa, o backend falha fechado e não escuta nenhuma porta. Não existe modo de produção nesta etapa. A forma recomendada e independente de shell é sempre `node backend/start-local.js`.

Para permitir a origem pública exata do GitHub Pages sem usar CORS curinga, informe-a explicitamente ao helper:

```text
node backend/start-local.js --allow-origin=https://muriloliloo.github.io
```

A origem é somente `https://muriloliloo.github.io`, sem caminho do repositório. O argumento pode ser repetido quando mais de uma origem exata for necessária. Origens inválidas e `*` são rejeitados. A fixture é exclusivamente local; nenhuma fonte autorizada real foi implementada.

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

O `index.html` carrega apenas o helper inerte `window.PainelIntegracaoLocal`. Para configurar manualmente o provider local no console do painel:

```js
PainelIntegracaoLocal.configure();
PainelIntegracaoFonte.refreshNow();
```

`configure()` não inicia a Fonte e não habilita a UI. A opção `targetAddressSpace: "loopback"` é usada somente para `localhost`/`127.0.0.1` quando o navegador declara suporte. Para desconectar e parar a Fonte:

```js
PainelIntegracaoLocal.disconnect();
```

O backend não inicia junto com o GitHub Pages e não deve ser tratado como implementação de produção. Plataforma, autenticação e acesso autorizado serão definidos apenas em etapa posterior.
