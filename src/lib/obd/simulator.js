// src/lib/obd/simulator.js
// QuietKeep Car Reader (OBD-II over Bluetooth) - Task Card DRV-06
// In-memory ELM327 OBD-II simulator for testing and developer preview without a physical vehicle.

export class ObdSimulator {
  constructor(options = {}) {
    this.options = {
      vin: options.vin || 'WVWZZZ3CZWE123456',
      faults: options.faults !== undefined ? [...options.faults] : ['P0301', 'P0420'],
      mil: options.mil !== undefined ? options.mil : true,
      failureMode: options.failureMode || null, // 'no_data' | 'unable_to_connect' | 'slow_replies' | 'dropped_prompt' | 'garbage_bytes'
      responseDelayMs: options.responseDelayMs || 20,
      headers: true,
      ...options,
    };

    this.listeners = [];
    this.tick = 0;
    this.coolantTemp = 40; // Starts cold at 40 °C, warms to 90 °C
  }

  /**
   * Transport interface: write command string from ELM327 manager.
   */
  write(data) {
    const raw = typeof data === 'string' ? data : String(data);
    const cmd = raw.replace(/[\r\n]+/g, '').trim().toUpperCase();
    this.tick++;

    // Increment simulated coolant warming (40 -> 90 °C)
    if (this.coolantTemp < 90) {
      this.coolantTemp = Math.min(90, this.coolantTemp + 3);
    }

    let delay = this.options.responseDelayMs;
    if (this.options.failureMode === 'slow_replies') {
      delay = 3000; // Triggers default 2000ms timeout
    }

    setTimeout(() => {
      this._respondTo(cmd);
    }, delay);
  }

  /**
   * Transport interface: register listener for data emitted from car.
   */
  onData(cb) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  setFailureMode(mode) {
    this.options.failureMode = mode;
  }

  setFaults(faults, mil = true) {
    this.options.faults = [...faults];
    this.options.mil = mil;
  }

  _emit(str) {
    for (const listener of this.listeners) {
      try {
        listener(str);
      } catch (err) {
        console.error('ObdSimulator listener error:', err);
      }
    }
  }

  _respondTo(cmd) {
    // 1. Handle global failure modes
    if (this.options.failureMode === 'unable_to_connect') {
      return this._emitWithPrompt('UNABLE TO CONNECT');
    }

    if (this.options.failureMode === 'garbage_bytes') {
      return this._emitWithPrompt('!@#$%^&*()_+ GARBAGE NON_HEX BYTES ??');
    }

    // 2. AT commands (always succeed unless unable_to_connect)
    if (cmd.startsWith('AT')) {
      return this._handleAtCommand(cmd);
    }

    // 3. For OBD requests (Mode 01, 03, 09), check 'no_data' failure mode
    if (this.options.failureMode === 'no_data') {
      return this._emitWithPrompt('NO DATA');
    }

    // 4. Mode 01 requests
    if (cmd.startsWith('01')) {
      return this._handleMode01(cmd);
    }

    // 5. Mode 03 request (Read DTCs)
    if (cmd === '03') {
      return this._handleMode03();
    }

    // 6. Mode 09 requests (e.g. 0902 VIN)
    if (cmd.startsWith('09')) {
      return this._handleMode09(cmd);
    }

    // Unrecognized
    this._emitWithPrompt('?');
  }

  _emitWithPrompt(body) {
    if (this.options.failureMode === 'dropped_prompt') {
      // Intentionally omit '>' prompt to test client timeout recovery
      this._emit(`\r\r${body}\r\r`);
      return;
    }
    this._emit(`\r\r${body}\r\r>`);
  }

  _handleAtCommand(cmd) {
    const at = cmd.slice(2);
    if (at === 'Z' || at === 'WS') {
      return this._emitWithPrompt('ELM327 v1.5');
    }
    if (at === 'DPN') {
      return this._emitWithPrompt('6'); // ISO 15765-4 (CAN 11/500)
    }
    if (at === 'DP') {
      return this._emitWithPrompt('AUTO, ISO 15765-4 (CAN 11/500)');
    }
    if (at === 'RV') {
      return this._emitWithPrompt('14.1V');
    }
    if (at === 'I') {
      return this._emitWithPrompt('ELM327 v1.5 QuietKeep');
    }
    if (at === 'IGN') {
      return this._emitWithPrompt('ON');
    }
    if (at === 'H1') {
      this.options.headers = true;
      return this._emitWithPrompt('OK');
    }
    if (at === 'H0') {
      this.options.headers = false;
      return this._emitWithPrompt('OK');
    }
    // ATE0, ATL0, ATS0, ATSP0 etc.
    return this._emitWithPrompt('OK');
  }

  _handleMode01(cmd) {
    const pid = cmd.slice(2, 4);

    // Supported PIDs 01-20
    if (pid === '00') {
      // 7E8 06 41 00 BE 3F B8 13
      // Also emit transmission 7E9 to test multi-ECU filtering
      const p1 = '7E8 06 41 00 BE 3F B8 13';
      const p2 = '7E9 06 41 00 80 00 00 00';
      return this._emitWithPrompt(`SEARCHING...\r\n${p1}\r\n${p2}`);
    }

    // Supported PIDs 21-40
    if (pid === '20') {
      return this._emitWithPrompt('7E8 06 41 20 80 00 00 01');
    }

    // Supported PIDs 41-60
    if (pid === '40') {
      return this._emitWithPrompt('7E8 06 41 40 40 00 00 00');
    }

    // 0101: Monitor Status (MIL + DTC count)
    if (pid === '01') {
      const milBit = this.options.mil ? 0x80 : 0x00;
      const count = (this.options.faults || []).length & 0x7F;
      const a = (milBit | count).toString(16).toUpperCase().padStart(2, '0');
      return this._emitWithPrompt(`7E8 06 41 01 ${a} 07 65 00`);
    }

    // 0104: Engine load (~24-32%)
    if (pid === '04') {
      const loadPct = 25 + (this.tick % 8);
      const byteVal = Math.round((loadPct * 255) / 100).toString(16).toUpperCase().padStart(2, '0');
      return this._emitWithPrompt(`7E8 03 41 04 ${byteVal}`);
    }

    // 0105: Coolant temperature (warming 40 -> 90 °C)
    if (pid === '05') {
      const byteVal = (this.coolantTemp + 40).toString(16).toUpperCase().padStart(2, '0');
      return this._emitWithPrompt(`7E8 03 41 05 ${byteVal}`);
    }

    // 010C: Engine RPM (idle 750–850 rpm)
    if (pid === '0C') {
      const rpm = 750 + ((this.tick * 17) % 100); // 750 to 850 rpm
      const raw = rpm * 4;
      const a = Math.floor(raw / 256).toString(16).toUpperCase().padStart(2, '0');
      const b = (raw % 256).toString(16).toUpperCase().padStart(2, '0');
      return this._emitWithPrompt(`7E8 04 41 0C ${a} ${b}`);
    }

    // 010D: Vehicle speed (0–60 km/h)
    if (pid === '0D') {
      const speed = (this.tick * 5) % 65; // 0 to 60 km/h
      const byteVal = speed.toString(16).toUpperCase().padStart(2, '0');
      return this._emitWithPrompt(`7E8 03 41 0D ${byteVal}`);
    }

    // 012F: Fuel level (~65%)
    if (pid === '2F') {
      const fuelPct = 65;
      const byteVal = Math.round((fuelPct * 255) / 100).toString(16).toUpperCase().padStart(2, '0');
      return this._emitWithPrompt(`7E8 03 41 2F ${byteVal}`);
    }

    // 0142: Control module voltage (~14.1 V = 14100 mV)
    if (pid === '42') {
      const mv = 14100 + ((this.tick % 5) * 10);
      const a = Math.floor(mv / 256).toString(16).toUpperCase().padStart(2, '0');
      const b = (mv % 256).toString(16).toUpperCase().padStart(2, '0');
      return this._emitWithPrompt(`7E8 04 41 42 ${a} ${b}`);
    }

    // Default PID response
    return this._emitWithPrompt('NO DATA');
  }

  _handleMode03() {
    const faults = this.options.faults || [];
    if (faults.length === 0) {
      return this._emitWithPrompt('7E8 02 43 00 00 00 00 00');
    }

    // Encode fault codes into 2-byte pairs
    const pairs = [];
    const PREFIX_MAP = { P: 0, C: 1, B: 2, U: 3 };

    for (const code of faults) {
      const clean = code.toUpperCase().trim();
      const prefixChar = clean[0];
      const prefixBits = PREFIX_MAP[prefixChar] || 0;
      const secondDigit = parseInt(clean[1], 16) & 0x03;
      const thirdDigit = parseInt(clean[2], 16) & 0x0F;
      const fourthDigit = parseInt(clean[3], 16) & 0x0F;
      const fifthDigit = parseInt(clean[4], 16) & 0x0F;

      const b1 = (prefixBits << 6) | (secondDigit << 4) | thirdDigit;
      const b2 = (fourthDigit << 4) | fifthDigit;
      pairs.push(b1.toString(16).toUpperCase().padStart(2, '0'));
      pairs.push(b2.toString(16).toUpperCase().padStart(2, '0'));
    }

    // Pad to multiple of 6 bytes (3 DTCs per frame) if needed
    while (pairs.length < 6) {
      pairs.push('00');
    }

    return this._emitWithPrompt(`7E8 06 43 ${pairs.slice(0, 6).join(' ')}`);
  }

  _handleMode09(cmd) {
    const pid = cmd.slice(2, 4);
    if (pid === '02') {
      // VIN multi-frame ISO-TP response
      const vin = (this.options.vin || 'WVWZZZ3CZWE123456').padEnd(17, '0').slice(0, 17);
      const hexChars = [];
      for (let i = 0; i < vin.length; i++) {
        hexChars.push(vin.charCodeAt(i).toString(16).toUpperCase().padStart(2, '0'));
      }

      // Frame 0 (First Frame): 10 14 49 02 01 + first 3 chars
      const f0 = `7E8 10 14 49 02 01 ${hexChars.slice(0, 3).join(' ')}`;
      // Frame 1 (Consecutive 21): 21 + next 7 chars
      const f1 = `7E8 21 ${hexChars.slice(3, 10).join(' ')}`;
      // Frame 2 (Consecutive 22): 22 + last 7 chars
      const f2 = `7E8 22 ${hexChars.slice(10, 17).join(' ')}`;

      return this._emitWithPrompt(`${f0}\r\n${f1}\r\n${f2}`);
    }

    return this._emitWithPrompt('NO DATA');
  }

  close() {
    this.listeners = [];
  }
}
