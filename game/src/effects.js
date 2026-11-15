// Visual effects: pooled, zero-allocation after setup. Two Points systems
// (additive sparks, soft smoke/dust), tracer + decal + shell pools, and
// per-volume smoke clouds. Everything fades and recycles.
import * as THREE from 'three';

const MAX_P = 700;

function makePoints(scene, texture, additive, size) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX_P * 3);
  const col = new Float32Array(MAX_P * 3);
  const siz = new Float32Array(MAX_P);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(siz, 1));
  const alp = new Float32Array(MAX_P);
  geo.setAttribute('alpha', new THREE.BufferAttribute(alp, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { map: { value: texture } },
    vertexShader: `
      attribute float size; attribute vec3 color; attribute float alpha;
      varying vec3 vCol; varying float vA;
      void main(){
        vCol = color; vA = alpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (140.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map; varying vec3 vCol; varying float vA;
      void main(){
        vec4 t = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vCol, t.a * vA);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return {
    geo, pos, col, siz, alp,
    vel: new Float32Array(MAX_P * 3),
    life: new Float32Array(MAX_P),
    maxLife: new Float32Array(MAX_P),
    grav: new Float32Array(MAX_P),
    grow: new Float32Array(MAX_P),
    baseSize: new Float32Array(MAX_P),
    head: 0,
    spawn(x, y, z, vx, vy, vz, life, size, r, g, b, grav, grow) {
      const i = this.head;
      this.head = (this.head + 1) % MAX_P;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.life[i] = life; this.maxLife[i] = life;
      this.baseSize[i] = size; this.siz[i] = size;
      this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
      this.grav[i] = grav; this.grow[i] = grow;
      this.alp[i] = 1;
    },
    update(dt) {
      for (let i = 0; i < MAX_P; i++) {
        if (this.life[i] <= 0) { if (this.alp[i] !== 0) this.alp[i] = 0; continue; }
        this.life[i] -= dt;
        const f = Math.max(0, this.life[i] / this.maxLife[i]);
        this.vel[i * 3 + 1] -= this.grav[i] * dt;
        this.pos[i * 3] += this.vel[i * 3] * dt;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] = 0; }
        this.alp[i] = f;
        this.siz[i] = this.baseSize[i] * (1 + (1 - f) * this.grow[i]);
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
      this.geo.attributes.size.needsUpdate = true;
      this.geo.attributes.alpha.needsUpdate = true;
    },
  };
}

function bulletHoleTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(10,8,6,0.95)');
  g.addColorStop(0.35, 'rgba(20,16,12,0.75)');
  g.addColorStop(0.7, 'rgba(30,26,20,0.25)');
  g.addColorStop(1, 'rgba(30,26,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(200,190,170,0.5)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
    ctx.lineTo(32 + Math.cos(a) * (14 + i * 2), 32 + Math.sin(a) * (14 + i * 2));
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function buildEffects(scene, T, quality) {
  const high = quality !== 'low';
  const sparks = makePoints(scene, T.glow, true, 1);
  const smokeP = makePoints(scene, T.smoke, false, 1);
  // Ambient dust motes drifting in the sunset light.
  const dust = makePoints(scene, T.glow, true, 1);
  for (let i = 0; i < (high ? 130 : 50); i++) {
    dust.spawn(
      -36 + Math.random() * 72, 0.3 + Math.random() * 5, -26 + Math.random() * 52,
      0.12 + Math.random() * 0.2, 0.02 + Math.random() * 0.05, (Math.random() - 0.5) * 0.1,
      9999, 0.05 + Math.random() * 0.06, 1, 0.8, 0.55, 0, 0,
    );
    dust.alp[i] = 0.35;
  }
  // Tracer pool.
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 24; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerHead = 0;
  // Decal pool.
  const decalTex = bulletHoleTexture();
  const decals = [];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.visible = false;
    scene.add(m);
    decals.push({ mesh: m, life: 0 });
  }
  let decalHead = 0;
  // Shell casings.
  const shells = [];
  const shellGeo = new THREE.BoxGeometry(0.03, 0.06, 0.03);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xc9a44a, roughness: 0.35, metalness: 0.8 });
  for (let i = 0; i < 20; i++) {
    const m = new THREE.Mesh(shellGeo, shellMat);
    m.visible = false;
    scene.add(m);
    shells.push({ mesh: m, vel: [0, 0, 0], rot: [0, 0, 0], life: 0 });
  }
  let shellHead = 0;
  // Smoke clouds: sprite clusters per active smoke volume.
  const clouds = new Map(); // smoke object -> sprite list
  const smokeMat = () => new THREE.SpriteMaterial({ map: T.smoke, color: 0xd8d4cc, transparent: true, opacity: 0.75, depthWrite: false });

  const fx = {
    impact(pos, fromDir) {
      // Sparks + dust puff + decal.
      for (let i = 0; i < 6; i++) {
        sparks.spawn(pos[0], pos[1], pos[2],
          (Math.random() - 0.5) * 4 - fromDir[0] * 2, Math.random() * 3 + 1, (Math.random() - 0.5) * 4 - fromDir[2] * 2,
          0.25 + Math.random() * 0.2, 0.06 + Math.random() * 0.05, 1, 0.75, 0.4, 9, 0);
      }
      for (let i = 0; i < 3; i++) {
        smokeP.spawn(pos[0], pos[1], pos[2],
          (Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8,
          0.5 + Math.random() * 0.3, 0.25, 0.55, 0.5, 0.45, -0.4, 1.5);
      }
      const d = decals[decalHead];
      decalHead = (decalHead + 1) % decals.length;
      d.mesh.position.set(pos[0], pos[1], pos[2]);
      d.mesh.lookAt(pos[0] - fromDir[0], pos[1] - fromDir[1], pos[2] - fromDir[2]);
      d.mesh.translateZ(0.02);
      d.mesh.visible = true;
      d.mesh.material.opacity = 0.9;
      d.life = 6;
    },
    tracer(from, to) {
      const t = tracers[tracerHead];
      tracerHead = (tracerHead + 1) % tracers.length;
      const p = t.line.geometry.attributes.position.array;
      p[0] = from[0]; p[1] = from[1]; p[2] = from[2];
      p[3] = to[0]; p[4] = to[1]; p[5] = to[2];
      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.visible = true;
      t.line.material.opacity = 0.9;
      t.life = 0.07;
    },
    blood(pos) {
      for (let i = 0; i < 8; i++) {
        smokeP.spawn(pos[0], pos[1], pos[2],
          (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2,
          0.4 + Math.random() * 0.2, 0.09, 0.55, 0.08, 0.06, 7, 0);
      }
    },
    explosion(pos, big) {
      const n = big ? 40 : 22;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
        const sp = (big ? 9 : 6) * (0.4 + Math.random() * 0.8);
        sparks.spawn(pos[0], pos[1] + 0.2, pos[2],
          Math.cos(a) * Math.cos(e) * sp, Math.abs(Math.sin(e)) * sp + 2, Math.sin(a) * Math.cos(e) * sp,
          0.5 + Math.random() * 0.5, 0.16 + Math.random() * 0.14, 1, 0.6, 0.25, 7, 0);
      }
      for (let i = 0; i < (big ? 16 : 8); i++) {
        smokeP.spawn(pos[0] + (Math.random() - 0.5) * 1.5, pos[1] + 0.3, pos[2] + (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5,
          1.2 + Math.random(), big ? 1.6 : 1.0, 0.35, 0.32, 0.3, -0.6, 2.2);
      }
    },
    shell(pos, rightDir) {
      const sh = shells[shellHead];
      shellHead = (shellHead + 1) % shells.length;
      sh.mesh.position.set(pos[0], pos[1], pos[2]);
      sh.vel = [rightDir[0] * 1.6 + (Math.random() - 0.5), 2.2 + Math.random(), rightDir[2] * 1.6 + (Math.random() - 0.5)];
      sh.rot = [Math.random() * 12, Math.random() * 12, Math.random() * 12];
      sh.mesh.visible = true;
      sh.life = 2.2;
    },
    smokePop(pos) {
      // A burst of soft puffs that billow outward.
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 1.5;
        smokeP.spawn(pos[0] + Math.cos(a) * r, pos[1] + Math.random() * 0.5, pos[2] + Math.sin(a) * r,
          Math.cos(a) * 0.7, 0.35 + Math.random() * 0.4, Math.sin(a) * 0.7,
          2.5 + Math.random(), 1.2, 0.85, 0.83, 0.8, -0.25, 2.6);
      }
    },
    // Persistent cloud sprites for an active smoke volume.
    ensureCloud(smokeObj, time) {
      if (clouds.has(smokeObj)) return;
      const list = [];
      for (let i = 0; i < 8; i++) {
        const sp = new THREE.Sprite(smokeMat());
        const a = (i / 8) * Math.PI * 2;
        const r = 0.8 + (i % 3) * 0.9;
        sp.position.set(smokeObj.pos[0] + Math.cos(a) * r, smokeObj.pos[1] + 0.4 + (i % 2) * 0.9, smokeObj.pos[2] + Math.sin(a) * r);
        const sc = 3.2 + (i % 3);
        sp.scale.set(sc, sc, 1);
        sp.material.rotation = Math.random() * Math.PI;
        scene.add(sp);
        list.push(sp);
      }
      clouds.set(smokeObj, list);
    },
    update(dt, time, smokes) {
      sparks.update(dt);
      smokeP.update(dt);
      // Dust drifts; wrap around the map.
      for (let i = 0; i < MAX_P; i++) {
        if (dust.life[i] <= 0) continue;
        dust.pos[i * 3] += dust.vel[i * 3] * dt;
        dust.pos[i * 3 + 1] += dust.vel[i * 3 + 1] * dt;
        if (dust.pos[i * 3] > 38) dust.pos[i * 3] = -38;
        if (dust.pos[i * 3 + 1] > 6) dust.pos[i * 3 + 1] = 0.3;
      }
      dust.geo.attributes.position.needsUpdate = true;
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
          if (t.life <= 0) t.line.visible = false;
        }
      }
      for (const d of decals) {
        if (d.life > 0) {
          d.life -= dt;
          if (d.life < 1) d.mesh.material.opacity = d.life * 0.9;
          if (d.life <= 0) d.mesh.visible = false;
        }
      }
      for (const sh of shells) {
        if (sh.life <= 0) continue;
        sh.life -= dt;
        sh.vel[1] -= 12 * dt;
        sh.mesh.position.x += sh.vel[0] * dt;
        sh.mesh.position.y += sh.vel[1] * dt;
        sh.mesh.position.z += sh.vel[2] * dt;
        if (sh.mesh.position.y < 0.03) {
          sh.mesh.position.y = 0.03;
          sh.vel[1] *= -0.35; sh.vel[0] *= 0.7; sh.vel[2] *= 0.7;
          sh.rot[0] *= 0.5; sh.rot[1] *= 0.5; sh.rot[2] *= 0.5;
        }
        sh.mesh.rotation.x += sh.rot[0] * dt;
        sh.mesh.rotation.y += sh.rot[1] * dt;
        sh.mesh.rotation.z += sh.rot[2] * dt;
        if (sh.life <= 0) sh.mesh.visible = false;
      }
      // Smoke clouds: grow in, hold, fade out at the end of the volume.
      for (const [sm, list] of clouds) {
        const remain = sm.until - time;
        const age = time - sm.born;
        const fade = remain < 3 ? remain / 3 : Math.min(1, age / 1.2);
        for (const sp of list) {
          sp.material.opacity = 0.7 * Math.max(0, fade);
          sp.position.y += dt * 0.12;
          sp.material.rotation += dt * 0.05;
        }
        if (remain <= 0) {
          for (const sp of list) { scene.remove(sp); sp.material.dispose(); }
          clouds.delete(sm);
        }
      }
      for (const sm of smokes) fx.ensureCloud(sm, time);
    },
  };
  return fx;
}
