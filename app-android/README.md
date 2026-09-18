# App Android do entregador (APK)

O APK é uma "casca" nativa (Capacitor) que abre a página `/entregador.html` do seu servidor
e adiciona **rastreio GPS em segundo plano** (continua enviando a posição com a tela apagada
ou com o Google Maps/Waze aberto por cima). Como o conteúdo vem do servidor, você atualiza o
app só publicando no Render — não precisa gerar APK novo a cada mudança.

## Pré-requisitos (no seu computador)
1. Node.js 18+ — https://nodejs.org
2. Android Studio (com SDK e JDK 17) — https://developer.android.com/studio

## Gerar o APK (uma vez)
```bash
cd app-android
# 1) confira a URL do seu servidor em capacitor.config.json (campo server.url)
npm run setup          # instala dependências e cria a pasta android/
```
Depois:
1. Abra `android/app/src/main/AndroidManifest.xml` e cole as permissões de `AndroidManifest-permissoes.xml` dentro de `<manifest>`.
2. `npm run open` abre o Android Studio → menu **Build ▸ Build Bundle(s)/APK(s) ▸ Build APK(s)**
   (ou `npm run apk` no terminal). O arquivo fica em `android/app/build/outputs/apk/debug/app-debug.apk`.
3. Mande o `app-debug.apk` pelo WhatsApp para o entregador. No celular: abrir o arquivo → permitir
   "instalar de fontes desconhecidas" → instalar.

## No celular do entregador (importante para o rastreio funcionar)
- Ao abrir, aceitar localização e escolher **"Permitir o tempo todo"**
  (Ajustes ▸ Apps ▸ De Pratas Entregador ▸ Permissões ▸ Localização ▸ O tempo todo).
- Bateria: Ajustes ▸ Apps ▸ De Pratas Entregador ▸ Bateria ▸ **Sem restrições**.
- Em Xiaomi/Samsung, ativar "Início automático" / desligar "otimização de bateria" para o app.

## Sem APK (alternativa rápida)
O entregador pode abrir `https://rotas-de-pratas.onrender.com/entregador.html` no Chrome do celular e
usar **"Adicionar à tela inicial"**. Funciona igual, mas o GPS só envia enquanto o app está
aberto na tela (o app mantém a tela acesa para ajudar).
