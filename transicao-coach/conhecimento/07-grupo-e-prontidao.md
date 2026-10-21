# 07 — Grupo, prontidão e ajuste semanal

> Arquivo **novo do Transição** (não existe no claude-coach). Aplica os princípios de `01`–`06` a um grupo de 4 atletas com a mesma prova e usa dados de sono/HRV/FCR do Garmin ou do Apple Watch para ajustar o plano.

## 1. Plano de grupo: uma estrutura, quatro planos

O grupo tem **uma prova e um calendário de fases**, mas **cada atleta tem volume, zonas e progressão próprios**.

### O que é comum a todos
- Data da prova e contagem regressiva.
- **Fases** (base, construção, pico, polimento) com as mesmas datas de início e fim.
- **Semanas de recuperação no mesmo período** (facilita a vida social do grupo e o treino junto).
- **Treinos em grupo fixos** (ver abaixo).

### O que é individual
- Zonas (LTHR, FTP, CSS, ritmo de limiar).
- Volume semanal e rampa de CTL (pelo nível e pela base de cada um — `01` e `03`).
- Distribuição entre esportes (cada um reforça o **próprio limitador**).
- Progressão do longo (iniciante sobe mais devagar).
- Ajustes diários por prontidão.

### Treinos em grupo
- **1–2 sessões por semana fixas no calendário dos 4** (ex.: transição no sábado, natação na quinta).
- Escolher sessões que funcionam com níveis diferentes:
  - **Longos em Z2:** cada um na própria zona; quem é mais forte faz percurso maior ou volta extra, e todos terminam juntos.
  - **Intervalados:** mesma estrutura (ex.: 5× 4 min), **intensidade individual** (cada um no próprio % do FTP ou ritmo).
  - **Simulação de transição (T1/T2):** todos juntos; ótimo para o grupo.
  - **Natação em águas abertas:** sempre em grupo, por segurança.
- **Nunca** forçar o atleta mais lento a treinar na zona do mais rápido. Se a sessão em grupo não couber na zona dele, adaptar a duração/distância, não a intensidade.
- Marcar no plano com `groupSession: true` e o mesmo `groupSessionId` para os 4.

### Coerência entre os planos
- Total de horas semanais pode variar entre os atletas; **o padrão dos dias** (que esporte em que dia) deve ser o mais parecido possível para permitir treino conjunto.
- Se um atleta precisa de semana de recuperação fora do ciclo do grupo (lesão, prontidão baixa), recupera sozinho e mantém os treinos em grupo em versão leve.

## 2. Prontidão diária (readiness)

O código calcula um **status de prontidão** por atleta a cada manhã a partir de:

| Sinal | Fonte | Linha de base | Alerta |
|---|---|---|---|
| HRV (média de 7 dias) | Garmin / Apple Watch | Média dos últimos 28–60 dias | ≥ 10% abaixo |
| FC de repouso | Garmin / Apple Watch | Média dos últimos 28–60 dias | ≥ 5 bpm acima por 3+ dias |
| Sono | Garmin (horas + score) | Meta individual (ex.: 7 h) | < 6 h ou score baixo por 2+ noites |
| TSB | Calculado (`03`) | — | < −30 |
| Check-in subjetivo (1–5) | App | — | 2+ notas ≤ 2 por 3+ dias |

### Status e o que a IA deve fazer

| Status | Critério | Ação no plano do dia/semana |
|---|---|---|
| 🟢 **Verde** | Nenhum alerta | Manter o plano |
| 🟡 **Amarelo** | 1 alerta | Treino de qualidade vira versão mais curta (−25–30% do bloco principal) **ou** troca de dia com uma sessão leve; cortar treino duplo |
| 🔴 **Vermelho** | 2+ alertas, ou TSB < −30, ou sono + humor baixos juntos | Trocar por descanso ou Z1 de 30 min; sem Z4+ por 48 h; se persistir 3+ dias, antecipar semana de recuperação |
| ⚫ **Doença/dor** | Atleta relata febre, dor aguda, FCR caindo bruscamente | Descanso; não reajustar carga até liberar; sugerir procurar médico/fisioterapeuta se persistir |

Regras:
- A IA **explica a troca em uma frase** ("HRV 12% abaixo da sua média e 5 h de sono: troquei os intervalos de hoje por 40 min leves; os intervalos vão para quinta").
- **Nunca compensar** um treino perdido dobrando o próximo. Treino perdido é perdido; o plano segue.
- Treino em grupo com atleta amarelo: ele participa em versão leve.

## 3. Ajuste semanal (replanejamento)

Todo **domingo à noite** (ou quando o atleta pedir), para cada atleta:

1. **Comparar planejado × realizado** da semana:
   - Aderência = sessões feitas / planejadas, e TSS realizado / TSS planejado.
   - Sessões-chave perdidas (longo, intervalado principal).
2. **Atualizar CTL/ATL/TSB** com o TSS real (código).
3. **Decidir a semana seguinte** (o código calcula a meta de TSS; a IA monta os treinos):

| Situação | Ajuste |
|---|---|
| Aderência ≥ 90% e prontidão verde/amarela | Seguir a progressão planejada |
| Aderência 70–90% | Repetir a carga da semana (não progredir) |
| Aderência < 70% | Voltar à carga de 2 semanas atrás; manter só os treinos-chave |
| TSB < −30 ou 3+ dias vermelhos | Antecipar semana de recuperação |
| Zonas defasadas (esforço não bate com a zona) | Agendar teste de campo |
| Longo perdido | Não dobrar; o próximo longo segue a progressão a partir do último **feito** |

4. **Replanejar só os próximos 7–14 dias.** As fases e a data da prova não mudam (exceto se a data da prova mudar).
5. **Manter os treinos em grupo** nos mesmos dias, ajustando apenas a versão individual.

## 4. Mudança de data da prova
- Recalcular as semanas de trás para frente a partir da nova data.
- Preservar a fase atual; redistribuir as semanas restantes nas proporções de `04-periodizacao.md`.
- Se o tempo restante ficar abaixo do mínimo da prova (ver `04`), avisar o atleta e propor meta mais conservadora (completar em vez de tempo-alvo).
