# Firestore: histórico individual privado da Aduana AM1

## Por que é necessário
O painel publica indicadores consolidados em `paineis/aduana-am1-AAAA-MM-DD`, mas os **Shipment IDs individuais** devem ficar na coleção separada `aduanaHistoricoPrivadoAM1`.

A interface controla a visualização por perfil, mas **somente as regras do Firestore protegem contra leituras diretas por terceiros**. Não usar `allow read: if true` para esta coleção.

## Regra a ADICIONAR no bloco `match /databases/{database}/documents` das regras existentes

```javascript
match /aduanaHistoricoPrivadoAM1/{dataOperacional} {
  // Somente os usuários administradores autenticados.
  allow get, list: if request.auth != null
    && request.auth.token.email in [
      "murilo.costajesus@gmail.com",
      "ext_mudacost@mercadolivre.com"
    ];
  allow create, update, delete: if request.auth != null
    && request.auth.token.email in [
      "murilo.costajesus@gmail.com",
      "ext_mudacost@mercadolivre.com"
    ];
}
```

Essa regra é um complemento: **não substitua** as regras atuais do painel, de autenticação, de usuários ou outras coleções. Atualize a lista de administradores conforme a política de acesso vigente. Se existir uma regra genérica permissiva (por exemplo `match /{document=**} { allow read: if true; }`), é necessário removê-la/restringi-la: as permissões de regras sobrepostas são cumulativas.

## Implantação
1. Abra [Firebase Console](https://console.firebase.google.com/) no projeto `docas-am1-ssp15`.
2. Vá a **Firestore Database → Rules**.
3. Insira o bloco acima dentro do `match /databases/{database}/documents` existente, mantendo o restante das regras.
4. Publique as regras.
5. Em **Rules Playground**, teste que um **leitor não autenticado** e um **usuário comum** não conseguem ler `aduanaHistoricoPrivadoAM1/2026-10-26`, enquanto os administradores conseguem ler e gravar.
6. Somente após essa verificação, use **Salvar fechamento no histórico**.

**Importante:** adicionar este arquivo ao GitHub não publica automaticamente regras no Firebase. Verifique as regras de outras coleções (inclusive o documento operacional `paineis/docas-am1`), que podem conter identificadores nas bases ativas.

## Retenção
A interface só consulta até 30 dias. A aplicação tenta remover documentos expirados das duas coleções durante salvamentos posteriores. Para garantir remoção mesmo quando o painel não for usado, configure política de TTL/agendamento no Firebase ou uma rotina de servidor com retenção de 30 dias.

## Estrutura
- Indicadores gerais: `paineis/aduana-am1-AAAA-MM-DD` — sem IDs individuais.
- Auditoria individual: `aduanaHistoricoPrivadoAM1/AAAA-MM-DD` — `shipments[]` com ID, situação, rota AM1, doca, lado no sistema, lado físico, tipo e cor.
- IDs de outras operações, IDs físicos ausentes do sistema e repetições não entram no histórico individual.
- Atualizações do mesmo dia substituem o documento daquele dia; outros dias permanecem intactos.
- Limite atual: 780 KB por dia para o documento de IDs. Se ultrapassar, a gravação dos IDs é cancelada com erro explícito (sem salvar uma lista incompleta).
