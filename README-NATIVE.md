# AeroBuilder — Web + Native Android (Capacitor)

> **Projenin tamamı, mimarisi ve veri akışı için: [`PROJE-DOKUMAN.md`](./PROJE-DOKUMAN.md)**

Bu depo iki ayrı çıktı üretir:

| Çıktı | Ne | Nerede |
|---|---|---|
| **Web** | Vite build (`dist/`) → Node statik sunucu | `http://0.0.0.0:1932` |
| **Android APK** | Native Android uygulaması (Capacitor 7, Kotlin iskelet + gömülü asset) | `android/app/build/outputs/apk/release/app-release.apk` |

APK **web servisine bağımlı değildir**: tüm JS/CSS/asset'ler APK'nın içine gömülüdür
(`android/app/src/main/assets/public`), uygulama internet olmadan açılır. Herhangi bir
siteye yönlendirme, iframe veya `server.url` ayarı yoktur.

## Web servisi (port 1932)

systemd kullanıcı servisi: `aeroplan-web.service`

```bash
systemctl --user status aeroplan-web.service
systemctl --user restart aeroplan-web.service
journalctl --user -u aeroplan-web.service -n 50 --no-pager
```

- Yerel: <http://127.0.0.1:1932>
- Yerel ağ: <http://192.168.1.164:1932>
- Geliştirme modu (HMR): `npm run dev` → aynı port 1932 (`vite.config.ts` içinde sabit)
- Sunucu kodu: `server.mjs` (SPA fallback + gzip + immutable cache headers)

> Not: Port 1932 daha önce `web-pentesting-project` (Pentest Kütüphanesi) tarafından
> kullanılıyordu; o servis **1933**'e taşındı. Kütüphane: <http://127.0.0.1:1933>

## APK üretimi

```bash
./build-apk.sh          # build + cap sync + assembleRelease
```

veya elle:

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease --no-daemon
```

### İmzalama
- Keystore: `android/keystore/aeroplan-release.jks` (alias `aeroplan`)
- Şifre: `android/keystore/README.txt` içinde
- Gradle ayarı: `android/keystore.properties` (git'e eklenmemeli)

### Cihaza kurulum
```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## Uygulama bilgileri

- Paket adı: `com.sinasi.aeroplan`
- Görünen ad: **AeroBuilder**
- minSdk 23 (Android 6+) / targetSdk 35
- Sürüm: 1.1 (versionCode 2)
- İkon + splash: `android/app/src/main/res/mipmap-*` ve `drawable-*/splash.png`
  (kaynak logo: `src/components/AppLogo.tsx` içindeki SVG path)

## Dil desteği (Türkçe eklendi)

8 dil: pt, **tr**, en, es, fr, it, zh, hi

- Çeviri dosyası: `src/locales/tr.ts` (536 anahtar, `en.ts` ile birebir aynı anahtar seti;
  `Dict` tipi sayesinde eksik anahtar derleme hatası verir)
- Dil listesi / kayıt: `src/i18n.ts` → `LANGUAGES` + `resources`
- SEO sayfası: `dist/tr/index.html` (başlık, açıklama, hreflang, sitemap) →
  `seo/seo.json` + `seo/seoPlugin.ts`
- OG görseli: `public/og/og-tr.png`
- Dil seçimi: URL (`/tr/`) → kayıtlı tercih (`localStorage aerobuilder_lang`) →
  tarayıcı/cihaz dili → İngilizce. APK'da cihaz dili Türkçe ise uygulama
  **otomatik Türkçe** açılır; üst çubuktaki 🌐 menüsünden de değiştirilebilir.
- Çeviri terim sözlüğü: kanat açıklığı, kök/uç veter, ortalama aerodinamik veter (MAC),
  nötr nokta, statik marj, narinlik oranı, kuyruk moment kolu, geçme boşluğu,
  yatay/dikey stabilize, gövde, uçan kanat, elevon, kiriş (spar), kaburga…
  Marka/model adları (Clark-Y, NACA 4412, MH45, LW-PLA, STL, ESC) korunmuştur.


## Gövde tipleri (9 stil + Özel)

Tek kaynak: `src/utils/geometry.ts` → **`FUSE_PROFILES`** tablosu. Her satır bir reçete:

| Stil | expo | burun | kuyruk daralma (G/Y) | zarf (wf/hf) | kanat |
|---|---|---|---|---|---|
| `trainer` | 6 | 0.85 | 0.65 / 0.55 | 1 / 1 | yüksek |
| `sport` | 2.4 | 0.62 | 0.65 / 0.55 | 1 / 1 | orta-alçak |
| `pod` | 3.2 | 0.70 / 0.56 | 0.50 / 0.45 | 1.18 / 0.70 | yüksek |
| `slab` | 6 | 0.90 | 0.20 / 0.10 | 1 / 0.32 | gövde içinden |
| `boom` | 2.0 | 0.55 | 0.78 / 0.78 | 1 / 1 | yüksek |
| `box` | 9 | 0.85 / 0.80 | 0.15 / 0.20 | 1.05 / 1 | yüksek |
| `egg` | 2.2 | 0.55 | 0.70 / 0.65 | 1 / 1 (+bulge 0.22) | yüksek |
| `faceted` | 1.25 | 0.50 | 0.50 / 0.50 | 1.08 / 0.95 | yüksek |
| `custom` | dims | dims | dims | 1 / 1 | yüksek |

- `expo` = enine kesitin superellipse üssü: **1.2 elmas · 2 elips · 3 yassı oval · 6 köşeli · 9 kare**
- `rise` > 0 → kuyruk bomunun merkez çizgisi yükselir (sport, boom)
- `bulge` → gövde ortasında tam kesit (egg)
- **`custom`** dört boyuttan okunur: `fuseExpo` (1.2–9), `fuseNose` (0.3–0.98),
  `fuseTailW` / `fuseTailH` (0–0.85). UI'da "Özel" seçilince 4 alan açılır.
- Çözülmüş üs `Layout.fuselage.expo` içinde taşınır → mesh, STL, 2B çizim, kapaklar
  hepsi aynı değeri kullanır (hardcoded kalmadı).
- Yüksek kanat kararı: `isHighWing(style)` → `FUSE_PROFILES[style].highWing`

Yeni stil eklemek: `calculations.ts` → `FuselageType` union, `geometry.ts` → `FUSE_PROFILES`
satırı, `Sidebar.tsx` → `<option>`, `locales/*.ts` × 8. Başka yere dokunmak gerekmez.

## 3B istasyon düzenleyici (elle gövde şekillendirme)

3B görünümde gövdeye dokun/tıkla → o kesit seçilir (saydam halka) → panelden
genişlik / yükseklik / merkez kayması ayarlanır. Değişiklik **o bölgede yereldir**.

Veri modeli (`src/utils/fuseStations.ts`):

```ts
dims.fuseStations?: { s: number; w: number; h: number; dy?: number }[]
// s  = uzunluğun kesri (0 burun … 1 kuyruk sonu)  → cm/mm geçişinde kaymaz
// w  = genişlik çarpanı (0.4 … 2.0)
// h  = yükseklik çarpanı (0.4 … 2.0)
// dy = merkez kayması (H'nin kesri, ±0.4)
```

- **İnterpolasyon: PCHIP** (monotone cubic). Catmull-Rom taşma yapıp istenmeyen
  şişkinlik üretirdi; PCHIP kontrol noktaları arasında taşmaz (test: 0.6…1.6 aralığı
  korunuyor). İlk/son nokta dışında değer sabit tutulur.
- **Yerelleştirme**: tek nokta tüm gövdeyi ölçeklerdi (sabit tutma yüzünden). Bu yüzden
  `addStationLocalized()` noktanın iki yanına ±0.12'de **nötr çapa** koyar → düzenleme
  bir tümsek olur, global ölçek olmaz.
- **Tek darboğaz**: `computeLayout().fuselage.section()`. 3B mesh, STL, 2B çizim, PDF,
  kapak/dübel yerleşimi, ağırlık-denge hepsi buradan okur → deformasyon her yere tutarlı yansır.
- **STL**: kontrol noktaları baskı kesitlerine gerçek halka olarak eklenir
  (`printParts.ts`), yoksa 12 istasyonluk örnekleme şekli yumuşatıp yutardı.
- **Mesh örnekleme**: istasyon varken 36 → 56 halka.
- **Uyarılar** (`printParts.ts`): `stl_warn_fuse_pinch` (kesit < 12 mm → Ø6 pim + duvarlar
  sığmaz) ve tablaya sığmama kontrolü artık **gerçek kesitlerden** hesaplanıyor
  (nominal W/H yerine), çünkü istasyon 2× genişletince nominal değer yanıltıyordu.
- **Arayüz**: masaüstünde sağ alt kart, mobilde tam genişlik **alt sayfa** (%62 yükseklik
  sınırı, `overflow-y-auto`, 32 px slider). Panel yalnızca 3B görünümde.
- **Kalıcılık**: `normalizeDims()` dizi alanını ayrı taşır (aksi hâlde yenilemede ve
  paylaşım linkinde kayboluyordu).

Test: `playwright` ile uçtan uca doğrulandı — panel açılışı, slider → mesh yeniden
kurulumu (piksel farkı), 3 kontrol noktası, sayfa yenileme sonrası kalıcılık, sıfırlama,
mobil yerleşim, konsol hatası yok.

## Geliştirme notları (Capacitor)

- Capacitor 8 Node 22 istediği için **Capacitor 7** kullanılıyor (makinede Node 20).
- Web tarafında değişiklik yaptıktan sonra APK'ya yansıması için `npx cap sync android` şart.
- `useVersionCheck` hook'u `/version.json` isteğini APK içindeki gömülü dosyadan yapar;
  sürüm aynı olduğu için reload döngüsü oluşmaz.
- Google Analytics / consent kodu offline'da sessizce devre dışı kalır (hata vermez).
