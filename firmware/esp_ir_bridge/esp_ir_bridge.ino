#if defined(ESP8266)
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>
#else
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#endif

#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <IRremoteESP8266.h>
#include <IRsend.h>

const char* WIFI_SSID = "CHANGE_ME";
const char* WIFI_PASS = "CHANGE_ME";
const char* MQTT_HOST = "broker.hivemq.com";
const uint16_t MQTT_PORT = 1883;
const char* MQTT_SECRET = "CHANGE_ME";
const char* MQTT_CLIENT = "sharp-ac-bridge";
const char* MDNS_HOST = "esp-ir";
const uint16_t IR_PIN = 4;
const uint16_t MAX_PULSES = 512;

#if defined(ESP8266)
ESP8266WebServer server(80);
#else
WebServer server(80);
#endif

WiFiClient net;
PubSubClient mqtt(net);
IRsend irsend(IR_PIN);
String cmdTopic;
String statusTopic;
String clientId;
uint16_t pulseBuf[MAX_PULSES];
unsigned long lastMqtt = 0;

void corsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

void publishStatus(bool ok, int seq, const char* msg) {
  if (!mqtt.connected()) return;
  DynamicJsonDocument doc(256);
  doc["ok"] = ok;
  doc["seq"] = seq;
  doc["msg"] = msg;
  doc["ip"] = WiFi.localIP().toString();
  char out[256];
  size_t length = serializeJson(doc, out, sizeof(out));
  mqtt.publish(statusTopic.c_str(), (const uint8_t*)out, length, false);
}

bool fire(const uint8_t* data, size_t length) {
  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, (const char*)data, length)) return false;
  const char* key = doc["key"] | "";
  if (strcmp(key, MQTT_SECRET) != 0) return false;
  JsonArray pulses = doc["pulses"];
  size_t count = pulses.size();
  if (count < 4 || count > MAX_PULSES) return false;
  for (size_t i = 0; i < count; i++) {
    uint32_t value = pulses[i].as<uint32_t>();
    if (value > 65535) value = 65535;
    pulseBuf[i] = (uint16_t)value;
  }
  irsend.sendRaw(pulseBuf, (uint16_t)count, 38);
  publishStatus(true, doc["seq"] | 0, "sent");
  return true;
}

void onMqtt(char* topic, byte* payload, unsigned int length) {
  fire(payload, length);
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

void connectMqtt() {
  if (mqtt.connected()) return;
  if (mqtt.connect(clientId.c_str())) {
    mqtt.subscribe(cmdTopic.c_str(), 1);
    publishStatus(true, 0, "online");
  }
}

void handleHttp() {
  corsHeaders();
  if (server.method() == HTTP_OPTIONS) {
    server.send(204);
    return;
  }
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", "{\"ok\":false}");
    return;
  }
  String body = server.arg("plain");
  bool ok = fire((const uint8_t*)body.c_str(), body.length());
  server.send(ok ? 200 : 400, "application/json", ok ? "{\"ok\":true}" : "{\"ok\":false}");
}

void setup() {
  Serial.begin(115200);
  irsend.begin();
  cmdTopic = String("sharpac/") + MQTT_SECRET + "/cmd";
  statusTopic = String("sharpac/") + MQTT_SECRET + "/status";
#if defined(ESP8266)
  clientId = String(MQTT_CLIENT) + "-" + String(ESP.getChipId(), HEX);
#else
  clientId = String(MQTT_CLIENT) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
#endif
  connectWifi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(4096);
  mqtt.setCallback(onMqtt);
  if (MDNS.begin(MDNS_HOST)) {
    MDNS.addService("http", "tcp", 80);
  }
  server.on("/ir", HTTP_ANY, handleHttp);
  server.onNotFound([]() {
    corsHeaders();
    server.send(404, "application/json", "{\"ok\":false}");
  });
  server.begin();
}

void loop() {
  server.handleClient();
  if (!mqtt.connected() && millis() - lastMqtt > 5000) {
    lastMqtt = millis();
    connectMqtt();
  }
  mqtt.loop();
  delay(2);
}
