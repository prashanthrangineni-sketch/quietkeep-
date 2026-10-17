// src/lib/obd/elm327.js
// QuietKeep Car Reader (OBD-II over Bluetooth) - Task Card DRV-06
// ELM327 Text Protocol Manager. Transport-agnostic, command-queued, strictly read-only.

/**
 * Validates that an OBD or AT command is strictly read-only.
 *
 * ALLOW-LIST, not a block-list (review fix, 17 Oct 2026): the first version
 * only blocked a few known writes (mode 04, ATPP, ATSD, ATCS) and let every
 * other AT command through — including AT@3, which writes the adapter's
 * one-time identifier to its permanent memory. Now only the exact commands
 * this reader needs are allowed; everything else is refused.
 *
 *   OBD: mode 01 (live data), 03 (stored faults), 09 (vehicle info) only,
 *        hex digits only, optional trailing response-count digit.
 *   AT : reset/identify/format/protocol-auto commands listed below only.
 * The same list is enforced again in QkObdPlugin.java.
 */
export const ALLOWED_AT = new Set([
  'Z', 'WS', 'D', 'I', 'RV', 'DP', 'DPN',
  'E0', 'E1', 'L0', 'L1', 'S0', 'S1', 'H0', 'H1',
  'SP0', 'AT0', 'AT1', 'AT2',
]);

export function assertReadOnlyCommand(command) {
  if (typeof command !== 'string') {
    throw new Error('Command must be a string');
  }
  const cmd = command.replace(/\s+/g, '').toUpperCase();
  if (!cmd) throw new Error('Command forbidden: empty command');

  if (cmd.startsWith('AT')) {
    const at = cmd.slice(2);
    if (!ALLOWED_AT.has(at)) {
      throw new Error(`Command forbidden: AT command '${cmd}' is not on the read-only allow-list`);
    }
    return;
  }

  if (!/^[0-9A-F]+$/.test(cmd)) {
    throw new Error(`Command forbidden: '${cmd}' is not a hex OBD request`);
  }
  if (cmd.startsWith('04')) {
    throw new Error('Command forbidden: Mode 04 (clear trouble codes) is strictly prohibited');
  }
  const mode = cmd.slice(0, 2);
  const ok =
    (mode === '01' && /^01[0-9A-F]{2}[0-9A-F]?$/.test(cmd)) ||
    (mode === '03' && /^03[0-9A-F]?$/.test(cmd)) ||
    (mode === '09' && /^09[0-9A-F]{2}[0-9A-F]?$/.test(cmd));
  if (!ok) {
    throw new Error(`Command forbidden: OBD request '${cmd}' is not allowed (only modes 01, 03, 09 reads)`);
  }
}

/**
 * Reassembles multi-line ISO-TP CAN frames into a unified payload string.
 * Supports both:
 * 1. Headers on (ATH1): e.g. "7E8 10 14 49 02 01 57 56..." followed by "7E8 21 ...", "7E8 22 ..."
 * 2. ELM multi-frame (0:, 1:, 2:) format
 */
export function assembleIsoTpFrames(lines) {
  if (!lines || lines.length === 0) return '';
  if (lines.length === 1) return lines[0];

  // Check if lines have ECU headers like 7E8 / 7E9
  const headerMatch = lines[0].match(/^(7E[89A-F]|[0-9A-F]{3})\s*(.*)$/i);
  if (headerMatch) {
    // Group frames by ECU (default 7E8)
    const ecuLines = [];
    const targetEcu = headerMatch[1].toUpperCase();

    for (const l of lines) {
      const m = l.match(/^([0-9A-F]{3})\s*(.*)$/i);
      if (m && m[1].toUpperCase() === targetEcu) {
        ecuLines.push(m[2].replace(/\s+/g, ''));
      } else if (!m) {
        ecuLines.push(l.replace(/\s+/g, ''));
      }
    }

    let payload = '';
    for (const raw of ecuLines) {
      if (raw.length < 2) continue;
      const pciType = raw[0];
      if (pciType === '0') {
        // Single frame: 0[len][data...]
        const len = parseInt(raw[1], 16);
        payload += raw.slice(2, 2 + len * 2);
      } else if (pciType === '1') {
        // First frame: 1[len_high][len_low][data...]
        // e.g. 10 14 49 02 ... -> high=0, low=14 (20 bytes total)
        payload += raw.slice(4);
      } else if (pciType === '2') {
        // Consecutive frame: 2[seq][data...]
        payload += raw.slice(2);
      } else {
        // Normal data frame without explicit PCI nibble
        payload += raw;
      }
    }
    return payload;
  }

  // Check for ELM format: "0: 49 02 01 ...", "1: ...", "2: ..."
  if (/^[0-9]:/i.test(lines[0])) {
    let payload = '';
    for (const l of lines) {
      const clean = l.replace(/^[0-9A-F]:\s*/i, '').replace(/\s+/g, '');
      payload += clean;
    }
    return payload;
  }

  // Fallback: join clean lines
  return lines.map(l => l.replace(/\s+/g, '')).join('');
}

/**
 * Filter and sort multi-ECU responses so that primary Engine ECU (7E8) comes first.
 */
export function prioritizeEngineEcu(lines) {
  if (!lines || lines.length <= 1) return lines;

  // Separate lines belonging to 7E8 vs other ECUs (like 7E9 transmission)
  const engine7E8 = [];
  const otherEcus = [];
  const nonHeader = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^7E8\b/i.test(trimmed)) {
      engine7E8.push(trimmed);
    } else if (/^[0-9A-F]{3}\b/i.test(trimmed)) {
      otherEcus.push(trimmed);
    } else {
      nonHeader.push(trimmed);
    }
  }

  if (engine7E8.length > 0) {
    return [...engine7E8, ...otherEcus, ...nonHeader];
  }
  return lines;
}

export class Elm327 {
  /**
   * @param {Object} transport Transport adapter { write(str): Promise<void>|void, onData(cb): Function }
   */
  constructor(transport) {
    if (!transport || typeof transport.write !== 'function') {
      throw new Error('Transport with a write(str) function is required');
    }
    this.transport = transport;
    this.queue = [];
    this.currentTask = null;
    this.buffer = '';
    this.protocol = null;

    // Register incoming data listener
    if (typeof this.transport.onData === 'function') {
      this.unsubscribe = this.transport.onData((data) => this._handleData(data));
    }
  }

  /**
   * Internal data handler that watches for the '>' prompt.
   */
  _handleData(chunk) {
    if (!chunk) return;
    const str = typeof chunk === 'string' ? chunk : String(chunk);
    this.buffer += str;

    // Check if prompt '>' has arrived
    if (this.buffer.includes('>')) {
      if (this.currentTask && this.currentTask.timer) {
        clearTimeout(this.currentTask.timer);
        this.currentTask.timer = null;
      }
      this._resolveCurrent();
    }
  }

  _resolveCurrent() {
    if (!this.currentTask) return;
    const task = this.currentTask;
    this.currentTask = null;

    const raw = this.buffer;
    this.buffer = '';

    // Strip '>' prompt
    const withoutPrompt = raw.replace(/>/g, '').trim();

    // Check for known ELM327 error states
    const upper = withoutPrompt.toUpperCase();
    if (upper.includes('UNABLE TO CONNECT')) {
      return task.reject(new Error('ELM327: UNABLE TO CONNECT'));
    }
    if (upper.includes('CAN ERROR')) {
      return task.reject(new Error('ELM327: CAN ERROR'));
    }
    if (upper.includes('BUS INIT: ...ERROR') || upper.includes('BUS INIT: ERROR')) {
      return task.reject(new Error('ELM327: BUS INIT ERROR'));
    }
    if (upper.trim() === '?' || upper.endsWith('\n?')) {
      return task.reject(new Error(`ELM327: Unrecognized command '${task.command}'`));
    }
    if (upper.includes('STOPPED')) {
      return task.reject(new Error('ELM327: STOPPED'));
    }

    // Split lines and clean
    const rawLines = withoutPrompt
      .split(/[\r\n]+/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.toUpperCase().includes('SEARCHING...'));

    // Filter out echo of the command if present as the first line
    const filteredLines = rawLines.filter(l => {
      const cleanLine = l.replace(/\s+/g, '').toUpperCase();
      const cleanCmd = task.command.replace(/\s+/g, '').toUpperCase();
      return cleanLine !== cleanCmd;
    });

    // Check for NO DATA
    const hasNoData = filteredLines.some(l => l.toUpperCase() === 'NO DATA');

    // Prioritize 7E8 engine ECU lines
    const sortedLines = prioritizeEngineEcu(filteredLines);

    // Assemble ISO-TP multi-frame if multiple lines exist
    const assembled = assembleIsoTpFrames(sortedLines);

    task.resolve({
      command: task.command,
      raw: withoutPrompt,
      lines: sortedLines,
      assembled,
      noData: hasNoData,
    });

    // Process next item in queue
    setImmediate ? setImmediate(() => this._processQueue()) : setTimeout(() => this._processQueue(), 0);
  }

  /**
   * Queue a command to be sent to ELM327.
   * Only one command is processed at a time.
   *
   * @param {string} command OBD/AT command string
   * @param {Object} [options] { timeoutMs: number }
   * @returns {Promise<Object>}
   */
  send(command, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        assertReadOnlyCommand(command);
      } catch (err) {
        return reject(err);
      }

      this.queue.push({
        command: command.trim(),
        options,
        resolve,
        reject,
      });

      this._processQueue();
    });
  }

  _processQueue() {
    if (this.currentTask || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    this.currentTask = task;
    this.buffer = '';

    // Determine timeout: default 2000 ms, 5000 ms for ATZ and 0100
    const upperCmd = task.command.toUpperCase().replace(/\s+/g, '');
    let timeoutMs = task.options.timeoutMs;
    if (!timeoutMs) {
      if (upperCmd === 'ATZ' || upperCmd === '0100') {
        timeoutMs = 5000;
      } else {
        timeoutMs = 2000;
      }
    }

    task.timer = setTimeout(() => {
      if (this.currentTask === task) {
        this.currentTask = null;
        this.buffer = '';
        task.reject(new Error(`ELM327 command '${task.command}' timed out after ${timeoutMs} ms`));
        this._processQueue();
      }
    }, timeoutMs);

    // Send command to transport with carriage return
    try {
      this.transport.write(task.command + '\r');
    } catch (err) {
      clearTimeout(task.timer);
      this.currentTask = null;
      task.reject(err);
      this._processQueue();
    }
  }

  /**
   * Standard ELM327 Initialization Sequence:
   * 1. ATZ (Reset) - 5 s timeout
   * 2. ATE0 (Echo off)
   * 3. ATL0 (Linefeeds off)
   * 4. ATS0 (Spaces off)
   * 5. ATH1 (Headers on - to identify 7E8 vs 7E9)
   * 6. ATSP0 (Protocol auto-detect)
   * 7. 0100 (Query supported PIDs 01-20, initiates bus protocol search) - 5 s timeout
   * 8. ATDPN (Query negotiated protocol number)
   */
  async init() {
    // 1. Reset
    await this.send('ATZ', { timeoutMs: 5000 });
    // 2. Echo off
    await this.send('ATE0');
    // 3. Linefeeds off
    await this.send('ATL0');
    // 4. Spaces off (ELM327 responses compact; parser handles both spaced and unspaced)
    await this.send('ATS0');
    // 5. Headers on (to distinguish Engine 7E8 from Transmission 7E9)
    await this.send('ATH1');
    // 6. Protocol auto
    await this.send('ATSP0');
    // 7. Bus detect trigger via 0100
    const res0100 = await this.send('0100', { timeoutMs: 5000 });
    // 8. Protocol query
    const resDpn = await this.send('ATDPN');
    this.protocol = resDpn.raw.trim();

    return {
      ok: true,
      protocol: this.protocol,
      supported0100: res0100.assembled || res0100.raw,
    };
  }

  destroy() {
    if (this.currentTask && this.currentTask.timer) {
      clearTimeout(this.currentTask.timer);
      this.currentTask = null;
    }
    this.queue = [];
    if (typeof this.unsubscribe === 'function') {
      this.unsubscribe();
    }
  }
}
