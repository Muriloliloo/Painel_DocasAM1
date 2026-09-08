# Implantacao do gateway

O gateway nao deve ser exposto publicamente sem as protecoes da infraestrutura. O endereco de producao deve ser definido pela TI; este projeto nao presume nem inventa esse endereco.

## Infraestrutura minima

- servico Node.js 20 ou superior;
- servidor interno ou ambiente de execucao corporativo aprovado;
- reverse proxy com HTTPS;
- firewall e regras de rede restritas;
- secrets manager ou identidade de workload para a autenticacao oficial;
- supervisao do processo, logs sanitizados e reinicio controlado.

O navegador que executa o painel precisa conseguir alcancar o endereco HTTPS do gateway. O gateway, por sua vez, deve ter acesso somente leitura aos destinos operacionais aprovados.

## CORS

`PANEL_ALLOWED_ORIGIN` deve conter a origem exata do painel, sem caminho e sem curinga. Se o painel continuar no GitHub Pages, configure a origem HTTPS exata correspondente ao site publicado. Nao use `Access-Control-Allow-Origin: *`.

## Configuracao de producao

Antes da implantacao, valide pelo menos:

```text
NODE_ENV=production
GATEWAY_MODE=real
AUTH_MODE=corporate
PANEL_ALLOWED_ORIGIN=<origem HTTPS exata do painel>
```

Tambem devem ser revisadas as allowlists de facility, site, ciclo e ondas. Os hosts e caminhos upstream permanecem fixos e validados no servidor. Segredos nao devem ser adicionados ao `.env.example` nem ao objeto de configuracao do gateway.

Execute `npm run verify` e `npm run preflight:corporate` antes de subir o servico. O preflight e estritamente estrutural: nao obtem autorizacao, nao le segredos e nao chama servicos externos. Enquanto o provider corporativo for stub, ele encerra com `AUTH_NOT_CONFIGURED`.

## Sinais operacionais

- `/health` confirma que o processo esta ativo, mas nao afirma que a autenticacao funciona.
- `/ready` somente responde HTTP 200 e `ready: true` quando o modo mock esta ativo ou quando o provider real entrega um contexto valido.
- `/snapshot` somente deve ser liberado ao painel depois que readiness, sanitizacao e CORS forem validados.
