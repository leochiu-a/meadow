import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Merge every static single-material mesh under root into one mesh per material per ground
 * cell, baking world transforms. Hundreds of prop parts become a few draw calls, while
 * cells off screen (or outside the sun's shadow box) are still culled whole.
 *
 * Left alone: instanced meshes, meshes marked userData.dynamic, and foliage (its wind sway
 * reads the mesh's own vertex heights). Meshes only merge with others that match their
 * shadow flags, so an emissive bulb that cast no shadow still casts none.
 */
export function batchStatic(root: THREE.Object3D, cell = 40) {
  root.updateMatrixWorld(true)
  const buckets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; list: THREE.BufferGeometry[] }>()
  const doomed: THREE.Object3D[] = []
  const centre = new THREE.Vector3()
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || Array.isArray(o.material) || o.userData.dynamic) return
    const material: THREE.Material = o.material
    if (material.userData.foliage) return
    // Keep only what the material reads, so parts built differently still merge.
    const keep = ['position', 'normal', 'uv', ...('vertexColors' in material && material.vertexColors ? ['color'] : [])]
    let geo: THREE.BufferGeometry = o.geometry.clone()
    for (const name of Object.keys(geo.attributes)) if (!keep.includes(name)) geo.deleteAttribute(name)
    if (geo.index) geo = geo.toNonIndexed()
    geo.applyMatrix4(o.matrixWorld)
    geo.computeBoundingBox()
    geo.boundingBox!.getCenter(centre)
    const attrs = Object.keys(geo.attributes).sort().join()
    const key = `${material.uuid}:${attrs}:${o.castShadow}:${o.receiveShadow}:${Math.floor(centre.x / cell)},${Math.floor(centre.z / cell)}`
    let bucket = buckets.get(key)
    if (!bucket) buckets.set(key, (bucket = { material, cast: o.castShadow, receive: o.receiveShadow, list: [] }))
    bucket.list.push(geo)
    doomed.push(o)
  })

  for (const o of doomed) o.removeFromParent()
  const out = new THREE.Group()
  for (const { material, cast, receive, list } of buckets.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(list), material)
    mesh.castShadow = cast
    mesh.receiveShadow = receive
    out.add(mesh)
  }
  return out
}
