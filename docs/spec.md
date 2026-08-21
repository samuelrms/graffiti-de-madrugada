# Especificação do jogo

## Identidade

- **Nome do jogo:** Graffiti de Madrugada
- **Elevator pitch:** De 2 a 12 pichadores disputam um muro por 90 segundos; andar picha, empurrão derruba a lata do rival; maior área vence.
- **Participantes:** 2–12 jogadores
- **Estilo:** 2D (canvas)
- **Bibliotecas escolhidas:** Node 22, Express 5, Socket.IO 4, Canvas 2D puro
- **Porta interna do jogo:** 8080

## Partida

- **Objetivo do jogador:** pichar a maior área do muro.
- **Como vence:** mais pedaços de muro com a sua cor quando o tempo acaba.
- **Como perde ou é eliminado:** não há eliminação; perde quem tem menos área.
- **Duração esperada:** 3 s de contagem + 90 s.
- **Como começa uma nova partida:** botão "Outra noite" na tela final; partida inicial começa sozinha com 2 jogadores.

## Mecânicas

- **Controles:** WASD / setas para andar; Espaço para empurrão. Botões de toque no celular.
- **Ação competitiva principal:** pichar por cima do spray do rival (rouba ponto) e empurrão que atordoa por 0,9 s.
- **Pontuação, dano ou progresso:** 1 ponto por pedaço de muro; roubar tira 1 do rival.
- **Estado que todos devem enxergar em tempo real:** posição, grid de cores, placar, timer, fase, atordoamento, vencedor.

## Escopo de implementação

- **Marco 1:** dois jogadores entram na mesma sala e se enxergam. ✅
- **Marco 2:** movimento, pichação e empurrão funcionam. ✅
- **Marco 3:** vitória, empate e reinício funcionam. ✅
- **Marco 4:** `docker compose up --build` inicia o projeto; README contém as instruções. ✅
- **Se sobrar tempo:** som, efeito de spray mais rico, sol nascendo no fim.
- **Fora do escopo:** login, ranking, persistência, power-ups, mapas, salas múltiplas.
