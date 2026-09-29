#!/usr/bin/env bash
# AT-146 — o ENSAIO da rotação da chave mestra (`CREDENTIALS_MASTER_KEY`),
# contra o cluster da prova, pelos três passos do runbook
# (docs/runbook.md, "Master key rotation"; RN-562/RN-563, ADR 0158).
#
# ## Por que existe
#
# A rotação NUNCA rodou em ambiente real (decisão/resposta do mantenedor,
# 2026-09-27). O que a provava era só `apps/api/test/scripts/rewrap-deks.spec.ts`
# (RN-562), contra um Postgres de teste: nunca a imagem, nunca o
# `ExternalSecret`, nunca um restart da api. E o procedimento "roda uma vez a
# cada muitos meses, sempre sob pressão" (HS-022) — é exatamente o que não pode
# ser lido pela primeira vez no dia do incidente.
#
# ## O que ele faz — os passos do runbook, com a MESMA mecânica
#
#   0. grava pela API uma credencial de LLM com um valor aleatório (é o
#      envelope que a rotação tem de preservar) e confere que TODO envelope do
#      banco abre com a chave de hoje (K1);
#   1. publica as DUAS chaves no Secret-FONTE `brabo` (o análogo local do
#      provider — nunca direto no `brabo-secrets`, que o ESO reescreveria),
#      força o sync, espera a `_PREVIOUS` chegar, reinicia a api e exige a
#      linha "rotação em andamento" com as DUAS impressões digitais;
#   2. conta os PENDENTES com a consulta do runbook (`key_id IS DISTINCT FROM
#      <NOVA>`) — tem de haver algum —, roda `node scripts/rewrap-deks.js` da
#      imagem (código de saída 0, `falhas=0`), exige ZERO pendentes, e roda de
#      novo: idempotente ("nada a fazer");
#   3. REMOVE a `_PREVIOUS` da fonte, força o sync, espera ela SUMIR do
#      `brabo-secrets`, reinicia a api, exige a linha "chave mestra corrente"
#      com a impressão NOVA e nenhum aviso de rotação, e confere que TODO
#      envelope abre só com a nova — e que a credencial do passo 0 decifra no
#      MESMO valor (comparado por sha256; o valor nunca sai do pod).
#
# O veredito é o código de saída: qualquer passo que não bate sai com 1,
# nomeado.
#
# ## O que ele deixa para trás
#
# O cluster termina na chave NOVA, com a fonte `brabo` e o `brabo-secrets`
# coerentes e sem `_PREVIOUS` — o estado de uma rotação terminada, não um
# meio-caminho. Se reprovar NO MEIO, a fonte fica com as duas chaves: é o
# estado em que "nada quebra" (o runbook, passo 1), e o log diz em que passo
# parou. Por isso ele roda por ÚLTIMO no `propriedades.yml`: reinicia a api e
# troca um segredo, e nenhum alvo depois dele deveria herdar isso.
#
# ## O que ele NÃO cobre, declarado
#
# - `project_git_connections`: criar uma conexão de git pela API exige validar
#   um token contra um provider de verdade, e o cluster da prova não tem
#   egress. A tabela É lida pelo verificador e pelo `rewrap` (conta o que
#   houver, normalmente 0); o envelope dela é o MESMO código, provado nas duas
#   tabelas pelo spec da RN-562.
# - O provider de segredos de staging/produção: aqui a fonte é o Secret local
#   que o `SecretStore` do overlay lê. O `ExternalSecret` e o ESO são os de
#   verdade.
#
# Uso: bash deploy/k8s/test-rotacao-chave-mestra.sh
set -euo pipefail

NS="${BRABO_NAMESPACE:-brabo}"
API="${API_URL:-http://localhost:3000}"
SMOKE_USER="${SMOKE_USER:-owner@brabo.dev}"
SMOKE_PASSWORD="${BRABO_SMOKE_PASSWORD:-brabo12345678}"
FONTE="brabo"
MATERIALIZADO="brabo-secrets"

info() { printf '\n\033[1m[test-rotacao-chave-mestra]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }

PASSO="preparação"
fail() {
  printf '\n\033[31m[test-rotacao-chave-mestra] FALHOU no passo "%s": %s\033[0m\n' "${PASSO}" "$*" >&2
  printf '\n--- pods ---\n' >&2
  kubectl -n "${NS}" get pods -o wide >&2 || true
  printf '\n--- ExternalSecret ---\n' >&2
  kubectl -n "${NS}" get externalsecret "${MATERIALIZADO}" -o wide >&2 || true
  printf '\n--- log recente da api ---\n' >&2
  kubectl -n "${NS}" logs deploy/api --tail=40 >&2 2>/dev/null || true
  exit 1
}

command -v kubectl >/dev/null || fail "kubectl não encontrado no PATH"
command -v jq >/dev/null || fail "jq não encontrado no PATH"
command -v openssl >/dev/null || fail "openssl não encontrado no PATH"

# O verificador roda DENTRO do pod da api, com o `EnvelopeEncryptionService`
# da própria imagem e o `DATABASE_URL` do ambiente dele — nenhum segredo passa
# por este script. Para cada tabela com envelope: quantas linhas, quantas abrem
# com as chaves que o pod tem AGORA, quantas estão pendentes pela consulta do
# runbook (`key_id IS DISTINCT FROM <corrente>`), e se o sha256 esperado (o da
# credencial do passo 0) está entre os valores decifrados. Nunca imprime um
# valor decifrado. Sai com 1 se alguma linha não abre.
JS_VERIFICAR='const {Pool}=require("pg");const c=require("crypto");const {EnvelopeEncryptionService:S}=require("./infrastructure/security/envelope-encryption.service");(async()=>{const s=new S();const p=new Pool({connectionString:process.env.DATABASE_URL});const out={keyId:s.keyId,previousKeyId:s.previousKeyId,encontrado:false,tabelas:{}};let falhas=0;try{for(const t of ["user_credentials","project_git_connections"]){const r=await p.query("select key_id,wrapped_dek,dek_iv,dek_auth_tag,encrypted_api_key,api_key_iv,api_key_auth_tag from "+t);const pend=await p.query("select count(*)::int as n from "+t+" where key_id is distinct from $1",[s.keyId]);let abrem=0;for(const l of r.rows){try{const v=s.decrypt({keyId:l.key_id,wrappedDek:l.wrapped_dek,dekIv:l.dek_iv,dekAuthTag:l.dek_auth_tag,encryptedApiKey:l.encrypted_api_key,apiKeyIv:l.api_key_iv,apiKeyAuthTag:l.api_key_auth_tag});abrem++;if(c.createHash("sha256").update(v).digest("hex")===process.argv[1])out.encontrado=true}catch(e){falhas++}}out.tabelas[t]={total:r.rows.length,abrem,pendentes:pend.rows[0].n}}}finally{await p.end()}console.log("VEREDITO "+JSON.stringify(out));if(falhas>0)process.exit(1)})().catch(e=>{console.error(e.message);process.exit(1)})'

# Roda o verificador e devolve só a linha JSON. Falha NOMEADA quando alguma
# linha não abre (é o desfecho que a rotação existe para impedir).
verificar() {
  local saida
  saida="$(kubectl -n "${NS}" exec deploy/api -- node -e "${JS_VERIFICAR}" "${HASH_ESPERADO}" 2>&1)" \
    || { printf '%s\n' "${saida}" | tail -5 | sed 's/^/    /' >&2; fail "há envelope que não abre com as chaves que a api tem agora"; }
  printf '%s\n' "${saida}" | sed -n 's/^VEREDITO //p' | tail -1
}

campo() { jq -r "$1" <<<"$2"; }

# Chave do Secret-fonte, decodificada (vazia quando não existe).
da_fonte() {
  kubectl -n "${NS}" get secret "${FONTE}" -o json | jq -r --arg k "$1" '.data[$k] // empty | @base64d'
}

# Força o ESO a sincronizar e espera o `brabo-secrets` ter (ou NÃO ter) a
# `_PREVIOUS` — o runbook manda conferir, e é aqui que a remoção por
# `dataFrom.extract` se prova: a chave tem de SUMIR, não ficar para trás.
sincronizar_e_esperar() {
  local quer="$1" tem
  kubectl -n "${NS}" annotate externalsecret "${MATERIALIZADO}" force-sync="$(date +%s%N)" --overwrite >/dev/null
  for _ in $(seq 1 60); do
    tem="$(kubectl -n "${NS}" get secret "${MATERIALIZADO}" -o json \
      | jq -r 'if .data.CREDENTIALS_MASTER_KEY_PREVIOUS then "sim" else "nao" end')"
    [[ "${tem}" == "${quer}" ]] && return 0
    sleep 2
  done
  fail "o ${MATERIALIZADO} não ficou com CREDENTIALS_MASTER_KEY_PREVIOUS=${quer} em 120s depois do force-sync"
}

reiniciar_api() {
  kubectl -n "${NS}" rollout restart deployment/api >/dev/null
  kubectl -n "${NS}" rollout status deployment/api --timeout=300s >/dev/null \
    || fail "a api não completou o rollout em 300s"
  # O `rollout status` volta com o pod NOVO Ready, mas o antigo pode seguir em
  # `Terminating` — e o log dele, lido pelo seletor, ainda traz o aviso de
  # rotação que o passo 3 existe para ver sumir (medido na rodada
  # 36501327180, que reprovou assim). Espera o antigo sair de verdade.
  for _ in $(seq 1 60); do
    [[ "$(kubectl -n "${NS}" get pods -l app.kubernetes.io/name=api -o json \
      | jq '[.items[] | select(.metadata.deletionTimestamp != null)] | length')" == "0" ]] && return 0
    sleep 2
  done
  fail "o pod antigo da api não terminou em 120s depois do rollout"
}

log_da_api() {
  kubectl -n "${NS}" logs -l app.kubernetes.io/name=api --tail=-1 2>/dev/null || true
}

# --- 0. cenário, pela API ----------------------------------------------------
PASSO="0 — cenário"
info "gravando uma credencial pela API e conferindo o acervo na chave de hoje"
resposta="$(curl -sS --max-time 30 -H 'Content-Type: application/json' \
  -d "{\"email\":\"${SMOKE_USER}\",\"senha\":\"${SMOKE_PASSWORD}\"}" "${API}/auth/login")" \
  || fail "api não respondeu em ${API}/auth/login"
TOKEN="$(printf '%s' "${resposta}" | jq -r '.accessToken // empty')"
[[ -n "${TOKEN}" ]] || fail "sem accessToken no login: ${resposta}"

VALOR="sk-ensaio-rotacao-$(openssl rand -hex 16)"
HASH_ESPERADO="$(printf '%s' "${VALOR}" | openssl dgst -sha256 -r | cut -d' ' -f1)"
r="$(curl -sS --max-time 30 -X POST -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d "{\"provider\":\"anthropic\",\"apiKey\":\"${VALOR}\"}" "${API}/users/me/credentials")"
[[ -n "$(printf '%s' "${r}" | jq -r '.id // empty')" ]] || fail "credencial não gravada: ${r}"

K1="$(da_fonte CREDENTIALS_MASTER_KEY)"
[[ -n "${K1}" ]] || fail "o Secret-fonte ${FONTE} não tem CREDENTIALS_MASTER_KEY"
[[ -z "$(da_fonte CREDENTIALS_MASTER_KEY_PREVIOUS)" ]] \
  || fail "o Secret-fonte já tem CREDENTIALS_MASTER_KEY_PREVIOUS — há uma rotação por terminar neste cluster"

V0="$(verificar)"
KID1="$(campo .keyId "${V0}")"
[[ "$(campo .encontrado "${V0}")" == "true" ]] || fail "a credencial gravada não decifrou no mesmo valor na chave de hoje: ${V0}"
[[ "$(campo .previousKeyId "${V0}")" == "null" ]] || fail "a api já estava em rotação antes do ensaio: ${V0}"
ok "acervo na chave de hoje (key_id=${KID1}): $(jq -c .tabelas <<<"${V0}")"

# --- 1. publica as duas chaves ----------------------------------------------
PASSO="1 — publicar as duas chaves"
info "publicando a chave nova e a anterior na fonte, sincronizando e reiniciando a api"
K2="$(openssl rand -hex 32)"
kubectl -n "${NS}" patch secret "${FONTE}" --type merge \
  -p "$(jq -nc --arg n "${K2}" --arg a "${K1}" '{stringData:{CREDENTIALS_MASTER_KEY:$n,CREDENTIALS_MASTER_KEY_PREVIOUS:$a}}')" >/dev/null
sincronizar_e_esperar sim
ok "a _PREVIOUS chegou ao ${MATERIALIZADO}"
reiniciar_api
V1="$(verificar)"
KID2="$(campo .keyId "${V1}")"
[[ "${KID2}" != "${KID1}" ]] || fail "a impressão digital não mudou (${KID2}) — a api não carregou a chave nova"
[[ "$(campo .previousKeyId "${V1}")" == "${KID1}" ]] || fail "a anterior carregada não é a de antes: ${V1}"
log_da_api | grep -q "rotação em andamento (atual key_id=${KID2}, anterior key_id=${KID1})" \
  || fail "o log da api não traz o aviso de rotação com as duas impressões (${KID2}, ${KID1})"
ok "api em modo de rotação: atual ${KID2}, anterior ${KID1}"

# --- 2. re-embrulha ----------------------------------------------------------
PASSO="2 — re-embrulhar"
PENDENTES="$(campo '[.tabelas[].pendentes] | add' "${V1}")"
(( PENDENTES > 0 )) || fail "nenhum envelope pendente antes do rewrap — a prova não teria o que provar: ${V1}"
ok "pendentes antes do rewrap (key_id IS DISTINCT FROM ${KID2}): ${PENDENTES}"

info "rodando node scripts/rewrap-deks.js (a imagem)"
saida="$(kubectl -n "${NS}" exec deploy/api -- node scripts/rewrap-deks.js 2>&1)" \
  || { printf '%s\n' "${saida}" | sed 's/^/    /' >&2; fail "rewrap-deks.js saiu com erro"; }
printf '%s\n' "${saida}" | grep -E '^\s+(user_credentials|project_git_connections)|\[rewrap\]' | sed 's/^/    /'
printf '%s\n' "${saida}" | grep -Eq 'user_credentials .* falhas=0' || fail "rewrap sem 'falhas=0' em user_credentials"
printf '%s\n' "${saida}" | grep -Eq 'project_git_connections .* falhas=0' || fail "rewrap sem 'falhas=0' em project_git_connections"
V2="$(verificar)"
[[ "$(campo '[.tabelas[].pendentes] | add' "${V2}")" == "0" ]] || fail "ainda há pendentes depois do rewrap: ${V2}"
ok "zero pendentes nas duas tabelas"

saida="$(kubectl -n "${NS}" exec deploy/api -- node scripts/rewrap-deks.js 2>&1)" \
  || { printf '%s\n' "${saida}" | sed 's/^/    /' >&2; fail "a segunda execução do rewrap saiu com erro"; }
printf '%s\n' "${saida}" | grep -q 'nada a fazer' || fail "a segunda execução do rewrap reescreveu algo (não é idempotente): ${saida}"
ok "idempotente: a segunda execução não tem nada a fazer"

# --- 3. descarta a anterior ---------------------------------------------------
PASSO="3 — descartar a chave anterior"
info "removendo a _PREVIOUS da fonte, sincronizando e reiniciando a api"
kubectl -n "${NS}" patch secret "${FONTE}" --type json \
  -p '[{"op":"remove","path":"/data/CREDENTIALS_MASTER_KEY_PREVIOUS"}]' >/dev/null
sincronizar_e_esperar nao
ok "a _PREVIOUS sumiu do ${MATERIALIZADO}"
reiniciar_api
V3="$(verificar)"
[[ "$(campo .keyId "${V3}")" == "${KID2}" ]] || fail "a api subiu com outra chave corrente: ${V3}"
[[ "$(campo .previousKeyId "${V3}")" == "null" ]] || fail "a api ainda carrega uma anterior: ${V3}"
[[ "$(campo .encontrado "${V3}")" == "true" ]] || fail "a credencial do passo 0 não decifra no mesmo valor só com a chave nova: ${V3}"
[[ "$(campo '[.tabelas[].pendentes] | add' "${V3}")" == "0" ]] || fail "há pendentes com a chave nova sozinha: ${V3}"
log_da_api | grep -q "chave mestra corrente: key_id=${KID2}" \
  || fail "o log de boot da api não traz 'chave mestra corrente: key_id=${KID2}'"
if log_da_api | grep -q 'rotação em andamento'; then
  fail "a api ainda avisa rotação em andamento depois de descartar a anterior"
fi
ok "só a chave nova (key_id=${KID2}), todo envelope abre, a credencial decifra igual: $(jq -c .tabelas <<<"${V3}")"

printf '\n\033[32m[test-rotacao-chave-mestra] a chave mestra foi rotacionada pelos três passos do runbook, no cluster, sem perder envelope\033[0m\n'
