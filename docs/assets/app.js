(function () {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem("sharpac." + key);
        return value === null ? fallback : JSON.parse(value);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("sharpac." + key, JSON.stringify(value));
      } catch (e) {}
    },
  };

  function newSecret() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  const state = {
    power: store.get("power", false),
    temp: store.get("temp", 24),
    mode: store.get("mode", "cool"),
    fan: store.get("fan", "auto"),
  };
  const settings = {
    transport: store.get("transport", "mqtt"),
    broker: store.get("broker", "wss://broker.hivemq.com:8884/mqtt"),
    secret: store.get("secret", newSecret()),
    httpurl: store.get("httpurl", "http://esp-ir.local/ir"),
    webhook: store.get("webhook", ""),
  };
  store.set("secret", settings.secret);

  const el = {
    status: $("status"),
    power: $("power"),
    tminus: $("tminus"),
    tplus: $("tplus"),
    tempval: $("tempval"),
    send: $("send"),
    copy: $("copy"),
    raw: $("raw"),
    transport: $("transport"),
    broker: $("broker"),
    secret: $("secret"),
    topic: $("topic"),
    httpurl: $("httpurl"),
    webhook: $("webhook"),
    connect: $("connect"),
    gen: $("gen"),
    log: $("log"),
    mqttFields: $("mqttFields"),
    httpFields: $("httpFields"),
    webhookFields: $("webhookFields"),
  };

  let seq = 0;

  function persist() {
    store.set("power", state.power);
    store.set("temp", state.temp);
    store.set("mode", state.mode);
    store.set("fan", state.fan);
  }

  function setStatus(text) {
    el.status.textContent = text;
  }

  function log(message) {
    const time = new Date().toLocaleTimeString();
    el.log.textContent = "[" + time + "] " + message + "\n" + el.log.textContent;
    const lines = el.log.textContent.split("\n");
    if (lines.length > 120) el.log.textContent = lines.slice(0, 120).join("\n");
  }

  function render() {
    el.power.textContent = state.power ? "ON" : "OFF";
    el.power.classList.toggle("on", state.power);
    el.tempval.textContent = state.temp + "°C";
    document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === state.mode));
    document.querySelectorAll("[data-fan]").forEach((b) => b.classList.toggle("active", b.dataset.fan === state.fan));
    el.topic.value = "sharpac/" + settings.secret + "/cmd";
    el.secret.value = settings.secret;
    el.broker.value = settings.broker;
    el.transport.value = settings.transport;
    el.httpurl.value = settings.httpurl;
    el.webhook.value = settings.webhook;
    el.mqttFields.hidden = settings.transport !== "mqtt";
    el.httpFields.hidden = settings.transport !== "http";
    el.webhookFields.hidden = settings.transport !== "webhook";
    const info = SharpAC.describe(state);
    el.raw.textContent =
      "bytes     " + info.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ") + "\n" +
      "checksum  " + info.checksum + "   pulses " + info.count + "   freq " + info.freq + "\n" +
      "state     " + (state.power ? "ON" : "OFF") + "  " + state.temp + "C  " + state.mode + "  fan " + state.fan;
  }

  async function send(reason) {
    const info = SharpAC.describe(state);
    const payload = {
      key: settings.secret,
      seq: ++seq,
      ts: Date.now(),
      freq: info.freq,
      bytes: info.bytes,
      pulses: info.pulses,
      state: { power: state.power, temp: state.temp, mode: state.mode, fan: state.fan },
    };
    if (settings.transport === "mqtt") {
      try {
        Transport.publish(settings.secret, payload);
        log("MQTT #" + payload.seq + " " + reason);
      } catch (e) {
        log("MQTT error: " + e.message);
      }
      return;
    }
    const url = settings.transport === "http" ? settings.httpurl : settings.webhook;
    if (!url) {
      log("URL kosong");
      return;
    }
    try {
      const result = await Transport.post(url, payload);
      log("HTTP #" + payload.seq + " " + reason + ": " + result.slice(0, 120));
    } catch (e) {
      log("HTTP error: " + e.message);
    }
  }

  function changeTemp(delta) {
    const next = Math.max(SharpAC.MIN_TEMP, Math.min(SharpAC.MAX_TEMP, state.temp + delta));
    if (next === state.temp) return;
    state.temp = next;
    persist();
    render();
    if (state.power) send("temp " + next);
  }

  function connect() {
    if (settings.transport !== "mqtt") return;
    if (!window.mqtt) {
      log("MQTT.js gagal load");
      return;
    }
    Transport.connect({ broker: settings.broker, secret: settings.secret });
  }

  el.power.addEventListener("click", () => {
    state.power = !state.power;
    persist();
    render();
    send(state.power ? "power on" : "power off");
  });
  el.tminus.addEventListener("click", () => changeTemp(-1));
  el.tplus.addEventListener("click", () => changeTemp(1));
  document.querySelectorAll("[data-mode]").forEach((b) => {
    b.addEventListener("click", () => {
      state.mode = b.dataset.mode;
      persist();
      render();
      if (state.power) send("mode " + state.mode);
    });
  });
  document.querySelectorAll("[data-fan]").forEach((b) => {
    b.addEventListener("click", () => {
      state.fan = b.dataset.fan;
      persist();
      render();
      if (state.power) send("fan " + state.fan);
    });
  });
  el.send.addEventListener("click", () => send("manual"));
  el.copy.addEventListener("click", async () => {
    const info = SharpAC.describe(state);
    const payload = {
      key: settings.secret,
      freq: info.freq,
      bytes: info.bytes,
      pulses: info.pulses,
      state: { power: state.power, temp: state.temp, mode: state.mode, fan: state.fan },
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      log("JSON copied");
    } catch (e) {
      log("Copy gagal: " + e.message);
    }
  });
  el.transport.addEventListener("change", () => {
    settings.transport = el.transport.value;
    store.set("transport", settings.transport);
    render();
    if (settings.transport === "mqtt") connect();
    else Transport.disconnect();
  });
  el.broker.addEventListener("change", () => {
    settings.broker = el.broker.value.trim();
    store.set("broker", settings.broker);
    if (settings.transport === "mqtt") connect();
  });
  el.secret.addEventListener("change", () => {
    settings.secret = el.secret.value.replace(/[^a-zA-Z0-9_-]/g, "") || newSecret();
    store.set("secret", settings.secret);
    render();
    if (settings.transport === "mqtt") connect();
  });
  el.httpurl.addEventListener("change", () => {
    settings.httpurl = el.httpurl.value.trim();
    store.set("httpurl", settings.httpurl);
  });
  el.webhook.addEventListener("change", () => {
    settings.webhook = el.webhook.value.trim();
    store.set("webhook", settings.webhook);
  });
  el.connect.addEventListener("click", () => {
    if (settings.transport === "mqtt") connect();
    else send("test");
  });
  el.gen.addEventListener("click", () => {
    settings.secret = newSecret();
    store.set("secret", settings.secret);
    render();
    if (settings.transport === "mqtt") connect();
  });

  Transport.on((event) => {
    if (event.type === "mqtt") {
      if (event.connected) {
        setStatus("MQTT connected");
        log("MQTT connected: " + event.broker);
      } else if (event.connecting) {
        setStatus("MQTT reconnecting");
      } else {
        setStatus("MQTT offline");
        log("MQTT offline");
      }
    } else if (event.type === "ack") {
      const data = event.data || {};
      setStatus("ESP " + (data.ok ? "ok" : "error") + (data.ip ? " · " + data.ip : ""));
      log("ESP ack #" + (data.seq ?? "?") + " " + (data.msg ?? ""));
    } else if (event.type === "error") {
      setStatus("error");
      log("Error: " + event.message);
    }
  });

  render();
  if (settings.transport === "mqtt") setTimeout(connect, 300);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
