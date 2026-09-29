#!/usr/bin/env bash
# O alarme das provas de `propriedades.yml`, uma issue POR ALVO que falhou —
# aberta na falha, fechada quando o alvo volta a passar (AT-212).
#
# Saiu do passo inline quando o workflow ganhou o SEGUNDO job (AT-195, a prova
# da instalação por compose, que roda noutro runner): dois jobs com o mesmo
# alarme copiado divergiriam no primeiro ajuste de texto, e o título é a CHAVE
# de reaproveitamento — um título diferente num dos dois abriria issue nova a
# cada falha.
#
# Uso (sourced, num passo com GH_TOKEN, URL_DO_RUN e o ambiente padrão do
# Actions — GITHUB_REPOSITORY, GITHUB_REF_NAME, GITHUB_SHA):
#   source scripts/ci/alarmar-prova.sh
#   alarmar '<alvo>' '<outcome do passo>' ['<onde olhar além do log>']
#
# O desfecho decide o que acontece com a issue do alvo (AT-212):
#   - `failure` abre a issue, ou comenta na aberta;
#   - `success` FECHA a aberta, com um comentário que nomeia a rodada — antes
#     ela ficava aberta depois de a prova voltar a passar, e o corpo pedia a um
#     humano que lembrasse de fechá-la;
#   - qualquer outro (`skipped`, `cancelled`, vazio) não toca nada: `skipped` de
#     um alvo cujo pré-requisito caiu é alarmado pelo pré-requisito, que tem
#     título próprio (o bootstrap, o build).
#
# E SÓ a rodada do ramo PADRÃO (a do agendamento, e um `workflow_dispatch`
# nele) toca issue. Uma prova vermelha num `workflow_dispatch` de BRANCH é de
# quem a disparou, que está olhando o run: comentar na issue do agendamento
# misturaria a falha de um código que ainda não entrou com a do que entrou, e
# um verde de branch fecharia uma issue que a `main` ainda reprova. A branch
# ganha um `::warning::` no log e mais nada. O ramo padrão vem de
# `RAMO_PADRAO` quando o ambiente o traz (o spec), senão é PERGUNTADO ao
# GitHub — o payload do `schedule` não carrega o repositório, então
# `github.event.repository.default_branch` viria vazio justamente na rodada
# que mais importa.
#
# A busca é `--json` + comparação EXATA de título (o mesmo desenho de
# `tag-release.yml`): o título tem crase, e a sintaxe de busca do GitHub a
# trataria como operador. Uma nova falha do mesmo alvo vira COMENTÁRIO na issue
# aberta — enxurrada de issues idênticas ensina a ignorar.

# O ramo padrão, perguntado uma vez por passo.
ramo_padrao_da_prova() {
  if [ -z "${RAMO_PADRAO:-}" ]; then
    RAMO_PADRAO="$(gh repo view "${GITHUB_REPOSITORY}" --json defaultBranchRef --jq .defaultBranchRef.name)" \
      || { echo "::error::não consegui perguntar ao GitHub o ramo padrão de ${GITHUB_REPOSITORY}" >&2; return 1; }
    [ -n "${RAMO_PADRAO}" ] \
      || { echo "::error::o GitHub devolveu ramo padrão vazio para ${GITHUB_REPOSITORY}" >&2; return 1; }
  fi
  printf '%s' "${RAMO_PADRAO}"
}

alarmar() {
  local alvo="$1" desfecho="$2" onde="${3:-}" titulo corpo existente url ramo
  case "${desfecho}" in
    failure|success) ;;
    *) return 0 ;;
  esac
  titulo="Prova de propriedade falhou: \`${alvo}\`"

  ramo="$(ramo_padrao_da_prova)" || return 1
  RAMO_PADRAO="${ramo}"
  if [ "${GITHUB_REF_NAME}" != "${ramo}" ]; then
    if [ "${desfecho}" = "failure" ]; then
      echo "::warning::${alvo} reprovou em ${GITHUB_REF_NAME} — rodada de branch não abre nem comenta issue (só a do ${ramo})"
    fi
    return 0
  fi

  existente="$(TITULO="${titulo}" gh issue list --state open --limit 200 --json number,title \
    --jq '.[] | select(.title == $ENV.TITULO) | .number' | head -1)"

  if [ "${desfecho}" = "success" ]; then
    [ -n "${existente}" ] || return 0
    gh issue close "${existente}" \
      --comment "Passou na rodada ${URL_DO_RUN} (\`${GITHUB_SHA}\`, ${GITHUB_REF_NAME}, $(date -u +%Y-%m-%dT%H:%MZ)). Fechada pelo próprio \`propriedades.yml\`; uma nova falha abre outra."
    echo "::notice::fechei a issue #${existente} (${alvo} voltou a passar)"
    return 0
  fi

  corpo="$(mktemp)"
  {
    echo "A rodada de \`propriedades.yml\` no ramo padrão reprovou em \`${alvo}\`."
    echo
    echo "- run: ${URL_DO_RUN}"
    echo "- commit: \`${GITHUB_SHA}\` (${GITHUB_REF_NAME})"
    echo "- data: $(date -u +%Y-%m-%dT%H:%MZ)"
    echo
    echo "O log do passo tem a mensagem do script${onde:+; ${onde}}."
    echo "Uma nova falha deste alvo vira comentário AQUI, e a primeira rodada em que ele passar fecha a issue sozinha."
  } > "${corpo}"

  if [ -n "${existente}" ]; then
    gh issue comment "${existente}" --body-file "${corpo}"
    echo "::notice::comentei na issue #${existente} (${alvo})"
  else
    url="$(gh issue create --title "${titulo}" --body-file "${corpo}")"
    echo "::notice::issue aberta para ${alvo}: ${url}"
  fi
  rm -f "${corpo}"
}
