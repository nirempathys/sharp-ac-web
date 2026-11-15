(function (root) {
  const listeners = new Set();
  let client = null;
  let connected = false;
  let statusTopic = "";

  function emit(event) {
    listeners.forEach((fn) => fn(event));
  }

  function on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function disconnect(silent) {
    if (client) {
      try {
        client.end(true);
      } catch (e) {}
      client = null;
    }
    connected = false;
    if (!silent) emit({ type: "mqtt", connected: false });
  }

  function connect({ broker, secret }) {
    disconnect(true);
    statusTopic = "sharpac/" + secret + "/status";
    const clientId = "sharpac-web-" + Math.random().toString(16).slice(2, 10);
    client = window.mqtt.connect(broker, {
      clientId,
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 8000,
      keepalive: 30,
    });
    client.on("connect", () => {
      connected = true;
      client.subscribe(statusTopic, { qos: 1 });
      emit({ type: "mqtt", connected: true, broker });
    });
    client.on("reconnect", () => emit({ type: "mqtt", connecting: true }));
    client.on("close", () => {
      connected = false;
      emit({ type: "mqtt", connected: false });
    });
    client.on("error", (err) => emit({ type: "error", message: err.message }));
    client.on("message", (topic, payload) => {
      if (topic !== statusTopic) return;
      try {
        emit({ type: "ack", data: JSON.parse(payload.toString()) });
      } catch (e) {}
    });
  }

  function publish(secret, payload) {
    if (!client || !connected) throw new Error("MQTT belum connect");
    client.publish("sharpac/" + secret + "/cmd", JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) emit({ type: "error", message: err.message });
    });
  }

  async function post(url, payload, timeout = 6000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
        mode: "cors",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  root.Transport = { on, connect, disconnect, publish, post, isConnected: () => connected };
})(typeof globalThis !== "undefined" ? globalThis : this);
