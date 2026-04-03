# Çok oyunculu lobi (2–6 kişi)

WebSocket ile oda kurma, kod ile katılma, isim verme ve liderin başlatması.

## Çalıştırma (localhost)

Lobi hem **Vite** hem **WebSocket sunucusu** ister. Tek komut:

```bash
npm install
npm start
```

Tarayıcıda aç: **http://localhost:5173/**

Sadece `npm run dev` çalıştırırsan WebSocket olmaz; sayfa bağlanamaz. Alternatif: iki terminalde `npm run lobby-server` ve `npm run dev`.

Telefondan aynı ağda test için Vite çıktısındaki **Network** adresini kullan (ör. `http://192.168.1.x:5173/`).

Sayfada **Oyun adresi** satırında paylaşılacak tam URL de gösterilir; yayına aldığında orası canlı linkin olur.

İlk açılışta **Mobil** veya **PC** seçilir; düzen buna göre ayarlanır (tercih tarayıcıda saklanır). **Cihazı değiştir** ile tekrar seçebilirsin.

Sadece sunucu: `npm run lobby-server`

## GitHub Pages

Statik site WebSocket sunucusu içermez; canlı lobide oynamak için `ws`/`wss` sunucusunu ayrı host’ta çalıştırın ve derlemede `VITE_LOBBY_WS_URL` ile adresi verin.

## Deploy

Workflow `.github/workflows/deploy-pages.yml` `npm run build` çıktısı olan `dist/` klasörünü yayınlar.
