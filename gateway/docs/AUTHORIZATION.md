# Arquitetura de autorizacao corporativa

Este documento descreve somente a fronteira preparada para uma futura integracao oficialmente autorizada. Nenhum metodo de autenticacao corporativa esta implementado.

## Estado atual

- `AUTH_MODE=unconfigured` e o unico modo aceito.
- `GATEWAY_MODE=mock` continua operando apenas com fixtures ficticias.
- `GATEWAY_MODE=real` inicia o servidor, mas toda consulta operacional falha com HTTP 503 e `AUTH_NOT_CONFIGURED`.
- `/health` permanece disponivel e `/ready` informa que o modo real ainda nao esta pronto.

## Separacao de responsabilidades

```text
request validado pelo gateway
  -> provider em src/auth/
  -> contexto minimo de autorizacao
  -> cliente GET em src/http/upstream-client.js
  -> adaptador Dispatch ou Aduana
  -> sanitizador por allowlist
  -> resposta publica
```

Os adaptadores nao conhecem onde um segredo futuro sera armazenado nem como sera obtido. Eles recebem somente o contexto abstrato produzido pelo provider e o repassam ao cliente upstream. O frontend nao participa da autenticacao corporativa e nao escolhe host ou caminho upstream.

## Opcoes futuras ainda nao implementadas

Depois da confirmacao oficial, um provider separado podera ser avaliado para um dos seguintes mecanismos:

- bearer emitido por servico autorizado;
- API key gerenciada pela infraestrutura;
- OAuth client credentials;
- mTLS com material mantido fora do repositorio.

Essas opcoes sao apenas possibilidades arquiteturais. Nenhuma delas deve ser ativada antes de o metodo, o ciclo de vida e o armazenamento oficial serem definidos.

## Regras permanentes

- Nunca copiar credenciais do navegador, DevTools ou perfil do usuario.
- Nunca ler cookies, `localStorage`, `sessionStorage` ou arquivos de sessao.
- Nunca registrar headers completos ou valores de autenticacao.
- Segredos futuros devem vir de infraestrutura segura ou secrets manager.
- Destinos upstream permanecem definidos no servidor e limitados por allowlist.
- Toda resposta passa pelos sanitizadores antes de chegar ao frontend.
- Erros publicos nao incluem stack, corpo bruto upstream, headers ou URLs sensiveis.
