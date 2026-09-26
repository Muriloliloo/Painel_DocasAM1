# YMS / BigQuery — contrato da fonte de lifecycle

## Objetivo

Esta fonte futura complementa o gateway do Painel Docas AM1 com a linha do tempo física da rota/veículo. Ela não substitui Dispatch ou Aduana nesta etapa e ainda não está ligada ao runtime.

Arquivo SQL de referência:

`gateway/sql/yms-route-lifecycle-v2.sql`

## Arquitetura pretendida

```text
Dispatch ─┐
Aduana ───┼─> Gateway -> snapshot consolidado -> Painel
YMS/BQ ───┘
```

Responsabilidades previstas:

- **Dispatch:** status operacional atual da rota.
- **Aduana:** auditoria, status de conclusão e quantidade auditada.
- **YMS/BigQuery:** entrada na base, doca, início de carregamento, dock-out, gate-out, estacionamento, reconciliação e histórico.

Nenhuma credencial BigQuery, service account, token ou chave deve existir no frontend.

## Granularidade

A Query V2 foi desenhada para entregar **uma linha por `process_id`**.

Validação obrigatória antes da integração:

```sql
SELECT COUNT(*) AS total_rows,
       COUNT(DISTINCT process_id) AS distinct_processes
FROM final_result;
```

Os dois valores devem ser equivalentes para a janela validada. A query também contém, ao final, um diagnóstico comentado para listar `process_id` duplicado.

Não usar `SELECT DISTINCT` para esconder duplicidade sem investigar a origem.

## Chave de associação

`route_id` oficial ainda **não foi identificado com segurança nas tabelas usadas por esta query**.

Status atual:

```text
route_id_status = não identificado nesta query
```

Até confirmação, a chave técnica de rastreabilidade é:

```text
operation_date + cycle_name + wave_number + route_name + process_id
```

`process_id` e `journey_id` são campos internos do backend. Não são destinados ao navegador.

## Campos de saída

Identificação operacional:

- `facility_id`
- `operation_date`
- `cycle_name`
- `wave_number`
- `process_id`
- `journey_id`
- `route_name`
- `carrier_id`
- `carrier_name`
- `plate`

Localização:

- `loading_zone_name`
- `parking_area_name`

Linha do tempo:

- `yms_check_in_at`
- `dock_in_at`
- `loading_started_at`
- `dock_out_at`
- `gate_out_at`
- `customs_queue_at`
- `customs_started_at`
- `customs_last_activity_at`

Último estado YMS conhecido:

- `latest_event_name`
- `latest_status`
- `latest_purpose_status`
- `latest_event_at`

## Semântica dos marcos

### Entrada YMS

`yms_check_in_at` usa o primeiro evento compatível com:

- `check-in-without-prior-assignment`; ou
- `updated` + `WAITING_LOADING_ZONE`, respeitando a data operacional local.

### Entrada em doca

`dock_in_at` usa o primeiro evento com:

`STATUS = 'UN-LOAD_STARTED'`

A grafia foi preservada exatamente como na fonte já conhecida e precisa ser validada no BigQuery real.

### Início de carregamento

`loading_started_at`:

- `EVENT_NAME = 'update_purpose_status'`
- `PURPOSE_STATUS = 'LOADING_PACKAGES_STARTED'`

### Saída de doca

`dock_out_at`:

`EVENT_NAME = 'check-out'`

### Saída física

`gate_out_at`:

`EVENT_NAME = 'gate-out'`

Esse campo é candidato forte para confirmação física de saída e para o cálculo futuro do OOT.

## Aduana no YMS

A Query V2 **não chama o último `DOING_AUDIT` de fim da Aduana**.

Campos seguros:

- `customs_queue_at`: primeiro `WAITING_FOR_AUDIT`;
- `customs_started_at`: primeiro `DOING_AUDIT`;
- `customs_last_activity_at`: último `DOING_AUDIT`.

A API Aduana atual continua sendo a autoridade para conclusão da auditoria e quantidade auditada até existir um evento de conclusão explicitamente confirmado no YMS.

## Associação de rota

A precedência usada é:

1. BT_CYCLE_ROUTE, com facility + data + ciclo + onda + placa;
2. planificação YMS mais recente aplicável à operação/data;
3. `CLUSTER_ROUTE_NAME` do processo.

A Query V2 não usa `MIN(ROUTE_NAME)` atravessando vários dias.

Em BT_CYCLE_ROUTE, se houver mais de um nome de rota para a mesma chave diária, o match é tratado como ambíguo e não é escolhido alfabeticamente.

## Planificação

A planificação é associada por:

- placa;
- facility;
- onda;
- data aplicável ao processo.

A janela aceita D-1 até o dia operacional e escolhe o registro com `MODIFICATION_DATE` mais recente.

Isso evita usar `MIN(ROUTE)` em uma janela histórica extensa.

## Transportadora

`carrier_id` e `carrier_name` são campos separados.

Nunca colocar ID dentro de `carrier_name`. Se o lookup do nome não existir, `carrier_name` deve permanecer nulo/vazio e o ID continua disponível apenas como identificador técnico.

## Timezone

Timezone operacional:

`America/Sao_Paulo`

Validação real em 26/09/2026 confirmou que `BT_YMS_LOADING_ZONES_EVENTS.CREATED_AT` é `DATETIME`, não `TIMESTAMP`.

Por isso, a Query V2 usa `DATE(CREATED_AT)` diretamente. `DATETIME` não carrega informação de fuso; a consulta não deve aplicar `DATE(datetime, timezone)`. A semântica operacional local ainda deve ser confirmada com exemplos próximos da meia-noite.

## Janela de eventos

A consulta de eventos cobre conceitualmente:

`D-2 até D+1`

Isso evita perder um `gate-out` ou outro evento que ocorra após meia-noite em relação ao dia operacional.

## Latência a validar

Antes de usar BigQuery/YMS como fonte de tempo real, medir:

1. horário real do evento;
2. horário em que o mesmo evento passa a ser consultável no BigQuery;
3. diferença entre os dois.

A classificação da fonte só deve ocorrer após esse teste:

- **tempo real / operacional**, se a latência for compatível com monitoramento;
- **reconciliação / histórico / fechamento**, se houver atraso significativo.

Não assumir que BigQuery é realtime.

## Uso futuro para OOT

Regra conceitual futura:

```text
gate_out_at <= deadline da onda
=> saída dentro do prazo

gate_out_at > deadline da onda
=> saída após o prazo

deadline passou + gate_out_at IS NULL
=> saída ainda não confirmada por esta fonte
```

O cálculo OOT ainda não está implementado.

## Segurança

Não expor no contrato público do navegador:

- `driver_id`;
- IDs internos de motorista/operador/veículo;
- CPF;
- documento;
- e-mail;
- telefone;
- tokens;
- cookies;
- headers internos;
- credenciais BigQuery.

Placa deve continuar sob revisão do contrato do gateway antes de exposição pública.

## Pontos a confirmar no BigQuery real

1. semântica local de `BT_YMS_LOADING_ZONES_EVENTS.CREATED_AT` próximo da meia-noite (o tipo `DATETIME` já foi confirmado);
2. grafia e semântica de `UN-LOAD_STARTED`;
3. existência de um evento/status explícito de conclusão da Aduana;
4. presença de um `route_id` oficial em alguma das tabelas já autorizadas;
5. unicidade prática de `PROCESS_ID`;
6. unicidade de `JOURNEY_ID` no planner;
7. latência de ingestão dos eventos;
8. se D-1 é suficiente para planificação de todos os casos AM1;
9. se o `gate-out` observado corresponde de forma estável à saída usada no OOT.

## Validação real de 02/09/2026

A Query V2 foi executada com sucesso no BigQuery corporativo para SSP15 em 02/09/2026.

Resultados observados no retorno completo:

- 232 processos no total considerando todos os ciclos retornados pela versão anterior do teste;
- 232 `process_id` distintos, sem duplicidade;
- 124 processos do ciclo AM1;
- AM1 distribuído nas ondas 1 a 5;
- 98 processos AM1 com `gate_out_at`;
- estados finais AM1 observados: `gate-out`, `killed`, `canceled` e `skipped`;
- 24 linhas AM1 retornaram `route_name = 'AM1'`, valor genérico e inadequado como identificador de rota;
- 7 linhas AM1 ficaram sem rota e sem placa, todas associadas a processos cancelados no conjunto analisado.

A partir dessa validação, a Query V2 passou a:

- filtrar explicitamente `cycle_filter = 'AM1'`;
- não tratar o nome genérico do ciclo (`AM1`) como rota válida;
- retornar `route_source`, `route_resolution_status`, `route_candidate_count` e `plan_candidate_count` para diagnóstico;
- manter rota nula quando não houver evidência suficiente para uma rota concreta.

O caso de resolução de rota genérica deve ser investigado com:

`gateway/sql/diagnostics/yms-route-resolution-am1.sql`

antes de integrar a fonte ao runtime.

## Estado de integração

Nesta etapa não existem:

- adapter YMS no gateway;
- endpoint YMS;
- sanitizer YMS;
- chamada BigQuery em runtime;
- credencial BigQuery;
- alteração em `server.js`, `snapshot.js` ou `index.html`.

A próxima validação deve executar a Query V2 para **um único dia de AM1** e confrontar rotas reais, placa, onda e timestamps antes de qualquer integração automática.
