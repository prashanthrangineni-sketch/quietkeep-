// src/components/avatar/saree-pallu.js
// The saree's end piece (pallu): a strip of saree cloth from the right hip,
// across the chest and over the left shoulder, falling down the back.
// Built on the device from the character's own shape (rays find the body's
// surface), then fixed to the upper spine so it moves with her.
// Made by Pranix AI Labs, 23 Nov 2026 - no outside 3D file.

export async function addPallu(THREE, { root, bone, meshes, textureUrl }) {
  const chest = bone('Bip01 Spine2') || bone('Bip01 Spine1') || bone('Bip01 Spine');
  const pelvis = bone('Bip01 Pelvis') || bone('Bip01 Spine');
  const lUp = bone('Bip01 L UpperArm'), rThigh = bone('Bip01 R Thigh'), neck = bone('Bip01 Neck');
  if (!chest || !pelvis || !lUp || !rThigh || !neck) return null;
  root.updateMatrixWorld(true);
  const P = (b) => b.getWorldPosition(new THREE.Vector3());
  const pel = P(pelvis), sh = P(lUp), hip = P(rThigh), nk = P(neck);
  const body = meshes.filter((m) => !/opacity/i.test(String(m.material?.name || '')));

  // Find the body's surface along a ray; fall back to a guess if nothing is hit.
  const rc = new THREE.Raycaster();
  const surface = (x, y, fromFront, guessZ) => {
    const o = new THREE.Vector3(x, y, fromFront ? pel.z + 5 : pel.z - 5);
    rc.set(o, new THREE.Vector3(0, 0, fromFront ? -1 : 1));
    const hit = rc.intersectObjects(body, false)[0];
    return hit ? hit.point.z + (fromFront ? 0.018 : -0.018) : guessZ;
  };
  const top = (x, z) => {
    rc.set(new THREE.Vector3(x, nk.y + 2, z), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObjects(body, false)[0];
    return hit ? hit.point.y + 0.02 : sh.y + 0.06;
  };

  // Path in the picture plane: front (hip -> left shoulder), over the top, back (down).
  const shX = pel.x + (sh.x - pel.x) * 0.62;
  const pts = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {               // front, diagonal across the chest
    const k = i / N;
    const x = hip.x + (shX - hip.x) * k;
    const y = (pel.y - 0.02) + ((sh.y - 0.02) - (pel.y - 0.02)) * Math.pow(k, 0.9);
    pts.push(new THREE.Vector3(x, y, surface(x, y, true, pel.z + 0.14)));
  }
  const midZ = (surface(shX, sh.y - 0.04, true, pel.z + 0.1) + surface(shX, sh.y - 0.04, false, pel.z - 0.1)) / 2;
  pts.push(new THREE.Vector3(shX, top(shX, midZ), midZ));
  for (let i = 1; i <= 14; i++) {              // back, falling straight down
    const k = i / 14;
    const y = (sh.y - 0.04) + ((pel.y - 0.35) - (sh.y - 0.04)) * k;
    const x = shX + 0.02 * k;
    pts.push(new THREE.Vector3(x, y, surface(x, y, false, pel.z - 0.14)));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');

  // A ribbon along the path, its width lying on the body.
  const SEG = 90, width = Math.abs(sh.x - pel.x) * 0.95;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    // The cloth lies on the body: facing forward on the chest, up on the
    // shoulder, backward on the back. Its width runs across that surface.
    const front = Math.max(-1, Math.min(1, (p.z - midZ) / 0.06));
    const n = new THREE.Vector3(0, 1 - Math.abs(front), front).normalize();
    const side = new THREE.Vector3().crossVectors(tan, n);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize().multiplyScalar(width / 2);
    pos.push(p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z);
    uv.push(0, t, 1, t);
    if (i < SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const tex = await new THREE.TextureLoader().loadAsync(textureUrl);
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; // decorated end hangs at the back
  const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'saree-pallu';
  mesh.frustumCulled = false;
  root.add(mesh);
  chest.attach(mesh);                          // follows her breathing and leaning
  return mesh;
}
