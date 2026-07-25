<div align="center">
  <img src="walker-rammap.png" width="180" alt="Walker RAMMap logosu">
  <h1>Walker RAMMap</h1>
  <p>Windows için güvenli, kullanıcı kontrollü RAM ve sistem performansı yöneticisi.</p>

  [![Latest Release](https://img.shields.io/github/v/release/akgunwalker/walker-rammap?style=flat-square)](https://github.com/akgunwalker/walker-rammap/releases/latest)
  [![Windows Release](https://img.shields.io/github/actions/workflow/status/akgunwalker/walker-rammap/release.yml?style=flat-square&label=Windows%20build)](https://github.com/akgunwalker/walker-rammap/actions)
  ![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-35d7c8?style=flat-square)
</div>

## İndir

Güncel installer ve portable paketleri
[Releases](https://github.com/akgunwalker/walker-rammap/releases/latest)
sayfasından indirebilirsiniz.

- **Setup:** Masaüstü ve Başlat menüsü kısayolları oluşturur, kaldırıcı içerir.
- **Portable:** Kurulum gerektirmeden doğrudan çalışır.

> Uygulama henüz ticari kod imzalama sertifikasıyla imzalanmadığı için Windows
> SmartScreen ilk çalıştırmada “Bilinmeyen yayıncı” uyarısı gösterebilir.

## Özellikler

- Canlı RAM, CPU ve GPU grafikleri
- Kullanılan, boş, standby, modified ve sıkıştırılmış bellek görünümü
- Süreç bazında private memory ve working set takibi
- Kullanıcının seçtiği süreçlerde tek tık Working Set optimizasyonu
- Düzenlenebilir beyaz liste, hedef listesi ve oyun listesi
- Otomatik oyun algılama ve geri alınabilir güç planı değişikliği
- Ayarlanabilir RAM eşiğine göre otomatik optimizasyon
- Sıkıştırılmış bellek uyarıları
- Yönetici kontrollü standby list temizliği
- Bellek kaçağı eğilim analizi ve yüksek tüketim önerileri
- 24 saatlik geçmiş, CSV raporu ve ayar yedekleme
- Sistem tepsisi, Windows bildirimleri ve başlangıçta çalıştırma
- GitHub Releases üzerinden kullanıcı onaylı otomatik güncelleme
- İlk açılış sihirbazı
- Türkçe ve İngilizce arayüz
- Koyu, açık, sistem ve yüksek kontrast temaları
- Özel profiller ve profil başına whitelist/hedef/eşik ayarları
- Saat ve gün bazlı zamanlanmış optimizasyon kuralları
- Sessiz saatler ve pilde otomasyonu durdurma
- Canlı disk, ağ ve pagefile telemetrisi
- Optimizasyon öncesi/sonrası kazanım raporu ve toplam kazanılan bellek
- Yerel denetim günlüğü ve anonimleştirilmiş tanılama raporu
- Aranabilir ve sürüklenerek düzenlenebilir gelişmiş dashboard
- `Ctrl+Shift+O` hızlı optimizasyon kısayolu
- İşlem yapmadan önce etkilenecek süreçleri gösteren optimizasyon simülasyonu
- İptal edilebilir beş saniyelik otomasyon geri sayımı
- Süreç dosya yolu, yayıncı, dijital imza ve SHA-256 ayrıntıları
- Dosya yolu tabanlı kalıcı koruma
- Haftalık RAM/CPU performans özeti
- Profil JSON içe ve dışa aktarma

## Güvenlik modeli

Walker RAMMap tüm süreçleri rastgele temizlemez. Optimizasyon yalnızca kullanıcının
hedef listesine eklediği süreçlerde çalışır. Hedef listesi boşsa hiçbir uygulamaya
dokunulmaz.

Varsayılan beyaz liste:

- Discord
- Steam
- Chrome
- OBS
- Spotify

GoodByeDPI, Splitware/SplitWire, WinWS, Zapret, WARP, WireGuard, OpenVPN,
Tailscale, DNSCrypt, NextDNS, AdGuard, Xray, V2Ray, Clash, Mihomo ve benzeri
DNS/VPN/ağ filtreleme araçları değiştirilemez koruma listesindedir. Bu süreçler
hedef listesine eklense bile optimize edilmez veya uygulama içinden kapatılamaz.

Optimizasyon, seçilen uygulamaların ilk kullanımda kısa süreli daha yavaş tepki
vermesine neden olabilir. Arayüz işlemden önce bu etkiyi açıkça belirtir ve
kullanıcı onayı ister.

## Gizlilik

- Sunucu yalnızca `127.0.0.1` üzerinde dinler.
- Telemetri dışarı gönderilmez.
- Ayarlar ve geçmiş kullanıcının bilgisayarında saklanır.
- Otomatik güncelleme yalnızca GitHub Releases ile iletişim kurar.

## Kaynaktan çalıştırma

Gereksinimler:

- Windows 10 veya Windows 11
- Node.js 24 veya üzeri
- PowerShell 5.1 veya üzeri

```powershell
git clone https://github.com/akgunwalker/walker-rammap.git
cd walker-rammap
npm install
npm run desktop
```

Tarayıcı sürümü:

```powershell
npm start
```

Ardından `http://127.0.0.1:4173` adresini açın.

## Windows paketi oluşturma

```powershell
npm run build:windows
```

Installer ve portable çıktıları `release/` klasöründe oluşturulur.

Yeni bir Git etiketi gönderildiğinde GitHub Actions paketleri otomatik olarak
üretir, Release'e yükler ve `SHA256SUMS.txt` dosyasını yayınlar:

```powershell
git tag -a v1.2.2 -m "Walker RAMMap 1.2.2"
git push origin v1.2.2
```

## Yönetici yetkisi

Temel izleme ve hedefli optimizasyon yönetici yetkisi olmadan çalışır. Standby
list temizliği gibi Windows çekirdeğiyle ilişkili işlemler için uygulamayı
yönetici olarak yeniden başlatmak gerekir.

## Sorun bildirme

Hata bildirirken Windows sürümünü, Walker RAMMap sürümünü ve sorunu tekrarlama
adımlarını ekleyin:

[Yeni hata bildirimi oluştur](https://github.com/akgunwalker/walker-rammap/issues/new/choose)

Güvenlik açıklarını herkese açık issue olarak paylaşmayın. Ayrıntılar için
[SECURITY.md](SECURITY.md) dosyasını okuyun.
