# Sharp AC Web

Remote Sharp AC berbasis web. Encoder SharpAC4 murni JavaScript (tanpa `codes.json`), UI PWA, dan bridge IR ESP8266/ESP32 supaya bisa kontrol AC **tanpa IR blaster HP**.

Live: <https://nirempathys.github.io/sharp-ac-web/>

## Kenapa perlu bridge

Browser tidak punya akses ke IR blaster Android (`ConsumerIrManager`). Dari GitHub Pages (HTTPS) juga tidak bisa `fetch()` ke ESP `http://...` karena mixed content. Jadi arsitekturnya:

```
[Web app GitHub Pages] --WSS--> [MQTT broker] <--TCP-- [ESP8266/ESP32 + IR LED] --38kHz--> [AC Sharp]
```

Alternatif lokal tanpa internet: web app di-serve via HTTP, lalu `POST` langsung ke ESP (`/ir`).

## Quick start

1. Buka live URL.
2. Isi **Secret** (harus sama dengan `MQTT_SECRET` di firmware).
3. Tekan **Connect**.
4. Tekan **ON/OFF**, atur suhu 18–32°C, mode Cool/Heat, fan Auto/1/2/3.
5. Status `ESP ok · <ip>` artinya ESP menerima dan menembak IR.

## Tes cepat pakai IR HP (bridge lokal)

Kalau belum pegang ESP dan mau langsung tes nyala:

```bash
cd ~/sharp-ac-web
python3 bridge/lirc_bridge.py
```

Script otomatis naik ke root lewat `su`. Lalu:

1. Buka <https://nirempathys.github.io/sharp-ac-web/>
2. Transport → **HTTP bridge**
3. Tap **Local 127.0.0.1** (URL jadi `http://127.0.0.1:8080/ir`)
4. Tekan **Connect / Test** atau **Send frame**

Chrome mengizinkan HTTPS → `http://127.0.0.1` (loopback). Kalau diblok, buka `http://127.0.0.1:8080/` — app yang sama, di-serve langsung oleh bridge (HTTP, same-origin).

## Hardware

- ESP8266 (NodeMCU / Wemos D1 mini) atau ESP32
- 1× IR LED 940 nm
- 1× transistor NPN (2N2222 / S8050 / BC337)
- Resistor: 1 kΩ (base), 100 Ω (LED), 10 kΩ (pull-down base, opsional)
- Kabel + breadboard

Wiring (low-side switch):

```
GPIO4 ──1kΩ── Base NPN
GND ────────── Emitter
Collector ──── IR LED cathode (-)
5V/VIN ──100Ω─ IR LED anode (+)
Base ──10kΩ── GND (opsional)
```

GPIO4 = D2 di ESP8266. Bisa diubah lewat `IR_PIN`.

## Firmware

Libraries Arduino IDE:

- IRremoteESP8266 (crankyoldgit)
- PubSubClient (knolleary)
- ArduinoJson 6.x (bblanchon)

Edit bagian atas `firmware/esp_ir_bridge/esp_ir_bridge.ino`:

```cpp
const char* WIFI_SSID = "CHANGE_ME";
const char* WIFI_PASS = "CHANGE_ME";
const char* MQTT_HOST = "broker.hivemq.com";
const uint16_t MQTT_PORT = 1883;
const char* MQTT_SECRET = "CHANGE_ME";   // samakan dengan Secret di web
const uint16_t IR_PIN = 4;
```

Upload. Buka Serial Monitor 115200 untuk lihat IP. ESP subscribe ke:

```
sharpac/<MQTT_SECRET>/cmd
```

dan publish ack ke:

```
sharpac/<MQTT_SECRET>/status
```

## Mode MQTT (rekomendasi untuk GitHub Pages)

- Web memakai `wss://broker.hivemq.com:8884/mqtt`.
- ESP memakai `broker.hivemq.com:1883`.
- Broker publik HiveMQ meneruskan pesan; tidak perlu backend.
- Topik memakai secret acak. Ganti secret, jangan pakai untuk data sensitif.
- Broker bisa diganti ke broker MQTT lain yang mendukung WSS + TCP.

## Mode HTTP (lokal / tanpa internet)

Serve folder `docs/` lewat HTTP, misal:

```bash
python3 -m http.server -d docs 8080
```

Buka `http://<ip-laptop>:8080/`, pilih Transport **HTTP bridge**, isi:

```
http://esp-ir.local/ir
```

atau `http://<ip-esp>/ir`. Mode ini tidak bisa dipakai dari GitHub Pages HTTPS karena mixed content.

## Bardi / Tuya

Bardi adalah perangkat berbasis Tuya. Dari browser GitHub Pages:

- Local API Bardi (`http://...`) diblok mixed content.
- Tuya Cloud butuh request bertanda tangan HMAC dengan Access Secret; jangan taruh secret di browser.

Opsi:

1. **ESP bridge (sudah jalan di repo ini)** — tidak butuh Bardi, tidak butuh cloud, frame Sharp dihitung sendiri.
2. **Webhook / Tuya bridge** — jalankan bridge lokal (Termux/Raspberry Pi) yang bicara ke Tuya Cloud/local API, lalu arahkan Transport **Webhook / Tuya** ke URL bridge. Untuk ini perlu `device_id` + `local_key` (Tuya/local) atau `Access ID` + `Access Secret` + `device_id` (cloud). Konversi raw pulse ke format kode IR Tuya bersifat device-specific; kirim detail device kalau mau dibuatkan bridge-nya.

## PWA / offline

- `manifest.webmanifest` + `sw.js` membuat UI bisa di-install dan dibuka offline.
- Encoder tetap jalan offline (tidak butuh data file).
- Kontrol AC tetap butuh jalur ke ESP: MQTT (butuh internet) atau HTTP (cukup WiFi lokal).

## Local dev

```bash
python3 -m http.server -d docs 8080
```

## Deploy

Repo ini sudah punya `.github/workflows/pages.yml`. Push ke `main` → GitHub Actions deploy folder `docs/` ke Pages.

## Protokol SharpAC4

Frame 13 byte, 104 bit, LSB-first, 38 kHz.

```
aa 5a cf 10 TT PP MM 00 08 80 00 f0 CS
```

- `TT` = `clamp(temp, 18, 32) - 17` saat ON, `0x0f` saat OFF
- `PP` = `0x31` ON, `0x21` OFF
- `MM` = `(fan << 4) | mode`
  - fan: auto=2, 1=3, 2=5, 3=7
  - mode: cool=2, heat=1
- `CS` = `(checksum << 4) | 0x01`
- Checksum: XOR byte 0..11, XOR low nibble byte 12, lipat nibble, ambil low nibble.

Timing: header 3770/1846, mark 494, zero 442, one 1378, gap 65000 µs.

Catatan: frame `PowerOn` mentah di database (`PP=0x11`, `TT=0x0f`) cuma bikin AC beep. App ini memakai frame gabungan `PP=0x31` + suhu valid, yang sudah terbukti menyalakan AC.

Encoder diverifikasi 129/129 frame terhadap database SharpAC4 (semua kombinasi suhu/fan/mode) + PowerOff.

## Troubleshooting

- **AC beep tapi tidak nyala/mati** — pakai frame gabungan (app ini sudah), jangan `PowerOn` mentah.
- **MQTT connected tapi tidak ada ack ESP** — secret beda, ESP offline, WiFi salah, atau broker diblok.
- **HTTP gagal dari GitHub Pages** — mixed content; pakai MQTT atau serve `docs/` via HTTP.
- **ESP tidak muncul di `esp-ir.local`** — pakai IP dari Serial Monitor / ack MQTT.
- **Jarak tembak pendek** — tambah transistor + 5V, arahkan LED ke receiver AC, hindari sinar matahari langsung.
