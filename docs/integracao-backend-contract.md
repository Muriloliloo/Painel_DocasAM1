# Contrato do backend de integração operacional

Este documento define a interface esperada entre um futuro backend intermediário aprovado e o Painel de Docas. Ele não implementa o backend, não configura um endereço real e não autoriza acesso direto do navegador a sistemas internos.

## Arquitetura e responsabilidades

O backend deverá executar em ambiente autorizado, consultar as fontes internas somente por mecanismos aprovados, manter toda autenticação fora do frontend, sanitizar os dados e retornar apenas o conteúdo operacional necessário.

O navegador consumirá exclusivamente o JSON sanitizado desse backend por meio de `integracao-provider-http.js`. Cookies, sessões, tokens, credenciais e cabeçalhos internos nunca devem chegar ao painel.

## Requisição

```http
GET /operational-snapshot
Accept: application/json
```

Parâmetros opcionais permitidos:

- `facilityId`
- `cycle`
- `date`
- `wave`

O endpoint de produção deverá usar HTTPS. HTTP é reservado a testes locais em `localhost` ou `127.0.0.1`. A URL não poderá conter usuário, senha nem parâmetros de autenticação ou segredo.

## Resposta

O backend deverá responder com `Content-Type: application/json` e esta raiz exata:

```json
{
  "waves": [],
  "dispatch": [],
  "audits": []
}
```

As três listas podem estar vazias. Metadados internos, depuração, credenciais e campos adicionais na raiz não serão repassados pelo provider ao motor.

## Ondas

Campos normalizados que podem ser retornados:

- `waveId`
- `waveName`
- `startTime`
- `endTime`
- `plannedRoutes`
- `dispatchedRoutes`
- `pendingRoutes`
- `hasAssociatedRoutes`

Também são aceitos os nomes originais já tratados pelo normalizador, como `wave_id`, `wave_name`, `start_time`, `end_time`, `planned_routes`, `dispatched_routes`, `pending_routes` e `has_associated_routes`.

## Dispatch

Campos operacionais necessários:

- `route_id`
- `route_name`
- `dock_number`
- `process`
- `start_time`
- `total_elapsed_time`

O backend poderá omitir qualquer dado que não seja necessário à exibição e consolidação operacional.

## Auditorias

Campos de auditoria permitidos conforme a necessidade operacional:

- `id`
- `facility_id`
- `status`
- `audit_type`
- `operator_id`
- `created_at`
- `started_at`
- `finished_at`
- `leftover_count`

Estruturas aninhadas permitidas:

- `driver`: `route_id`, `driver_id`, `vehicle_id`, `carrier_id`, `cluster_id`
- `operator`: `name`, `last_name`
- `transporter`: `first_name`, `last_name`
- `vehicle`: `license_plate`
- `carrier`: `display_name`
- `units`: `entity_id`, `status`

Esses campos são um limite permitido, não uma exigência para retornar todos eles. O backend deverá aplicar minimização e enviar somente o necessário ao painel.

## Dados proibidos no frontend

O backend não deverá retornar ao painel ou ao GitHub Pages:

- CPF, documento ou outro identificador pessoal desnecessário;
- telefone, e-mail, endereço ou dados de contato;
- senha, segredo, token ou credencial;
- Cookie, sessão ou cabeçalho interno;
- atributos corporativos sem necessidade operacional;
- corpo bruto de erro, stack remota ou detalhes de infraestrutura.

## Erros seguros

- Respostas HTTP não bem-sucedidas devem expor ao frontend somente o código HTTP.
- Falhas de rede não devem incluir URL, headers ou detalhes nativos potencialmente sensíveis.
- Timeout não deve revelar o endpoint consultado.
- Conteúdo não JSON ou payload fora do contrato deve ser rejeitado sem repassar corpo HTML ou dados de depuração.

## Fora do escopo

Este contrato não define plataforma de hospedagem, proxy, função serverless, credencial, mecanismo de sessão ou implementação do backend. Essas decisões dependem de aprovação específica em etapa posterior.
