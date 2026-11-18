'use client';
// src/components/avatar/HumanStage.jsx
// A realistic-style 3D person in the page. (AARIA 4.6, demo)
//
// The characters are six everyday adults from the Microsoft
// Rocketbox avatar library (MIT licence - recorded beside the files in
// public/avatars/realistic-rocketbox/LICENCE.md). Each was converted once from
// FBX to GLB; nothing else about them was changed.
//
// What it is: a sculpted 3D person with a skeleton, drawn fresh on the device,
// like a game character. What it is not: a video of a real face, and not
// anyone's likeness. It is a stand-in, not Aaria's final look.
//
// Same rules as every other face: mouth from the reply audio, a smile only for
// a confirmed completed action, and a measured frames-per-second reading.

import { useEffect, useRef, useState } from 'react';
import { usePose, useMouth } from '@/lib/avatar/useAvatar';

// The characters this stage can draw. Each folder has its licence record in
// public/avatars/realistic-rocketbox/LICENCE.md.
export const HUMANS = {
  'woman-1': { group: 'woman', dir: '/avatars/realistic-rocketbox/female-adult-01/', model: 'Female_Adult_01_facial.glb', tex: 'f001' },
  'woman-2': { group: 'woman', dir: '/avatars/realistic-rocketbox/female-adult-15/', model: 'Female_Adult_15_facial.glb', tex: 'f018' },
  'man-1': { group: 'man', dir: '/avatars/realistic-rocketbox/male-adult-01/', model: 'Male_Adult_01_facial.glb', tex: 'm002' },
  'man-2': { group: 'man', dir: '/avatars/realistic-rocketbox/male-adult-07/', model: 'Male_Adult_07_facial.glb', tex: 'm013' },
  'man-3': { group: 'man', dir: '/avatars/realistic-rocketbox/male-adult-08/', model: 'Male_Adult_08_facial.glb', tex: 'm014' },
  'man-4': { group: 'man', dir: '/avatars/realistic-rocketbox/male-adult-21/', model: 'Male_Adult_21_facial.glb', tex: 'm251' },
};
// Colour pictures by the last part of the material's name (f001_body, m002_head ...).
const TEXTURE_FOR = {
  body: { file: (t) => `${t}_body_color.jpg` },
  head: { file: (t) => `${t}_head_color.jpg` },
  opacity: { file: (t) => `${t}_opacity_color.png`, cutout: true },   // hair and lashes
  keffiyeh: { file: (t) => `${t}_keffiyeh_color.jpg`, twoSided: true },   // head cloth
};
// The model's own face shapes (its names), driven from our five vowels.
const P = 'blendShape1.';
const SHAPES = {
  aa: [P + 'AA_VI_10_aa'], ee: [P + 'AA_VI_11_E'], ih: [P + 'AA_VI_12_I'],
  oh: [P + 'AA_VI_13_O'], ou: [P + 'AA_VI_14_U'],
  blink: [P + 'AU_45_Blink'],
  smile: [P + 'AK_44_MouthSmileLeft', P + 'AK_45_MouthSmileRight', P + 'AU_06_CheekRaiser'],
  frown: [P + 'AK_30_MouthFrownLeft', P + 'AK_31_MouthFrownRight'],
  eyesUp: [P + 'AU_63_EyesUp'],
};

export default function HumanStage({ status = 'idle', who = 'woman-1', height = 360, onFps }) {
  const character = HUMANS[who] || HUMANS['woman-1'];
  const holder = useRef(null);
  const pose = usePose(status);
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const { shapes } = useMouth();
  const [state, setState] = useState('loading');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    let alive = true, raf = 0, renderer = null, root = null, onResize = null;
    (async () => {
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        if (!alive || !holder.current) return;
        const el = holder.current;
        const w = el.clientWidth || 320, h = height;
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(w, h);
        el.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0xb0a090, 2.2));
        const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(0.6, 1.2, 2); scene.add(key);
        const camera = new THREE.PerspectiveCamera(22, w / h, 0.05, 20);

        const gltf = await new GLTFLoader().loadAsync(character.dir + character.model, (p) => {
          if (alive && p.total) setDetail(`${Math.round((p.loaded / p.total) * 100)}%`);
        });
        if (!alive) return;
        root = gltf.scene;
        scene.add(root);

        // The colour pictures are separate files; hang each on its material.
        const texLoader = new THREE.TextureLoader();
        const meshes = [];
        const jobs = [];
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.frustumCulled = false;
          meshes.push(o);
          const spec = TEXTURE_FOR[String(o.material?.name || '').split('_').pop()];
          if (!spec) return;
          jobs.push(texLoader.loadAsync(character.dir + spec.file(character.tex)).then((tex) => {
            tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
            const m = o.material;
            m.map = tex; m.color?.set(0xffffff); m.metalness = 0; m.roughness = 0.78;
            if (spec.cutout) { m.transparent = false; m.alphaTest = 0.4; m.side = THREE.DoubleSide; }
            if (spec.twoSided) m.side = THREE.DoubleSide;
            m.needsUpdate = true;
          }));
        });
        await Promise.all(jobs);
        if (!alive) return;

        const norm = (s) => String(s || '').replace(/[\s_]/g, '').toLowerCase();
        const bones = {};
        root.traverse((o) => { if (o.isBone || o.type === 'Object3D') bones[norm(o.name)] = bones[norm(o.name)] || o; });
        const bone = (name) => bones[norm(name)];
        const head = bone('Bip01 Head'), spine = bone('Bip01 Spine1') || bone('Bip01 Spine');

        // Arms down from the T-pose: turn each upper arm so it points at the floor.
        root.updateMatrixWorld(true);
        const aim = (upper, lower, dir) => {
          if (!upper || !lower) return;
          const a = new THREE.Vector3(), b = new THREE.Vector3();
          upper.getWorldPosition(a); lower.getWorldPosition(b);
          const cur = b.sub(a).normalize();
          const q = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().normalize());
          const parentQ = new THREE.Quaternion(); upper.parent.getWorldQuaternion(parentQ);
          const worldQ = new THREE.Quaternion(); upper.getWorldQuaternion(worldQ);
          upper.quaternion.copy(parentQ.invert().multiply(q.multiply(worldQ)));
          root.updateMatrixWorld(true);
        };
        aim(bone('Bip01 L UpperArm'), bone('Bip01 L Forearm'), new THREE.Vector3(0.22, -1, 0.05));
        aim(bone('Bip01 R UpperArm'), bone('Bip01 R Forearm'), new THREE.Vector3(-0.22, -1, 0.05));

        // Frame the head and shoulders, from the front.
        const headPos = new THREE.Vector3();
        (head || root).getWorldPosition(headPos);
        const target = headPos.clone().add(new THREE.Vector3(0, 0.02, 0));
        camera.position.copy(target).add(new THREE.Vector3(0, 0.02, 1.25));
        camera.lookAt(target);
        const headBase = head ? head.quaternion.clone() : null;
        const spineBase = spine ? spine.quaternion.clone() : null;

        const setShape = (names, v) => {
          for (const m of meshes) {
            const dict = m.morphTargetDictionary, inf = m.morphTargetInfluences;
            if (!dict || !inf) continue;
            for (const n of names) { const i = dict[n]; if (i !== undefined) inf[i] = v; }
          }
        };

        onResize = () => {
          const nw = el.clientWidth || w;
          renderer.setSize(nw, h); camera.aspect = nw / h; camera.updateProjectionMatrix();
        };
        window.addEventListener('resize', onResize);

        const clock = new THREE.Clock();
        const euler = new THREE.Euler(), dq = new THREE.Quaternion();
        let nextBlink = 2 + Math.random() * 3, blinkT = -1;
        const mood = { smile: 0, frown: 0, up: 0, tiltX: 0, tiltZ: 0 };
        const frames = [];
        let lastReport = performance.now(), lastFrame = performance.now();
        setState('ready');

        const tick = () => {
          if (!alive) return;
          raf = requestAnimationFrame(tick);
          if (document.hidden) return;
          const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime, p = poseRef.current;
          const s = shapes.current, talking = p === 'speaking';
          // This model's mouth shapes are large; a person talking opens far less than a shout.
          const g = talking ? 0.55 : 0;
          setShape(SHAPES.aa, s.aa * g); setShape(SHAPES.ee, s.ee * g);
          setShape(SHAPES.ih, s.ih * g); setShape(SHAPES.oh, s.oh * g);
          setShape(SHAPES.ou, s.ou * g);
          try { window.__qkStageMouth = talking ? Number(s.aa.toFixed(3)) : 0; } catch { }

          nextBlink -= dt;
          if (nextBlink <= 0 && blinkT < 0) { blinkT = 0; nextBlink = 2.4 + Math.random() * 3.6; }
          if (blinkT >= 0) {
            blinkT += dt;
            setShape(SHAPES.blink, blinkT < 0.07 ? blinkT / 0.07 : Math.max(0, 1 - (blinkT - 0.07) / 0.09));
            if (blinkT > 0.16) blinkT = -1;
          }

          const want = {
            smile: p === 'done' ? 0.9 : 0,           // only for a confirmed completed action
            frown: p === 'oops' ? 0.7 : 0,
            up: p === 'thinking' ? 0.7 : 0,
            tiltX: p === 'thinking' ? -0.12 : p === 'listening' ? 0.05 : 0,
            tiltZ: p === 'thinking' ? 0.1 : p === 'listening' ? -0.07 : 0,
          };
          for (const k of Object.keys(want)) mood[k] += (want[k] - mood[k]) * Math.min(1, dt * 6);
          setShape(SHAPES.smile, mood.smile); setShape(SHAPES.frown, mood.frown); setShape(SHAPES.eyesUp, mood.up);

          if (head && headBase) {
            // Small turns added in the world's axes, so the bone's own axes do not matter.
            euler.set(
              mood.tiltX + Math.sin(t * 0.9) * 0.02 + (talking ? Math.sin(t * 5.1) * 0.01 : 0),
              Math.sin(t * 0.4) * 0.05,
              mood.tiltZ + Math.sin(t * 0.6) * 0.012,
            );
            dq.setFromEuler(euler);
            const pq = new THREE.Quaternion(); head.parent.getWorldQuaternion(pq);
            head.quaternion.copy(pq.clone().invert().multiply(dq).multiply(pq).multiply(headBase));
          }
          if (spine && spineBase) {
            euler.set(Math.sin(t * 1.5) * 0.008, 0, 0); dq.setFromEuler(euler);
            spine.quaternion.copy(spineBase).multiply(dq);                 // breathing
          }

          renderer.render(scene, camera);

          const nowMs = performance.now();
          frames.push(nowMs - lastFrame); lastFrame = nowMs;
          if (frames.length > 240) frames.shift();
          if (nowMs - lastReport > 1000 && frames.length > 20) {
            lastReport = nowMs;
            const sorted = [...frames].sort((a, b) => a - b);
            onFps?.({ medianFps: Math.round(1000 / sorted[Math.floor(sorted.length / 2)]), worstFrameMs: Math.round(sorted[sorted.length - 1]), talking });
          }
        };
        tick();
      } catch (err) {
        if (alive) { setState('failed'); setDetail(String(err?.message || err)); }
      }
    })();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (onResize) window.removeEventListener('resize', onResize);
      try {
        root?.traverse((o) => {
          o.geometry?.dispose?.();
          const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
          mats.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
        });
        renderer?.dispose(); renderer?.forceContextLoss?.(); renderer?.domElement?.remove();
      } catch { }
    };
  }, [height, shapes, onFps, character]);

  return (
    <div ref={holder} style={{ width: '100%', height, position: 'relative' }}>
      {state !== 'ready' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 16,
        }}>
          {state === 'loading' ? `Loading the 3D person… ${detail}` : `The 3D person could not be shown on this device (${detail}). The 2D face still works.`}
        </div>
      )}
    </div>
  );
}
