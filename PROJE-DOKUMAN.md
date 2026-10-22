# AeroBuilder — Proje Dokümanı

> Bu dosya projeyi **sıfırdan devralan biri** için yazıldı: ne yapar, nasıl çalışır,
> hangi dosya neyi yapar, nasıl derlenir/çalıştırılır, nerede tuzak var.
> İngilizce upstream README (`README.md`) orijinal projedir; bu dosya **bizim forkumuzun**
> (Türkçe + 3B istasyon düzenleyici + native APK) gerçek durumunu anlatır.
> Kurulum/APK ayrıntıları: `README-NATIVE.md`.

---

## 1. Proje nedir

RC model uçak **tasarım ve üretim** uygulaması. Kullanıcı kanat açıklığı, veter, gövde
ölçüleri gibi ~20 sayısal değeri girer; uygulama:

1. aerodinamik metrikleri hesaplar (alan, MAC, nötr nokta, statik marj…),
2. tasarımı doğrular (uyarı/hata listesi),
3. 2B teknik çizim ve 3B model üretir,
4. ağırlık–denge analizi yapar (servo/batarya/pil yerleşimi, CG),
5. **3D baskıya hazır STL parçaları** ve **1:1 PDF şablonları** dışa aktarır.

İki çıktı hedefi var: web (port 1932) ve **native Android APK** (Capacitor, gömülü asset).

- Uygulama tamamen **istemci tarafı** — hesap/veritabanı yok, backend yok.
- Lisans MIT, orijinal yazar Álvaro Severo Marcus (`LICENSE`).

---

## 2. Teknoloji yığını

* **React 19** + **TypeScript 6** + **Vite 8** (build/dev)
* **three.js 0.184** + **@react-three/fiber 9** + **@react-three/drei 10** → 3B
* **Tailwind 3** (utility CSS), **lucide-react** (ikonlar)
* **i18next / react-i18next** → 8 dil
* **jspdf** → PDF, **fflate** → STL'leri zip'leme
* **Capacitor 7** → native Android kabuğu (Kotlin iskeleti + `dist/` gömülü)

---

## 3. Hızlı başlangıç

```bash
cd ~/Projeler/airplane_model

npm run dev        # HMR geliştirme, http://0.0.0.0:1932
npm run build      # tsc -b && vite build → dist/
./build-apk.sh     # build + cap sync + assembleRelease (imzalı APK) + web servisini restart
```

Servis:

```bash
systemctl --user status  aeroplan-web.service
systemctl --user restart aeroplan-web.service
journalctl --user -u aeroplan-web.service -n 50 --no-pager
```

- Yerel: <http://127.0.0.1:1932>
- Ağ: <http://192.168.1.164:1932>

> Port 1932 daha önce pentest kütüphanesindeydi, o **1933**'e taşındı.

---

## 4. Veri akışı (tek yön, tek kaynak)

```
App.tsx  (tek state sahibi)
   │  dimensions, unit, aircraftType, airfoil, fuselageStyle,
   │  propeller, controls, components, printSettings, propCutout
   ├─► calculateMetrics()      → AircraftMetrics
   ├─► validateDesign()        → ValidationCheck[]
   ├─► computeLayout()         → Layout        ★ tüm geometrinin tek kaynağı
   │      (tailType: conventional | t_tail | v_tail | inverted_v | cruciform)
   ├─► computeBalance(Layout)  → BalanceResult (ağırlık, CG, servo/pil yerleşimi)
   │      └─► cutoutsFromBalance() → Pocket[] (kesme yuvaları)
   ├─► CanvasView(Layout)      2B çizim
   ├─► Scene3D(Layout, …)      3B mesh + istasyon düzenleyici
   ├─► StlExportDialog          baskı planı + STL zip
   └─► exportToPDF()           teknik doküman
```

**Altın kural:** geometri hiçbir yerde yeniden hesaplanmaz. 2B, 3B, STL, PDF, kapak ve
dübel yerleşimi hepsi `computeLayout()` çıktısındaki aynı `Layout` nesnesini okur.
Bir ölçü mantığını değiştireceksen **sadece `geometry.ts`**'ye dokun; aksi hâlde
görünümler birbiriyle tutarsız hâle gelir.

`Layout` bir "çözülmüş" modeldir: birim dönüşümü, gövde profili (superellipse üssü),
kanat/kuyruk yerleşimi, motor yönü, uçan kanat için motor oyuğu (`teCut`), CG/NP
istasyonları ve görünüm sığdırma sınırları (`bounds`, yerel birimde) hazır olarak taşınır.

---

## 5. Dizin haritası

| Dosya | Sorumluluk |
|---|---|
| `src/main.tsx` | React mount |
| `src/App.tsx` | **Tek state sahibi**; kalıcılık, paylaşım linki, tema, dil, dialoglar |
| `src/i18n.ts` | 8 dilin kaydı, dil seçim sırası (URL → localStorage → cihaz → en) |
| `src/locales/{tr,en,es,fr,it,pt,zh,hi}.ts` | Çeviri sözlükleri (`Dict` tipi eksik anahtarı derleme hatası yapar) |
| `src/utils/calculations.ts` | `AircraftDimensions`, presetler, `calculateMetrics`, `validateDesign`, birim dönüşümü (`dimsInUnit`, `normalizeDims`), kontrol yüzeyi temizleme |
| `src/utils/geometry.ts` | **`computeLayout()`** + `FUSE_PROFILES` (gövde stilleri), `aileronOutline`, kuyruk reçetesi çözümü |
| `src/utils/fuseStations.ts` | Manuel gövde istasyonları: veri modeli, PCHIP interpolasyon, yerelleştirme, birleştirme/silme |
| `src/utils/airfoils.ts` | **Kanat profilleri** (8 adet) + `AirfoilSpec` çözümü (`"clarky@14"`), kalınlık ölçekleme, kesit örnekleme (`airfoilSegment`) |
| `src/utils/mesh.ts` | `loftRings()` (halka → kapalı katı), `buildAircraftParts()` → 3B parçalar |
| `src/utils/components.ts` | Servo/batarya kataloğu, ağırlık tablosu, `computeBalance()`, `cutoutsFromBalance()` |
| `src/utils/assembly.ts` | Kanat bağlantısı (lastik bant / yapıştırma), dübel çapı, bant sayısı |
| `src/utils/printParts.ts` | **Baskı planı**: gövde/kanat/kuyruk parçalarını tabla boyutuna göre dilimler, kiriş (spar) delikleri, uyarılar |
| `src/utils/printables.ts` | Kiriş, bilezik, koruyucu gibi ek parçalar |
| `src/utils/stlExport.ts` | Baskı yönüne çevirme (`orientForPrint`), ikili STL üretimi (`buildStlFiles`), zip'leme |
| `src/utils/db.ts` | **Tek IndexedDB açıcısı** (`aerobuilder_archive`, v2): `sets` + `blobs` + `models` store'ları |
| `src/utils/plateLayout.ts` | **Tabla yerleşimi**: parçaları çakışmadan satırlara dizer, tabla dolunca yeni tablaya (sayfaya) geçer |
| `src/utils/stlArchive.ts` | **Yerel STL arşivi** (IndexedDB): kaydet/listele/sil/yeniden adlandır, küçük resim, depolama bilgisi |
| `src/utils/modelLibrary.ts` | **Model kütüphanesi**: adlandırılmış proje anlık görüntüleri, son 5 sürüm, JSON dışa/içe aktarma, 3B küçük resim |
| `src/utils/pdfExport.ts` | 1:1 şablonlu teknik PDF |
| `src/utils/electricSystem.ts` | Motor/pervane önerisi, itki-güç hesabı |
| `src/utils/examples.ts` | Hazır örnek projeler |
| `src/utils/calculations.ts` | `TailType` + `TAIL_TYPES` reçetesi (kuyruk tipleri) |
| `scripts/check-airfoil.ts` | Profil/kalınlık testi: doğal kalınlık, hedef kalınlık, kamera hattı korunumu, mesh + baskı + denge hattı |
| `scripts/check-airfoil-ui.cjs` | Headless: profili seç → kalınlık slider'ı → `naca2412@15` kalıcılığı, kesit önizleme, konsol hatası |
| `scripts/check-tail.ts` | Kuyruk geometrisi + klasik kuyruk sayısal regresyon testi |
| `scripts/check-tail-runtime.ts` | Mesh + baskı planı + denge duman testi (5 tip) |
| `scripts/visual-check.cjs` | Headless Chromium: seçici, 3B render, kalıcılık, konsol hatası |
| `src/utils/share.ts` | Projeyi URL `#p=` içine sıkıştırıp paylaşma (base64 + deflate) |
| `src/utils/consent.ts` / `analytics.ts` | KVKK onayı + GA (onay yoksa tamamen sessiz) |
| `src/hooks/useVersionCheck.ts` | `/version.json` ile yeni sürüm kontrolü (APK'da döngü yapmaz) |
| `src/components/Header.tsx` | Üst bar: model kütüphanesi, **STL arşivi**, **STL görüntüleyici** (bağımsız butonlar), preset, 2B/3B, dil, paylaş, Dışa Aktar menüsü (yalnız STL/PDF), ayarlar |
| `src/components/Sidebar.tsx` | Ölçü girişleri, kanat profili, gövde stili, motor bölümü, montaj bölümü |
| `src/components/KpiBar.tsx` | Özet metrik şeridi + uyarı sayacı |
| `src/components/CanvasView.tsx` | 2B teknik çizim (SVG/canvas), ölçülendirme |
| `src/components/Scene3D.tsx` | 3B sahne, parça mesh'leri, bileşenler, **istasyon seçimi + düzenleyici panel** |
| `src/components/InsightsDrawer.tsx` | Sağ detay çekmecesi (aero / ağırlık / elektrik sekmeleri) |
| `src/components/MassBalancePanel.tsx`, `PowerSection.tsx`, `AssemblySection.tsx` | Ağırlık-denge, güç sistemi, montaj panelleri |
| `src/components/StlExportDialog.tsx` | Baskı tablası seçimi, boşluk (clearance), özet, STL indirme, **arşive kaydetme** |
| `src/components/StlArchiveDialog.tsx` | Arşiv galerisi: arama/sıralama, küçük resim, ZIP indirme, projeyi geri yükleme, silme |
| `src/components/StlViewer.tsx` | **STL görüntüleyici**: arşivden veya diskten `.stl`, tel kafes/kenar/ızgara, otomatik sığdırma |
| `src/components/ModelLibraryDialog.tsx` | **Modellerim**: galeri, kaydet/üzerine yaz, çoğalt, yeniden adlandır, sürüm geçmişi, JSON içe/dışa |
| `scripts/check-plate.cjs` | Headless test: tabla düzeni çakışma/taşma kontrolü + görüntüleyici modları |
| `scripts/check-archive.cjs` | Headless test: arşive kaydet → galeri → görüntüleyici akışı, konsol hatası kontrolü |
| `server.mjs` | Üretim statik sunucu: SPA fallback + gzip + immutable cache |

---

## 6. Hesaplama hattı — adım adım

### 6.1 Metrikler (`calculateMetrics`)
Girdi: `AircraftDimensions` + tip + kontrol yüzeyleri. Çıktı: kanat alanı, en-boy oranı,
MAC ve konumu, nötr nokta, statik marj, kanat yüklemesi, tahmini süratler…
Tüm uzunluklar **girilen birimde** kalır; `toCm` yalnızca çizim/sahne katmanında uygulanır.

### 6.2 Doğrulama (`validateDesign`)
Kural tabanlı `ValidationCheck[]` (seviye: `stable | warning | unstable`): CG penceresi
(`CG_WINDOW_CONVENTIONAL`), statik marj aralığı (`SM_RANGE`), kuyruk hacmi, kanat
yüklemesi, geometrik tutarlılık…

### 6.3 Yerleşim (`computeLayout`)
- **Gövde**: `FUSE_PROFILES[style]` reçetesi (superellipse üssü, burun daralması, kuyruk
  daralması, zarf, yükselen bom, orta şişkinlik). `custom` stili 4 ölçüden okunur.
  Sonuç fonksiyonu `fuselage.section(s) → {w, h, yc}`.
- **Kanat/kuyruk**: kök/uç veter, ok açısı, dihedral; `chordAt / leAt / teAt / yAt`
  yardımcıları span kesrine göre interpolasyon yapar.
- **Kuyruk tipi**: `TAIL_TYPES` reçetesi (calculations.ts) tek kaynaktır —
  `vAngleDeg` (panel V açısı), `fin` (dikey fin var mı), `stabOnFinTop` (T kuyruk),
  `ventralFrac` (haç kuyruk alt fin), `effFactor` (kuyruk verimi). `computeLayout`
  bunları `hStab.rollRad`, `hStab.y`, `fin.ventral` ve `layout.tail` alanlarına çözer.
- **Motor/pervane**: itici/çekici yönü (`dir`), montaj istasyonu, uçan kanatta TE oyuğu.

### 6.4 Ağırlık–denge (`computeBalance`)
Bileşen kataloğundan (servo modelleri, batarya hücreleri) kütle listesi kurar, her parçayı
`Layout` üzerindeki gerçek konumuna yerleştirir, toplam ağırlık/AG ve gereken balastı
hesaplar. Servo kolları, itme çubukları (`linkExits`) ve kablo geçişleri de buradan çıkar.
`cutoutsFromBalance()` bunları STL'de kesilecek `Pocket[]`'e çevirir.

---

### 6.5 Kanat profili ve kalınlığı (v1.9)

Profil devrede tek bir **spec string** ile taşınır: `"clarky"` veya `"clarky@14"`.

- `AirfoilType` = katalog tipi; `AirfoilSpec` = tip ± kalınlık (`AirfoilType | \`\${AirfoilType}@\${number}\``).
  Kalınlık state'e ayrı alan olarak eklenmediği için **localStorage, `#p=` paylaşım linki ve
  proje anlık görüntüleri** ek alan gerektirmez; eski kayıtlar (`"clarky"`) aynen açılır.
- `getAirfoil(spec)` spec'i çözer, gerekirse **kamber hattını koruyarak** kalınlığı ölçekler:
  `yc = (upper+lower)/2` sabit kalır, `yt = (upper−lower)/2` `k` ile çarpılır. Böylece
  %12'lik NACA 2412 kalınlaştırılınca yine NACA 2412 olur (kamber kaymaz).
- Doğal kalınlığa eşit değer **spec'e yazılmaz** (`makeAirfoilSpec` 0,05 pt toleransla
  sadeleştirir) → slider'ı gezdirmeden dokunmayan kullanıcıda proje temiz kalır.
- Katalog: Clark-Y %11,7 · NACA 4412 · NACA 2412 · NACA 4415 · NACA 0012 · NACA 0009 ·
  NACA 6409 (refleksli, uçan kanat) · MH45 %9,85. NACA'lar formülden üretilir, rakamları birebir doğrudur.
- UI: Sidebar'da seçici + **canlı kesit önizlemesi** (SVG, `AirfoilPreview`) + %5–%20 arası
  kalınlık slider'ı. Önizleme modül seviyesinde tanımlı (md.12/4).
- Tüketiciler değişmedi: mesh, STL, PDF, 2B, kapak/dübel hepsi `getAirfoil(spec)` çağırır,
  kalınlık kendiliğinden her çıktıya yansır. Tek uyarı: `printParts` içindeki
  "tablaya sığma" hesabı `wingAf.thickness` ile çalıştığı için kalın kanatta tablo
  sınırı kendiliğinden daralır (doğru davranış).

## 7. 3B görünüm

`Scene3D.tsx` içinde üç katman:

1. **`Aircraft`** — `buildAircraftParts()` çıktısını çizer (gövde merkezde, kanat/kuyruk
   aynalanarak). `sections` açıksa bunun yerine baskı dilimleri gösterilir.
2. **`Components` / `Powertrain` / `BalanceMarkers`** — servo, batarya, ESC, kiriş,
   CG (siyah nokta) ve NP (turuncu üçgen) işaretleri.
3. **`StationEditor`** (HTML overlay, canvas dışı) — seçilen kesrin parametreleri.

Etkileşim:
- Döndürme: `OrbitControls` (+ otomatik dönme; seçim yapılınca durur)
- `showComponents` / `show_print_sections` / `explode` kontrolleri sağ üstte
- Gövdeye tıkla → `worldToLocal` → `z` ekseni istasyonu verir (`-z / length`) → halka çizilir

### Manuel gövde şekillendirme (bizim eklediğimiz)
Veri: `dimensions.fuseStations?: { s, w, h, dy? }[]`

- `s` = uzunluğun **kesri** (0 burun … 1 kuyruk) → cm↔mm geçişinde şekil kaymaz
- `w`, `h` = genişlik/yükseklik **çarpanı** (0.4–2.0), `dy` = merkez kayması (±0.4)
- İnterpolasyon **PCHIP** (monotone cubic): Catmull-Rom taşıp istenmeyen şişkinlik
  üretiyordu; PCHIP kontrol noktaları arasında taşmaz
- `addStationLocalized()` noktanın iki yanına ±0.12'de **nötr çapa** koyar → düzenleme
  yerel bir tümsek olur, tüm gövdeyi ölçeklemez
- Tek darboğaz `fuselage.section()` olduğu için deformasyon 3B, 2B, STL, PDF ve
  kapak/dübel yerleşimine **tutarlı** yansır
- Kalıcılık: `normalizeDims()` dizi alanını ayrıca taşır (yoksa yenilemede kaybolur)

---

### Kuyruk tipleri (v1.5)

| Tip | Geometri | Not |
|---|---|---|
| `conventional` | Yatay stab gövde üzerinde + dikey fin | v1.4 ile **sayısal olarak birebir** aynı |
| `t_tail` | Stab fin tepesinde (`hStab.y = fin.y + fin.span`) | Verim ×1,05; toplam yükseklik artar |
| `v_tail` | İki panel ±38°, fin yok | `hStabSpan` **izdüşüm** açıklığıdır → panel boyu `span/2 ÷ cos α` |
| `inverted_v` | Aynı, −38° (kelebek) | Yerde hasar az, aynı karışım |
| `cruciform` | Klasik + gövde altına taşan ventral fin (`fin.span × 0,45`) | Sapma kararlılığı artar |

Kurallar:
- V kuyrukta dikey alan panellerden gelir: `vStabArea = hStabArea · tan α` (izdüşüm),
  bu yüzden doğrulamadaki `vstab_small` kontrolü kendiliğinden doğru çalışır.
- V kuyrukta Sidebar dikey stab + rudder alanlarını gizler; kontrol yüzeyi
  `elevatorChord` üzerinden ruddervator olarak yorumlanır.
- 3B'de paneller `geometry.rotateZ(rollRad)` ile kök etrafında döndürülür
  (mesh.ts); 2B üst görünüm `span/2 · cos α`, ön görünüm eğik paneller çizer.
- STL: hstab panelleri **düz** basılır (açı montajda verilir), fin parçası ventral
  uzantıyı da içerir. V kuyrukta gövde kuyruk yuvası (tail seat/fin slot) üretilmez →
  panel gövdeye yapıştırılır.

## 8. Baskı / STL hattı

```
buildPrintPlan(Layout, airfoil, settings, pockets)
   ├─ tabla boyutuna göre dilimleme (bedX/Y/Z)
   ├─ kiriş (spar) delikleri + kırlangıç/geçme ekleri
   ├─ Pocket[] kesme yuvaları (servo, batarya, kablo)
   └─ uyarılar: sığmayan parça, kesit daralması (stl_warn_fuse_pinch), …
        ↓
orientForPrint()  → parçayı baskı yönüne çevir, zemin düzlemi
        ↓
toBinarySTL()     → ikili STL, fflate ile zip
```

Önemli noktalar:
- **İstasyon noktaları STL'de gerçek halka olarak eklenir**; yoksa 12 istasyonluk
  örnekleme şekli yumuşatıp yutuyordu.
- "Tablaya sığmıyor" kontrolü **gerçek kesitlerden** hesaplanır, nominal W/H'den değil
  (istasyonla 2× genişletince nominal değer yanıltıyordu).
- `clearance` ayarı geçme boşluğudur; test kit'i basıp kalibre etmek için
  `stl_mode_kit` modu var.
- Parça adları `fuselage_1.stl` gibi sıralıdır; zip içinde baskı sırası korunur.
- **`orientForPrint()` her parçayı kendi tablasının merkezine koyar** — tek parça baskı için
  doğru, ama çoklu dosya önizlemesinde hepsi aynı noktaya yığılır. Bu yüzden ZIP'e
  `00_plate_layout/plate_all.stl` (tüm parçalar çakışmadan dizilmiş, tek dosya) ve
  `00_plate_layout/plate_map.txt` (parça → tabla/x/y/w/h manifestosu) eklenir.
- **Bütün uçak tek tablaya sığmaz** (parçaların toplam ayak izi 220×220'den büyük). Packer bu
  yüzden taşırmak yerine **yeni tabla açar**: manifest `plate` kolonu 1,2,3…; `plate_all.stl`
  bu tabloları aralarında 20 mm boşlukla yan yana gösterir. Tek parça dosyaları değişmez.
- Bir parça tek başına tabladan büyükse `stl_warn_plate_overflow`, birden çok tabloya
  yayıldıysa `stl_info_plate_pages` uyarısı çıkar.

---

### 8.1 STL arşivi (v1.6)

Üretilen setleri cihazda saklayan yerel kütüphane. **Backend yok.**

```
planAndOrient() ─► buildStlFiles() ─┬─► exportSTLZip()      → ZIP indirme
                                    └─► saveSet()           → IndexedDB (arşiv)
                                               │
ArchiveDialog ── listSets/getFiles ────────────┘
      ├─ Görüntüle  → StlViewer (tek parça veya tüm set)
      ├─ ZIP indir  → zipSync(files)  (depoda zip tutulmaz!)
      ├─ Projeyi yükle → App.applyArchivedProject()
      └─ Yeniden adlandır / sil / tümünü sil
```

Neden böyle:

- **IndexedDB, localStorage değil**: bir set 2–30 MB; localStorage ~5 MB'ta dolardı.
- **İki store**: `sets` (meta, ucuz listeleme) + `blobs` (STL byte'ları, sadece istenince).
- **ZIP saklanmaz**: `files` haritası zip'in tam içeriğidir, indirmede `fflate.zipSync` ile
  yeniden paketlenir → diskte tek kopya, çıktı canlı dışa aktarımla **byte düzeyinde aynı**
  (ikisi de `buildStlFiles()` kullanır).
- **Küçük resim**: birleşik (`00_assembled_preview`) STL, tek kullanımlık `WebGLRenderer` ile
  320×200 PNG'ye çizilir; WebGL yoksa/hata olursa sessizce atlanır (kutu ikonu gösterilir).
- **Proje anlık görüntüsü** her kayıtta saklanır: `dimensions, unit, aircraftType, airfoil,
  fuselageStyle, tailType, propeller, controls, printSettings, components, propCutout`.
  "Projeyi yükle" bunu `loadExample()` ile aynı yoldan uygular (onay ister).
- `navigator.storage.persist()` ilk açılışta istenir → tarayıcı baskı altında arşivi silmez.

### 8.2 STL görüntüleyici (v1.6)

- `three/examples/jsm/loaders/STLLoader` **dinamik import** (ayrı chunk, ~2.8 kB) — binary ve
  ASCII STL ikisini de okur, ağ isteği yok → APK'da offline.
- Kamera **Z-up** (3B baskı geleneği); `Rig` bileşeni sınır kutusundan mesafeyi ve
  `near/far`'ı hesaplar, `OrbitControls.makeDefault` hedefi günceller.
- Kontroller: tel kafes, kenarlar (`EdgesGeometry`, 25°), ızgara, eksen, görünümü sıfırla;
  dosya listesinde göz ikonu (gizle) ve ada tıkla (**yalnız bu parçayı göster**).
- Kaynaklar: arşivdeki parçalar veya sürükle-bırak / dosya seçici (çoklu `.stl`).
- **Üç görünüm modu** (v1.8): `Montaj` (birleşik uçak), `Tabla` (tablaya dizilmiş set — varsayılan),
  `Parçalar` (tek tek, çakışmasız dizilmiş). Mod, dosya yolundan otomatik seçilir
  (`00_assembled_preview` → montaj, `00_plate_layout` → tabla, gerisi → parça).
- Dosyalar kendi koordinatlarında (hepsi tabla merkezinde) gelirse görüntüleyici onları
  `arrangeOnPlates()` ile sanal bir tablaya dizer; yığılma olmaz.
- **Her açılışta remount**: `App` görüntüleyiciye `key={seq}` verir; böylece eski kamera,
  gizlenmiş parça ve hata durumu sızmaz (effect içinde setState yok — lint kuralı).
- `BufferGeometry` ve `EdgesGeometry`'ler `dispose()` edilir (md.12/6).

### 8.3 Model kütüphanesi — "Modellerim" (v1.7)

Kesit düzenlemeleri (`dimensions.fuseStations`) tek proje state'inde yaşıyordu; kütüphane
sayesinde **aynı anda birden çok adlandırılmış tasarım** tutulabiliyor.

- **Kayıt modeli**: `{ id, name, createdAt, updatedAt, snapshot, thumb?, history: [{at, snapshot}] }`
  — `snapshot` = `ArchivedProject` (ölçüler + `fuseStations` + profil + kuyruk tipi + baskı
  ayarları + bileşenler). Model başına 5–15 KB, yani yüzlerce model sorun değil.
- **Yükleme geometriye dokunmaz**: `applySnapshot()` sadece `setState` yapar; `computeLayout()`
  girdi değiştiği için yeniden çalışır — altın kural (md.4) korunur.
- **İstasyonlar kesirli (`s`)**: cm'de kaydedip mm'de açmak şekli kaydırmaz (test edildi).
- **Sürüm geçmişi**: üzerine yazmada önceki snapshot `history`'ye itilir, **son 5** tutulur;
  "Geri yükle" seçilen sürümü aktif yapar, mevcut durum yine geçmişe eklenir.
- **Küçük resim**: `buildAircraftParts()` çıktısı tek kullanımlık `WebGLRenderer` ile 320×200
  PNG'ye çizilir (STL arşivinden farklı olarak STL üretmez, doğrudan mesh).
- **JSON**: `.json` dışa/içe aktarma (`{app:'aerobuilder', kind:'model', ...}`); APK'da uygulama
  verisi silinirse modeller gider → yedekleme yolu budur.
- **Dirty flag**: 300 ms debounce ile `JSON.stringify(snapshot)` karşılaştırması; yükleme/kayıt
  sonrası `justLoadedRef` baseline'ı bir kez canlı state'ten yeniler (normalize edilmiş ölçüler
  yüzünden yanlış "kirli" görünmesini engeller). Kirliyken `beforeunload` uyarısı (web).
- **Aktif model**: `localStorage aerobuilder_model_id`. Paylaşım linkiyle (`#p=`) açılan tasarım
  **model sayılmaz** (`currentModelId = null`) — paylaşılan tasarım kayıtlı modelin üzerine yazmaz.
- **Migrasyon**: kütüphane boşsa mevcut tek tasarım otomatik "Model 1" olarak kaydedilir.
- **STL arşivi bağlantısı**: `ArchiveMeta.modelId/modelName` — bir baskı setinin hangi modelden
  çıktığı görünür, arşiv aramasında model adı da eşleşir.
- **Örnek yükleme** (`loadExample`) modeli değiştirmez: mevcut model "kirli" olur, kaydetmek
  kullanıcının kararıdır.

## 9. Kalıcılık, paylaşım, dil

- **localStorage** `aerobuilder_state_v2`: tüm proje (ölçüler, birim, tip, profil, gövde
  stili, pervane, kontrol yüzeyleri, tema, baskı ayarları, bileşenler, `fuseStations`).
  Eski `aerobuilder_dims` anahtarı geriye dönük okunur.
- **Paylaşım**: `shareUrl()` → `#p=<deflate+base64>`. URL'deki proje, kayıtlı durumdan
  **önceliklidir**; okunduktan sonra hash temizlenir.
- **Dil**: URL (`/tr/`) → `localStorage aerobuilder_lang` → cihaz dili → İngilizce.
  APK'da cihaz Türkçe ise otomatik Türkçe açılır. SEO için `dist/<dil>/index.html`
  üretilir (`seo/seo.json` + `seo/seoPlugin.ts`).
- **Analytics**: yalnızca onay verilmişse; onaysız/offline'da sessizce devre dışı.
- **STL arşivi ve model kütüphanesi ayrı depodadır**: `aerobuilder_archive` IndexedDB (v2)
  içindeki `sets`/`blobs` ve `models` store'ları (proje state'i ile ilgisiz).
  `handleReset()` ve `/new` bunları **silmez**; temizlik diyaloglardaki silme işlemleriyle yapılır.

---

## 10. Web servisi (port 1932)

- `server.mjs`: statik dosya sunumu, **SPA fallback**, gzip, uzun ömürlü cache header'ları.
- systemd kullanıcı servisi: `aeroplan-web.service` (linger açık, sudo gerekmez).
- `vite.config.ts` portu **sabit 1932** (`strictPort: true`), `preview` de aynı port.
- Her build'de `dist/version.json` yazılır; `useVersionCheck` yeni sürümde reload önerir.

---

## 11. Android APK (native)

- **Capacitor 7** (Node 20 kısıtı; Capacitor 8 Node 22 istiyor).
- Paket: `com.sinasi.aeroplan` · Görünen ad: **AeroBuilder** · minSdk 23 / targetSdk 35
- Sürüm: `android/app/build.gradle` → `versionCode 11` / `versionName "1.10"`
- `webDir: 'dist'` → `npx cap sync android` ile `android/app/src/main/assets/public`
  içine **gömülür**. Uygulama internetsiz açılır; `server.url`, iframe veya web
  yönlendirmesi **yoktur** (native kabuk).
- İmzalama: `android/keystore/aeroplan-release.jks` (alias `aeroplan`), şifre
  `android/keystore/README.txt` içinde. **Bu dosya ve şifre kaybedilirse uygulama
  güncellenemez.**
- Derleme: `./build-apk.sh` (JAVA_HOME=JDK21, ANDROID_HOME=/opt/android-sdk ayarlar)
- Çıktı: `android/app/build/outputs/apk/release/app-release.apk` → `AeroBuilder-1.10.apk`
- Kurulum: `adb install -r android/app/build/outputs/apk/release/app-release.apk`

**Kritik:** web'de değişiklik yaptıysan APK'ya yansıması için `cap sync` şart; sadece
`npm run build` yetmez.

---

## 12. Geliştirme kuralları / tuzaklar

1. Geometriyi **sadece** `computeLayout()` içinde değiştir; tüketiciler türetilmiş
   değerleri yeniden hesaplamamalı.
2. Yeni ölçü eklerken: `AircraftDimensions` → `LENGTH_KEYS` (birim dönüşümü için) →
   `geometry.ts` → `Sidebar.tsx` → **8 locale** → `presets/examples`.
3. Yeni çeviri anahtarı `en.ts`'ye eklenir; `Dict` tipi diğer dillerde eksik anahtarı
   derleme hatası yapar (bilinçli).
4. React bileşeni içinde tanımlı alt bileşen (örn. slider) her render'da yeniden
   oluşur → sürüklemede odak kaybı. Modül seviyesine taşı.
5. `useEffect` içinde `import()` ile lazy yükleme yapılıyorsa `cancelled` bayrağı kullan
   (dialog hızlı kapanıp açılınca eski sonuç state'i ezer).
6. three.js `BufferGeometry`'leri `dispose()` et; `useMemo` ile üretilen mesh'lerde
   `useEffect(() => () => geo.dispose(), [geo])` deseni kullanılıyor.
7. Mobilde panel tam genişlik **alt sayfa** (%62 yükseklik, `overflow-y-auto`),
   slider yüksekliği en az 32 px (dokunma hedefi).
8. Uçan kanatta gövde yoktur — istasyon düzenleyici yalnızca `layout.fuselage` varsa
   render edilir.
9. `dist/` git'e girmemeli; APK da öyle (`AeroBuilder-*.apk` .gitignore'da değilse ekle).
11. **Dışa Aktar menüsü yalnızca dışa aktarma içindir** (STL, PDF, mobilde paylaş).
    Arşiv/görüntüleyici gibi *gezinme* işleri header'da bağımsız buton olarak durur;
    yeni bir "araç" eklerken menüye gömmeyin.
12. Yeni kanat profili eklerken: `AirfoilType` birleşimine tip → `airfoils.ts` içindeki
    `buildBase()` switch'i (NACA ise `naca4('2412')` tek satır) → `AIRFOIL_TYPES` dizisi
    (UI sırası) → 8 locale'de `airfoil_<tip>` → `scripts/check-airfoil.ts` `AIRFOIL_TYPES`
    üzerinden otomatik kapsar, ek iş yok. Kalınlık ayrı bir ölçü değildir, spec'e yazılır.
10. Yeni kuyruk tipi eklerken **sadece** `TAIL_TYPES`'a bir satır + locale anahtarları
    ekle; geometri `computeLayout` içinde reçeteden türetilir, görünümler tekrar hesaplamaz.
    `scripts/check-tail.ts` içindeki duman testi yeni tipi de kapsayacak şekilde güncelle.

---

## 13. Doğrulama yöntemi

Bu projede değişiklikler **iddia ile değil ölçümle** doğrulanıyor:

- **Sayısal regresyon**: istasyon listesi boşken `computeLayout()` çıktısı, değişiklik
  öncesiyle birebir aynı olmalı (maks fark 0.00e+0). PCHIP için taşma testi:
  kontrol noktaları 0.6–1.6 iken eğri bu aralıkta kalmalı.
- **Headless Chromium (playwright)**: panel açılışı, slider → mesh yeniden kurulumu
  (piksel farkı ~%1), 3 kontrol noktası oluşumu, sayfa yenileme sonrası kalıcılık,
  sıfırlama, mobil yerleşim ölçümü, konsol hatası olmaması.
- **WebGL**: headless'ta `--use-gl=swiftshader` ile WebGL 2.0 alınıyor.
- **Profil/kalınlık** (v1.9): `scripts/check-airfoil.ts` doğal kalınlıkların NACA rakamlarıyla eşleştiğini,
  ölçeklemede **kamber hattının kaymadığını**, mesh kök kesitinin gerçekten kalınlaştığını doğrular.
- **Kuyruk regresyonu** (v1.5): `scripts/check-tail.ts` klasik kuyruğu eski formüllerle
  karşılaştırır (birebir), V/T/haç tiplerinin söz verdiği geometriyi doğrular;
  `check-tail-runtime.ts` mesh + `buildPrintPlan` + `computeBalance` hattını 5 tip için çalıştırır.
  Derleme: `tsc ... --ignoreConfig` → `node /tmp/...` (bkz. dosya başlıkları).
- TypeScript derlemesi zaten katı (`tsc -b`), ESLint ayrı: `npm run lint`.

---

## 14. Ortam / makine notları

- Proje yolu: `~/Projeler/airplane_model`
- Node 20, JDK 21 (`/usr/lib/jvm/java-21-openjdk-amd64`), Android SDK `/opt/android-sdk`
- systemd **kullanıcı** servisi kullanılıyor (sudoers kısıtlı, linger açık)
- Web build `dist/` (4.8 MB), APK ~6 MB

---

## 15. Sürüm geçmişi (bizim fork)

- **1.10** — **STL arşivi ve görüntüleyici header'a taşındı**: artık Dışa Aktar menüsünün
  içinde değil, üst barda bağımsız butonlar (`Archive`, `Cuboid`; geniş ekranda etiketli,
  mobilde ikon + `aria-label`). Export menüsü sadece STL/PDF dışa aktarımına indirildi.
  Mobilde yer açmak için Örnekler butonu Ayarlar menüsüne, "Dışa Aktar" etiketi ikona indirildi.
  `check-archive.cjs` artık menüde arşiv/görüntüleyici **olmadığını** da doğruluyor.

- **1.9** — **kanat profili + kalınlık**: 8 profil (NACA 2412 / 4415 / 0009 / 6409 eklendi),
  `AirfoilSpec` (`"clarky@14"`) ile profil başına %5–%20 kalınlık, kamber koruyan ölçekleme,
  Sidebar'da canlı kesit önizlemesi + kalınlık slider'ı, PDF başlığında profil + kalınlık,
  8 dilde 6 yeni anahtar, `scripts/check-airfoil.ts` + `scripts/check-airfoil-ui.cjs`

- **1.8** — **tabla düzeni düzeltmesi**: tüm parçalar aynı noktaya ortalandığı için çoklu
  önizlemede iç içe görünüyordu. `plateLayout.ts` (shelf packing, çok tablalı),
  ZIP'e `00_plate_layout/plate_all.stl` + `plate_map.txt`, görüntüleyicide Montaj/Tabla/Parçalar
  modları, `stl_info_plate_pages` + `stl_warn_plate_overflow` uyarıları, 8 dilde 7 yeni anahtar,
  `scripts/check-plate.cjs`

- **1.7** — **Model kütüphanesi ("Modellerim")**: adlandırılmış tasarımlar (kesit düzenlemeleri
  dahil), son 5 sürüm geçmişi + geri yükleme, çoğalt/yeniden adlandır/sil, `.json` dışa-içe
  aktarma, dirty göstergesi + `beforeunload`, açılışta "Model 1" migrasyonu, STL arşivi ↔ model
  bağlantısı, ortak `db.ts` (DB v2), 8 dilde 28 yeni anahtar, `scripts/check-models.cjs`

- **1.6** — yerel **STL arşivi** (IndexedDB, küçük resim, ZIP'i yeniden paketleme, projeyi geri
  yükleme) ve **STL görüntüleyici** (arşiv + sürükle-bırak, tel kafes/kenar/ızgara, otomatik
  sığdırma), `buildStlFiles()` refactor'ü, 8 dilde 58 yeni anahtar, `scripts/check-archive.cjs`
- **1.5** — kuyruk tipi seçici (klasik / T / V / ters V / haç+ventral), V kuyruk
  izdüşüm metrikleri + ruddervator UI, T kuyruk fin tepesi montajı, 3B panel döndürme,
  2B ön görünüm eğik paneller, STL ventral fin, 8 dilde yeni anahtarlar, kuyruk testleri
- **1.4** — gövde istasyon düzenleyici (3B seçim + panel), PCHIP + yerelleştirme,
  gerçek kesitten tabla kontrolü, `stl_warn_fuse_pinch`, 8 dilde yeni anahtarlar
- **1.3** — Türkçe çeviri tamamlandı, gövde stilleri (`FUSE_PROFILES`) tek kaynağa alındı
- **1.2** — Capacitor native APK, port 1932'ye taşınma
- **1.1** — ilk native APK, ikon/splash
