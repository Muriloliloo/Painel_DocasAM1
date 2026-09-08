# Contrato das APIs operacionais

Este documento registra apenas o contrato conhecido e os campos necessarios ao painel. A autenticacao oficial continua fora deste documento e do frontend.

## Dispatch

```text
GET https://envios.adminml.com/logistics/last-mile/monitoring/frm-provider/api/dispatch
```

Parametros:

- `facilityId`
- `groupId`
- `siteId`
- `wave`

Campos utilizados depois da sanitizacao:

- `route_name`
- `route_id`
- `process`
- `dock_number`
- `start_time`
- `total_elapsed_time`

Processos ja conhecidos:

- `waiting_customs`
- `customs_in_progress`
- `loading_packages`
- `dispatched`

Na regra atual do painel, `dispatched` significa que a saida/expedicao foi concluida.

## Aduana

```text
GET https://envios.adminml.com/logistics/audit/api/audits/search
```

Parametros:

- `auditType=driver`
- `timezone=America/Sao_Paulo`

Campos publicos necessarios depois da sanitizacao:

- `route_name`
- `route_id`
- `status`
- `process`
- `operator_name`
- `audit_time`
- `aduanaUnidades`
- `aduanaBipadas`
- `driver_name`
- `carrier_name`
- `plate`

`route_id` e a chave preferencial de associacao entre as fontes.

No payload bruto conhecido da Aduana, o adapter normaliza `driver.route_id` para `route_id` e `driver.cluster_id` para `route_name`. O formato plano permanece aceito por compatibilidade. IDs internos presentes em `driver`, como `driver_id`, `vehicle_id` e `carrier_id`, e `operator_id` nao fazem parte da resposta publica.

## Exclusoes obrigatorias

O gateway nao deve entregar ao frontend CPF, documento, e-mail, telefone, tokens, cookies ou headers internos. Corpos brutos das fontes nunca devem contornar os sanitizadores por allowlist.
