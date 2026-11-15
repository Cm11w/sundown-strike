// Scene construction for DUSK HARBOR: dramatic sunset over the water, warm
// key light with soft shadows, haze, real materials (brick, concrete, wood,
// rusted steel), never flat colour. Budget: shared geometries/materials,
// ~200 draw calls, one shadow-casting light, instanced grass, sprite glows.
import * as THREE from 'three';
import { MAP, SOLIDS } from './mapdata.js';
import { SQUADS } from './config.js';

const SUN_DIR = new THREE.Vector3(0.82, 0.28, -0.35).normalize(); // low, over the water (east)

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { sunDir: { value: SUN_DIR } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sunDir;
      void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 horizon = vec3(1.00, 0.55, 0.28);
        vec3 mid     = vec3(0.90, 0.50, 0.49);
        vec3 zenith  = vec3(0.26, 0.33, 0.57);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, zenith, smoothstep(0.18, 0.65, h));
        float sun = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.62, 0.30) * pow(sun, 350.0) * 1.2;  // disc
        col += vec3(1.0, 0.55, 0.30) * pow(sun, 6.0) * 0.42;   // glow
        // Thin cloud bands catching the sunset.
        float band = sin(vDir.y * 42.0 + sin(atan(vDir.z, vDir.x) * 3.0) * 1.5);
        float clouds = smoothstep(0.55, 0.95, band) * smoothstep(0.35, 0.08, abs(h - 0.16));
        col = mix(col, vec3(0.98, 0.62, 0.52), clouds * 0.42);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

function waterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, sunDir: { value: SUN_DIR } },
    vertexShader: `
      varying vec3 vPos; uniform float t;
      void main(){
        vec3 p = position;
        p.y += sin(p.x * 0.35 + t * 1.1) * 0.06 + cos(p.z * 0.5 + t * 0.8) * 0.05;
        vPos = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vPos; uniform float t; uniform vec3 sunDir;
      void main(){
        vec3 deep = vec3(0.13, 0.26, 0.34);
        vec3 sky  = vec3(0.95, 0.50, 0.30);
        float rip = sin(vPos.x * 1.4 + t * 1.3) * sin(vPos.z * 1.1 - t * 0.9);
        float fres = 0.55 + 0.35 * rip;
        vec3 col = mix(deep, sky, fres * 0.55);
        float glint = pow(max(0.0, 1.0 - abs(vPos.z + 8.0) * 0.06), 3.0) * (0.6 + 0.4 * rip);
        col += vec3(1.0, 0.7, 0.4) * glint * 0.7;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export function buildWorld(scene, T, quality) {
  const high = quality !== 'low';
  scene.fog = new THREE.FogExp2(0xd98a5a, 0.008);
  scene.background = new THREE.Color(0x36415c);

  // Sky dome.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 18), skyMaterial());
  scene.add(sky);

  // Lighting: warm low sun + cool sky fill + warm ground bounce.
  const sun = new THREE.DirectionalLight(0xffb36b, 3.0);
  sun.position.copy(SUN_DIR).multiplyScalar(90);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 20; sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x8a7bb8, 0x6b4a34, 1.75);
  scene.add(hemi);
  const bounce = new THREE.AmbientLight(0xff9a5c, 0.45);
  scene.add(bounce);
  // Cool western fill: lifts the shadow sides that face away from the low
  // sun so the scene stays readable when looking into the sunset. No shadows.
  const fill = new THREE.DirectionalLight(0x7a86b8, 1.0);
  fill.position.set(-60, 30, 20);
  scene.add(fill);
  // Reused muzzle-flash light (moved to whichever muzzle just fired).
  const muzzleLight = new THREE.PointLight(0xffc27a, 0, 14, 2);
  scene.add(muzzleLight);

  // Materials (shared; roughness variation from one noise map).
  const M = {
    brick: new THREE.MeshStandardMaterial({ map: T.brick, roughnessMap: T.rough, roughness: 0.92 }),
    concrete: new THREE.MeshStandardMaterial({ map: T.concrete, roughnessMap: T.rough, roughness: 0.95 }),
    wood: new THREE.MeshStandardMaterial({ map: T.wood, roughnessMap: T.rough, roughness: 0.85 }),
    woodDark: new THREE.MeshStandardMaterial({ map: T.woodDark, roughnessMap: T.rough, roughness: 0.88 }),
    metal: new THREE.MeshStandardMaterial({ map: T.metal, roughnessMap: T.rough, roughness: 0.55, metalness: 0.6 }),
    railcar: new THREE.MeshStandardMaterial({ map: T.railcar, roughnessMap: T.rough, roughness: 0.6, metalness: 0.45 }),
    railcar2: new THREE.MeshStandardMaterial({ map: T.railcar2, roughnessMap: T.rough, roughness: 0.6, metalness: 0.45 }),
    containerBlue: new THREE.MeshStandardMaterial({ map: T.containerBlue, roughnessMap: T.rough, roughness: 0.58, metalness: 0.5 }),
    warehouse: new THREE.MeshStandardMaterial({ map: T.warehouse, roughnessMap: T.rough, roughness: 0.85 }),
    rust: new THREE.MeshStandardMaterial({ map: T.rust, roughnessMap: T.rough, roughness: 0.8, metalness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2c2a28, roughness: 0.9 }),
    roofDark: new THREE.MeshStandardMaterial({ color: 0x4a423c, roughness: 0.9 }),
    hazard: new THREE.MeshStandardMaterial({ map: T.hazard, roughness: 0.85 }),
    puddle: new THREE.MeshPhongMaterial({ color: 0x4a5c6c, shininess: 90, specular: 0xffc080 }),
    glowWarm: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  };

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
  const animated = { water: null, beam: null, siteSprites: [], lampSprites: [] };

  function solidMesh(b) {
    let mesh;
    if (b.kind === 'barrel') {
      mesh = new THREE.Mesh(cylGeo, M.rust);
      mesh.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    } else {
      mesh = new THREE.Mesh(boxGeo, M[b.mat] || M.concrete);
      mesh.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      // Crates and containers get a subtle dark edge frame for definition.
      if (b.kind === 'crate' || b.kind === 'container') {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(boxGeo),
          new THREE.LineBasicMaterial({ color: 0x1a140e, transparent: true, opacity: 0.5 }));
        edges.scale.copy(mesh.scale).multiplyScalar(1.002);
        mesh.add(edges);
      }
    }
    mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
  for (const b of SOLIDS) scene.add(solidMesh(b));

  // Ground: asphalt apron + a concrete pad under the playable area.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 180),
    new THREE.MeshStandardMaterial({ map: T.asphalt, roughnessMap: T.rough, roughness: 0.96 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  // Water to the east (beyond the wall) + a quay edge.
  const waterMat = waterMaterial();
  animated.water = waterMat;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(140, 220, 40, 40), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(115, -0.35, 0);
  scene.add(water);
  const quay = new THREE.Mesh(boxGeo, M.concrete);
  quay.scale.set(2, 1.2, 200);
  quay.position.set(39, -0.5, 0);
  scene.add(quay);

  // Painted ground markings: site letters, hazard strips, lane lines.
  function groundDecal(texture, x, z, w, d, opacity = 0.85) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    m.renderOrder = 1;
    scene.add(m);
    return m;
  }
  groundDecal(T.letterA, 22, -19, 7, 7);
  groundDecal(T.letterB, 22, 19, 7, 7);
  groundDecal(T.hazard, 11, -12.5, 6, 1.2, 0.7);
  groundDecal(T.hazard, 11, 12.5, 6, 1.2, 0.7);
  // Puddles catching the sun (simple specular reflections).
  for (const [x, z, r] of [[-6, -6, 2.2], [18, 5, 1.8], [-16, 14, 2.6], [26, -8, 1.5]]) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(r, 20), M.puddle);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.015, z);
    scene.add(p);
  }

  // Door lintels over the connector gaps.
  for (const z of [-12.5, 12.5]) {
    const lintel = new THREE.Mesh(boxGeo, M.metal);
    lintel.scale.set(6.4, 0.7, 1.2);
    lintel.position.set(11, 3.75, z);
    lintel.castShadow = true;
    scene.add(lintel);
  }

  // Train car details: roofs, wheels, underframes.
  for (const [cx, cz, mat] of [[-7, 0, M.roofDark], [6, 0, M.roofDark]]) {
    const roof = new THREE.Mesh(boxGeo, mat);
    roof.scale.set(6.4, 0.25, 3.5);
    roof.position.set(cx, 3.32, cz);
    roof.castShadow = true;
    scene.add(roof);
    for (const wx of [-2.2, 2.2]) for (const wz of [-1.7, 1.7]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), M.dark);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(cx + wx, 0.42, cz + wz);
      scene.add(wheel);
    }
  }
  // Warehouse roof + vents + glowing windows.
  const wRoof = new THREE.Mesh(boxGeo, M.roofDark);
  wRoof.scale.set(9.6, 0.4, 10.6);
  wRoof.position.set(30.5, 6.2, -19);
  wRoof.castShadow = true;
  scene.add(wRoof);
  for (const vx of [28, 33]) {
    const vent = new THREE.Mesh(cylGeo, M.metal);
    vent.scale.set(0.9, 1.1, 0.9);
    vent.position.set(vx, 6.9, -19);
    scene.add(vent);
  }
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffc98a });
  for (const wz of [-16.5, -19, -21.5]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), winMat);
    win.position.set(25.98, 4.4, wz);
    win.rotation.y = -Math.PI / 2;
    scene.add(win);
  }

  // Decor: lighthouse, cranes, stacks, ship, lamps.
  function glowSprite(x, y, z, scale, color = 0xffd9a0, opacity = 0.85) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: T.glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sp.position.set(x, y, z);
    sp.scale.set(scale, scale, 1);
    scene.add(sp);
    return sp;
  }
  for (const d of MAP.decor) {
    if (d.kind === 'lighthouse') {
      const [x, z] = d.pos;
      const g = new THREE.Group();
      const bands = [0xe8e2d4, 0xb03a2e, 0xe8e2d4, 0xb03a2e];
      let y = 0;
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(1.9 - i * 0.22, 2.1 - i * 0.22, 3.2, 16),
          new THREE.MeshStandardMaterial({ color: bands[i], roughness: 0.8 }));
        seg.position.y = y + 1.6;
        seg.castShadow = true;
        g.add(seg);
        y += 3.2;
      }
      const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.3, 16), M.dark);
      gallery.position.y = y + 0.15;
      g.add(gallery);
      const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.6, 12), M.glowWarm);
      lampRoom.position.y = y + 1.1;
      g.add(lampRoom);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.0, 12), M.dark);
      cap.position.y = y + 2.3;
      g.add(cap);
      // Rotating beam: a translucent cone + glow.
      const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 26, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffe0a8, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      beam.position.y = y + 1.1;
      beam.rotation.z = Math.PI / 2.25;
      beam.position.x = 9;
      const beamPivot = new THREE.Group();
      beamPivot.position.y = y + 1.1;
      beam.position.set(11, 0, 0);
      beamPivot.add(beam);
      g.add(beamPivot);
      animated.beam = beamPivot;
      glowSprite(0, y + 1.1, 0, 7).position.set(x, y + 1.1, z);
      g.position.set(x, 0, z);
      scene.add(g);
    } else if (d.kind === 'crane' || d.kind === 'cranesmall') {
      const [x, z] = d.pos;
      const s = d.kind === 'crane' ? 1 : 0.7;
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0xb0782e, roughness: 0.6, metalness: 0.5 });
      const legH = 16 * s;
      for (const dx of [-1.4, 1.4]) {
        const leg = new THREE.Mesh(boxGeo, mat);
        leg.scale.set(0.7, legH, 0.7);
        leg.position.set(dx * s, legH / 2, 0);
        g.add(leg);
      }
      const jib = new THREE.Mesh(boxGeo, mat);
      jib.scale.set(20 * s, 0.8, 0.8);
      jib.position.set(-2 * s, legH, 0);
      g.add(jib);
      const cab = new THREE.Mesh(boxGeo, M.dark);
      cab.scale.set(2.2 * s, 1.8 * s, 2 * s);
      cab.position.set(0.5 * s, legH - 1.4 * s, 0);
      g.add(cab);
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 7 * s, 6), M.dark);
      cable.position.set(-9 * s, legH - 3.5 * s, 0);
      g.add(cable);
      const hook = new THREE.Mesh(boxGeo, M.dark);
      hook.scale.set(1.2 * s, 1.0 * s, 1.2 * s);
      hook.position.set(-9 * s, legH - 7 * s, 0);
      g.add(hook);
      g.position.set(x, 0, z);
      scene.add(g);
    } else if (d.kind === 'stack') {
      const [x, z] = d.pos;
      const cols = [M.containerBlue, M.rust, M.metal];
      for (let i = 0; i < 3; i++) {
        const box = new THREE.Mesh(boxGeo, cols[i % 3]);
        box.scale.set(6, 2.6, 2.6);
        box.position.set(x + (i % 2) * 1.2, 1.3 + Math.floor(i / 2) * 2.7, z + (i % 2) * 3);
        box.castShadow = true;
        scene.add(box);
      }
    } else if (d.kind === 'ship') {
      const [x, z] = d.pos;
      const g = new THREE.Group();
      const hullMat = new THREE.MeshStandardMaterial({ color: 0x2e3138, roughness: 0.7 });
      const hull = new THREE.Mesh(boxGeo, hullMat);
      hull.scale.set(26, 4, 7);
      hull.position.y = 1.4;
      g.add(hull);
      const bow = new THREE.Mesh(new THREE.ConeGeometry(3.5, 7, 4), hullMat);
      bow.rotation.set(0, Math.PI / 4, -Math.PI / 2);
      bow.scale.set(1, 1, 0.55);
      bow.position.set(16, 1.4, 0);
      g.add(bow);
      const bridge = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8 }));
      bridge.scale.set(4, 5, 5);
      bridge.position.set(-8, 5.5, 0);
      g.add(bridge);
      for (let i = 0; i < 3; i++) {
        const cont = new THREE.Mesh(boxGeo, [M.containerBlue, M.rust, M.metal][i]);
        cont.scale.set(5, 2.4, 2.4);
        cont.position.set(-1 + i * 0.4, 4.6, -2 + i * 2);
        g.add(cont);
      }
      g.position.set(x, -0.4, z);
      scene.add(g);
    } else if (d.kind === 'lamp') {
      const [x, z] = d.pos;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8), M.dark);
      pole.position.set(x, 2.3, z);
      pole.castShadow = true;
      scene.add(pole);
      const arm = new THREE.Mesh(boxGeo, M.dark);
      arm.scale.set(0.9, 0.12, 0.12);
      arm.position.set(x + 0.4, 4.55, z);
      scene.add(arm);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), M.glowWarm);
      head.position.set(x + 0.8, 4.5, z);
      scene.add(head);
      const sp = glowSprite(x + 0.8, 4.5, z, 2.6, 0xffc98a, 0.55);
      animated.lampSprites.push(sp);
      // Warm pool of light on the ground (fake, cheap).
      const pool = new THREE.Mesh(new THREE.CircleGeometry(2.6, 20),
        new THREE.MeshBasicMaterial({ map: T.glow, color: 0xffb060, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x + 0.8, 0.03, z);
      scene.add(pool);
    }
  }

  // Floating site markers: glowing letters above each site.
  for (const key of ['A', 'B']) {
    const site = MAP.sites[key];
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: key === 'A' ? T.letterA : T.letterB, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    sp.position.set(site.center[0], 5.2, site.center[1]);
    sp.scale.set(2.6, 2.6, 1);
    scene.add(sp);
    animated.siteSprites.push(sp);
  }

  // Grass tufts: one instanced mesh of crossed alpha-tested quads.
  if (high) {
    const blade = new THREE.PlaneGeometry(0.9, 0.7);
    const g1 = blade.clone();
    const g2 = blade.clone();
    g2.rotateY(Math.PI / 2);
    const merged = mergeGeoms([g1, g2]);
    const grassMat = new THREE.MeshStandardMaterial({ map: T.grass, transparent: false, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 });
    const spots = [];
    const grng = { n: 12345, next() { this.n = (this.n * 16807) % 2147483647; return this.n / 2147483647; } };
    for (let i = 0; i < 130; i++) {
      const x = -36 + grng.next() * 72, z = -26 + grng.next() * 52;
      // Keep tufts out of the lanes: near walls and corners only.
      const nearWall = Math.abs(x) > 30 || Math.abs(z) > 22 || (Math.abs(z + 12.5) < 1.5 && x < 8) || (Math.abs(z - 12.5) < 1.5 && x < 8);
      if (!nearWall) continue;
      let inside = false;
      for (const b of SOLIDS) if (x > b.min[0] - 0.5 && x < b.max[0] + 0.5 && z > b.min[2] - 0.5 && z < b.max[2] + 0.5) { inside = true; break; }
      if (!inside) spots.push([x, z]);
    }
    const inst = new THREE.InstancedMesh(merged, grassMat, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
    spots.forEach(([x, z], i) => {
      e.set(0, grng.next() * Math.PI, 0);
      q.setFromEuler(e);
      const s = 0.7 + grng.next() * 0.9;
      sc.set(s, s, s);
      m4.compose(new THREE.Vector3(x, 0.32, z), q, sc);
      inst.setMatrixAt(i, m4);
    });
    scene.add(inst);
  }

  return {
    sun, muzzleLight, materials: M,
    update(dt, time) {
      if (animated.water) animated.water.uniforms.t.value = time;
      if (animated.beam) animated.beam.rotation.y = time * 0.25;
      for (let i = 0; i < animated.siteSprites.length; i++) {
        animated.siteSprites[i].position.y = 5.2 + Math.sin(time * 1.2 + i * 2) * 0.15;
      }
    },
  };
}

// Minimal BufferGeometry merge for the two crossed grass quads (no addons).
function mergeGeoms(geoms) {
  let vCount = 0, iCount = 0;
  for (const g of geoms) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const pos = new Float32Array(vCount * 3);
  const norm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, vo * 3);
    norm.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// --- Agent bodies ---------------------------------------------------------
// Stylised but proportioned: jacket (squad colour), dark trousers, helmet,
// arms holding a rifle, boots. Parts are named for the walk-cycle animator.
export function buildAgentMesh(squad, T) {
  const col = SQUADS[squad].color;
  const g = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2e2c2a, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.7 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.5, metalness: 0.4 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x23211f, roughness: 0.45, metalness: 0.6 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const add = (mat, sx, sy, sz, x, y, z, parent = g) => {
    const m = new THREE.Mesh(box, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const torso = add(jacket, 0.52, 0.62, 0.3, 0, 1.18, 0);
  add(dark, 0.54, 0.1, 0.32, 0, 0.92, 0); // belt
  const head = new THREE.Group();
  head.position.set(0, 1.62, 0);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), skin);
  skull.castShadow = true;
  head.add(skull);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.175, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMat);
  helmet.position.y = 0.02;
  head.add(helmet);
  g.add(head);
  const legL = add(dark, 0.18, 0.62, 0.2, -0.14, 0.55, 0);
  const legR = add(dark, 0.18, 0.62, 0.2, 0.14, 0.55, 0);
  add(dark, 0.2, 0.1, 0.3, -0.14, 0.05, 0.03); // boots
  add(dark, 0.2, 0.1, 0.3, 0.14, 0.05, 0.03);
  const armL = new THREE.Group();
  armL.position.set(-0.32, 1.42, 0);
  const armLm = new THREE.Mesh(box, jacket);
  armLm.scale.set(0.14, 0.5, 0.16);
  armLm.position.y = -0.22;
  armLm.castShadow = true;
  armL.add(armLm);
  g.add(armL);
  const armR = new THREE.Group();
  armR.position.set(0.32, 1.42, 0);
  const armRm = new THREE.Mesh(box, jacket);
  armRm.scale.set(0.14, 0.5, 0.16);
  armRm.position.y = -0.22;
  armRm.castShadow = true;
  armR.add(armRm);
  g.add(armR);
  // Held rifle: receiver + barrel + magazine, angled forward.
  const gun = new THREE.Group();
  const recv = new THREE.Mesh(box, gunMat);
  recv.scale.set(0.09, 0.12, 0.5);
  gun.add(recv);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), gunMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.4);
  gun.add(barrel);
  const mag = new THREE.Mesh(box, gunMat);
  mag.scale.set(0.07, 0.18, 0.1);
  mag.position.set(0, -0.13, -0.05);
  mag.rotation.x = 0.15;
  gun.add(mag);
  gun.position.set(0.18, 1.32, -0.3);
  gun.rotation.x = 0.06;
  g.add(gun);
  // Muzzle flash sprite at the barrel tip (toggled by the renderer).
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: T.glow, color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flash.scale.set(0.7, 0.7, 1);
  flash.position.set(0.18, 1.34, -0.75);
  g.add(flash);
  return { group: g, torso, head, legL, legR, armL, armR, gun, flash };
}

// The bomb: a dark case with a blinking amber light.
export function buildBombMesh(T) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2a2c28, roughness: 0.5, metalness: 0.4 }));
  body.position.y = 0.12;
  body.castShadow = true;
  g.add(body);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff4444 }));
  light.position.set(0.12, 0.26, 0);
  g.add(light);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: T.glow, color: 0xff5544, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glow.scale.set(0.5, 0.5, 1);
  glow.position.set(0.12, 0.26, 0);
  g.add(glow);
  return { group: g, light, glow };
}
