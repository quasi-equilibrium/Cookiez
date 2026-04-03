# Çok oyunculu lobi (2–6 kişi)

WebSocket ile oda kurma, kod ile katılma, isim verme ve liderin başlatması.

## Çalıştırma

```bash
npm install
npm run dev:all
```

Tarayıcı: `http://localhost:5173/` (Vite, `/lobby-ws` isteğini `8765` portuna yönlendirir). Sayfada **Oyun adresi** satırında paylaşılacak tam URL de gösterilir; yayına aldığında orası canlı linkin olur.

İlk açılışta **Mobil** veya **PC** seçilir; düzen buna göre ayarlanır (tercih tarayıcıda saklanır). **Cihazı değiştir** ile tekrar seçebilirsin.

Sadece sunucu: `npm run lobby-server`

## GitHub Pages

Statik site WebSocket sunucusu içermez; canlı lobide oynamak için `ws`/`wss` sunucusunu ayrı host’ta çalıştırın ve derlemede `VITE_LOBBY_WS_URL` ile adresi verin.

## Deploy

Workflow `.github/workflows/deploy-pages.yml` `npm run build` çıktısı olan `dist/` klasörünü yayınlar.
