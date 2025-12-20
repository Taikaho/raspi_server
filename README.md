# Kotiserveri – Backend

Tämä projekti on Raspberry Pi:llä ajettava backend älykoti- ja IoT-järjestelmälle.  
Backend tarjoaa REST- ja WebSocket-rajapinnat sensori­datan vastaanottoon, reaaliaikaiseen jakeluun sekä myöhemmin laiteohjaukseen.

## Tavoite

- Kerätä sensoridataa (esim. lämpötila, kosteus, ilmanlaatu)
- Tarjota data iPhone-sovellukselle ja muille asiakkaille
- Mahdollistaa reaaliaikainen päivitys WebSocketin kautta
- Toimia pohjana etäohjattavalle älykodille

## Teknologiat

- Node.js
- TypeScript
- Fastify
- JWT-autentikointi
- WebSocket
- Raspberry Pi (kehitys- ja ajoympäristö)
