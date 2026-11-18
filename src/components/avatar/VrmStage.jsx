'use client';
// src/components/avatar/VrmStage.jsx
// A 3D character drawn in the page with three.js + three-vrm. (AARIA 4.5, demo)
//
// Web only: no native renderer. The 3D engine is loaded when this component
// mounts and not before, so nobody who stays on the 2D face downloads it.
// Mouth: the five VRM vowel presets, fed from the reply audio
// (src/lib/avatar/mouth.js). Pose: the same machine the 2D face uses, so
// "happy" is shown only for a confirmed completed action.
//
// It reports frames per second through onFps - a number to MEASURE on a real
// phone, not a claim that it is fast.

import { useEffect, useRef, useState } from 'react';
import { usePose, useMouth } from '@/lib/avatar/useAvatar';

export default function VrmStage({ status = 'idle', modelUrl, height = 360, onFps, onState }) {
  const holder = useRef(null);
  const pose = usePose(status);
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const { shapes } = useMouth();
  const [state, setState] = useState('loading');   // loading | ready | failed
  const [detail, setDetail] = useState('');

  useEffect(() => { onState?.(state); }, [state, onState]);

  useEffect(() => {
    let alive = true, raf = 0, renderer = null, vrm = null, onResize = null;
    (async () => {
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm');
        if (!alive || !holder.current) return;

        const el = holder.current;
        const w = el.clientWidth || 320, h = height;
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));   // phones: sharp enough, far cheaper
        renderer.setSize(w, h);
        el.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(24, w / h, 0.1, 20);
        camera.position.set(0, 1.36, 1.55);
        camera.lookAt(0, 1.34, 0);
        scene.add(new THREE.AmbientLight(0xffffff, 1.5));
        const sun = new THREE.DirectionalLight(0xffffff, 2.0);
        sun.position.set(1, 2, 2);
        scene.add(sun);

        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        const gltf = await loader.loadAsync(modelUrl, (p) => {
          if (alive && p.total) setDetail(`${Math.round((p.loaded / p.total) * 100)}%`);
        });
        if (!alive) return;
        vrm = gltf.userData.vrm;
        if (!vrm) throw new Error('not a VRM character');
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons?.(gltf.scene);
        vrm.scene.traverse((o) => { o.frustumCulled = false; });
        VRMUtils.rotateVRM0?.(vrm);
        scene.add(vrm.scene);

        // Arms down from the T-pose the file is saved in.
        const bone = (name) => vrm.humanoid?.getNormalizedBoneNode(name);
        const lArm = bone('leftUpperArm'), rArm = bone('rightUpperArm');
        if (lArm) lArm.rotation.z = -1.25;
        if (rArm) rArm.rotation.z = 1.25;
        const head = bone('head'), neck = bone('neck'), chest = bone('chest') || bone('spine');
        const ex = vrm.expressionManager;
        const set = (name, v) => { try { ex?.setValue(name, v); } catch { } };

        onResize = () => {
          const nw = el.clientWidth || w;
          renderer.setSize(nw, h); camera.aspect = nw / h; camera.updateProjectionMatrix();
        };
        window.addEventListener('resize', onResize);

        const clock = new THREE.Clock();
        let nextBlink = 2 + Math.random() * 3, blinkT = -1;
        let mood = { happy: 0, sad: 0, tiltX: 0, tiltZ: 0 };
        const frames = [];
        let lastReport = performance.now(), lastFrame = performance.now();
        setState('ready');

        const tick = () => {
          if (!alive) return;
          raf = requestAnimationFrame(tick);
          if (document.hidden) return;                 // never draw a hidden page
          const dt = Math.min(clock.getDelta(), 0.1);
          const t = clock.elapsedTime;
          const p = poseRef.current;

          // Mouth, from the sound.
          const s = shapes.current;
          const talking = p === 'speaking';
          set('aa', talking ? s.aa : 0); set('ih', talking ? s.ih : 0); set('ou', talking ? s.ou : 0);
          set('ee', talking ? s.ee : 0); set('oh', talking ? s.oh : 0);
          // The last mouth value, where a phone test can read it.
          try { window.__qkStageMouth = talking ? Number(s.aa.toFixed(3)) : 0; } catch { }

          // Blink.
          nextBlink -= dt;
          if (nextBlink <= 0 && blinkT < 0) { blinkT = 0; nextBlink = 2.4 + Math.random() * 3.6; }
          if (blinkT >= 0) {
            blinkT += dt;
            const k = blinkT < 0.07 ? blinkT / 0.07 : Math.max(0, 1 - (blinkT - 0.07) / 0.09);
            set('blink', p === 'done' ? 0 : k);
            if (blinkT > 0.16) blinkT = -1;
          }

          // Mood and head, eased toward the pose.
          const want = {
            happy: p === 'done' ? 1 : 0,   // only ever for a confirmed completed action
            sad: p === 'oops' ? 0.8 : 0,
            tiltX: p === 'thinking' ? -0.16 : p === 'listening' ? 0.06 : 0,
            tiltZ: p === 'thinking' ? 0.12 : p === 'listening' ? -0.08 : 0,
          };
          for (const k of Object.keys(want)) mood[k] += (want[k] - mood[k]) * Math.min(1, dt * 6);
          set('happy', mood.happy); set('sad', mood.sad);
          set('lookUp', p === 'thinking' ? 0.6 : 0);
          if (head) {
            head.rotation.x = mood.tiltX + Math.sin(t * 0.9) * 0.02 + (talking ? Math.sin(t * 5.1) * 0.012 : 0);
            head.rotation.z = mood.tiltZ + Math.sin(t * 0.6) * 0.015;
            head.rotation.y = Math.sin(t * 0.4) * 0.05;
          }
          if (neck) neck.rotation.x = Math.sin(t * 0.9 + 0.6) * 0.01;
          if (chest) chest.rotation.x = Math.sin(t * 1.5) * 0.012;     // breathing

          vrm.update(dt);
          renderer.render(scene, camera);

          // Frames per second, measured from real frame gaps.
          const nowMs = performance.now();
          frames.push(nowMs - lastFrame); lastFrame = nowMs;
          if (frames.length > 240) frames.shift();
          if (nowMs - lastReport > 1000 && frames.length > 20) {
            lastReport = nowMs;
            const sorted = [...frames].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            const worst = sorted[sorted.length - 1];
            onFps?.({ medianFps: Math.round(1000 / median), worstFrameMs: Math.round(worst), talking });
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
        vrm?.scene?.traverse((o) => {
          o.geometry?.dispose?.();
          const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
          mats.forEach((m) => { Object.values(m).forEach((v) => v?.isTexture && v.dispose()); m.dispose?.(); });
        });
        renderer?.dispose(); renderer?.forceContextLoss?.();
        renderer?.domElement?.remove();
      } catch { }
    };
  }, [modelUrl, height, shapes, onFps]);

  return (
    <div ref={holder} style={{ width: '100%', height, position: 'relative' }}>
      {state !== 'ready' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 16,
        }}>
          {state === 'loading' ? `Loading the 3D character… ${detail}` : `The 3D character could not be shown on this device (${detail}). The 2D face still works.`}
        </div>
      )}
    </div>
  );
}
