# QuietKeep Hardware MVP — Raspberry Pi Home Agent

## Goal

A physical always-on device that sends voice to `/api/voice/capture` and
speaks back the `tts_response`. No new backend required — uses the existing
API exactly as the Android app does.

---

## Hardware Bill of Materials (≈ ₹2,640)

| Component | Purpose | Cost |
|---|---|---|
| Raspberry Pi Zero 2W | Main compute, WiFi | ₹1,400 |
| USB OTG adapter (mini→A) | Connect USB mic | ₹80 |
| USB condenser microphone | Audio input | ₹350 |
| PAM8403 amplifier module | Drive speaker | ₹80 |
| 3W 4Ω speaker | TTS playback | ₹120 |
| MicroSD 16GB (Sandisk) | OS + script | ₹180 |
| USB-C 5V 2A power supply | Power | ₹200 |
| Dupont wires + breadboard | Wiring | ₹80 |
| ABS project box | Enclosure | ₹150 |

---

## Setup

### 1. Flash OS

```bash
# Flash Raspberry Pi OS Lite (64-bit) to SD card
# Enable SSH + WiFi in /boot/config.txt before first boot
```

### 2. Install dependencies

```bash
sudo apt update && sudo apt install -y python3-pip espeak-ng
pip3 install pyaudio requests
```

### 3. Create config file

```json
// /home/pi/config.json
{
  "device_token":  "YOUR_SUPABASE_USER_JWT",
  "sarvam_key":    "YOUR_SARVAM_API_KEY",
  "server_url":    "https://quietkeep.com",
  "language":      "en-IN",
  "tts_voice":     "en-in",
  "workspace_id":  null
}
```

- `device_token`: A valid Supabase JWT for the user's account.
  Generate via: Settings → Profile → "Device Token" (or from Supabase Auth UI).
- `workspace_id`: Set to the business workspace UUID for merchant mode, or `null` for personal.

---

## Python Script

```python
# /home/pi/quietkeep_agent.py
import pyaudio, struct, wave, requests, subprocess, json, time, os

CONFIG   = json.load(open('/home/pi/config.json'))
TOKEN    = CONFIG['device_token']
SERVER   = CONFIG['server_url']
SARVAM   = 'https://api.sarvam.ai/speech-to-text'
LANG     = CONFIG.get('language', 'en-IN')
VOICE    = CONFIG.get('tts_voice', 'en-in')
WS_ID    = CONFIG.get('workspace_id')   # None = personal mode
SOURCE   = 'merchant_device' if WS_ID else 'home_agent'

CHUNK = 1024
RATE  = 16000
SECS  = 4   # record 4 seconds per capture

def record_pcm() -> bytes:
    p = pyaudio.PyAudio()
    stream = p.open(format=pyaudio.paInt16, channels=1, rate=RATE,
                    input=True, frames_per_buffer=CHUNK)
    frames = [stream.read(CHUNK) for _ in range(int(RATE / CHUNK * SECS))]
    stream.stop_stream(); stream.close(); p.terminate()
    return b''.join(frames)

def pcm_to_wav(pcm: bytes) -> bytes:
    import io, wave as wv
    buf = io.BytesIO()
    with wv.open(buf, 'wb') as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(RATE)
        wf.writeframes(pcm)
    return buf.getvalue()

def transcribe(pcm: bytes) -> str | None:
    wav = pcm_to_wav(pcm)
    try:
        r = requests.post(
            SARVAM,
            files={'file': ('clip.wav', wav, 'audio/wav')},
            data={'language_code': LANG, 'model': 'saarika:v2'},
            headers={'api-subscription-key': CONFIG['sarvam_key']},
            timeout=10
        )
        return r.json().get('transcript') if r.ok else None
    except Exception as e:
        print(f'[STT] error: {e}')
        return None

def capture(transcript: str) -> str | None:
    payload = {
        'transcript':   transcript,
        'source':       SOURCE,
        'language':     LANG,
    }
    if WS_ID:
        payload['workspace_id'] = WS_ID
    try:
        r = requests.post(
            f'{SERVER}/api/voice/capture',
            json=payload,
            headers={
                'Authorization': f'Bearer {TOKEN}',
                'Content-Type': 'application/json',
            },
            timeout=15
        )
        if r.ok:
            return r.json().get('tts_response')
        print(f'[CAPTURE] HTTP {r.status_code}')
        return None
    except Exception as e:
        print(f'[CAPTURE] error: {e}')
        return None

def speak(text: str):
    subprocess.run(['espeak-ng', '-v', VOICE, '-s', '145', text],
                   check=False, capture_output=True)

def main():
    speak('QuietKeep ready.')
    print('[AGENT] running. Press Ctrl+C to stop.')
    while True:
        try:
            pcm = record_pcm()
            # Simple silence detection: skip if RMS below threshold
            rms = (sum(struct.unpack('<' + 'h' * (len(pcm)//2), pcm) [i]**2
                       for i in range(len(pcm)//2)) / (len(pcm)//2)) ** 0.5
            if rms < 300:
                continue
            t = transcribe(pcm)
            if t and len(t.strip()) > 3:
                print(f'[HEARD] {t}')
                resp = capture(t)
                speak(resp or 'Saved.')
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f'[AGENT] error: {e}')
            time.sleep(1)

if __name__ == '__main__':
    main()
```

---

## Run on boot

```bash
# Add to /etc/rc.local before exit 0:
/usr/bin/python3 /home/pi/quietkeep_agent.py >> /var/log/quietkeep.log 2>&1 &
```

---

## API flow

```
Device records 4s of audio
    ↓
POST to Sarvam STT → transcript
    ↓
POST /api/voice/capture
    Authorization: Bearer <device_token>
    { transcript, source: "home_agent", language: "en-IN" }
    ↓
Response: { tts_response, keep, biz_entry? }
    ↓
espeak-ng speaks tts_response
```

**For merchant device**, set `workspace_id` in config. The same endpoint
automatically routes through `business-resolver` and writes to
`business_ledger`. No backend change required.

---

## No backend dependency

The hardware agent is a pure client. It uses:
- `/api/sarvam-stt` (optional, can call Sarvam directly)
- `/api/voice/capture` (existing, unchanged)

No new routes, no new DB tables, no new environment variables.
