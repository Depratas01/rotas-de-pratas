# Rotas De Pratas — painel de entregas + app do entregador

Sistema próprio, no estilo do "Rotas AZ", com:

- **Painel (rotas.html)** — mapa com entregadores **ao vivo**, entregas por status (Na loja → Com entregador → Em rota → Entregue), despacho por entregador, "+ Endereço" com localização automática no mapa, **trajeto do dia** de cada entregador, tabela de entregas do dia com horários e cadastro de entregadores (telefone + PIN).
- **App do entregador (entregador.html + APK Android)** — login com telefone e PIN, lista de entregas, botões Google Maps / Waze / Ligar / WhatsApp, "Saí para entregar", "Entregue", "Não consegui entregar" e envio de GPS em tempo real (com o APK, também em segundo plano).

## Rodar no computador (teste)
```bash
npm install
ADMIN_SENHA=minhasenha npm start
```
Abra http://localhost:3000/rotas.html (painel) e http://localhost:3000/entregador.html (app).

## Publicar no Render
1. Suba esta pasta num repositório no GitHub.
2. No Render: **New ▸ Blueprint** → escolha o repositório (ele lê o `render.yaml`).
3. Preencha a variável **ADMIN_SENHA** (senha do painel).
4. Pronto: `https://SEU-APP.onrender.com/rotas.html`.

> Plano gratuito do Render não tem disco persistente — os dados somem a cada deploy/reinício.
> Para manter o histórico, use o plano Starter com um disco montado em `/var/data` e defina `DB_PATH=/var/data/rotas.db`.

## Variáveis de ambiente
| Variável | Para quê | Padrão |
|---|---|---|
| `ADMIN_SENHA` | senha do painel | `depratas` (troque!) |
| `DB_PATH` | onde fica o banco SQLite | `./data/rotas.db` |
| `LOJA_NOME`, `LOJA_LAT`, `LOJA_LNG`, `LOJA_CIDADE` | posição da loja no mapa e cidade usada para achar endereços | De Pratas / Campo Grande, MS |

Ajuste `LOJA_LAT`/`LOJA_LNG` para o endereço real da loja (no Google Maps: botão direito no local → as coordenadas aparecem no topo).

## Fluxo do dia a dia
1. Painel ▸ **Entregadores** ▸ cadastre nome, telefone e PIN. Mande ao entregador o link do app (ou o APK — veja `app-android/README.md`).
2. **+ Endereço** para cada pedido (nº do pedido, cliente, endereço, valor, pagamento). O sistema localiza o endereço no mapa (OpenStreetMap); se não achar, edite e complete o endereço.
3. Marque as entregas ▸ **Despachar para…** ▸ entregador ▸ OK. Elas aparecem na hora no celular dele.
4. O entregador toca **Saí para entregar** (fica azul "Em rota") e **Entregue** (verde). Você vê a moto se movendo no mapa; clique nela ▸ **Ver trajeto do dia**.
5. Aba **Entregas do dia** mostra horários de despacho, saída e entrega, e o total.

## API (para integrar com o app de cupom / Shopify depois)
- `POST /api/admin/login {senha}` → `{token}` (enviar em `x-admin-token`)
- `POST /api/admin/entregas {numero, cliente, telefone_cliente, endereco, referencia, valor, pagamento, obs}`
- `GET /api/admin/entregas?data=AAAA-MM-DD`, `GET /api/admin/entregadores/posicoes`, `GET /api/admin/entregadores/:id/trajeto?data=`
- `POST /api/admin/entregas/despachar {ids:[...], entregador_id}`
