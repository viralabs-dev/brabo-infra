# Realm do Keycloak em Kubernetes

`realm-template.json` é um **template**, não um realm pronto. O initContainer
`render-realm` do StatefulSet substitui os marcadores delimitados por
sublinhado duplo por valores vindos do Secret `keycloak-secrets` (materializado
pelo External Secrets Operator) e do ConfigMap `brabo-config`.

## Por que template e não o `docker/keycloak/realm.json` direto

Aquele arquivo traz os secrets dos clients `api-service` e `engine-service` em
plaintext, mais a senha do usuário de bootstrap. Montá-lo num ConfigMap seria
exatamente o "secret em manifesto plano" que o item 5 do escopo da Fase 5
proíbe. O arquivo renderizado vai para um `emptyDir` com `medium: Memory` — o
segredo nunca volta ao etcd.

Ele também só aceita redirect para `http://localhost:5173` (o `vite dev`), o
que não serve para nenhum cluster.

## Marcadores

| marcador | origem |
|---|---|
| realm | ConfigMap `brabo-config`, chave `KEYCLOAK_REALM` |
| origem do web | ConfigMap `brabo-config`, chave `WEB_ORIGIN` (vira `redirectUris` e `webOrigins`) |
| secret do api-service | Secret `keycloak-secrets` |
| secret do engine-service | Secret `keycloak-secrets` |
| usuário/senha de bootstrap | Secret `keycloak-secrets` |

## Duas armadilhas já pagas — não as reintroduza

1. **Não escreva um exemplo de marcador dentro do JSON.** A verificação final
   do initContainer varre o arquivo inteiro procurando marcadores não
   substituídos (um realm importado pela metade sobe verde e só quebra no
   login) — um exemplo na documentação dispara o alarme e o pod entra em
   CrashLoopBackOff. Foi o que aconteceu na primeira subida.
2. **JSON não tem comentário, e o Keycloak não perdoa.** A tentativa seguinte
   foi um campo `"_comment"`, que o desserializador do `RealmRepresentation`
   rejeita com `Unrecognized field`, derrubando o import. Daí este README
   existir como arquivo separado.
