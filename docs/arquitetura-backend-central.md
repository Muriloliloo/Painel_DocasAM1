# Arquitetura do backend central multiusuário

Esta arquitetura prepara um único estado operacional compartilhado por todos os usuários do Painel de Docas. Ela não conecta uma fonte real, não define autenticação corporativa e não escolhe hospedagem.

```text
Fonte operacional autorizada futura
                ↓
          Snapshot Manager
                ↓
    Snapshot sanitizado em memória
                ↓
          Backend central
                ↓
    Usuário 1 · Usuário 2 · Usuário N
```

## Por que existe um Snapshot Manager

As requisições dos usuários não devem consultar a fonte operacional. Vinte usuários simultâneos recebem vinte cópias HTTP do mesmo snapshot, mas geram zero cargas adicionais na fonte. Somente o motor periódico do Snapshot Manager executa o loader injetado.

Esse desenho reduz carga, evita resultados divergentes entre usuários e mantém a aquisição dos dados separada do contrato HTTP público.

## Ciclo de atualização

`createSnapshotManager(options)` recebe obrigatoriamente um `loader(context)` injetado. O manager:

1. executa uma atualização imediatamente ao iniciar;
2. valida que o loader retornou `waves`, `dispatch` e `audits` como arrays;
3. aplica `sanitizeOperationalData()` antes de armazenar qualquer conteúdo;
4. troca o snapshot completo de forma atômica;
5. programa o próximo ciclo;
6. reutiliza a mesma Promise quando `refreshNow()` é chamado concorrentemente.

O intervalo padrão é `30000` ms. `SNAPSHOT_REFRESH_MS` aceita valores entre `10000` e `300000` ms para impedir polling excessivo.

## Readiness e falhas

O processo começa com `ready: false`. Somente a primeira carga válida muda o estado para `ready: true`.

- `GET /health` responde `200 {"status":"ok"}` sem revelar estado interno.
- `GET /ready` responde `503 {"status":"not_ready"}` antes do primeiro snapshot válido.
- `GET /ready` responde `200 {"status":"ready"}` depois da primeira carga válida.
- `GET /operational-snapshot` responde `503` enquanto o manager não estiver pronto.

Se uma atualização falhar depois de um sucesso, o último snapshot válido permanece disponível. A falha aumenta apenas contadores e horários seguros; erro bruto, stack e conteúdo do snapshot não fazem parte de `getStatus()`. O motor continua tentando nos ciclos seguintes.

## Troca de contexto

O contexto central aceita somente:

- `facilityId`;
- `cycle`;
- `date`;
- `wave`.

`setContext()` incrementa a geração lógica, remove o snapshot pertencente ao contexto anterior e volta a `ready: false`. Uma resposta pendente da geração antiga é descartada mesmo que termine depois da troca. O novo contexto só fica pronto após sua própria primeira carga válida.

Nenhum ciclo é inventado automaticamente.

## Semântica do snapshot

Cada payload futuro é tratado como um snapshot completo. A troca no cache central é integral; clientes não recebem mistura entre Snapshot A e Snapshot B.

Não há regra de remoção de rota baseada em atualização parcial nesta etapa. Essa decisão exige confirmação semântica da futura fonte autorizada antes de qualquer implementação.

## Contrato público

O endpoint continua compatível com o frontend:

```json
{
  "waves": [],
  "dispatch": [],
  "audits": []
}
```

Metadados internos do manager não são adicionados à raiz pública. `Cache-Control: no-store` permanece ativo; o snapshot em memória é o cache da aplicação, e não o navegador ou uma CDN.

## Separação do modo local

Somente o modo `local-fixture` habilita a fixture fictícia, e `node backend/start-local.js` continua sendo seu entrypoint recomendado. O modo `central` força `useFixture: false`, exige manager ou loader injetado e nunca recorre ao fixture local.

`node backend/start-central.js` falha fechado nesta etapa porque nenhuma fonte autorizada foi configurada. Ele não abre porta e não inicia servidor externo.

## Segurança e escopo

- CORS aceita apenas origens exatas configuradas; curinga é proibido.
- Nenhuma resposta bruta é armazenada no cache público.
- Campos extras, PII desnecessária, segredos e credenciais são removidos antes do cache.
- O frontend não recebe erro bruto, configuração, headers ou detalhes de infraestrutura.
- Nenhum endpoint corporativo, sessão de navegador ou mecanismo de login foi implementado.
- Nenhuma plataforma de hospedagem foi selecionada.

A próxima etapa autorizada deverá decidir ambiente, HTTPS, autenticação e loader real sem alterar o princípio de um único snapshot central compartilhado.
