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

## Cupom automático dos pedidos do site (Shopify)
Tela **`/cupom.html`**: fica aberta no computador da loja e imprime sozinha, na térmica 80 mm, cada pedido **pago** do depratas.com.br (confere a cada 15 s). Depois de imprimir, o pedido ganha a etiqueta `cupom-impresso` na Shopify — não repete cupom e nada se perde se o servidor reiniciar. Pedido pendente imprime quando o pagamento for confirmado; cancelado não imprime.

**1. App na Shopify (uma vez):** dev.shopify.com → *Apps* → *Criar app* → nome "Cupom De Pratas" → na versão do app, escopos `read_orders` e `write_orders` → *Lançar* → *Instalar* na loja. Em *Configurações* copie **Client ID** e **Client secret**.

**2. Render:** no serviço do Rotas ▸ *Environment*, adicione `SHOPIFY_CLIENT_ID` e `SHOPIFY_CLIENT_SECRET` (e `SHOPIFY_LOJA=jvgbjv-ti`). Salve (o Render reinicia sozinho).

**3. Computador da loja (Windows):** deixe a térmica como *impressora padrão* (papel 80 mm). Crie um atalho do Chrome com destino:
`"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://de-pratas.onrender.com/cupom.html`
Feche todo Chrome aberto, abra pelo atalho, entre com a senha do painel e clique **Ligar impressão automática**. Use **Cupom de teste** para conferir. Para abrir junto com o Windows, coloque o atalho em `shell:startup`.
