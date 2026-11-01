"""Quick-mode mix: an original synthesized score, foley on the page's events, and narration → <film>/out/mix.wav
usage: <LIB>/.venv/bin/python mix.py <film dir>
Reads <film>/events.json (from core/render/events.mjs), <film>/content.json and <film>/voice/<id>.wav.
A cut from a production can bring its own sound: content.score (a composed score, a WAV in the film folder) replaces the
synthesized one, and a scene's sound (the ambience and foley made for its shot, a WAV) plays under it from the cut.
Uses the library's core/audio/sfx.py (LIB = library root, default ~/lemo-opuscar)."""
import json
import os
import re
import sys

import numpy as np
import soundfile as sf
import soxr

LIB = os.environ.get('LIB') or os.path.expanduser('~/lemo-opuscar')
sys.path.insert(0, os.path.join(LIB, 'core', 'audio'))
import sfx  # noqa: E402
from sfx import SR, add, bp, env_exp, hp, lp, noise, norm, t_  # noqa: E402

film = sys.argv[1]
EVJ = json.load(open(os.path.join(film, 'events.json')))
content = json.load(open(os.path.join(film, 'content.json')))
TPL = content.get('template', 'swiss')
DUR, EV = EVJ['dur'], EVJ['ev']
BPM = min(132, max(84, content.get('bpm') or (112 if TPL == 'swiss' else 104)))
BEAT = 60 / BPM
N = int((DUR + 0.5) * SR)
music, fol, vox = (np.zeros((N, 2)) for _ in range(3))
scenes = [e for e in EV if e['type'] == 'scene']
end_t = next((e['t'] for e in EV if e['type'] in ('off',)), None)
last = scenes[-1]
if end_t is None:
    end_t = last['t'] + last['dur'] - 0.45


def hz(m): return 440 * 2 ** ((m - 69) / 12)


def sine(f, d, ph=0.0): return np.sin(2 * np.pi * f * t_(d) + ph)


def layer(*xs):
    """sum sounds of different lengths"""
    out = np.zeros(max(len(x) for x in xs))
    for x in xs: out[:len(x)] += x
    return out


def attack(x, a=.004):
    n = min(len(x), int(a * SR))
    if n: x[:n] *= np.linspace(0, 1, n)
    return x


def marimba(f, v=1.0):
    d = .7
    x = sine(f, d) * env_exp(d, .28) + .28 * sine(4 * f, d) * env_exp(d, .035) + .08 * sine(9.9 * f, d) * env_exp(d, .012)
    return attack(x * v, .002)


def pluck(f, v=1.0):
    d = .8
    x = (sine(f, d) + .35 * sine(2 * f, d) + .12 * sine(3 * f, d) * env_exp(d, .05)) * env_exp(d, .22)
    return attack(lp(x, 3200) * v, .003)


def bass(f, d, v=1.0):
    x = sine(f, d) + .35 * sine(2 * f, d) + .18 * sine(3 * f, d)
    e = np.minimum(1, np.linspace(d, 0, len(x)) / .05) * (0.65 + .35 * env_exp(d, .12))
    return attack(x * e * v, .006)


def pad(notes, d, v=1.0):
    x = np.zeros(int(round(d * SR)))
    for m in notes:
        for det in (-.06, .06):
            f = hz(m + det)
            for h in range(1, 6):
                x += sine(h * f, d, ph=h * 1.3 + det * 40) / h
    x = lp(x, 1600)
    e = np.minimum(1, t_(d) / .7) * np.minimum(1, (d - t_(d)) / .9).clip(0)
    return x / max(1, len(notes)) * e * v * .25


def hat(v=1.0):
    d = .05
    return hp(noise(d), 7000) * env_exp(d, .011) * v


def scene_at(t):
    s = scenes[0]
    for x in scenes:
        if t >= x['t']: s = x
    return s


def drop_until(kind):
    """the drums rest through a number scene until its lock lands"""
    out = []
    for s in scenes:
        if s['kind'] == kind:
            lock = next((e['t'] for e in EV if e['type'] == 'lock' and s['t'] <= e['t'] < s['t'] + s['dur']), s['t'] + s['dur'])
            out.append((s['t'], lock))
    return out


rests = drop_until('number')
resting = lambda t: any(a <= t < b for a, b in rests)


def score_swiss():
    prog = [(45, [57, 60, 64, 69, 72]), (41, [57, 60, 65, 69, 72]), (48, [55, 60, 64, 67, 72]), (43, [55, 59, 62, 67, 71])]
    pat = [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 1, 3, 4, 3, 2, 1]
    nb = int(end_t / BEAT)
    for b in range(nb):
        t = b * BEAT
        root, tones = prog[(b // 4) % 4]
        sc = scene_at(t)['i']
        drums = sc >= 1 and not resting(t)
        if drums:
            add(music, sfx.thump(.9, f=58), t, .55)
            add(music, hat(), t + BEAT / 2, .16, .25)
            if b % 2: add(music, hat(.6), t + BEAT * .75, .1, -.25)
        add(music, bass(hz(root), BEAT * .9), t, .32 if sc >= 1 else .22)
        for k in range(4):
            m = tones[pat[(b * 4 + k) % 16]]
            if sc == 0 and k % 2: continue
            add(music, marimba(hz(m), .9 if k == 0 else .6), t + k * BEAT / 4, .2, .3 if k % 2 else -.3)
    root, tones = prog[(nb // 4) % 4]
    for m in tones[:3]:
        add(music, marimba(hz(m), 1), end_t, .25)
    add(music, bass(hz(root), 1.2), end_t, .35)


def score_keynote():
    prog = [(50, [62, 66, 69, 73, 76]), (47, [59, 62, 66, 69, 74]), (43, [59, 62, 66, 67, 71]), (45, [61, 64, 69, 71, 76])]
    bars = int(end_t / (BEAT * 4)) + 1
    for bar in range(bars):
        t = bar * BEAT * 4
        if t >= end_t: break
        root, tones = prog[(bar // 2) % 4]
        if bar % 2 == 0:
            d = min(BEAT * 8, end_t - t + .6)
            add(music, pad([root + 12] + tones[:3], d), t, .9)
        for b in range(4):
            tb = t + b * BEAT
            if tb >= end_t: break
            sc = scene_at(tb)['i']
            if sc >= 1 and not resting(tb):
                add(music, sine(46, .22) * env_exp(.22, .07), tb, .35)
            if sc >= 1:
                for k in range(2):
                    m = tones[(b * 2 + k + bar) % len(tones)] + (12 if (b + k) % 3 == 0 and sc >= 3 else 0)
                    add(music, pluck(hz(m), .8), tb + k * BEAT / 2, .16, .35 if k else -.35)
    # the film ends on digital zero: a single sine drops away as the screen switches off
    music[int(end_t * SR):] = 0


FOLEY = {
    'swiss': {
        'snap': lambda e: (sfx.clack(.9, .5 if e.get('soft') else 1), .3),
        'block': lambda e: (layer(lp(noise(.14), 900) * env_exp(.14, .03), sfx.thump(.5, f=90)), .45),
        'tick': lambda e: (sfx.step(.6), .1),
        'lock': lambda e: (layer(sfx.thump(1, f=80), sfx.clack(.7, .6) * .5), .6),
        'glide': lambda e: (np.sin(2 * np.pi * np.cumsum(np.linspace(660, 990, int(.7 * SR))) / SR) * np.sin(np.pi * t_(.7) / .7) ** 2, .06),
        'accent': lambda e: (sfx.ding(.8), .1),
        'wipe': lambda e: (sfx.whoosh(.32), .22),
        'knife': lambda e: (hp(noise(.06), 3000) * env_exp(.06, .01) + sine(3600, .06) * env_exp(.06, .008) * .4, .3),
    },
    'keynote': {
        'tick': lambda e: ((sine(2400, .12) + .5 * sine(3610, .12)) * env_exp(.12, .025), .07 if e.get('soft') else .11),
        'sweep': lambda e: (bp(noise(1.1), 2500, 7000) * np.sin(np.pi * t_(1.1) / 1.1) ** 2, .08),
        'snap': lambda e: (sfx.click(.75, 1), .2),
        'soft': lambda e: (sfx.pop(.6), .06),
        'lock': lambda e: (layer(sfx.thump(1, f=60), sfx.ding(.5)), .45),
        'whoosh': lambda e: (sfx.whoosh(.28), .18),
        'collapse': lambda e: (sfx.whoosh(.4)[::-1].copy(), .22),
        'off': lambda e: (np.sin(2 * np.pi * np.cumsum(np.geomspace(900, 50, int(.45 * SR))) / SR) * env_exp(.45, .2), .22),
    },
}


def voices():
    vdir = os.path.join(film, 'voice')
    for e in EV:
        if e['type'] != 'voice': continue
        f = os.path.join(vdir, e['id'] + '.wav')
        if not os.path.exists(f): continue
        a, sr = sf.read(f, dtype='float64')
        if a.ndim > 1: a = a.mean(1)
        a = sfx.compress(a / (np.abs(a).max() + 1e-9) * .9, thr=.3, ratio=3)
        if sr != SR: a = soxr.resample(a, sr, SR)
        rms = np.sqrt(np.mean(a ** 2)) + 1e-9
        add(vox, a * (.1 / rms), e['t'], 1.0)


def stereo(rel):
    """a WAV from the film folder as stereo at SR, or None if it isn't there"""
    if not isinstance(rel, str) or not re.fullmatch(r'(score|sound)/[\w-]+\.wav', rel): return None
    f = os.path.join(film, rel)
    if not os.path.isfile(f): return None
    a, sr = sf.read(f, dtype='float64', always_2d=True)
    a = np.repeat(a[:, :1], 2, 1) if a.shape[1] == 1 else a[:, :2]
    return soxr.resample(a, sr, SR) if sr != SR else a


def fades(a, fin, fout):
    n, m = min(len(a), int(fin * SR)), min(len(a), int(fout * SR))
    if n: a[:n] *= np.linspace(0, 1, n)[:, None]
    if m: a[-m:] *= np.linspace(1, 0, m)[:, None]
    return a


def rms(a): return np.sqrt(np.mean(a ** 2)) + 1e-9


def composed():
    """the production's score, laid from the top and faded out as the film ends"""
    a = stereo(content.get('score'))
    if a is None: return False
    a = fades(a[:N].copy(), .05, 0)
    music[:len(a)] += a * (.05 / rms(a[:int(min(DUR, len(a) / SR) * SR)]))
    k = int(max(0, DUR - 1.6) * SR)
    music[k:] *= np.linspace(1, 0, len(music) - k)[:, None] ** 1.5
    return True


def beds():
    """each shot's own ambience and foley, for exactly as long as the shot is on screen"""
    for e in EV:
        if e['type'] != 'scene': continue
        sc = content['scenes'][e['i']] if e['i'] < len(content['scenes']) else {}
        a = stereo(sc.get('sound'))
        if a is None: continue
        a = fades(a[:int((e['dur'] + .08) * SR)].copy(), .03, .12)
        s = int(e['t'] * SR)
        n = min(len(a), N - s)
        # quiet and even: to room-tone level, but no single sound in it louder than a soft touch
        if n > 0: fol[s:s + n] += a[:n] * min(.03 / rms(a), .2 / (np.abs(a).max() + 1e-9))


if not composed():
    (score_swiss if TPL == 'swiss' else score_keynote)()
    music *= .035 / (np.sqrt(np.mean(music[:int(end_t * SR)] ** 2)) + 1e-9)
fx = FOLEY.get(TPL, FOLEY['swiss'])
for e in EV:
    if e['type'] in fx:
        x, g = fx[e['type']](e)
        add(fol, x, e['t'], g)
beds()
voices()

# duck music ~10 dB and foley ~4 dB while the voice speaks
pres = np.abs(vox).max(1) > 1e-3
w = int(.25 * SR)
pres = np.convolve(pres.astype(float), np.ones(w) / w, 'same').clip(0, 1)
mix = music * (1 - .68 * pres)[:, None] + fol * (1 - .37 * pres)[:, None] + vox
mix = np.stack([sfx.limit(mix[:, c], .95) for c in range(2)], 1)
os.makedirs(os.path.join(film, 'out'), exist_ok=True)
sf.write(os.path.join(film, 'out', 'mix.wav'), mix[:int(DUR * SR)].astype(np.float32), SR, subtype='PCM_24')
print('mix', round(DUR, 2), 's', os.path.join(film, 'out', 'mix.wav'))
