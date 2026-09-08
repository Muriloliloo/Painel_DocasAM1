# Entrega do gateway para a TI

Este gateway ja esta funcional. A logica do painel, Dispatch, Aduana, sanitizacao e polling ja esta implementada e testada.

A responsabilidade da TI e conectar o metodo oficial de autenticacao corporativa.

## Arquivo que a TI deve alterar

`gateway/src/auth/corporate-provider.js`

Esse e o unico ponto de codigo da autenticacao dentro da aplicacao. A TI deve obter a documentacao oficial, implementar `getAuthContext()` e retornar o contrato:

```js
{
  headers: { /* headers definidos pelo metodo oficial */ },
  dispatcher: /* opcional, quando o metodo oficial exigir */
}
```

O retorno passa obrigatoriamente por `validatedAuthContext()`. Enquanto esse arquivo permanecer como stub, `GATEWAY_MODE=real` com `AUTH_MODE=corporate` continua respondendo `AUTH_NOT_CONFIGURED`, sem chamar as fontes operacionais.

`inspectConfiguration()` e uma verificacao estrutural sem efeitos. Ela deve mudar para `configured: true` somente quando a implementacao e o provisionamento oficial estiverem prontos; nunca deve buscar token, segredo ou certificado.

Dependendo do metodo oficial, a TI tambem pode precisar provisionar secrets manager, variavel segura, certificado, identidade de workload, biblioteca oficialmente aprovada, reverse proxy e regras de rede/firewall. Essas necessidades de infraestrutura nao mudam o ponto de integracao da aplicacao. Nunca grave segredo no Git, no objeto publico de configuracao ou no frontend.

## Sequencia de ativacao

1. Obter a documentacao oficial, implementar `getAuthContext()` no arquivo indicado e atualizar sua inspecao estrutural quando estiver pronto.
2. Configurar os segredos somente na infraestrutura e definir `GATEWAY_MODE=real` e `AUTH_MODE=corporate`.
3. Executar `npm run verify` e `npm run preflight:corporate`.
4. Testar `/health`, `/ready`, Dispatch, Aduana e `/snapshot`, conferindo que a resposta esta sanitizada.
5. Somente depois habilitar a fonte automatica no frontend e validar polling e fallback manual.

## Configuracao publica do frontend

O painel aceita `window.PAINEL_AUTOMATION_CONFIG` no carregamento ou uma chamada explicita a `configureAutomaticSource(config)`. Os campos disponiveis sao:

- `gatewayBaseUrl`: endereco HTTPS publico do gateway, sem credenciais;
- `mode`: `combined` para `/snapshot` ou `split` para chamadas separadas;
- `snapshotPath`, `dispatchPath`, `customsPath`: caminhos relativos opcionais;
- `facilityId`, `siteId`, `groupId`, `cycle`, `timezone` e `waves`: contexto operacional permitido;
- `timeoutMs` e `intervalMs`: limites do cliente;
- `enabled`: somente `true` inicia o polling automatico.

O endereco do gateway e configuracao publica. Nenhum cookie, header de autorizacao, token, senha ou segredo pode existir nessa configuracao.

## Nao alterar

Salvo se houver mudanca comprovada no contrato das APIs, nao alterar:

- `index.html`;
- sanitizadores;
- adaptadores;
- servico de snapshot;
- polling;
- Firebase;
- merge manual/automatico.

## Checklist de aceitacao

- [ ] metodo oficial identificado
- [ ] autorizacao apenas leitura
- [ ] segredo fora do Git
- [ ] `corporate-provider` implementado
- [ ] `npm run verify` aprovado
- [ ] `/health` = HTTP 200
- [ ] `/ready` = `ready: true`
- [ ] Dispatch responde
- [ ] Aduana responde
- [ ] snapshot combinado responde
- [ ] nenhum PII indevido no frontend
- [ ] polling testado
- [ ] fallback manual testado
- [ ] logs sem credencial
- [ ] HTTPS em producao
- [ ] CORS limitado ao painel
