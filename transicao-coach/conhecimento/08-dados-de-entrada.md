# 08 — Dados de entrada (o que o app entrega à IA)

> Substitui o `queries.md` do original (consultas SQL no banco local dele). No Transição, o **backend calcula estes resumos** a partir de Strava/Garmin/Apple Watch e envia à IA em JSON. A IA **não consulta dados brutos**: trabalha com este resumo.

## Contexto enviado a cada geração de plano

```jsonc
{
  "hoje": "2026-10-21",
  "prova": {
    "nome": "Triatlo da equipe",
    "data": "2027-05-30",
    "tipo": "olimpico",            // super_sprint | sprint | olimpico | 70.3 | ironman
    "distancias": { "swim": 1500, "bike": 40, "run": 10 },  // m, km, km
    "aguasAbertas": true
  },
  "grupo": {
    "atletas": ["henrique", "atleta2", "atleta3", "atleta4"],
    "treinosEmGrupo": [
      { "dia": "saturday", "esporte": "brick" },
      { "dia": "thursday", "esporte": "swim" }
    ]
  },
  "atleta": {
    "id": "henrique",
    "nivel": "intermediate",       // beginner | intermediate | advanced
    "anosNoEsporte": 1,
    "provasAnteriores": [],
    "zonas": {                      // de testes de campo; null = desconhecido
      "run":  { "lthr": 172, "ritmoLimiarSegKm": 290 },
      "bike": { "ftp": 210, "lthr": 165 },
      "swim": { "cssSeg100m": 115 },
      "fcMax": 195, "fcRepouso": 52, "peso": 72,
      "estimadas": false
    },
    "formaAtual": {                 // últimas 8 semanas
      "horasSemanaisMedia": { "total": 6.5, "swim": 1.2, "bike": 2.8, "run": 2.0, "strength": 0.5 },
      "sessoesPorSemana": 6,
      "semanasConsistentes": 7,
      "maiorSessao12sem": { "swim_m": 2000, "bike_km": 55, "run_km": 10 },
      "volumeSemanal": [            // últimas 8 semanas, mais antiga primeiro
        { "semana": "2026-W35", "horas": 5.1, "tss": 310 }
      ]
    },
    "base": {                       // últimos 2 anos
      "picoHorasSemanais": 8,
      "maiorSessaoHistorica": { "swim_m": 3000, "bike_km": 80, "run_km": 21 },
      "esforcoPorMinuto": { "swim": 0.6, "bike": 0.9, "run": 1.4 }  // Relative Effort/min médio
    },
    "diasPreferidos": {             // dia da semana mais comum
      "longoBike": "saturday",      // pedal > 90 min
      "longoRun": "sunday"          // corrida > 60 min
    },
    "carga": {                      // calculado por codigo/carga.ts
      "ctl": 48, "atl": 55, "tsb": -7,
      "rampaMaxCtlSemana": 6,
      "tetoCtl": 59,                // defaultCtlCap(prova, nível) — horas de pico × 55 ÷ 7
      "metasTssSemanal": [          // uma por semana do plano, já com recuperação e polimento
        { "semana": 1, "fase": "Base", "tss": 360, "recuperacao": false }
      ]
    },
    "prontidao": {                  // ver 07-grupo-e-prontidao.md
      "status": "verde",
      "hrv7d": 68, "hrvBase": 70,
      "fcrUltimos3d": [52, 53, 52], "fcrBase": 52,
      "sonoUltimas3n_h": [7.2, 6.8, 7.5],
      "checkin": { "sono": 4, "energia": 4, "dor": 2, "humor": 4 }  // 1–5; em "dor", 1 = sem dor e 5 = muita dor
    },
    "restricoes": ["Piscina só ter/qui/dom", "Faculdade de manhã seg–sex"],
    "equipamento": { "potenciometro": false, "rolo": true, "piscina": "25m" },
    "lesoes": [],
    "objetivo": "completar bem, sub 3h"
  },
  "planoAnterior": null,            // ou o JSON do plano vigente (para replanejar)
  "realizadoUltimas2Semanas": []    // atividades resumidas, para comparar com o plano
}
```

## Como derivar cada campo (backend)

| Campo | Cálculo |
|---|---|
| `horasSemanaisMedia` | Soma de `moving_time` por esporte nas últimas 8 semanas ÷ 8 |
| `maiorSessao12sem` | Máx. `distance` por esporte nas últimas 12 semanas |
| `semanasConsistentes` | Semanas seguidas (até hoje) com ≥ 3 sessões |
| `esforcoPorMinuto` | Média de `suffer_score / (moving_time/60)` por esporte (2 anos) |
| `diasPreferidos` | Moda do dia da semana das atividades bike > 90 min e run > 60 min |
| `picoHorasSemanais` | Máx. de horas em uma janela móvel de 4 semanas ÷ 4 (2 anos) |
| `provasAnteriores` | Atividades com `workout_type = 1` (Strava: prova) |
| `carga.*` | `codigo/carga.ts` (TSS por atividade → CTL/ATL/TSB → metas) |
| `prontidao.*` | Garmin Health (HRV, FCR, sono) + check-in do app → `codigo/prontidao.ts` |

## Mapeamento de esportes do Strava

| Strava `sport_type` | Transição `sport` |
|---|---|
| Swim | swim |
| Ride, VirtualRide, GravelRide, MountainBikeRide | bike |
| Run, TrailRun, VirtualRun | run |
| WeightTraining, Workout, Crossfit, Yoga | strength |
| Outros | ignorar no cálculo de volume, mas somar TSS se houver FC |
