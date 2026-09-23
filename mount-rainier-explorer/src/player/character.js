import * as THREE from 'three';
import { lambert } from '../world/materials.js';

/**
 * A low-poly hiker in the Firewatch vein: khaki shirt, rolled sleeves,
 * canvas pack with a bedroll, olive shorts, boots and a ranger-ish hat.
 * Animated procedurally (walk/run cycle, idle breathing, jump pose).
 */
export class Character {
  constructor(atmo) {
    this.root = new THREE.Group();
    this.root.name = 'hiker';
    const mat = (hex) => lambert(atmo, { color: new THREE.Color(hex), flatShading: true }, { key: 'char' });
    const M = {
      shirt: mat('#c8894a'),
      shirtDark: mat('#a86d38'),
      skin: mat('#d9a47c'),
      shorts: mat('#5d5a3a'),
      sock: mat('#d8d0bc'),
      boot: mat('#4a3122'),
      pack: mat('#7a3b2a'),
      roll: mat('#3f5a4a'),
      hat: mat('#8a6a44'),
      band: mat('#3a2a1e'),
      hair: mat('#3b2a1f'),
    };
    const cast = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
    const box = (w, h, d, m) => cast(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m));
    const cyl = (rt, rb, h, m, s = 8) => cast(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), m));

    const body = (this.body = new THREE.Group());
    body.position.y = 0.95;
    this.root.add(body);

    // hips & torso
    const hips = box(0.34, 0.2, 0.22, M.shorts);
    hips.position.y = 0.02;
    body.add(hips);
    const torso = (this.torso = new THREE.Group());
    torso.position.y = 0.12;
    body.add(torso);
    const chest = cyl(0.2, 0.17, 0.52, M.shirt, 7);
    chest.scale.set(1, 1, 0.68);
    chest.position.y = 0.26;
    torso.add(chest);
    const collar = cyl(0.09, 0.16, 0.08, M.shirtDark, 7);
    collar.position.y = 0.55;
    torso.add(collar);
    const pocketL = box(0.09, 0.08, 0.02, M.shirtDark);
    pocketL.position.set(-0.08, 0.34, 0.135);
    torso.add(pocketL);
    const pocketR = pocketL.clone();
    pocketR.position.x = 0.08;
    torso.add(pocketR);

    // backpack + bedroll
    const pack = box(0.32, 0.44, 0.18, M.pack);
    pack.position.set(0, 0.3, -0.2);
    torso.add(pack);
    const lid = box(0.3, 0.1, 0.2, M.band);
    lid.position.set(0, 0.54, -0.2);
    torso.add(lid);
    const roll = cyl(0.08, 0.08, 0.42, M.roll, 8);
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0, 0.08, -0.22);
    torso.add(roll);
    for (const s of [-1, 1]) {
      const strap = box(0.04, 0.46, 0.03, M.band);
      strap.position.set(s * 0.1, 0.3, 0.125);
      torso.add(strap);
    }

    // head
    const head = (this.head = new THREE.Group());
    head.position.y = 0.66;
    torso.add(head);
    const skull = cast(new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), M.skin));
    skull.scale.set(1, 1.12, 1.02);
    skull.position.y = 0.07;
    head.add(skull);
    const beard = cast(new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), M.hair));
    beard.scale.set(1.05, 0.7, 0.9);
    beard.position.set(0, 0.0, 0.03);
    head.add(beard);
    const brim = cyl(0.25, 0.25, 0.02, M.hat, 14);
    brim.position.y = 0.17;
    head.add(brim);
    const crown = cyl(0.12, 0.14, 0.12, M.hat, 10);
    crown.position.y = 0.23;
    head.add(crown);
    const band = cyl(0.141, 0.141, 0.03, M.band, 10);
    band.position.y = 0.19;
    head.add(band);

    // limbs: pivot groups at shoulders / hips
    const limb = (parent, x, y, upperMat, lowerMat, len, r, endMat, endGeo) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      parent.add(pivot);
      const upper = cyl(r, r * 0.9, len, upperMat, 6);
      upper.position.y = -len / 2;
      pivot.add(upper);
      const knee = new THREE.Group();
      knee.position.y = -len;
      pivot.add(knee);
      const lower = cyl(r * 0.9, r * 0.75, len, lowerMat, 6);
      lower.position.y = -len / 2;
      knee.add(lower);
      if (endGeo) {
        const end = cast(new THREE.Mesh(endGeo, endMat));
        end.position.set(0, -len, 0.04);
        knee.add(end);
      }
      return { pivot, knee };
    };
    this.armL = limb(torso, -0.25, 0.5, M.shirt, M.skin, 0.28, 0.055, M.skin, new THREE.IcosahedronGeometry(0.05, 0));
    this.armR = limb(torso, 0.25, 0.5, M.shirt, M.skin, 0.28, 0.055, M.skin, new THREE.IcosahedronGeometry(0.05, 0));
    this.legL = limb(body, -0.1, -0.05, M.shorts, M.sock, 0.44, 0.075, M.boot, new THREE.BoxGeometry(0.12, 0.1, 0.26));
    this.legR = limb(body, 0.1, -0.05, M.shorts, M.sock, 0.44, 0.075, M.boot, new THREE.BoxGeometry(0.12, 0.1, 0.26));

    this.phase = 0;
    this.blend = 0;
  }

  /** speed in m/s, grounded flag, dt seconds */
  animate(speed, grounded, dt, time) {
    const moving = Math.min(1, speed / 1.5);
    this.blend += (moving - this.blend) * Math.min(1, dt * 8);
    const run = Math.min(1, Math.max(0, (speed - 3) / 4));
    this.phase += dt * (2.2 + speed * 1.15);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const amp = (0.55 + run * 0.35) * this.blend;
    const b = this.blend;

    if (!grounded) {
      this.legL.pivot.rotation.x = -0.7; this.legL.knee.rotation.x = 1.0;
      this.legR.pivot.rotation.x = 0.2; this.legR.knee.rotation.x = 0.4;
      this.armL.pivot.rotation.x = -1.2; this.armR.pivot.rotation.x = -1.0;
      this.armL.pivot.rotation.z = -0.3; this.armR.pivot.rotation.z = 0.3;
      this.body.position.y = 0.95;
      return;
    }
    this.legL.pivot.rotation.x = s * amp;
    this.legR.pivot.rotation.x = -s * amp;
    this.legL.knee.rotation.x = Math.max(0, -c) * amp * 1.4 + 0.05;
    this.legR.knee.rotation.x = Math.max(0, c) * amp * 1.4 + 0.05;
    this.armL.pivot.rotation.x = -s * amp * 0.8;
    this.armR.pivot.rotation.x = s * amp * 0.8;
    this.armL.knee.rotation.x = -0.3 - run * 0.9 * b;
    this.armR.knee.rotation.x = -0.3 - run * 0.9 * b;
    this.armL.pivot.rotation.z = -0.08;
    this.armR.pivot.rotation.z = 0.08;
    const breathe = Math.sin(time * 1.8) * 0.008 * (1 - b);
    this.body.position.y = 0.95 + Math.abs(s) * 0.05 * b + breathe - 0.03 * b;
    this.torso.rotation.x = 0.08 * b + run * 0.18;
    this.torso.rotation.y = s * 0.08 * b;
    this.head.rotation.x = -this.torso.rotation.x * 0.6;
  }

  get stepPhase() { return this.phase; }
}
