# Transição — Base de conhecimento e motor de treino

Tudo o que se aproveita do [claude-coach](https://github.com/felixrieseberg/claude-coach) (licença MIT), traduzido, adaptado ao Transição e completado com o que faltava: carga calculada em código, validação do plano, grupo de 4 e prontidão via Garmin.

## O que tem aqui

```
transicao-coach/
├── prompt/
│   └── system-prompt.md        ← prompt do coach (5 modos: avaliar, criar_plano, replanejar_semana, ajuste_do_dia, chat)
├── conhecimento/               ← BASE DE CONHECIMENTO (PT-BR) — vai junto com o prompt
│   ├── 01-avaliacao.md            base × forma, pontos fortes/limitadores, validação com o atleta
│   ├── 02-zonas-e-testes.md       zonas FC/potência/CSS/ritmo + testes de campo
│   ├── 03-carga-de-treino.md      TSS, CTL/ATL/TSB, metas por fase, sinais de recuperação
│   ├── 04-periodizacao.md         fases, microciclo, modelos de semana, 10%, 3:1, exigência por prova
│   ├── 05-biblioteca-de-treinos.md  natação, bike, brick, corrida, força, duplos, polarizado
│   ├── 06-prova-e-nutricao.md     ritmo de prova, potência-alvo, carbo/hidratação, cafeína, polimento
│   ├── 07-grupo-e-prontidao.md    NOVO: plano de grupo, prontidão diária, replanejamento semanal
│   ├── 08-dados-de-entrada.md     NOVO: o JSON de contexto que o backend manda à IA
│   └── base-completa.md           os 8 arquivos concatenados (para colar no prompt de uma vez)
├── schema/
│   └── training-plan.schema.json  ← JSON Schema para "structured output" da IA
├── codigo/                     ← TypeScript, sem dependência de framework (Node ou front)
│   ├── src/schema/plano.ts        tipos do plano (original + groupSession, athleteId, changeLog)
│   ├── src/zonas.ts               zonas a partir de LTHR/FTP/CSS/ritmo; FTP e CSS dos testes
│   ├── src/carga.ts               TSS (realizado e planejado), CTL/ATL/TSB, metas semanais, aderência
│   ├── src/prontidao.ts           status verde/amarelo/vermelho a partir de HRV, FCR, sono, TSB, check-in
│   ├── src/validar.ts             checa o plano da IA e gera o texto de correção para devolver a ela
│   ├── src/export/                .fit (Garmin), .zwo (Zwift), .erg/.mrc (rolo), .ics (calendário)
│   └── tests/                     31 testes (vitest)
├── exemplos/                   ← 2 planos de exemplo do original (sprint e olímpico, em inglês)
├── original-en/                ← material de referência original, sem alteração
└── LICENSE-claude-coach.md
```

## Como plugar no Transição

**Fluxo de "criar plano"** (o mesmo vale para replanejar e para o ajuste do dia):

1. **Backend monta o contexto**: puxa Strava/Garmin, calcula TSS de cada atividade (`activityTss`), a série CTL/ATL/TSB (`loadSeries`), as metas semanais (`weeklyTargets`) e a prontidão (`readiness`). Monta o JSON descrito em `conhecimento/08-dados-de-entrada.md`.
2. **Chama a IA** com:
   - *system*: `prompt/system-prompt.md` com `{{CONTEXTO_JSON}}` substituído, mais `conhecimento/base-completa.md` (cerca de 15 mil tokens; dá para usar *prompt caching*, já que essa parte não muda);
   - *user*: `{"modo": "criar_plano"}` (ou outro modo);
   - *structured output / tool* com `schema/training-plan.schema.json`.
3. **Valida**: `validatePlan(plano, { thresholds, tssTargets })`. Se `ok === false`, devolve `feedbackForModel` à IA e pede a correção (no máximo 2 rodadas).
4. **Salva** o plano. Exporta treinos para o relógio com `exportWorkout(w, "fit")` e o calendário com `exportPlanCalendar(plano)`.

```ts
import { weeklyTargets, readiness, validatePlan, exportWorkout } from "./codigo/src/index.js";

const metas = weeklyTargets({
  today: "2026-10-21", eventDate: "2027-05-30", eventType: "olimpico",
  level: "intermediate", currentCtl: 40, currentAtl: 45, recentWeeklyTss: 280,
});
// metas.weeks → [{ week: 1, startDate: "2026-10-26", phase: "Base", tss: 308, hoursEstimate: 5.6, ... }, ...]

const r = validatePlan(planoDaIA, { tssTargets: Object.fromEntries(metas.weeks.map(w => [w.week, w.tss])) });
if (!r.ok) { /* reenviar r.feedbackForModel para a IA */ }
```

**Rotinas automáticas sugeridas**
- Todo dia de manhã: `readiness()` para cada atleta e, se não for verde, chamar o modo `ajuste_do_dia`.
- Todo domingo à noite: `weekAdherence()` para cada atleta e chamar o modo `replanejar_semana`.

## O que mudou em relação ao original

| Original (claude-coach) | Aqui |
|---|---|
| Carga (TSS/CTL) descrita em texto; a IA estimava de cabeça | Calculada em código; a IA recebe as metas prontas |
| Plano gerado uma vez, sem retorno | Replanejamento semanal por aderência e ajuste diário por prontidão |
| Um atleta só | Grupo de 4: fases e recuperação em comum, zonas e volume individuais, treinos em grupo |
| Só Strava | Strava + sono/HRV/FCR do Garmin ou Apple Watch + check-in |
| Regras só no prompt | Regras também no validador (`validar.ts`) |
| Inglês, com unidades imperiais misturadas | PT-BR, métrico, exemplos para sprint/olímpico |
| Consultas SQL num SQLite local | Contrato de dados JSON (`08`) que o backend preenche |
| Exportador `.fit` com bugs | Corrigido (ver abaixo) |

**Bugs corrigidos no exportador `.fit`:** os nomes dos enums estavam em snake_case (`lap_swimming`, `heart_rate`, `repeat_until_steps_cmplt`, `strength_training`), mas o SDK da Garmin usa camelCase. Por isso a exportação de natação e de qualquer treino com intervalos falhava. Além disso, o passo de repetição era inserido antes dos passos filhos, quando no FIT ele vem depois. Os testes agora decodificam o arquivo gerado e conferem a estrutura.

**Os exemplos originais não passam no validador:** em todas as semanas, `summary.totalHours` não bate com a soma dos treinos. É justamente o tipo de inconsistência que o validador existe para pegar.

## Rodar os testes

```bash
cd codigo
npm install
npm test           # 31 testes
npm run typecheck
npm run schema     # regenera schema/training-plan.schema.json se você mudar plano.ts
```

## Pontos para você decidir

- **Teto de CTL** (`defaultCtlCap`): sai das horas de pico por prova em `04-periodizacao.md`. No olímpico, nível intermediário, dá ~59 de CTL (~7,5 h/semana no pico). Ajuste `ctlCap` por atleta se quiser.
- **Faixas de sprint/olímpico** em `04-periodizacao.md` e o TSS/h de força em `03` são referências usuais que eu acrescentei. O original só detalhava 70.3, Ironman e maratona.
- **Distância da prova:** o contexto usa `olimpico` como exemplo. Troque quando a prova da equipe estiver definida.

## Licença

O conteúdo derivado do claude-coach segue a licença MIT original (`LICENSE-claude-coach.md`, © Felix Rieseberg). O projeto não é afiliado à Anthropic.
