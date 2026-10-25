/* SPDX-License-Identifier: Apache-2.0 */
/**
 * pbr.js — imported materials in OpenPBR terms (0.7 XF.1 after "RN.2 landed", session `interchange`): the parameter names
 * and colour space are render's (RENDER-SPEC v3 § 5.1, `render/pt-pack.js` OPENPBR_DEFAULTS / recordFrom — colours are
 * linear AP1). The glTF side follows the glTF 2.0 core and the KHR_materials_* specifications; the OpenPBR side the OpenPBR
 * 1.1 specification (Apache-2.0). DOM-free.
 *
 *   gltfToOpenPBR(material) → { params, textures }   a gltf-read.js Material → OpenPBR parameters (only the ones it sets)
 *                                                      + which glTF textures feed which parameter (for `materials` to bind)
 *   openPBRToGltf(params) → { material, extensionsUsed }   the other way, for glTF writers (KHR_materials_* where needed)
 *   fbxToOpenPBR(props) → { params }                  an FBX Material's Properties70 (lambert / phong / Maya Standard Surface /
 *                                                      3ds Max Physical names) → OpenPBR parameters
 *
 * Nothing here stores a material in a model: ModelCraft keeps imported materials as paints until `materials` (MT) gives the
 * model a material table; the importers put these parameters on report.materials[i].openpbr so it can.
 * Mappings where the two models differ (written down so nobody guesses):
 *   specular (KHR_materials_specular) → specular_weight, specular_color as given (glTF's F0 tint and OpenPBR's specular
 *     colour are both multipliers on the dielectric Fresnel); ior → specular_ior; transmission → transmission_weight;
 *   volume: attenuationColor/attenuationDistance → transmission_color/transmission_depth (both Beer–Lambert);
 *   clearcoat → coat_weight / coat_roughness (coat_ior 1.5, glTF's fixed value); sheen → fuzz_color (weight 1 when the
 *     colour is not black) / fuzz_roughness; iridescence → thin_film_weight / thickness (nm → µm: OpenPBR measures in µm)
 *     / thin_film_ior; anisotropy → specular_roughness_anisotropy (strength); emissive × emissiveStrength → emission_color,
 *     emission_luminance (1 unit = 1 nit, as render's § 5.1 reads glTF); alpha (BLEND / MASK) → geometry_opacity;
 *     dispersion (glTF: 20 / Abbe number) → transmission_dispersion_scale 1 with that Abbe number; unlit → emission only.
 */
import { rgbToAp1, AP1_TO_REC709, mul3 } from '../render/pt-spec.js';

const ap1 = (rgb) => rgbToAp1(rgb.slice(0, 3)).map((x) => Math.max(0, x));
const rec709 = (c) => mul3(AP1_TO_REC709, c).map((x) => Math.max(0, x));
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const round = (v) => (Array.isArray(v) ? v.map(round) : typeof v === 'number' ? Number(v.toPrecision(7)) : v);

export function gltfToOpenPBR(m) {
  const p = {};
  const tex = {};
  if (m.unlit) {
    p.base_weight = 0; p.specular_weight = 0;
    p.emission_color = ap1(m.baseColor); p.emission_luminance = 1;
    if (m.baseColorTex) tex.emission_color = m.baseColorTex;
    return { params: round(p), textures: tex };
  }
  p.base_color = ap1(m.baseColor);
  p.base_metalness = clamp01(m.metallic);
  p.specular_roughness = clamp01(m.roughness);
  if (m.baseColorTex) tex.base_color = m.baseColorTex;
  if (m.metallicRoughnessTex) { tex.base_metalness = m.metallicRoughnessTex; tex.specular_roughness = m.metallicRoughnessTex; }
  if (m.normalTex) tex.geometry_normal = m.normalTex;
  if (m.occlusionTex) tex.occlusion = m.occlusionTex;
  if (m.ior !== 1.5) p.specular_ior = m.ior;
  if (m.specular) {
    p.specular_weight = Math.max(0, m.specular.factor);
    p.specular_color = ap1(m.specular.color);
    if (m.specular.tex) tex.specular_weight = m.specular.tex;
    if (m.specular.colorTex) tex.specular_color = m.specular.colorTex;
  }
  if (m.transmission) { p.transmission_weight = clamp01(m.transmission); if (m.transmissionTex) tex.transmission_weight = m.transmissionTex; }
  if (m.volume) {
    if (Number.isFinite(m.volume.attenuationDistance) && m.volume.attenuationDistance > 0) {
      p.transmission_color = ap1(m.volume.attenuationColor);
      p.transmission_depth = m.volume.attenuationDistance;
    }
    if (!(m.volume.thickness > 0)) p.geometry_thin_walled = true;
  } else if (m.transmission) p.geometry_thin_walled = true;   // glTF: transmission without a volume is a thin surface
  if (m.clearcoat && m.clearcoat.factor > 0) {
    p.coat_weight = clamp01(m.clearcoat.factor);
    p.coat_roughness = clamp01(m.clearcoat.roughness);
    p.coat_ior = 1.5;
    if (m.clearcoat.tex) tex.coat_weight = m.clearcoat.tex;
    if (m.clearcoat.roughnessTex) tex.coat_roughness = m.clearcoat.roughnessTex;
    if (m.clearcoat.normalTex) tex.geometry_coat_normal = m.clearcoat.normalTex;
  }
  if (m.sheen && m.sheen.color.some((c) => c > 0)) {
    p.fuzz_weight = 1;
    p.fuzz_color = ap1(m.sheen.color);
    p.fuzz_roughness = clamp01(m.sheen.roughness);
    if (m.sheen.colorTex) tex.fuzz_color = m.sheen.colorTex;
  }
  if (m.iridescence && m.iridescence.factor > 0) {
    p.thin_film_weight = clamp01(m.iridescence.factor);
    p.thin_film_thickness = m.iridescence.thicknessMax / 1000;
    p.thin_film_ior = m.iridescence.ior;
  }
  if (m.anisotropy && m.anisotropy.strength > 0) p.specular_roughness_anisotropy = clamp01(m.anisotropy.strength);
  if (m.dispersion > 0) { p.transmission_dispersion_scale = 1; p.transmission_dispersion_abbe_number = 20 / m.dispersion; }
  const strength = m.emissiveStrength ?? 1;
  if (m.emissive.some((c) => c > 0) && strength > 0) {
    const peak = Math.max(...m.emissive);
    p.emission_color = ap1(m.emissive.map((c) => c / peak));
    p.emission_luminance = peak * strength;
    if (m.emissiveTex) tex.emission_color = m.emissiveTex;
  }
  if (m.alphaMode !== 'OPAQUE') p.geometry_opacity = m.alphaMode === 'MASK' ? (m.baseColor[3] >= m.alphaCutoff ? 1 : 0) : clamp01(m.baseColor[3]);
  return { params: round(p), textures: tex };
}

export function openPBRToGltf(p) {
  const used = new Set();
  const out = { pbrMetallicRoughness: {}, extensions: {} };
  const pbr = out.pbrMetallicRoughness;
  const base = rec709(p.base_color ?? [0.8, 0.8, 0.8]);
  const opacity = p.geometry_opacity ?? 1;
  pbr.baseColorFactor = round([...base, opacity]);
  pbr.metallicFactor = round(p.base_metalness ?? 0);
  pbr.roughnessFactor = round(p.specular_roughness ?? 0.3);
  if (opacity < 1) out.alphaMode = 'BLEND';
  const ext = (name, body) => { out.extensions[name] = body; used.add(name); };
  if (p.specular_ior !== undefined && p.specular_ior !== 1.5) ext('KHR_materials_ior', { ior: round(p.specular_ior) });
  if (p.specular_weight !== undefined || p.specular_color !== undefined) ext('KHR_materials_specular', { specularFactor: round(p.specular_weight ?? 1), specularColorFactor: round(rec709(p.specular_color ?? [1, 1, 1])) });
  if (p.transmission_weight > 0) {
    ext('KHR_materials_transmission', { transmissionFactor: round(p.transmission_weight) });
    if (!p.geometry_thin_walled) {
      const v = { thicknessFactor: 1 };   // glTF needs a thickness for a volume; ModelCraft geometry is real size
      if (p.transmission_depth > 0) { v.attenuationDistance = round(p.transmission_depth); v.attenuationColor = round(rec709(p.transmission_color ?? [1, 1, 1])); }
      ext('KHR_materials_volume', v);
    }
  }
  if (p.coat_weight > 0) ext('KHR_materials_clearcoat', { clearcoatFactor: round(p.coat_weight), clearcoatRoughnessFactor: round(p.coat_roughness ?? 0) });
  if (p.fuzz_weight > 0) ext('KHR_materials_sheen', { sheenColorFactor: round(rec709(p.fuzz_color ?? [1, 1, 1]).map((c) => c * p.fuzz_weight)), sheenRoughnessFactor: round(p.fuzz_roughness ?? 0.5) });
  if (p.thin_film_weight > 0) ext('KHR_materials_iridescence', { iridescenceFactor: round(p.thin_film_weight), iridescenceIor: round(p.thin_film_ior ?? 1.4), iridescenceThicknessMinimum: round((p.thin_film_thickness ?? 0.5) * 1000), iridescenceThicknessMaximum: round((p.thin_film_thickness ?? 0.5) * 1000) });
  if (p.specular_roughness_anisotropy > 0) ext('KHR_materials_anisotropy', { anisotropyStrength: round(p.specular_roughness_anisotropy) });
  if (p.transmission_dispersion_scale > 0) ext('KHR_materials_dispersion', { dispersion: round(20 / (p.transmission_dispersion_abbe_number ?? 20) * p.transmission_dispersion_scale) });
  if (p.emission_luminance > 0) {
    const e = rec709(p.emission_color ?? [1, 1, 1]).map((c) => c);
    const peak = Math.max(...e, 1e-9);
    out.emissiveFactor = round(e.map((c) => c / peak));
    const strength = p.emission_luminance * peak;
    if (Math.abs(strength - 1) > 1e-6) ext('KHR_materials_emissive_strength', { emissiveStrength: round(strength) });
  }
  if (!Object.keys(out.extensions).length) delete out.extensions;
  return { material: out, extensionsUsed: [...used] };
}

/** FBX Properties70 → OpenPBR. Colours in FBX files are linear in practice (Maya and 3ds Max write scene-linear). */
export function fbxToOpenPBR(props) {
  const v3 = (k) => (Array.isArray(props[k]) && props[k].length >= 3 && props[k].slice(0, 3).every(Number.isFinite) ? props[k].slice(0, 3) : null);
  const n = (k) => (Array.isArray(props[k]) && Number.isFinite(props[k][0]) ? props[k][0] : null);
  const p = {};
  // Maya Standard Surface / Arnold names first, then 3ds Max Physical, then the classic lambert / phong ones
  const base = v3('Maya|baseColor') || v3('3dsMax|Parameters|base_color') || v3('DiffuseColor') || v3('Diffuse');
  if (base) p.base_color = ap1(base.map((c) => c * (n('Maya|base') ?? n('DiffuseFactor') ?? 1)));
  const metal = n('Maya|metalness') ?? n('3dsMax|Parameters|metalness');
  if (metal !== null) p.base_metalness = clamp01(metal);
  const rough = n('Maya|specularRoughness') ?? n('3dsMax|Parameters|roughness');
  if (rough !== null) p.specular_roughness = clamp01(rough);
  else if (n('Shininess') !== null || n('ShininessExponent') !== null) {
    // Blinn–Phong exponent → roughness (α² = 2 / (s + 2), roughness = √α), the usual published conversion
    const s = Math.max(0, n('ShininessExponent') ?? n('Shininess'));
    p.specular_roughness = clamp01(Math.sqrt(Math.sqrt(2 / (s + 2))));
  }
  const ior = n('Maya|specularIOR') ?? n('3dsMax|Parameters|trans_ior');
  if (ior !== null && ior > 1) p.specular_ior = ior;
  const tr = n('Maya|transmission') ?? n('3dsMax|Parameters|transparency');
  if (tr !== null && tr > 0) p.transmission_weight = clamp01(tr);
  const coat = n('Maya|coat') ?? n('3dsMax|Parameters|coating');
  if (coat !== null && coat > 0) { p.coat_weight = clamp01(coat); p.coat_roughness = clamp01(n('Maya|coatRoughness') ?? n('3dsMax|Parameters|coat_roughness') ?? 0); }
  const em = v3('Maya|emissionColor') || v3('EmissiveColor') || v3('Emissive');
  const emw = n('Maya|emission') ?? n('EmissiveFactor') ?? 1;
  if (em && em.some((c) => c > 0) && emw > 0) { const peak = Math.max(...em); p.emission_color = ap1(em.map((c) => c / peak)); p.emission_luminance = peak * emw; }
  const opacity = n('Opacity') ?? (n('TransparencyFactor') !== null && v3('TransparentColor') ? 1 - n('TransparencyFactor') * Math.max(...v3('TransparentColor')) : null);
  if (opacity !== null && opacity < 1) p.geometry_opacity = clamp01(opacity);
  return { params: round(p) };
}
