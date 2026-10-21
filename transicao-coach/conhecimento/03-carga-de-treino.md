# 03 — Carga de treino (TSS, CTL, ATL, TSB)

Treinadores profissionais **quantificam** o estresse de treino para controlar fadiga, evitar overtraining e chegar no pico na prova.

> **Regra do Transição:** os números de carga (TSS, CTL, ATL, TSB, rampa) são **calculados pelo código** (`codigo/carga.ts`) e entregues à IA como entrada. A IA **não estima carga de cabeça**: ela usa as metas recebidas e escolhe treinos que caibam nelas. As tabelas abaixo servem para a IA entender e explicar os números.

## TSS — Training Stress Score

TSS mede o custo fisiológico de um treino. 100 TSS = 1 hora exatamente no limiar.

**Bike com potência:**
```
TSS = (duração_s × NP × IF) / (FTP × 3600) × 100
NP = potência normalizada; IF = NP / FTP
```

**Fórmula geral (qualquer esporte):** `TSS = horas × IF² × 100`, em que IF é a intensidade em relação ao limiar do esporte (potência/FTP, ritmo de limiar/ritmo, ou FC/LTHR).

### TSS típico por tipo de treino

| Treino | TSS típico | Recuperação necessária |
|---|---|---|
| Pedal leve de 1 h | 40–50 | Mesmo dia OK |
| Pedal de resistência de 2 h | 80–100 | 24 h |
| Intervalado forte | 70–90 | 24–48 h |
| Pedal longo de 4 h | 150–200 | 48–72 h |
| 160 km de bike | 250–350 | 3–5 dias |
| Bike de Ironman | 300–400 | 1–2 semanas |

### TSS de corrida (rTSS)
Estimado por ritmo e FC. O **Relative Effort do Strava** serve como aproximação: ≈ rTSS para a maioria dos atletas. Compare esforço por hora entre sessões para ver intensidade relativa.

### TSS de natação (sTSS)

| Tipo | TSS por hora |
|---|---|
| Natação leve | 25–30 |
| Moderada | 40–50 |
| Intervalos fortes | 60–70 |

### Força
Estimativa prática: 30–40 TSS por hora de força moderada; 20 por hora de mobilidade/core.

## CTL — "Fitness" (carga crônica)

Média móvel ponderada de **42 dias** do TSS diário. Representa a forma acumulada.

### Rampa máxima de CTL por semana

| Nível | Aumento máx. de CTL/semana | Observação |
|---|---|---|
| Iniciante | 3–5 | Conservador, evitar lesão |
| Intermediário | 5–7 | Progressão padrão |
| Avançado | 7–10 | Agressivo, exige monitoramento |
| Profissional | 8–12 | Com gestão cuidadosa de recuperação |

_Rampa de 7/semana ≈ adicionar ~50 TSS por semana à carga semanal média._

## ATL — "Fadiga" (carga aguda)

Média móvel ponderada de **7 dias** do TSS diário. Representa a fadiga recente.

## TSB — "Forma" (equilíbrio)

```
TSB = CTL − ATL   (use os valores de ontem para a forma de hoje)
```

| TSB | Estado | Implicação |
|---|---|---|
| +15 a +25 | Descansado/no pico | Pronto para prova; perde forma se mantiver |
| +5 a +15 | Descansado | Bom para treinos de qualidade, provas menores |
| −10 a +5 | Neutro | Estado normal de treino |
| −10 a −30 | Cansado | Construindo carga, precisa recuperar logo |
| < −30 | Overreaching | Alto risco de lesão/esgotamento — reduzir carga |

### TSB-alvo no dia da prova

| Prova | TSB-alvo | Duração do polimento |
|---|---|---|
| Sprint | 0 a +10 | 5–7 dias |
| Olímpico | +5 a +15 | 10–14 dias |
| 70.3 | +10 a +20 | 14–18 dias |
| Ironman | +15 a +25 | 21–28 dias |

## TSS semanal-alvo por fase

| Fase | % do TSS semanal de pico | Foco |
|---|---|---|
| Base (início) | 60–70% | Construir volume |
| Base (fim) | 75–85% | Volume + introduzir intensidade |
| Construção | 90–100% | Pico de volume, trabalho específico |
| Pico | 85–95% | Manter forma, afiar |
| Polimento | 40–60% | Reduzir volume, manter intensidade |
| Semana de recuperação | 50–60% | A cada 3–4 semanas |

## Monitoramento de recuperação

### Indicadores fisiológicos (Garmin/Apple Watch)

**FC de repouso (FCR):**
- FCR 5–10+ bpm acima da linha de base = fadiga acumulada.
- Elevada por 3+ dias seguidos = considerar dia/semana de recuperação.
- Queda súbita abaixo da linha de base = possível início de doença.

**HRV (variabilidade da FC):**
- HRV mais alta = mais recuperado; mais baixa = mais estressado/cansado.
- HRV 10%+ abaixo da linha de base = reduzir intensidade.
- Acompanhe a **média de 7 dias**, não oscilações diárias.

### Indicadores subjetivos (escala 1–5, check-in diário no app)

| Métrica | Pergunta |
|---|---|
| Sono | Dormiu bem? Acordou durante a noite? |
| Energia | Como se sentiu ao acordar? |
| Dor muscular | Geral ou localizada? |
| Humor | Motivado ou com preguiça de treinar? |
| Apetite | Normal, aumentado ou reduzido? |

**Padrões de alerta:**
- 2+ notas baixas por 3+ dias = reduzir.
- Sono + humor baixos juntos = alto risco de esgotamento.

Ver regras de ajuste automático em `07-grupo-e-prontidao.md`.

### Estrutura de semana de recuperação (a cada 3–4 semanas)

| Dia | Prescrição |
|---|---|
| 1 | Descanso total ou 30 min Z1 |
| 2 | 45–60 min Z2, um esporte |
| 3 | 30–45 min Z2, outro esporte |
| 4 | Descanso total |
| 5 | 45–60 min Z2 com 3–4 acelerações curtas |
| 6 | Sessão leve, reavaliar prontidão |
| 7 | Se estiver bem, voltar ao treino normal |

**Volume:** 40–50% de uma semana normal. **Intensidade:** nada de Z4+.
