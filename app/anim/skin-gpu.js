/* SPDX-License-Identifier: Apache-2.0 */
/**
 * anim/skin-gpu.js — skinning on the graphics card (0.7 AN.2, session `anim`): one WGSL compute pass that moves every vertex
 * by its bones, linear blend or dual quaternion, the same sums as anim/rig.js skinPoints (the CPU path and the JS reference;
 * parity: tools/modelcraft-test/browser-skin-gpu.mjs). For the renderers that keep their geometry on the card: the
 * real-time view (RT, `realtime`) and the path tracer's refit per frame (RN.4 motion blur from keys) call it with their own
 * buffers; nothing here touches the page. Hot loop allocates nothing: buffers are made once per mesh and reused.
 *
 *   SKIN_WGSL                                  the kernel (bindings in its header)
 *   createGpuSkinner(device) → {skin({rest, joints, weights, n, max, M (Float64Array 16 × bones), mode}) → Promise<Float32Array>,
 *     encode(encoder, buffers, n), buffersFor({rest, joints, weights, n, max, bones}) → buffers, dispose()}
 *   packBones(M, mode) → Float32Array          the bone data the kernel reads: 16 floats a bone (lbs) or 8 (dqs)
 */
import { dualQuats } from './rig.js';

export const SKIN_WGSL = /* wgsl */ `
// bindings: 0 params {n, mode (0 linear, 1 dual quaternion), maxw (bones a vertex), _}; 1 rest points (3 floats a vertex);
// 2 joints (maxw i32 a vertex, -1 = none); 3 weights (maxw f32); 4 bones (16 floats each, or 8 for dual quaternions);
// 5 out points (3 floats a vertex). A vertex with no bone keeps its rest point.
struct Params { n: u32, mode: u32, maxw: u32, pad: u32 };
@group(0) @binding(0) var<uniform> prm: Params;
@group(0) @binding(1) var<storage, read> rest: array<f32>;
@group(0) @binding(2) var<storage, read> joints: array<i32>;
@group(0) @binding(3) var<storage, read> weights: array<f32>;
@group(0) @binding(4) var<storage, read> bones: array<f32>;
@group(0) @binding(5) var<storage, read_write> outp: array<f32>;

fn bonePoint(j: u32, p: vec3f) -> vec3f {
  let o = j * 16u;
  return vec3f(
    bones[o] * p.x + bones[o + 4u] * p.y + bones[o + 8u] * p.z + bones[o + 12u],
    bones[o + 1u] * p.x + bones[o + 5u] * p.y + bones[o + 9u] * p.z + bones[o + 13u],
    bones[o + 2u] * p.x + bones[o + 6u] * p.y + bones[o + 10u] * p.z + bones[o + 14u]);
}
fn dq(j: u32) -> array<vec4f, 2> {
  let o = j * 8u;
  return array<vec4f, 2>(vec4f(bones[o], bones[o + 1u], bones[o + 2u], bones[o + 3u]), vec4f(bones[o + 4u], bones[o + 5u], bones[o + 6u], bones[o + 7u]));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let v = gid.x;
  if (v >= prm.n) { return; }
  let p = vec3f(rest[v * 3u], rest[v * 3u + 1u], rest[v * 3u + 2u]);
  let base = v * prm.maxw;
  if (joints[base] < 0) { outp[v * 3u] = p.x; outp[v * 3u + 1u] = p.y; outp[v * 3u + 2u] = p.z; return; }
  var r = vec3f(0.0);
  if (prm.mode == 0u) {
    for (var q = 0u; q < prm.maxw; q++) {
      let j = joints[base + q];
      if (j < 0) { break; }
      r += weights[base + q] * bonePoint(u32(j), p);
    }
  } else {
    let first = dq(u32(joints[base]));
    var real = vec4f(0.0);
    var dual = vec4f(0.0);
    for (var q = 0u; q < prm.maxw; q++) {
      let j = joints[base + q];
      if (j < 0) { break; }
      let d = dq(u32(j));
      var w = weights[base + q];
      if (dot(d[0], first[0]) < 0.0) { w = -w; }   // the short way round
      real += w * d[0];
      dual += w * d[1];
    }
    let l = max(length(real), 1e-12);
    real /= l; dual /= l;
    let u = real.xyz;
    let s = real.w;
    let c = cross(u, p) + s * p;
    let rot = p + 2.0 * cross(u, c);
    // translation = 2 · dual · conj(real)
    let t = 2.0 * (-dual.w * u + s * dual.xyz + cross(u, dual.xyz));
    r = rot + t;
  }
  outp[v * 3u] = r.x; outp[v * 3u + 1u] = r.y; outp[v * 3u + 2u] = r.z;
}
`;

export function packBones(M, mode) {
  const nb = M.length / 16;
  if (mode === 'dqs') return Float32Array.from(dualQuats(M, nb));
  return Float32Array.from(M);
}

export function createGpuSkinner(device) {
  const module = device.createShaderModule({ code: SKIN_WGSL });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const U = GPUBufferUsage;
  const made = [];
  const buf = (size, usage) => { const b = device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage }); made.push(b); return b; };
  function buffersFor({ rest, joints, weights, n, max, bones }) {
    const b = {
      params: buf(16, U.UNIFORM | U.COPY_DST),
      rest: buf(n * 12, U.STORAGE | U.COPY_DST), joints: buf(n * max * 4, U.STORAGE | U.COPY_DST), weights: buf(n * max * 4, U.STORAGE | U.COPY_DST),
      bones: buf(bones * 16 * 4, U.STORAGE | U.COPY_DST), out: buf(n * 12, U.STORAGE | U.COPY_SRC), read: buf(n * 12, U.MAP_READ | U.COPY_DST), n, max,
    };
    device.queue.writeBuffer(b.rest, 0, rest.buffer, rest.byteOffset, n * 12);
    device.queue.writeBuffer(b.joints, 0, joints.buffer, joints.byteOffset, n * max * 4);
    device.queue.writeBuffer(b.weights, 0, weights.buffer, weights.byteOffset, n * max * 4);
    b.group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: ['params', 'rest', 'joints', 'weights', 'bones', 'out'].map((k, i) => ({ binding: i, resource: { buffer: b[k] } })) });
    return b;
  }
  function encode(encoder, b, n) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, b.group);
    pass.dispatchWorkgroups(Math.ceil(n / 64));
    pass.end();
  }
  return {
    pipeline, buffersFor, encode,
    /** One skin on the card, read back (tests; a renderer keeps `out` on the card instead). */
    async skin({ rest, joints, weights, n, max = 4, M, mode = 'lbs' }) {
      const bonesData = packBones(M, mode);
      const b = buffersFor({ rest, joints, weights, n, max, bones: M.length / 16 });
      device.queue.writeBuffer(b.params, 0, new Uint32Array([n, mode === 'dqs' ? 1 : 0, max, 0]));
      device.queue.writeBuffer(b.bones, 0, bonesData);
      const enc = device.createCommandEncoder();
      encode(enc, b, n);
      enc.copyBufferToBuffer(b.out, 0, b.read, 0, n * 12);
      device.queue.submit([enc.finish()]);
      await b.read.mapAsync(GPUMapMode.READ);
      const out = new Float32Array(b.read.getMappedRange().slice(0));
      b.read.unmap();
      return out;
    },
    dispose() { for (const b of made) b.destroy(); made.length = 0; },
  };
}
