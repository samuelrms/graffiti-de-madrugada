# Graffiti de Madrugada

[![CI](https://github.com/samuelrms/graffiti-de-madrugada/actions/workflows/ci.yml/badge.svg)](https://github.com/samuelrms/graffiti-de-madrugada/actions/workflows/ci.yml)
[![Jogar agora](https://img.shields.io/badge/jogar-graffiti--de--madrugada.onrender.com-ff2d75)](https://graffiti-de-madrugada.onrender.com/)

**Jogue agora: <https://graffiti-de-madrugada.onrender.com/>** (plano free: o primeiro acesso pode levar ~40 s para acordar o servidor).

Jogo multiplayer 3D competitivo no navegador. De 2 a 12 pichadores por sala
disputam uma cidade aberta durante uma noite de 3 minutos: pichar paredes dá
pontos (quanto mais alto, mais vale), escalar prédios libera equipamentos
melhores, e armas de tinta, socos e poderes derrubam rivais. Quando o sol nasce,
vence quem tiver mais pontos.

![Cidade vista da rua](docs/img/cidade.jpg)

| | |
| --- | --- |
| ![Home](docs/img/home.jpg) Home: salas abertas, criar sala (trancada ou não), entrar por ID ou nome | ![Lobby](docs/img/lobby.jpg) Lobby da sala: nome, link, dono escolhe o modo, "Pronto!" de todos |
| ![Equipes](docs/img/equipes.jpg) Modo equipes: 2 a 4 times balanceados, cor por equipe, sem fogo amigo | ![Personagens](docs/img/personagens.jpg) 12 personagens procedurais com cel-shading e contorno |
| ![Pichando](docs/img/pichando.jpg) Spray na parede — tiles valem mais quanto mais alto | ![Escalando](docs/img/escalando.jpg) Segurar Espaço na parede = escalar |
| ![Telhado](docs/img/telhado.jpg) Bazuca de tinta espera no topo das torres | ![Combate](docs/img/combate.jpg) Pistola, bazuca, soco e poderes |
| ![Kill feed](docs/img/kill.jpg) Kill feed com nomes e ranking ao vivo | ![Controles de toque](docs/img/toque.jpg) Celular: joystick, arrastar para olhar, botões |

Prints gerados automaticamente por `pnpm screenshots` (Chrome headless jogando de verdade).

## Como rodar

Só precisa de Docker com Docker Compose:

```bash
docker compose up --build
```

Aguarde a caixa **URL PÚBLICA DO JOGO** no terminal (serviço `tunnel`). Essa URL
`https://*.trycloudflare.com` é o único endereço dos jogadores — não há porta
exposta na máquina. Se rodou com `-d`: `docker compose logs -f tunnel`.

Desenvolvimento local (Node ≥ 22, pnpm via corepack):

```bash
corepack enable
pnpm install
pnpm dev        # servidor TS com reload (8080) + Vite (5173) com proxy do socket
pnpm build      # dist/server (tsc) + dist/public (vite)
pnpm start      # roda o build
```

## Como jogar

1. Abra o link, digite seu nome. Na **home**, entre numa sala aberta, crie a sua
   (marque **Trancada** para que só entre quem tiver o link) ou digite o ID/nome.
2. No lobby, **copiar link** manda a sala para a crew; clique **Pronto!**. A noite
   começa quando todos estiverem prontos (mínimo 2).
3. Clique na tela para travar o mouse. Piche, escale, atire, sobreviva.
4. Ao final aparece o ranking; **Voltar ao lobby** reinicia com todos prontos de novo.

### Salas

- Cada sala é uma partida isolada com ID de 6 caracteres (`#r=abc123` na URL).
- Salas públicas aparecem na home (atualiza a cada 3 s) e podem ser acessadas pelo
  nome; salas **trancadas** só pelo ID/link e nunca aparecem na lista.
- **Dono**: quem entra primeiro. Escolhe o modo no lobby e pode **fechar a sala**
  (todos voltam para a home). Se sair ou fechar a aba, o dono passa para quem está
  há mais tempo na sala. Quando o último sai, a sala é destruída na hora (sala
  criada e nunca usada some em 1 min). Até 12 jogadores por sala.
- **Um jogador por navegador**: abrir o jogo em outra aba não cria outro
  personagem (token por navegador). Por padrão também **um jogador por IP**
  (`MAX_PER_IP=1`); para eventos em que todo mundo divide o mesmo Wi-Fi/NAT,
  suba o valor (`MAX_PER_IP=0` = sem limite) no `compose.yaml`/Render.

### Modos

| Modo | Regras |
| --- | --- |
| Todos contra todos (padrão) | Cada um por si; tiles e kills contam para o jogador |
| Equipes (2, 3 ou 4) | Jogadores distribuídos em rodízio pela ordem de entrada (diferença máxima de 1 por time); cor e spray da equipe; sem fogo amigo; pichar tile do próprio time não pontua; vence a equipe com mais pontos somados |

| Item | Valor |
| --- | --- |
| Jogadores | 2 a 12 por sala, cada um com um modelo de personagem diferente |
| Duração | 3 s de contagem + 3 min |
| Objetivo | Mais pontos ao fim da noite |
| Pontos | Tile de parede: 1 + 1 a cada 6 m de altura · Kill: +8 e 20 % dos pontos da vítima |
| Vida | 100 HP · colete absorve 70 % do dano · respawn em 3 s no seu ponto inicial |

### Controles

| Tecla | Ação |
| --- | --- |
| `WASD` / setas | Andar (7 m/s) |
| `Shift` | Correr (10,5 m/s) |
| Mouse | Olhar (câmera em 3ª pessoa) |
| `Espaço` | Pular · segurar encostado numa parede = **escalar** |
| Clique esquerdo | Usar ferramenta atual: spray (pichar a parede na mira) ou atirar |
| `1` / `2` / roda do mouse | Alternar spray ↔ arma |
| `F` | Soco: 25 de dano + atordoa 0,9 s quem estiver na frente |
| `Q` | Poder da sua classe (ver abaixo) |

No celular/tablet: joystick virtual na metade esquerda (empurrar até a borda =
correr), arrastar na metade direita para olhar, e botões usar, pular/escalar,
soco, Q e trocar ferramenta.

### Classes e poderes

O poder é definido pela vaga no lobby (`slot % 4`):

| Classe | Poder `Q` | Efeito | Recarga |
| --- | --- | --- | --- |
| Corredor | Disparada | Velocidade 17 por 0,7 s | 5 s |
| Tanque | Escudo | Dano recebido ÷ 2 por 5 s | 12 s |
| Saltador | Super pulo | Pulo quase 2× mais alto | 6 s |
| Fantasma | Fumaça | Quase invisível por 4 s | 14 s |

### Armas e equipamentos (pickups pela cidade)

| Item | Onde | Efeito |
| --- | --- | --- |
| Pistola de tinta | Padrão | 14 de dano, tiro instantâneo, 34 m |
| Bazuca de tinta | Telhado das torres | 45 de dano em área (4,5 m), 4 disparos |
| Colete | Ruas e telhados de lojas | +50 de armadura |
| Tênis turbo | Ruas | Anda, corre e escala 50 % mais rápido por 12 s |
| Lata 2x | Ruas | Tiles valem o dobro por 15 s |
| Kit | Ruas e telhados | +60 HP |

Pickups reaparecem 15–25 s depois de pegos.

## Como funciona

```mermaid
flowchart TD
    subgraph Browser["Navegador (cada jogador)"]
        HOME["ui/home<br/>lista salas (GET /api/rooms a cada 3 s)<br/>cria (POST) · entra por ID/nome · #r=ID"]
        HOME -->|"join {room, name}"| SC[net/socket]
        IN[Teclado + mouse + toque] --> PH["game/physics 60 Hz<br/>gravidade · colisão AABB · escalada · corrida"]
        PH -->|"pos {x,y,z,rot,anim} 20 Hz"| SC
        IN -->|"paint(tileKey) · shoot(origem,dir)<br/>melee · power · ready"| SC
        SC -->|"welcome · state 20 Hz · eventos"| R["render/scene + render/characters<br/>cidade · 12 personagens · decals · pickups"]
        SC --> HUD["ui/hud (ícones lucide)<br/>placar · vida · armas · kill feed"]
        SH1["shared/city.ts<br/>(mesma seed)"] --> PH
        SH1 --> R
    end

    subgraph Docker["docker compose / Render"]
        subgraph Srv["server (Node 22, porta 8080)"]
            HTTP["http/server.ts<br/>/health · /api/rooms · estáticos de dist/public"]
            REG[("Registro de salas<br/>id · nome · trancada · dono<br/>destruída ao esvaziar")]
            subgraph RoomN["game/room.ts — uma por sala"]
                IO[Socket.IO room id]
                ST[("players · equipes · paint Map<br/>pickups · phase")]
                T["tick() 20 Hz"]
            end
            SH2["shared/city.ts<br/>(mesma seed)"]
        end
        TUN["tunnel (cloudflared)"]
    end

    SC <-->|WebSocket via HTTPS| TUN
    TUN <-->|http://game:8080| HTTP
    HTTP -->|"join: id (qualquer sala) ou nome (só públicas)<br/>1 por navegador (token) · MAX_PER_IP"| REG
    REG --> IO
    IO -->|"pos: clamp + validação<br/>velocidade · sem voar · sem atravessar<br/>inválido → correct()"| ST
    IO -->|"paint: tile existe? dist ≤ 4,5?<br/>cooldown? → score ± valor(altura)"| ST
    IO -->|"shoot: raycast vs prédios + jogadores<br/>splash se bazuca → damage()"| ST
    IO -->|"melee: alcance 2,6 + em frente → stun + dano"| ST
    IO -->|"power: escudo/fumaça no servidor<br/>dash/pulo no cliente"| ST
    SH2 --> IO
    ST --> D{hp ≤ 0?}
    D -->|sim| K["killed: +8 e 20 % pro matador<br/>respawn em 3 s"]
    T --> P{phase}
    P -->|"lobby: ≥2 e todos ready"| CD[countdown 3 s]
    P -->|countdown acabou| PL[playing 180 s]
    P -->|playing acabou| E[ended: ranking]
    P -->|"&lt;2 jogadores"| L[lobby]
    E -->|restart| L
    PL --> PK["pickups: dist ≤ 1,4 → efeito<br/>respawn 15–25 s"]
    PK --> SN["emit state (só para a sala)"]
    K --> SN
    SN --> SC

    subgraph CI["GitHub Actions (push na main)"]
        T1["typecheck · lint · testes"] --> T2[e2e Chrome] --> T3["compose up + túnel + /health"] --> DEP["deploy hook → Render"] --> REL["tag + release"]
    end
    DEP -.->|mesma imagem Docker| Srv
```

Divisão de autoridade: o **servidor** decide tudo que pontua ou fere (pintura,
tiros, socos, pickups, vida, fases) e isola cada sala. O **cliente** simula o
próprio movimento (gravidade, colisão, escalada) e reporta posição; o servidor
checa cada posição contra limites físicos — velocidade máxima (com folga para lag
e empurrões), nada de atravessar prédio, nada de pairar acima de 7 m sem parede ou
telhado por perto (cair é sempre permitido) — e, se não bate, mantém a última
posição válida e manda o cliente voltar (`correct`). A cidade é gerada pela mesma
seed nos dois lados, então o servidor valida qualquer tile que o cliente pedir.

## Estrutura

```
src/
  shared/            código compartilhado servidor ↔ cliente
    city.ts          gerador determinístico da cidade, spawns, pickups, tiles de parede
    protocol.ts      tipos de todos os eventos do socket e da API (fonte única da verdade)
  server/
    index.ts         entrada: serve dist/public e sobe o servidor
    http/server.ts   Express + Socket.IO, /health, /api/rooms, registro e ciclo de vida das salas
    game/room.ts     uma partida: jogadores, pintura, combate, pickups, fases
    game/config.ts   constantes de balanceamento (armas, poderes, pickups, limites)
    game/geometry.ts raycast contra prédios/jogadores e validação de movimento
  client/
    index.html       página, meta tags (Open Graph, favicon, manifest)
    main.ts          loop de simulação (timer) e de render (rAF)
    style.css        HUD, home, lobby, toque
    core/state.ts    estado mutável compartilhado entre módulos do cliente
    net/socket.ts    cliente Socket.IO tipado + handlers dos eventos
    game/physics.ts  física local, câmera, mira
    game/input.ts    teclado, mouse (pointer lock), toque
    render/scene.ts  Three.js: cidade, luzes, decals de spray, pickups, efeitos
    render/characters.ts  12 personagens procedurais e animação
    ui/hud.ts        placar, vida, armas, lobby, fim de partida, kill feed
    ui/home.ts       home: lista/cria/entra em salas, deep link #r=ID
    ui/icons.ts      ícones lucide → SVG inline
    public/          favicon, manifest, imagem Open Graph
test/                node:test — unitário (cidade), integração (socket.io-client), e2e (Chrome)
tools/               harness puppeteer-core: prints do README e apoio ao e2e
.github/workflows    CI/CD: typecheck, lint, testes, e2e, stack Docker, deploy, release
Dockerfile           multi-stage: build (pnpm + tsc + vite) → runtime só com deps de produção
compose.yaml         game + tunnel (Cloudflare Quick Tunnel)
render.yaml          blueprint Render: web service Docker free, health check /health
```

## Stack

- **TypeScript** em tudo (`strict`), sem `any` cruzando o socket: `shared/protocol.ts`
  tipa os dois lados.
- **Servidor**: Node 22 + Express 5 + Socket.IO 4, compilado com `tsc`.
- **Cliente**: Three.js + [lucide](https://lucide.dev) (ícones SVG) empacotados com
  **Vite**. Modelos, prédios, texturas e decals são procedurais — nenhum asset
  externo. Personagens têm esqueleto simples (quadril, joelho, ombro, cotovelo),
  membros em cápsula, rosto, tênis, jaqueta e 12 visuais; `MeshToonMaterial` com
  rampa de 3 tons + contorno por casco invertido nas partes grandes (≈20 meshes
  por personagem, leve mesmo com 12 em cena).
- **pnpm** (corepack) em dev, CI e Docker.
- Outras linguagens: nada no jogo justifica hoje — o custo está no render do
  navegador, não no servidor. A divisão `shared/` deixa o caminho aberto para um
  módulo WASM de física se um dia fizer sentido.

## Testes e CI

| Camada | Comando | O que cobre |
| --- | --- | --- |
| Tipos + lint | `pnpm typecheck` · `pnpm lint` | `tsc --noEmit` nos três alvos; ESLint com typescript-eslint |
| Unitário | `pnpm test` | `shared/city.ts`: determinismo, prédios sem sobreposição e dentro do mapa, spawns fora de prédios, tiles/chaves, valor por altura |
| Integração | `pnpm test` | servidor via socket.io-client: salas (criar, listar só públicas, entrar por ID/nome, trancada só por ID, isolamento, destruição ao esvaziar, IDs sem caracteres ambíguos), um por navegador e por IP, dono (passagem, modo, fechar), equipes (balanceamento, cores, sem fogo amigo, vencedor por equipe), lobby/ready, 13º rejeitado, pintura (alcance, cooldown, roubo), tiros/kill/respawn, bloqueio por prédio, soco, colete/kit, bazuca, escudo, fim/restart, clamp e validação de movimento |
| E2E | `pnpm test:e2e` | dois Chromes headless: home → cria sala trancada (não listada) → entra pelo link → segunda aba recusada → dono troca para equipes e volta → andar (sem correções do servidor) → pichar pela mira → escalar → matar → kill feed → respawn → dono sai e passa a sala → último sai e a sala some |

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) em todo
push/PR na `main`: typecheck + lint + testes → e2e → `docker compose up --build`,
espera `game` healthy, `/health`, página servida, túnel responde de fora. Em push
na `main`, com tudo verde: deploy hook do Render, `/health` na URL pública, e uma
**tag + release** automática (`v<versão>-r<nº do run>`, notas geradas pelo GitHub).

## Deploy (Render, plano free)

Host: **Render** free web service (Docker). Custo zero, WebSocket nativo, roda o
`Dockerfile` como está. Pegadinha do free: dorme após ~15 min sem acesso e o
primeiro acesso demora 30–50 s. Estado vive em memória: sempre uma instância só.
O túnel do Cloudflare continua sendo o caminho do hackathon (`docker compose`);
no Render a URL é direta: <https://graffiti-de-madrugada.onrender.com>.

Configuração única (painel do Render, sem cartão): **New → Blueprint** → este
repositório → o [`render.yaml`](render.yaml) cria o serviço (auto-deploy desligado:
quem publica é o CI). Depois, no serviço: **Settings → Deploy Hook → copiar** e
`gh secret set RENDER_DEPLOY_HOOK`. Se o domínio for outro:
`gh variable set RENDER_URL --body https://SEU.onrender.com`.

## Fora do escopo

Login, ranking persistente, áudio, física completa no servidor (o servidor valida
plausibilidade, não simula), persistência de salas entre reinícios.
