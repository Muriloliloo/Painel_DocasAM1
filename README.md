# Controle de Docas SSP15 - AM1

Painel web para controle de ondas, docas, rotas carregadas, rotas expedidas, justificativas e fechamento operacional.


## Arquivos Principais

- `index.html`: painel principal. No GitHub Pages precisa ter esse nome.
- `ondas-dados.js`: dados iniciais do painel.
- `assets/logo-dhl.png`: logo DHL.
- `assets/logo-mercado-livre.png`: logo Mercado Livre.
- `LEIA-ME-CONTROLE-ONDAS.txt`: instrucoes de uso operacional.

## Importante

Nesta versao, os dados ficam salvos no navegador de cada computador. Ou seja, o GitHub Pages publica o painel, mas ainda nao sincroniza os dados entre maquinas.

Para ter varios computadores interligados ao vivo, a proxima etapa e conectar o painel a uma base em tempo real, como Firebase.

## Uso

1. Abra o link do GitHub Pages.
2. Clique em **Editar dados**.
3. Cole a **Extracao** com onda, rota, doca e transportadora.
4. Cole a **Base** com as rotas que subiram QR ou com status `Expedida`.
5. Acompanhe o painel, justificativas, resumo por onda e fechamento.

## Perfis Futuramente

Na versao com Firebase, o painel pode ter:

- Administrador: edita dados, base, justificativas e fechamento.
- Leitor: apenas visualiza o painel ao vivo.

