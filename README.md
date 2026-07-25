# Walker RAMMap

Windows için gerçek zamanlı, yerel bellek gözlem aracı. Fiziksel bellek dağılımını,
commit/pool değerlerini, page I/O'yu ve süreçlerin çalışma setlerini gösterir.

## Çalıştırma

```powershell
npm start
```

Ardından `http://127.0.0.1:4173` adresini açın.

Uygulama yalnızca yerel makinede dinler ve telemetriyi dışarı göndermez. Veriler
Windows CIM performans sayaçlarından üç saniyede bir okunur.

## Masaüstü JavaScript programı

```powershell
npm install
npm run desktop
```

Taşınabilir Windows `.exe` dosyası üretmek için:

```powershell
npm run build:windows
```

Çıktı `release/Walker-RAMMap-1.1.0.exe` konumunda oluşturulur.

## Optimizasyon

- Tek tık optimizasyon süreç çalışma setlerini küçültür.
- Oyun Modu güvenli bir arka plan uygulaması listesiyle sınırlıdır.
- Standby temizliği yönetici yetkisi ister.
- Otomasyon, eşik aşılırsa en fazla beş dakikada bir çalışır.
- Windows başlangıcı kullanıcı kayıt defterindeki `Run` anahtarını kullanır.
- Varsayılan beyaz liste Discord, Steam, Chrome, OBS ve Spotify'dır; arayüzden
  uygulama eklenip çıkarılabilir.
- Optimizasyon yalnızca kullanıcının kırmızı hedef listesine eklediği süreçlerde
  çalışır. Hedef yoksa hiçbir sürece dokunulmaz.
- Oyun işlem adı listeye eklenirse oyun açılışı otomatik algılanır ve hedef
  uygulamalar optimize edilir. Working Set azaltımı kalıcı ayar bırakmaz.
- Sıkıştırılmış bellek 2 GB eşiğini aştığında arayüz optimizasyon önerisi gösterir.
- GPU kullanımı Windows GPU sayaçlarından, sıcaklık ise donanımın sunduğu ACPI
  sensörlerinden okunur; destek yoksa arayüzde `sensör yok` görünür.
