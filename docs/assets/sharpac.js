(function (root) {
  const HDR_MARK = 3770;
  const HDR_SPACE = 1846;
  const BIT_MARK = 494;
  const ZERO_SPACE = 442;
  const ONE_SPACE = 1378;
  const GAP = 65000;
  const FREQ = 38000;
  const MIN_TEMP = 18;
  const MAX_TEMP = 32;
  const FAN = { auto: 2, "1": 3, "2": 5, "3": 7 };
  const MODE = { cool: 2, heat: 1 };

  function checksum(bytes) {
    let x = 0;
    for (let i = 0; i < 12; i++) x ^= bytes[i];
    x ^= bytes[12] & 0x0f;
    x ^= (x >> 4) & 0x0f;
    return x & 0x0f;
  }

  function stateBytes(state) {
    let bytes;
    if (!state.power) {
      bytes = [0xaa, 0x5a, 0xcf, 0x10, 0x0f, 0x21, 0x71, 0x00, 0x08, 0x80, 0x00, 0xf0, 0x01];
    } else {
      const temp = Math.max(MIN_TEMP, Math.min(MAX_TEMP, (state.temp ?? 24) | 0));
      const code = temp - 17;
      const mode = MODE[state.mode] ?? MODE.cool;
      const fan = FAN[state.fan] ?? FAN.auto;
      bytes = [0xaa, 0x5a, 0xcf, 0x10, code, 0x31, (fan << 4) | mode, 0x00, 0x08, 0x80, 0x00, 0xf0, 0x01];
    }
    bytes[12] = (checksum(bytes) << 4) | 0x01;
    return bytes;
  }

  function pulses(state) {
    const bytes = stateBytes(state);
    const out = [HDR_MARK, HDR_SPACE];
    for (const b of bytes) {
      for (let i = 0; i < 8; i++) {
        out.push(BIT_MARK);
        out.push((b >> i) & 1 ? ONE_SPACE : ZERO_SPACE);
      }
    }
    out.push(BIT_MARK, GAP);
    return out;
  }

  function describe(state) {
    const bytes = stateBytes(state);
    const raw = pulses(state);
    return { bytes, pulses: raw, checksum: (bytes[12] >> 4) & 0x0f, freq: FREQ, count: raw.length };
  }

  const api = { FREQ, MIN_TEMP, MAX_TEMP, FAN, MODE, checksum, stateBytes, pulses, describe };
  root.SharpAC = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
