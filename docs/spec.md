# Especificação do jogo

## Identidade

- **Nome do jogo:** Graffiti de Madrugada
- **Elevator pitch:** De 2 a 12 pichadores disputam uma cidade 3D aberta por 3 minutos: pichar paredes altas vale mais, escalar prédios dá equipamento, armas de tinta e poderes derrubam rivais.
- **Participantes:** 2–12 jogadores, 12 modelos de personagem distintos
- **Estilo:** 3D (Three.js), câmera em terceira pessoa
- **Bibliotecas escolhidas:** Node 22, Express 5, Socket.IO 4, Three.js; node:test + socket.io-client para testes
- **Porta interna do jogo:** 8080

## Partida

- **Objetivo do jogador:** ter mais pontos ao fim da noite.
- **Como vence:** maior pontuação (tiles pichados ponderados por altura + kills).
- **Como perde ou é eliminado:** morrer custa 20 % dos pontos e 3 s de respawn; não há eliminação.
- **Duração esperada:** 3 s de contagem + 3 min.
- **Como começa uma nova partida:** lobby com nomes; todos clicam "Pronto"; ao final, "Voltar ao lobby".

## Mecânicas

- **Controles:** WASD, mouse, Espaço (pulo/escalada), clique (spray/tiro), 1/2 (trocar), F (soco), Q (poder).
- **Ação competitiva principal:** pichar/roubar tiles de parede; derrubar rivais com pistola, bazuca, soco.
- **Pontuação, dano ou progresso:** tile = 1 + altura/6; kill = +8 + 20 % da vítima; HP 100, colete, kits.
- **Estado que todos devem enxergar em tempo real:** posição/animação, tiles pintados, HP/colete, placar, fase, timer, pickups, kill feed, efeitos de poder.

## Escopo de implementação

- **Marco 1:** lobby com nomes e "Pronto"; dois jogadores se veem na cidade. ✅
- **Marco 2:** movimento, escalada, pintura validada no servidor, combate, pickups, poderes. ✅
- **Marco 3:** vitória, ranking, volta ao lobby. ✅
- **Marco 4:** `docker compose up --build` + tunnel; README; testes automatizados. ✅
- **Se sobrar tempo:** áudio, toque, minimapa.
- **Fora do escopo:** login, ranking persistente, física no servidor, anti-cheat.
